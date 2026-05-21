# 4DGS Lidar PCD Viewer

Web-based 3D point cloud visualizer powered by Python (HTTP server) + Three.js (browser rendering). Supports both static `.pcd` files and **live point clouds via UDP/DDS**.

---

## Quick Start

```bash
# Default: opens current directory, port 8089
python pcd_viewer.py

# Specify data directory and port
python pcd_viewer.py --dir /path/to/pcd/files --port 8089 --ip 0.0.0.0

# Customize DDS receiver (default: broadcast 255.255.255.255:9870)
python pcd_viewer.py --udp-ip 239.255.0.1 --udp-port 9870 --dds-ws-port 9090

# Legacy positional form (backward compatible)
python pcd_viewer.py /path/to/pcd/files 8089
```

Open **http://localhost:8089** in your browser, or just launch the binary on Windows (a native pywebview window opens automatically).

---

## Features

### Static PCD viewing
- ASCII / binary / `binary_compressed` PCD parsing with multi-tier disk cache
- Drag-and-drop upload, native OS file/folder pickers, recursive directory browsing
- Playback engine for sequential frame folders, with seek bar and FPS control
- Lasso / eraser / pick / waypoint editing modes; undo / save edited PCD
- Z-height filter, color modes (height / intensity / flat), free-fly camera

### DDS Live (real-time UDP point cloud)
- **Lazy startup**: UDP listener and WebSocket server only spin up when you click `📡 DDS Live` (zero overhead at idle)
- **Auto-detected protocol**: unicast / **broadcast** (`255.255.255.255` or `x.x.x.255`) / **multicast** (`224.0.0.0`–`239.255.255.255`) — based on the IP you enter; broadcast is default
- **Live broadcaster IP echo**: status bar shows `udp: 255.255.255.255:9870 (running) ← from 192.168.1.42:51234`
- **DDS Live / Pause / Stop** tri-state — Pause freezes rendering but keeps the WS subscription, so resume snaps to the latest frame
- **Adaptive max-points budget** (Foxglove-style): dynamically downsamples when render time spikes, ramps back up when headroom returns
- 250k points stable at 10 fps end-to-end (10–15ms transit on localhost)

### Camera Receiver (GVSP/JPEG over UDP)
- Dedicated Camera mode for live image stream rendering (separate from PCD and GS modes).
- Long-poll frame fetch path (`/api/camera_frame`) with frame-id incremental pull.
- Connect/Stop control for receiver lifecycle (`/api/camera_ensure`) with bind IP/port configuration.
- Real-time status updates: frame id, resolution, and FPS badge.
- Camera mode and DDS mode are mutually exclusive to avoid receiver conflicts.

#### Camera Tab controls
- `Bind IP`: local bind IP used by Camera receiver.
- `Port`: UDP port for incoming camera packets.
- `Connect / Stop`: start or stop Camera receiving loop.
- `Show FPS badge`: toggle on-screen FPS display.
- `cam-status`: shows current receiver state and latest frame metadata.
- `cam-bind-status`: shows current bind/listen endpoint and running status.

### Gaussian Splatting (3DGS / PLY)
- Dedicated GS mode for `.ply` assets with drag-and-drop upload and server-side file listing
- Shader-side model rotation using Roll / Pitch / Yaw (degrees), with covariance-consistent transform
- Pivot-aware rotation (`p' = R(p - pivot) + pivot`) synchronized across rendering and depth sorting
- Double-click viewport to set GS rotation pivot for faster interactive alignment
- Spherical Harmonics color fixes: channel-grouped mapping + corrected view-direction usage to reduce purple artifacts

#### 3DGS Tab controls
- `GS File`: select a `.ply` file from the server list, then load into GS mode.
- `SH Level`: switch SH degree (`0`-`3`) to balance quality and performance.
- `Model Rotation (deg)`: adjust `Roll / Pitch / Yaw`; values apply immediately on change.
- `Reset Rotation`: reset all three rotation angles back to `0`.
- `Color Adjust`: tune `Brightness / Contrast / Saturation / Temperature / Hue` in real time.
- `Reset Color`: restore color adjustment sliders to default values.
- Status area (`loading / load ms / info`): shows current load state, load time, and splat/fps info.
- In-view interaction: double-click inside viewport while GS tab is active to set the rotation pivot.


### Visualization aids
- Square or **circle** ground grid (concentric rings + 30° spokes)
- Configurable coordinate labels every N meters (default 10 m) on ±X / ±Y axes
- Custom right-click "Copy" menu inside inputs / log panel (no DevTools popup in pywebview)

---

## CLI options

