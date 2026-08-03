"""Live LiDAR-camera calibration projection adapted from display3d.py."""
from __future__ import annotations

import copy
import threading
import time

import cv2
import numpy as np

from model.camera_model import get_fusion_frames, _SOURCE_FRAME_ID_TOO_LARGE
from model.streaming_model import get_fusion_frames as get_lidar_frames

_lock = threading.RLock()
_cond = threading.Condition(_lock)
_config = None
_sequence = -1
_jpeg = b''
_meta = {}
_last_pair = None
_worker = None

# LiDAR needs a full revolution to collect one frame, so its reported
# source_frame_id is systematically behind the camera's by a fixed number of
# frames worth of ms. That lag varies by simone version/config, so we don't
# hardcode a guess — default to 0 and let the offset be tuned live from the UI
# (see set_frame_offset/get_frame_offset) once a mismatch is observed.
_frame_offset_ms = 0


def get_frame_offset() -> int:
    with _lock:
        return _frame_offset_ms


def set_frame_offset(value: int) -> dict:
    global _frame_offset_ms
    with _lock:
        _frame_offset_ms = int(value)
        return {'ok': True, 'frame_offset_ms': _frame_offset_ms}


def _rotation_zyx(roll: float, pitch: float, yaw: float) -> np.ndarray:
    roll, pitch, yaw = np.deg2rad([roll, pitch, yaw])
    cr, sr, cp, sp, cy, sy = np.cos(roll), np.sin(roll), np.cos(pitch), np.sin(pitch), np.cos(yaw), np.sin(yaw)
    rx = np.array([[1,0,0],[0,cr,-sr],[0,sr,cr]])
    ry = np.array([[cp,0,sp],[0,1,0],[-sp,0,cp]])
    rz = np.array([[cy,-sy,0],[sy,cy,0],[0,0,1]])
    return rz @ ry @ rx


def _value(d: dict, *paths, default=0.0):
    for path in paths:
        cur = d
        try:
            for part in path.split('.'):
                cur = cur[int(part)] if isinstance(cur, list) else cur[part]
            if cur is not None:
                return cur
        except (KeyError, IndexError, TypeError, ValueError):
            pass
    return default


def _pose(sensor: dict):
    pose = sensor.get('mounting_pose_relative_to_agent') or sensor.get('extrinsic') or sensor.get('pose') or sensor
    t = _value(pose, 'translation_m', 'position', default=None)
    if isinstance(t, list) and len(t) >= 3:
        translation = np.asarray(t[:3], np.float64)
    else:
        translation = np.array([_value(pose,'x'), _value(pose,'y'), _value(pose,'z')], np.float64)
    r = _value(pose, 'roll_pitch_yaw_deg', 'rotation', default=None)
    if isinstance(r, list) and len(r) >= 3:
        angles = [float(x) for x in r[:3]]
    else:
        angles = [_value(pose,'roll'), _value(pose,'pitch'), _value(pose,'yaw')]
    return translation, _rotation_zyx(*angles)


def configure(camera: dict, lidar: dict) -> dict:
    global _config, _last_pair
    params = camera.get('params') or camera
    intr = camera.get('intrinsics') or params.get('intrinsics') or params.get('distortion') or {}
    derived = intr.get('derived_opencv_values') or intr
    width = int(_value(params, 'resolutionWidth', 'capture.image_width_px', default=1920))
    height = int(_value(params, 'resolutionHeight', 'capture.image_height_px', default=1080))
    matrix = derived.get('camera_matrix')
    if matrix is None:
        fx = float(_value(derived, 'fx_px', 'focalLengthX', default=width))
        fy = float(_value(derived, 'fy_px', 'focalLengthY', default=fx))
        # cx_px/cy_px are absolute OpenCV pixel coordinates. For compatibility,
        # offsetCx/offsetCy are also absolute coordinates, except that zero means
        # "not configured" and falls back to the image center.
        if derived.get('cx_px') is not None:
            cx = float(derived['cx_px'])
        else:
            offset_cx = float(_value(derived, 'offsetCx', default=0.0))
            cx = width / 2.0 if offset_cx == 0.0 else offset_cx
        if derived.get('cy_px') is not None:
            cy = float(derived['cy_px'])
        else:
            offset_cy = float(_value(derived, 'offsetCy', default=0.0))
            cy = height / 2.0 if offset_cy == 0.0 else offset_cy
        matrix = [[fx,0,cx],[0,fy,cy],[0,0,1]]
    distortion = intr.get('opencv_distortion_coefficients')
    if distortion is None:
        distortion = [_value(intr,'k1','K1'), _value(intr,'k2','K2'),
                      _value(intr,'p1','P1'), _value(intr,'p2','P2'),
                      _value(intr,'k3','K3')]
    camera_t, camera_r = _pose(camera)
    lidar_t, lidar_r = _pose(lidar)
    # display3d.py: vehicle/LiDAR X-forward,Y-left,Z-up -> camera optical
    axes = np.array([[0,-1,0],[0,0,-1],[1,0,0]], np.float64)
    transform = np.eye(4)
    transform[:3,:3] = axes @ camera_r.T @ lidar_r
    transform[:3,3] = axes @ camera_r.T @ (lidar_t - camera_t)
    with _lock:
        _config = {'camera_matrix': np.asarray(matrix, np.float64),
                   'distortion': np.asarray(distortion, np.float64),
                   'transform': transform, 'width': width, 'height': height}
        _last_pair = None
    _ensure_worker()
    return {'ok': True, 'camera_matrix': matrix,
            'T_camera_optical_from_lidar': transform.tolist()}


