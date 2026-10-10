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
import tempfile
import argparse
import asyncio
import subprocess
import time
import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional, Set


# ==============================================================================
# Nommage des dossiers de publication
# ==============================================================================
# Miroir de src/core/naming.mjs : le script Python classe les tomes avant que
# Node ne soit disponible, il lui faut donc sa propre implémentation. Les deux
# fichiers doivent rester alignes.

_FORBIDDEN_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_TRAILING_DOTS_SPACES = re.compile(r"[.\s]+$")
_RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    *{f"COM{i}" for i in range(1, 10)},
    *{f"LPT{i}" for i in range(1, 10)},
}


def sanitize_folder_name(title: str) -> str:
    """Rend un titre Inducks utilisable comme nom de dossier sous Windows.

    422 titres sur 7 303 contiennent un caractère interdit (`\\ / : * ? " < > |`) :
    sans normalisation, 6 % des publications ne pourraient pas être créées.
    """
    name = _FORBIDDEN_CHARS.sub("-", str(title or ""))
    name = re.sub(r"\s{2,}", " ", name)
    name = _TRAILING_DOTS_SPACES.sub("", name)
    name = name.strip()
    name = re.sub(r"^-+|-+$", "", name).strip()

    if not name:
        return "Sans titre"
    if name.upper() in _RESERVED_NAMES:
        return f"_{name}"
    return name


# ==============================================================================
# Couleurs console
# ==============================================================================

_ANSI_COLORS = {
    "reset": "\x1b[0m",
    "cyan": "\x1b[36m",
    "green": "\x1b[32m",
    "red": "\x1b[31m",
    "yellow": "\x1b[33m",
    "blue": "\x1b[34m",
    "magenta": "\x1b[35m",
    "grey": "\x1b[90m",
    "bold": "\x1b[1m",
}

# Pas de couleur quand la sortie est redirigée vers un fichier, quand NO_COLOR
# est défini, ou quand on force l'absence avec FORCE_COLOR=0.
_COLOR_ENABLED = (
    os.environ.get("FORCE_COLOR", "") not in ("", "0")
    or (os.environ.get("NO_COLOR") is None and sys.stdout.isatty())
)


def colorize(value: str, color: str = "") -> str:
    """Entoure `value` d'un code couleur ANSI, si la console le permet."""
    if not _COLOR_ENABLED:
        return str(value)
    prefix = "".join(_ANSI_COLORS[c] for c in color.split("+") if c in _ANSI_COLORS)
    return f"{prefix}{value}{_ANSI_COLORS['reset']}" if prefix else str(value)


def dim(value: str) -> str:
    return colorize(value, "grey")


def success(value: str) -> str:
    return colorize(value, "green")


def failure(value: str) -> str:
    return colorize(value, "red")


def warn(value: str) -> str:
    return colorize(value, "yellow")

# Sortie console : line_buffering pour voir les lignes au fur et a mesure,
# encoding explicite sinon Python se cale sur la page de codes de la console
# (cp1252 sur un Windows FR) et re-encode les accents en "Ã©".
# UTF-8 sans BOM : la console est en chcp 65001, impose par le lanceur.
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
    except (ValueError, OSError):
        pass  # stdout redirige ou terminal sans encodage : on laisse tel quel
if hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8", line_buffering=True)
    except (ValueError, OSError):
        pass


def _enable_timestamped_stdout() -> None:
    """Prefix every written line with the time, when output goes to a file.

    The pipeline prints its whole progress with `print(..., flush=True)`, and a run
    can last hours. Without a timestamp a log file cannot be correlated with a run,
    nor a failure with the tome it belongs to — the console must stay clean, so this
    only applies when stdout is redirected to a file rather than a terminal.

    The colour codes are kept at the very end of the line so the prefix itself never
    inherits a colour from the message it precedes.
    """
    if os.environ.get("PIPELINE_TIMESTAMPED_LOG") == "1":
        pass  # forced on, even on a terminal
    elif sys.stdout.isatty():
        return
    else:
        # Only when a run is actually being captured; PIPELINE_NO_TIMESTAMP disables.
        if os.environ.get("PIPELINE_NO_TIMESTAMP") == "1":
            return

    plain = sys.stdout

    class _Timestamped:
        def write(self, text: str) -> int:
            if not text.strip():
                return plain.write(text)
            # One prefix per line: a print() may carry several.
            now = datetime.now().strftime("%H:%M:%S")
            plain.write("".join(f"[{now}] {line}" for line in text.splitlines(keepends=True)))
            return len(text)

        def flush(self) -> None:
            plain.flush()

        def isatty(self) -> bool:
            return False

        def __getattr__(self, name):
            return getattr(plain, name)

    sys.stdout = _Timestamped()


_enable_timestamped_stdout()

try:
    from telethon import TelegramClient
    from telethon.errors import SessionPasswordNeededError
except ImportError:
    print(failure("[ERREUR] Telethon est requis. Installez-le via : pip install telethon"), flush=True)
    sys.exit(1)

# ==============================================================================
# Configuration & Constants
# ==============================================================================

SUPPORTED_EXTENSIONS: Set[str] = {".cbr", ".cbz", ".pdf", ".zip", ".rar", ".7z"}

