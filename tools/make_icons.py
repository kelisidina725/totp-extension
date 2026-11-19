"""Generate flat PNG icons for the TOTP extension using only the standard library."""
import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
SS = 4
BLUE = (26, 115, 232)
WHITE = (255, 255, 255)


def inside_round_rect(x, y, size, radius):
    m = size * 0.04
    if x < m or y < m or x > size - m or y > size - m:
        return False
    cx = min(max(x, m + radius), size - m - radius)
    cy = min(max(y, m + radius), size - m - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2


def inside_clock(x, y, size):
    cx = cy = size / 2
    dx, dy = x - cx, y - cy
    d = (dx * dx + dy * dy) ** 0.5
    outer = size * 0.34
    inner = size * 0.265
    if inner <= d <= outer:
        return True
    if d < size * 0.035:
        return True
    if -size * 0.02 <= dx <= size * 0.02 and -size * 0.20 <= dy <= 0:
        return True
    if 0 <= dx <= size * 0.135 and -size * 0.02 <= dy <= size * 0.02:
        return True
    return False


def render(size):
    rows = []
    scale = SS
    for py in range(size):
        row = bytearray()
        for px in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(scale):
                for sx in range(scale):
                    x = px + (sx + 0.5) / scale
                    y = py + (sy + 0.5) / scale
                    if not inside_round_rect(x, y, size, size * 0.22):
                        continue
                    color = WHITE if inside_clock(x, y, size) else BLUE
                    acc[0] += color[0]
                    acc[1] += color[1]
                    acc[2] += color[2]
                    acc[3] += 255
            n = scale * scale
            if acc[3] == 0:
                row.extend((0, 0, 0, 0))
            else:
                a = acc[3] / n
                r = round(acc[0] / (acc[3] / 255))
                g = round(acc[1] / (acc[3] / 255))
                b = round(acc[2] / (acc[3] / 255))
                row.extend((r, g, b, round(a)))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    raw = b"".join(b"\x00" + row for row in rows)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (16, 48, 128):
        target = os.path.join(OUT_DIR, f"icon{size}.png")
        write_png(target, size, render(size))
        print(f"generated {target} ({os.path.getsize(target)} bytes)")
