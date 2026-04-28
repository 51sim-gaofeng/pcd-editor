"""DDS UDP receiver — receives live point cloud frames from render.py lidar_dds mode.

Protocol (single-packet frame):
  [magic(4B)='PC2\x00'][timestamp_ns(8B)][frame_id(4B)][num_points(4B)][N*16B: x,y,z,intensity float32]

Protocol (fragmented large frame):
  [total_slices(2B)][slice_idx(2B)][total_len(4B)][payload bytes]
  When all slices received, reassemble and process as a single-packet frame.

The binary format stored in _dds_frame is identical to pcd_binary so the
frontend can parse it with the same _parsePcdBuf() function.
"""
import json
import socket
import struct
import threading
import time

_dds_lock    = threading.Lock()
_dds_frame: bytes = b''        # latest binary payload (same format as pcd_to_binary)
_dds_frame_id: int = -1        # monotonic counter for change detection
_dds_recv_count: int = 0       # total frames received
_dds_last_ts: float = 0.0      # time of last received frame

_UDP_MAGIC       = b'PC2\x00'
_UDP_HEADER_FMT  = '<4sQII'    # magic(4B) + timestamp_ns(8B) + frame_id(4B) + num_points(4B)
_UDP_HEADER_SIZE = struct.calcsize(_UDP_HEADER_FMT)


def _dds_frame_to_binary(frame_id: int, num_points: int, point_data: bytes) -> bytes:
    """Convert raw DDS point data (N*16B: x,y,z,intensity float32) to pcd_binary format."""
    fields = ['x', 'y', 'z', 'intensity']
    meta   = json.dumps({
        'fields': fields,
        'npoints': num_points,
        'original_count': num_points,
        'file': f'dds_frame_{frame_id:06d}',
    }).encode()
    raw_off = 4 + len(meta)
    pad = (4 - raw_off % 4) % 4
    return struct.pack('<I', len(meta)) + meta + b'\x00' * pad + point_data[:num_points * 16]


def _process_dds_packet(data: bytes) -> None:
    global _dds_frame, _dds_frame_id, _dds_recv_count, _dds_last_ts
    if len(data) < _UDP_HEADER_SIZE:
        return
    magic, timestamp_ns, frame_id, num_points = struct.unpack(_UDP_HEADER_FMT, data[:_UDP_HEADER_SIZE])
    if magic != _UDP_MAGIC:
        return
    point_data = data[_UDP_HEADER_SIZE:]
    if len(point_data) < num_points * 16:
        return
    binary = _dds_frame_to_binary(frame_id, num_points, point_data)
    with _dds_lock:
        _dds_frame      = binary
        _dds_frame_id   = frame_id
        _dds_recv_count += 1
        _dds_last_ts    = time.time()


def _udp_listener_thread(port: int) -> None:
    global _dds_frame, _dds_frame_id, _dds_recv_count, _dds_last_ts
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 8 * 1024 * 1024)
    sock.bind(('0.0.0.0', port))
    sock.settimeout(1.0)
    print(f'[DDS] UDP listener started on port {port}', flush=True)
    reassembly: dict = {}  # total_len -> {slices: dict, total: int}
    while True:
        try:
            data, _addr = sock.recvfrom(65535)
        except socket.timeout:
            continue
        except Exception:
            continue

        # Single-packet frame: starts with magic bytes
        if len(data) >= _UDP_HEADER_SIZE and data[:4] == _UDP_MAGIC:
            _process_dds_packet(data)
            continue

        # Fragmented packet: [total_slices(2B) + slice_idx(2B) + total_len(4B)] + payload
        if len(data) >= 8:
            total_slices, slice_idx, total_len = struct.unpack('<HHI', data[:8])
            payload = data[8:]
            if total_len not in reassembly:
                reassembly[total_len] = {'slices': {}, 'total': total_slices}
            buf = reassembly[total_len]
            buf['slices'][slice_idx] = payload
            if len(buf['slices']) == buf['total']:
                full = b''.join(buf['slices'][i] for i in range(buf['total']))
                del reassembly[total_len]
                _process_dds_packet(full)


def start_udp_listener(port: int) -> None:
    """Start background UDP listener thread (idempotent — safe to call multiple times)."""
    t = threading.Thread(target=_udp_listener_thread, args=(port,), daemon=True)
    t.start()


def get_latest_frame(after_id: int = -1):
    """Return (frame_id, payload) if a new frame is available, else (frame_id, None)."""
    with _dds_lock:
        fid     = _dds_frame_id
        payload = _dds_frame if fid != after_id else None
    return fid, payload


def get_status() -> dict:
    with _dds_lock:
        return {
            'frame_id':   _dds_frame_id,
            'recv_count': _dds_recv_count,
            'age_ms':     round((time.time() - _dds_last_ts) * 1000) if _dds_last_ts > 0 else -1,
        }
