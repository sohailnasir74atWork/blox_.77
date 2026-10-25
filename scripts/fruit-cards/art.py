"""Fruit Cards art: download, square, resize, upload. Dry run unless --apply.

The Values screen's fruit icons have a transparent background but vary in
size (2026-10-25: 11 of 81 are 512 px or more, 31 are 400 px, the rest
150–385 px, most Limited skins 200 px). Launch rule (owner, 2026-10-25): only
sources of 400 px or more go in index.json, so soft skins stay out of packs
until bigger art exists. Raise or lower it with --min-source (0 = everything).

    python3 scripts/fruit-cards/art.py                 # download + build out/{1024,512,2048}
    python3 scripts/fruit-cards/art.py --palette       # + Code/FruitCards/fruitColors.json
    python3 scripts/fruit-cards/art.py --min-source 0  # include the soft art too
    BUNNY_STORAGE_ZONE=... BUNNY_STORAGE_KEY=... python3 scripts/fruit-cards/art.py --apply

Upload layout (same as Pet Cards, "pets" -> "fruits"):
    v1/fruits/<key>.webp       1024 px (card)
    v1/fruits/512/<key>.webp   512 px (album thumbs)
    v1/fruits/2k/<key>.webp    2048 px (4K wallpapers; Lanczos up from ~1000 px)
    v1/fruits/index.json, v1/fruits/2k/index.json   keys with art (sync-card-catalog.js
                                                    sets hd_ready from index.json)

Use a DEDICATED storage zone for cards (CARDS_CDN in Code/FruitCards/cardConfig.js),
not blox-api (values JSON) or pull-blox. The storage key comes ONLY from the
environment; never write it into a file. Files are never overwritten in place:
phones cache by URL. After uploading, purge the two index.json URLs.
Optional BUNNY_STORAGE_HOST (default storage.bunnycdn.com).
"""

import argparse
import concurrent.futures as cf
import io
import json
import os
import sys
import urllib.request

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cards import OUT, card_items, fetch, image_url  # noqa: E402

SIZES = {"1024": 1024, "512": 512, "2048": 2048}
MARGIN = 0.08
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def squared(img):
    """Trim empty margin, centre on a transparent square with MARGIN on each side."""
    img = img.convert("RGBA")
    box = img.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    if box:
        img = img.crop(box)
    side = int(max(img.size) / (1 - 2 * MARGIN))
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
    return sq


def build(key, name):
    dest = {k: os.path.join(OUT, k, f"{key}.webp") for k in SIZES}
    src_file = os.path.join(OUT, "src", f"{key}.txt")   # source size, so cached runs still know it
    try:
        if all(os.path.exists(p) for p in dest.values()):
            if not os.path.exists(src_file):   # built before the size was recorded: measure only
                with open(src_file, "w") as fh:
                    fh.write(str(min(Image.open(io.BytesIO(fetch(image_url(name)))).size)))
            return key, "cached", int(open(src_file).read())
        raw = fetch(image_url(name))
        img = Image.open(io.BytesIO(raw))
        src = min(img.size)
        with open(src_file, "w") as fh:
            fh.write(str(src))
        sq = squared(img)
        if sq.getchannel("A").getextrema()[0] == 255:
            return key, "no-alpha", src
        for k, px in SIZES.items():
            sq.resize((px, px), Image.LANCZOS).save(dest[k], "WEBP", quality=92, method=6)
        return key, "ok", src
    except Exception as e:  # noqa: BLE001
        return key, f"error {e}", None


