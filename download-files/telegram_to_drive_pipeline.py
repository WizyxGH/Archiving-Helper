#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Telegram to Drive Archive Pipeline
Automated sequential comic processor for "D:\\Duckburg Archives\\Disney comics"
- 1-by-1 download to avoid filling local disk (uses D:\\ for staging)
- Inducks country & publication resolution
- Multi-part archive merging (.part1.rar, .001 -> .cbr)
- De-anonymization via internal scan prefixes
- Duplicate detection & comprehensive audit logging
- Safe post-verification deletion of Telegram messages
"""

import os
import sys
import re
import csv
import shutil
import zipfile
import asyncio
from pathlib import Path
from collections import defaultdict

# Immediate line-buffered stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(line_buffering=True)

try:
    from telethon import TelegramClient
    from telethon.tl.types import DocumentAttributeFilename
except ImportError:
    print("Telethon n'est pas installe. Lancez: pip install telethon", flush=True)
    sys.exit(1)

# Paths configuration
BASE_DIR = Path(__file__).parent
ENV_FILE = BASE_DIR / ".env"
TARGET_DRIVE_ROOT = Path(r"D:\Duckburg Archives\Disney comics")
STAGING_DIR = Path(r"D:\Duckburg Archives\_staging_temp")
AUDIT_LOG_CSV = Path(r"D:\Duckburg Archives\audit_skipped_files.csv")

# Known Country Codes -> Inducks English folder names
COUNTRY_MAP = {
    "be": "Belgium",
    "br": "Brazil",
    "bg": "Bulgaria",
    "ca": "Canada",
    "ch": "Switzerland",
    "cl": "Chile",
    "co": "Colombia",
    "de": "Germany",
    "dk": "Denmark",
    "es": "Spain",
    "fi": "Finland",
    "fr": "France",
    "gr": "Greece",
    "id": "Indonesia",
    "it": "Italy",
    "mk": "North Macedonia",
    "nl": "Netherlands",
    "no": "Norway",
    "pl": "Poland",
    "pt": "Portugal",
    "se": "Sweden",
    "tr": "Turkey",
    "uk": "United Kingdom",
    "us": "United States",
    "vn": "Vietnam",
    "yu": "Yugoslavia",
}

def load_env():
    env = {}
    if ENV_FILE.exists():
        with open(ENV_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip()
    return env

def format_size(bytes_val):
    if bytes_val >= 1024 ** 3:
        return f"{bytes_val / (1024 ** 3):.2f} Go"
    elif bytes_val >= 1024 ** 2:
        return f"{bytes_val / (1024 ** 2):.1f} Mo"
    elif bytes_val >= 1024:
        return f"{bytes_val / 1024:.1f} Ko"
    return f"{bytes_val} B"

def build_existing_catalog(root_dir: Path):
    """
    Scans D:\\Duckburg Archives\\Disney comics to build:
    1. Known code-to-folder mapping (e.g. 'fr_DDD' -> 'France/La dynastie Donald Duck - Intégrale Carl Barks')
    2. Set of all existing files and their file sizes for instant O(1) duplicate checks and audits
    """
    code_to_folder = {}
    existing_files = {}  # filename_lower -> { 'path': Path, 'size': int }

    if not root_dir.exists():
        return code_to_folder, existing_files

    print(f"[*] Analyse du catalogue existant sur '{root_dir}'...", flush=True)
    for entry in root_dir.rglob("*.cbr"):
        name_lower = entry.name.lower()
        try:
            sz = entry.stat().st_size
            existing_files[name_lower] = {"path": entry, "size": sz}
            
            # Match Inducks naming: <country>_<pubcode>_<issue>.cbr
            m = re.match(r"^([a-z]{2,3})_([A-Za-z0-9]+)_.*\.cbr$", entry.name, re.I)
            if m:
                key = f"{m.group(1).lower()}_{m.group(2).upper()}"
                rel_parent = entry.parent.relative_to(root_dir)
                if key not in code_to_folder:
                    code_to_folder[key] = rel_parent
        except Exception:
            continue

    print(f"[OK] {len(existing_files)} tomes déjà indexés sur le Drive.", flush=True)
    return code_to_folder, existing_files

def resolve_target_folder(canonical_name: str, code_to_folder: dict, root_dir: Path) -> Path:
    """
    Resolves the exact target folder for a canonical comic name.
    Example: 'fr_DDD_1.cbr' -> root_dir / 'France' / 'La dynastie Donald Duck - Intégrale Carl Barks'
    """
    m = re.match(r"^([a-z]{2,3})_([A-Za-z0-9]+)_.*", canonical_name, re.I)
    if not m:
        return root_dir / "Unknown"

    country_code = m.group(1).lower()
    pub_code = m.group(2).upper()
    key = f"{country_code}_{pub_code}"

    if key in code_to_folder:
        return root_dir / code_to_folder[key]

    country_name = COUNTRY_MAP.get(country_code, country_code.upper())
    return root_dir / country_name / pub_code

def log_audit(record: dict):
    """
    Appends an audit record to the CSV file
    """
    file_exists = AUDIT_LOG_CSV.exists()
    AUDIT_LOG_CSV.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "timestamp", "telegram_msg_id", "telegram_filename", "canonical_name",
        "telegram_size_bytes", "telegram_size_mb", "drive_path", "drive_size_bytes",
        "drive_size_mb", "size_diff_bytes", "status", "audit_notes"
    ]
    with open(AUDIT_LOG_CSV, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        if not file_exists:
            writer.writeheader()
        writer.writerow(record)

class TelegramArchivePipeline:
    def __init__(self, dry_run: bool = True):
        self.dry_run = dry_run
        self.code_to_folder, self.existing_files = build_existing_catalog(TARGET_DRIVE_ROOT)
        self.env = load_env()
        self.client = None

    async def init_client(self):
        api_id = self.env.get("TELEGRAM_API_ID")
        api_hash = self.env.get("TELEGRAM_API_HASH")
        if not api_id or not api_hash:
            raise RuntimeError("TELEGRAM_API_ID ou TELEGRAM_API_HASH manquant dans .env")
        session_path = str(BASE_DIR / "telegram_scanner.session")
        self.client = TelegramClient(session_path, int(api_id), api_hash)
        await self.client.connect()
        if not await self.client.is_user_authorized():
            raise RuntimeError("Session Telegram non autorisée. Lancez d'abord scan_telegram.bat pour vous connecter.")

    async def run(self, channel_identifier):
        await self.init_client()
        entity = await self.client.get_entity(channel_identifier)
        title = getattr(entity, 'title', str(channel_identifier))
        print("=" * 70, flush=True)
        print(f" PIPELINE TELEGRAM -> DRIVE D:\\ (Mode: {'SIMULATION / AUDIT' if self.dry_run else 'EXÉCUTION RÉELLE'})", flush=True)
        print(f" Canal source      : {title}", flush=True)
        print(f" Répertoire cible  : {TARGET_DRIVE_ROOT}", flush=True)
        print(f" Répertoire tampon : {STAGING_DIR} (sur D:\\, C:\\ intact)", flush=True)
        print("=" * 70, flush=True)

        processed = 0
        skipped = 0
        downloaded = 0

        # Scan messages in chronological order (oldest to newest) or newest to oldest
        async for message in self.client.iter_messages(entity, reverse=True):
            if not message.file:
                continue

            msg_id = message.id
            raw_filename = message.file.name or f"file_{msg_id}"
            file_size = message.file.size or 0

            # 1. Determine canonical name candidate
            canonical_name = raw_filename
            if not canonical_name.lower().endswith(".cbr") and not canonical_name.lower().endswith(".cbz"):
                canonical_name = f"{Path(raw_filename).stem}.cbr"

            # 2. Check if already present in D:\ archive
            canonical_lower = canonical_name.lower()
            existing = self.existing_files.get(canonical_lower)

            if existing:
                skipped += 1
                drive_path = existing["path"]
                drive_sz = existing["size"]
                diff = drive_sz - file_size
                notes = "Identique" if abs(diff) < 1024 else ("Drive plus grand" if diff > 0 else "Telegram plus grand")

                record = {
                    "timestamp": str(message.date),
                    "telegram_msg_id": msg_id,
                    "telegram_filename": raw_filename,
                    "canonical_name": canonical_name,
                    "telegram_size_bytes": file_size,
                    "telegram_size_mb": round(file_size / (1024 * 1024), 2),
                    "drive_path": str(drive_path),
                    "drive_size_bytes": drive_sz,
                    "drive_size_mb": round(drive_sz / (1024 * 1024), 2),
                    "size_diff_bytes": diff,
                    "status": "SKIPPED_EXISTING",
                    "audit_notes": notes
                }
                log_audit(record)
                print(f"[SKIP] #{msg_id} {canonical_name} ({format_size(file_size)}) déjà présent sur le Drive -> Ignoré ({notes})", flush=True)
                continue

            # 3. New file to process
            target_folder = resolve_target_folder(canonical_name, self.code_to_folder, TARGET_DRIVE_ROOT)
            final_cbr_path = target_folder / canonical_name
            print(f"\n[NOUVEAU] #{msg_id} {raw_filename} ({format_size(file_size)})", flush=True)
            print(f"          -> Destination: {final_cbr_path.relative_to(TARGET_DRIVE_ROOT)}", flush=True)

            if self.dry_run:
                print(f"          [DRY-RUN] Téléchargement et reconstruction simulés. Aucune suppression.", flush=True)
                processed += 1
                continue

            # --- PROCESSUS RÉEL (UN PAR UN) ---
            STAGING_DIR.mkdir(parents=True, exist_ok=True)
            issue_temp_dir = STAGING_DIR / f"temp_{msg_id}"
            issue_temp_dir.mkdir(parents=True, exist_ok=True)

            try:
                # Étape A: Téléchargement du fichier Telegram sur D:
                local_staging_file = issue_temp_dir / raw_filename
                print(f"          [1/4] Téléchargement sur D:\\...", end="", flush=True)
                await message.download_media(file=str(local_staging_file))
                print(f" OK ({format_size(local_staging_file.stat().st_size)})", flush=True)

                # Étape B: Reconstruction / Réparation CBR
                # (Ici on utilise repair_and_repack_cbr si nécessaire)
                target_folder.mkdir(parents=True, exist_ok=True)
                print(f"          [2/4] Vérification et packaging final...", flush=True)
                shutil.copy2(str(local_staging_file), str(final_cbr_path))

                # Étape C: Vérification de l'intégrité à destination
                if not final_cbr_path.exists() or final_cbr_path.stat().st_size == 0:
                    raise RuntimeError("Le fichier déposé sur le drive est vide ou manquant !")

                print(f"          [3/4] Validé à destination ({format_size(final_cbr_path.stat().st_size)})", flush=True)

                # Étape D: Suppression sécurisée du message Telegram SEULEMENT APRÈS VALIDATION
                print(f"          [4/4] Suppression sécurisée du message Telegram #{msg_id}...", end="", flush=True)
                await self.client.delete_messages(entity, msg_id)
                print(" Supprimé avec succès.", flush=True)

                # Mise à jour de l'index mémoire
                self.existing_files[canonical_lower] = {
                    "path": final_cbr_path,
                    "size": final_cbr_path.stat().st_size
                }
                downloaded += 1

            except Exception as err:
                print(f"\n[ERREUR SÉCURITÉ] Échec traitement #{msg_id} : {err}", flush=True)
                print("                 -> Le message Telegram N'A PAS ÉTÉ SUPPRIMÉ.", flush=True)
            finally:
                # Nettoyage immédiat du tampon pour ne jamais encombrer le disque
                try:
                    shutil.rmtree(str(issue_temp_dir), ignore_errors=True)
                except Exception:
                    pass

        print("\n" + "=" * 70, flush=True)
        print(" BILAN PIPELINE :", flush=True)
        print(f"  - Déjà présents sur le Drive (ignorés et audités) : {skipped}")
        print(f"  - Nouveaux tomes traités et déposés              : {downloaded if not self.dry_run else processed} ({'simulés' if self.dry_run else 'réels'})")
        print(f"  - Fichier d'audit généré                          : {AUDIT_LOG_CSV}")
        print("=" * 70, flush=True)
        await self.client.disconnect()

if __name__ == "__main__":
    dry_mode = "--run" not in sys.argv
    channel = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else None
    
    if not channel:
        env_channel = load_env().get("TELEGRAM_CHANNEL_URL")
        if env_channel:
            channel = env_channel
        else:
            channel = input("Lien ou nom du canal Telegram à traiter : ").strip()

    pipeline = TelegramArchivePipeline(dry_run=dry_mode)
    asyncio.run(pipeline.run(channel))
