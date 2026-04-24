"""Global mutable application configuration."""
import os
import sys
import argparse


class _Config:
    """Holds runtime-mutable settings shared across all modules."""

    def __init__(self):
        self.data_dir: str = ''
        self.port: int = 8089
        self.host: str = '127.0.0.1'

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
    ap.add_argument('--dir',  default=None, help='Data directory containing .pcd files')
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
        if getattr(sys, 'frozen', False):
            a.dir = os.path.dirname(os.path.abspath(sys.executable))
        else:
            a.dir = os.path.dirname(os.path.abspath(__file__))

    config.data_dir = a.dir
    config.port = a.port
    config.host = a.ip
