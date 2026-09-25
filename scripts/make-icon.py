#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/make-icon.py —— 生成 Windows 应用图标 build/icon.ico

不依赖任何第三方库（只用标准库 struct/zlib/math），
生成多尺寸 PNG-in-ICO，满足 electron-builder 对 win.icon 的要求（需含 256x256）。

    python scripts/make-icon.py

想换成自己的图标时，直接替换 build/icon.ico 即可（建议 256x256，含多个尺寸）。
"""

import math
import os
import struct
import zlib

SIZES = [16, 24, 32, 48, 64, 128, 256]

BG = (16, 24, 32, 255)  # 深色底
RED = (255, 77, 79, 255)  # 流入
GREEN = (0, 200, 83, 255)  # 流出


def in_round_rect(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    # 四个角
    for cx, cy in ((x0 + r, y0 + r), (x1 - r, y0 + r), (x0 + r, y1 - r), (x1 - r, y1 - r)):
        near_x = (x < x0 + r and cx == x0 + r) or (x > x1 - r and cx == x1 - r)
        near_y = (y < y0 + r and cy == y0 + r) or (y > y1 - r and cy == y1 - r)
        if near_x and near_y:
            if (x - cx) ** 2 + (y - cy) ** 2 > r * r:
                return False
    return True


def pixel(nx, ny):
    """在 0..256 的坐标系里返回该点的 RGBA。"""
    if not in_round_rect(nx, ny, 8, 8, 248, 248, 46):
        return (0, 0, 0, 0)

    r, g, b, a = BG

    # 红色上行曲线（资金流入）
    y_red = 198.0 - 70.0 * math.sin(nx / 256.0 * math.pi)
    if abs(ny - y_red) < 13.0:
        r, g, b = RED[:3]

    # 绿色下行曲线（资金流出）
    y_green = 58.0 + 70.0 * math.sin(nx / 256.0 * math.pi)
    if abs(ny - y_green) < 13.0:
        r, g, b = GREEN[:3]

    return (r, g, b, a)


def make_png(size):
    s = size / 256.0
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # 过滤类型 0
        for x in range(size):
            r, g, b, a = pixel((x + 0.5) / s, (y + 0.5) / s)
            raw += bytes((r, g, b, a))

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8bit RGBA
    idat = zlib.compress(bytes(raw), 9)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", idat)
        + chunk(b"IEND", b"")
    )


def make_ico(sizes):
    images = [(s, make_png(s)) for s in sizes]
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries = b""
    blob = b""
    for s, png in images:
        dim = 0 if s >= 256 else s  # 0 表示 256
        entries += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(png), offset)
        offset += len(png)
        blob += png
    return header + entries + blob


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(root, "build")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "icon.ico")
    data = make_ico(SIZES)
    with open(out, "wb") as f:
        f.write(data)
    print("wrote %s (%d bytes, sizes=%s)" % (out, len(data), SIZES))


if __name__ == "__main__":
    main()
