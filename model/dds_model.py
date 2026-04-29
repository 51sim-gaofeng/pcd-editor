"""DDS UDP receiver — receives live point cloud frames from render.py lidar_dds mode.

Protocol (single-packet frame):
  [magic(4B)='PC2\x00'][timestamp_ns(8B)][frame_id(4B)][num_points(4B)][N*16B: x,y,z,intensity float32]

Protocol (fragmented large frame):
  [total_slices(2B)][slice_idx(2B)][total_len(4B)][payload bytes]
  When all slices received, reassemble and process as a single-packet frame.

WS payload format pushed to frontend (compact, no JSON):
  [magic 'PCL2' (4B)][frame_id u32 LE (4B)][npoints u32 LE (4B)][t_store_ms u64 LE (8B)]
  followed by N * 16B float32 (x, y, z, intensity).
  Header is 20 bytes, kept 4-byte aligned so float view starts at offset 20.
  Fields are fixed for DDS live: ['x','y','z','intensity'].
"""
import socket
import struct
import threading
import time

import numpy as np
from websockets.exceptions import ConnectionClosed
from websockets.sync.server import serve

_dds_lock    = threading.Lock()
_dds_cond    = threading.Condition(_dds_lock)   # wraps _dds_lock; used for long-poll
_dds_frame: bytes = b''        # latest binary payload (same format as pcd_to_binary)
_dds_frame_id: int = -1        # monotonic counter for change detection
_dds_recv_count: int = 0       # total frames received
_dds_last_ts: float = 0.0      # time of last received frame
_dds_proc_ms_total: float = 0.0
_dds_ds_ms_total: float = 0.0
_dds_out_bytes_total: int = 0
_dds_bind_host: str = '127.0.0.1'
_dds_bind_port: int = 9870
_dds_last_src_host: str = ''     # IP of the most recent UDP sender
_dds_last_src_port: int = 0
_dds_running: bool = False
_dds_ws_bind_host: str = '127.0.0.1'
_dds_ws_bind_port: int = 8090
_dds_ws_running: bool = False
_dds_ws_client_count: int = 0
_dds_ws_sent_count: int = 0
_dds_ws_sent_bytes_total: int = 0
_dds_ws_send_ms_total: float = 0.0
_dds_ws_latency_ms_total: float = 0.0  # store->send latency (server side)

_listener_thread = None
_listener_stop_evt = None
_listener_sock = None
_ws_server_thread = None
_ws_server = None

_UDP_MAGIC       = b'PC2\x00'
_UDP_HEADER_FMT  = '<4sQII'    # magic(4B) + timestamp_ns(8B) + frame_id(4B) + num_points(4B)
_UDP_HEADER_SIZE = struct.calcsize(_UDP_HEADER_FMT)

# Frontend-facing WS payload header: magic + frame_id + npoints + t_store_ms (epoch ms).
_WS_MAGIC       = b'PCL2'
_WS_HEADER_FMT  = '<4sIIQ'
_WS_HEADER_SIZE = struct.calcsize(_WS_HEADER_FMT)  # 20 bytes, 4-byte aligned
_WS_HEADER_PACK = struct.Struct(_WS_HEADER_FMT).pack

_REASSEMBLY_TTL_SEC = 0.8      # drop incomplete fragmented frames older than this
_REASSEMBLY_MAX_FRAMES = 256   # hard cap for in-flight fragmented frames

# Max points sent to frontend per frame. Downsampled with uniform stride when exceeded.
# 60000 pts × 16B = ~0.9 MB → ~10+ fps on localhost.
_DDS_MAX_POINTS: int = 60_000


def _dds_frame_to_binary(frame_id: int, num_points: int, point_data: bytes,
                         t_store_ms: int) -> bytes:
    """Pack a DDS live frame into the compact WS payload format.

    Layout: [magic 'PCL2'(4)][frame_id u32 LE(4)][npoints u32 LE(4)][t_store_ms u64 LE(8)]
    followed by ``num_points * 16`` raw float32 bytes (x, y, z, intensity).
    """
    header = _WS_HEADER_PACK(_WS_MAGIC, frame_id & 0xFFFFFFFF, num_points, t_store_ms & 0xFFFFFFFFFFFFFFFF)
    return header + point_data[:num_points * 16]


