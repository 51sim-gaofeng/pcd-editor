"""Global mutable application configuration."""
import os
import sys
import json
import argparse


def _state_path() -> str:
    """Return path to the persistent state file (~/.config/pcd_viewer/state.json)."""
    if sys.platform == 'win32':
        base = os.environ.get('APPDATA', os.path.expanduser('~'))
    else:
        base = os.path.join(os.path.expanduser('~'), '.config')
    return os.path.join(base, 'pcd_viewer', 'state.json')


def save_last_dir(path: str) -> None:
    """Persist the last-used data directory."""
    try:
        p = _state_path()
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'w', encoding='utf-8') as f:
            json.dump({'last_dir': path}, f)
    except Exception:
        pass


def _load_last_dir() -> str:
    """Return the last-used directory, or '' if not saved."""
    try:
        with open(_state_path(), 'r', encoding='utf-8') as f:
            d = json.load(f)
        path = d.get('last_dir', '')
        return path if path and os.path.isdir(path) else ''
    except Exception:
        return ''


class _Config:
    """Holds runtime-mutable settings shared across all modules."""

    def __init__(self):
        self.data_dir: str = ''
        self.port: int = 8089
        self.host: str = '127.0.0.1'
        self.no_window: bool = False
        self.udp_host: str = '255.255.255.255'
        self.udp_port: int = 9870
        self.dds_ws_port: int = 8090

    @property
    def traj_dir(self) -> str:
        return os.path.join(self.data_dir, 'trajectories')


config = _Config()


def init_from_args(argv):
    ap = argparse.ArgumentParser(
        prog='pcd_viewer',
        description='4DGS Lidar PCD Viewer (Three.js web UI)',
    )
    ap.add_argument('--ip',   default='127.0.0.1', help='HTTP bind address (default: 127.0.0.1)')
    ap.add_argument('--port', type=int, default=8089, help='HTTP port (default: 8089)')
    ap.add_argument('--dir',       default=None,  help='Data directory containing .pcd files')
    ap.add_argument('--no-window', action='store_true', dest='no_window',
                    help='Disable pywebview; run as headless HTTP server only')
    ap.add_argument('--udp-port', type=int, default=9870, dest='udp_port',
                    help='UDP port for DDS live point cloud (default: 9870)')
    ap.add_argument('--udp-ip', type=str, default='255.255.255.255', dest='udp_host',
                    help='UDP bind address for DDS receiver (default: 127.0.0.1)')
    ap.add_argument('--dds-ws-port', type=int, default=None, dest='dds_ws_port',
                    help='WebSocket port for DDS live stream (default: HTTP port + 1)')
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