# Codes pays Inducks -> nom de dossier. Généré par scripts/gen-country-names.py
# depuis inducks_country : ne pas réduire cette liste à la main. Un code absent
# retombe sur son code en majuscules comme nom de dossier (EG, LU).
DEFAULT_COUNTRY_MAP = {
  "ae": "United Arab Emirates",
  "al": "Albania",
  "an": "Netherlands Antilles",
  "ar": "Argentina",
  "at": "Austria",
  "au": "Australia",
  "bb": "Barbados",
  "be": "Belgium",
  "bg": "Bulgaria",
  "br": "Brazil",
  "by": "Belarus",
  "ca": "Canada",
  "ch": "Switzerland",
  "cl": "Chile",
  "cn": "China",
  "co": "Colombia",
  "cu": "Cuba",
  "cz": "Czech Republic",
  "dc": "Digital comics",
  "de": "Germany",
  "dk": "Denmark",
  "dz": "Algeria",
  "ec": "Ecuador",
  "ee": "Estonia",
  "eg": "Egypt",
  "es": "Spain",
  "fi": "Finland",
  "fo": "Faroe Islands",
  "fr": "France",
  "gr": "Greece",
  "gt": "Guatemala",
  "gy": "Guyana",
  "hk": "Hong Kong",
  "hn": "Honduras",
  "hr": "Croatia",
  "hu": "Hungary",
  "id": "Indonesia",
  "ie": "Ireland",
  "il": "Israel",
  "in": "India",
  "ir": "Iran",
  "is": "Iceland",
  "it": "Italy",
  "jp": "Japan",
  "kr": "South Korea",
  "kw": "Kuwait",
  "lb": "Lebanon",
  "lt": "Lithuania",
  "lu": "Luxembourg",
  "lv": "Latvia",
  "ma": "Morocco",
  "mk": "North Macedonia",
  "mn": "Mongolia",
  "mx": "Mexico",
  "my": "Malaysia",
  "nl": "Netherlands",
  "no": "Norway",
  "nz": "New Zealand",
  "pa": "Panama",
  "pe": "Peru",
  "ph": "Philippines",
  "pl": "Poland",
  "pt": "Portugal",
  "ro": "Romania",
  "rs": "Serbia",
  "ru": "Russia",
  "sa": "Saudi Arabia",
  "se": "Sweden",
  "sg": "Singapore",
  "si": "Slovenia",
  "sk": "Slovakia",
  "sv": "El Salvador",
  "th": "Thailand",
  "tn": "Tunisia",
  "tr": "Turkey",
  "tw": "Taiwan",
  "ua": "Ukraine",
  "uk": "United Kingdom",
  "us": "United States",
  "uy": "Uruguay",
  "ve": "Venezuela",
  "vn": "Vietnam",
  "yu": "Yugoslavia",
  "za": "South Africa",
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
    # Palier de rafraîchissement de la barre de progression, en pourcentage.
    # Telegram émet plusieurs blocs par seconde : sans regroupement la ligne est
    # réécrite des centaines de fois et le défilement devient illisible.
    # 5 % est un bon compromis ; 0 désactive complètement la barre.
    progress_step_pct: int = 1
    resume: bool = False
    from_id: Optional[int] = None
    concurrency: int = 3
    skip_deanonymize: bool = False
    deanonymize_until: Optional[int] = None

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

        # CSV d'audit et journal des runs : rien a faire sur le disque de la
        # bibliotheque. AUDIT_DIR, sinon le dossier de collection
        # (INDUCKS_COLLECTION_DIR), sinon download-files/files_downloads, ou se
        # trouve deja le CSV de collection.
        audit_raw = (
            overrides.get("audit_dir")
            or os.getenv("AUDIT_DIR") or env_vars.get("AUDIT_DIR")
            or os.getenv("INDUCKS_COLLECTION_DIR") or env_vars.get("INDUCKS_COLLECTION_DIR")
            or str(Path(__file__).parent / "files_downloads")
        )
        audit_file = Path(audit_raw) / "audit_skipped_files.csv"

        # Palier de progression : .env > variable d'environnement > défaut 1.
        # Une valeur invalide ou négative retombe sur le défaut plutôt que de
        # planter le pipeline au démarrage.
        progress_raw = (
            overrides.get("progress_step_pct")
            or os.getenv("PROGRESS_STEP_PCT")
            or env_vars.get("PROGRESS_STEP_PCT")
        )
        try:
            progress_step_pct = int(str(progress_raw))
            if progress_step_pct < 0:
                progress_step_pct = 1
        except (TypeError, ValueError):
            progress_step_pct = 1

        concurrency_raw = (
            overrides.get("concurrency")
            or os.getenv("TELEGRAM_CONCURRENCY")
            or env_vars.get("TELEGRAM_CONCURRENCY")
            or 3
        )
        try:
            concurrency = max(1, int(concurrency_raw))
        except (TypeError, ValueError):
            concurrency = 3

        skip_deanonymize_raw = (
            overrides.get("skip_deanonymize")
            or os.getenv("TELEGRAM_SKIP_DEANONYMIZE")
            or env_vars.get("TELEGRAM_SKIP_DEANONYMIZE")
        )
        skip_deanonymize = str(skip_deanonymize_raw).strip().lower() in ("1", "true", "yes")

        deanonymize_until_raw = (
            overrides.get("deanonymize_until")
            or os.getenv("TELEGRAM_DEANONYMIZE_UNTIL")
            or env_vars.get("TELEGRAM_DEANONYMIZE_UNTIL")
            or 2867
        )
        try:
            deanonymize_until = int(deanonymize_until_raw) if deanonymize_until_raw is not None else 2867
        except (TypeError, ValueError):
            deanonymize_until = 2867

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
            purge_identical_only=overrides.get("purge_identical_only", False),
            progress_step_pct=progress_step_pct,
            resume=overrides.get("resume", False),
            from_id=overrides.get("from_id"),
            concurrency=concurrency,
            skip_deanonymize=skip_deanonymize,
            deanonymize_until=deanonymize_until,
        )

# ==============================================================================
# Helper Utilities
# ==============================================================================

def format_size(bytes_val: int) -> str:
    """Formats bytes into human readable binary units.

    Deux décimales partout : le contrôle de doublon compare des tailles au
    kilo-octet près, et « 28.0 Mo » contre « 28.04 Mo » masque l'écart réel.
    """
    if bytes_val >= 1024 ** 3:
        return f"{bytes_val / (1024 ** 3):.2f} Go"
    elif bytes_val >= 1024 ** 2:
        return f"{bytes_val / (1024 ** 2):.2f} Mo"
    elif bytes_val >= 1024:
        return f"{bytes_val / 1024:.2f} Ko"
    return f"{bytes_val} B"


_active_progress: Dict[str, dict] = {}
_last_render_time: float = 0.0
_progress_enabled: bool = True


def set_progress_step(pct: int) -> None:
    """Fixe le palier de rafraîchissement de la barre (0 = désactivée)."""
    global _progress_enabled
    _progress_enabled = (pct > 0)
    _active_progress.clear()


def report_progress(progress: str, current: int, total: int) -> None:
    """Affiche l'avancement du téléchargement (monotâche ou multitâche simultané)."""
    global _last_render_time
    if not _progress_enabled or not total:
        return

    now = time.time()
    info = _active_progress.get(progress)
    if not info:
        info = {
            "t0": now,
            "current": current,
            "total": total,
            "last_bytes": current,
            "last_t": now,
            "speed": 0.0
        }
        _active_progress[progress] = info
    else:
        info["current"] = current
        info["total"] = total
        dt = now - info["last_t"]
        if dt >= 0.35:
            db = current - info["last_bytes"]
            info["speed"] = max(0.0, db / dt)
            info["last_bytes"] = current
            info["last_t"] = now

    if current >= total:
        _active_progress.pop(progress, None)

    # Cadencement à 400 ms pour éviter de saturer le terminal
    if (now - _last_render_time) < 0.4 and current < total:
        return
    _last_render_time = now

    if not _active_progress:
        return

    cols = shutil.get_terminal_size((80, 20)).columns

    if len(_active_progress) == 1:
        prog_id, d = next(iter(_active_progress.items()))
        cur = d["current"]
        tot = d["total"]
        pct = (cur * 100.0) / tot if tot else 0.0
        spd = d.get("speed", 0.0)
        speed_text = f" • {format_size(spd)}/s" if spd > 0 else ""

        bar_width = max(8, min(16, cols - 55))
        filled = min(int((cur / tot) * bar_width), bar_width) if tot else 0
        bar = "█" * filled + "░" * (bar_width - filled)
        bar_color = "green" if pct >= 90 else "yellow" if pct >= 40 else "cyan"

        line = (
            f"\r  {dim(prog_id)} {colorize(bar, bar_color)} "
            f"{colorize(f'{pct:5.1f} %', 'bold')} "
            f"{dim(f'({format_size(cur)} / {format_size(tot)}{speed_text})')}\033[K"
        )
        sys.stdout.write(line)
    else:
        items = []
        total_speed = 0.0
        for prog_id, d in list(_active_progress.items()):
            cur = d["current"]
            tot = d["total"]
            pct = (cur * 100.0) / tot if tot else 0.0
            spd = d.get("speed", 0.0)
            total_speed += spd
            items.append(f"{prog_id}: {pct:4.1f}%")

        summary = " | ".join(items)
        speed_text = f" • {format_size(total_speed)}/s" if total_speed > 0 else ""
        prefix = f"[{len(_active_progress)}x] "

        # Tronquer si la ligne totale risque de dépasser la largeur du terminal
        max_summary_len = max(10, cols - len(prefix) - len(speed_text) - 6)
        if len(summary) > max_summary_len:
            summary = summary[:max_summary_len - 1] + "…"

        line = f"\r  {dim(prefix)}{colorize(summary, 'bold')}{dim(speed_text)}\033[K"
        sys.stdout.write(line)
    sys.stdout.flush()


