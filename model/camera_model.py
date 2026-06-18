"""GVSP UDP camera frame receiver.

Receives JPEG frames packaged in GVSP protocol (EI=1 mode, 20-byte header).
Compatible with the send_frame_via_gvsp() sender in utils/common/udp_utils.py.

Frame structure per block:
  pkt_id 0:    Leader  — 20B GVSP header + 32B image meta
  pkt_id 1..N: Payload — 20B GVSP header + ≤1480B JPEG data
  pkt_id N+1:  Trailer — 20B GVSP header + 4B end marker

20-byte EI=1 GVSP header (big-endian):
  status(H) flag(H) ei_and_pf(B) reserved(B) pkt_id_reserved(H)
  block_id_high(I) block_id_low(I) packet_id32(I)

  ei_and_pf bits 4-7 = packet_format: LEADER=0x1, PAYLOAD=0x3, TRAILER=0x2
"""
import socket
import struct
import threading
import time

_HDR_FMT  = '>HHBBHIII'
_HDR_SIZE = struct.calcsize(_HDR_FMT)  # 20 bytes

_FMT_LEADER  = 0x01
_FMT_PAYLOAD = 0x03
_FMT_TRAILER = 0x02

_LEADER_META_FMT  = '>BBHIIIIIII'
_LEADER_META_SIZE = struct.calcsize(_LEADER_META_FMT)  # 32 bytes

_cam_lock = threading.Lock()
_cam_cond = threading.Condition(_cam_lock)

_cam_jpeg: bytes = b''
_cam_frame_id: int = -1
_cam_recv_count: int = 0
_cam_last_ts: float = 0.0
_cam_bind_host: str = '127.0.0.1'
_cam_bind_port: int = 13956
_cam_running: bool = False

_listener_thread = None
_listener_stop_evt = None
_listener_sock = None

# Per-block reassembly: block_id -> {'payloads': {pkt_id: bytes}, 'ts': float}
_reassembly: dict = {}
_reassembly_lock = threading.Lock()
_REASSEMBLY_TTL = 1.0
_REASSEMBLY_MAX = 32


def _gc_reassembly(now: float) -> None:
    """Evict stale/excess reassembly buffers. Must be called with _reassembly_lock held."""
    stale = [k for k, v in _reassembly.items() if now - v['ts'] > _REASSEMBLY_TTL]
    for k in stale:
        del _reassembly[k]
    while len(_reassembly) > _REASSEMBLY_MAX:
        oldest = min(_reassembly, key=lambda k: _reassembly[k]['ts'])
        del _reassembly[oldest]


def _format_bind_error(host: str, port: int, err: Exception) -> str:
    msg = f'UDP bind failed on {host}:{port}: {err}'
    if isinstance(err, OSError) and getattr(err, 'winerror', None) in (10013, 10048):
        msg += ' (port may already be in use by another process)'
    return msg


def _process_gvsp_packet(data: bytes) -> None:
    """Parse one GVSP UDP packet and store completed JPEG when all pieces arrive."""
    if len(data) < _HDR_SIZE:
        return
    now = time.monotonic()
    _, _, ei_and_pf, _, _, blk_high, blk_low, pkt_id = struct.unpack(_HDR_FMT, data[:_HDR_SIZE])
    block_id = (blk_high << 32) | blk_low
    pkt_fmt = (ei_and_pf >> 4) & 0x0F
    after_hdr = data[_HDR_SIZE:]

    jpeg_ready = None
    with _reassembly_lock:
        if pkt_fmt == _FMT_LEADER:
            _reassembly[block_id] = {'payloads': {}, 'ts': now}
            _gc_reassembly(now)

        elif pkt_fmt == _FMT_PAYLOAD:
            if block_id in _reassembly:
                _reassembly[block_id]['payloads'][pkt_id] = after_hdr
                _reassembly[block_id]['ts'] = now

        elif pkt_fmt == _FMT_TRAILER:
            buf = _reassembly.pop(block_id, None)
            if buf and buf['payloads']:
                payloads = buf['payloads']
                jpeg_ready = b''.join(
                    chunk for part_id in range(1, pkt_id)
                    if (chunk := payloads.get(part_id)) is not None
                )

    if jpeg_ready:
        with _cam_cond:
            global _cam_jpeg, _cam_frame_id, _cam_recv_count, _cam_last_ts
            _cam_jpeg = jpeg_ready
            _cam_frame_id += 1
            _cam_recv_count += 1
            _cam_last_ts = time.time()
            _cam_cond.notify_all()


