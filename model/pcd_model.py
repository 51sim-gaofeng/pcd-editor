"""PCD file I/O, binary serialization, and in-memory / on-disk caching."""
import io
import json
import os
import struct
import threading
import time

import numpy as np

_PCD_CACHE: dict = {}          # path -> (mtime, binary_bytes)
_PARSE_SEM = threading.Semaphore(3)   # max 3 concurrent file parses


def parse_pcd(path: str) -> dict:
    _t0 = time.perf_counter()
    fname = os.path.basename(path)
    with open(path, 'rb') as f:
        raw = f.read()
    _t1 = time.perf_counter()
    print(f'[PCD] {fname} file_read={(_t1-_t0)*1000:.1f}ms  size={len(raw)//1024}KB', flush=True)

    header = {}
    header_end = 0
    i = 0
    while i < len(raw):
        end = raw.find(b'\n', i)
        if end == -1:
            break
        line = raw[i:end].decode('latin-1').strip()
        i = end + 1
        key = line.split()[0].upper() if line.split() else ''
        if key == 'DATA':
            header['DATA'] = line.split()[1].lower()
            header_end = i
            break
        if line and not line.startswith('#'):
            parts = line.split()
            header[parts[0].upper()] = parts[1:]

    fields    = [f.lower() for f in header.get('FIELDS', ['x', 'y', 'z'])]
    sizes     = [int(s) for s in header.get('SIZE',  ['4', '4', '4'])]
    types     = header.get('TYPE',  ['F', 'F', 'F'])
    counts    = [int(c) for c in header.get('COUNT', ['1'] * len(fields))]
    npoints   = int(header.get('POINTS', [0])[0])
    data_type = header.get('DATA', 'ascii')

    fmt_map = {
        'F': {4: 'f', 8: 'd'},
        'I': {1: 'b', 2: 'h', 4: 'i', 8: 'q'},
        'U': {1: 'B', 2: 'H', 4: 'I', 8: 'Q'},
    }
    fmt = '<'
    for t, s, c in zip(types, sizes, counts):
        fmt += fmt_map.get(t.upper(), {}).get(s, 'f') * c
    point_size = struct.calcsize(fmt)

    flat_fields = []
    for fname_f, c in zip(fields, counts):
        flat_fields.extend([fname_f] if c == 1 else [f'{fname_f}_{j}' for j in range(c)])

    nfields = len(flat_fields)
    _t2 = time.perf_counter()
    print(f'[PCD] {fname} header_parse={(_t2-_t1)*1000:.1f}ms  data_type={data_type}  npts={npoints}  nfields={nfields}', flush=True)

    points = []
    if data_type == 'ascii':
        body = raw[header_end:]
        arr2 = None
        # Fast path: pandas C-engine (10-20x faster than np.fromstring)
        try:
            import pandas as _pd
            _tp0 = time.perf_counter()
            _df = _pd.read_csv(io.BytesIO(body), header=None, sep=' ', dtype=np.float32, engine='c')
            _tp1 = time.perf_counter()
            _df = _df.dropna(axis=1, how='all')
            _tp2 = time.perf_counter()
            print(f'[PCD] {fname} pandas_read_csv={(_tp1-_tp0)*1000:.1f}ms  dropna={(_tp2-_tp1)*1000:.1f}ms  shape={_df.shape}', flush=True)
            if _df.shape[1] == nfields:
                arr2 = _df.values[:npoints]
            else:
                print(f'[PCD] {fname} WARNING pandas col mismatch: got {_df.shape[1]} expect {nfields}', flush=True)
        except Exception as _e:
            print(f'[PCD] {fname} pandas FAILED: {_e}', flush=True)
        # Fallback: np.fromstring
        if arr2 is None:
            try:
                _tf0 = time.perf_counter()
                txt = body.decode('latin-1')
                _flat = np.fromstring(txt, dtype=np.float32, sep=' ')
                _tf1 = time.perf_counter()
                print(f'[PCD] {fname} np_fromstring={(_tf1-_tf0)*1000:.1f}ms  size={_flat.size}', flush=True)
                if _flat.size == npoints * nfields:
                    arr2 = _flat.reshape(npoints, nfields)
            except Exception as _e:
                print(f'[PCD] {fname} np.fromstring FAILED: {_e}', flush=True)
        if arr2 is not None:
            orig_count = npoints
            if len(arr2) > 300_000:
                step = len(arr2) // 300_000 + 1
                arr2 = arr2[::step]
            _t3 = time.perf_counter()
            print(f'[PCD] {fname} ascii_total={(_t3-_t2)*1000:.1f}ms  final_pts={len(arr2)}', flush=True)
            return {'fields': flat_fields, 'points': arr2, 'count': len(arr2),
                    'original_count': orig_count, 'file': os.path.basename(path)}
        # Slow fallback: line-by-line
        try:
            txt = body.decode('latin-1')
        except Exception:
            txt = raw[header_end:].decode('latin-1', errors='replace')
        for line in txt.splitlines():
            vals = line.strip().split()
            if len(vals) >= nfields:
                try:
                    points.append([float(v) for v in vals[:nfields]])
                except ValueError:
                    pass

    elif data_type in ('binary', 'binary_compressed'):
        body = raw[header_end:]
        if data_type == 'binary_compressed':
            try:
                import lzf
                comp_size   = struct.unpack_from('<I', body, 0)[0]
                decomp_size = struct.unpack_from('<I', body, 4)[0]
                body = lzf.decompress(body[8:8 + comp_size], decomp_size)
            except ImportError:
                return {'error': "binary_compressed requires 'python-lzf' package",
                        'points': [], 'fields': flat_fields}
        # Fast path: all fields are float32 with no padding
        all_f32 = all(t.upper() == 'F' and s == 4 and c == 1
                      for t, s, c in zip(types, sizes, counts))
        if all_f32 and len(body) >= npoints * nfields * 4:
            arr = np.frombuffer(body, dtype=np.float32,
                                count=npoints * nfields).reshape(npoints, nfields)
            orig_count = npoints
            if npoints > 300_000:
                step = npoints // 300_000 + 1
                arr = arr[::step]
            return {'fields': flat_fields, 'points': arr, 'count': len(arr),
                    'original_count': orig_count, 'file': os.path.basename(path)}
        else:
            # Mixed-type binary: structured numpy dtype
            _tb0 = time.perf_counter()
            fmt_map2 = {'F': {4: 'f', 8: 'd'}, 'I': {1: 'b', 2: 'h', 4: 'i', 8: 'q'},
                        'U': {1: 'B', 2: 'H', 4: 'I', 8: 'Q'}}
            dt_chars = [fmt_map2.get(t.upper(), {}).get(s, 'f')
                        for t, s, c in zip(types, sizes, counts) for _ in range(c)]
            dt = np.dtype([(f'_f{i}', '<' + ch) for i, ch in enumerate(dt_chars)])
            try:
                arr_s = np.frombuffer(body, dtype=dt, count=npoints)
                arr = np.column_stack(
                    [arr_s[f'_f{i}'].astype(np.float32) for i in range(len(dt_chars))]
                )
                _tb1 = time.perf_counter()
                print(f'[PCD] {fname} binary_mixed_frombuffer={(_tb1-_tb0)*1000:.1f}ms  shape={arr.shape}', flush=True)
                orig_count = npoints
                if npoints > 300_000:
                    step = npoints // 300_000 + 1
                    arr = arr[::step]
                return {'fields': flat_fields, 'points': arr, 'count': len(arr),
                        'original_count': orig_count, 'file': os.path.basename(path)}
            except Exception as _e:
                print(f'[PCD] {fname} binary_mixed FAILED: {_e}, falling back to slow loop', flush=True)
            # Slow fallback: struct.unpack_from loop
            offset = 0
            for _ in range(npoints):
                if offset + point_size > len(body):
                    break
                points.append(list(struct.unpack_from(fmt, body, offset)))
                offset += point_size

    max_pts = 300_000
    if len(points) > max_pts:
        step = len(points) // max_pts + 1
        points = points[::step]

    return {'fields': flat_fields, 'points': points, 'count': len(points),
            'original_count': npoints, 'file': os.path.basename(path)}


