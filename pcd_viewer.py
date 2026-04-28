#!/usr/bin/env python3
"""
PCD Viewer — Web-based point cloud visualizer using Three.js
Usage: python3 pcd_viewer.py [data_dir] [port]
  data_dir : directory containing .pcd files  (default: script directory)
  port     : HTTP port                         (default: 8089)

MVC structure:
  config.py                — runtime configuration (data_dir, port, host)
  model/pcd_model.py       — PCD parsing, binary serialization, caching
  model/file_model.py      — file listing, directory scanning, preloading
  model/trajectory_model.py— trajectory JSON I/O
  controller/http_handler.py — HTTP routing (GET/POST handlers)
  view/__init__.py         — template & static-file path helpers
  view/templates/index.html— HTML page
  view/static/style.css    — CSS
  view/static/three_view.js— Three.js 3D rendering (ES module)
  view/static/ui.js        — sidebar / playback / edit UI logic
"""

import sys
import io
import threading
import socket
import webbrowser
from http.server import ThreadingHTTPServer

# Force stdout/stderr to UTF-8 so Unicode characters (e.g. →) don't crash on
# Windows consoles that default to cp1252 / cp936.
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
if sys.stderr and hasattr(sys.stderr, 'reconfigure'):
    try:
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

from config import config, init_from_args
from controller.http_handler import Handler
from model.dds_model import start_udp_listener
from model.file_model import _preload_all, list_pcd_files



def _wait_for_server(host: str, port: int, timeout: float = 10.0):
    """Block until the HTTP server is accepting connections."""
    import time
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.2):
                return True
        except OSError:
            time.sleep(0.05)
    return False


def _find_free_port(preferred: int, host: str, max_tries: int = 20) -> int:
    """Return preferred port if free, otherwise find the next available one."""
    for offset in range(max_tries):
        port = preferred + offset
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                s.bind((host if host not in ('0.0.0.0', '::') else '127.0.0.1', port))
            return port
        except OSError:
            continue
    raise OSError(f"No free port found in range {preferred}-{preferred + max_tries - 1}")


def main():
    init_from_args(sys.argv[1:])
    bind_host = config.host

    # Auto-select a free port if the preferred one is already in use
    config.port = _find_free_port(config.port, bind_host)

    ThreadingHTTPServer.allow_reuse_address = True
    server = ThreadingHTTPServer((bind_host, config.port), Handler)
    server.daemon_threads = True
    _disp_host = 'localhost' if bind_host in ('0.0.0.0', '127.0.0.1', '::') else bind_host
    url = f"http://{_disp_host}:{config.port}"
    print(f"PCD Viewer  ->  {url}  (bind {bind_host})")
    print(f"Data dir  : {config.data_dir}")
    n_files = len(list_pcd_files())
    print(f"PCD files : {n_files} found")

    if n_files > 0:
        threading.Thread(target=_preload_all, daemon=True).start()
        print(f"Preloading {n_files} files in background...")

    # ── Start DDS UDP listener ─────────────────────────────────────────────
    start_udp_listener(config.udp_port)

    # ── Try to open a native window via pywebview ──────────────────────────
    if config.no_window:
        print("--no-window set, running as headless HTTP server.")
        print(f"Open  http://{_disp_host}:{config.port}  in your browser.")
        print("Ctrl+C to stop.")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nStopping...")
        return

    # pywebview native window is Windows-only; Linux uses browser mode
    if sys.platform != 'win32':
        print(f"Opening  {url}  in your browser...")
        webbrowser.open(url)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nStopping...")
        return

    try:
        import webview  # type: ignore

        # Start HTTP server in background thread
        srv_thread = threading.Thread(target=server.serve_forever, daemon=True)
        srv_thread.start()

        # Wait until the server is ready before handing URL to webview
        _wait_for_server(_disp_host, config.port)

        print("Opening native window (pywebview)...")
        webview.create_window(
            "4DGS Lidar PCD Viewer",
            url,
            width=1440,
            height=900,
            resizable=True,
            min_size=(800, 600),
        )
        webview.start()          # blocks until window is closed
        server.shutdown()
        return

    except ImportError:
        # pywebview not installed — fall back to browser mode
        print("pywebview not found, running in browser mode.")
        print(f"Opening  {url}  in your browser...")
        webbrowser.open(url)
    except Exception as _wv_err:
        # No GUI backend available (headless CI, no DISPLAY, missing gi/qt)
        print(f"pywebview unavailable ({_wv_err}), running in browser mode.")
        print(f"Opening  {url}  in your browser...")
        webbrowser.open(url)

    # ── Browser / headless mode ────────────────────────────────────────────
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping...")


if __name__ == "__main__":
    main()