def _udp_listener_thread(
    host: str,
    port: int,
    stop_evt: threading.Event,
    startup_evt: threading.Event,
    startup_state: dict,
) -> None:
    global _listener_sock, _cam_running, _cam_bind_host, _cam_bind_port
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 16 * 1024 * 1024)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    except Exception:
        pass
    sock.settimeout(0.5)
    try:
        sock.bind((host, port))
    except Exception as e:
        startup_state['error'] = _format_bind_error(host, port, e)
        print(f'[CAM] {startup_state["error"]}', flush=True)
        with _cam_lock:
            _cam_running = False
        startup_evt.set()
        return
    with _cam_lock:
        _listener_sock = sock
        _cam_running = True
        _cam_bind_host = host
        _cam_bind_port = port
    startup_state['ok'] = True
    startup_evt.set()
    print(f'[CAM] UDP listener started on {host}:{port}', flush=True)
    while not stop_evt.is_set():
        try:
            data, _ = sock.recvfrom(65535)
        except socket.timeout:
            continue
        except Exception:
            continue
        _process_gvsp_packet(data)
    try:
        sock.close()
    except Exception:
        pass
    with _cam_lock:
        if _listener_sock is sock:
            _listener_sock = None
        _cam_running = False
    print('[CAM] UDP listener stopped', flush=True)


def stop_udp_listener() -> None:
    global _listener_thread, _listener_stop_evt, _listener_sock
    with _cam_lock:
        t = _listener_thread
        evt = _listener_stop_evt
        sock = _listener_sock
    if evt is not None:
        evt.set()
    if sock is not None:
        try:
            sock.close()
        except Exception:
            pass
    if t is not None:
        t.join(timeout=1.0)
    with _cam_lock:
        _listener_thread = None
        _listener_stop_evt = None
        _listener_sock = None


def start_udp_listener(port: int, host: str = '127.0.0.1') -> None:
    """Start (or restart) the GVSP UDP listener on the given port."""
    global _listener_thread, _listener_stop_evt
    stop_udp_listener()
    evt = threading.Event()
    startup_evt = threading.Event()
    startup_state = {}
    t = threading.Thread(
        target=_udp_listener_thread,
        args=(host, port, evt, startup_evt, startup_state),
        daemon=True,
    )
    with _cam_lock:
        _listener_stop_evt = evt
        _listener_thread = t
    t.start()
    startup_evt.wait(timeout=1.0)
    if startup_state.get('error'):
        with _cam_lock:
            if _listener_thread is t:
                _listener_thread = None
            if _listener_stop_evt is evt:
                _listener_stop_evt = None
        raise OSError(startup_state['error'])


def get_latest_frame_blocking(after_id: int, timeout: float = 2.0):
    """Block until frame_id > after_id. Returns (fid, jpeg_bytes) or (fid, None) on timeout."""
    deadline = time.monotonic() + timeout
    with _cam_cond:
        while _cam_frame_id <= after_id:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return _cam_frame_id, None
            _cam_cond.wait(timeout=min(remaining, 0.5))
        return _cam_frame_id, _cam_jpeg


def get_status() -> dict:
    with _cam_lock:
        age_ms = round((time.time() - _cam_last_ts) * 1000) if _cam_last_ts > 0 else -1
        return {
            'running': _cam_running,
            'host': _cam_bind_host,
            'port': _cam_bind_port,
            'recv_count': _cam_recv_count,
            'frame_id': _cam_frame_id,
            'age_ms': age_ms,
        }


def rebind(host: str, port: int) -> dict:
    """Rebind UDP listener to a new host/port."""
    start_udp_listener(port=port, host=host)
    return get_status()
