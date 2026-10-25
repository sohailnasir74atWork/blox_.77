"""Fruit colour palettes for the Wallpaper Studio's "Match my fruit" background.

Copied from adoptme-jan7 scripts/pet-cards/hd-art/palette.py (same method).
Called by art.py --palette: reads out/512/*.webp and writes the bundled
Code/FruitCards/fruitColors.json  { "<card key>": ["#main", "#second", "#accent"] }.
Run it when new fruits get art, before a release. Fruits without an entry fall
back to their rarity colours in the app.
"""

import colorsys
import glob
import json
import os

from PIL import Image

def hexof(rgb):
    return "#%02X%02X%02X" % rgb


def hls(rgb):
    return colorsys.rgb_to_hls(*(c / 255 for c in rgb))


def hue_gap(a, b):
    d = abs(a - b)
    return min(d, 1 - d)


def far(a, b):
    """True when two colours read as different: hue apart, or lightness apart."""
    ha, la, sa = hls(a)
    hb, lb, sb = hls(b)
    if min(sa, sb) > 0.2 and hue_gap(ha, hb) > 0.08:
        return True
    return abs(la - lb) > 0.22


def mean(px):
    n = len(px)
    return tuple(round(sum(p[i] for p in px) / n) for i in range(3))


def accent_of(px):
    """The pet's most vivid colour: the biggest hue family among its saturated
    pixels, even when it is a small part of the pet (Shadow Dragon's purple)."""
    bins = {}
    for p in px:
        h, l, s = hls(p)
        if s > 0.35 and 0.22 < l < 0.85:
            bins.setdefault(int(h * 24) % 24, []).append(p)
    if not bins:
        return None
    # Neighbouring hue bins are one family.
    best = max(range(24), key=lambda b: sum(len(bins.get((b + d) % 24, [])) for d in (-1, 0, 1)))
    fam = [p for d in (-1, 0, 1) for p in bins.get((best + d) % 24, [])]
    if len(fam) < len(px) * 0.01:
        return None
    # The family's most vivid half, so the colour isn't muddied by its shading.
    fam.sort(key=lambda p: hls(p)[2], reverse=True)
    return mean(fam[: max(1, len(fam) // 2)])


def palette(path):
    im = Image.open(path).convert("RGBA")
    im.thumbnail((96, 96))
    px = [p[:3] for p in im.get_flattened_data() if p[3] > 200]
    if len(px) < 50:
        return None
    strip = Image.new("RGB", (len(px), 1))
    strip.putdata(px)
    q = strip.quantize(colors=12, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette()
    counts = sorted(q.getcolors(), reverse=True)
    cols = [(n, tuple(pal[i * 3:i * 3 + 3])) for n, i in counts]

    # Body colours: not the black outline, not a blown-out highlight.
    body = [(n, c) for n, c in cols if 0.12 < hls(c)[1] < 0.93] or cols
    main = body[0][1]
    accent = accent_of(px)
    second = next((c for _, c in body[1:] if far(c, main)), None) or accent or main
    if accent is None:
        accent = max((c for _, c in body), key=lambda c: hls(c)[2])
    return [hexof(main), hexof(second), hexof(accent)]


def main(src_dir, dest):
    files = sorted(glob.glob(os.path.join(src_dir, "*.webp")))
    out = {}
    for f in files:
        p = palette(f)
        if p:
            out[os.path.splitext(os.path.basename(f))[0]] = p
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w") as fh:
        json.dump(out, fh, separators=(",", ":"), sort_keys=True)
    print(f"{len(out)}/{len(files)} fruits -> {dest} ({os.path.getsize(dest) // 1024} KB)")