def _colors(intensity: np.ndarray) -> np.ndarray:
    v = np.clip(intensity, 0, 255)
    if np.nanmax(v, initial=0) <= 1.0:
        v = v * 255.0
    v = v.astype(np.float32)
    b = np.clip(255 - np.maximum(v - 33, 0) * 7.727, 0, 255)
    g = np.where(v <= 33, v * 7.727, np.where(v <= 100, 255, 255 - (v - 100) * 7.727 / 4.697))
    r = np.where(v <= 66, 0, np.where(v <= 100, (v - 67) * 7.727, 255))
    return np.stack([b, np.clip(g,0,255), np.clip(r,0,255)], axis=1).astype(np.uint8)


def _render(camera: dict, lidar: dict, cfg: dict):
    image = cv2.imdecode(np.frombuffer(camera['jpeg'], np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError('camera JPEG decode failed')
    points = np.asarray(lidar['points'], np.float64)
    xyz1 = np.concatenate([points[:,:3], np.ones((len(points),1))], axis=1)
    optical = (cfg['transform'] @ xyz1.T).T[:,:3]
    mask = optical[:,2] > 0
    optical, source = optical[mask], points[mask]
    projected, _ = cv2.projectPoints(optical.astype(np.float32), np.zeros(3), np.zeros(3),
                                     cfg['camera_matrix'], cfg['distortion'])
    pixels = projected.reshape(-1,2).astype(np.int32)
    valid = ((pixels[:,0]>=0)&(pixels[:,0]<image.shape[1])&
             (pixels[:,1]>=0)&(pixels[:,1]<image.shape[0]))
    pixels, source = pixels[valid], source[valid]
    colors = _colors(source[:,3] if source.shape[1] > 3 else np.zeros(len(source)))
    # Vectorized splat instead of one cv2.circle() Python call per point (was the
    # dominant cost at 50k+ points/frame — 60-150x fewer Python/OpenCV calls).
    h, w = image.shape[:2]
    xs, ys = pixels[:, 0], pixels[:, 1]
    image[ys, xs] = colors
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        image[np.clip(ys + dy, 0, h - 1), np.clip(xs + dx, 0, w - 1)] = colors
    ok, encoded = cv2.imencode('.jpg', image, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ok:
        raise ValueError('fusion JPEG encode failed')
    return encoded.tobytes(), len(pixels)


def _circular_ms_diff(a: int, b: int, wrap: int = 65536) -> int:
    """Distance between two 16-bit-wrapping ms clocks, handling wraparound.

    Camera's source_frame_id keeps growing unwrapped, lidar's wraps every
    65.536s (SimTimestamp.ms is uint16) — Python's % on the difference still
    correctly reduces the unwrapped side into the same ring before comparing.
    """
    d = (a - b) % wrap
    return min(d, wrap - d)


def _worker_loop():
    global _sequence, _jpeg, _meta, _last_pair
    while True:
        try:
            cameras, lidars = get_fusion_frames(), get_lidar_frames()
            with _lock:
                cfg = copy.deepcopy(_config)
            if not cfg or not cameras or not lidars:
                time.sleep(.03); continue
            camera = cameras[-1]
            # Both source_frame_id values are simulation-relative ms clocks (not
            # wall-clock epoch time — confirmed against the actual senders:
            # udp_utils.py/simone_publisher.py both derive them from frame_id/fps),
            # and lidar's is truncated to 16 bits on the wire, so match with a
            # wraparound-aware circular distance instead of a plain abs diff.
            # Some senders (e.g. simone3.x) make camera['source_frame_id'] come out
            # implausibly large (a mis-decoded timestamp — see camera_model.py's
            # _display_frame_id/_SOURCE_FRAME_ID_TOO_LARGE). In that case matching
            # against it would be meaningless, so fall back to the raw GVSP block_id
            # (small, monotonic, ms-scale) for both the match key and the reported id.
            camera_source_fid = int(camera['source_frame_id'])
            camera_key = (camera.get('block_id', camera_source_fid)
                          if camera_source_fid > _SOURCE_FRAME_ID_TOO_LARGE
                          else camera_source_fid)
            # Compensate for the camera-vs-lidar systematic lag (see
            # _frame_offset_ms above): the camera is offset ms ahead of the
            # lidar frame it should actually be paired with, so subtract the
            # offset before searching for the closest lidar timestamp.
            offset = get_frame_offset()
            match_key = camera_key - offset
            lidar = min(lidars, key=lambda x: _circular_ms_diff(
                match_key, int(x['source_frame_id'])))
            pair = (camera_key, lidar['source_frame_id'])
            if pair == _last_pair:
                time.sleep(.01); continue
            jpeg, projected = _render(camera, lidar, cfg)
            with _cond:
                _last_pair = pair; _sequence += 1; _jpeg = jpeg
                _meta = {'camera_frame': pair[0], 'lidar_frame': pair[1],
                         'projected_points': projected, 'frame_offset_ms': offset}
                _cond.notify_all()
        except Exception as exc:
            with _lock:
                _meta = {'error': str(exc)}
            time.sleep(.05)


def _ensure_worker():
    global _worker
    with _lock:
        if _worker and _worker.is_alive():
            return
        _worker = threading.Thread(target=_worker_loop, daemon=True, name='fusion-render')
        _worker.start()


def get_frame(after: int, timeout: float = 2.0):
    with _cond:
        if _sequence == after:
            _cond.wait(timeout)
        return _sequence, _jpeg if _sequence != after else None, dict(_meta)


def get_status():
    with _lock:
        return {'configured': _config is not None, 'sequence': _sequence,
                'frame_offset_ms': _frame_offset_ms, **_meta}
