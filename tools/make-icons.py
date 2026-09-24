"""Generate the app icons (no dependencies): WORK-green ground with the progress ring.

Run: python3 tools/make-icons.py
"""
import math
import struct
import zlib
from pathlib import Path

GREEN = (0x22, 0xD1, 0x6A)
INK = (0x04, 0x14, 0x0A)
OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
SS = 4  # supersampling for anti-aliased edges


def pixel(x, y, size):
    """Color at (x, y) in unit coordinates centred on the icon."""
    c = size / 2
    dx, dy = x - c, y - c
    r = math.hypot(dx, dy) / size
    # angle clockwise from 12 o'clock, 0..360
    ang = (math.degrees(math.atan2(dx, -dy)) + 360) % 360
    track = 0.255 <= r <= 0.335
    if track and ang <= 270:
        return INK
    if track:
        return tuple(round(g * 0.78 + i * 0.22) for g, i in zip(GREEN, INK))
    # rounded cap at the end of the arc and dot at the start
    for a in (0, 270):
        px = c + math.sin(math.radians(a)) * 0.295 * size
        py = c - math.cos(math.radians(a)) * 0.295 * size
        if math.hypot(x - px, y - py) <= 0.04 * size:
            return INK
    return GREEN


def png(size):
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            acc = [0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    col = pixel(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS, size)
                    for i in range(3):
                        acc[i] += col[i]
            row += bytes(round(v / SS / SS) for v in acc)
        rows.append(bytes(row))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"".join(rows), 9))
            + chunk(b"IEND", b""))


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size in (("apple-touch-icon.png", 180), ("icon-192.png", 192), ("icon-512.png", 512)):
        (OUT / name).write_bytes(png(size))
        print("wrote", OUT / name)
