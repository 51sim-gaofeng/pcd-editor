#!/usr/bin/env python3
"""
Smoke test for 3DGS HTTP path.

Checks:
1) /api/gaussian_files is reachable
2) upload sample/garbage_truck1.ply via /api/upload_ply
3) uploaded file appears in /api/gaussian_files
4) cleanup uploaded file

Usage:
    python test_gs_smoke.py
"""

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

PORT = 18090
HOST = "127.0.0.1"
BASE = f"http://{HOST}:{PORT}"
ROOT = os.path.dirname(__file__)
SCRIPT = os.path.join(ROOT, "pcd_viewer.py")
SAMPLE_PLY = os.path.join(ROOT, "sample", "garbage_truck1.ply")


def _request(path, method="GET", data=None, headers=None, timeout=10):
    req = urllib.request.Request(f"{BASE}{path}", method=method, data=data, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.getheader("Content-Type", ""), r.read()


def _json_get(path):
    sc, _, body = _request(path)
    return sc, json.loads(body.decode("utf-8"))


def wait_ready(max_wait=20):
    deadline = time.time() + max_wait
    while time.time() < deadline:
        try:
            sc, _, _ = _request("/")
            if sc == 200:
                return True
        except Exception:
            pass
        time.sleep(0.3)
    return False


def run():
    print("=" * 60)
    print("3DGS smoke test")
    print("=" * 60)

    if not os.path.exists(SAMPLE_PLY):
        print(f"FAIL: sample file not found: {SAMPLE_PLY}")
        return 1

    cmd = [sys.executable, SCRIPT, "--port", str(PORT), "--no-window"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

    uploaded_rel = None
    try:
        print("Waiting for server ...", end="", flush=True)
        if not wait_ready():
            print(" FAIL")
            out, _ = proc.communicate(timeout=3)
            print(out)
            return 1
        print(" OK")

        sc, data = _json_get("/api/gaussian_files")
        if sc != 200 or "files" not in data:
            print("FAIL: /api/gaussian_files not ready")
            return 1
        print(f"PASS: /api/gaussian_files ({len(data.get('files', []))} files)")

        with open(SAMPLE_PLY, "rb") as f:
            payload = f.read()
        headers = {
            "Content-Type": "application/octet-stream",
            "X-Filename": "garbage_truck1.ply",
            "X-Relpath": "smoke/garbage_truck1.ply",
        }
        sc, _, body = _request("/api/upload_ply", method="POST", data=payload, headers=headers)
        up = json.loads(body.decode("utf-8"))
        if sc != 200 or not up.get("ok"):
            print(f"FAIL: upload failed: {up}")
            return 1
        uploaded_rel = up.get("file", "")
        print(f"PASS: uploaded {uploaded_rel}")

        sc, data = _json_get("/api/gaussian_files")
        files = data.get("files", [])
        if uploaded_rel not in files:
            print("FAIL: uploaded file not listed in /api/gaussian_files")
            return 1
        print("PASS: uploaded file visible in /api/gaussian_files")

        print("Result: all GS smoke checks passed")
        return 0

    except urllib.error.HTTPError as e:
        print(f"FAIL: http error {e.code}: {e.reason}")
        return 1
    except Exception as e:
        print(f"FAIL: {e}")
        return 1
    finally:
        if uploaded_rel:
            abs_uploaded = os.path.join(ROOT, uploaded_rel.replace("/", os.sep))
            try:
                if os.path.exists(abs_uploaded):
                    os.remove(abs_uploaded)
            except Exception:
                pass

        try:
            proc.kill()
            proc.wait(timeout=5)
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(run())