def _process_dds_packet(data: bytes) -> None:
    global _dds_frame, _dds_frame_id, _dds_recv_count, _dds_last_ts
    global _dds_proc_ms_total, _dds_ds_ms_total, _dds_out_bytes_total
    t0 = time.perf_counter()
    if len(data) < _UDP_HEADER_SIZE:
        return
    magic, timestamp_ns, frame_id, num_points = struct.unpack(_UDP_HEADER_FMT, data[:_UDP_HEADER_SIZE])
    if magic != _UDP_MAGIC:
        return
    point_data = data[_UDP_HEADER_SIZE:]
    if len(point_data) < num_points * 16:
        return
    # Uniform-stride downsample when point count exceeds limit
    ds_ms = 0.0
    if num_points > _DDS_MAX_POINTS:
        ds_t0 = time.perf_counter()
        arr = np.frombuffer(point_data[:num_points * 16], dtype=np.float32).reshape(num_points, 4)
        stride = num_points // _DDS_MAX_POINTS
        arr = arr[::stride]
        num_points = len(arr)
        point_data = arr.tobytes()
        ds_ms = (time.perf_counter() - ds_t0) * 1000.0
    t_store_ms = int(time.time() * 1000)
    binary = _dds_frame_to_binary(frame_id, num_points, point_data, t_store_ms)
    proc_ms = (time.perf_counter() - t0) * 1000.0
    with _dds_cond:
        _dds_frame      = binary
        _dds_frame_id   = frame_id
        _dds_recv_count += 1
        _dds_last_ts    = time.time()
        _dds_proc_ms_total += proc_ms
        _dds_ds_ms_total += ds_ms
        _dds_out_bytes_total += len(binary)
        _dds_cond.notify_all()


def _is_multicast(ip: str) -> bool:
    try:
        first = int(ip.split('.', 1)[0])
        return 224 <= first <= 239
    except Exception:
        return False


def _is_broadcast(ip: str) -> bool:
    # Limited broadcast or directed broadcast (heuristic: ends with .255)
    if ip == '255.255.255.255':
        return True
    try:
        return ip.split('.')[-1] == '255'
    except Exception:
        return False


def _udp_listener_thread(host: str, port: int, stop_evt: threading.Event) -> None:
    global _dds_frame, _dds_frame_id, _dds_recv_count, _dds_last_ts
    global _listener_sock, _dds_running, _dds_bind_host, _dds_bind_port
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    # Large receive buffers reduce burst loss when fragmented UDP frames arrive back-to-back.
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 32 * 1024 * 1024)
    # Allow multiple receivers on same port (e.g. coexist with the publisher or other tools).
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    except Exception:
        pass
    if hasattr(socket, 'SO_REUSEPORT'):
        try:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
        except Exception:
            pass
    # Enable broadcast reception (required on some platforms even for receive).
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    except Exception:
        pass

    is_mcast = _is_multicast(host)
    is_bcast = _is_broadcast(host)
    # On Windows, sockets cannot bind to a multicast/broadcast address; bind to ANY (0.0.0.0)
    # and rely on multicast group membership / SO_BROADCAST instead.
    bind_addr = '0.0.0.0' if (is_mcast or is_bcast) else host
    try:
        sock.bind((bind_addr, port))
    except Exception as e:
        print(f'[DDS] UDP listener bind failed on {bind_addr}:{port} (requested {host}): {e}', flush=True)
        with _dds_lock:
            _dds_running = False
        return

    if is_mcast:
        try:
            mreq = struct.pack('=4sl', socket.inet_aton(host), socket.INADDR_ANY)
            sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
            print(f'[DDS] joined multicast group {host}', flush=True)
        except Exception as e:
            print(f'[DDS] multicast join failed for {host}: {e}', flush=True)

    sock.settimeout(0.5)
    with _dds_lock:
        _listener_sock = sock
        _dds_running = True
        _dds_bind_host = host
        _dds_bind_port = port
    mode = 'multicast' if is_mcast else ('broadcast' if is_bcast else 'unicast')
    print(f'[DDS] UDP listener started on {bind_addr}:{port} ({mode}={host})', flush=True)
    reassembly: dict = {}  # (addr,total_len,total_slices) -> {slices: dict, total: int, ts: float}
    last_gc = time.time()
    while not stop_evt.is_set():
        try:
            data, _addr = sock.recvfrom(65535)
        except socket.timeout:
            continue
        except Exception:
            continue

        # Track latest sender so the UI can reflect the actual broadcaster's IP.
        if _addr:
            global _dds_last_src_host, _dds_last_src_port
            with _dds_lock:
                _dds_last_src_host = _addr[0]
                _dds_last_src_port = int(_addr[1]) if len(_addr) > 1 else 0

        # Single-packet frame: starts with magic bytes
        if len(data) >= _UDP_HEADER_SIZE and data[:4] == _UDP_MAGIC:
            _process_dds_packet(data)
            continue

        # Fragmented packet: [total_slices(2B) + slice_idx(2B) + total_len(4B)] + payload
        if len(data) >= 8:
            total_slices, slice_idx, total_len = struct.unpack('<HHI', data[:8])
            payload = data[8:]
            now = time.time()
            if now - last_gc >= 0.25:
                # Remove stale/incomplete fragmented frames to avoid long-run memory growth.
                stale = [k for k, v in reassembly.items() if (now - v['ts']) > _REASSEMBLY_TTL_SEC]
                for k in stale:
                    del reassembly[k]
                # Hard-cap in-flight reassembly frames (drop oldest first).
                if len(reassembly) > _REASSEMBLY_MAX_FRAMES:
                    oldest = sorted(reassembly.items(), key=lambda kv: kv[1]['ts'])[:len(reassembly) - _REASSEMBLY_MAX_FRAMES]
                    for k, _ in oldest:
                        del reassembly[k]
                last_gc = now

            key = (_addr, total_len, total_slices)
            if key not in reassembly:
                reassembly[key] = {'slices': {}, 'total': total_slices, 'ts': now}
            buf = reassembly[key]
            buf['ts'] = now
            buf['slices'][slice_idx] = payload
            if len(buf['slices']) == buf['total']:
                full = b''.join(buf['slices'][i] for i in range(buf['total']))
                del reassembly[key]
                _process_dds_packet(full)
    try:
        sock.close()
    except Exception:
        pass
    with _dds_lock:
        if _listener_sock is sock:
            _listener_sock = None
        _dds_running = False


