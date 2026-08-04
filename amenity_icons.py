"""Line-illustration icons for the room/hotel facility grid (40x40, currentColor strokes)."""

_O = '<svg viewBox="0 0 40 40" fill="none" aria-hidden="true" class="amic" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'
_C = "</svg>"


def _s(body):
    return _O + body + _C


ICONS = {
    # Free Wi-Fi
    "wifi": _s(
        '<path d="M6 16.5a20 20 0 0128 0"/><path d="M10.5 22a13.5 13.5 0 0119 0"/>'
        '<path d="M15 27.5a7 7 0 0110 0"/><circle cx="20" cy="32" r="1.6" fill="currentColor" stroke="none"/>'
    ),
    # 24-hour front desk
    "front": _s(
        '<path d="M6 28h28"/><path d="M9 28v-3.5a11 11 0 0122 0V28"/><path d="M20 13.5V11"/>'
        '<path d="M6 32h28"/><circle cx="20" cy="9.5" r="1.6" fill="currentColor" stroke="none"/>'
    ),
    # Non-smoking
    "nosmoke": _s(
        '<rect x="6" y="21" width="21" height="6" rx="2"/><path d="M29 21h5v6h-5"/>'
        '<path d="M23 12.5c3 1.5 3 4 1.5 5.5"/><path d="M8 32L32 8"/>'
    ),
    # Private bath with tub
    "bath": _s(
        '<path d="M5 21h30v4a6 6 0 01-6 6H11a6 6 0 01-6-6z"/><path d="M11 21v-9a3.5 3.5 0 017 0v1"/>'
        '<path d="M25.5 14.5h6"/><path d="M28.5 11.5v3"/><path d="M11 34l2-3M29 34l-2-3"/>'
    ),
    # Shared showers
    "shower": _s(
        '<path d="M20 6v7"/><path d="M8 17c0-5.5 5.4-9.5 12-9.5S32 11.5 32 17z" transform="translate(0 -3)"/>'
        '<path d="M13 20v3M17 21.5v3.5M20 19.5v4M23 21.5v3.5M27 20v3"/>'
        '<path d="M15 29v2.5M20 28.5v3M25 29v2.5"/>'
    ),
    # Washlet toilet
    "toilet": _s(
        '<rect x="10.5" y="5" width="19" height="30" rx="9.5"/>'
        '<path d="M14 11.5h12"/>'
        '<ellipse cx="20" cy="23" rx="5.5" ry="7"/>'
    ),
    # Fridge
    "fridge": _s('<rect x="11" y="6" width="18" height="28" rx="3"/><path d="M11 17h18"/><path d="M15 11v3M15 21v4"/>'),
    # Flat-screen TV
    "tv": _s('<rect x="5" y="9" width="30" height="19" rx="2.5"/><path d="M14 33h12"/><path d="M20 28v5"/>'),
    # Electric kettle
    "kettle": _s(
        '<path d="M11 17h16l-1.5 14a2 2 0 01-2 1.8H14.5a2 2 0 01-2-1.8z"/><path d="M11 17l-4-4"/>'
        '<path d="M27 20.5c3 .5 4.5 2.5 4.5 5"/><path d="M16 12.5h7"/>'
    ),
    # Amenity set
    "amenity": _s(
        '<path d="M13.5 15h6l1 17a1.8 1.8 0 01-1.8 2h-4.4A1.8 1.8 0 0112.5 32z"/><path d="M15 11h3v4h-3z"/>'
        '<path d="M25 34V20"/><path d="M25 20c3.5 0 5-2 5-5h-10c0 3 1.5 5 5 5z"/>'
    ),
    # Towels
    "towel": _s(
        '<path d="M8.5 9.5v3.5M31.5 9.5v3.5"/><path d="M6 12.8h28"/>'
        '<path d="M11.5 12.8h17v17.4c0 1.1-.9 2-2 2h-13c-1.1 0-2-.9-2-2z"/>'
        '<path d="M15 17.5v6.5M19 17.5v4"/>'
    ),
    # Loungewear & slippers
    "wear": _s(
        '<path d="M15 8l-6 3 1.5 6 2.5-1v16h14V16l2.5 1L31 11l-6-3"/><path d="M15 8c0 3 2.2 4.5 5 4.5S25 11 25 8"/>'
    ),
    # Coin laundry
    "laundry": _s(
        '<rect x="8" y="6" width="24" height="28" rx="3"/><circle cx="20" cy="23" r="7"/>'
        '<path d="M14.5 23a5 5 0 015.5 2 5 5 0 015.5 2"/><path d="M13 11h3M20 11h6"/>'
    ),
    # Lockers
    "locker": _s(
        '<rect x="8" y="6" width="24" height="28" rx="2.5"/><path d="M20 6v28"/><path d="M16 15h1M23 15h1"/>'
        '<path d="M12 10h4M24 10h4"/>'
    ),
    # Microwave
    "microwave": _s(
        '<rect x="5" y="11" width="30" height="18" rx="2.5"/><rect x="9" y="15" width="15" height="10" rx="1.5"/>'
        '<path d="M28.5 16v2M28.5 22v4"/>'
    ),
    # Trouser press / iron
    "iron": _s(
        '<path d="M6 27h22a6 6 0 00-6-6H10a4 4 0 00-4 4z"/><path d="M6 31h24"/><path d="M18 21v-4a3 3 0 013-3h9"/>'
    ),
    # Breakfast
    "breakfast": _s(
        '<path d="M6 20h15a7.5 7.5 0 01-15 0z"/><path d="M8 25.5h11"/><path d="M13.5 12c-2 2 0 4 0 4"/>'
        '<path d="M26 12v9M30 12v9"/><path d="M26 25c0 4 4 4 4 0"/><path d="M24.5 21h7"/>'
    ),
    # Café
    "cafe": _s(
        '<path d="M8 13h18v9a7 7 0 01-7 7h-4a7 7 0 01-7-7z"/><path d="M26 15.5h3.5a3.5 3.5 0 010 7H26"/>'
        '<path d="M8 33h20"/>'
    ),
    # Premium mattress / bed
    "bed": _s(
        '<path d="M5 30V16"/><path d="M5 30h30v-6a5 5 0 00-5-5H5"/><path d="M12 19v-4h10a4 4 0 014 4"/>'
        '<path d="M5 33h30"/>'
    ),
    # Desk / workspace
    "desk": _s(
        '<rect x="13" y="12" width="14" height="9" rx="1.5"/><path d="M6 25h28"/>'
        '<path d="M10 25v9M30 25v9"/>'
    ),
    # Air conditioning
    "aircon": _s(
        '<rect x="5" y="9" width="30" height="10" rx="3"/><path d="M10 14h20"/>'
        '<path d="M12 24c2 0 2 3 4 3M20 24c2 0 2 3 4 3M27 24c1.6 0 1.6 3 3.2 3"/>'
    ),
    # Onsen bath
    "onsen": _s(
        '<path d="M5 24h30a10 10 0 01-10 8H15a10 10 0 01-10-8z"/><path d="M14 19c-2-2 0-4 0-6M20 19c-2-2 0-4 0-6'
        'M26 19c-2-2 0-4 0-6"/>'
    ),
    # Meals
    "meal": _s(
        '<circle cx="21" cy="19.5" r="8.5"/>'
        '<path d="M6 6v8a3 3 0 003 3v17"/><path d="M34 6c0 6-2.5 7-2.5 10.5V34"/>'
    ),
    # Parking
    "parking": _s(
        '<rect x="7" y="7" width="26" height="26" rx="5"/><path d="M17 27V14h4.5a4.5 4.5 0 010 9H17"/>'
    ),
    # --- room amenities (v1.9) -------------------------------------------
    # Slippers (pair)
    "slipper": _s(
        '<path d="M11 7.5c3.2 0 5.4 2.5 5.4 5.9v13.2c0 3.4-2.2 5.9-5.4 5.9s-5.4-2.5-5.4-5.9V13.4C5.6 10 7.8 7.5 11 7.5z"/>'
        '<path d="M6.2 16.6c1.5 1.7 3.1 2.5 4.8 2.5s3.3-.8 4.8-2.5"/>'
        '<path d="M29 7.5c3.2 0 5.4 2.5 5.4 5.9v13.2c0 3.4-2.2 5.9-5.4 5.9s-5.4-2.5-5.4-5.9V13.4c0-3.4 2.2-5.9 5.4-5.9z"/>'
        '<path d="M24.2 16.6c1.5 1.7 3.1 2.5 4.8 2.5s3.3-.8 4.8-2.5"/>'
    ),
    # Hair dryer
    "dryer": _s(
        '<g transform="rotate(-32 20 20)">'
        '<path d="M22 9.5a8.5 8.5 0 010 17H8.6a2.1 2.1 0 01-2.1-2.1V11.6a2.1 2.1 0 012.1-2.1z"/>'
        '<path d="M13.4 26.5v4.6a2.6 2.6 0 002.6 2.6h1.3a2.6 2.6 0 002.6-2.6v-4.6"/>'
        '<path d="M10.4 15h5.2"/></g>'
        '<path d="M30.6 8.8c2 1.5 2 3.9 0 5.4M34.6 6.6c2.9 2.4 2.9 6.9 0 9.3"/>'
    ),
    # Shampoo + treatment tube (pair)
    "shampoo": _s(
        '<path d="M6 18.5h9.5V32a2 2 0 01-2 2H8a2 2 0 01-2-2z"/><path d="M8.6 18.5v-3.2h4.3v3.2"/>'
        '<path d="M10.8 15.3V12M9 10.4h3.6"/><path d="M6 24h9.5"/>'
        '<path d="M22.5 18.5h11.5V32a2 2 0 01-2 2H24.5a2 2 0 01-2-2z"/><path d="M25.4 18.5l1.4-4.6h4.9l1.4 4.6"/>'
        '<path d="M26.8 13.9V11h4.9v2.9"/>'
    ),
    # Conditioner (single squat bottle with band)
    "conditioner": _s(
        '<path d="M11 15.5h18V31a3 3 0 01-3 3H14a3 3 0 01-3-3z"/>'
        '<path d="M14.5 15.5V11a2 2 0 012-2h7a2 2 0 012 2v4.5"/>'
        '<path d="M11 21h18M11 26.5h18"/>'
    ),
    # Body shampoo (pump bottle)
    "bodysoap": _s(
        '<path d="M12 17h16V31a3 3 0 01-3 3H15a3 3 0 01-3-3z"/><path d="M16 17v-3.5h8V17"/>'
        '<path d="M20 13.5V9.5h5.5a2.5 2.5 0 012.5 2.5"/><path d="M12 22.5h16M12 28h16"/>'
    ),
    # In-room robe / loungewear (館内着)
    "robe": _s(
        '<path d="M13.6 7.2L20 14.6l6.4-7.4 6.4 3.7-2.5 6.8-2.4-1.3V33H12V16.4l-2.4 1.3-2.5-6.8z"/>'
        '<path d="M13.6 7.2L20 21.5l6.4-14.3"/>'
        '<path d="M11.6 24.6h17"/><path d="M11.6 28.2h17"/>'
    ),
    # Satellite / channels fall back to tv; generic info fallback
    "info": _s('<circle cx="20" cy="20" r="13"/><path d="M20 18v9M20 13.5v1.5"/>'),
}

