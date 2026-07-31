"""File-system helpers: PCD file discovery and background preloading."""
import glob
import os
import re

from model.pcd_model import get_pcd_binary_cached


def _natural_key(path: str):
    """Sort key that treats embedded digit runs as integers (e.g. 2.pcd < 10.pcd)."""
    name  = os.path.basename(path)
    parts = re.split(r'(\d+)', name)
    return tuple((int(p), '') if p.isdigit() else (-1, p.lower()) for p in parts)


def list_pcd_files() -> list:
    from config import config
    files = glob.glob(os.path.join(config.data_dir, '**', '*.pcd'), recursive=True)
    files.sort(key=_natural_key)
    return [os.path.relpath(f, config.data_dir) for f in files]


def _preload_all():
    """Pre-build binary cache for all PCD files in data_dir on startup."""
    from config import config
    files = glob.glob(os.path.join(config.data_dir, '**', '*.pcd'), recursive=True)
    files.sort(key=_natural_key)
    for full in files:
        try:
            get_pcd_binary_cached(full)
        except Exception:
            pass
    print(f'Preload done: {len(files)} PCD files cached.')
