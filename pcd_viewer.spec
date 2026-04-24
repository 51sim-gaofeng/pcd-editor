# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for pcd_viewer — lean build.
Excludes heavy unused packages (matplotlib, PyQt5, scipy, numba, MKL, etc.)
to keep exe size small.
"""
import os

block_cipher = None

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
    'wx', 'gi', 'gtk',
    'docutils', 'sphinx',
    'test', 'unittest',
    'xml.etree', 'xmlrpc',
    'pydoc', 'turtle', 'curses',
    'pywin32', 'pythoncom', 'pywintypes', 'win32api', 'win32com',
    'setuptools', 'pkg_resources',
    'distutils',
    'multiprocessing.popen_spawn_win32',
]

a = Analysis(
    ['pcd_viewer.py'],
    pathex=['.'],
    binaries=[],
    datas=[
        (os.path.join('view', 'templates'), os.path.join('view', 'templates')),
        (os.path.join('view', 'static'),    os.path.join('view', 'static')),
    ],
    hiddenimports=[
        'numpy',
        'tkinter',
        'tkinter.filedialog',
    ],
    hookspath=[],
    hooksconfig={
        # Tell numpy hook NOT to include MKL/BLAS test/benchmark data
        'numpy': {'hiddenimports': [], 'excludedimports': ['numpy.core._multiarray_tests']},
    },
    runtime_hooks=[],
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
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
    onefile=True,
)
