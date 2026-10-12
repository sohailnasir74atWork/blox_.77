#!/usr/bin/env python3
"""Align locale JSON key trees with en.json without overwriting existing copy.

Missing values are filled with the English source string as an explicit fallback.
Run with --apply to write changes. This guarantees catalog/key parity, not translation.
"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "Code" / "Translation"


def merge_missing(target, source, path=""):
    added = []
    for key, value in source.items():
        current_path = f"{path}.{key}" if path else key
        if key not in target:
            target[key] = value
            added.extend(_leaf_paths(value, current_path))
        elif isinstance(value, dict) and isinstance(target[key], dict):
            added.extend(merge_missing(target[key], value, current_path))
    return added


def _leaf_paths(value, path):
    if isinstance(value, dict):
        leaves = []
        for key, child in value.items():
            leaves.extend(_leaf_paths(child, f"{path}.{key}"))
        return leaves
    return [path]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write missing source keys into locale files")
    args = parser.parse_args()
    source = json.loads((ROOT / "en.json").read_text(encoding="utf-8"))
    for path in sorted(ROOT.glob("*.json")):
        if path.stem == "en":
            continue
        target = json.loads(path.read_text(encoding="utf-8"))
        missing = merge_missing(target, source)
        if missing:
            print(f"{path.stem}: {len(missing)} source fallback strings" + (" added" if args.apply else " missing"))
            if args.apply:
                path.write_text(json.dumps(target, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        else:
            print(f"{path.stem}: key tree aligned")
    if not args.apply:
        print("Preview only. Use --apply to add missing keys; copied English text remains untranslated fallback.")


if __name__ == "__main__":
    main()
