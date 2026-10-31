"""Merge scripts/raid/i18n/<lang>.json into Code/Translation/<lang>.json (Sea Beast Raid, 2026-10-31).

    python3 scripts/raid/merge-i18n.py            # writes
    python3 scripts/raid/merge-i18n.py --check    # exits 1 when a locale file is out of step

Each i18n/<lang>.json holds four blocks:
    raid        → <lang>.raid                      (the game's strings; placeholders {name})
    raid_app    → <lang>.raid_app                  (RaidScreen strings)
    home        → <lang>.home.home_tab_screen.*    (game_raid, tag_new)
    game_hub    → <lang>.engagement.game_hub.*     (raid_name, raid_desc, new_tag)
The raid / raid_app blocks are replaced whole (idempotent); the home / game_hub
keys are set individually. Every language must carry every key en.json has
(the jest test __tests__/raidGame.test.js checks keys and placeholders).
The file's own indent is kept (fr uses 4).
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "i18n")
DEST = os.path.join(HERE, "..", "..", "Code", "Translation")
CHECK = "--check" in sys.argv


def load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def indent_of(raw):
    second = raw.split("\n", 2)[1]
    return len(second) - len(second.lstrip(" ")) or 2


en = load(os.path.join(SRC, "en.json"))
drift = []
for name in sorted(os.listdir(SRC)):
    if not name.endswith(".json"):
        continue
    lang = name[:-5]
    block = load(os.path.join(SRC, name))
    for section in ("raid", "raid_app", "home", "game_hub"):
        missing = set(en[section]) - set(block.get(section, {}))
        extra = set(block.get(section, {})) - set(en[section])
        if missing or extra:
            sys.exit(f"{lang}.{section}: missing {sorted(missing)} extra {sorted(extra)}")
    path = os.path.join(DEST, f"{lang}.json")
    raw = open(path, encoding="utf-8").read()
    data = json.loads(raw)
    before = json.dumps(data, ensure_ascii=False, sort_keys=True)
    data["raid"] = block["raid"]
    data["raid_app"] = block["raid_app"]
    data.setdefault("home", {}).setdefault("home_tab_screen", {}).update(block["home"])
    data.setdefault("engagement", {}).setdefault("game_hub", {}).update(block["game_hub"])
    after = json.dumps(data, ensure_ascii=False, sort_keys=True)
    if before != after:
        drift.append(lang)
        if not CHECK:
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(data, fh, ensure_ascii=False, indent=indent_of(raw))
                fh.write("\n")

if CHECK:
    if drift:
        sys.exit(f"out of step: {', '.join(drift)} (run python3 scripts/raid/merge-i18n.py)")
    print("raid i18n: all locale files in step")
else:
    print(f"raid i18n: wrote {len(drift)} locale file(s)" if drift else "raid i18n: nothing to change")
