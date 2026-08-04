#!/usr/bin/env python3
"""One-off migration: 3-language data files -> Japanese-only source + translation memory.

Produces:
  data/site.json    (langs + brand meta + ja tree only)
  data/hotels.json  (translatable fields keep only the "ja" key)
  data/grand.json   (ja tree only)
  data/i18n.json    translation memory: hash(ja) -> {ja, zh, en, ko, th, locked}

Existing human-written zh/en copy is imported and marked locked=true so it is
never overwritten by machine translation.
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
sys.path.insert(0, os.path.join(ROOT, "tools"))
from i18n import key_of, needs_translation, path_key  # noqa: E402

SRC = "ja"
OTHERS = ["zh", "en"]
ALL_TARGETS = ["zh", "en", "ko", "th"]


def load(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as f:
        return json.load(f)


def dump(name, obj):
    with open(os.path.join(DATA, name), "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")


MEM = {}
CONFLICTS = []


def remember(ja, trans, path):
    """Store translations. If the same Japanese string already has a *different*
    translation elsewhere, keep the first one on the global key and give this
    occurrence its own path-scoped entry so both wordings survive."""
    if not isinstance(ja, str) or not ja:
        return
    # Keep the memory tight: only store an entry when the string actually is
    # Japanese, or when an existing translation differs from the source
    # (e.g. "FAX" -> "传真", "16m2" -> "16 m2", em-dash eyebrows).
    if not needs_translation(ja) and not any(
        isinstance(v, str) and v and v != ja for v in trans.values()
    ):
        return
    gk = key_of(ja)
    entry = MEM.setdefault(gk, {"ja": ja, "locked": True})
    for lg, val in trans.items():
        if not isinstance(val, str) or not val:
            continue
        prev = entry.get(lg)
        if prev and prev != val:
            CONFLICTS.append({"path": path, "ja": ja, "lang": lg, "kept": prev, "scoped": val})
            pk = path_key(path, ja)
            pe = MEM.setdefault(pk, {"ja": ja, "path": path, "locked": True})
            # carry over the global wording for the other languages
            for other in ALL_TARGETS:
                if other != lg and entry.get(other):
                    pe.setdefault(other, entry[other])
            pe[lg] = val
            for o in ALL_TARGETS:
                pe.setdefault(o, "")
            continue
        entry[lg] = val
    for lg in ALL_TARGETS:
        entry.setdefault(lg, "")


def walk_parallel(nodes, path=""):
    """nodes: dict lang -> value at the same position in each language tree."""
    ja = nodes[SRC]
    if isinstance(ja, str):
        remember(ja, {lg: nodes.get(lg) for lg in OTHERS}, path)
        return ja
    if isinstance(ja, list):
        out = []
        for i, item in enumerate(ja):
            sub = {SRC: item}
            for lg in OTHERS:
                o = nodes.get(lg)
                sub[lg] = o[i] if isinstance(o, list) and i < len(o) else None
            out.append(walk_parallel(sub, f"{path}[{i}]"))
        return out
    if isinstance(ja, dict):
        out = {}
        for k, v in ja.items():
            sub = {SRC: v}
            for lg in OTHERS:
                o = nodes.get(lg)
                sub[lg] = o.get(k) if isinstance(o, dict) else None
            out[k] = walk_parallel(sub, f"{path}.{k}")
        return out
    return ja


LANG_KEYS = {"ja", "zh", "en", "ko", "th"}


def walk_inline(node, path=""):
    """For hotels.json, where translations live inline as {"ja":..,"zh":..,"en":..}."""
    if isinstance(node, dict):
        keys = set(node.keys())
        if keys and keys <= LANG_KEYS and SRC in keys:
            ja = node[SRC]
            if isinstance(ja, list):
                for i, item in enumerate(ja):
                    trans = {}
                    for lg in OTHERS:
                        o = node.get(lg)
                        trans[lg] = o[i] if isinstance(o, list) and i < len(o) else None
                    remember(item, trans, f"{path}[{i}]")
                return {SRC: ja}
            remember(ja, {lg: node.get(lg) for lg in OTHERS}, path)
            return {SRC: ja}
        return {k: walk_inline(v, f"{path}.{k}") for k, v in node.items()}
    if isinstance(node, list):
        return [walk_inline(v, f"{path}[{i}]") for i, v in enumerate(node)]
    return node


def main():
    site = load("site.json")
    hotels = load("hotels.json")
    grand = load("grand.json")

    new_site = {k: v for k, v in site.items() if k not in ("ja", "zh", "en")}
    new_site["ja"] = walk_parallel({lg: site[lg] for lg in [SRC] + OTHERS}, "site")

    new_grand = {k: v for k, v in grand.items() if k not in ("ja", "zh", "en")}
    new_grand["ja"] = walk_parallel({lg: grand[lg] for lg in [SRC] + OTHERS}, "grand")

    new_hotels = walk_inline(hotels, "hotels")

    dump("site.json", new_site)
    dump("grand.json", new_grand)
    dump("hotels.json", new_hotels)
    dump("i18n.json", {k: MEM[k] for k in sorted(MEM, key=lambda x: MEM[x]["ja"])})

    filled = sum(1 for e in MEM.values() if e.get("zh") and e.get("en"))
    print(f"memory entries: {len(MEM)}  (zh+en filled: {filled})")
    scoped = sum(1 for e in MEM.values() if e.get("path"))
    print(f"path-scoped entries: {scoped} (from {len(CONFLICTS)} wording collisions)")
    for c in CONFLICTS:
        print("  ", c["lang"], c["path"], "|", c["ja"][:24], "|", str(c["kept"])[:34], "->", str(c["scoped"])[:34])


if __name__ == "__main__":
    main()