| Flag             | Default            | Description                                       |
|------------------|--------------------|---------------------------------------------------|
| `--ip`           | `127.0.0.1`        | HTTP bind address                                 |
| `--port`         | `8089`             | HTTP listen port                                  |
| `--dir`          | last used / cwd    | Data directory containing `.pcd` files            |
| `--no-window`    | off                | Headless HTTP server (no pywebview window)        |
| `--udp-ip`       | `255.255.255.255`  | DDS UDP source — single host, broadcast, or multicast |
| `--udp-port`     | `9870`             | DDS UDP listen port                               |
| `--dds-ws-port`  | `port + 1`         | WebSocket port serving live point cloud to browser |

---

## Project Structure (MVC)

```
pcdviewer/
├── pcd_viewer.py               # Entry point — parse args, start HTTP server
├── config.py                   # Global runtime configuration singleton
│
├── model/                      # Data layer — pure Python, no HTTP/UI
│   ├── pcd_model.py            # PCD parsing, binary serialization, caching
│   ├── file_model.py           # File discovery, background preloading
│   ├── trajectory_model.py     # Trajectory JSON I/O
│   └── dds_model.py            # UDP receiver + WebSocket fast-path server
│
├── controller/                 # HTTP routing layer
│   └── http_handler.py         # All GET/POST request handlers
│
└── view/                       # Presentation layer
    ├── __init__.py             # get_template(), get_static_path() helpers
    ├── templates/
    │   └── index.html          # Main HTML page
    └── static/
        ├── style.css           # All CSS
        ├── three_view.js       # Three.js ES module — 3D scene, window._three API
        ├── ui.js               # Sidebar / playback / DDS / edit UI logic
        └── dds_fetch_worker.js # Web Worker — WebSocket parser, posts frames to main
```

---

## Architecture

### Config (`config.py`)

A singleton `_Config` object shared across all modules. Updated at runtime when the user picks a new directory via the UI.

| Attribute        | Default              | Description                       |
|------------------|----------------------|-----------------------------------|
| `data_dir`       | script dir           | Root directory for PCD files      |
| `port`           | `8089`               | HTTP listen port                  |
| `host`           | `127.0.0.1`          | HTTP bind address                 |
| `udp_host`       | `255.255.255.255`    | DDS UDP source IP                 |
| `udp_port`       | `9870`               | DDS UDP port                      |
| `dds_ws_port`    | `port + 1`           | WebSocket port to browser         |
| `traj_dir`       | computed             | `{data_dir}/trajectories`         |

```python
from config import config
print(config.data_dir)
```

### Model

#### `model/pcd_model.py`
- `parse_pcd(path)` — reads `.pcd` files (ASCII / binary / binary_compressed). Uses pandas fast path → numpy fallback → line-by-line fallback. Downsamples to 300k pts.
- `save_pcd(path, points, fields)` — writes ASCII PCD.
- `pcd_to_binary(pcd)` — serializes to compact binary format: `[4B meta_len][JSON meta][align pad][float32 points]`.
- `get_pcd_binary_cached(full_path)` — three-tier cache: in-memory → `.pcd_cache/` on disk → parse from source.

#### `model/file_model.py`
- `list_pcd_files()` — recursive glob under `config.data_dir`, natural-order sorted.
- `_preload_all()` — background thread that pre-parses all PCD files on startup.

#### `model/trajectory_model.py`
- `list_trajectories()` — list JSON files in `config.traj_dir`.
- `load_trajectory(fname)` — load + path-traverse guard.
- `save_trajectory(data)` — auto-timestamped filename if none provided.

#### `model/dds_model.py`
- `start_udp_listener(port, host)` — UDP socket; auto-detects unicast/broadcast/multicast, sets `SO_REUSEADDR` + `SO_BROADCAST`, joins multicast group when applicable, handles fragmented frames (`<HHI>` total_slices/slice_idx/total_len).
- `start_ws_server(port, host)` — WebSocket server pushing the latest frame to all clients in compact 20-byte binary format (no compression, `TCP_NODELAY`, 8 MB SNDBUF).
- `ensure_dds_started(...)` — idempotent lazy starter used by `/api/dds_ensure`.
- `set_max_live_points(n)` — runtime downsample cap.
- `get_status()` / `get_receiver_config()` / `get_stream_config()` — telemetry exposed to the UI; includes the most recent broadcaster IP.

### Controller (`controller/http_handler.py`)

All HTTP routing. Static files under `/static/*` are served from `view/static/`.

