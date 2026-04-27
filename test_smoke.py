#!/usr/bin/env python3
"""
Smoke test for pcd_viewer — tests both source (python pcd_viewer.py)
and packaged exe (dist/pcd_viewer.exe).

Usage:
    python test_smoke.py           # test source
    python test_smoke.py --exe     # test dist/pcd_viewer.exe
"""

import argparse
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error

PORT   = 18089          # use a non-default port to avoid conflicts
HOST   = "127.0.0.1"
BASE   = f"http://{HOST}:{PORT}"
SCRIPT = os.path.join(os.path.dirname(__file__), "pcd_viewer.py")
# Binary name differs by platform: .exe on Windows, no extension on Linux/macOS
_BIN   = "pcd_viewer.exe" if sys.platform == "win32" else "pcd_viewer"
EXE    = os.path.join(os.path.dirname(__file__), "dist", _BIN)

CHECKS = [
    ("GET /",                    "/",                     200, "text/html"),
    ("GET /static/style.css",    "/static/style.css",     200, "text/css"),
    ("GET /static/three_view.js","/static/three_view.js", 200, "javascript"),
    ("GET /static/ui.js",        "/static/ui.js",         200, "javascript"),
    ("GET /api/files",           "/api/files",            200, "application/json"),
]


def _get(path, timeout=5):
    try:
        with urllib.request.urlopen(f"{BASE}{path}", timeout=timeout) as r:
            ct = r.getheader("Content-Type", "")
            body = r.read()
            return r.status, ct, body
    except urllib.error.HTTPError as e:
        return e.code, "", b""
    except Exception as e:
        return None, str(e), b""


def wait_ready(max_wait=15):
    deadline = time.time() + max_wait
    while time.time() < deadline:
        sc, _, _ = _get("/")
        if sc == 200:
            return True
        time.sleep(0.3)
    return False


def run_smoke(cmd, label):
    print(f"\n{'='*60}")
    print(f"  Smoke test: {label}")
    print(f"  Command   : {' '.join(cmd)}")
    print(f"{'='*60}")

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    print("  Waiting for server to start ...", end="", flush=True)
    if not wait_ready():
        proc.kill()
        out, _ = proc.communicate(timeout=3)
        print(f"\n  FAIL — server did not start within 15s\n{out}")
        return False
    print(" OK")

    passed = 0
    failed = 0
    for name, path, expect_status, expect_ct in CHECKS:
        sc, ct, body = _get(path)
        ok = (sc == expect_status) and (expect_ct in ct)
        status_sym = "PASS" if ok else "FAIL"
        print(f"  [{status_sym}]  {name:35s}  HTTP {sc}  {ct[:40]}")
        if not ok:
            failed += 1
        else:
            passed += 1

    proc.kill()
    proc.wait(timeout=5)

    print(f"\n  Result: {passed} passed, {failed} failed")
    return failed == 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", action="store_true", help="Test packaged exe instead of source")
    args = parser.parse_args()

    if args.exe:
        if not os.path.exists(EXE):
            print(f"ERROR: exe not found at {EXE}")
            sys.exit(1)
        cmd   = [EXE, "--port", str(PORT)]
        label = f"exe ({EXE})"
    else:
        cmd   = [sys.executable, SCRIPT, "--port", str(PORT)]
        label = f"source ({SCRIPT})"

    ok = run_smoke(cmd, label)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
