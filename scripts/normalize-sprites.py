#!/usr/bin/env python3
"""
Deterministic pixel-art sprite sheet cropper, background keyer, and 16-color TOYBOX palette quantizer.
Converts AI-generated sprite sheets (e.g., from image-generator) into exact 16x16 palette-indexed
TypeScript grids for Pixer Engine 3.0.

Usage:
  uv run --with pillow python scripts/normalize-sprites.py <input_image>
"""

import math
import sys
from pathlib import Path
from typing import List, Tuple

from PIL import Image

# Exact TOYBOX_PALETTE from src/assets/sprites/PaletteData.ts (indices 1..15, '.' = 0 transparent)
TOYBOX_PALETTE: List[Tuple[str, Tuple[int, int, int]]] = [
    ("1", (0x38, 0x28, 0x20)),  # Espresso outline
    ("2", (0xFF, 0xFA, 0xF0)),  # Warm cream highlight
    ("3", (0xFF, 0xD6, 0xBA)),  # Peach skin / cream
    ("4", (0xFF, 0x70, 0x8D)),  # Strawberry coral
    ("5", (0xD9, 0x3B, 0x60)),  # Berry shade
    ("6", (0x56, 0xD3, 0x9C)),  # Matcha mint
    ("7", (0x23, 0x9B, 0x69)),  # Deep emerald
    ("8", (0xFF, 0xD4, 0x47)),  # Honey butter yellow
    ("9", (0xF5, 0x9B, 0x23)),  # Warm tangerine
    ("a", (0x5E, 0xC2, 0xF7)),  # Sky blueberry
    ("b", (0x2A, 0x7C, 0xD4)),  # Ocean azure
    ("c", (0xE0, 0xAA, 0xFF)),  # Pastel lilac
    ("d", (0x9E, 0x73, 0xD4)),  # Plum soft
    ("e", (0xC7, 0xD4, 0xE6)),  # Cloud mist / emissive high
    ("f", (0x8C, 0x9A, 0xB5)),  # Cool slate / emissive rim
]


def srgb_to_oklab(r: int, g: int, b: int) -> Tuple[float, float, float]:
    def to_lin(c: int) -> float:
        u = c / 255.0
        return u / 12.92 if u <= 0.04045 else ((u + 0.055) / 1.055) ** 2.4

    rl, gl, bl = to_lin(r), to_lin(g), to_lin(b)
    l = math.cbrt(0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl)
    m = math.cbrt(0.2119034982 * rl + 0.6806995451 * gl + 0.1073969566 * bl)
    s = math.cbrt(0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl)
    return (
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    )


PALETTE_LAB = [(ch, rgb, srgb_to_oklab(*rgb)) for ch, rgb in TOYBOX_PALETTE]


def nearest_palette_char(r: int, g: int, b: int) -> str:
    l1, a1, b1 = srgb_to_oklab(r, g, b)
    best_ch = "1"
    best_d = float("inf")
    for ch, _rgb, (l2, a2, b2) in PALETTE_LAB:
        d = (l1 - l2) ** 2 * 1.35 + (a1 - a2) ** 2 + (b1 - b2) ** 2
        if d < best_d:
            best_d = d
            best_ch = ch
    return best_ch