| Method | Path                          | Description                              |
|--------|-------------------------------|------------------------------------------|
| GET    | `/`                           | Serve `index.html`                       |
| GET    | `/static/<name>`              | Serve CSS / JS assets                    |
| GET    | `/api/files`                  | List PCD files (relative paths)          |
| GET    | `/api/pcd_binary`             | Binary-encoded PCD (cached)              |
| GET    | `/api/pcd_abs`                | Binary PCD by absolute path              |
| GET    | `/api/browse`                 | Directory listing                        |
| GET    | `/api/trajectory`             | List or load trajectory JSON             |
| GET    | `/api/pick_file`              | Native OS file picker (tkinter)          |
| GET    | `/api/pick_dir`               | Native OS folder picker (tkinter)        |
| GET    | `/api/set_dir`                | Change data directory                    |
| GET    | `/api/open_in_explorer`       | Open directory in Explorer               |
| GET    | `/api/dds_ensure`             | Lazy-start UDP + WS (idempotent)         |
| GET    | `/api/dds_status`             | Frame id, recv count, age, receiver/stream info |
| GET    | `/api/dds_receiver_config`    | UDP bind host/port + last sender IP      |
| GET    | `/api/dds_stream_config`      | WS host/port + connected client count    |
| GET    | `/api/dds_rebind?ip&port`     | Rebind UDP receiver to a new host:port   |
| GET    | `/api/dds_set_max_points`     | Adjust DDS downsample cap                |
| GET    | `/api/camera_frame`           | Long-poll latest camera JPEG frame       |
| GET    | `/api/camera_status`          | Camera receiver status + telemetry       |
| GET    | `/api/camera_ensure`          | Ensure/start camera receiver             |
| GET    | `/api/camera_rebind`          | Rebind camera receiver IP/port           |
| GET    | `/api/gaussian_files`         | List available `.ply` files for GS mode |
| POST   | `/api/trajectory`             | Save trajectory JSON                     |
| POST   | `/api/save_pcd`               | Save edited point cloud                  |
| POST   | `/api/upload_pcd`             | Receive drag-and-drop PCD upload         |
| POST   | `/api/upload_ply`             | Receive drag-and-drop PLY upload (GS)    |

### View

#### `view/static/three_view.js` (ES module)
Owns the Three.js scene. Exposes `window._three` API consumed by `ui.js`:

| Method                          | Description                         |
|---------------------------------|-------------------------------------|
| `loadPoints(floats, nf, fields)`| Replace scene point cloud           |
| `updateLive(floats, nf, fields)`| Fast-path update for DDS live mode (single-pass loop, color LUT, pre-allocated buffers) |
| `exitLiveMode()`                | Reset live buffers / range carry    |
| `setPointSize(s)`               | Update point sprite size            |
| `setColorMode(m)`               | `'height'` / `'intensity'` / `'flat'` |
| `setFlip(x, y, z)`              | Axis flip (±1)                      |
| `resetCamera()`                 | Restore default camera pose         |
| `setView(preset)`               | `'3d'`/`'top'`/`'front'`/`'left'`/`'free'` |
| `applyFilter(zMin, zMax, mode)` | Z-height filter                     |
| `deleteSelected()`              | Remove lasso/eraser-selected points |
| `undoDelete()`                  | Restore last deletion               |
| `getEditedPoints()` / `getFields()` | Read current point data         |
| Waypoint API                    | `undoWaypoint`, `clearWaypoints`, `getWaypoints`, `loadWaypoints`, `deleteWaypointAt` |

`window._grid` controls the ground grid:

| Method                 | Description                                    |
|------------------------|------------------------------------------------|
| `setStyle('square'\|'circle')` | Switch grid geometry                  |
| `setSize(size, divisions)`     | Recompute grid + axis labels          |
| `setLabelStep(meters)`         | Spacing between coordinate labels     |
| `setVisible(bool)`             | Show/hide grid + labels               |

#### `view/static/ui.js` (deferred script)
Handles all sidebar interactions, keyboard shortcuts, playback engine, drag-and-drop upload, directory browser, log panel, and the DDS Live state machine. Spawns `dds_fetch_worker.js` to keep WebSocket parsing off the main thread.

**Keyboard shortcuts:**

| Key        | Action                    |
|------------|---------------------------|
| `Space`    | Play / Pause              |
| `← / →`    | Step frame                |
| `P`        | 3D view                   |
| `T`        | Top view                  |
| `F`        | Free-fly mode toggle      |
| `B`        | Toggle sidebar            |
| `L`        | Toggle log panel          |
| `Esc`      | Exit all modes / close modal |

---

## Binary PCD Protocol (file → browser)

The server encodes each PCD frame as a compact binary blob for zero-copy transfer:

```
[4 bytes little-endian uint32] meta_len
[meta_len bytes UTF-8 JSON]   {"fields":[...], "npoints":N, "original_count":M, "file":"..."}
[0-3 bytes padding]           align to 4 bytes
[N × nfields × 4 bytes]       float32 point data, row-major
```

The JavaScript `_parsePcdBuf(buf)` function decodes this with a zero-copy `Float32Array` view.

## DDS Live Protocols

