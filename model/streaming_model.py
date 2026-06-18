"""SimOne Streaming Point Cloud UDP receiver.

Receives live point cloud frames from the SimOne simulator's streaming lidar output.
Implements the same protocol as SimOneAPI::GetStreamingPointCloud:
  - MSOP socket (port, default 6699): receives raw lidar scan packets (SimOneMsopPkt)
  - DIFOP socket (infoPort, default 7788): receives calibration packets (SimOneDifopPkt)

Supports SimOne's proprietary lidar format (SimOneDefault) with automatic angle
calibration from DIFOP packets.  RSM1 / HesaiP128 / HesaiAT128 raw packets are
captured but currently passed through without decoding.

Decoded frames are stored in module-level state and served to the frontend via the
HTTP long-poll endpoint /api/streaming_frame (binary PCL2 format, identical to the
format dds_model pushes over WebSocket).
"""
from __future__ import annotations

import socket
import struct
import threading
import time

import numpy as np

# ── SimOne lidar protocol constants ──────────────────────────────────────────
_MSOP_ID_BYTES  = struct.pack('<Q', 0xA050A55A0A05AA55)
_DIFOP_ID_BYTES = struct.pack('<Q', 0x555511115A00FFA5)

_PKT_SIZE_DEFAULT  = 1248
_PKT_SIZE_RSM1     = 1210
_PKT_SIZE_HESAI_P128   = 871
_PKT_SIZE_HESAI_AT128  = 603

_FLAG_END = 2   # FramFALG::END_FLAG

_LIDAR_TYPE_NONE         = 0
_LIDAR_TYPE_SIM_DEFAULT  = 1
_LIDAR_TYPE_RSM1         = 2
_LIDAR_TYPE_HESAI_P128   = 3
_LIDAR_TYPE_HESAI_AT128  = 4

_RESOLUTION_5MM = 0.005   # metres per distance unit

_BLOCKS_PER_PKT     = 12
_CHANNELS_PER_BLOCK = 32
_HEADER_SIZE        = 42  # SimMsopHeader
_BLOCK_SIZE         = 100 # 2(id) + 2(azimuth) + 32*3 bytes
_MAXPOINT_IN_BLOCK  = 14  # customised lidar (mLidarModel=0x51)
_MSOP_POINT_SIZE    = 7   # SimOneMSOPPoint: 2+2+2+1

# SimMsopHeader field offsets (packed)
_HDR_OFF_ID          = 0   # uint64_t
_HDR_OFF_PKT_FLAG    = 8   # uint16_t (FramFALG)
_HDR_OFF_PKT_ID      = 10  # uint16_t
_HDR_OFF_LIDAR_MODEL = 30  # uint8_t

# SimOneDifopPkt field offsets (packed, total 1248 bytes)
_DIFOP_OFF_PITCH_LOW  = 468   # uint8_t[96]
_DIFOP_OFF_PITCH_HIGH = 660   # uint8_t[288]
_DIFOP_OFF_LIDAR_RING = 1236  # uint16_t

# Precomputed sine/cosine lookup tables (indexed by 0.01-degree units)
_lut_idx  = np.arange(36000, dtype=np.float64)
_cos_lut  = np.cos(np.radians(_lut_idx / 100.0)).astype(np.float32)
_sin_lut  = np.sin(np.radians(_lut_idx / 100.0)).astype(np.float32)
del _lut_idx

# ── Module-level state ────────────────────────────────────────────────────────
_sm_lock  = threading.Lock()
_sm_cond  = threading.Condition(_sm_lock)

_sm_frame: bytes  = b''
_sm_frame_id: int = -1
_sm_recv_count: int  = 0
_sm_last_ts: float   = 0.0
_sm_proc_ms_total: float = 0.0
_sm_ds_ms_total: float   = 0.0
_sm_out_bytes_total: int = 0

_sm_bind_host: str  = '127.0.0.1'
_sm_bind_port: int  = 6699
_sm_info_port: int  = 7788
_sm_last_src_host: str = ''
_sm_last_src_port: int  = 0
_sm_running: bool   = False

_sm_vert_angles: np.ndarray = np.empty(0, dtype=np.float32)
_sm_channels: int = 64
_sm_difop_lock = threading.Lock()

