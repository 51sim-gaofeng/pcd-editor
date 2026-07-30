"""SimOne StreamingAPI camera adapter preserving the simulator frame id.

The Streaming DLL owns UDP/GVSP reassembly.  In particular, the simulation
frame is ``SimOne_Streaming_Image.frame``; the GVSP block id is only a
transport identifier and must not be exposed as the source frame.
"""
from __future__ import annotations

import ctypes
import os
import threading
import time
from collections import deque
from pathlib import Path


_MAX_IMAGE_BYTES = 3840 * 2160 * 3
_FORMAT_RGB = 0
_FORMAT_RLE = 1
_FORMAT_JPEG = 2
_FORMAT_H265 = 3


class _StreamingImage(ctypes.Structure):
    _pack_ = 1
    _fields_ = [
        ('timestamp', ctypes.c_longlong),
        ('frame', ctypes.c_int),
        ('version', ctypes.c_int),
        ('width', ctypes.c_int),
        ('height', ctypes.c_int),
        ('format', ctypes.c_int),
        ('imageDataSize', ctypes.c_int),
        ('imageData', ctypes.c_ubyte * _MAX_IMAGE_BYTES),
    ]


_cam_lock = threading.RLock()
_cam_cond = threading.Condition(_cam_lock)
_cam_jpeg = b''
_cam_frame_id = -1             # local monotonic cursor used by HTTP long-polling
_cam_source_frame_id = -1      # SimOne_Streaming_Image.frame
_cam_recv_count = 0
_cam_last_ts = 0.0
_cam_bind_host = '10.66.8.44'
_cam_bind_port = 13956
_cam_running = False
_cam_error = None
_cam_format = -1
_cam_width = 0
_cam_height = 0
_listener_thread = None
_listener_stop_evt = None
_generation = 0
_dll = None
_dll_dir_handle = None
_cam_fusion_frames = deque(maxlen=60)


def _candidate_dirs():
    # The repository carries the Windows runtime so a checkout works without
    # depending on the developer's SimOne installation path.
    yield Path(__file__).resolve().parent.parent / 'runtime' / 'simone' / 'Win64'
    env = os.environ.get('SIMONE_API_DIR')
    if env:
        yield Path(env)
    for entry in os.environ.get('PATH', '').split(os.pathsep):
        if entry:
            yield Path(entry)


def _load_dll():
    global _dll, _dll_dir_handle
    if _dll is not None:
        return _dll
    errors = []
    for directory in _candidate_dirs():
        path = directory / 'SimOneStreamingAPI.dll'
        if not path.is_file():
            continue
        try:
            if hasattr(os, 'add_dll_directory'):
                _dll_dir_handle = os.add_dll_directory(str(directory))
            dll = ctypes.CDLL(str(path))
            fn = dll.GetStreamingImage
            fn.argtypes = [
                ctypes.c_char_p, ctypes.c_ushort,
                ctypes.POINTER(_StreamingImage),
            ]
            fn.restype = ctypes.c_bool
            _dll = dll
            return dll
        except Exception as exc:
            errors.append(f'{path}: {exc}')
    detail = ': ' + '; '.join(errors) if errors else ''
    raise RuntimeError('SimOneStreamingAPI.dll unavailable' + detail)


def _image_to_jpeg(image: _StreamingImage) -> bytes:
    size = int(image.imageDataSize)
    width, height = int(image.width), int(image.height)
    if size <= 0 or size > _MAX_IMAGE_BYTES:
        raise ValueError(f'invalid imageDataSize: {size}')
    raw = bytes(image.imageData[:size])
    if image.format == _FORMAT_JPEG:
        return raw
    if image.format == _FORMAT_RGB:
        if width <= 0 or height <= 0 or size < width * height * 3:
            raise ValueError(f'invalid RGB image: {width}x{height}, {size} bytes')
        import cv2
        import numpy as np
        rgb = np.frombuffer(raw, dtype=np.uint8, count=width * height * 3)
        rgb = rgb.reshape(height, width, 3)
        ok, encoded = cv2.imencode('.jpg', rgb, [cv2.IMWRITE_JPEG_QUALITY, 90])
        if not ok:
            raise ValueError('OpenCV failed to encode RGB image')
        return encoded.tobytes()
    if image.format == _FORMAT_RLE:
        raise ValueError('RLE segmentation images are not supported by Camera view')
    if image.format == _FORMAT_H265:
        raise ValueError('H265 camera output requires a video decoder')
    raise ValueError(f'unsupported SimOne image format: {image.format}')


