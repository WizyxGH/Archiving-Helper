#!/usr/bin/env python3
"""
scripts/gen-country-names.py — regenerate the country tables from Inducks.

The folder names under the archive root must be the country names, never the raw
ISO code: a missing entry falls back to `code.toUpperCase()` and creates a second
folder for the same country (EG, LU, …), which then looks like an unknown country
and makes already-archived tomes look new.

The list used to be typed by hand and had drifted to 25 of Inducks' 84 countries.
This script reads them all from the Inducks database instead, so it cannot drift
again. `test/country_names.test.mjs` then checks the JS and Python tables agree.

    py -3.12 scripts/gen-country-names.py            # rewrite the three tables
    py -3.12 scripts/gen-country-names.py --check    # report only, write nothing

Two labels are deliberately not Inducks' wording: Inducks says "UK" and "USA" where
the folders have always used the full name.
"""
import argparse
import io
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def inducks_data_dir():
    """Dossier des .isv tel que le résout src/core/config.mjs.

    Une seule source de vérité : INDUCKS_DATA_DIR (environnement, puis .env,
    puis défauts) est lue par la config Node, jamais recodée ici.
    """
    node = shutil.which("node")
    if not node:
        sys.exit("Node.js introuvable : il faut lui demander le dossier Inducks.")
    result = subprocess.run(
        [node, "--input-type=module", "-e",
         "import { inducksDataDir } from './src/core/config.mjs';"
         "process.stdout.write(inducksDataDir() || '')"],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
    )
    return result.stdout.strip()

KEPT_LABELS = {
    "uk": "United Kingdom",   # Inducks says "UK"
    "us": "United States",    # Inducks says "USA"
}

TARGETS = [
    ("src/core/inducks/inducks.mjs", "export const COUNTRY_NAMES = ", "js"),
    ("download-files/telegram_to_drive_pipeline.py", "DEFAULT_COUNTRY_MAP", "py"),
]

JS_HEADER = (
    "// Codes pays Inducks -> nom de dossier. Généré par scripts/gen-country-names.py\n"
    "// depuis inducks_country : ne pas réduire cette liste à la main. Un code absent\n"
    "// retombe sur son code en majuscules comme nom de dossier (EG, LU) — c'est ce\n"
    "// que country_names.test.mjs garde. Deux libellés diffèrent d'Inducks ('UK',\n"
    "// 'USA') volontairement.\n"
    "export const COUNTRY_NAMES = "
)

PY_HEADER = (
    "# Codes pays Inducks -> nom de dossier. Généré par scripts/gen-country-names.py\n"
    "# depuis inducks_country : ne pas réduire cette liste à la main. Un code absent\n"
    "# retombe sur son code en majuscules comme nom de dossier (EG, LU).\n"
    "DEFAULT_COUNTRY_MAP = "
)


def load_countries():
    source = os.path.join(inducks_data_dir(), "inducks_country.isv")
    if not os.path.exists(source):
        sys.exit(f"{source} introuvable : régler INDUCKS_DATA_DIR dans download-files/.env")
    rows = {}
    with io.open(source, encoding="utf-8") as handle:
        next(handle)  # en-tête countrycode^countryname^...
        for line in handle:
            fields = line.rstrip("\r\n").split("^")
            if len(fields) >= 2 and fields[0]:
                rows[fields[0]] = fields[1]
    return rows, source


def render(rows, kind):
    body = "\n".join(
        f"  '{code}': '{KEPT_LABELS.get(code, name)}'," if kind == "js"
        else f'  "{code}": "{KEPT_LABELS.get(code, name)}",'
        for code, name in sorted(rows.items())
    )
    header = JS_HEADER if kind == "js" else PY_HEADER
    return header + "{\n" + body + "\n}"


def replace_literal(source, marker, replacement):
    """Replace the object literal that starts at `marker`, braces matched."""
    start = source.index(marker)
    i = source.index("{", start)
    depth = 0
    while True:
        if source[i] == "{":
            depth += 1
        elif source[i] == "}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    # The generated text carries its own header comment. Any comment already
    # sitting just above the marker is dropped, or it would be duplicated on
    # every run and the output would never match itself. Both `//` and `#` are
    # recognised because the JS and Python tables share this function.
    head = source.rfind("\n\n", 0, start)
    if head != -1:
        above = source[head + 2:start].strip()
        if above.startswith("//") or above.startswith("#"):
            start = head + 2
    return source[:start] + replacement + source[i + 1:]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="report only, write nothing")
    args = parser.parse_args()

    rows, source = load_countries()
    print(f"{len(rows)} countries from {source}")

    changed = []
    for relative, marker, kind in TARGETS:
        path = os.path.join(ROOT, relative)
        current = io.open(path, encoding="utf-8").read()
        updated = replace_literal(current, marker, render(rows, kind))
        if updated == current:
            continue
        changed.append(relative)
        if args.check:
            continue
        io.open(path, "w", encoding="utf-8").write(updated)
        print(f"  updated {relative}")

    if args.check and changed:
        sys.exit(f"out of date: {', '.join(changed)}\nrun without --check to regenerate")
    if args.check:
        print("all tables up to date")


if __name__ == "__main__":
    main()