def _fps_reporter_thread() -> None:
    """Print receive frame rate to console every second."""
    prev_count = 0
    prev_t = time.time()
    prev_proc_ms = 0.0
    prev_ds_ms = 0.0
    prev_out_bytes = 0
    prev_ws_sent_count = 0
    prev_ws_sent_bytes = 0
    prev_ws_send_ms = 0.0
    prev_ws_latency_ms = 0.0
    while True:
        time.sleep(1.0)
        with _dds_lock:
            cur_count = _dds_recv_count
            cur_fid   = _dds_frame_id
            age_ms    = round((time.time() - _dds_last_ts) * 1000) if _dds_last_ts > 0 else -1
            cur_proc_ms = _dds_proc_ms_total
            cur_ds_ms = _dds_ds_ms_total
            cur_out_bytes = _dds_out_bytes_total
            cur_ws_clients = _dds_ws_client_count
            cur_ws_sent_count = _dds_ws_sent_count
            cur_ws_sent_bytes = _dds_ws_sent_bytes_total
            cur_ws_send_ms = _dds_ws_send_ms_total
            cur_ws_latency_ms = _dds_ws_latency_ms_total
        delta = cur_count - prev_count
        now = time.time()
        dt = now - prev_t
        fps = delta / dt if dt > 0 else 0.0
        proc_delta = cur_proc_ms - prev_proc_ms
        ds_delta = cur_ds_ms - prev_ds_ms
        out_delta = cur_out_bytes - prev_out_bytes
        avg_proc_ms = (proc_delta / delta) if delta > 0 else 0.0
        avg_ds_ms = (ds_delta / delta) if delta > 0 else 0.0
        out_mbps = (out_delta / dt) / (1024 * 1024) if dt > 0 else 0.0
        ws_sent_delta = cur_ws_sent_count - prev_ws_sent_count
        ws_sent_bytes_delta = cur_ws_sent_bytes - prev_ws_sent_bytes
        ws_send_ms_delta = cur_ws_send_ms - prev_ws_send_ms
        ws_latency_ms_delta = cur_ws_latency_ms - prev_ws_latency_ms
        ws_send_fps = ws_sent_delta / dt if dt > 0 else 0.0
        ws_out_mbps = (ws_sent_bytes_delta / dt) / (1024 * 1024) if dt > 0 else 0.0
        avg_ws_send_ms = (ws_send_ms_delta / ws_sent_delta) if ws_sent_delta > 0 else 0.0
        avg_ws_latency_ms = (ws_latency_ms_delta / ws_sent_delta) if ws_sent_delta > 0 else 0.0
        prev_count = cur_count
        prev_t = now
        prev_proc_ms = cur_proc_ms
        prev_ds_ms = cur_ds_ms
        prev_out_bytes = cur_out_bytes
        prev_ws_sent_count = cur_ws_sent_count
        prev_ws_sent_bytes = cur_ws_sent_bytes
        prev_ws_send_ms = cur_ws_send_ms
        prev_ws_latency_ms = cur_ws_latency_ms
        if cur_fid >= 0:
            print(
                f'[DDS] recv {fps:.1f} fps  |  total {cur_count} frames  |  last frame #{cur_fid}  |  age {age_ms} ms'
                f'  |  proc {avg_proc_ms:.2f} ms/frame  |  downsample {avg_ds_ms:.2f} ms/frame  |  out {out_mbps:.2f} MiB/s',
                flush=True,
            )
            print(
                f'[DDS][WS] clients {cur_ws_clients}  |  sent {ws_send_fps:.1f} fps  |  avg send {avg_ws_send_ms:.2f} ms/msg'
                f'  |  store->send {avg_ws_latency_ms:.2f} ms  |  out {ws_out_mbps:.2f} MiB/s',
                flush=True,
            )
            if age_ms >= 500 and fps < 5.0:
                print('[DDS] warning: upstream feed appears stalled or bursty (high age, low recv fps)', flush=True)


