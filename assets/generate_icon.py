#!/usr/bin/env python3
"""
Generate pcd-viewer app icon (PNG + multi-size ICO) using Pillow.
Run: python assets/generate_icon.py
Outputs: assets/icon.png, assets/icon.ico
"""
import math
import random
from pathlib import Path


def height_color(t):
    """Map t in [0,1] to height-map RGBA (blue -> cyan -> green -> yellow -> red)."""
    colors = [
        (0.1, 0.1, 0.9),
        (0.0, 0.8, 0.8),
        (0.0, 0.85, 0.1),
        (0.9, 0.9, 0.0),
        (0.9, 0.1, 0.1),
    ]
    t = max(0.0, min(1.0, t)) * (len(colors) - 1)
    lo = int(t)
    hi = min(len(colors) - 1, lo + 1)
    f = t - lo
    r = colors[lo][0] + (colors[hi][0] - colors[lo][0]) * f
    g = colors[lo][1] + (colors[hi][1] - colors[lo][1]) * f
    b = colors[lo][2] + (colors[hi][2] - colors[lo][2]) * f
    return (int(r * 255), int(g * 255), int(b * 255), 220)


def generate(size=256):
    from PIL import Image, ImageDraw, ImageFilter

    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    cx = cy = size // 2
    bg_r = size // 2 - 2

    # ── Dark circular background ──────────────────────────────────────────
    draw.ellipse(
        [cx - bg_r, cy - bg_r, cx + bg_r, cy + bg_r],
        fill=(10, 14, 28, 255),
    )

    # ── Perspective grid (ground plane) ──────────────────────────────────
    grid_y0 = cy + size // 8
    for gy in range(7):
        y = grid_y0 + gy * (size // 11)
        if y > size - 8:
            break
        scale = 0.25 + gy * 0.12
        x1 = int(cx - scale * (size // 2))
        x2 = int(cx + scale * (size // 2))
        draw.line([(x1, y), (x2, y)], fill=(30, 60, 110, 70), width=1)
    for gx in range(-5, 6):
        x_top = cx + gx * (size // 11)
        x_bot = cx + gx * (size // 4)
        draw.line(
            [(x_top, grid_y0), (x_bot, size - 8)],
            fill=(30, 60, 110, 70),
            width=1,
        )

    # ── LiDAR point cloud (isometric) ────────────────────────────────────
    rng = random.Random(1337)

    pts_3d = []
    # Ground scatter
    for _ in range(160):
        x = rng.uniform(-75, 75)
        y = rng.uniform(-45, 75)
        z = rng.gauss(0, 2.5)
        pts_3d.append((x, y, z))

    # Car-like elevated object in centre
    for _ in range(120):
        x = rng.uniform(-28, 28)
        y = rng.uniform(-14, 14)
        envelope = math.exp(-((x / 24) ** 2 + (y / 11) ** 2) * 0.6)
        z = rng.uniform(4, 36) * envelope
        if z > 2:
            pts_3d.append((x, y, z))

    # Paint back-to-front
    pts_3d.sort(key=lambda p: p[0] + p[1])

    for x3, y3, z3 in pts_3d:
        # Isometric projection
        px = cx + x3 * 0.78 - y3 * 0.42
        py = cy + x3 * 0.22 + y3 * 0.28 - z3 * 0.92

        # Clip to background circle
        if (px - cx) ** 2 + (py - cy) ** 2 > (bg_r - 7) ** 2:
            continue

        t = (z3 + 5) / 42.0
        color = height_color(t)
        dr = rng.uniform(1.4, 3.2)
        draw.ellipse([px - dr, py - dr, px + dr, py + dr], fill=color)

    # ── Glow pass ─────────────────────────────────────────────────────────
    glow = img.filter(ImageFilter.GaussianBlur(radius=2))
    img = Image.alpha_composite(glow, img)

    # ── Thin ring border ──────────────────────────────────────────────────
    rim = ImageDraw.Draw(img)
    rim.ellipse(
        [cx - bg_r, cy - bg_r, cx + bg_r, cy + bg_r],
        outline=(50, 130, 220, 180),
        width=3,
    )

    # ── Save PNG ──────────────────────────────────────────────────────────
    out = Path(__file__).parent
    png = out / "icon.png"
    img.save(png, "PNG")
    print(f"Saved: {png}  ({png.stat().st_size // 1024} KB)")

    # ── Save multi-size ICO ───────────────────────────────────────────────
    ico = out / "icon.ico"
    sizes = [16, 32, 48, 64, 128, 256]
    frames = [img.resize((s, s), Image.LANCZOS).convert("RGBA") for s in sizes]
    # PIL ICO: save largest first, append smaller
    frames[-1].save(
        ico,
        format="ICO",
        append_images=frames[:-1],
    )
    print(f"Saved: {ico}  ({ico.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    generate()
