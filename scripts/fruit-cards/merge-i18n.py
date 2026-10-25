"""Merge scripts/fruit-cards/i18n/<lang>.json into Code/Translation/<lang>.json as "fruit_cards".

    python3 scripts/fruit-cards/merge-i18n.py

Replaces the whole fruit_cards block each run (idempotent). Languages whose
existing file writes both _one and _other for plural keys even though the
language has no plural forms (ja, id, vi) get _one copied from _other, so
every file follows the same convention.
"""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DEST = os.path.join(HERE, "..", "..", "Code", "Translation")
SINGLE_FORM = {"ja", "id", "vi"}


def fill_one(block):
    for k in list(block):
        v = block[k]
        if isinstance(v, dict):
            fill_one(v)
        elif k.endswith("_other") and k[:-6] + "_one" not in block:
            block[k[:-6] + "_one"] = v


for name in sorted(os.listdir(os.path.join(HERE, "i18n"))):
    lang = name[:-5]
    block = json.load(open(os.path.join(HERE, "i18n", name), encoding="utf-8"))
    if lang in SINGLE_FORM:
        fill_one(block)
    path = os.path.join(DEST, f"{lang}.json")
    raw = open(path, encoding="utf-8").read()
    data = json.loads(raw)
    second = raw.split("\n", 2)[1]
    indent = len(second) - len(second.lstrip(" ")) or 2   # keep the file's own indent (fr uses 4)
    data["fruit_cards"] = block
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=indent)
        fh.write("\n")
    print(f"{lang}: fruit_cards merged")