def save_pcd(path: str, points: list, fields: list):
    """Write an ASCII PCD file."""
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    n = len(points)
    nf = len(fields)
    with open(path, 'w') as f:
        f.write('# PCD edited by pcd_viewer\n')
        f.write('VERSION 0.7\n')
        f.write(f"FIELDS {' '.join(fields)}\n")
        f.write(f"SIZE {' '.join(['4'] * nf)}\n")
        f.write(f"TYPE {' '.join(['F'] * nf)}\n")
        f.write(f"COUNT {' '.join(['1'] * nf)}\n")
        f.write(f'WIDTH {n}\n')
        f.write('HEIGHT 1\n')
        f.write('VIEWPOINT 0 0 0 1 0 0 0\n')
        f.write(f'POINTS {n}\n')
        f.write('DATA ascii\n')
        for p in points:
            f.write(' '.join(f'{v:.6f}' for v in p[:nf]) + '\n')


def pcd_to_binary(pcd: dict) -> bytes:
    """Serialize PCD to compact binary: [4B meta_len][JSON meta][pad][float32 data]."""
    fields  = pcd['fields']
    points  = pcd['points']
    npoints = len(points) if points is not None else 0
    nfields = len(fields)
    orig    = pcd.get('original_count', npoints)
    meta = json.dumps({'fields': fields, 'npoints': npoints,
                       'original_count': orig, 'file': pcd.get('file', '')}).encode()
    raw_off = 4 + len(meta)
    pad = (4 - raw_off % 4) % 4
    if npoints > 0:
        if isinstance(points, np.ndarray):
            arr = points if points.dtype == np.float32 else points.astype(np.float32)
            if not arr.flags['C_CONTIGUOUS']:
                arr = np.ascontiguousarray(arr)
            data = arr.tobytes()
        else:
            try:
                arr = np.array(points, dtype=np.float32)
                data = arr.tobytes()
            except Exception:
                flat = [float(v) for p in points for v in p[:nfields]]
                data = struct.pack(f'<{len(flat)}f', *flat)
    else:
        data = b''
    return struct.pack('<I', len(meta)) + meta + b'\x00' * pad + data


