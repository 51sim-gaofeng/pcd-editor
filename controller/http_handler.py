"""HTTP request handler — routes all GET/POST requests to models and views."""
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

import view
from model.file_model import _preload_all, list_pcd_files
from model.pcd_model import get_pcd_binary_cached, parse_pcd, save_pcd
from model.trajectory_model import (
    list_trajectories,
    load_trajectory,
    save_trajectory,
)

_STATIC_MIME = {
    '.css':  'text/css',
    '.js':   'application/javascript',
    '.html': 'text/html',
}


class Handler(BaseHTTPRequestHandler):

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

        elif path == '/api/pick_dir':
            self._handle_pick_dir(params)

        elif path == '/api/set_dir':
            self._handle_set_dir(params)

        elif path == '/api/open_in_explorer':
            self._handle_open_explorer(params)

        else:
            self.send_error(404)

    # ── POST ───────────────────────────────────────────────────────────────────

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/upload_pcd':
            self._handle_upload_pcd(); return
        length = int(self.headers.get('Content-Length', 0))
        body   = self.rfile.read(length)
        if parsed.path == '/api/trajectory':
            self._handle_trajectory_post(body)
        elif parsed.path == '/api/save_pcd':
            self._handle_save_pcd(body)
        else:
            self.send_error(404)

    # ── route handlers ─────────────────────────────────────────────────────────

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
