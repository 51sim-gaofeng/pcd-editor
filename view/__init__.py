"""View helpers — resolves paths to templates and static assets.

When running as a PyInstaller one-file exe, data files are extracted to
sys._MEIPASS at runtime, so we resolve relative to that instead of __file__.
"""
import os
import sys

if getattr(sys, 'frozen', False):
    # PyInstaller bundle: data files unpacked to _MEIPASS
    _BASE = sys._MEIPASS
else:
    _BASE = os.path.dirname(os.path.abspath(__file__))

TEMPLATES_DIR = os.path.join(_BASE, 'view', 'templates') if getattr(sys, 'frozen', False) else os.path.join(_BASE, 'templates')
STATIC_DIR    = os.path.join(_BASE, 'view', 'static')    if getattr(sys, 'frozen', False) else os.path.join(_BASE, 'static')


def get_template(name: str) -> str:
    """Return the text content of a template file."""
    with open(os.path.join(TEMPLATES_DIR, name), encoding='utf-8') as f:
        return f.read()


def get_static_path(name: str) -> str:
    """Return the absolute path to a static asset."""
    return os.path.join(STATIC_DIR, name)