def reset_progress_line() -> None:
    """Efface la ligne d'avancement active sans supprimer les données de suivi."""
    sys.stdout.write("\r\033[K")
    sys.stdout.flush()


def log_print(*args, **kwargs) -> None:
    """Affiche un message en effaçant proprement la ligne de progression active."""
    sep = kwargs.get("sep", " ")
    end = kwargs.get("end", "\n")
    text = sep.join(str(a) for a in args)
    sys.stdout.write(f"\r\033[K{text}{end}")
    sys.stdout.flush()


def write_run_log(config: "PipelineConfig", stats: dict) -> None:
    """Ajoute le bilan du run à un journal horodaté, à côté du rapport CSV.

    Le CSV trace les tomes un par un ; ce journal trace les exécutions. Il
    permet de retrouver d'un coup d'œil combien de tomes sont passés par mode
    et combien ont échoué, sans relire 2 400 lignes de rapport.
    """
    try:
        log_directory = config.audit_file.parent
        log_directory.mkdir(parents=True, exist_ok=True)
        log_path = log_directory / "telegram_pipeline_runs.log"

        mode = "AUDIT" if config.dry_run else "LIVE"
        if not config.dry_run and not config.delete_identical_duplicates:
            mode = "LIVE (sans purge)"

        with open(log_path, "a", encoding="utf-8") as log:
            log.write(
                f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | {mode} | "
                f"scannés={stats['total']} | "
                f"déjà présents={stats['skipped']} | "
                f"archivés={stats['processed']} | "
                f"purgés={stats.get('purged', 0)} | "
                f"erreurs={stats['errors']}"
                + (f" | limite={config.limit}" if config.limit else "")
                + "\n"
            )
    except Exception as err:
        # Un journal non écrit ne doit jamais interrompre l'archivage.
        print(f"[!] Journal non écrit : {err}", flush=True)


def is_drive_accessible(path_obj: Path) -> bool:
    """Vérifie si le lecteur/volume d'un chemin est monté et accessible."""
    try:
        anchor = path_obj.anchor or (path_obj.drive + "\\" if path_obj.drive else "")
        if anchor:
            return Path(anchor).exists()
        return True
    except Exception:
        return False


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


def is_canonical_inducks_name(filename_or_stem: str) -> bool:
    """Vérifie si le nom respecte déjà la norme officielle Inducks (<pays>_<code_pub>_<num>).
    Exemple: 'fr_DDD_1.cbr', 'ca_OP_4.cbr', 'uk_DLAI_1969.cbr', 'us_CBCO_10.cbr'.
    Si oui, le tome est déjà parfaitement identifié : aucune désanonymisation interne requise.
    """
    stem = clean_stem(filename_or_stem)
    parts = stem.split("_")
    if len(parts) >= 3:
        country = parts[0].lower()
        if country in DEFAULT_COUNTRY_MAP:
            return True
    return False

def natural_keys(text: str):
    """Sorting key that handles human natural page order (e.g., 1, 2, ... 9, 10, 100)."""
    return [int(c) if c.isdigit() else c.lower() for c in re.split(r'(\d+)', str(text))]

INDUCKS_STEM_IN_IMAGE_RE = re.compile(
    # Le nom doit commencer a une frontiere : sans (?<!...), « page_001_2.jpg »
    # donnait « age_001_2 » en reprenant la recherche a la lettre suivante.
    # Le numero peut contenir des lettres (S5, 1978B) mais au moins un chiffre ;
    # le suffixe _<page> facultatif est ensuite ignore.
    rb"(?<![A-Za-z0-9])([a-zA-Z]{2,3}_[a-zA-Z0-9]+_[A-Za-z]*\d[A-Za-z0-9]*)(?:_\d+)?\.(?:jpe?g|png|webp)", re.I
)

# En-tete RAR/ZIP : le premier nom d'image interne (donc le code Inducks du
# tome) se lit des les premieres centaines d'octets. Mesure sur 40 tomes de la
# bibliotheque : offset constant a 50 octets, 40/40 identifiables avec 512 Ko.
# On peut donc conclure « deja archive » apres 512 Ko au lieu de 30 a 780 Mo.
HEADER_PROBE_BYTES = 512 * 1024


class _EarlyDuplicateExit(Exception):
    """Interrompt download_media : l'en-tete prouve que le tome est deja archive.

    Telethon ignore la valeur de retour du progress_callback ; seule une
    exception arrete le telechargement en cours.
    """

    def __init__(self, stem: str, existing_path: Path):
        super().__init__(f"{stem} deja archive : {existing_path}")
        self.stem = stem
        self.existing_path = existing_path

# Noms de fichiers generiques, rejetes comme faux positifs. On compare le
# premier segment entier : un test « commence par » avec « p » ecartait tous
# les pays en p (pl_GM_14, pt_DEG_29), qui finissaient dans Unknown.
_GENERIC_IMAGE_STEMS = {"page", "image", "img", "scan", "picture", "p"}


def _is_generic_stem(candidate: str) -> bool:
    return candidate.split("_", 1)[0].lower() in _GENERIC_IMAGE_STEMS


def identify_inducks_stem_from_header(file_path: Path) -> Optional[str]:
    """Lit le nom Inducks du tome dans l'en-tete, sans avoir tout le fichier.

    Retourne le stem (ex. « ca_OP_4 ») ou None si l'en-tete ne suffit pas encore.
    Utilisable sur un fichier encore en cours de telechargement : les noms
    internes sont ecrits dans l'entete, pas dans le repertoire de fin.
    """
    try:
        with open(file_path, "rb") as f:
            head = f.read(HEADER_PROBE_BYTES)
    except OSError:
        return None

    for match in INDUCKS_STEM_IN_IMAGE_RE.finditer(head):
        candidate = match.group(1).decode("utf-8", errors="ignore")
        if not _is_generic_stem(candidate):
            return candidate
    return None


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
            for match in INDUCKS_STEM_IN_IMAGE_RE.finditer(chunk):
                candidate = match.group(1).decode('utf-8', errors='ignore')
                if not _is_generic_stem(candidate):
                    return candidate
    except Exception:
        pass
    return None


# Noms de scan deja resolus pendant ce run (stem -> resultat ou None).
_SCAN_STEM_CACHE: Dict[str, Optional[dict]] = {}