# keyword -> icon key (checked in order, matched against ja + en text)
RULES = [
    (("スリッパ", "slipper"), "slipper"),
    (("ドライヤー", "hair dryer", "dryer"), "dryer"),
    (("コンディショナー", "リンス", "conditioner"), "conditioner"),
    (("ボディシャンプー", "ボディソープ", "body wash", "body shampoo", "body soap"), "bodysoap"),
    (("シャンプー", "shampoo"), "shampoo"),
    (("wi-fi", "wifi", "無線"), "wifi"),
    (("フロント", "front desk"), "front"),
    (("禁煙", "non-smok", "smoking"), "nosmoke"),
    (("露天", "内湯", "貸切風呂", "onsen", "hot spring", "open-air"), "onsen"),
    (("共用シャワー", "shared shower", "シャワー", "shower"), "shower"),
    (("ユニットバス", "浴槽", "バス・トイレ", "bath"), "bath"),
    (("洗浄機能", "washlet", "トイレ", "toilet", "wc"), "toilet"),
    (("冷蔵庫", "fridge", "refrigerator"), "fridge"),
    (("テレビ", "tv", "satellite", "衛星"), "tv"),
    (("ケトル", "kettle"), "kettle"),
    (("アメニティ", "amenit"), "amenity"),
    (("タオル", "towel"), "towel"),
    (("館内着", "浴衣", "room wear", "bathrobe", "robe"), "robe"),
    (("ナイトウェア", "loungewear", "nightwear", "パジャマ", "pajama"), "wear"),
    (("ランドリー", "洗濯", "laundry"), "laundry"),
    (("ロッカー", "locker"), "locker"),
    (("電子レンジ", "microwave"), "microwave"),
    (("プレッサー", "アイロン", "press", "iron"), "iron"),
    (("朝食", "breakfast"), "breakfast"),
    (("カフェ", "café", "cafe"), "cafe"),
    (("マットレス", "ベッド", "mattress", "bed"), "bed"),
    (("デスク", "desk", "work"), "desk"),
    (("空調", "エアコン", "air condition", "空気清浄"), "aircon"),
    (("駐車", "parking"), "parking"),
    (("お食事", "食事", "meal", "dining"), "meal"),
]


def icon_for(*texts):
    blob = " ".join(texts).lower()
    for words, key in RULES:
        if any(w in blob for w in words):
            return ICONS[key]
    return ICONS["info"]
