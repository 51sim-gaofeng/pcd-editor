"""HTTP request handler — routes all GET/POST requests to models and views."""
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

import view
from model.dds_model import (
    ensure_dds_started,
    get_latest_frame,
    get_latest_frame_blocking,
    get_receiver_config as dds_get_receiver_config,
    get_stream_config as dds_get_stream_config,
    get_status as dds_get_status,
    rebind_udp_listener,
    set_max_live_points,
)
from model.streaming_model import (
    ensure_started as streaming_ensure_started,
    get_receiver_config as streaming_get_receiver_config,
    get_status as streaming_get_status,
    get_latest_frame_blocking as streaming_get_latest_frame_blocking,
    rebind_udp_listener as streaming_rebind_udp,
    set_max_live_points as streaming_set_max_points,
)
from model.file_model import _preload_all, list_pcd_files
from model.gaussian_model import list_gaussian_files
from model.pcd_model import (
    get_pcd_binary_cached,
    get_pcd_max_points,
    parse_pcd,
    save_pcd,
    set_pcd_max_points,
)
from model.trajectory_model import (
    list_trajectories,
    load_trajectory,
    save_trajectory,
)
from config import get_app_info, get_welcome_pref, set_welcome_pref

_STATIC_MIME = {
    '.css':  'text/css',
    '.js':   'application/javascript',
    '.html': 'text/html',
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        pass  # suppress per-request access log

    def log_error(self, fmt, *args):
        msg = fmt % args if args else fmt
        if any(code in str(msg) for code in ('10053', '10054', 'BrokenPipe',
                                              'ConnectionAborted', 'ConnectionReset')):
            return
        sys.stderr.write(self.log_date_time_string() + ' ' + msg + '\n')

    # ── helpers ────────────────────────────────────────────────────────────────

    def _html(self, body: str):
        data = body.encode()
        try:
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
            self.send_header('Pragma', 'no-cache')
            self.end_headers()
            self.wfile.write(data)
        except (ConnectionAbortedError, BrokenPipeError, ConnectionResetError):
            pass

    def _json(self, obj):
        data = json.dumps(obj, separators=(',', ':')).encode()
        try:
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except (ConnectionAbortedError, BrokenPipeError, ConnectionResetError):
            pass

    def _binary(self, data: bytes, mime: str = 'application/octet-stream'):
        try:
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except (ConnectionAbortedError, BrokenPipeError, ConnectionResetError):
            pass

    def _serve_static(self, name: str):
        fpath = view.get_static_path(name)
        if not os.path.isfile(fpath):
            self.send_error(404)
            return
        ext  = os.path.splitext(name)[1].lower()
        mime = _STATIC_MIME.get(ext, 'application/octet-stream')
        with open(fpath, 'rb') as f:
            data = f.read()
        try:
            self.send_response(200)
            self.send_header('Content-Type', mime + '; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
            self.end_headers()
            self.wfile.write(data)
        except (ConnectionAbortedError, BrokenPipeError, ConnectionResetError):
            pass

    # ── GET ────────────────────────────────────────────────────────────────────

    def do_GET(self):
        from config import config
        parsed = urlparse(self.path)
        path   = parsed.path
        params = parse_qs(parsed.query)


        # Browsers request favicon.ico automatically. We don't ship one, so
        # return an empty success-like response to avoid noisy 404 logs.
        if path == '/favicon.ico':
            try:
                self.send_response(204)
                self.send_header('Content-Length', '0')
                self.end_headers()
            except (ConnectionAbortedError, BrokenPipeError, ConnectionResetError):
                pass
            return

        if path == '/':
            self._html(view.get_template('index.html'))

        elif path.startswith('/static/'):
            self._serve_static(path[len('/static/'):])

        elif path == '/api/files':
            self._json({'files': list_pcd_files()})

        elif path == '/api/pcd':
            fname = params.get('file', [''])[0]
            if not fname:
                self._json({'error': 'no file specified'}); return
            full = os.path.realpath(os.path.join(config.data_dir, fname))
            if not full.startswith(os.path.realpath(config.data_dir)):
                self._json({'error': 'forbidden'}); return
            if not os.path.isfile(full):
                self._json({'error': f'file not found: {fname}'}); return
            try:
                self._json(parse_pcd(full))
            except Exception as e:
                self._json({'error': str(e), 'points': [], 'fields': []})

        elif path == '/api/pcd_binary':
            fname = params.get('file', [''])[0]
            if not fname:
                self._json({'error': 'no file specified'}); return
            full = os.path.realpath(os.path.join(config.data_dir, fname))
            if not full.startswith(os.path.realpath(config.data_dir)):
                self._json({'error': 'forbidden'}); return
            if not os.path.isfile(full):
                self._json({'error': f'file not found: {fname}'}); return
            try:
                self._binary(get_pcd_binary_cached(full))
            except (ConnectionAbortedError, BrokenPipeError, ConnectionResetError):
                pass
            except Exception as e:
                self._json({'error': str(e)})

        elif path == '/api/pcd_abs':
            fpath = params.get('file', [''])[0]
            if not fpath:
                self._json({'error': 'no file'}); return
            full = os.path.realpath(fpath)
            if not os.path.isfile(full):
                self._json({'error': 'not found'}); return
            try:
                self._binary(get_pcd_binary_cached(full))
            except (ConnectionAbortedError, BrokenPipeError, ConnectionResetError):
                pass
            except Exception as e:
                self._json({'error': str(e)})

        elif path == '/api/browse':
            self._handle_browse(params)

        elif path == '/api/trajectory':
            self._handle_trajectory_get(params)

        elif path == '/api/pick_file':
            self._handle_pick_file(params)

        elif path == '/api/pick_ply':
            self._handle_pick_ply(params)

        elif path == '/api/pick_dir':
            self._handle_pick_dir(params)

        elif path == '/api/set_dir':
            self._handle_set_dir(params)

        elif path == '/api/dds_frame':
            self._handle_dds_frame(params)

        elif path == '/api/dds_status':
            self._json(dds_get_status())

        elif path == '/api/dds_ensure':
            try:
                from config import config as _cfg
                bind_host = _cfg.host if _cfg.host != '0.0.0.0' else '127.0.0.1'
                self._json(ensure_dds_started(_cfg.udp_port, _cfg.udp_host, _cfg.dds_ws_port, bind_host))
            except Exception as e:
                self._json({'started': False, 'error': str(e)})

        elif path == '/api/dds_receiver_config':
            self._json(dds_get_receiver_config())

        elif path == '/api/dds_stream_config':
            self._json(dds_get_stream_config())

        elif path == '/api/dds_rebind':
            try:
                host = params.get('ip', ['127.0.0.1'])[0] or '127.0.0.1'
                port = int(params.get('port', ['9870'])[0])
                self._json({'ok': True, **rebind_udp_listener(host, port)})
            except (ValueError, IndexError):
                self._json({'ok': False, 'error': 'invalid ip or port'})
            except Exception as e:
                self._json({'ok': False, 'error': str(e)})

        elif path == '/api/dds_set_max_points':
            try:
                n = int(params.get('n', ['60000'])[0])
                set_max_live_points(n)
                self._json({'ok': True, 'max_points': n})
            except (ValueError, IndexError):
                self._json({'ok': False})

        elif path == '/api/streaming_ensure':
            try:
                from config import config as _cfg
                self._json(streaming_ensure_started(
                    _cfg.streaming_udp_port, _cfg.streaming_udp_host,
                    _cfg.streaming_info_port))
            except Exception as e:
                self._json({'started': False, 'error': str(e)})

        elif path == '/api/streaming_status':
            self._json(streaming_get_status())

        elif path == '/api/streaming_receiver_config':
            self._json(streaming_get_receiver_config())

        elif path == '/api/streaming_frame':
            self._handle_streaming_frame(params)

        elif path == '/api/streaming_rebind':
            try:
                host      = params.get('ip',        ['127.0.0.1'])[0] or '127.0.0.1'
                port      = int(params.get('port',      ['6699'])[0])
                info_port = int(params.get('info_port', ['7788'])[0])
                self._json({'ok': True, **streaming_rebind_udp(host, port, info_port)})
            except (ValueError, IndexError):
                self._json({'ok': False, 'error': 'invalid ip or port'})
            except Exception as e:
                self._json({'ok': False, 'error': str(e)})

        elif path == '/api/streaming_set_max_points':
            try:
                n = int(params.get('n', ['60000'])[0])
                streaming_set_max_points(n)
                self._json({'ok': True, 'max_points': n})
            except (ValueError, IndexError):
                self._json({'ok': False})

        elif path == '/api/pcd_set_max_points':
            try:
                n = int(params.get('n', ['300000'])[0])
                set_pcd_max_points(n)
                self._json({'ok': True, 'max_points': get_pcd_max_points()})
            except (ValueError, IndexError):
                self._json({'ok': False})

        elif path == '/api/pcd_max_points':
            self._json({'max_points': get_pcd_max_points()})

        elif path == '/api/open_in_explorer':
            self._handle_open_explorer(params)

        elif path == '/api/camera_frame':
            self._handle_camera_frame(params)

        elif path == '/api/camera_status':
            from model.camera_model import get_status as cam_status
            self._json(cam_status())

        elif path == '/api/camera_ensure':
            self._handle_camera_ensure(params)

        elif path == '/api/camera_rebind':
            self._handle_camera_rebind(params)

        elif path == '/api/fusion_ensure':
            try:
                from model.camera_model import start_udp_listener as cam_start
                streaming_rebind_udp(
                    params.get('lidar_ip', ['10.66.8.143'])[0],
                    int(params.get('lidar_port', ['6699'])[0]),
                    int(params.get('info_port', ['7788'])[0]))
                cam_start(port=int(params.get('camera_port', ['13956'])[0]),
                          host=params.get('camera_ip', ['10.66.8.143'])[0])
                self._json({'ok': True})
            except Exception as e:
                self._json({'ok': False, 'error': str(e)})

        elif path == '/api/fusion_status':
            from model.fusion_model import get_status as fusion_status
            self._json(fusion_status())

        elif path == '/api/fusion_offset':
            from model.fusion_model import get_frame_offset, set_frame_offset
            if 'frames' in params:
                from model.camera_model import get_avg_frame_period_ms
                try:
                    frames = float(params['frames'][0])
                except (ValueError, IndexError):
                    frames = 0.0
                if frames == 0:
                    self._json({**set_frame_offset(0), 'frames': 0.0, 'period_ms': 0.0})
                else:
                    period_ms = get_avg_frame_period_ms()
                    if period_ms <= 0:
                        self._json({'ok': False,
                                    'error': 'no camera frame-rate measurement yet; '
                                             'start the camera/fusion stream first'})
                    else:
                        ms_value = int(round(frames * period_ms))
                        result = set_frame_offset(ms_value)
                        result.update({'frames': frames, 'period_ms': period_ms})
                        self._json(result)
            elif 'value' in params:
                try:
                    value = int(params['value'][0])
                except (ValueError, IndexError):
                    value = 0
                self._json(set_frame_offset(value))
            else:
                self._json({'frame_offset_ms': get_frame_offset()})

        elif path == '/api/fusion_frame':
            try:
                after = int(params.get('after', ['-1'])[0])
            except (ValueError, IndexError):
                after = -1
            from model.fusion_model import get_frame as fusion_frame
            seq, jpeg, meta = fusion_frame(after, 2.0)
            if jpeg is None:
                self._json({'changed': False, 'sequence': seq, **meta})
            else:
                try:
                    self.send_response(200)
                    self.send_header('Content-Type', 'image/jpeg')
                    self.send_header('X-Fusion-Sequence', str(seq))
                    self.send_header('X-Camera-Frame', str(meta.get('camera_frame', -1)))
                    self.send_header('X-Lidar-Frame', str(meta.get('lidar_frame', -1)))
                    self.send_header('X-Projected-Points', str(meta.get('projected_points', 0)))
                    self.send_header('X-Frame-Offset-Ms', str(meta.get('frame_offset_ms', 0)))
                    self.send_header('X-Match-Mode', str(meta.get('match_mode', 'sim_time')))
                    self.send_header('Cache-Control', 'no-store')
                    self.send_header('Content-Length', str(len(jpeg)))
                    self.end_headers()
                    self.wfile.write(jpeg)
                except (ConnectionAbortedError, BrokenPipeError, ConnectionResetError):
                    pass

        elif path == '/api/gaussian_files':
            try:
                self._json({'files': list_gaussian_files()})
            except Exception as e:
                self._json({'files': [], 'error': str(e)})

        elif path in ('/api/ply', '/api/ply_abs'):
            fpath_raw = params.get('file', [''])[0]
            if not fpath_raw:
                self._json({'error': 'no file specified'}); return
            if path == '/api/ply':
                full = os.path.realpath(os.path.join(config.data_dir, fpath_raw))
                if not full.startswith(os.path.realpath(config.data_dir)):
                    self._json({'error': 'forbidden'}); return
            else:
                full = os.path.realpath(fpath_raw)
            if not os.path.isfile(full):
                self._json({'error': 'not found'}); return
            self._serve_ply(full)

        elif path == '/api/app_info':
            self._json(get_app_info())

        elif path == '/api/welcome_pref':
            self._json({'show_welcome_on_startup': get_welcome_pref()})

        else:
            self.send_error(404)

    # ── POST ───────────────────────────────────────────────────────────────────

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/upload_pcd':
            self._handle_upload_pcd(); return
        if parsed.path == '/api/upload_ply':
            self._handle_upload_ply(); return
        length = int(self.headers.get('Content-Length', 0))
        body   = self.rfile.read(length)
        if parsed.path == '/api/trajectory':
            self._handle_trajectory_post(body)
        elif parsed.path == '/api/save_pcd':
            self._handle_save_pcd(body)
        elif parsed.path == '/api/traj_export':
            self._handle_traj_export(body)
        elif parsed.path == '/api/welcome_pref':
            self._handle_welcome_pref_post(body)
        elif parsed.path == '/api/fusion_config':
            try:
                data = json.loads(body or b'{}')
                from model.fusion_model import configure
                self._json(configure(data.get('camera') or {}, data.get('lidar') or {}))
            except Exception as e:
                self._json({'ok': False, 'error': str(e)})
        else:
            self.send_error(404)

    # ── route handlers ─────────────────────────────────────────────────────────

    def _serve_ply(self, full_path: str):
        """Stream a PLY file as binary with chunked encoding (handles large files)."""
        try:
            size = os.path.getsize(full_path)
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Length', str(size))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            CHUNK = 65536
            with open(full_path, 'rb') as f:
                while True:
                    chunk = f.read(CHUNK)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except (ConnectionAbortedError, BrokenPipeError, ConnectionResetError):
            pass

    def _handle_browse(self, params):
        from config import config
        req_dir  = params.get('dir', [''])[0] or config.data_dir
        full_dir = os.path.realpath(req_dir)
        if not os.path.isdir(full_dir):
            self._json({'error': 'not a directory', 'items': [], 'cwd': full_dir}); return
        try:
            items  = []
            parent = os.path.dirname(full_dir)
            if parent != full_dir:
                items.append({'name': '..', 'type': 'dir', 'path': parent})
            for name in sorted(os.listdir(full_dir)):
                p = os.path.join(full_dir, name)
                if os.path.isdir(p):
                    items.append({'name': name, 'type': 'dir', 'path': p})
                elif name.lower().endswith('.pcd'):
                    items.append({'name': name, 'type': 'pcd', 'path': p})
            self._json({'items': items, 'cwd': full_dir})
        except Exception as e:
            self._json({'error': str(e), 'items': [], 'cwd': full_dir})

    def _handle_trajectory_get(self, params):
        fname = params.get('file', [''])[0]
        if fname:
            try:
                self._json(load_trajectory(fname))
            except PermissionError:
                self._json({'error': 'forbidden'})
            except FileNotFoundError:
                self._json({'error': 'not found'})
            except Exception as e:
                self._json({'error': str(e)})
        else:
            self._json({'files': list_trajectories()})

    def _handle_welcome_pref_post(self, body: bytes):
        try:
            data = json.loads(body or b'{}')
            set_welcome_pref(bool(data.get('show_welcome_on_startup', True)))
            self._json({'ok': True, 'show_welcome_on_startup': get_welcome_pref()})
        except Exception as e:
            self._json({'ok': False, 'error': str(e)})

    def _handle_trajectory_post(self, body: bytes):
        try:
            data  = json.loads(body)
            fname = save_trajectory(data)
            self._json({'ok': True, 'file': fname})
        except Exception as e:
            self._json({'error': str(e)})

    def _handle_save_pcd(self, body: bytes):
        from config import config
        try:
            data   = json.loads(body)
            points = data.get('points', [])
            fields = data.get('fields', [])
            if not points or not fields:
                self._json({'error': 'empty points or fields'}); return
            raw_name = data.get('filename', 'edited')
            fname    = os.path.basename(raw_name)
            if not fname.endswith('.pcd'):
                fname += '.pcd'
            fname = ''.join(c for c in fname if c.isalnum() or c in '._-')
            full  = os.path.join(config.data_dir, fname)
            save_pcd(full, points, fields)
            self._json({'ok': True, 'file': fname})
        except Exception as e:
            self._json({'error': str(e)})

    def _handle_upload_pcd(self):
        from config import config
        from urllib.parse import unquote
        try:
            length = int(self.headers.get('Content-Length', 0))
            if length <= 0:
                self._json({'error': 'empty upload'}); return
            raw_name = self.headers.get('X-Filename', '') or 'dropped.pcd'
            rel_in   = self.headers.get('X-Relpath', '') or ''
            try: raw_name = unquote(raw_name)
            except Exception: pass
            try: rel_in   = unquote(rel_in)
            except Exception: pass

            def _safe_part(s):
                s = ''.join(c for c in s if c.isalnum() or c in '._- ')
                return s.strip(' .') or 'x'

            drop_dir = os.path.join(config.data_dir, '_dropped')
            if rel_in:
                parts = [p for p in rel_in.replace('\\', '/').split('/') if p and p != '..']
                parts = [_safe_part(p) for p in parts]
                if not parts:
                    parts = [_safe_part(os.path.basename(raw_name)) or 'dropped.pcd']
                if not parts[-1].lower().endswith('.pcd'):
                    parts[-1] += '.pcd'
                full = os.path.join(drop_dir, *parts)
            else:
                fname = _safe_part(os.path.basename(raw_name))
                if not fname.lower().endswith('.pcd'):
                    fname += '.pcd'
                full = os.path.join(drop_dir, fname)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            base, ext = os.path.splitext(full)
            n = 1
            while os.path.exists(full):
                full = f'{base}_{n}{ext}'; n += 1
            data = self.rfile.read(length)
            with open(full, 'wb') as f:
                f.write(data)
            rel = os.path.relpath(full, config.data_dir).replace('\\', '/')
            self._json({'ok': True, 'file': rel, 'abs': full, 'size': length})
        except Exception as e:
            try: self._json({'ok': False, 'error': str(e)})
            except Exception: pass

    def _handle_upload_ply(self):
        from config import config
        from urllib.parse import unquote
        try:
            length = int(self.headers.get('Content-Length', 0))
            if length <= 0:
                self._json({'error': 'empty upload'}); return
            raw_name = self.headers.get('X-Filename', '') or 'dropped.ply'
            rel_in   = self.headers.get('X-Relpath', '') or ''
            try: raw_name = unquote(raw_name)
            except Exception: pass
            try: rel_in   = unquote(rel_in)
            except Exception: pass

            def _safe_part(s):
                s = ''.join(c for c in s if c.isalnum() or c in '._- ')
                return s.strip(' .') or 'x'

            drop_dir = os.path.join(config.data_dir, '_dropped')
            if rel_in:
                parts = [p for p in rel_in.replace('\\', '/').split('/') if p and p != '..']
                parts = [_safe_part(p) for p in parts]
                if not parts:
                    parts = [_safe_part(os.path.basename(raw_name)) or 'dropped.ply']
                if not parts[-1].lower().endswith('.ply'):
                    parts[-1] += '.ply'
                full = os.path.join(drop_dir, *parts)
            else:
                fname = _safe_part(os.path.basename(raw_name))
                if not fname.lower().endswith('.ply'):
                    fname += '.ply'
                full = os.path.join(drop_dir, fname)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            base, ext = os.path.splitext(full)
            n = 1
            while os.path.exists(full):
                full = f'{base}_{n}{ext}'; n += 1
            data = self.rfile.read(length)
            with open(full, 'wb') as f:
                f.write(data)
            rel = os.path.relpath(full, config.data_dir).replace('\\', '/')
            self._json({'ok': True, 'file': rel, 'abs': full, 'size': length})
        except Exception as e:
            try: self._json({'ok': False, 'error': str(e)})
            except Exception: pass

    def _handle_traj_export(self, body: bytes):
        """Open a native Save-As dialog and write the trajectory JSON to disk."""
        from config import config
        try:
            import json as _json_mod
            import tkinter as tk
            from tkinter import filedialog
            data = _json_mod.loads(body)
            default_name = 'trajectory_' + __import__('datetime').datetime.now().strftime('%Y%m%d_%H%M%S') + '.json'
            root = tk.Tk(); root.withdraw(); root.attributes('-topmost', True)
            save_path = filedialog.asksaveasfilename(
                title='保存轨迹文件',
                initialdir=config.data_dir,
                initialfile=default_name,
                defaultextension='.json',
                filetypes=[('JSON files', '*.json'), ('All files', '*.*')])
            root.destroy()
            if not save_path:
                self._json({'ok': False, 'cancelled': True}); return
            save_path = os.path.normpath(save_path)
            with open(save_path, 'w', encoding='utf-8') as f:
                _json_mod.dump(data, f, indent=2, ensure_ascii=False)
            self._json({'ok': True, 'file': save_path})
        except Exception as e:
            self._json({'ok': False, 'error': str(e)})

    def _handle_pick_file(self, params):
        from config import config
        init_dir = params.get('dir', [''])[0] or config.data_dir
        try:
            import tkinter as tk
            from tkinter import filedialog
            root = tk.Tk(); root.withdraw(); root.attributes('-topmost', True)
            picked = filedialog.askopenfilename(
                title='选择 PCD 文件', initialdir=init_dir,
                filetypes=[('PCD files', '*.pcd'), ('All files', '*.*')])
            root.destroy()
            if picked:
                picked = os.path.normpath(picked)
                config.data_dir = os.path.dirname(picked)
                from config import save_last_dir
                save_last_dir(config.data_dir)
                threading.Thread(target=_preload_all, daemon=True).start()
            self._json({'path': picked or '', 'data_dir': config.data_dir,
                        'fname': os.path.basename(picked) if picked else ''})
        except Exception as e:
            self._json({'path': '', 'error': str(e)})

    def _handle_pick_ply(self, params):
        """Native OS file picker for .ply (3DGS) files.

        Unlike drag-and-drop (which must upload the file's bytes to the server
        since browsers never expose a dropped file's real path), this returns the
        real absolute path so the caller can load it directly via /api/ply_abs —
        no copy, no upload, works for arbitrarily large scenes.
        """
        from config import config
        init_dir = params.get('dir', [''])[0] or config.data_dir
        try:
            import tkinter as tk
            from tkinter import filedialog
            root = tk.Tk(); root.withdraw(); root.attributes('-topmost', True)
            picked = filedialog.askopenfilename(
                title='选择 PLY 文件 (3DGS)', initialdir=init_dir,
                filetypes=[('PLY files', '*.ply'), ('All files', '*.*')])
            root.destroy()
            if picked:
                picked = os.path.normpath(picked)
            self._json({'path': picked or '', 'fname': os.path.basename(picked) if picked else ''})
        except Exception as e:
            self._json({'path': '', 'error': str(e)})

    def _handle_pick_dir(self, params):
        from config import config
        init_dir = params.get('dir', [''])[0] or config.data_dir
        try:
            import tkinter as tk
            from tkinter import filedialog
            root = tk.Tk(); root.withdraw(); root.attributes('-topmost', True)
            picked = filedialog.askdirectory(title='选择 PCD 目录', initialdir=init_dir)
            root.destroy()
            if picked:
                config.data_dir = os.path.normpath(picked)
                from config import save_last_dir
                save_last_dir(config.data_dir)
                threading.Thread(target=_preload_all, daemon=True).start()
            self._json({'path': picked or '', 'data_dir': config.data_dir})
        except Exception as e:
            self._json({'path': '', 'error': str(e)})

    def _handle_set_dir(self, params):
        from config import config
        target = params.get('dir', [''])[0]
        full   = os.path.realpath(target) if target else ''
        if full and os.path.isdir(full):
            config.data_dir = full
            from config import save_last_dir
            save_last_dir(config.data_dir)
            self._json({'ok': True, 'data_dir': config.data_dir})
        else:
            self._json({'ok': False, 'error': 'not a directory'})

    def _handle_open_explorer(self, params):
        from config import config
        import subprocess
        target = params.get('dir', [''])[0] or config.data_dir
        try:
            full = os.path.realpath(target)
            if os.path.isdir(full):
                subprocess.Popen(['explorer', full])
                self._json({'ok': True, 'path': full})
            else:
                self._json({'ok': False, 'error': 'not a directory'})
        except Exception as e:
            self._json({'ok': False, 'error': str(e)})

    def _handle_camera_frame(self, params):
        """Long-poll: block until a camera frame newer than after_id arrives (up to 2s)."""
        try:
            after_id = int(params.get('after', ['-1'])[0])
        except (ValueError, IndexError):
            after_id = -1
        from model.camera_model import get_latest_frame_blocking as cam_frame, get_status as cam_status
        fid, source_fid, jpeg = cam_frame(after_id, timeout=2.0)
        if jpeg is None:
            self._json({'frame_id': fid, 'source_frame_id': source_fid, 'changed': False})
            return
        display_fid = cam_status().get('display_frame_id', source_fid)
        try:
            self.send_response(200)
            self.send_header('Content-Type', 'image/jpeg')
            self.send_header('X-Frame-Id', str(fid))
            self.send_header('X-Source-Frame-Id', str(source_fid))
            self.send_header('X-Display-Frame-Id', str(display_fid))
            self.send_header('Cache-Control', 'no-store, no-cache, max-age=0, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Content-Length', str(len(jpeg)))
            self.end_headers()
            self.wfile.write(jpeg)
        except (ConnectionAbortedError, BrokenPipeError, ConnectionResetError):
            pass

    def _handle_camera_ensure(self, params):
        try:
            host = params.get('ip', ['10.66.8.143'])[0] or '10.66.8.143'
            port = int(params.get('port', ['9870'])[0])
            from model.camera_model import start_udp_listener as cam_start, get_status as cam_status
            cam_start(port=port, host=host)
            self._json({'started': True, **cam_status()})
        except Exception as e:
            self._json({'started': False, 'error': str(e)})

    def _handle_camera_rebind(self, params):
        try:
            host = params.get('ip', ['10.66.8.143'])[0] or '10.66.8.143'
            port = int(params.get('port', ['9870'])[0])
            from model.camera_model import rebind as cam_rebind
            self._json({'ok': True, **cam_rebind(host, port)})
        except Exception as e:
            self._json({'ok': False, 'error': str(e)})

    def _handle_dds_frame(self, params):
        """Long-poll: block until a frame newer than after_id arrives (up to 2 s), then return it."""
        try:
            after_id = int(params.get('after', ['-1'])[0])
        except (ValueError, IndexError):
            after_id = -1
        fid, payload = get_latest_frame_blocking(after_id, timeout=2.0)
        if payload is None:
            # Timeout — no new frame yet
            self._json({'frame_id': fid, 'changed': False})
            return
        try:
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('X-Frame-Id', str(fid))
            self.send_header('Cache-Control', 'no-store, no-cache, max-age=0, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except (ConnectionAbortedError, BrokenPipeError, ConnectionResetError):
            pass

    def _handle_streaming_frame(self, params):
        """Long-poll: block until a streaming frame newer than after_id arrives (up to 1 s)."""
        try:
            after_id = int(params.get('after_id', ['-1'])[0])
        except (ValueError, IndexError):
            after_id = -1
        fid, payload = streaming_get_latest_frame_blocking(after_id, timeout=1.0)
        if payload is None:
            try:
                self.send_response(204)
                self.end_headers()
            except (ConnectionAbortedError, BrokenPipeError, ConnectionResetError):
                pass
            return
        try:
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('X-Frame-Id', str(fid))
            self.send_header('Cache-Control', 'no-store, no-cache, max-age=0, must-revalidate')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except (ConnectionAbortedError, BrokenPipeError, ConnectionResetError):
            pass
