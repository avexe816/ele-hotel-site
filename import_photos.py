#!/usr/bin/env python3
"""Import the client's real hotel photography into assets/img as webp pairs."""
import os
import sys
from pathlib import Path

sys.path.insert(0, "/home/user/workspace/ele-hotel-wood16/tools")
from import_image import convert  # noqa: E402

SRC = Path("/home/user/workspace/hotel_photos")

# slug -> { output-key : source filename }
MAP = {
    "ginza-east": {
        "hero": ("ele-hotel-ginza", "首页图片.jpg"),
        "ext": ("ele-hotel-ginza", "外观图片.jpg"),
        "bath": ("ele-hotel-ginza", "卫生间图片.jpg"),
        "shower": ("ele-hotel-ginza", "淋浴间图片.jpg"),
        "double": ("ele-hotel-ginza", "double图片.jpg"),
        "twin": ("ele-hotel-ginza", "双床图片.jpg"),
        "single": ("ele-hotel-ginza", "single图片.jpg"),
    },
    "higashi-ueno": {
        "hero": ("ele-hotel-uneo", "首页图片.jpg"),
        "ext": ("ele-hotel-uneo", "外观图片.jpg"),
        "bath": ("ele-hotel-uneo", "卫生间图片.jpg"),
        "single": ("ele-hotel-uneo", "single图片.jpg"),
        "double": ("ele-hotel-uneo", "大床房图片.jpg"),
        "semi": ("ele-hotel-uneo", "经济大床图片.jpg"),
    },
    "higashi-nihonbashi": {
        "hero": ("ele-hotel-nihonbashi", "首页图片.jpg"),
        "ext": ("ele-hotel-nihonbashi", "外观.jpg"),
        "lobby": ("ele-hotel-nihonbashi", "大厅图片 .jpg"),
        "bath": ("ele-hotel-nihonbashi", "卫生间图片.jpg"),
        "double": ("ele-hotel-nihonbashi", "大床图片1.jpg"),
        "econ": ("ele-hotel-nihonbashi", "首页图片111.jpg"),
        "twin": ("ele-hotel-nihonbashi", "双床图片.jpg"),
        "twin2": ("ele-hotel-nihonbashi", "双床图片2.jpg"),
    },
    "shinjuku-cabin": {
        "hero": ("ele-hotel-cabin", "首页图片.jpg"),
        "ext": ("ele-hotel-cabin", "外观图片.jpg"),
        "ext2": ("ele-hotel-cabin", "外观.jpg"),
        "locker": ("ele-hotel-cabin", "更衣室图片.jpg"),
        "wash": ("ele-hotel-cabin", "洗手间图片.jpg"),
        "bath": ("ele-hotel-cabin", "卫生间图片.jpg"),
        "cabin": ("ele-hotel-cabin", "卧室图片.jpg"),
    },
    "kuzuha": {
        "hero": ("ele-hotel-kuzuha", "首页图片.jpg"),
        "desk": ("ele-hotel-kuzuha", "前台图片.jpg"),
        "lounge": ("ele-hotel-kuzuha", "卧室图片.jpg"),
        "bath": ("ele-hotel-kuzuha", "卫生间图片.jpg"),
        "single": ("ele-hotel-kuzuha", "single图片.jpg"),
        "double": ("ele-hotel-kuzuha", "大床图片.jpg"),
        "twin": ("ele-hotel-kuzuha", "双床图片.jpg"),
    },
    "sendai-higashiguchi": {
        "hero": ("ele-hotel-sendai", "首页图片.jpg"),
        "desk": ("ele-hotel-sendai", "前台图片 .jpg"),
        "lobby": ("ele-hotel-sendai", "大厅图片.jpg"),
        "dining": ("ele-hotel-sendai", "餐厅图片.jpg"),
        "laundry": ("ele-hotel-sendai", "洗衣机图片.jpg"),
        "amenity": ("ele-hotel-sendai", "洗漱图片.jpg"),
        "bath": ("ele-hotel-sendai", "卫生间图片.jpg"),
        "single": ("ele-hotel-sendai", "大床图片.jpg"),
        "twin": ("ele-hotel-sendai", "双床图片.jpg"),
    },
}

if __name__ == "__main__":
    total = 0
    for slug, items in MAP.items():
        print(f"### {slug}")
        for key, (folder, fname) in items.items():
            src = SRC / folder / fname
            if not src.exists():
                print(f"  !! missing {src}")
                continue
            convert(src, f"p-{slug}-{key}")
            total += 1
    print(f"\n{total} photos imported")
