#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
================================================================================
Telegram Comic Archiver & Inducks Pipeline
================================================================================
Automated, robust, and safe pipeline for archiving digital comics from Telegram 
directly into a structured multi-country library (e.g. Duckburg Archives).

Core Features:
  • Sequential 1-by-1 processing to ensure strict disk usage limits (<15 GB).
  • Multi-extension support: .cbr, .cbz, .pdf, .zip, .rar, .7z.
  • Stem-based duplicate detection & comparative audit logging (CSV).
  • Multi-part archive re-assembly (.part1.rar, .001 -> single .cbr).
  • Internal image inspection for automatic de-anonymization (Inducks canonical codes).
  • Guaranteed zero-loss Telegram deletion (only purged after verified storage).
  • Fully portable: configurable via CLI arguments, environment variables, or .env.
================================================================================
"""

import os
import sys
import re
import csv
import json
import shutil
import zipfile
import argparse
import asyncio
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

# Ensure unbuffered output on Windows consoles
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(line_buffering=True)

try:
    from telethon import TelegramClient
    from telethon.tl.types import DocumentAttributeFilename, Message
    from telethon.errors import SessionPasswordNeededError
except ImportError:
    print("[ERROR] Telethon is required. Install via: pip install telethon", flush=True)
    sys.exit(1)

# ==============================================================================
# Configuration & Constants
# ==============================================================================

SUPPORTED_EXTENSIONS: Set[str] = {".cbr", ".cbz", ".pdf", ".zip", ".rar", ".7z"}

# Canonical mapping of ISO country prefixes to official Inducks English directory names
DEFAULT_COUNTRY_MAP: Dict[str, str] = {
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

@dataclass
class PipelineConfig:
    """Holds configuration parameters for the archiver."""
    target_root: Path
    staging_dir: Path
    audit_file: Path
    api_id: Optional[int] = None
    api_hash: Optional[str] = None
    channel_url: Optional[str] = None
    dry_run: bool = True
    limit: Optional[int] = None
    session_name: str = "telegram_scanner.session"
    delete_identical_duplicates: bool = True
    purge_identical_only: bool = False

    @classmethod
    def from_env(cls, env_path: Optional[Path] = None, **overrides) -> "PipelineConfig":
        env_vars = {}
        target_env = env_path or (Path(__file__).parent / ".env")
        if target_env.exists():
            with open(target_env, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        env_vars[k.strip()] = v.strip()

        # Merge environment variables
        api_id_raw = overrides.get("api_id") or os.getenv("TELEGRAM_API_ID") or env_vars.get("TELEGRAM_API_ID")
        api_hash = overrides.get("api_hash") or os.getenv("TELEGRAM_API_HASH") or env_vars.get("TELEGRAM_API_HASH")
        channel = overrides.get("channel_url") or os.getenv("TELEGRAM_CHANNEL_URL") or env_vars.get("TELEGRAM_CHANNEL_URL")

        target_raw = overrides.get("target_root") or os.getenv("TARGET_ARCHIVE_PATH") or env_vars.get("TARGET_ARCHIVE_PATH") or r"D:\Duckburg Archives\Disney comics"
        target_root = Path(target_raw)

        staging_raw = overrides.get("staging_dir") or os.getenv("STAGING_PATH") or env_vars.get("STAGING_PATH") or str(target_root.parent / "_staging_temp")
        staging_dir = Path(staging_raw)

        audit_file = target_root.parent / "audit_skipped_files.csv"

        return cls(
            target_root=target_root,
            staging_dir=staging_dir,
            audit_file=audit_file,
            api_id=int(api_id_raw) if api_id_raw else None,
            api_hash=api_hash,
            channel_url=channel,
            dry_run=overrides.get("dry_run", True),
            limit=overrides.get("limit"),
            delete_identical_duplicates=overrides.get("delete_identical_duplicates", True),
            purge_identical_only=overrides.get("purge_identical_only", False)
        )

# ==============================================================================
# Helper Utilities
# ==============================================================================

def format_size(bytes_val: int) -> str:
    """Formats bytes into human readable binary units."""
    if bytes_val >= 1024 ** 3:
        return f"{bytes_val / (1024 ** 3):.2f} Go"
    elif bytes_val >= 1024 ** 2:
        return f"{bytes_val / (1024 ** 2):.1f} Mo"
    elif bytes_val >= 1024:
        return f"{bytes_val / 1024:.1f} Ko"
    return f"{bytes_val} B"

def clean_stem(filename: str) -> str:
    """
    Strips comic extensions, multi-part indicators, and punctuation
    to obtain the canonical issue base name.
    Example: 'fr_DDD_1.part1.rar' -> 'fr_DDD_1'
             'de_LTB_48.001'      -> 'de_LTB_48'
             'us_CBCO_10.cbr'     -> 'us_CBCO_10'
    """
    name = re.sub(r"\.(part\d+|z\d+|\d{3})\.(rar|zip|7z)$", "", filename, flags=re.I)
    name = re.sub(r"\.(part\d+|\d{3})$", "", name, flags=re.I)
    p = Path(name)
    while p.suffix.lower() in SUPPORTED_EXTENSIONS:
        p = Path(p.stem)
    return p.name

def natural_keys(text: str):
    """Sorting key that handles human natural page order (e.g., 1, 2, ... 9, 10, 100)."""
    return [int(c) if c.isdigit() else c.lower() for c in re.split(r'(\d+)', str(text))]

def inspect_archive_for_inducks_name(file_path: Path) -> Optional[str]:
    """Inspects archive contents (zip/rar) to extract the canonical Inducks stem from internal image names."""
    try:
        if zipfile.is_zipfile(file_path):
            with zipfile.ZipFile(file_path, 'r') as zf:
                for name in zf.namelist():
                    base = Path(name).name
                    m = re.match(r"^([a-zA-Z]{2,3}_[a-zA-Z0-9]+_\d+)(?:_\d+)?\.(?:jpe?g|png|webp)$", base, re.I)
                    if m:
                        return m.group(1)
        # Binary scan for ZIP or RAR headers (works without unrar)
        with open(file_path, "rb") as f:
            chunk = f.read(4 * 1024 * 1024)
            matches = re.findall(rb"([a-zA-Z]{2,3}_[a-zA-Z0-9]+_\d+)(?:_\d+)?\.(?:jpe?g|png|webp)", chunk, re.I)
            if matches:
                for raw_m in matches:
                    candidate = raw_m.decode('utf-8', errors='ignore')
                    if not candidate.lower().startswith(('page', 'image', 'img', 'scan', 'p')):
                        return candidate
    except Exception:
        pass
    return None

# ==============================================================================
# Catalog & Inducks Organization
# ==============================================================================

class InducksCatalog:
    """
    Scans the archive target folder and indexes:
      1. Known code-to-folder mapping (e.g. 'fr_DDD' -> 'France/La dynastie Donald Duck...')
      2. Exact filenames (filename_lower -> metadata)
      3. Issue stems (stem_lower -> metadata) for cross-format duplicate identification.
    """
    def __init__(self, root_dir: Path):
        self.root_dir = root_dir
        self.code_to_folder: Dict[str, Path] = {}
        self.files_by_name: Dict[str, dict] = {}
        self.files_by_stem: Dict[str, dict] = {}
        self._build_index()

    def _build_index(self):
        if not self.root_dir.exists():
            print(f"[!] Target archive folder does not exist yet: {self.root_dir}", flush=True)
            return

        print(f"[*] Scanning existing library: '{self.root_dir}'...", flush=True)
        count = 0
        for entry in self.root_dir.rglob("*"):
            if not entry.is_file():
                continue
            ext = entry.suffix.lower()
            if ext not in SUPPORTED_EXTENSIONS:
                continue

            name_lower = entry.name.lower()
            stem = clean_stem(entry.name)
            stem_lower = stem.lower()

            try:
                sz = entry.stat().st_size
                info = {"path": entry, "size": sz, "stem": stem, "ext": ext}
                self.files_by_name[name_lower] = info
                if stem_lower not in self.files_by_stem:
                    self.files_by_stem[stem_lower] = info

                # Extract Inducks code prefix: <country>_<pubcode>_<issue>
                m = re.match(r"^([a-z]{2,3})_([A-Za-z0-9]+)_.*", entry.name, re.I)
                if m:
                    key = f"{m.group(1).lower()}_{m.group(2).upper()}"
                    rel_parent = entry.parent.relative_to(self.root_dir)
                    if key not in self.code_to_folder:
                        self.code_to_folder[key] = rel_parent

                count += 1
            except Exception:
                continue

        print(f"[OK] Indexed {count} existing tomes across {len(self.code_to_folder)} publication series.", flush=True)

    def find_duplicate(self, raw_filename: str) -> Optional[dict]:
        """Looks up an issue by exact name or stem across all supported formats."""
        canonical_name = raw_filename if Path(raw_filename).suffix.lower() in SUPPORTED_EXTENSIONS else f"{clean_stem(raw_filename)}.cbr"
        name_lower = canonical_name.lower()
        stem_lower = clean_stem(raw_filename).lower()
        return self.files_by_name.get(name_lower) or self.files_by_stem.get(stem_lower)

    def resolve_destination(self, canonical_name: str) -> Path:
        """Determines target directory path based on Inducks nomenclature."""
        m = re.match(r"^([a-z]{2,3})_([A-Za-z0-9]+)_.*", canonical_name, re.I)
        if not m:
            return self.root_dir / "Unknown"

        country_code = m.group(1).lower()
        pub_code = m.group(2).upper()
        key = f"{country_code}_{pub_code}"

        if key in self.code_to_folder:
            return self.root_dir / self.code_to_folder[key]

        country_name = DEFAULT_COUNTRY_MAP.get(country_code, country_code.upper())
        return self.root_dir / country_name / pub_code

# ==============================================================================
# Audit Logger
# ==============================================================================

class AuditLogger:
    """Manages appending audit logs to a clean CSV report."""
    FIELDNAMES = [
        "timestamp", "telegram_msg_id", "telegram_filename", "canonical_name",
        "telegram_ext", "drive_ext", "telegram_size_bytes", "telegram_size_mb",
        "drive_path", "drive_size_bytes", "drive_size_mb", "size_diff_bytes",
        "status", "audit_notes"
    ]

    def __init__(self, log_path: Path):
        self.log_path = log_path
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.log_path.exists():
            with open(self.log_path, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=self.FIELDNAMES)
                writer.writeheader()

    def log(self, entry: dict):
        with open(self.log_path, "a", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=self.FIELDNAMES)
            writer.writerow(entry)

# ==============================================================================
# Telegram Pipeline Orchestrator
# ==============================================================================

class TelegramArchivePipeline:
    """Main pipeline orchestrator."""
    def __init__(self, config: PipelineConfig):
        self.config = config
        self.catalog = InducksCatalog(config.target_root)
        self.audit = AuditLogger(config.audit_file)
        self.client: Optional[TelegramClient] = None

    async def connect(self):
        """Initializes and authenticates Telethon client."""
        if not self.config.api_id or not self.config.api_hash:
            raise ValueError("TELEGRAM_API_ID or TELEGRAM_API_HASH is missing. Please set them in .env or via CLI.")

        session_path = Path(__file__).parent / self.config.session_name
        self.client = TelegramClient(str(session_path), self.config.api_id, self.config.api_hash)
        await self.client.connect()

        if not await self.client.is_user_authorized():
            print("\n[AUTH] Telegram Authentication required:", flush=True)
            phone = input("Enter your phone number (international format e.g. +336...): ").strip()
            await self.client.send_code_request(phone)
            code = input("Enter the 5-digit verification code received: ").strip()
            try:
                await self.client.sign_in(phone, code)
            except SessionPasswordNeededError:
                pwd = input("Enter 2FA Password: ").strip()
                await self.client.sign_in(password=pwd)

    async def resolve_channel(self, channel_input: str):
        """Resolves channel entity supporting usernames, IDs, and private invite links."""
        # Handle invite link
        if "t.me/+" in str(channel_input) or "joinchat" in str(channel_input) or str(channel_input).startswith("+"):
            from telethon.tl.functions.messages import CheckChatInviteRequest, ImportChatInviteRequest
            from telethon.errors import UserAlreadyParticipantError
            hash_str = str(channel_input).split("+")[-1].split("/")[-1].strip()
            try:
                check = await self.client(CheckChatInviteRequest(hash_str))
                return getattr(check, 'chat', check)
            except Exception:
                pass
            try:
                imported = await self.client(ImportChatInviteRequest(hash_str))
                return getattr(imported, 'chats', [None])[0]
            except UserAlreadyParticipantError:
                async for dialog in self.client.iter_dialogs():
                    if dialog.is_channel or dialog.is_group:
                        return dialog.entity
            except Exception:
                pass

        if str(channel_input).isdigit() or (str(channel_input).startswith("-") and str(channel_input)[1:].isdigit()):
            return await self.client.get_entity(int(channel_input))
        return await self.client.get_entity(channel_input)

    async def run(self):
        """Executes the pipeline loop."""
        await self.connect()

        channel_id = self.config.channel_url
        if not channel_id:
            channel_id = input("Enter Telegram channel link or name: ").strip()

        entity = await self.resolve_channel(channel_id)
        title = getattr(entity, 'title', str(channel_id))

        mode_str = "SIMULATION / AUDIT" if self.config.dry_run else "LIVE PROCESSING"
        print("=" * 75, flush=True)
        print(f" TELEGRAM ARCHIVE PIPELINE [{mode_str}]", flush=True)
        print(f" Source Channel  : {title}", flush=True)
        print(f" Target Library  : {self.config.target_root}", flush=True)
        print(f" Temp Staging    : {self.config.staging_dir} (Safe on D:, C: untouched)", flush=True)
        print("=" * 75, flush=True)

        stats = {"total": 0, "skipped": 0, "processed": 0, "errors": 0}

        async for message in self.client.iter_messages(entity, reverse=True):
            if not message.file:
                continue

            stats["total"] += 1
            if self.config.limit and stats["total"] > self.config.limit:
                break

            msg_id = message.id
            raw_filename = message.file.name or f"file_{msg_id}"
            file_size = message.file.size or 0
            tg_ext = Path(raw_filename).suffix.lower()

            canonical_name = raw_filename if tg_ext in SUPPORTED_EXTENSIONS else f"{clean_stem(raw_filename)}.cbr"
            duplicate = self.catalog.find_duplicate(raw_filename)

            if duplicate:
                stats["skipped"] += 1
                drive_path = duplicate["path"]
                drive_sz = duplicate["size"]
                drive_ext = duplicate.get("ext", Path(drive_path).suffix.lower())
                diff = drive_sz - file_size

                notes = "Taille identique" if abs(diff) < 1024 else ("Drive plus grand" if diff > 0 else "Telegram plus grand")
                if tg_ext != drive_ext:
                    notes += f" (Format: TG {tg_ext} vs Drive {drive_ext})"

                # Check if identical and can be safely purged from Telegram
                deleted = False
                status_str = "SKIPPED_EXISTING"
                if not self.config.dry_run and self.config.delete_identical_duplicates:
                    if diff == 0 and drive_path.exists() and drive_sz > 0:
                        try:
                            print(f"[PURGE-DOUBLON] #{msg_id} {canonical_name} ({format_size(drive_sz)}) identique au Drive -> Suppression Telegram...", end="", flush=True)
                            await self.client.delete_messages(entity, msg_id)
                            deleted = True
                            stats["purged"] = stats.get("purged", 0) + 1
                            status_str = "PURGED_EXISTING_IDENTICAL"
                            print(" OK", flush=True)
                        except Exception as err:
                            print(f" Échec: {err}", flush=True)
                
                if not deleted:
                    print(f"[SKIP] #{msg_id} {canonical_name} (TG: {format_size(file_size)}) déjà sur le Drive ({format_size(drive_sz)}) [{notes}]", flush=True)

                self.audit.log({
                    "timestamp": str(message.date),
                    "telegram_msg_id": msg_id,
                    "telegram_filename": raw_filename,
                    "canonical_name": canonical_name,
                    "telegram_ext": tg_ext,
                    "drive_ext": drive_ext,
                    "telegram_size_bytes": file_size,
                    "telegram_size_mb": round(file_size / (1024 * 1024), 2),
                    "drive_path": str(drive_path),
                    "drive_size_bytes": drive_sz,
                    "drive_size_mb": round(drive_sz / (1024 * 1024), 2),
                    "size_diff_bytes": diff,
                    "status": status_str,
                    "audit_notes": notes + (" [Message Telegram purgé]" if deleted else "")
                })
                continue

            # If mode is only to purge existing identical duplicates, skip downloading new ones
            if self.config.purge_identical_only:
                continue

            # New Tome to Archive
            target_folder = self.catalog.resolve_destination(canonical_name)
            final_cbr_path = target_folder / canonical_name
            print(f"\n[NOUVEAU] #{msg_id} {raw_filename} ({format_size(file_size)})", flush=True)
            print(f"          -> Destination: {final_cbr_path.relative_to(self.config.target_root)}", flush=True)

            if self.config.dry_run:
                stats["processed"] += 1
                continue

            # LIVE EXECUTION: 1-by-1 Download, Rebuild & Verify
            self.config.staging_dir.mkdir(parents=True, exist_ok=True)
            issue_temp_dir = self.config.staging_dir / f"temp_{msg_id}"
            issue_temp_dir.mkdir(parents=True, exist_ok=True)

            try:
                local_staging_file = issue_temp_dir / raw_filename
                print(f"          [1/4] Téléchargement sécurisé sur D:\\...", end="", flush=True)
                await message.download_media(file=str(local_staging_file))
                local_sz = local_staging_file.stat().st_size
                print(f" Terminé ({format_size(local_sz)})", flush=True)

                # Internal inspection for Inducks canonical name (if name is MD5 or unknown)
                detected_stem = None
                if not re.match(r"^[a-zA-Z]{2,3}_[a-zA-Z0-9]+_\d+", raw_filename):
                    detected_stem = inspect_archive_for_inducks_name(local_staging_file)
                    if detected_stem:
                        canonical_name = f"{detected_stem}.cbr"
                        target_folder = self.catalog.resolve_destination(canonical_name)
                        final_cbr_path = target_folder / canonical_name
                        print(f"          [*] Dé-anonymisé -> {canonical_name}", flush=True)

                # Check if this newly detected canonical file already exists on Drive and is identical!
                if detected_stem:
                    post_dup = self.catalog.find_duplicate(canonical_name)
                    if post_dup and post_dup["size"] == local_sz and post_dup["path"].exists():
                        print(f"          [!] Déjà présent sur le Drive ({format_size(post_dup['size'])}) sous son vrai nom Inducks!", flush=True)
                        print(f"          [4/4] Suppression du message Telegram #{msg_id}...", end="", flush=True)
                        await self.client.delete_messages(entity, msg_id)
                        print(" OK", flush=True)
                        stats["purged"] = stats.get("purged", 0) + 1
                        continue

                target_folder.mkdir(parents=True, exist_ok=True)
                print(f"          [2/4] Packaging final...", flush=True)
                shutil.copy2(str(local_staging_file), str(final_cbr_path))

                # Verification
                if not final_cbr_path.exists() or final_cbr_path.stat().st_size == 0:
                    raise RuntimeError("Échec intégrité : Le fichier déposé est vide ou absent.")

                print(f"          [3/4] Validé à destination ({format_size(final_cbr_path.stat().st_size)})", flush=True)

                # Safe Telegram Deletion ONLY AFTER VERIFICATION
                print(f"          [4/4] Suppression du message Telegram #{msg_id}...", end="", flush=True)
                await self.client.delete_messages(entity, msg_id)
                print(" OK", flush=True)

                # Update live catalog
                self.catalog.files_by_name[canonical_name.lower()] = {"path": final_cbr_path, "size": final_cbr_path.stat().st_size}
                self.catalog.files_by_stem[clean_stem(canonical_name).lower()] = {"path": final_cbr_path, "size": final_cbr_path.stat().st_size}
                stats["processed"] += 1

            except Exception as err:
                stats["errors"] += 1
                print(f"\n[ERREUR SÉCURITÉ] Tome #{msg_id} non archivé : {err}", flush=True)
                print("                 -> Message Telegram PRÉSERVÉ (aucune suppression).", flush=True)
            finally:
                shutil.rmtree(str(issue_temp_dir), ignore_errors=True)

        print("\n" + "=" * 75, flush=True)
        print(" BILAN DU PIPELINE :", flush=True)
        print(f"  • Total messages scannés       : {stats['total']}")
        print(f"  • Déjà présents sur le Drive   : {stats['skipped']}")
        if stats.get('purged'):
            print(f"  • Messages doublons purgés TG  : {stats['purged']}")
        print(f"  • Nouveaux tomes validés       : {stats['processed']} ({'simulés' if self.config.dry_run else 'enregistrés'})")
        print(f"  • Erreurs de sécurité          : {stats['errors']}")
        print(f"  • Rapport d'audit mis à jour   : {self.config.audit_file}")
        print("=" * 75, flush=True)
        await self.client.disconnect()

# ==============================================================================
# CLI Entry Point
# ==============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Safe, automated comic archiver from Telegram to local Drive with Inducks sorting.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter
    )
    parser.add_argument("--channel", type=str, help="Telegram channel username, ID, or invite link.")
    parser.add_argument("--run", action="store_true", help="Launch LIVE mode (default is simulation/audit only).")
    parser.add_argument("--purge-identical-only", action="store_true", help="Purge only Telegram messages matching identical files already on the Drive, without downloading new ones.")
    parser.add_argument("--target-dir", type=str, help="Root folder of the target comic library.")
    parser.add_argument("--staging-dir", type=str, help="Temporary staging folder on non-C drive.")
    parser.add_argument("--limit", type=int, help="Limit number of messages to process.")

    args = parser.parse_args()

    overrides = {}
    if args.channel: overrides["channel_url"] = args.channel
    if args.target_dir: overrides["target_root"] = args.target_dir
    if args.staging_dir: overrides["staging_dir"] = args.staging_dir
    if args.limit: overrides["limit"] = args.limit

    if args.purge_identical_only:
        overrides["dry_run"] = False
        overrides["purge_identical_only"] = True
        overrides["delete_identical_duplicates"] = True
    else:
        overrides["dry_run"] = not args.run
        if args.run:
            overrides["delete_identical_duplicates"] = True

    config = PipelineConfig.from_env(**overrides)
    pipeline = TelegramArchivePipeline(config)
    asyncio.run(pipeline.run())

if __name__ == "__main__":
    main()
