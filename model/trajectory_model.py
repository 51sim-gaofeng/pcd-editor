"""Trajectory JSON I/O: list, load, and save trajectory files."""
import datetime
import glob
import json
import os


def list_trajectories() -> list:
    from config import config
    os.makedirs(config.traj_dir, exist_ok=True)
    files = sorted(glob.glob(os.path.join(config.traj_dir, '*.json')))
    return [os.path.basename(f) for f in files]


def load_trajectory(fname: str) -> dict:
    from config import config
    full = os.path.realpath(os.path.join(config.traj_dir, fname))
    if not full.startswith(os.path.realpath(config.traj_dir)):
        raise PermissionError('forbidden')
    if not os.path.isfile(full):
        raise FileNotFoundError('not found')
    with open(full) as f:
        return json.load(f)


def save_trajectory(data: dict) -> str:
    from config import config
    if 'waypoints' not in data or not isinstance(data['waypoints'], list):
        raise ValueError('invalid payload: missing waypoints list')
    os.makedirs(config.traj_dir, exist_ok=True)
    fname = data.get('name') or ('traj_' + datetime.datetime.now().strftime('%Y%m%d_%H%M%S') + '.json')
    fname = os.path.basename(fname)
    if not fname.endswith('.json'):
        fname += '.json'
    full = os.path.join(config.traj_dir, fname)
    with open(full, 'w') as f:
        json.dump(data, f, indent=2)
    return fname