def resolve_scan_stem(stem: str) -> Optional[dict]:
    """Numero Inducks officiel d'un nom de scan, ou None si incertain.

    « GHL_M_2 » -> {canonicalStem: « fr_GHL_M_2 », issueCode: « fr/GHLM  2 », ...}

    La logique vit cote Node (src/core/inducks/issue_index.mjs, resolveScanStem) :
    on l'interroge plutot que de la recopier. Un echec de Node n'est pas mis en
    cache, pour qu'un incident passager ne fige pas le resultat du run.
    """
    if stem in _SCAN_STEM_CACHE:
        return _SCAN_STEM_CACHE[stem]

    node = shutil.which("node")
    script = Path(__file__).resolve().parents[1] / "src" / "core" / "inducks" / "resolve_stem.mjs"
    if not node or not script.exists():
        return None
    try:
        result = subprocess.run(
            [node, str(script), stem],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=120,
        )
        if result.returncode != 0:
            return None
        resolved = json.loads(result.stdout).get(stem)
    except Exception:
        return None

    _SCAN_STEM_CACHE[stem] = resolved
    return resolved


def official_stem(stem: str) -> str:
    """Nom canonique Inducks du tome, ou le nom recu s'il n'est pas resolu."""
    resolved = resolve_scan_stem(stem)
    return resolved["canonicalStem"] if resolved else stem


# Signature des premiers octets -> extension correspondant au contenu reel.
_ARCHIVE_SIGNATURES = ((b"Rar!", ".cbr"), (b"PK\x03\x04", ".cbz"))


def archive_extension_from_content(file_path: Path) -> Optional[str]:
    """.cbr pour un RAR, .cbz pour un ZIP, None si le format est inconnu.

    Telegram fournit parfois des ZIP nommes .cbr : la verification les ouvrait
    avec Rar.exe, qui les refusait, et le tome finissait en erreur de securite.
    """
    try:
        with open(file_path, "rb") as handle:
            head = handle.read(4)
    except OSError:
        return None
    for signature, extension in _ARCHIVE_SIGNATURES:
        if head.startswith(signature):
            return extension
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
        # Taille en octets -> tome(s) deja archives. Mesure sur la bibliotheque
        # actuelle : 934 tomes, 934 tailles distinctes, aucun doublon de taille.
        # Une taille identique implique donc le meme tome, ce qui permet de
        # conclure « deja archive » sans telecharger les 30 a 780 Mo.
        self.files_by_size: Dict[int, dict] = {}
        self.publication_titles: Dict[str, str] = {}
        self._load_publication_titles()
        self._build_index()

    def _load_publication_titles(self):
        """Charge le catalogue Inducks (country_code -> titre de publication).

        Le catalogue vit en JavaScript, cote Node. On l'interroge via un petit
        script Node plutot que de dupliquer les 7 303 titres en Python : une
        seule source de verite, et le cache Inducks existant est reutilise.
        """
        script = (
            "import('./src/core/inducks/inducks.mjs').then(async m => {"
            "const db = await m.loadCachedDatabase();"
            "const out = {};"
            "for (const p of db) {"
            "  const key = (p.country||'').toLowerCase() + '_' + (p.code||'').toUpperCase();"
            "  if (p.title) out[key] = p.title;"
            "}"
            "process.stdout.write(JSON.stringify(out));"
            "})"
        )
        node = shutil.which("node")
        if not node:
            print(warn("[!] Node.js absent : les dossiers porteront le code de publication au lieu du titre."), flush=True)
            return

        repo_root = Path(__file__).resolve().parents[1]
        try:
            # encoding explicite : la console Windows est en cp1252, alors que
            # les titres Inducks sortent en UTF-8. Sans cela, Node titrait
            # UnicodeDecodeError, stdout restait None, et le catalogue entier
            # tombait en repli « code de publication » : les dossiers retrouvaient
            # leur nom abrege.
            result = subprocess.run(
                [node, "-e", script],
                cwd=str(repo_root),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=60,
            )
            if result.returncode != 0 or not result.stdout.strip():
                print(warn("[!] Catalogue Inducks indisponible : repli sur le code de publication."), flush=True)
                return

            self.publication_titles = json.loads(result.stdout)
            print(success(f"[OK] Catalogue Inducks : {len(self.publication_titles)} titres chargés."), flush=True)
        except Exception as err:
            print(warn(f"[!] Catalogue Inducks illisible ({err}) : repli sur le code."), flush=True)

    def _build_index(self):
        if not self.root_dir.exists():
            print(warn(f"[!] Dossier d'archive cible absent : {self.root_dir}"), flush=True)
            return

        print(colorize(f"[*] Analyse de la bibliotheque existante : '{self.root_dir}'...", "cyan"), flush=True)
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
                # Un tome de meme taille qu'un tome deja archive n'est conserve
                # que si les deux font la meme taille ET le meme stem ; sinon on
                # n'indexe pas cette taille, pour ne pas conclure a tort.
                if sz not in self.files_by_size:
                    self.files_by_size[sz] = info
                elif self.files_by_size[sz]["stem"].lower() != stem_lower:
                    self.files_by_size[sz] = {"ambiguous": True, "size": sz}

                # Extract Inducks code prefix: <country>_<pubcode>_<issue>
                m = re.match(r"^([a-z]{2,3})_([A-Za-z0-9]+)_.*", entry.name, re.I)
                if m and m.group(1).lower() in DEFAULT_COUNTRY_MAP:
                    key = f"{m.group(1).lower()}_{m.group(2).upper()}"
                    # On ne memorise QUE le dossier de publication, jamais le
                    # prefixe pays trouve sur le disque. Memoriser le chemin
                    # complet perpetuait un dossier residuel (CA/ au lieu de
                    # Canada/) : resolve_destination le privilegiait alors a la
                    # resolution Inducks et tous les tomes suivants y allaient.
                    country = m.group(1).lower()
                    country_name = sanitize_folder_name(
                        DEFAULT_COUNTRY_MAP.get(country, country.upper())
                    )
                    publication = sanitize_folder_name(entry.parent.name)
                    if key not in self.code_to_folder:
                        self.code_to_folder[key] = Path(country_name) / publication

                count += 1
            except Exception:
                continue

        print(success(f"[OK] {count} tomes indexes dans {len(self.code_to_folder)} series."), flush=True)

    def find_duplicate(self, raw_filename: str) -> Optional[dict]:
        """Looks up an issue by exact name or stem across all supported formats."""
        canonical_name = raw_filename if Path(raw_filename).suffix.lower() in SUPPORTED_EXTENSIONS else f"{clean_stem(raw_filename)}.cbr"
        name_lower = canonical_name.lower()
        stem_lower = clean_stem(raw_filename).lower()
        return self.files_by_name.get(name_lower) or self.files_by_stem.get(stem_lower)

    def resolve_destination(self, canonical_name: str) -> Path:
        """Determines target directory path based on Inducks nomenclature."""
        m = re.match(r"^([a-z]{2,3})_([A-Za-z0-9]+)_.*", canonical_name, re.I)
        # Le prefixe doit etre un vrai code pays Inducks. « GHL_M_2 » commence
        # par un code de publication : le lire comme un pays creait un dossier
        # « GHL ». Un nom non resolu va dans Unknown, jamais dans un pays invente.
        if not m or m.group(1).lower() not in DEFAULT_COUNTRY_MAP:
            return self.root_dir / "Unknown"

        country_code = m.group(1).lower()
        pub_code = m.group(2).upper()
        key = f"{country_code}_{pub_code}"

        if key in self.code_to_folder:
            return self.root_dir / self.code_to_folder[key]

        # Le nom du dossier est le TITRE Inducks de la publication, normalise
        # pour Windows. Avant, on utilisait le code (Canada/BDD), ce qui
        # dispersait une publication sur deux chemins selon le tome traite.
        country_name = DEFAULT_COUNTRY_MAP[country_code]
        publication_title = self.publication_titles.get(key)   # self EST le catalogue

        if not publication_title:
            # Publication inconnue d'Inducks : le code reste le seul repere.
            # Le nom est prefixe du code pour rester triable a cote des autres.
            return self.root_dir / sanitize_folder_name(country_name) / sanitize_folder_name(f"{country_code.upper()} {pub_code}")

        return self.root_dir / sanitize_folder_name(country_name) / sanitize_folder_name(publication_title)

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


