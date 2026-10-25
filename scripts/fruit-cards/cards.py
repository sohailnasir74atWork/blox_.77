"""Shared rules for the Fruit Cards scripts: which data.json items are cards.

Keep in step with sync-card-catalog.js (same sets.json, same key rule).
"""

import json
import os
import re
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
UA = "FruitCardsArt/1.0 (blox fruits values app)"
SETS = json.load(open(os.path.join(HERE, "sets.json")))


def card_key(name):
    """Lowercase letters and digits only: the card's id and file name."""
    return re.sub(r"[^a-z0-9]", "", str(name or "").lower())


def image_url(name):
    """Same file the Values screen shows (ValueScreen.jsx formatName)."""
    file = re.sub(r"\s+", "-", re.sub(r"^\+", "", name))
    return SETS["image"].replace("{name}", urllib.parse.quote(file))


def fetch(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def card_items():
    """data.json items that become cards, as (key, item)."""
    items = json.loads(fetch(SETS["catalog"]))
    out = []
    for it in items:
        if it.get("type") in SETS["excludeTypes"] or it.get("name") in SETS["excludeNames"]:
            continue
        out.append((card_key(it["name"]), it))
    return out
