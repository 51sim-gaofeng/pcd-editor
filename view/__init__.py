"""View helpers — resolves paths to templates and static assets."""
import os

_VIEW_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_DIR = os.path.join(_VIEW_DIR, 'templates')
STATIC_DIR = os.path.join(_VIEW_DIR, 'static')


def get_template(name: str) -> str:
    """Return the text content of a template file."""
    with open(os.path.join(TEMPLATES_DIR, name), encoding='utf-8') as f:
        return f.read()


def get_static_path(name: str) -> str:
    """Return the absolute path to a static asset."""
    return os.path.join(STATIC_DIR, name)