### UDP input (lidar publisher → pcd_viewer)
```
Single packet:  ['PC2\0' (4B)][ts_ns u64][frame_id u32][npoints u32][N × 16B (x,y,z,intensity float32)]
Fragmented:     [total_slices u16][slice_idx u16][total_len u32][payload bytes …]
```

### WebSocket output (pcd_viewer → browser)
```
['PCL2' (4B)][frame_id u32 LE][npoints u32 LE][t_store_ms u64 LE]
[N × 16B (x, y, z, intensity float32)]
```
Header is 20 bytes, kept 4-byte aligned so the float view starts at offset 20. Server uses `compression=None` and `TCP_NODELAY` to keep transit latency in the single-digit ms range.

---

## Disk Cache

Parsed binary frames are cached under `<pcd_dir>/.pcd_cache/`:

```
.pcd_cache/
  frame_001.pcd.bin       # serialized float32 binary
  frame_001.pcd.bin.mtime # source file mtime for invalidation
```

Cache is invalidated automatically when the source `.pcd` file is modified.

---

## Dependencies

| Package      | Required | Purpose                              |
|--------------|----------|--------------------------------------|
| `numpy`      | ✅ Yes   | Array operations, binary parsing     |
| `websockets` | ✅ Yes   | DDS live WebSocket server            |
| `pywebview`  | Windows  | Native desktop window (auto-falls back to browser) |
| `pillow`     | Build    | App icon generation                  |
| `pandas`     | Optional | 10-20× faster ASCII PCD parsing      |
| `python-lzf` | Optional | `binary_compressed` PCD support      |
| `tkinter`    | Optional | Native OS file/folder picker dialogs |

Install runtime deps:
```bash
pip install numpy websockets pywebview pillow
# Optional speedups:
pip install pandas python-lzf
```

---

## Extending the Project

- **New API endpoint**: add a method to the appropriate model, then add a route in `controller/http_handler.py`.
- **New UI panel**: add HTML to `view/templates/index.html`, CSS to `view/static/style.css`, logic to `view/static/ui.js`.
- **New 3D feature**: extend `window._three` in `view/static/three_view.js`.
- **New DDS hook**: extend `model/dds_model.py`, expose via a new `/api/dds_*` route, wire UI into `view/static/ui.js`.
- **Config change**: update `config.py`; all modules pick it up via the shared `config` singleton.

---

## Version Highlights

### v0.1.4.1
- 3DGS pivot-aware rotation pipeline aligned between shader transform and depth-sort path.
- Roll/Pitch/Yaw model rotation controls stabilized for interactive tuning.
- Double-click viewport pivot placement improved for faster rotation-center selection.
- SH color regression fixes reduce purple/violet artifacts on road-like surfaces.

### v0.1.4
- 3DGS onboarding and usability upgrades (GS hint layer, default panel expansion, PLY upload flow).
- Rendering quality fixes (radii propagation, less aggressive vertex clipping, natural file sorting for GS assets).
- GS UI simplification (removed Scale/Max controls with safer defaults).
- Added `test_gs_smoke.py` and standardized release SOP.

### v0.1.3
- Added Camera Receiver mode (GVSP JPEG over UDP) with live status telemetry.
- Added Edit Pick workflow improvements (double-click pick toggle, DDS pick support, adaptive pick radius).
- Added native Save-As export for trajectories in pywebview.
- Improved DDS view switching and pause/resume behavior; reduced disconnect traceback noise.

### v0.1.2
- Introduced DDS Live real-time point-cloud streaming (UDP ingest + WebSocket binary push).
- Added unicast/broadcast/multicast auto-detection and sender IP echo.
- Added DDS tri-state controls and lazy-start runtime model.
- Performance and UX upgrades (compact protocol, adaptive point budget, grid/label improvements, packaging robustness).

For full details, see `RELEASE_NOTES.md`.

---

## Release SOP (all future versions)

Use the same pipeline for every release (starting from `v0.1.4`):

1. Update `README.md` (feature/API changes) and `RELEASE_NOTES.md` (new version section).
2. Run tests:
  - `python test_smoke.py`
  - `python test_gs_smoke.py`
3. Build package locally:
  - `python -m PyInstaller pcd_viewer.spec --clean --noconfirm`
4. Commit changes:
  - `git add -A`
  - `git commit -m "release: vX.Y.Z"`
5. Push branch/tag:
  - `git push origin main`
  - `git tag vX.Y.Z`
  - `git push origin vX.Y.Z`
6. GitHub Actions workflow `.github/workflows/release.yml` builds/upload assets automatically.

Notes:
- `sample/garbage_truck1.ply` is included in sample assets and should be shipped together with other samples.
- `test_gs_smoke.py` verifies 3DGS endpoints, including PLY upload.

