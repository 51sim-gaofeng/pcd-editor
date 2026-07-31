"""
PyInstaller runtime hook: set GI_TYPELIB_PATH so the bundled gi module can
find system WebKit2GTK and GTK typelib files when running as a frozen binary
on Linux.  The deb package declares libwebkit2gtk-4.0-37 | libwebkit2gtk-4.1-0
as dependencies, so the typelib files are guaranteed to exist.
"""
import sys
import os

if sys.platform != 'win32' and getattr(sys, 'frozen', False):
    _candidates = [
        '/usr/lib/x86_64-linux-gnu/girepository-1.0',
        '/usr/lib/girepository-1.0',
        '/usr/local/lib/girepository-1.0',
        '/usr/lib/aarch64-linux-gnu/girepository-1.0',  # arm64
    ]
    _paths = [p for p in _candidates if os.path.isdir(p)]
    if _paths:
        existing = os.environ.get('GI_TYPELIB_PATH', '')
        os.environ['GI_TYPELIB_PATH'] = ':'.join(_paths) + (':' + existing if existing else '')