def put(host, zone, key, remote, data, ctype):
    req = urllib.request.Request(f"https://{host}/{zone}/{remote}", data=data, method="PUT",
                                 headers={"AccessKey": key, "Content-Type": ctype})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.status


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="upload to Bunny")
    ap.add_argument("--palette", action="store_true", help="write Code/FruitCards/fruitColors.json")
    ap.add_argument("--prefix", default="v1")
    ap.add_argument("--min-source", type=int, default=400,
                    help="leave cards whose source image is smaller than this (px) out of index.json "
                         "(default 400, the launch rule; 0 = include everything)")
    args = ap.parse_args()

    for k in list(SIZES) + ["src"]:
        os.makedirs(os.path.join(OUT, k), exist_ok=True)
    items = card_items()
    with cf.ThreadPoolExecutor(8) as ex:
        results = list(ex.map(lambda kv: build(kv[0], kv[1]["name"]), items))
    built = [(k, src) for k, status, src in results if status in ("ok", "cached")]
    bad = [(k, s) for k, s, _ in results if s not in ("ok", "cached")]
    small = sorted((k, src) for k, src in built if src and src < 512)
    held = {k for k, src in built if args.min_source and src and src < args.min_source}
    good = sorted(k for k, _ in built if k not in held)
    print(f"{len(items)} card items, {len(built)} with art, {len(good)} in index.json")
    for k, s in bad:
        print(f"  missing  {k}: {s}")
    for k, src in small:
        print(f"  small    {k}: source {src} px{' (held out)' if k in held else ' (looks soft at 1024)'}")

    with open(os.path.join(OUT, "index.json"), "w") as fh:
        json.dump(good, fh)

    if args.palette:
        import palette  # noqa: E402
        palette.main(os.path.join(OUT, "512"), os.path.join(ROOT, "Code", "FruitCards", "fruitColors.json"))

    jobs = []
    for k in good:
        jobs.append((os.path.join(OUT, "1024", f"{k}.webp"), f"{args.prefix}/fruits/{k}.webp", None))
        jobs.append((os.path.join(OUT, "512", f"{k}.webp"), f"{args.prefix}/fruits/512/{k}.webp", None))
        jobs.append((os.path.join(OUT, "2048", f"{k}.webp"), f"{args.prefix}/fruits/2k/{k}.webp", None))
    manifest = json.dumps(good).encode()
    jobs.append((None, f"{args.prefix}/fruits/2k/index.json", manifest))
    jobs.append((None, f"{args.prefix}/fruits/index.json", manifest))   # last: the app trusts it
    size = sum(os.path.getsize(p) for p, _, _ in jobs if p)
    print(f"upload: {len(jobs)} files, {size / 1e6:.1f} MB")
    if not args.apply:
        print("dry run: add --apply (with BUNNY_STORAGE_ZONE and BUNNY_STORAGE_KEY set) to upload")
        return

    zone = os.environ.get("BUNNY_STORAGE_ZONE")
    key = os.environ.get("BUNNY_STORAGE_KEY")
    host = os.environ.get("BUNNY_STORAGE_HOST", "storage.bunnycdn.com")
    if zone and not key and sys.stdin.isatty():
        # No key in the environment: ask for it at a hidden prompt (never echoed, never saved).
        import getpass
        key = getpass.getpass(f"Paste the {zone} storage Password (hidden), then press Return: ").strip()
        print(f"got {len(key)} characters")
    if not zone or not key:
        sys.exit("BUNNY_STORAGE_ZONE must be set, and BUNNY_STORAGE_KEY set or typed at the prompt "
                 "(run in a real terminal for the prompt)")

    # Check the password first, so a wrong one stops here with one clear line
    # instead of 128 "401 Unauthorized" uploads (2026-10-25: a stale clipboard,
    # then the READ-ONLY password, which can list the zone but not upload).
    # Listing proves the password belongs to the zone; writing and deleting a
    # tiny probe proves it may upload.
    def probe(method, data=None):
        req = urllib.request.Request(f"https://{host}/{zone}/{args.prefix}/_write_check.txt", data=data,
                                     method=method, headers={"AccessKey": key})
        urllib.request.urlopen(req, timeout=30)

    try:
        urllib.request.urlopen(urllib.request.Request(f"https://{host}/{zone}/", headers={"AccessKey": key}), timeout=30)
    except urllib.error.HTTPError as e:
        sys.exit(f"Storage zone {zone!r} rejected the password (HTTP {e.code}). Copy the zone's Password "
                 f"(the first row, not the read-only one) from Storage → {zone} → Access, then run again. "
                 f"The key you passed is {len(key)} characters long (a Bunny storage password is about 41).")
    try:
        probe("PUT", b"ok")
        probe("DELETE")
    except urllib.error.HTTPError as e:
        sys.exit(f"The password can read {zone!r} but not upload (HTTP {e.code}): it is the READ-ONLY password. "
                 f"Copy the first row, Password, from Storage → {zone} → Access, then run again.")

    def send(job):
        path, remote, data = job
        ctype = "application/json" if remote.endswith(".json") else "image/webp"
        try:
            put(host, zone, key, remote, data if data is not None else open(path, "rb").read(), ctype)
            return None
        except Exception as e:  # noqa: BLE001
            return f"{remote}: {e}"

    with cf.ThreadPoolExecutor(8) as ex:
        errors = [e for e in ex.map(send, jobs[:-2]) if e]
    if errors:
        print("\n".join(errors))
        sys.exit(f"{len(errors)} uploads failed; manifests NOT written")
    for job in jobs[-2:]:
        err = send(job)
        if err:
            sys.exit(err)
    print("uploaded; purge fruits/index.json and fruits/2k/index.json on the pull zone")


if __name__ == "__main__":
    main()