def get_pcd_binary_cached(full_path: str) -> bytes:
    """Return cached binary payload: in-memory → local-disk cache → parse."""
    _g0 = time.perf_counter()
    fname = os.path.basename(full_path)
    _parts = full_path.replace('\\', '/').split('/')
    label = '/'.join(_parts[-3:]) if len(_parts) >= 3 else fname
    try:
        mtime = os.path.getmtime(full_path)
    except OSError:
        mtime = 0
    # 1) in-memory cache
    cached = _PCD_CACHE.get(full_path)
    if cached and cached[0] == mtime:
        print(f'[CACHE] {label} HIT memory  {(time.perf_counter()-_g0)*1000:.1f}ms', flush=True)
        return cached[1]
    # 2) local-disk cache in .pcd_cache/ next to the PCD file
    cache_dir  = os.path.join(os.path.dirname(full_path), '.pcd_cache')
    bin_path   = os.path.join(cache_dir, fname + '.bin')
    mtime_path = bin_path + '.mtime'
    try:
        stored_mtime = float(open(mtime_path).read())
        if stored_mtime >= mtime:
            _d0 = time.perf_counter()
            with open(bin_path, 'rb') as f:
                data = f.read()
            _d1 = time.perf_counter()
            print(f'[CACHE] {label} HIT disk  read={(_d1-_d0)*1000:.1f}ms  size={len(data)//1024}KB  total={(_d1-_g0)*1000:.1f}ms', flush=True)
            _PCD_CACHE[full_path] = (mtime, data)
            return data
    except Exception as _e:
        print(f'[CACHE] {label} disk miss ({_e})', flush=True)
    # 3) parse from source (limit concurrency)
    print(f'[CACHE] {label} MISS — acquiring parse semaphore...', flush=True)
    _s0 = time.perf_counter()
    with _PARSE_SEM:
        _s1 = time.perf_counter()
        print(f'[CACHE] {label} semaphore_wait={(_s1-_s0)*1000:.1f}ms', flush=True)
        cached = _PCD_CACHE.get(full_path)
        if cached and cached[0] == mtime:
            print(f'[CACHE] {label} HIT memory (after sem)  total={(_s1-_g0)*1000:.1f}ms', flush=True)
            return cached[1]
        _p0 = time.perf_counter()
        pcd  = parse_pcd(full_path)
        _p1 = time.perf_counter()
        data = pcd_to_binary(pcd)
        _p2 = time.perf_counter()
        print(f'[CACHE] {label} parse={(_p1-_p0)*1000:.1f}ms  serialize={(_p2-_p1)*1000:.1f}ms  total={(_p2-_g0)*1000:.1f}ms  size={len(data)//1024}KB', flush=True)
        _PCD_CACHE[full_path] = (mtime, data)
    # write local-disk cache in background
    _data_snap, _mtime_snap = data, mtime
    def _write_cache():
        try:
            _w0 = time.perf_counter()
            os.makedirs(cache_dir, exist_ok=True)
            tmp = bin_path + '.tmp'
            with open(tmp, 'wb') as f:
                f.write(_data_snap)
            os.replace(tmp, bin_path)
            with open(mtime_path, 'w') as f:
                f.write(str(_mtime_snap))
            print(f'[CACHE] {label} disk_write={(time.perf_counter()-_w0)*1000:.1f}ms  path={bin_path}', flush=True)
        except Exception as _e:
            print(f'[CACHE] {label} disk_write FAILED: {_e}', flush=True)
    import threading as _t
    _t.Thread(target=_write_cache, daemon=True).start()
    return data