def compute_sha256(filepath: Path) -> str:
    """Calcule l'empreinte SHA256 d'un fichier de façon rapide et streamée."""
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def natural_sort_key(s: str) -> list:
    """Clé de tri naturel alphanumérique pour aligner les enregistrements."""
    return [int(text) if text.isdigit() else text.lower() for text in re.split(r'(\d+)', str(s))]


def update_collection_csv_record(
    archive_path: Path,
    config: "PipelineConfig",
    catalog: Optional["InducksCatalog"] = None,
    sha256_hash: Optional[str] = None,
) -> None:
    """Met à jour directement le fichier inducks_collection.csv et .inducks_collection.json en Python (< 5 ms)."""
    if not archive_path.exists() or archive_path.stat().st_size == 0:
        return

    collection_dir = config.audit_file.parent
    collection_dir.mkdir(parents=True, exist_ok=True)
    registry_path = collection_dir / ".inducks_collection.json"
    csv_path = collection_dir / "inducks_collection.csv"

    registry: Dict[str, dict] = {}
    if registry_path.exists():
        try:
            with open(registry_path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                if isinstance(loaded, dict):
                    registry = loaded
        except Exception:
            registry = {}

    canonical_stem = clean_stem(archive_path.name)
    archive_format = archive_path.suffix.lstrip(".").lower()
    collection_key = f"{canonical_stem}|{archive_format}"

    m = re.match(r"^([a-z]{2,3})_([A-Za-z0-9]+)_(.*)$", canonical_stem, re.I)
    country_code = m.group(1).lower() if m else ""
    pub_code = m.group(2).upper() if m else ""
    issue_number = m.group(3) if m else ""
    pub_title = ""
    if catalog and m:
        pub_title = catalog.publication_titles.get(f"{country_code}_{pub_code}", "")

    # Utilise l'empreinte calculée à la volée pendant le téléchargement (0 lecture disque supplémentaire)
    if not sha256_hash:
        sha256_hash = compute_sha256(archive_path)
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

    record = {
        "collection_key": collection_key,
        "canonical_stem": canonical_stem,
        "inducks_issue_code": f"{country_code}/{pub_code}{issue_number}" if country_code and pub_code else "",
        "country": country_code,
        "publication": pub_code,
        "issue_number": issue_number,
        "format": archive_format,
        "archive_path": str(archive_path.resolve()),
        "image_count": registry.get(collection_key, {}).get("image_count", ""),
        "sha256": sha256_hash,
        "status": "registered_without_upload_bundle",
        "comment": registry.get(collection_key, {}).get("comment", "") or registry.get(collection_key, {}).get("notes", "") or registry.get(collection_key, {}).get("private_comments", ""),
        "updated_at": now_iso,
    }

    registry[collection_key] = record

    # Écriture atomique JSON
    temp_registry = registry_path.with_suffix(f".tmp.{os.getpid()}")
    with open(temp_registry, "w", encoding="utf-8") as f:
        json.dump(registry, f, indent=2, ensure_ascii=False)
        f.write("\n")
    temp_registry.replace(registry_path)

    # Écriture atomique CSV
    columns = [
        "canonical_stem",
        "inducks_issue_code",
        "country",
        "publication",
        "issue_number",
        "format",
        "archive_path",
        "archive_size_bytes",
        "image_count",
        "sha256",
        "status",
        "comment",
        "updated_at",
    ]

    records = list(registry.values())
    records.sort(key=lambda r: (natural_sort_key(r.get("canonical_stem", "")), str(r.get("format", ""))))

    temp_csv = csv_path.with_suffix(f".tmp.{os.getpid()}")
    with open(temp_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f, quoting=csv.QUOTE_ALL, lineterminator="\r\n")
        writer.writerow(columns)
        for rec in records:
            writer.writerow([rec.get(col, "") for col in columns])
    temp_csv.replace(csv_path)


# ==============================================================================
# Telegram Pipeline Orchestrator
# ==============================================================================

class TelegramArchivePipeline:
    """Main pipeline orchestrator."""
    def __init__(self, config: PipelineConfig):
        self.config = config
        self._validate_storage()
        self.catalog = InducksCatalog(config.target_root)
        self.audit = AuditLogger(config.audit_file)
        self.checkpoint_file = self.config.audit_file.parent / ".telegram_checkpoint.json"
        self.client: Optional[TelegramClient] = None
        self.csv_lock = asyncio.Lock()
        self.checkpoint_lock = asyncio.Lock()
        self._all_seen_ids: list = []
        self._completed_ids: set = set()

    def load_checkpoint(self) -> Optional[int]:
        """Charge le dernier ID de message traité depuis le fichier checkpoint."""
        if not self.checkpoint_file.exists():
            return None
        try:
            with open(self.checkpoint_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data.get("last_processed_msg_id")
        except Exception:
            return None

    def save_checkpoint(self, msg_id: int):
        """Mémorise le dernier ID de message Telegram traité avec succès."""
        if self.config.dry_run:
            return
        try:
            self.checkpoint_file.parent.mkdir(parents=True, exist_ok=True)
            data = {
                "last_processed_msg_id": msg_id,
                "updated_at": datetime.now(timezone.utc).isoformat()
            }
            tmp = self.checkpoint_file.with_suffix(f".tmp.{os.getpid()}")
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            tmp.replace(self.checkpoint_file)
        except Exception:
            pass

    async def record_checkpoint(self, msg_id: int):
        """Met à jour le checkpoint avec le plus grand ID continu garanti traité."""
        if self.config.dry_run:
            return
        async with self.checkpoint_lock:
            self._completed_ids.add(msg_id)
            safe_id = None
            for seen_id in self._all_seen_ids:
                if seen_id in self._completed_ids:
                    safe_id = seen_id
                else:
                    break
            if safe_id is not None:
                self.save_checkpoint(safe_id)

    def _validate_storage(self):
        """Vérifie l'accessibilité du support de stockage cible."""
        if not is_drive_accessible(self.config.target_root):
            anchor = self.config.target_root.anchor or (self.config.target_root.drive + "\\" if self.config.target_root.drive else "Cible")
            print(colorize(f"\n[ERREUR CRITIQUE] Le lecteur '{anchor}' du dossier d'archivage est inaccessible !", "red+bold"), flush=True)
            print(colorize(f"  Dossier cible configuré : {self.config.target_root}", "red"), flush=True)
            print(colorize("  -> Le disque dur externe n'est pas branché ou sa lettre a changé sous Windows.", "yellow"), flush=True)
            print(colorize("  -> Branchez votre disque, ou configurez TARGET_ARCHIVE_PATH dans download-files/.env.\n", "yellow"), flush=True)
            sys.exit(1)

        if not is_drive_accessible(self.config.staging_dir):
            fallback_staging = Path(tempfile.gettempdir()) / "archiving-helper" / "_staging_temp"
            print(colorize(f"[*] Dossier staging inaccessible ({self.config.staging_dir}). Redirection vers : {fallback_staging}", "yellow"), flush=True)
            self.config.staging_dir = fallback_staging

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

    def should_deanonymize(self, msg_id: int, raw_filename: str) -> bool:
        """Détermine si le tome nécessite une inspection interne d'archive.
        
        Sauté si:
        - --skip-deanonymize est activé
        - msg_id > deanonymize_until
        - Le nom de fichier est déjà un code Inducks officiel (ex: fr_DDD_1.cbr, uk_DLAI_1969.cbr)
        """
        if self.config.skip_deanonymize:
            return False
        if self.config.deanonymize_until is not None and msg_id > self.config.deanonymize_until:
            return False
        if is_canonical_inducks_name(raw_filename):
            return False
        return True

    async def purge_message(self, entity, msg_id: int, stats: dict, duplicate: bool = True) -> bool:
        """Supprime le message Telegram si, et seulement si, la purge est active.

        Tous les chemins de suppression passent ici : en --no-purge (ou en
        audit), aucun message n'est jamais supprime, meme pour un doublon prouve.
        """
        if self.config.dry_run or not self.config.delete_identical_duplicates:
            log_print(dim(f"          [4/4] #{msg_id} Message Telegram conserve (purge desactivee)"))
            return False
        try:
            await self.client.delete_messages(entity, msg_id)
            log_print(warn(f"          [4/4] #{msg_id} Message Telegram supprime"))
            if duplicate:
                stats["purged"] = stats.get("purged", 0) + 1
            return True
        except Exception as err:
            log_print(failure(f"          [!] #{msg_id} Echec suppression Telegram: {err}"))
            return False

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

    async def process_tome(self, entity, message, progress_str: str, stats: dict) -> None:
        """Télécharge, désanonymise si nécessaire, valide et archive un tome individuel."""
        msg_id = message.id
        raw_filename = message.file.name or f"file_{msg_id}"
        file_size = message.file.size or 0
        tg_ext = Path(raw_filename).suffix.lower()

        canonical_name = raw_filename if tg_ext in SUPPORTED_EXTENSIONS else f"{clean_stem(raw_filename)}.cbr"
        is_canonical = is_canonical_inducks_name(raw_filename)

        if is_canonical:
            log_print(colorize(f"[*] #{msg_id} {canonical_name} ({format_size(file_size)})...", "cyan"))
        else:
            log_print(colorize(f"[*] #{msg_id} {raw_filename} ({format_size(file_size)}) [scan en-tete 512 Ko]...", "cyan"))

        try:
            self.config.staging_dir.mkdir(parents=True, exist_ok=True)
            issue_temp_dir = self.config.staging_dir / f"temp_{msg_id}"
            issue_temp_dir.mkdir(parents=True, exist_ok=True)
        except OSError:
            fallback_staging = Path(tempfile.gettempdir()) / "archiving-helper" / "_staging_temp"
            try:
                fallback_staging.mkdir(parents=True, exist_ok=True)
                self.config.staging_dir = fallback_staging
                issue_temp_dir = self.config.staging_dir / f"temp_{msg_id}"
                issue_temp_dir.mkdir(parents=True, exist_ok=True)
                log_print(colorize(f"          [*] #{msg_id} Staging redirige vers : {fallback_staging}", "yellow"))
            except Exception as fatal_err:
                stats["errors"] += 1
                log_print(failure(f"    [ERREUR STOCKAGE] #{msg_id} Impossible de creer le dossier temporaire : {fatal_err}"))
                await self.record_checkpoint(msg_id)
                return

        try:
            local_staging_file = issue_temp_dir / raw_filename
            early_exit: Dict[str, object] = {"stem": None, "path": None, "probed": False, "existing_size": 0}
            file_hasher = hashlib.sha256()
            check_probe = self.should_deanonymize(msg_id, raw_filename)

            for attempt in range(1, 3):
                try:
                    early_exit["probed"] = False
                    file_hasher = hashlib.sha256()
                    with open(local_staging_file, "wb") as f_out:
                        async with self.client.iter_download(message.media, request_size=512 * 1024) as stream:
                            received = 0
                            async for chunk in stream:
                                f_out.write(chunk)
                                file_hasher.update(chunk)
                                received += len(chunk)
                                report_progress(progress_str, received, file_size)

                                if check_probe and not early_exit["probed"] and received >= HEADER_PROBE_BYTES and file_size > 0:
                                    early_exit["probed"] = True
                                    f_out.flush()
                                    def _probe_lookup(fpath: Path, fsz: int):
                                        st = identify_inducks_stem_from_header(fpath)
                                        if not st:
                                            return None
                                        kn = self.catalog.find_duplicate(f"{st}.cbr")
                                        if not kn:
                                            cn = official_stem(st)
                                            if cn != st:
                                                kn = self.catalog.find_duplicate(f"{cn}.cbr")
                                        if not kn:
                                            kn_sz = self.catalog.files_by_size.get(fsz)
                                            if kn_sz and not kn_sz.get("ambiguous"):
                                                kn = kn_sz
                                        if kn:
                                            return (st, kn["path"], kn["size"])
                                        return None

                                    probe_res = await asyncio.to_thread(_probe_lookup, local_staging_file, file_size)
                                    if probe_res:
                                        early_exit["stem"], early_exit["path"], early_exit["existing_size"] = probe_res
                                        break
                    break
                except (PermissionError, OSError) as dl_err:
                    if attempt < 2 and getattr(dl_err, "errno", None) == 13:
                        reset_progress_line()
                        log_print(warn(f"      [*] #{msg_id} Verrouillage temporaire Windows (Errno 13), nouvel essai dans 2 s..."))
                        await asyncio.sleep(2)
                        continue
                    raise

            if early_exit["stem"] is not None:
                existing = early_exit["path"]
                assert isinstance(existing, Path)
                existing_sz = int(early_exit.get("existing_size") or (existing.stat().st_size if existing.exists() else file_size))
                reset_progress_line()
                gained = file_size - HEADER_PROBE_BYTES
                diff = existing_sz - file_size
                notes = "taille identique" if diff == 0 else f"taille diff (Drive {format_size(existing_sz)})"
                log_print(
                    dim(
                        f"  [DOUBLON] #{msg_id} {existing.name} deja sur le Drive ({notes}) "
                        f"• Interrompu a 512 Ko ({format_size(gained)} economises)"
                    )
                )
                if diff == 0:
                    await self.purge_message(entity, msg_id, stats)
                else:
                    log_print(dim(f"            [i] #{msg_id} Message Telegram conserve car fichier different."))
                stats["skipped"] += 1
                self.audit.log({
                    "timestamp": str(message.date),
                    "telegram_msg_id": msg_id,
                    "telegram_filename": raw_filename,
                    "canonical_name": existing.name,
                    "telegram_ext": tg_ext,
                    "drive_ext": existing.suffix.lower(),
                    "telegram_size_bytes": file_size,
                    "telegram_size_mb": round(file_size / (1024 * 1024), 2),
                    "drive_path": str(existing),
                    "drive_size_bytes": existing_sz,
                    "drive_size_mb": round(existing_sz / (1024 * 1024), 2),
                    "size_diff_bytes": diff,
                    "status": "SKIPPED_EXISTING_HEADER_PROBE",
                    "audit_notes": f"Interrompu a 512 Ko [{notes}]"
                })
                await self.record_checkpoint(msg_id)
                return

            local_sz = local_staging_file.stat().st_size
            reset_progress_line()

            # Désanonymisation conditionnelle
            if self.should_deanonymize(msg_id, raw_filename):
                def _resolve_archive(fpath: Path, cname: str):
                    det = inspect_archive_for_inducks_name(fpath)
                    rec = clean_stem(cname)
                    fin = official_stem(det or rec)
                    return (det, rec, fin)

                detected_stem, received_stem, final_stem = await asyncio.to_thread(_resolve_archive, local_staging_file, canonical_name)
                renamed = final_stem != received_stem
                if renamed:
                    canonical_name = f"{final_stem}{Path(canonical_name).suffix}"
                    label = "Desanonymise" if detected_stem else "Nom Inducks"
                    log_print(colorize(f"          [*] #{msg_id} {label} : {raw_filename} -> {canonical_name}", "magenta"))

                    post_dup = self.catalog.find_duplicate(canonical_name)
                    if post_dup and post_dup["path"].exists():
                        drive_sz = post_dup["size"]
                        diff = drive_sz - local_sz
                        notes = "taille identique" if diff == 0 else f"taille diff (Drive {format_size(drive_sz)})"
                        log_print(dim(f"  [DOUBLON] #{msg_id} {canonical_name} deja sur le Drive ({notes})"))
                        if diff == 0:
                            await self.purge_message(entity, msg_id, stats)
                        else:
                            log_print(dim(f"            [i] #{msg_id} Message Telegram conserve car fichier different."))
                        stats["skipped"] += 1
                        self.audit.log({
                            "timestamp": str(message.date),
                            "telegram_msg_id": msg_id,
                            "telegram_filename": raw_filename,
                            "canonical_name": canonical_name,
                            "telegram_ext": tg_ext,
                            "drive_ext": post_dup.get("ext", Path(post_dup["path"]).suffix.lower()),
                            "telegram_size_bytes": file_size,
                            "telegram_size_mb": round(file_size / (1024 * 1024), 2),
                            "drive_path": str(post_dup["path"]),
                            "drive_size_bytes": drive_sz,
                            "drive_size_mb": round(drive_sz / (1024 * 1024), 2),
                            "size_diff_bytes": diff,
                            "status": "SKIPPED_EXISTING_POST_DEANONYMIZED",
                            "audit_notes": f"Deja present [{notes}]"
                        })
                        await self.record_checkpoint(msg_id)
                        return

            # Vérification du format réel
            real_ext = archive_extension_from_content(local_staging_file)
            if real_ext and Path(canonical_name).suffix.lower() != real_ext:
                canonical_name = f"{Path(canonical_name).stem}{real_ext}"
                log_print(colorize(f"          [*] #{msg_id} Format reel -> {canonical_name}", "magenta"))

            target_folder = self.catalog.resolve_destination(canonical_name)
            final_cbr_path = target_folder / canonical_name
            target_folder.mkdir(parents=True, exist_ok=True)

            # Vérification doublon à destination (sans écrasement)
            if final_cbr_path.exists():
                existing_sz = final_cbr_path.stat().st_size
                diff = existing_sz - local_sz
                notes = "taille identique" if diff == 0 else f"taille diff (Drive {format_size(existing_sz)})"
                log_print(dim(f"  [DOUBLON] #{msg_id} {canonical_name} deja present a destination ({notes}) — non ecrase."))
                if diff == 0:
                    await self.purge_message(entity, msg_id, stats)
                else:
                    log_print(dim(f"            [i] #{msg_id} Message Telegram conserve car fichier different."))
                stats["skipped"] += 1
                self.audit.log({
                    "timestamp": str(message.date),
                    "telegram_msg_id": msg_id,
                    "telegram_filename": raw_filename,
                    "canonical_name": canonical_name,
                    "telegram_ext": tg_ext,
                    "drive_ext": final_cbr_path.suffix.lower(),
                    "telegram_size_bytes": file_size,
                    "telegram_size_mb": round(file_size / (1024 * 1024), 2),
                    "drive_path": str(final_cbr_path),
                    "drive_size_bytes": existing_sz,
                    "drive_size_mb": round(existing_sz / (1024 * 1024), 2),
                    "size_diff_bytes": diff,
                    "status": "SKIPPED_EXISTING_AT_DESTINATION",
                    "audit_notes": f"Deja sur le Drive [{notes}]"
                })
                await self.record_checkpoint(msg_id)
                return

            # C'est un nouveau tome validé
            log_print(colorize(f"[NOUVEAU] #{msg_id} {canonical_name} ({format_size(local_sz)})", "green+bold"))
            log_print(success(f"          -> Valide a destination : {final_cbr_path.relative_to(self.config.target_root)}"))

            # Déplacement instantané sur le volume D:
            try:
                shutil.move(str(local_staging_file), str(final_cbr_path))
            except OSError:
                shutil.copy2(str(local_staging_file), str(final_cbr_path))

            if not final_cbr_path.exists() or final_cbr_path.stat().st_size == 0:
                raise RuntimeError("Echec integrite : le fichier depose est vide ou absent.")

            downloaded_sha256 = file_hasher.hexdigest()
            async with self.csv_lock:
                try:
                    update_collection_csv_record(final_cbr_path, self.config, self.catalog, sha256_hash=downloaded_sha256)
                    log_print(colorize(f"          [+] #{msg_id} Collection CSV actualisee", "green"))
                except Exception as csv_err:
                    log_print(warn(f"          [!] #{msg_id} Note collection CSV : {csv_err}"))

                self.catalog.files_by_name[canonical_name.lower()] = {"path": final_cbr_path, "size": final_cbr_path.stat().st_size}
                self.catalog.files_by_stem[clean_stem(canonical_name).lower()] = {"path": final_cbr_path, "size": final_cbr_path.stat().st_size}

            await self.purge_message(entity, msg_id, stats, duplicate=False)
            stats["processed"] += 1
            await self.record_checkpoint(msg_id)

        except Exception as err:
            stats["errors"] += 1
            reset_progress_line()
            log_print(failure(f"    [ERREUR SECURITE] Tome #{msg_id} non archive : {err}"))
            log_print(dim("                 -> Message Telegram PRESERVE (aucune suppression)."))
            await self.record_checkpoint(msg_id)
        finally:
            _active_progress.pop(progress_str, None)
            shutil.rmtree(str(issue_temp_dir), ignore_errors=True)

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
        print(f" Source Channel  : {colorize(title, 'bold')}", flush=True)
        print(f" Target Library  : {self.config.target_root}", flush=True)
        print(f" Temp Staging    : {self.config.staging_dir} (Safe on D:, C: untouched)", flush=True)
        print(f" Concurrency     : {colorize(str(self.config.concurrency) + ' flux simultanes', 'bold')}", flush=True)
        if self.config.skip_deanonymize:
            print(f" Deanonymisation : {colorize('Desactivee (--skip-deanonymize)', 'yellow')}", flush=True)
        elif self.config.deanonymize_until:
            print(f" Deanonymisation : {colorize(f'Activee jusqu au message #{self.config.deanonymize_until}', 'yellow')}", flush=True)
        print("=" * 75, flush=True)

        stats = {"total": 0, "skipped": 0, "processed": 0, "errors": 0}

        start_min_id = None
        if self.config.from_id is not None:
            start_min_id = max(0, self.config.from_id - 1)
            print(colorize(f"[*] Reprise forcee a partir du message #{self.config.from_id}", "cyan"), flush=True)
        elif self.config.resume:
            last_id = self.load_checkpoint()
            if last_id:
                start_min_id = last_id
                print(colorize(f"[*] Reprise activee : scan a partir du message #{last_id + 1}", "cyan"), flush=True)

        iter_kwargs = {"reverse": True}
        if start_min_id is not None:
            iter_kwargs["min_id"] = start_min_id

        queue: asyncio.Queue = asyncio.Queue(maxsize=self.config.concurrency * 6)

        async def worker():
            while True:
                item = await queue.get()
                if item is None:
                    queue.task_done()
                    break
                msg, prog_str = item
                try:
                    await self.process_tome(entity, msg, prog_str, stats)
                except Exception as w_err:
                    print(failure(f"[!] Erreur worker sur message #{msg.id}: {w_err}"), flush=True)
                finally:
                    queue.task_done()

        worker_tasks = [
            asyncio.create_task(worker())
            for _ in range(self.config.concurrency)
        ]

        async for message in self.client.iter_messages(entity, **iter_kwargs):
            if not message.file:
                continue

            stats["total"] += 1
            if self.config.limit and stats["total"] > self.config.limit:
                break

            msg_id = message.id
            self._all_seen_ids.append(msg_id)
            raw_filename = message.file.name or f"file_{msg_id}"
            file_size = message.file.size or 0
            tg_ext = Path(raw_filename).suffix.lower()

            progress = f"[#{msg_id}]"

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

                deleted = False
                status_str = "SKIPPED_EXISTING"
                if not self.config.dry_run and self.config.delete_identical_duplicates:
                    if diff == 0 and drive_path.exists() and drive_sz > 0:
                        try:
                            await self.client.delete_messages(entity, msg_id)
                            deleted = True
                            stats["purged"] = stats.get("purged", 0) + 1
                            status_str = "PURGED_EXISTING_IDENTICAL"
                            log_print(warn(f"  [PURGE-DOUBLON] #{msg_id} {canonical_name} ({format_size(drive_sz)}) identique au Drive -> Message Telegram supprime"))
                        except Exception as err:
                            log_print(failure(f"  [!] #{msg_id} Echec suppression Telegram: {err}"))

                if not deleted:
                    log_print(dim(f"  [DOUBLON] #{msg_id} {canonical_name} (TG: {format_size(file_size)}) deja sur le Drive ({format_size(drive_sz)}) [{notes}]"))

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
                await self.record_checkpoint(msg_id)
                continue

            if self.config.purge_identical_only:
                await self.record_checkpoint(msg_id)
                continue

            if self.config.dry_run:
                target_folder = self.catalog.resolve_destination(canonical_name)
                final_cbr_path = target_folder / canonical_name
                log_print(colorize(f"[SIMULATION] #{msg_id} {raw_filename} ({format_size(file_size)}) -> {final_cbr_path.relative_to(self.config.target_root)}", "cyan"))
                stats["processed"] += 1
                await self.record_checkpoint(msg_id)
                continue

            await queue.put((message, progress))

        for _ in range(self.config.concurrency):
            await queue.put(None)
        await asyncio.gather(*worker_tasks)

        write_run_log(self.config, stats)

        print("\n" + colorize("=" * 75, "grey"), flush=True)
        print(colorize(" BILAN DU PIPELINE", "bold"), flush=True)
        print(f"   Total messages scannes     : {colorize(str(stats['total']), 'bold')}")
        print(f"   Deja presents sur le Drive : {dim(str(stats['skipped']))}")
        if stats.get("purged"):
            print(f"   Doublons purges sur TG     : {warn(str(stats['purged']))}")
        validated_label = "simules" if self.config.dry_run else "enregistres"
        print(f"   Nouveaux tomes valides     : {success(str(stats['processed']))} ({validated_label})")
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
    parser.add_argument("--no-purge", action="store_true", help="In LIVE mode, download new tomes but never delete anything from Telegram. Safe first run.")
    parser.add_argument("--target-dir", type=str, help="Root folder of the target comic library.")
    parser.add_argument("--staging-dir", type=str, help="Temporary staging folder on non-C drive.")
    parser.add_argument("--limit", type=int, help="Limit number of messages to process.")
    parser.add_argument("--resume", action="store_true", help="Reprendre le scan après le dernier message traité (checkpoint).")
    parser.add_argument("--from-id", type=int, help="Démarrer le scan à partir d'un ID de message Telegram précis.")
    parser.add_argument("--concurrency", type=int, default=3, help="Nombre de téléchargements simultanés (recommandé: 3).")
    parser.add_argument("--skip-deanonymize", action="store_true", help="Désactive l'inspection et la désanonymisation interne des archives.")
    parser.add_argument("--deanonymize-until", type=int, default=2867, help="ID Telegram maximum jusqu'auquel effectuer la désanonymisation (défaut: 2867, car tous les fichiers suivants sont déjà nommés officiellement).")

    args = parser.parse_args()

    if args.no_purge and args.purge_identical_only:
        parser.error("--no-purge et --purge-identical-only sont incompatibles.")

    overrides = {}
    if args.channel: overrides["channel_url"] = args.channel
    if args.target_dir: overrides["target_root"] = args.target_dir
    if args.staging_dir: overrides["staging_dir"] = args.staging_dir
    if args.limit: overrides["limit"] = args.limit
    if args.resume: overrides["resume"] = True
    if args.from_id: overrides["from_id"] = args.from_id
    if args.concurrency: overrides["concurrency"] = args.concurrency
    if args.skip_deanonymize: overrides["skip_deanonymize"] = True
    if args.deanonymize_until: overrides["deanonymize_until"] = args.deanonymize_until

    if args.purge_identical_only:
        overrides["dry_run"] = False
        overrides["purge_identical_only"] = True
        overrides["delete_identical_duplicates"] = True
    else:
        overrides["dry_run"] = not args.run
        if args.run:
            # La purge est activée par défaut, mais --no-purge permet de
            # télécharger sans rien supprimer de Telegram.
            overrides["delete_identical_duplicates"] = not args.no_purge

    config = PipelineConfig.from_env(**overrides)
    set_progress_step(config.progress_step_pct)
    pipeline = TelegramArchivePipeline(config)
    asyncio.run(pipeline.run())

if __name__ == "__main__":
    main()
