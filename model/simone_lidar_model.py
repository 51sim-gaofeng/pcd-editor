"""Official SimOne StreamingAPI LiDAR adapter preserving source frame ids."""
from __future__ import annotations

import ctypes
import os
import threading
import time
from collections import deque
from pathlib import Path

import numpy as np

# Must match the SimOneStreamingAPI.h shipped with this SDK.
_MAX_BYTES = 12_829_600


class _PointCloud(ctypes.Structure):
    _pack_ = 1
    _fields_ = [
        ('timestamp', ctypes.c_longlong),
        ('frame', ctypes.c_int),
        ('version', ctypes.c_int),
        ('width', ctypes.c_int),
        ('height', ctypes.c_int),
        ('pointStep', ctypes.c_int),
        ('pointCloudDataSize', ctypes.c_int),
        ('pointCloudData', ctypes.c_ubyte * _MAX_BYTES),
    ]


_lock = threading.RLock()
_dll = None
_dll_dir_handle = None
_generation = 0
_threads = []
_frames = deque(maxlen=30)
_status = {
    'running': False, 'host': '', 'port': 0, 'info_port': 0,
    'recv_count': 0, 'frame': -1, 'timestamp': 0, 'points': 0,
    'age_ms': -1, 'last_received_ns': 0, 'error': None,
    'source': 'SimOneStreamingAPI',
}


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
            fn = dll.GetStreamingPointCloud
            fn.argtypes = [
                ctypes.c_char_p, ctypes.c_ushort, ctypes.c_ushort,
                ctypes.POINTER(_PointCloud),
            ]
            fn.restype = ctypes.c_bool
            _dll = dll
            return dll
        except Exception as exc:
            errors.append(f'{path}: {exc}')
    detail = ': ' + '; '.join(errors) if errors else ''
    raise RuntimeError('SimOneStreamingAPI.dll unavailable' + detail)


def _publish(data: _PointCloud) -> None:
    size, step = int(data.pointCloudDataSize), int(data.pointStep)
    if size <= 0 or size > _MAX_BYTES or step < 12:
        return
    count = size // step
    raw = np.ctypeslib.as_array(data.pointCloudData)[:count * step].reshape(count, step)
    xyz = raw[:, :12].copy().view('<f4').reshape(count, 3)
    intensity = (raw[:, 12:16].copy().view('<f4').reshape(count, 1)
                 if step >= 16 else np.zeros((count, 1), np.float32))
    points = np.ascontiguousarray(np.concatenate((xyz, intensity), axis=1),
                                  dtype=np.float32)
    frame = int(data.frame)
    received_ns = time.time_ns()
    with _lock:
        if _status['frame'] == frame:
            return
        _status.update({
            'recv_count': _status['recv_count'] + 1,
            'frame': frame,
            'timestamp': int(data.timestamp),
            'points': count,
            'last_received_ns': received_ns,
            'age_ms': 0,
            'error': None,
        })
        _frames.append({
            'source_frame_id': frame, 'points': points,
            'timestamp_ns': int(data.timestamp) * 1_000_000,
        })
    from model.streaming_model import ingest_official_frame
    ingest_official_frame(points, frame)


def _poll(host: str, port: int, info_port: int, generation: int) -> None:
    fn = _load_dll().GetStreamingPointCloud
    cloud = _PointCloud()
    # Match the SDK's Python wrapper, which passes a writable 256-byte IP buffer.
    encoded_host = ctypes.create_string_buffer(host.encode('utf-8'), 256)
    while generation == _generation:
        try:
            if fn(encoded_host, port, info_port, ctypes.byref(cloud)):
                _publish(cloud)
            else:
                time.sleep(0.002)
        except Exception as exc:
            with _lock:
                _status['error'] = f'GetStreamingPointCloud: {exc}'
            time.sleep(0.05)


def start(host: str, port: int, info_port: int) -> dict:
    global _generation
    host, port, info_port = str(host), int(port), int(info_port)
    with _lock:
        if (_status['running'] and _status['host'] == host
                and _status['port'] == port
                and _status['info_port'] == info_port):
            return get_status()
    _load_dll()
    with _lock:
        _generation += 1
        generation = _generation
        _status.update({'running': True, 'host': host, 'port': port,
                        'info_port': info_port, 'frame': -1, 'error': None})
    thread = threading.Thread(
        target=_poll, args=(host, port, info_port, generation),
        name=f'simone-lidar-{port}', daemon=True)
    _threads.append(thread)
    thread.start()
    return get_status()


def get_status() -> dict:
    with _lock:
        result = dict(_status)
        if result['last_received_ns']:
            result['age_ms'] = round(
                (time.time_ns() - result['last_received_ns']) / 1_000_000)
        return result


def get_frames() -> list:
    with _lock:
        return list(_frames)
