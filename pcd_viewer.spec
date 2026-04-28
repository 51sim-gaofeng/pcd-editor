# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for pcd_viewer — lean build.
Excludes heavy unused packages (matplotlib, PyQt5, scipy, numba, MKL, etc.)
to keep binary size small.
Supports both Windows and Linux.
"""
import os, sys
from PyInstaller.utils.hooks import collect_all, collect_submodules

block_cipher = None

# App icon (embedded at build time)
_icon = os.path.join('assets', 'icon.ico') if sys.platform == 'win32' \
    else os.path.join('assets', 'icon.png')

# Collect pywebview files — Windows only; Linux uses browser mode (no gi bundling)
if sys.platform == 'win32':
    _wv_d, _wv_b, _wv_h = collect_all('webview')
else:
    _wv_d, _wv_b, _wv_h = [], [], []

# gi (PyGObject) not bundled — C extension cannot be reliably frozen
_gi_d, _gi_b, _gi_h = [], [], []

# Packages to exclude (pulled in transitively by numpy/pandas but unused here)
EXCLUDES = [
    'matplotlib', 'mpl_toolkits',
    'PyQt5', 'PyQt6', 'PySide2', 'PySide6',
    'scipy', 'sklearn', 'skimage',
    'numba', 'llvmlite',
    'IPython', 'jupyter', 'notebook', 'nbformat', 'nbconvert',
    'tornado', 'zmq', 'traitlets', 'jinja2',
    'PIL', 'Pillow',
    'cv2', 'imageio',
    'sqlalchemy', 'psycopg2',
    'cryptography', 'OpenSSL',
    'wx',
    # NOTE: do NOT exclude gi/gtk — pywebview needs them on Linux
    'docutils', 'sphinx',
    'test', 'unittest',
    'xml.etree', 'xmlrpc',
    'pydoc', 'turtle', 'curses',
    'setuptools', 'pkg_resources',
    # NOTE: do NOT exclude distutils — pywebview/pythonnet dependency chain needs it
]

# Windows-only modules — harmless to skip on Linux (they don't exist there)
if sys.platform == 'win32':
    EXCLUDES += [
        'pywin32', 'pythoncom', 'pywintypes', 'win32api', 'win32com',
        'multiprocessing.popen_spawn_win32',
    ]

a = Analysis(
    ['pcd_viewer.py'],
    pathex=['.'],
    binaries=[] + _wv_b + _gi_b,
    datas=[
        (os.path.join('view', 'templates'), os.path.join('view', 'templates')),
        (os.path.join('view', 'static'),    os.path.join('view', 'static')),
    ] + _wv_d + _gi_d,
    hiddenimports=[
        'numpy',
        'tkinter',
        'tkinter.filedialog',
        # pythonnet/clr — pywebview WinForms backend (Windows)
        'clr',
        'clr_loader',
        'pythonnet',
    ] + _wv_h + _gi_h + collect_submodules('webview'),
    hookspath=['hooks'],
    hooksconfig={
        # Tell numpy hook NOT to include MKL/BLAS test/benchmark data
        'numpy': {'hiddenimports': [], 'excludedimports': ['numpy.core._multiarray_tests']},
    },
    runtime_hooks=[],
    # rthook_gi.py was removed — gi is no longer bundled on Linux
    excludes=EXCLUDES,
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

# Remove MKL and other large Intel/BLAS DLLs that numpy links but we don't need
# (numpy's pure C code is in _multiarray_umath.pyd, not in MKL)
MKL_PREFIXES = ('mkl_', 'libiomp', 'libmmd', 'svml_', 'libirc', 'impi',
                'msmpi', 'pgc', 'pgmath', 'pgf', 'ze_', 'sycl',
                'omptarget')

def _keep(tup):
    name = os.path.basename(tup[0]).lower()
    return not any(name.startswith(p) for p in MKL_PREFIXES)

a.binaries = [t for t in a.binaries if _keep(t)]
a.datas    = [t for t in a.datas    if _keep(t)]

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='pcd_viewer',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,  # no black terminal window when launched via pywebview
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=_icon,
    onefile=True,
)