_listener_thread      = None
_listener_stop_evt    = None
_listener_sock        = None
_difop_thread         = None
_difop_stop_evt       = None
_difop_sock           = None

# WS output header format (must match dds_model PCL2)
_WS_MAGIC       = b'PCL2'
_WS_HEADER_FMT  = '<4sIIQ'
_WS_HEADER_SIZE = struct.calcsize(_WS_HEADER_FMT)  # 20 bytes
_WS_HEADER_PACK = struct.Struct(_WS_HEADER_FMT).pack

_SM_MAX_POINTS: int = 60_000


# ── Precomputed packet index arrays ──────────────────────────────────────────
# Block start byte offsets within one MSOP packet (12 blocks).
_blk_starts = (_HEADER_SIZE + np.arange(_BLOCKS_PER_PKT, dtype=np.int32) * _BLOCK_SIZE)

# Standard lidar: per-(block, channel) byte offsets for dist_hi, +1=dist_lo, +2=inten.
# Shape (12, 32); reused every packet so precomputed once.
_ch_base = (
    _blk_starts[:, None] + 4
    + np.arange(_CHANNELS_PER_BLOCK, dtype=np.int32)[None, :] * 3
)
_ch_range = np.arange(_CHANNELS_PER_BLOCK, dtype=np.int32)   # [0..31]
_blk_range = np.arange(_BLOCKS_PER_PKT,    dtype=np.int32)   # [0..11]

# Custom lidar (mLidarModel=0x51): per-(block, point) absolute byte offsets.
# Each block: 2-byte mFlag then 14 × 7-byte SimOneMSOPPoint.
_custom_pt_offsets = 2 + np.arange(_MAXPOINT_IN_BLOCK, dtype=np.int32) * _MSOP_POINT_SIZE
_custom_abs = _blk_starts[:, None] + _custom_pt_offsets[None, :]  # (12, 14)


# ── DIFOP decoder ─────────────────────────────────────────────────────────────