def remove_bg_and_crop(cell: Image.Image, bg_rgb: Tuple[int, int, int], tol: float = 34.0, size: int = 16) -> Image.Image:
    rgba = cell.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()
    br, bg_g, bb = bg_rgb
    min_x, min_y, max_x, max_y = w, h, -1, -1
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            dist = math.sqrt((r - br) ** 2 + (g - bg_g) ** 2 + (b - bb) ** 2)
            if dist < tol or a < 128:
                px[x, y] = (0, 0, 0, 0)
            else:
                if x < min_x:
                    min_x = x
                if y < min_y:
                    min_y = y
                if x > max_x:
                    max_x = x
                if y > max_y:
                    max_y = y
    if max_x < min_x or max_y < min_y:
        return Image.new("RGBA", (size, size), (0, 0, 0, 0))
    cropped = rgba.crop((min_x, min_y, max_x + 1, max_y + 1))
    cw, ch = cropped.size
    side = max(cw, ch)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(cropped, ((side - cw) // 2, (side - ch) // 2))
    return square.resize((size, size), Image.Resampling.NEAREST)


def normalize_cell_to_grid(cell: Image.Image, bg_rgb: Tuple[int, int, int], size: int = 16) -> List[str]:
    norm = remove_bg_and_crop(cell, bg_rgb, size=size)
    px = norm.load()
    rows: List[str] = []
    for y in range(size):
        row_chars = []
        for x in range(size):
            r, g, b, a = px[x, y]
            if a < 128:
                row_chars.append(".")
            else:
                row_chars.append(nearest_palette_char(r, g, b))
        rows.append("".join(row_chars))
    return rows


def flood_fill_bg_mask(rgba: Image.Image, tol: float = 22.0) -> list[list[bool]]:
    w, h = rgba.size
    px = rgba.load()
    br, bg_g, bb, _ = px[2, 2]
    visited = [[False] * w for _ in range(h)]
    stack = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    while stack:
        x, y = stack.pop()
        if x < 0 or x >= w or y < 0 or y >= h or visited[y][x]:
            continue
        r, g, b, a = px[x, y]
        dist = math.sqrt((r - br) ** 2 + (g - bg_g) ** 2 + (b - bb) ** 2)
        if dist > tol and a >= 128:
            continue
        visited[y][x] = True
        stack.append((x + 1, y))
        stack.append((x - 1, y))
        stack.append((x, y + 1))
        stack.append((x, y - 1))
    return visited


def build_hero_strip_32(src_path: Path, out_path: Path) -> None:
    im = Image.open(src_path).convert("RGBA")
    w, h = im.size
    bg_mask = flood_fill_bg_mask(im, tol=20.0)
    px = im.load()
    for y in range(h):
        for x in range(w):
            if bg_mask[y][x]:
                px[x, y] = (0, 0, 0, 0)

    # Detect vertical column pixel weights & split cleanly into 8 frames even if dash rays brush nearby
    col_weights = [sum(1 for y in range(h) if px[x, y][3] > 0) for x in range(w)]
    spans: List[Tuple[int, int]] = []
    in_span = False
    s_start = 0
    for x, wt in enumerate(col_weights):
        if wt > 0 and not in_span:
            in_span = True
            s_start = x
        elif wt == 0 and in_span:
            in_span = False
            if x - s_start >= 10:
                spans.append((s_start, x))
    if in_span and w - s_start >= 10:
        spans.append((s_start, w))

    # Merge tiny detached fragments only if gap <= 2px, then split oversized merged span at deepest vertical valley
    merged: List[Tuple[int, int]] = []
    for sp in spans:
        if merged and sp[0] - merged[-1][1] <= 3:
            merged[-1] = (merged[-1][0], sp[1])
        else:
            merged.append(sp)

    final_spans: List[Tuple[int, int]] = []
    expected_w = w / 8.0
    for x0, x1 in merged:
        if x1 - x0 > expected_w * 1.45:
            # Find valley in inner middle 40%..65% of wide span to split jump & dash cleanly
            lo = x0 + int((x1 - x0) * 0.35)
            hi = x0 + int((x1 - x0) * 0.68)
            split_x = min(range(lo, hi), key=lambda k: col_weights[k])
            final_spans.append((x0, split_x))
            final_spans.append((split_x + 1, x1))
        else:
            final_spans.append((x0, x1))

    # Trim bottom-aligned square 32x32 frame per detected pose (up to 8)
    sheet = Image.new("RGBA", (32 * 8, 32), (0, 0, 0, 0))
    for idx in range(min(8, len(final_spans))):
        x0, x1 = final_spans[idx]
        min_y, max_y = h, -1
        for y in range(h):
            for x in range(x0, x1):
                if px[x, y][3] > 0:
                    if y < min_y:
                        min_y = y
                    if y > max_y:
                        max_y = y
        if max_y < min_y:
            continue
        pose = im.crop((x0, min_y, x1, max_y + 1))
        pw, ph = pose.size
        scale = min(30.0 / pw, 30.0 / ph)
        nw = max(1, round(pw * scale))
        nh = max(1, round(ph * scale))
        resized = pose.resize((nw, nh), Image.Resampling.NEAREST)
        r_px = resized.load()
        for yy in range(nh):
            for xx in range(nw):
                rr, gg, bb, aa = r_px[xx, yy]
                r_px[xx, yy] = (0, 0, 0, 0) if aa < 128 else (rr, gg, bb, 255)
        # Remove isolated 1px/2px floating JPEG halo specks that have <= 1 opaque 8-neighbor
        to_clear = []
        for yy in range(nh):
            for xx in range(nw):
                if r_px[xx, yy][3] == 0:
                    continue
                nb = 0
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        if dx == 0 and dy == 0:
                            continue
                        nx, ny = xx + dx, yy + dy
                        if 0 <= nx < nw and 0 <= ny < nh and r_px[nx, ny][3] > 0:
                            nb += 1
                if nb <= 1:
                    to_clear.append((xx, yy))
        for xx, yy in to_clear:
            r_px[xx, yy] = (0, 0, 0, 0)
        ox = (32 - nw) // 2
        oy = 32 - nh
        sheet.paste(resized, (idx * 32 + ox, oy), resized)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_path, "PNG")
    print(f"Saved 8-frame 32x32 hero strip ({len(final_spans)} segments detected) -> {out_path}")


def build_parallax_bg(src_path: Path, out_path: Path) -> None:
    im = Image.open(src_path).convert("RGBA")
    w0, h0 = im.size
    cropped = im.crop((0, int(h0 * 0.22), w0, h0))
    resized = cropped.resize((480, 180), Image.Resampling.NEAREST)
    px = resized.load()
    w, h = resized.size
    # Smoothly feather upper 28px into transparent alpha so dynamic sky blends seamlessly with zero sharp edge
    for y in range(28):
        t = y / 27.0
        smooth_a = clamp_byte((t * t * (3.0 - 2.0 * t)) * 255.0)
        for x in range(w):
            r, g, b, _ = px[x, y]
            px[x, y] = (r, g, b, smooth_a)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    resized.save(out_path, "PNG")
    print(f"Saved 480x180 parallax background -> {out_path}")


def clamp_byte(v: float) -> int:
    return max(0, min(255, round(v)))


def main() -> int:
    if len(sys.argv) >= 4 and sys.argv[1] == "--engine4-pack":
        hero_src = Path(sys.argv[2])
        bg_src = Path(sys.argv[3])
        out_dir = Path(sys.argv[4]) if len(sys.argv) >= 5 else Path("public/assets/engine4")
        build_hero_strip_32(hero_src, out_dir / "hero_32x32_sheet.png")
        build_parallax_bg(bg_src, out_dir / "parallax_twilight_mountains.png")
        return 0

    if len(sys.argv) < 2:
        print("Usage: normalize-sprites.py <sprite_sheet_image> [output_json] [--size 16|32]")
        return 1
    img_path = Path(sys.argv[1])
    target_size = 32 if "--size" in sys.argv and "32" in sys.argv else 16
    im = Image.open(img_path).convert("RGB")
    w, h = im.size
    bg_rgb = im.getpixel((4, 4))

    # Top row (5 hero poses), Bottom row (4 prop icons) matching image-generator sheet layout
    specs = [
        ("parkour_hero_idle", (0.00, 0.02, 0.19, 0.48)),
        ("parkour_hero_run_a", (0.19, 0.02, 0.39, 0.48)),
        ("parkour_hero_jump", (0.39, 0.02, 0.58, 0.48)),
        ("parkour_hero_wall", (0.58, 0.02, 0.76, 0.48)),
        ("parkour_hero_dash", (0.76, 0.02, 0.99, 0.48)),
        ("grapple_claw", (0.03, 0.50, 0.28, 0.96)),
        ("grapple_ring", (0.28, 0.50, 0.51, 0.96)),
        ("crystal_reset", (0.51, 0.50, 0.73, 0.96)),
        ("zip_block", (0.73, 0.50, 0.97, 0.96)),
    ]

    result = {}
    for name, (x0, y0, x1, y1) in specs:
        cell = im.crop((int(w * x0), int(h * y0), int(w * x1), int(h * y1)))
        result[name] = normalize_cell_to_grid(cell, bg_rgb, size=target_size)

    import json

    out_args = [a for a in sys.argv[2:] if not a.startswith("--") and a not in ("16", "32")]
    out_text = json.dumps(result, indent=2)
    if out_args:
        Path(out_args[0]).write_text(out_text, encoding="utf-8")
    print(out_text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
