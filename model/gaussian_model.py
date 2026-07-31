"""Gaussian Splatting file discovery — lists .ply files under data_dir."""
import glob
import os
import re


def _natural_key(path: str):
    # Sort by full relative path so directory structure participates in ordering.
    norm = path.replace('\\', '/').lower()
    parts = re.split(r'(\d+)', norm)
    return tuple((int(p), '') if p.isdigit() else (-1, p) for p in parts)


def list_gaussian_files() -> list:
    from config import config
    files = glob.glob(os.path.join(config.data_dir, '**', '*.ply'), recursive=True)
    rel_files = [os.path.relpath(f, config.data_dir).replace('\\', '/') for f in files]
    rel_files.sort(key=_natural_key)
    return rel_files
