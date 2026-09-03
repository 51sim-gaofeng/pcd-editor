# AGENTS.md — 51sim Sensor Data Viewer (pcdviewer)

Guidance for AI coding agents working in this repository. Keep changes minimal and
consistent with the existing dense, compact code style.

## What this is

Web-based sensor visualizer: Python HTTP server + Three.js browser rendering.
Supports static `.pcd`, live UDP/DDS point clouds, real-time LiDAR streams, camera
imagery (GVSP/JPEG), LiDAR-camera **Fusion**, offline **camera calibration**, and
**Gaussian Splatting** (3DGS/PLY).

## Architecture (MVC)

- `config.py` — global config singleton + persistent state (`_read_state`/`_write_state` → `state.json`), `APP_VERSION`.
- `model/` — data + receivers (all pure-Python, no native DLL):
  - `pcd_model.py`, `dds_model.py`, `streaming_model.py`, `camera_model.py`,
    `fusion_model.py` (LiDAR-camera projection), `calibration_model.py` (offline intrinsics), `gaussian_model.py`, `trajectory_model.py`.
- `controller/http_handler.py` — all HTTP routing (`do_GET`/`do_POST`), one handler per `/api/*` route.
- `view/` — `templates/index.html`, `static/ui.js` (UI logic), `static/three_view.js` (3D scene),
  plus `gaussian_view.js` / `splat_renderer.js` / worker files for 3DGS.

## Environment & commands

- Local dev/build uses conda env **`ipm`**: `G:\ws\condal\anaconda3\envs\ipm\python.exe` (Windows). CI uses Python 3.11.
- Run: `python pcd_viewer.py` (opens pywebview window on Windows; browser fallback on Linux).
- Deps: `numpy websockets pywebview pillow opencv-python` (+ `pyinstaller` to build). `cv2` is required for Fusion and Calibration; CI installs `opencv-python-headless`.
- Smoke tests: `python test_smoke.py`, `python test_gs_smoke.py`. CI also runs `python test_smoke.py --exe` against the packaged binary.
- Build (usually leave to CI): `python -m PyInstaller pcd_viewer.spec --clean --noconfirm`.

## Release process

1. Bump `config.APP_VERSION` and add a matching top section to `RELEASE_NOTES.md` (used as the GitHub Release body).
2. Commit to `main` and push.
3. `git tag vX.Y && git push origin vX.Y` — the tag triggers `.github/workflows/release.yml` (Windows + Linux build + release).
4. Artifacts per platform: binary-only zip, `-with-samples.zip` (recursively bundles the whole `sample/` tree, incl. `sample/calibsamples/`), and a Linux `.deb`.

Notes:
- Preference: skip local build, let CI build remotely.
- In PowerShell, `git push` prints progress to stderr which PS reports as "code 1"; a line like `aaa..bbb  main -> main` or `[new tag]` means success.

## Conventions & gotchas

- Match the existing **compact/dense** JS and Python style; don't reformat or add unrequested docstrings/comments.
- Default sensor/DDS addresses are `127.0.0.1` (frontend inputs + backend fallbacks).
- `three_view.js` calls `animate();` synchronously at module load — any `let/const` referenced by `animate()`/`_isInteractive()` must be declared **before** that call (TDZ traps have bitten here repeatedly).
- Before adding a `setInterval`/poller that writes a DOM element, grep the element id first — duplicate pollers on one element cause flicker.
- Native file/folder dialogs use `tkinter` server-side (the embedded WebView2 window can't do `<a download>` — save via a backend Save-As route instead).
- SimOne timestamps: plain `roll/pitch/yaw` in vehicle JSON are **radians**; `SimTimestamp.ms` is 16-bit sim-relative time (wraps ~65.5s) — don't copy C++ SDK parse formulas blindly, check the actual sender.

## Docs & memory

- User-facing feature docs live in `README.md` (Features + API table + Version Highlights).
- Deep implementation postmortems / current TODOs are kept in agent memory (`/memories/repo/pcdviewer.md`); read it for detailed context.
