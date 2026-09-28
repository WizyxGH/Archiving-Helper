#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Instant Telegram Export JSON Parser (result.json)
Calculates exact sizes, file counts, and breakdown from Telegram Desktop export.
"""

import os
import sys
import json
from pathlib import Path
from collections import defaultdict

def format_size(bytes_val):
    if bytes_val >= 1024 ** 4:
        return f"{bytes_val / (1024 ** 4):.2f} To"
    elif bytes_val >= 1024 ** 3:
        return f"{bytes_val / (1024 ** 3):.2f} Go"
    elif bytes_val >= 1024 ** 2:
        return f"{bytes_val / (1024 ** 2):.2f} Mo"
    elif bytes_val >= 1024:
        return f"{bytes_val / 1024:.2f} Ko"
    else:
        return f"{bytes_val} octets"

def parse_export(json_path):
    path = Path(json_path)
    if not path.exists():
        print(f"Erreur : Le fichier '{json_path}' n'existe pas.")
        return

    print(f"\nLecture de {path.name}...")
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    chat_name = data.get("name", "Export Telegram")
    messages = data.get("messages", [])

    total_files = 0
    total_bytes = 0
    stats = defaultdict(lambda: {"count": 0, "size": 0})

    for msg in messages:
        media_type = msg.get("media_type")
        file_name = msg.get("file_name") or msg.get("file")
        file_size = msg.get("file_size") or 0

        if not file_size and "photo" in msg:
            continue

        if file_size > 0 or file_name:
            ext = Path(str(file_name)).suffix.lower() if file_name else f".{media_type or 'inconnu'}"
            if not ext or ext == ".":
                ext = f".{media_type or 'inconnu'}"

            total_files += 1
            total_bytes += file_size
            stats[ext]["count"] += 1
            stats[ext]["size"] += file_size

    print("=" * 65)
    print(f" BILAN DE L'EXPORT TELEGRAM : {chat_name}")
    print("=" * 65)
    print(f" Nombre total de fichiers : {total_files}")
    print(f" TAILLE TOTALE           : {format_size(total_bytes)} ({total_bytes / (1024**3):.3f} Go / {total_bytes / (1024**2):.1f} Mo)")
    print("-" * 65)
    print(f" {'Extension':<12} | {'Nombre':<10} | {'Taille Totale':<15} | {'Part (%)':<8}")
    print("-" * 65)

    for ext, item in sorted(stats.items(), key=lambda x: x[1]["size"], reverse=True):
        pct = (item["size"] / total_bytes * 100) if total_bytes > 0 else 0
        print(f" {ext:<12} | {item['count']:<10} | {format_size(item['size']):<15} | {pct:>6.1f}%")
    print("=" * 65)

if __name__ == "__main__":
    if len(sys.argv) > 1:
        parse_export(sys.argv[1])
    else:
        file_input = input("Glissez-déposez le fichier result.json ici : ").strip('"\'')
        parse_export(file_input)
