"""Global mutable application configuration."""
import os
import sys
import json
import argparse
import subprocess

APP_NAME = '51sim Sensor Data Viewer'
APP_VERSION = '0.6'

_REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
_app_info_cache = None


def get_app_info() -> dict:
    """Return app name/version/git-commit/build-time metadata (cached).

    - `build_time` prefers the `PCDVIEWER_BUILD_TIME` env var (settable by CI/build
      scripts); falls back to the git commit date; falls back to 'unknown'.
    - `git_commit` comes from `git rev-parse --short HEAD`; 'unknown' if unavailable
      (e.g. running from a PyInstaller bundle without a `.git` directory).
    """
    global _app_info_cache
    if _app_info_cache is not None:
        return _app_info_cache

    git_commit = 'unknown'
    git_date = ''
    try:
        out = subprocess.run(
            ['git', 'rev-parse', '--short', 'HEAD'],
            cwd=_REPO_ROOT, capture_output=True, text=True, timeout=2)
        if out.returncode == 0 and out.stdout.strip():
            git_commit = out.stdout.strip()
    except Exception:
        pass
    try:
        out = subprocess.run(
            ['git', 'log', '-1', '--format=%cI'],
            cwd=_REPO_ROOT, capture_output=True, text=True, timeout=2)
        if out.returncode == 0 and out.stdout.strip():
            git_date = out.stdout.strip()
    except Exception:
        pass

    build_time = os.environ.get('PCDVIEWER_BUILD_TIME', '') or git_date or 'unknown'

    _app_info_cache = {
        'app_name': APP_NAME,
        'version': APP_VERSION,
        'git_commit': git_commit,
        'build_time': build_time,
        'platform': sys.platform,
    }
    return _app_info_cache


def _state_path() -> str:
    """Return path to the persistent state file (~/.config/pcd_viewer/state.json)."""
    if sys.platform == 'win32':
        base = os.environ.get('APPDATA', os.path.expanduser('~'))
    else:
        base = os.path.join(os.path.expanduser('~'), '.config')
    return os.path.join(base, '51sim_sensor_viewer', 'state.json')


def _read_state() -> dict:
    """Return the full persisted state dict, or {} if missing/corrupt."""
    try:
        with open(_state_path(), 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def _write_state(patch: dict) -> None:
    """Merge `patch` into the persisted state file and write it back."""
    try:
        p = _state_path()
        os.makedirs(os.path.dirname(p), exist_ok=True)
        state = _read_state()
        state.update(patch)
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(state, f)
    except Exception:
        pass


def save_last_dir(path: str) -> None:
    """Persist the last-used data directory."""
    _write_state({'last_dir': path})


def _load_last_dir() -> str:
    """Return the last-used directory, or '' if not saved."""
    path = _read_state().get('last_dir', '')
    return path if path and os.path.isdir(path) else ''


def get_welcome_pref() -> bool:
    """Return whether the welcome screen should be shown on startup (default True)."""
    return bool(_read_state().get('show_welcome_on_startup', True))


def set_welcome_pref(show: bool) -> None:
    """Persist the welcome-screen-on-startup preference."""
    _write_state({'show_welcome_on_startup': bool(show)})


class _Config:
    """Holds runtime-mutable settings shared across all modules."""

    def __init__(self):
        self.data_dir: str = ''
        self.port: int = 9089
        self.host: str = '127.0.0.1'
        self.no_window: bool = False
        self.udp_host: str = '255.255.255.255'
        self.udp_port: int = 9870
        self.dds_ws_port: int = 9090
        self.streaming_udp_host: str = '127.0.0.1'
        self.streaming_udp_port: int = 6699
        self.streaming_info_port: int = 7788

    @property
    def traj_dir(self) -> str:
        return os.path.join(self.data_dir, 'trajectories')


config = _Config()


def init_from_args(argv):
    ap = argparse.ArgumentParser(
        prog='51sim_sensor_viewer',
        description='51sim Sensor Data Viewer (Three.js web UI)',
    )
    ap.add_argument('--ip',   default='127.0.0.1', help='HTTP bind address (default: 127.0.0.1)')
    ap.add_argument('--port', type=int, default=9089, help='HTTP port (default: 9089)')
    ap.add_argument('--dir',       default=None,  help='Data directory containing .pcd files')
    ap.add_argument('--no-window', action='store_true', dest='no_window',
                    help='Disable pywebview; run as headless HTTP server only')
    ap.add_argument('--udp-port', type=int, default=9870, dest='udp_port',
                    help='UDP port for DDS live point cloud (default: 9870)')
    ap.add_argument('--udp-ip', type=str, default='255.255.255.255', dest='udp_host',
                    help='UDP bind address for DDS receiver (default: 255.255.255.255)')
    ap.add_argument('--dds-ws-port', type=int, default=None, dest='dds_ws_port',
                    help='WebSocket port for DDS live stream (default: HTTP port + 1)')
    ap.add_argument('--streaming-udp-port', type=int, default=6699, dest='streaming_udp_port',
                    help='UDP port for SimOne Streaming MSOP point cloud (default: 6699)')
    ap.add_argument('--streaming-udp-ip', type=str, default='127.0.0.1', dest='streaming_udp_host',
                    help='UDP bind address for SimOne Streaming receiver (default: 127.0.0.1)')
    ap.add_argument('--streaming-info-port', type=int, default=7788, dest='streaming_info_port',
                    help='UDP port for SimOne Streaming DIFOP calibration (default: 7788)')
    ap.add_argument('positional', nargs='*', help='[DIR] [PORT] (legacy positional form)')
    a = ap.parse_args(argv)

    if a.positional:
        if len(a.positional) >= 1 and a.dir is None:
            a.dir = a.positional[0]
        if len(a.positional) >= 2:
            try:
                a.port = int(a.positional[1])
            except ValueError:
                pass

    if a.dir is None:
        last = _load_last_dir()
        if last:
            a.dir = last
        elif getattr(sys, 'frozen', False):
            a.dir = os.path.dirname(os.path.abspath(sys.executable))
        else:
            a.dir = os.path.dirname(os.path.abspath(__file__))

    config.data_dir = a.dir
    config.port = a.port
    config.host = a.ip
    config.no_window = a.no_window
    config.udp_host = a.udp_host
    config.udp_port = a.udp_port
    config.dds_ws_port = a.dds_ws_port if a.dds_ws_port is not None else (a.port + 1)
    config.streaming_udp_host = a.streaming_udp_host
    config.streaming_udp_port = a.streaming_udp_port
    config.streaming_info_port = a.streaming_info_port
