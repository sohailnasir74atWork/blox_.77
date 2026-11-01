#!/usr/bin/env python3
"""
Build Code/TradeScanner/fruitSignatures.json: one small picture signature per
fruit for the Trade Scanner (Code/TradeScanner/matcher.js).

    python3 scripts/trade-scanner/build_signatures.py      (needs Pillow)
    node scripts/trade-scanner/build-html.js               (then repack the page)

Reads the live catalogue (blox-api.b-cdn.net/data.json) and the same physical
fruit icons the calculator shows (bloxfruitscalc.com .../2024/09/<Name>_Icon.webp).
Re-run when fruits are added; fruits without a signature are still found by
the name the game prints above each slot.

Signature = icon cropped to its visible pixels, padded to a square, composited
on BG and box-filtered to N x N, stored as RGBA bytes (A = share of visible
pixels). matcher.js boxSignature() does the same to each screenshot slot.
"""
import base64
import io
import json
import os
import sys
import urllib.request
from datetime import date

from PIL import Image

N = 20
BG = (228, 228, 228)
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'Code', 'TradeScanner', 'fruitSignatures.json')
CATALOG = 'https://blox-api.b-cdn.net/data.json'
ICON = 'https://bloxfruitscalc.com/wp-content/uploads/2024/09/{}_Icon.webp'


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'bloxfruitevalues-build'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def icon_name(name):
    # Same as HomeScreen formatName(): drop a leading "+", spaces -> "-".
    return '-'.join(name.lstrip('+').split())


def signature(im):
    im = im.convert('RGBA')
    im.thumbnail((256, 256), Image.LANCZOS)
    # Visible = opaque AND clearly different from the light slot panel, the
    # same test matcher.js applies to a screenshot (|rgb - panel| > 60 and not
    # light grey, see isPanel()).
    flat = Image.new('RGB', im.size, BG)
    flat.paste(im.convert('RGB'), (0, 0), im.getchannel('A'))
    alpha = Image.new('L', im.size, 0)
    alpha.putdata([255 if a > 76 and abs(r - BG[0]) + abs(g - BG[1]) + abs(b - BG[2]) > 60
                   and not (min(r, g, b) > 170 and max(r, g, b) - min(r, g, b) < 35) else 0
                   for (r, g, b), a in zip(zip(*[iter(flat.tobytes())] * 3), im.getchannel('A').tobytes())])
    box = alpha.getbbox()
    if not box:
        return None
    im, alpha = im.crop(box), alpha.crop(box)
    w, h = im.size
    s = max(w, h)
    sq = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    sq_a = Image.new('L', (s, s), 0)
    sq.paste(im, ((s - w) // 2, (s - h) // 2))
    sq_a.paste(alpha, ((s - w) // 2, (s - h) // 2))
    flat = Image.new('RGB', (s, s), BG)
    flat.paste(sq.convert('RGB'), (0, 0), sq.getchannel('A'))
    rgb = flat.resize((N, N), Image.BOX)
    a = sq_a.resize((N, N), Image.BOX)
    rgb_b, a_b = rgb.tobytes(), a.tobytes()
    raw = bytearray()
    for i in range(N * N):
        raw += rgb_b[i * 3:i * 3 + 3] + a_b[i:i + 1]
    return base64.b64encode(bytes(raw)).decode()


def main():
    catalog = json.loads(fetch(CATALOG))
    items, missing = [], []
    for entry in catalog:
        name = entry.get('name')
        if not name:
            continue
        try:
            im = Image.open(io.BytesIO(fetch(ICON.format(icon_name(name)))))
            sig = signature(im)
        except Exception as e:  # 404 or undecodable
            sig = None
            print(f'  {name}: {e}', file=sys.stderr)
        if sig:
            items.append({'name': name, 'sig': sig})
        else:
            missing.append(name)
    out = {'N': N, 'built': date.today().isoformat(), 'source': ICON.format('<Name>'), 'items': items}
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
        f.write('\n')
    print(f'{len(items)} signatures -> {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT) // 1024} KB); no icon: {missing}')


if __name__ == '__main__':
    main()