def _ws_client_handler(websocket) -> None:
    global _dds_ws_client_count, _dds_ws_sent_count, _dds_ws_sent_bytes_total
    global _dds_ws_send_ms_total, _dds_ws_latency_ms_total
    with _dds_lock:
        _dds_ws_client_count += 1
    # Bump TCP send buffer so a 3 MB frame fits in one syscall and never blocks
    # waiting for kernel-side ACKs on localhost. Best-effort; ignore failures.
    try:
        sock = websocket.socket
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 8 * 1024 * 1024)
    except Exception:
        pass
    print('[DDS][WS] client connected', flush=True)
    last_sent_id = -1
    try:
        while True:
            fid, payload = get_latest_frame_blocking(last_sent_id, timeout=1.0)
            if payload is None:
                continue
            # Header layout: 4B magic | 4B frame_id | 4B npoints | 8B t_store_ms
            t_store_ms = struct.unpack_from('<Q', payload, 12)[0] if len(payload) >= _WS_HEADER_SIZE else 0
            store_age_ms = max(0.0, time.time() * 1000.0 - t_store_ms) if t_store_ms else 0.0
            t0 = time.perf_counter()
            websocket.send(payload)
            send_ms = (time.perf_counter() - t0) * 1000.0
            last_sent_id = fid
            with _dds_lock:
                _dds_ws_sent_count += 1
                _dds_ws_sent_bytes_total += len(payload)
                _dds_ws_send_ms_total += send_ms
                _dds_ws_latency_ms_total += store_age_ms
    except ConnectionClosed:
        pass
    except Exception as e:
        print(f'[DDS][WS] client handler error: {e}', flush=True)
    finally:
        with _dds_lock:
            _dds_ws_client_count = max(0, _dds_ws_client_count - 1)
        print('[DDS][WS] client disconnected', flush=True)


def _ws_server_thread_fn(host: str, port: int) -> None:
    global _ws_server, _dds_ws_running, _dds_ws_bind_host, _dds_ws_bind_port
    try:
        # compression=None: deflate of 3MB binary frames is the dominant cost on
        # localhost (10x slower than the actual TCP write). max_size=None lifts the
        # 1MB inbound limit. ping_interval=None avoids extra control frames in the
        # send queue while we're streaming.
        with serve(
            _ws_client_handler,
            host,
            port,
            max_size=None,
            compression=None,
            ping_interval=None,
        ) as server:
            with _dds_lock:
                _ws_server = server
                _dds_ws_running = True
                _dds_ws_bind_host = host
                _dds_ws_bind_port = port
            print(f'[DDS][WS] server started on {host}:{port}', flush=True)
            server.serve_forever()
    except Exception as e:
        print(f'[DDS][WS] server failed on {host}:{port}: {e}', flush=True)
    finally:
        with _dds_lock:
            _ws_server = None
            _dds_ws_running = False


def stop_ws_server() -> None:
    global _ws_server_thread, _ws_server
    with _dds_lock:
        server = _ws_server
        thread = _ws_server_thread
    if server is not None:
        try:
            server.shutdown()
        except Exception:
            pass
    if thread is not None:
        thread.join(timeout=1.0)
    with _dds_lock:
        _ws_server = None
        _ws_server_thread = None


