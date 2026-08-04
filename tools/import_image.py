#!/usr/bin/env python3
"""图片导入工具 / Image import helper.

用法:
    python3 tools/import_image.py <源图片> <目标名称>

例:
    python3 tools/import_image.py ~/Desktop/ginza.jpg h-ginza-east

会在 assets/img/ 下生成两个文件:
    <目标名称>.webp      最长边 1800px, 质量 80  (桌面)
    <目标名称>-sm.webp   最长边 900px,  质量 76  (手机)

生成后在 data/hotels.json 里把该酒店的 "img" 写成 <目标名称> 即可。
"""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "img"


def convert(src: Path, name: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    im = Image.open(src).convert("RGB")
    for suffix, max_side, quality in (("", 1800, 80), ("-sm", 900, 76)):
        copy = im.copy()
        copy.thumbnail((max_side, max_side), Image.LANCZOS)
        dst = OUT / f"{name}{suffix}.webp"
        copy.save(dst, "WEBP", quality=quality, method=6)
        print(f"  {dst.relative_to(ROOT)}  {copy.width}x{copy.height}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    source = Path(sys.argv[1]).expanduser()
    if not source.exists():
        print(f"找不到文件: {source}")
        sys.exit(1)
    convert(source, sys.argv[2])
    print("完成。接着运行: python3 build.py")