def _parse_difop(data: bytes) -> None:
    """Parse a DIFOP calibration packet and update _sm_vert_angles."""
    global _sm_vert_angles, _sm_channels
    if len(data) < 1248:
        return
    if data[:8] != _DIFOP_ID_BYTES:
        return

    # lidarRing tells us how many channels
    lidar_ring, = struct.unpack_from('<H', data, _DIFOP_OFF_LIDAR_RING)
    n_ch = int(lidar_ring) if lidar_ring > 0 else 64

    # p_ver_cali = pitch_cali_low[96] + pitch_cali_high[288] = 384 bytes total
    pitch_low  = data[_DIFOP_OFF_PITCH_LOW  : _DIFOP_OFF_PITCH_LOW  + 96]
    pitch_high = data[_DIFOP_OFF_PITCH_HIGH : _DIFOP_OFF_PITCH_HIGH + 288]
    p_ver_cali = pitch_low + pitch_high  # 384 bytes, max 128 channels * 3

    n_ch = min(n_ch, len(p_ver_cali) // 3)
    # Vectorized calibration decode (sign, mid, msb triplets).
    cali = np.frombuffer(p_ver_cali[:n_ch * 3], dtype=np.uint8).reshape(n_ch, 3)
    sign_f = np.where(cali[:, 0] == 0, np.int32(1), np.int32(-1))
    # Result is in 0.01-degree units (same as lookup table index)
    angles = ((cali[:, 1].astype(np.int32) * 256 + cali[:, 2].astype(np.int32))
              * sign_f).astype(np.float32) * 0.1

    with _sm_difop_lock:
        _sm_vert_angles = angles
        _sm_channels    = n_ch
    print(f'[Streaming] DIFOP calibration updated: {n_ch} channels', flush=True)


# ── MSOP packet decoder ───────────────────────────────────────────────────────

def _decode_packets_default(packets: list[bytes]) -> tuple[np.ndarray, int]:
    """Decode a list of SimOneDefault MSOP packets into XYZI float32 points.

    Returns (points_array [N,4], 0).  Fully vectorised with NumPy — no Python
    per-point loops.  ~10-50× faster than the previous scalar implementation.
    """
    with _sm_difop_lock:
        vert_angles = _sm_vert_angles.copy()
        n_channels  = _sm_channels

    # Do not bail early when vert_angles is empty: custom lidars (mLidarModel=0x51)
    # embed azimuth/zenith per-point and don't need DIFOP calibration.
    # For standard lidars, the ch_global bounds-check below skips all channels.
    cnt_block = max(1, (n_channels + _CHANNELS_PER_BLOCK - 1) // _CHANNELS_PER_BLOCK)
    n_vert = len(vert_angles)

    # Pre-convert calibration angles to int32 LUT indices once (not per point).
    if n_vert > 0:
        vert_lut = np.mod(vert_angles.astype(np.int32), 36000)  # (n_ch,)
    else:
        vert_lut = np.empty(0, dtype=np.int32)

    n_pkts = len(packets)
    # Pre-allocate output for the whole scan (upper bound: every channel valid).
    max_pts = n_pkts * _BLOCKS_PER_PKT * _CHANNELS_PER_BLOCK
    result = np.empty((max_pts, 4), dtype=np.float32)
    out_idx = 0

    for pkt_idx, pkt_data in enumerate(packets):
        if len(pkt_data) < _PKT_SIZE_DEFAULT:
            continue

        lidar_model = pkt_data[_HDR_OFF_LIDAR_MODEL]
        is_custom   = (lidar_model == 0x51)

        # Zero-copy uint8 view of the packet bytes.
        pkt = np.frombuffer(pkt_data, dtype=np.uint8)

        if is_custom:
            # ── Vectorised custom lidar decode ────────────────────────────────
            # _custom_abs: (12, 14) absolute byte offsets of each point's dist byte.
            # SimOneMSOPPoint: dist(2)+azim(2)+zeni(2)+inten(1) = 7 bytes
            dist_raw = ((pkt[_custom_abs    ].astype(np.int32) << 8)
                        | pkt[_custom_abs + 1].astype(np.int32))   # (12, 14)
            azim_raw = ((pkt[_custom_abs + 2].astype(np.int32) << 8)
                        | pkt[_custom_abs + 3].astype(np.int32))
            zeni_raw = ((pkt[_custom_abs + 4].astype(np.int32) << 8)
                        | pkt[_custom_abs + 5].astype(np.int32))
            inten    = pkt[_custom_abs + 6]                        # (12, 14) uint8

            valid   = dist_raw > 0
            vb, vp  = np.where(valid)
            if len(vb) == 0:
                continue

            dist_m = dist_raw[vb, vp].astype(np.float32) * _RESOLUTION_5MM
            azim_v = ((azim_raw[vb, vp] + 36000) % 36000).astype(np.int32)
            vert_v = ((zeni_raw[vb, vp] - 9000 + 36000) % 36000).astype(np.int32)
            inten_f = inten[vb, vp].astype(np.float32) * (1.0 / 255.0)

        else:
            # ── Vectorised standard SimOneDefault decode ──────────────────────
            # Azimuth: big-endian uint16 at blk_start+2  →  (12,)
            azim_raw = ((pkt[_blk_starts + 2].astype(np.int32) << 8)
                        | pkt[_blk_starts + 3].astype(np.int32))
            azim_blk = (azim_raw + 36000) % 36000  # (12,) centidegrees in LUT

            # Distance (big-endian) and intensity for all (block, channel) → (12, 32)
            dist_raw = ((pkt[_ch_base    ].astype(np.int32) << 8)
                        | pkt[_ch_base + 1].astype(np.int32))
            inten    = pkt[_ch_base + 2]            # (12, 32) uint8

            # Channel group per block — wraps at cnt_block.
            global_blk = pkt_idx * _BLOCKS_PER_PKT + _blk_range  # (12,)
            ch_group   = global_blk % cnt_block                    # (12,)

            # Absolute channel index for each (block, channel) → (12, 32)
            ch_global = ch_group[:, None] * _CHANNELS_PER_BLOCK + _ch_range[None, :]

            # Valid: non-zero distance and within calibration table bounds.
            valid   = (dist_raw > 0) & (ch_global < n_vert)       # (12, 32)
            vb, vc  = np.where(valid)
            if len(vb) == 0:
                continue

            dist_m  = dist_raw[vb, vc].astype(np.float32) * _RESOLUTION_5MM
            azim_v  = azim_blk[vb].astype(np.int32)               # (N,)
            vert_v  = vert_lut[ch_global[vb, vc]]                  # (N,) already int32
            inten_f = inten[vb, vc].astype(np.float32) * (1.0 / 255.0)

        # ── Polar → Cartesian via LUT (shared for both lidar types) ──────────
        cos_v = _cos_lut[vert_v]; sin_v = _sin_lut[vert_v]
        cos_a = _cos_lut[azim_v]; sin_a = _sin_lut[azim_v]
        x =  dist_m * cos_v * cos_a
        y = -dist_m * cos_v * sin_a
        z =  dist_m * sin_v

        n_valid = len(vb)
        end_idx = out_idx + n_valid
        if end_idx > max_pts:
            # Shouldn't normally happen; grow buffer.
            result = np.vstack([result[:out_idx],
                                 np.empty((n_valid, 4), dtype=np.float32)])
            max_pts = len(result)
        result[out_idx:end_idx, 0] = x
        result[out_idx:end_idx, 1] = y
        result[out_idx:end_idx, 2] = z
        result[out_idx:end_idx, 3] = inten_f
        out_idx = end_idx

    if out_idx == 0:
        return np.empty((0, 4), dtype=np.float32), 0
    return result[:out_idx], 0


# ── WS payload formatter ──────────────────────────────────────────────────────

def _sm_frame_to_binary(frame_id: int, points: np.ndarray,
                         t_store_ms: int) -> bytes:
    num_points = len(points)
    header = _WS_HEADER_PACK(_WS_MAGIC,
                              frame_id & 0xFFFFFFFF,
                              num_points,
                              t_store_ms & 0xFFFFFFFFFFFFFFFF)
    return header + points.tobytes()


def _store_frame(points: np.ndarray, frame_id: int) -> None:
    """Downsample, pack and store a decoded frame; notify WS clients."""
    global _sm_frame, _sm_frame_id, _sm_recv_count, _sm_last_ts
    global _sm_proc_ms_total, _sm_ds_ms_total, _sm_out_bytes_total

    t0 = time.perf_counter()
    n = len(points)
    ds_ms = 0.0
    if n > _SM_MAX_POINTS:
        ds_t0 = time.perf_counter()
        stride = n // _SM_MAX_POINTS
        points = points[::stride]
        n = len(points)
        ds_ms = (time.perf_counter() - ds_t0) * 1000.0

    # Ensure contiguous XYZI float32
    if points.shape[1] != 4 or points.dtype != np.float32:
        points = np.ascontiguousarray(points[:, :4], dtype=np.float32)

    t_store_ms = int(time.time() * 1000)
    binary = _sm_frame_to_binary(frame_id, points, t_store_ms)
    proc_ms = (time.perf_counter() - t0) * 1000.0

    with _sm_cond:
        _sm_frame      = binary
        _sm_frame_id   = frame_id
        _sm_recv_count += 1
        _sm_last_ts    = time.time()
        _sm_proc_ms_total   += proc_ms
        _sm_ds_ms_total     += ds_ms
        _sm_out_bytes_total += len(binary)
        _sm_cond.notify_all()


# ── DIFOP listener thread ─────────────────────────────────────────────────────

def _difop_listener_thread(host: str, port: int, stop_evt: threading.Event) -> None:
    global _difop_sock
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    except Exception:
        pass
    bind_addr = '0.0.0.0' if host in ('255.255.255.255',) else host
    try:
        sock.bind((bind_addr, port))
    except Exception as e:
        print(f'[Streaming] DIFOP socket bind failed on {bind_addr}:{port}: {e}', flush=True)
        return

    sock.settimeout(0.5)
    with _sm_lock:
        _difop_sock = sock
    print(f'[Streaming] DIFOP listener on {bind_addr}:{port}', flush=True)

    while not stop_evt.is_set():
        try:
            data, _ = sock.recvfrom(2048)
        except socket.timeout:
            continue
        except Exception:
            continue
        if len(data) >= _PKT_SIZE_DEFAULT and data[:8] == _DIFOP_ID_BYTES:
            _parse_difop(data)

    try:
        sock.close()
    except Exception:
        pass
    with _sm_lock:
        if _difop_sock is sock:
            _difop_sock = None


# ── MSOP listener thread ──────────────────────────────────────────────────────

def _is_multicast(ip: str) -> bool:
    try:
        return 224 <= int(ip.split('.', 1)[0]) <= 239
    except Exception:
        return False


def _is_broadcast(ip: str) -> bool:
    if ip == '255.255.255.255':
        return True
    try:
        return ip.split('.')[-1] == '255'
    except Exception:
        return False


def _udp_listener_thread(host: str, port: int, stop_evt: threading.Event) -> None:
    global _listener_sock, _sm_running, _sm_bind_host, _sm_bind_port

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 16 * 1024 * 1024)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    except Exception:
        pass
    if hasattr(socket, 'SO_REUSEPORT'):
        try:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
        except Exception:
            pass
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    except Exception:
        pass

    is_mcast = _is_multicast(host)
    is_bcast = _is_broadcast(host)
    bind_addr = '0.0.0.0' if (is_mcast or is_bcast) else host
    try:
        sock.bind((bind_addr, port))
    except Exception as e:
        print(f'[Streaming] MSOP bind failed on {bind_addr}:{port}: {e}', flush=True)
        with _sm_lock:
            _sm_running = False
        return

    if is_mcast:
        try:
            mreq = struct.pack('=4sl', socket.inet_aton(host), socket.INADDR_ANY)
            sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
        except Exception as e:
            print(f'[Streaming] multicast join failed: {e}', flush=True)

    sock.settimeout(0.5)
    with _sm_lock:
        _listener_sock = sock
        _sm_running    = True
        _sm_bind_host  = host
        _sm_bind_port  = port
    mode = 'multicast' if is_mcast else ('broadcast' if is_bcast else 'unicast')
    print(f'[Streaming] MSOP listener on {bind_addr}:{port} ({mode}={host})', flush=True)

    # Per-scan packet accumulator
    scan_packets: list[bytes] = []
    lidar_type = _LIDAR_TYPE_NONE
    frame_counter = 0

    while not stop_evt.is_set():
        try:
            data, addr = sock.recvfrom(2048)
        except socket.timeout:
            continue
        except Exception:
            continue

        if addr:
            global _sm_last_src_host, _sm_last_src_port
            # Simple assignment is GIL-atomic in CPython — no lock needed for
            # these status-only variables; avoids lock contention per packet.
            _sm_last_src_host = addr[0]
            _sm_last_src_port = int(addr[1]) if len(addr) > 1 else 0

        pkt_size = len(data)

        # Detect lidar type from packet size
        if pkt_size == _PKT_SIZE_RSM1:
            cur_type = _LIDAR_TYPE_RSM1
        elif pkt_size == _PKT_SIZE_HESAI_P128:
            cur_type = _LIDAR_TYPE_HESAI_P128
        elif pkt_size == _PKT_SIZE_HESAI_AT128:
            cur_type = _LIDAR_TYPE_HESAI_AT128
        else:
            cur_type = _LIDAR_TYPE_SIM_DEFAULT

        if cur_type == _LIDAR_TYPE_SIM_DEFAULT:
            if pkt_size < _PKT_SIZE_DEFAULT:
                continue
            # Validate MSOP magic
            if data[:8] != _MSOP_ID_BYTES:
                continue
            pkt_flag, = struct.unpack_from('<H', data, _HDR_OFF_PKT_FLAG)
            scan_packets.append(data)  # `data` from recvfrom is already bytes

            if pkt_flag == _FLAG_END:
                # Full scan received — decode and push
                frame_counter += 1
                if scan_packets:
                    try:
                        points, _ = _decode_packets_default(scan_packets)
                        if len(points) > 0:
                            _store_frame(points, frame_counter)
                    except Exception as e:
                        print(f'[Streaming] decode error: {e}', flush=True)
                scan_packets = []

        else:
            # RSM1 / Hesai — these vendor formats need full proprietary decoders;
            # currently not decoded; just count frames for status display.
            # Future: implement vendor-specific decode here.
            pass

    try:
        sock.close()
    except Exception:
        pass
    with _sm_lock:
        if _listener_sock is sock:
            _listener_sock = None
        _sm_running = False


# ── Public API ────────────────────────────────────────────────────────────────

def set_max_live_points(n: int) -> None:
    global _SM_MAX_POINTS
    _SM_MAX_POINTS = max(1000, n)


def stop_udp_listener() -> None:
    global _listener_thread, _listener_stop_evt, _listener_sock
    global _difop_thread, _difop_stop_evt, _difop_sock
    with _sm_lock:
        t    = _listener_thread
        evt  = _listener_stop_evt
        sock = _listener_sock
        dt   = _difop_thread
        devt = _difop_stop_evt
        dsock = _difop_sock
    if evt:
        evt.set()
    if devt:
        devt.set()
    for s in (sock, dsock):
        if s:
            try:
                s.close()
            except Exception:
                pass
    for th in (t, dt):
        if th:
            th.join(timeout=1.0)
    with _sm_lock:
        _listener_thread   = None
        _listener_stop_evt = None
        _listener_sock     = None
        _difop_thread      = None
        _difop_stop_evt    = None
        _difop_sock        = None


def start_udp_listener(port: int, host: str = '127.0.0.1',
                        info_port: int = 7788) -> None:
    global _listener_thread, _listener_stop_evt
    global _difop_thread, _difop_stop_evt
    global _sm_info_port
    stop_udp_listener()
    # Reset angle calibration when rebinding (new lidar may have different angles)
    with _sm_difop_lock:
        global _sm_vert_angles, _sm_channels
        _sm_vert_angles = np.empty(0, dtype=np.float32)
        _sm_channels    = 64

    msop_evt  = threading.Event()
    difop_evt = threading.Event()
    msop_t  = threading.Thread(target=_udp_listener_thread,
                                args=(host, port, msop_evt), daemon=True)
    difop_t = threading.Thread(target=_difop_listener_thread,
                                args=(host, info_port, difop_evt), daemon=True)
    with _sm_lock:
        _listener_stop_evt = msop_evt
        _listener_thread   = msop_t
        _difop_stop_evt    = difop_evt
        _difop_thread      = difop_t
        _sm_info_port      = info_port
    msop_t.start()
    difop_t.start()


def ensure_started(udp_port: int, udp_host: str, info_port: int = 7788) -> dict:
    if not getattr(ensure_started, '_udp_started', False):
        start_udp_listener(udp_port, udp_host, info_port)
        ensure_started._udp_started = True
    return {
        'started': True,
        'udp': {'host': udp_host, 'port': udp_port, 'info_port': info_port},
    }


def rebind_udp_listener(host: str, port: int, info_port: int = 7788) -> dict:
    start_udp_listener(port=port, host=host, info_port=info_port)
    ensure_started._udp_started = True
    return get_receiver_config()


def get_receiver_config() -> dict:
    with _sm_lock:
        return {
            'host':      _sm_bind_host,
            'port':      _sm_bind_port,
            'info_port': _sm_info_port,
            'running':   _sm_running,
            'src_host':  _sm_last_src_host,
            'src_port':  _sm_last_src_port,
        }


def get_status() -> dict:
    with _sm_lock:
        age_ms = round((time.time() - _sm_last_ts) * 1000) if _sm_last_ts > 0 else -1
        return {
            'running':    _sm_running,
            'recv_count': _sm_recv_count,
            'frame_id':   _sm_frame_id,
            'age_ms':     age_ms,
            'bind_host':  _sm_bind_host,
            'bind_port':  _sm_bind_port,
            'info_port':  _sm_info_port,
        }


def get_latest_frame(after_id: int = -1):
    with _sm_lock:
        fid     = _sm_frame_id
        payload = _sm_frame if fid != after_id else None
    return fid, payload


def get_latest_frame_blocking(after_id: int = -1, timeout: float = 2.0):
    with _sm_cond:
        if _sm_frame_id != after_id:
            return _sm_frame_id, _sm_frame
        _sm_cond.wait(timeout=timeout)
        if _sm_frame_id != after_id:
            return _sm_frame_id, _sm_frame
        return _sm_frame_id, None