def _publish(image: _StreamingImage) -> None:
    global _cam_jpeg, _cam_frame_id, _cam_source_frame_id
    global _cam_recv_count, _cam_last_ts, _cam_error
    global _cam_format, _cam_width, _cam_height
    frame = int(image.frame)
    jpeg = _image_to_jpeg(image)
    received_ns = time.time_ns()
    with _cam_cond:
        # The DLL may return its latest image repeatedly between sensor updates.
        if _cam_source_frame_id == frame:
            return
        _cam_jpeg = jpeg
        _cam_frame_id += 1
        _cam_source_frame_id = frame
        _cam_recv_count += 1
        _cam_last_ts = time.time()
        _cam_error = None
        _cam_format = int(image.format)
        _cam_width = int(image.width)
        _cam_height = int(image.height)
        _cam_fusion_frames.append({
            'source_frame_id': frame,
            'jpeg': jpeg,
            'timestamp_ns': int(image.timestamp) * 1_000_000 or received_ns,
        })
        _cam_cond.notify_all()


def _receiver_thread(host, port, stop_evt, generation, startup_evt, startup_state):
    global _cam_running, _cam_error
    try:
        fn = _load_dll().GetStreamingImage
    except Exception as exc:
        with _cam_lock:
            _cam_running = False
            _cam_error = str(exc)
        startup_state['error'] = str(exc)
        startup_evt.set()
        return
    with _cam_lock:
        _cam_running = True
        _cam_error = None
    startup_state['ok'] = True
    startup_evt.set()
    host_buffer = ctypes.create_string_buffer(host.encode('utf-8'), 256)
    last_frame = 0
    print(f'[CAM] SimOneStreamingAPI receiver started on {host}:{port}', flush=True)
    while not stop_evt.is_set() and generation == _generation:
        try:
            # Match SensorCamera.cpp: allocate a fresh output object for every
            # GetStreamingImage call instead of reusing memory owned by a
            # previous receive/decode cycle.
            image = _StreamingImage()
            if fn(host_buffer, port, ctypes.byref(image)):
                if int(image.frame) != last_frame:
                    _publish(image)
                    last_frame = int(image.frame)
            time.sleep(0.001)
        except Exception as exc:
            with _cam_lock:
                _cam_error = str(exc)
            time.sleep(0.05)
    with _cam_lock:
        if generation == _generation:
            _cam_running = False
    print('[CAM] SimOneStreamingAPI receiver stopped', flush=True)


def stop_udp_listener() -> None:
    global _listener_thread, _listener_stop_evt, _cam_running, _generation
    with _cam_lock:
        thread, event = _listener_thread, _listener_stop_evt
        _generation += 1
    if event is not None:
        event.set()
    if thread is not None:
        thread.join(timeout=1.0)
    with _cam_lock:
        _listener_thread = None
        _listener_stop_evt = None
        _cam_running = False


def start_udp_listener(port: int, host: str = '10.66.8.44') -> None:
    """Start the official StreamingAPI camera receiver."""
    global _listener_thread, _listener_stop_evt, _cam_bind_host, _cam_bind_port
    global _generation, _cam_jpeg, _cam_frame_id, _cam_source_frame_id
    global _cam_recv_count, _cam_last_ts, _cam_error
    global _cam_format, _cam_width, _cam_height
    stop_udp_listener()
    event = threading.Event()
    startup_evt = threading.Event()
    startup_state = {}
    with _cam_lock:
        _cam_bind_host, _cam_bind_port = host, int(port)
        _cam_jpeg = b''
        _cam_frame_id = -1
        _cam_source_frame_id = -1
        _cam_recv_count = 0
        _cam_last_ts = 0.0
        _cam_error = None
        _cam_format = -1
        _cam_width = 0
        _cam_height = 0
        _cam_fusion_frames.clear()
        generation = _generation
    thread = threading.Thread(
        target=_receiver_thread,
        args=(host, int(port), event, generation, startup_evt, startup_state),
        daemon=True,
        name='SimOneCameraReceiver',
    )
    with _cam_lock:
        _listener_stop_evt = event
        _listener_thread = thread
    thread.start()
    startup_evt.wait(timeout=2.0)
    if startup_state.get('error'):
        raise RuntimeError(startup_state['error'])


def get_latest_frame_blocking(after_id: int, timeout: float = 2.0):
    """Return (local cursor, simulator frame id, JPEG), blocking for new data."""
    deadline = time.monotonic() + timeout
    with _cam_cond:
        while _cam_frame_id <= after_id:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return _cam_frame_id, _cam_source_frame_id, None
            _cam_cond.wait(timeout=min(remaining, 0.5))
        return _cam_frame_id, _cam_source_frame_id, _cam_jpeg


def get_status() -> dict:
    with _cam_lock:
        age_ms = round((time.time() - _cam_last_ts) * 1000) if _cam_last_ts else -1
        return {
            'running': _cam_running,
            'host': _cam_bind_host,
            'port': _cam_bind_port,
            'recv_count': _cam_recv_count,
            'frame_id': _cam_frame_id,
            'source_frame_id': _cam_source_frame_id,
            'age_ms': age_ms,
            'format': _cam_format,
            'width': _cam_width,
            'height': _cam_height,
            'error': _cam_error,
            'source': 'SimOneStreamingAPI',
        }


def get_fusion_frames() -> list:
    with _cam_lock:
        return list(_cam_fusion_frames)


def rebind(host: str, port: int) -> dict:
    start_udp_listener(port=port, host=host)
    return get_status()
