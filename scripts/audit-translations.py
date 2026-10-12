#!/usr/bin/env python3
"""Compare locale catalogs with English keys and interpolation placeholders."""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "Code" / "Translation"


def flatten(value, prefix=""):
    result = {}
    for key, child in value.items():
        path = f"{prefix}.{key}" if prefix else key
        if isinstance(child, dict):
            result.update(flatten(child, path))
        else:
            result[path] = child
    return result


def placeholders(value):
    return set(re.findall(r"{{\s*-?\s*([\w.]+)", str(value)))


PLURAL_SUFFIXES = ("zero", "one", "two", "few", "many", "other")


def plural_family(key):
    for suffix in PLURAL_SUFFIXES:
        marker = f"_{suffix}"
        if key.endswith(marker):
            return key[:-len(marker)]
    return key


def main():
    catalogs = {
        path.stem: json.loads(path.read_text(encoding="utf-8"))
        for path in sorted(ROOT.glob("*.json"))
    }
    english = flatten(catalogs["en"])
    failed = False
    for language, catalog in catalogs.items():
        strings = flatten(catalog)
        # i18next plural suffixes are locale-specific (e.g. Russian _few/_many),
        # so compare the base message family and validate each available form.
        english_families = {plural_family(key) for key in english}
        locale_families = {plural_family(key) for key in strings}
        missing = english_families - locale_families
        extra = locale_families - english_families
        mismatched = []
        for key, value in strings.items():
            family = plural_family(key)
            source = english.get(key) or next(
                (english[source_key] for source_key in english
                 if plural_family(source_key) == family and placeholders(english[source_key]) == placeholders(value)), None
            )
            # Arabic zero/one/two forms commonly encode the quantity in the
            # wording itself, so they do not need an interpolated count.
            arabic_explicit_number = (
                language == "ar"
                and key.endswith(("_zero", "_one", "_two"))
                and "count" in placeholders(source or "")
                and "count" not in placeholders(value)
            )
            if source is not None and placeholders(source) != placeholders(value) and not arabic_explicit_number:
                mismatched.append(key)
        mismatched.sort()
        print(
            f"{language}: {len(strings)} strings; {len(missing)} missing; "
            f"{len(extra)} extra; {len(mismatched)} placeholder mismatches"
        )
        if missing:
            print("  missing examples: " + ", ".join(sorted(missing)[:8]))
        if extra:
            print("  extra examples: " + ", ".join(sorted(extra)[:8]))
        if mismatched:
            print("  placeholder mismatches: " + ", ".join(mismatched[:8]))
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
