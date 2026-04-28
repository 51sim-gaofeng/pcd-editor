#!/usr/bin/env python3
"""
Build a .deb package for pcd-viewer after PyInstaller.
Called by CI: python assets/build_deb.py <version> <binary>
  version : e.g.  0.1.1
  binary  : path to the built binary, e.g. dist/pcd_viewer
"""
import os
import stat
import sys
from pathlib import Path

def main():
    if len(sys.argv) < 3:
        print("Usage: build_deb.py <version> <binary>")
        sys.exit(1)

    ver = sys.argv[1].lstrip('v')
    binary = Path(sys.argv[2])
    pkg = 'pcd-viewer'
    arch = 'amd64'
    root = Path('deb_build')
    dist = Path('dist')

    # ── Directory layout ──────────────────────────────────────────────────
    for d in [
        root / 'DEBIAN',
        root / 'usr' / 'local' / 'bin',
        root / 'usr' / 'share' / 'applications',
        root / 'usr' / 'share' / 'pixmaps',
        root / 'usr' / 'share' / 'doc' / pkg,
    ]:
        d.mkdir(parents=True, exist_ok=True)

    # ── Binary ────────────────────────────────────────────────────────────
    import shutil
    dest_bin = root / 'usr' / 'local' / 'bin' / 'pcd-viewer'
    shutil.copy2(binary, dest_bin)
    dest_bin.chmod(dest_bin.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    # ── Icon ──────────────────────────────────────────────────────────────
    icon_src = Path('assets') / 'icon.png'
    if icon_src.exists():
        shutil.copy2(icon_src, root / 'usr' / 'share' / 'pixmaps' / 'pcd-viewer.png')

    # ── DEBIAN/control ────────────────────────────────────────────────────
    (root / 'DEBIAN' / 'control').write_text(
        f"Package: {pkg}\n"
        f"Version: {ver}\n"
        f"Architecture: {arch}\n"
        f"Maintainer: 51sim-gaofeng\n"
        f"Depends: libgtk-3-0, libwebkit2gtk-4.0-37 | libwebkit2gtk-4.1-0\n"
        f"Section: utils\n"
        f"Priority: optional\n"
        f"Description: 4DGS Lidar PCD Viewer\n"
        f" Web-based point cloud visualizer using Three.js.\n"
        f" Supports .pcd files with height/intensity coloring,\n"
        f" lasso selection, trajectory editing, and pywebview native window.\n"
    )

    # ── DEBIAN/postinst ───────────────────────────────────────────────────
    postinst = root / 'DEBIAN' / 'postinst'
    postinst.write_text(
        "#!/bin/sh\n"
        "set -e\n"
        "case \"$1\" in\n"
        "  configure)\n"
        "    if command -v apt-get > /dev/null 2>&1; then\n"
        "      apt-get install -y --no-install-recommends \\\n"
        "        libgtk-3-0 libwebkit2gtk-4.0-37 2>/dev/null || \\\n"
        "      apt-get install -y --no-install-recommends \\\n"
        "        libgtk-3-0 libwebkit2gtk-4.1-0 2>/dev/null || true\n"
        "    fi\n"
        "    ;;\n"
        "esac\n"
        "exit 0\n"
    )
    postinst.chmod(postinst.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    # ── .desktop ──────────────────────────────────────────────────────────
    (root / 'usr' / 'share' / 'applications' / 'pcd-viewer.desktop').write_text(
        "[Desktop Entry]\n"
        "Name=PCD Viewer\n"
        "Comment=4DGS Lidar Point Cloud Viewer\n"
        "Exec=/usr/local/bin/pcd-viewer\n"
        "Icon=pcd-viewer\n"
        "Terminal=false\n"
        "Type=Application\n"
        "Categories=Science;Engineering;\n"
    )

    # ── copyright ─────────────────────────────────────────────────────────
    (root / 'usr' / 'share' / 'doc' / pkg / 'copyright').write_text(
        "Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/\n"
        "Upstream-Name: pcd-viewer\n"
        "License: MIT\n"
    )

    # ── Build deb ─────────────────────────────────────────────────────────
    deb_name = f"{pkg}_{ver}_{arch}.deb"
    deb_path = dist / deb_name
    ret = os.system(f"dpkg-deb --build --root-owner-group {root} {deb_path}")
    if ret != 0:
        sys.exit(ret)

    print(f"Built: {deb_path}  ({deb_path.stat().st_size // 1024} KB)")

    # Write to GITHUB_ENV if available
    github_env = os.environ.get('GITHUB_ENV')
    if github_env:
        with open(github_env, 'a') as f:
            f.write(f"DEB_FILE={deb_name}\n")

if __name__ == '__main__':
    main()
