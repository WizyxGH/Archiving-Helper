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

# Forcer le flush immediat de stdout
sys.stdout.reconfigure(line_buffering=True) if hasattr(sys.stdout, 'reconfigure') else None

try:
    from telethon import TelegramClient
    from telethon.tl.types import DocumentAttributeFilename
    from telethon.errors import SessionPasswordNeededError
except ImportError:
    print("Telethon n'est pas encore installe. Lancez: pip install telethon", flush=True)
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
    print("=" * 65, flush=True)
    print(" TELEGRAM CHANNEL FILE & SIZE SCANNER (SANS TELECHARGEMENT)", flush=True)
    print("=" * 65, flush=True)

    env = load_env()
    api_id = env.get("TELEGRAM_API_ID")
    api_hash = env.get("TELEGRAM_API_HASH")

    if not api_id or not api_hash:
        print("\nErreur : TELEGRAM_API_ID ou TELEGRAM_API_HASH manquant dans le .env", flush=True)
        return

    session_path = str(Path(__file__).parent / "telegram_scanner.session")
    client = TelegramClient(session_path, int(api_id), api_hash)

    print("\nConnexion aux serveurs Telegram...", flush=True)
    await client.connect()

    if not await client.is_user_authorized():
        print("\n Authentification requise :", flush=True)
        phone = input("Entrez votre numero de telephone (ex: +33612345678) : ").strip()
        await client.send_code_request(phone)
        
        code = input("Entrez le code a 5 chiffres recu sur Telegram : ").strip()
        try:
            await client.sign_in(phone, code)
        except SessionPasswordNeededError:
            pwd = input("Mot de passe 2FA requis : ").strip()
            await client.sign_in(password=pwd)

    me = await client.get_me()
    print(f"\n Connecte en tant que : {me.first_name} (@{me.username or me.phone})", flush=True)

    print("-" * 65, flush=True)
    channel_input = input("Entrez le lien, nom ou ID du canal/groupe (ex: @mon_canal ou https://t.me/...) : ").strip()
    if not channel_input:
        print(" Canal non specifie.", flush=True)
        await client.disconnect()
        return

    try:
        if channel_input.isdigit() or (channel_input.startswith("-") and channel_input[1:].isdigit()):
            entity = await client.get_entity(int(channel_input))
        else:
            entity = await client.get_entity(channel_input)
    except Exception as e:
        print(f"\n Impossible de trouver le canal '{channel_input}': {e}", flush=True)
        await client.disconnect()
        return

    title = getattr(entity, 'title', getattr(entity, 'username', str(channel_input)))
    print(f"\n Scan du canal en cours : '{title}'...", flush=True)
    print(" (Lecture seule des metadonnees - aucun fichier n'est telecharge)\n", flush=True)

    total_files = 0
    total_bytes = 0
    stats_by_ext = defaultdict(lambda: {"count": 0, "size": 0})
    file_list = []

    msg_count = 0
    async for message in client.iter_messages(entity):
        msg_count += 1
        if msg_count % 100 == 0:
            print(f"  ... {msg_count} messages analyses ({total_files} fichiers trouves, {format_size(total_bytes)})", end="\r", flush=True)

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

    print(f"\n\n Scan termine ! Total messages analyses : {msg_count}\n", flush=True)
    print("=" * 65, flush=True)
    print(f" BILAN DU CANAL : {title}", flush=True)
    print("=" * 65, flush=True)
    print(f" Nombre total de fichiers : {total_files}", flush=True)
    print(f" TAILLE TOTALE           : {format_size(total_bytes)} ({total_bytes / (1024**3):.3f} Go / {total_bytes / (1024**2):.1f} Mo)", flush=True)
    print("-" * 65, flush=True)
    print(f" {'Extension':<12} | {'Nombre':<10} | {'Taille Totale':<15} | {'Part (%)':<8}", flush=True)
    print("-" * 65, flush=True)

    sorted_exts = sorted(stats_by_ext.items(), key=lambda x: x[1]["size"], reverse=True)
    for ext, data in sorted_exts:
        pct = (data["size"] / total_bytes * 100) if total_bytes > 0 else 0
        print(f" {ext:<12} | {data['count']:<10} | {format_size(data['size']):<15} | {pct:>6.1f}%", flush=True)
    print("=" * 65, flush=True)

    csv_file = Path(__file__).parent / "telegram_inventory.csv"
    with open(csv_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["id", "date", "filename", "extension", "size_bytes", "size_mb"])
        writer.writeheader()
        writer.writerows(file_list)

    print(f"\n Inventaire complet exporte dans : {csv_file.name} ({len(file_list)} lignes)", flush=True)
    await client.disconnect()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n Annulation demandee.", flush=True)
    except Exception as err:
        print(f"\n Erreur : {err}", flush=True)