def start_ws_server(port: int, host: str = '127.0.0.1') -> None:
    global _ws_server_thread
    stop_ws_server()
    t = threading.Thread(target=_ws_server_thread_fn, args=(host, port), daemon=True)
    with _dds_lock:
        _ws_server_thread = t
    t.start()


def set_max_live_points(n: int) -> None:
    """Adjust the downsampling limit at runtime."""
    global _DDS_MAX_POINTS
    _DDS_MAX_POINTS = max(1000, n)


def stop_udp_listener() -> None:
    """Stop UDP listener thread if running."""
    global _listener_thread, _listener_stop_evt, _listener_sock
    with _dds_lock:
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
    with _dds_lock:
        _listener_thread = None
        _listener_stop_evt = None
        _listener_sock = None


def start_udp_listener(port: int, host: str = '127.0.0.1') -> None:
    """Start UDP listener; if already running, restart on new host/port."""
    global _listener_thread, _listener_stop_evt
    stop_udp_listener()
    evt = threading.Event()
    t = threading.Thread(target=_udp_listener_thread, args=(host, port, evt), daemon=True)
    with _dds_lock:
        _listener_stop_evt = evt
        _listener_thread = t
    t.start()
    # Start FPS reporter once per process.
    if not getattr(start_udp_listener, '_fps_started', False):
        r = threading.Thread(target=_fps_reporter_thread, daemon=True)
        r.start()
        start_udp_listener._fps_started = True


def ensure_dds_started(udp_port: int, udp_host: str, ws_port: int, ws_host: str) -> dict:
    """Idempotently start UDP listener + WS server. Safe to call repeatedly.
    UDP and WS are tracked independently so user-triggered rebinds aren't reset.
    """
    if not getattr(ensure_dds_started, '_udp_started', False):
        start_udp_listener(udp_port, udp_host)
        ensure_dds_started._udp_started = True
    if not getattr(ensure_dds_started, '_ws_started', False):
        start_ws_server(ws_port, ws_host)
        ensure_dds_started._ws_started = True
    return {
        'started': True,
        'udp': {'host': udp_host, 'port': udp_port},
        'ws': {'host': ws_host, 'port': ws_port},
    }


def rebind_udp_listener(host: str, port: int) -> dict:
    """Rebind DDS receiver to the given host/port and return current bind status."""
    start_udp_listener(port=port, host=host)
    ensure_dds_started._udp_started = True
    return get_receiver_config()


def get_receiver_config() -> dict:
    with _dds_lock:
        return {
            'host': _dds_bind_host,
            'port': _dds_bind_port,
            'running': _dds_running,
            'src_host': _dds_last_src_host,
            'src_port': _dds_last_src_port,
        }


def get_stream_config() -> dict:
    with _dds_lock:
        return {
            'host': _dds_ws_bind_host,
            'port': _dds_ws_bind_port,
            'running': _dds_ws_running,
            'clients': _dds_ws_client_count,
            'sent_count': _dds_ws_sent_count,
        }


def get_latest_frame(after_id: int = -1):
    """Return (frame_id, payload) if a new frame is available, else (frame_id, None)."""
    with _dds_lock:
        fid     = _dds_frame_id
        payload = _dds_frame if fid != after_id else None
    return fid, payload


def get_latest_frame_blocking(after_id: int = -1, timeout: float = 2.0):
    """Block until a frame newer than after_id arrives (or timeout). Returns (frame_id, payload|None)."""
    with _dds_cond:
        if _dds_frame_id != after_id:
            return _dds_frame_id, _dds_frame
        _dds_cond.wait(timeout=timeout)
        if _dds_frame_id != after_id:
            return _dds_frame_id, _dds_frame
        return _dds_frame_id, None


def get_status() -> dict:
    with _dds_lock:
        return {
            'frame_id':   _dds_frame_id,
            'recv_count': _dds_recv_count,
            'age_ms':     round((time.time() - _dds_last_ts) * 1000) if _dds_last_ts > 0 else -1,
            'receiver': {
                'host': _dds_bind_host,
                'port': _dds_bind_port,
                'running': _dds_running,
                'src_host': _dds_last_src_host,
                'src_port': _dds_last_src_port,
            },
            'stream': {
                'host': _dds_ws_bind_host,
                'port': _dds_ws_bind_port,
                'running': _dds_ws_running,
                'clients': _dds_ws_client_count,
                'sent_count': _dds_ws_sent_count,
            },
        }
