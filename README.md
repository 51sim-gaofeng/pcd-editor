# 4DGS Lidar PCD Viewer

Web-based 3D point cloud visualizer powered by Python (HTTP server) + Three.js (browser rendering).

---

## Quick Start

```bash
# Default: opens current directory, port 8089
python pcd_viewer.py

# Specify data directory and port
python pcd_viewer.py --dir /path/to/pcd/files --port 8089 --ip 0.0.0.0

# Legacy positional form (backward compatible)
python pcd_viewer.py /path/to/pcd/files 8089
```

Open **http://localhost:8089** in your browser.

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
│   └── trajectory_model.py     # Trajectory JSON I/O
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
        └── ui.js               # Sidebar / playback / edit UI logic
```

---

## Architecture

### Config (`config.py`)

A singleton `_Config` object shared across all modules. Updated at runtime when the user picks a new directory via the UI.

| Attribute   | Default       | Description                  |
|-------------|---------------|------------------------------|
| `data_dir`  | script dir    | Root directory for PCD files |
| `port`      | `8089`        | HTTP listen port             |
| `host`      | `127.0.0.1`   | HTTP bind address            |
| `traj_dir`  | computed      | `{data_dir}/trajectories`    |

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

### Controller (`controller/http_handler.py`)

All HTTP routing. Static files under `/static/*` are served from `view/static/`.

| Method | Path                   | Description                        |
|--------|------------------------|------------------------------------|
| GET    | `/`                    | Serve `index.html`                 |
| GET    | `/static/<name>`       | Serve CSS / JS assets              |
| GET    | `/api/files`           | List PCD files (relative paths)    |
| GET    | `/api/pcd_binary`      | Binary-encoded PCD (cached)        |
| GET    | `/api/pcd_abs`         | Binary PCD by absolute path        |
| GET    | `/api/browse`          | Directory listing                  |
| GET    | `/api/trajectory`      | List or load trajectory JSON       |
| GET    | `/api/pick_file`       | Native OS file picker (tkinter)    |
| GET    | `/api/pick_dir`        | Native OS folder picker (tkinter)  |
| GET    | `/api/set_dir`         | Change data directory              |
| GET    | `/api/open_in_explorer`| Open directory in Explorer         |
| POST   | `/api/trajectory`      | Save trajectory JSON               |
| POST   | `/api/save_pcd`        | Save edited point cloud            |
| POST   | `/api/upload_pcd`      | Receive drag-and-drop PCD upload   |

### View

#### `view/static/three_view.js` (ES module)
Owns the Three.js scene. Exposes `window._three` API consumed by `ui.js`:

| Method                          | Description                         |
|---------------------------------|-------------------------------------|
| `loadPoints(floats, nf, fields)`| Replace scene point cloud           |
| `setPointSize(s)`               | Update point sprite size            |
| `setColorMode(m)`               | `'height'` / `'intensity'` / `'flat'` |
| `setFlip(x, y, z)`             | Axis flip (±1)                      |
| `resetCamera()`                 | Restore default camera pose         |
| `setView(preset)`               | `'3d'`/`'top'`/`'front'`/`'left'`/`'free'` |
| `applyFilter(zMin, zMax, mode)` | Z-height filter                     |
| `deleteSelected()`              | Remove lasso/eraser-selected points |
| `undoDelete()`                  | Restore last deletion               |
| `getEditedPoints()` / `getFields()` | Read current point data         |
| Waypoint API                    | `undoWaypoint`, `clearWaypoints`, `getWaypoints`, `loadWaypoints`, `deleteWaypointAt` |

#### `view/static/ui.js` (deferred script)
Handles all sidebar interactions, keyboard shortcuts, playback engine, drag-and-drop upload, directory browser, and log panel. Calls `window._three.*` for scene updates.

**Keyboard shortcuts:**

| Key        | Action                    |
|------------|---------------------------|
| `Space`    | Play / Pause              |
| `← / →`   | Step frame                |
| `P`        | 3D view                   |
| `T`        | Top view                  |
| `F`        | Free-fly mode toggle      |
| `B`        | Toggle sidebar            |
| `L`        | Toggle log panel          |
| `Esc`      | Exit all modes / close modal |

---

## Binary PCD Protocol

The server encodes each PCD frame as a compact binary blob for zero-copy transfer:

```
[4 bytes little-endian uint32] meta_len
[meta_len bytes UTF-8 JSON]   {"fields":[...], "npoints":N, "original_count":M, "file":"..."}
[0-3 bytes padding]           align to 4 bytes
[N × nfields × 4 bytes]       float32 point data, row-major
```

The JavaScript `_parsePcdBuf(buf)` function decodes this with a zero-copy `Float32Array` view.

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

| Package   | Required | Purpose                              |
|-----------|----------|--------------------------------------|
| `numpy`   | ✅ Yes   | Array operations, binary parsing     |
| `pandas`  | Optional | 10-20× faster ASCII PCD parsing      |
| `python-lzf` | Optional | `binary_compressed` PCD support   |
| `tkinter` | Optional | Native OS file/folder picker dialogs |

Install optional speedups:
```bash
pip install pandas python-lzf
```

---

## Extending the Project

- **New API endpoint**: add a method to the appropriate model, then add a route in `controller/http_handler.py`.
- **New UI panel**: add HTML to `view/templates/index.html`, CSS to `view/static/style.css`, logic to `view/static/ui.js`.
- **New 3D feature**: extend `window._three` in `view/static/three_view.js`.
- **Config change**: update `config.py`; all modules pick it up via the shared `config` singleton.
