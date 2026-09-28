#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Telegram Channel File & Size Inspector (0 Bytes Downloaded)
Scans any Telegram channel, group, or chat and calculates exact file counts,
total size (MB/GB), breakdowns by extension, and generates an inventory report.
"""

import os
import sys
import csv
import asyncio
from pathlib import Path
from collections import defaultdict

try:
    from telethon import TelegramClient
    from telethon.tl.types import DocumentAttributeFilename
except ImportError:
    print("Telethon n'est pas encore installe. Lancez: pip install telethon")
    sys.exit(1)

ENV_FILE = Path(__file__).parent / ".env"

def load_env():
    env_vars = {}
    if ENV_FILE.exists():
        with open(ENV_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env_vars[k.strip()] = v.strip()
    return env_vars

def save_env_var(key, value):
    lines = []
    found = False
    if ENV_FILE.exists():
        with open(ENV_FILE, "r", encoding="utf-8") as f:
            lines = f.readlines()
    
    new_lines = []
    for line in lines:
        if line.strip().startswith(f"{key}="):
            new_lines.append(f"{key}={value}\n")
            found = True
        else:
            new_lines.append(line)
    if not found:
        new_lines.append(f"{key}={value}\n")
    
    with open(ENV_FILE, "w", encoding="utf-8") as f:
        f.writelines(new_lines)

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

async def main():
    print("=" * 65)
    print(" TELEGRAM CHANNEL FILE & SIZE SCANNER (SANS TELECHARGEMENT)")
    print("=" * 65)

    env = load_env()
    api_id = env.get("TELEGRAM_API_ID")
    api_hash = env.get("TELEGRAM_API_HASH")

    if not api_id or not api_hash:
        print("\nConfiguration Telegram API requise (a obtenir sur https://my.telegram.org) :")
        api_id = input("Entrez votre API ID : ").strip()
        api_hash = input("Entrez votre API HASH : ").strip()
        
        save = input("Enregistrer ces identifiants dans .env ? (O/n) : ").strip().lower()
        if save in ("", "o", "oui", "y", "yes"):
            save_env_var("TELEGRAM_API_ID", api_id)
            save_env_var("TELEGRAM_API_HASH", api_hash)
            print(" Identifiants enregistres dans .env")

    session_path = str(Path(__file__).parent / "telegram_scanner.session")
    client = TelegramClient(session_path, int(api_id), api_hash)

    await client.start()
    print("\n Connecte a Telegram avec succes !")

    channel_input = input("\nEntrez le lien, nom d'utilisateur ou ID du canal/groupe (ex: @mon_canal ou https://t.me/...) : ").strip()
    if not channel_input:
        print(" Canal non specifie.")
        await client.disconnect()
        return

    try:
        if channel_input.isdigit() or (channel_input.startswith("-") and channel_input[1:].isdigit()):
            entity = await client.get_entity(int(channel_input))
        else:
            entity = await client.get_entity(channel_input)
    except Exception as e:
        print(f" Impossible de trouver le canal '{channel_input}': {e}")
        await client.disconnect()
        return

    title = getattr(entity, 'title', getattr(entity, 'username', str(channel_input)))
    print(f"\n Scan du canal en cours : '{title}'...")
    print(" (Lecture seule des metadonnees - aucun fichier n'est telecharge)\n")

    total_files = 0
    total_bytes = 0
    stats_by_ext = defaultdict(lambda: {"count": 0, "size": 0})
    file_list = []

    msg_count = 0
    async for message in client.iter_messages(entity):
        msg_count += 1
        if msg_count % 100 == 0:
            print(f"  ... {msg_count} messages analyses ({total_files} fichiers trouves, {format_size(total_bytes)})", end="\r")

        if message.file:
            size = message.file.size or (message.document.size if message.document else 0)
            if size > 0:
                name = message.file.name
                ext = message.file.ext or ""
                
                if not name and message.document:
                    for attr in message.document.attributes:
                        if isinstance(attr, DocumentAttributeFilename):
                            name = attr.file_name
                            break

                if not ext and name:
                    ext = Path(name).suffix.lower()
                elif ext and not ext.startswith("."):
                    ext = "." + ext.lower()
                elif not ext:
                    ext = ".inconnu"

                total_files += 1
                total_bytes += size
                stats_by_ext[ext]["count"] += 1
                stats_by_ext[ext]["size"] += size

                file_list.append({
                    "id": message.id,
                    "date": str(message.date),
                    "filename": name or f"file_{message.id}{ext}",
                    "extension": ext,
                    "size_bytes": size,
                    "size_mb": round(size / (1024 * 1024), 2)
                })

    print(f"\n\n Scan termine ! Total messages analyses : {msg_count}\n")
    print("=" * 65)
    print(f" BILAN DU CANAL : {title}")
    print("=" * 65)
    print(f" Nombre total de fichiers : {total_files}")
    print(f" TAILLE TOTALE           : {format_size(total_bytes)} ({total_bytes / (1024**3):.3f} Go / {total_bytes / (1024**2):.1f} Mo)")
    print("-" * 65)
    print(f" {'Extension':<12} | {'Nombre':<10} | {'Taille Totale':<15} | {'Part (%)':<8}")
    print("-" * 65)

    sorted_exts = sorted(stats_by_ext.items(), key=lambda x: x[1]["size"], reverse=True)
    for ext, data in sorted_exts:
        pct = (data["size"] / total_bytes * 100) if total_bytes > 0 else 0
        print(f" {ext:<12} | {data['count']:<10} | {format_size(data['size']):<15} | {pct:>6.1f}%")
    print("=" * 65)

    csv_file = Path(__file__).parent / "telegram_inventory.csv"
    with open(csv_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["id", "date", "filename", "extension", "size_bytes", "size_mb"])
        writer.writeheader()
        writer.writerows(file_list)

    print(f"\n Inventaire complet exporte dans : {csv_file.name} ({len(file_list)} lignes)")
    await client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
