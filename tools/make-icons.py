#!/usr/bin/env python3
"""Generate the PNG icons for the URL Saver extension.

This uses only the Python standard library: it renders a rounded indigo
square with a white bookmark at 6x and downsamples for smooth edges.

Usage:
    python3 tools/make-icons.py
"""

import math
import struct
import zlib
from pathlib import Path

SIZES = (16, 32, 48, 128)
SUPERSAMPLE = 6
BACKGROUND_TOP = (99, 102, 241)  # indigo-500
BACKGROUND_BOTTOM = (67, 56, 202)  # indigo-700
FOREGROUND = (255, 255, 255)
BOOKMARK = (
    (0.345, 0.245),
    (0.655, 0.245),
    (0.655, 0.785),
    (0.5, 0.645),
    (0.345, 0.785),
)
OUT_DIR = Path(__file__).resolve().parents[1] / "icons"


def inside_rounded_square(x, y, size):
    radius = size * 0.23
    qx = abs(x - size / 2) - (size / 2 - radius)
    qy = abs(y - size / 2) - (size / 2 - radius)
    return (
        math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) <= 0.0
    )


def inside_polygon(x, y, points):
    inside = False
    j = len(points) - 1

    for i, (xi, yi) in enumerate(points):
        xj, yj = points[j]
        if (yi > y) != (yj > y):
            if x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                inside = not inside
        j = i

    return inside


def mix(start, end, t):
    return tuple(
        round(start_channel + (end_channel - start_channel) * t)
        for start_channel, end_channel in zip(start, end)
    )


def render(size):
    scale = size * SUPERSAMPLE
    bookmark = tuple((x * scale, y * scale) for x, y in BOOKMARK)
    pixels = bytearray()

    for pixel_y in range(size):
        for pixel_x in range(size):
            red_sum = green_sum = blue_sum = alpha_sum = 0.0

            for sample_y in range(SUPERSAMPLE):
                y = pixel_y * SUPERSAMPLE + sample_y + 0.5
                for sample_x in range(SUPERSAMPLE):
                    x = pixel_x * SUPERSAMPLE + sample_x + 0.5

                    if not inside_rounded_square(x, y, scale):
                        continue

                    background = mix(BACKGROUND_TOP, BACKGROUND_BOTTOM, y / scale)
                    color = (
                        FOREGROUND
                        if inside_polygon(x, y, bookmark)
                        else background
                    )

                    red_sum += color[0]
                    green_sum += color[1]
                    blue_sum += color[2]
                    alpha_sum += 1.0

            samples = SUPERSAMPLE * SUPERSAMPLE
            if alpha_sum:
                pixels.extend(
                    (
                        round(red_sum / alpha_sum),
                        round(green_sum / alpha_sum),
                        round(blue_sum / alpha_sum),
                        round((alpha_sum / samples) * 255),
                    )
                )
            else:
                pixels.extend((0, 0, 0, 0))

    return pixels


def png_chunk(tag, data):
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def write_png(path, size, rgba):
    stride = size * 4
    raw = bytearray()

    for y in range(size):
        raw.append(0)  # PNG filter type: none
        raw.extend(rgba[y * stride : (y + 1) * stride])

    png = bytearray(b"\x89PNG\r\n\x1a\n")
    png += png_chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += png_chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += png_chunk(b"IEND", b"")
    path.write_bytes(png)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for size in SIZES:
        path = OUT_DIR / f"icon{size}.png"
        write_png(path, size, render(size))
        print(f"wrote {path.relative_to(OUT_DIR.parent)}")


if __name__ == "__main__":
    main()
