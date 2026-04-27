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
from model.file_model import _preload_all, list_pcd_files



def main():
    init_from_args(sys.argv[1:])
    ThreadingHTTPServer.allow_reuse_address = True
    server = ThreadingHTTPServer((config.host, config.port), Handler)
    server.daemon_threads = True
    _disp_host = 'localhost' if config.host in ('0.0.0.0', '127.0.0.1', '::') else config.host
    print(f"PCD Viewer  ->  http://{_disp_host}:{config.port}  (bind {config.host})")
    print(f"Data dir  : {config.data_dir}")
    n_files = len(list_pcd_files())
    print(f"PCD files : {n_files} found")
    print("Ctrl+C to stop.")
    if n_files > 0:
        threading.Thread(target=_preload_all, daemon=True).start()
        print(f"Preloading {n_files} files in background...")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping...")


if __name__ == "__main__":
    main()
