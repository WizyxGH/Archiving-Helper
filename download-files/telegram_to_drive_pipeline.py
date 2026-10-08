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
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

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
    from telethon.tl.types import DocumentAttributeFilename, Message
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
    progress_step_pct: int = 5

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

        # Palier de progression : .env > variable d'environnement > défaut 5.
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
                progress_step_pct = 5
        except (TypeError, ValueError):
            progress_step_pct = 5

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
            progress_step_pct=progress_step_pct
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


# Téléchargement : dernier palier affiché, pour ne pas rafraîchir la ligne
# à chaque bloc reçu (Telegram en émet plusieurs par seconde).
_last_progress = {"key": None, "value": -1}


def set_progress_step(pct: int) -> None:
    """Fixe le palier de rafraîchissement de la barre (0 = désactivée)."""
    _last_progress["step"] = max(int(pct), 0)
    _last_progress["key"] = None


def report_progress(progress: str, current: int, total: int) -> None:
    """Affiche l'avancement du téléchargement, une fois par palier de %.

    Sans cela, un tome de 30 Mo peut laisser l'écran muet plusieurs minutes
    et donner l'impression que le script est bloqué. Le palier vient de la
    configuration (PROGRESS_STEP_PCT, défaut 5 %) : au-delà, la ligne est
    réécrite trop souvent et le défilement devient illisible.
    """
    step_pct = _last_progress.get("step", 5)
    if step_pct == 0:
        return

    if not total:
        return

    percent = int(current * 100 / total)
    # On force l'affichage a 0 % et a chaque palier atteint. Le max(..., 1)
    # d'origine divisait par 1 en dessous du premier palier, donc la ligne
    # etait reecrite a chaque pourcent sur le premier quart du telechargement.
    step = percent // step_pct

    key = (progress, step)
    if key == _last_progress["key"]:
        return
    _last_progress["key"] = key

    filled = int(percent / 4)
    bar = "█" * filled + "░" * (25 - filled)
    bar_color = "green" if percent >= 90 else "yellow" if percent >= 40 else "cyan"

    sys.stdout.write(
        f"\r      {dim(progress)} {colorize(bar, bar_color)} "
        f"{colorize(f'{percent:3d} %', 'bold')} "
        f"{dim(f'({format_size(current)} / {format_size(total)})')}"
    )
    sys.stdout.flush()


def reset_progress_line() -> None:
    """Referme la ligne d'avancement avant d'afficher la suite."""
    if _last_progress["key"] is not None:
        sys.stdout.write("\n")
        sys.stdout.flush()
        _last_progress["key"] = None


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
        self.client: Optional[TelegramClient] = None

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

    async def purge_message(self, entity, msg_id: int, stats: dict, duplicate: bool = True) -> bool:
        """Supprime le message Telegram si, et seulement si, la purge est active.

        Tous les chemins de suppression passent ici : en --no-purge (ou en
        audit), aucun message n'est jamais supprime, meme pour un doublon prouve.
        """
        if self.config.dry_run or not self.config.delete_identical_duplicates:
            print(dim(f"          [4/4] Message Telegram #{msg_id} conserve (purge desactivee)"), flush=True)
            return False
        print(warn(f"          [4/4] Suppression du message Telegram #{msg_id}..."), end="", flush=True)
        await self.client.delete_messages(entity, msg_id)
        print(" OK", flush=True)
        if duplicate:   # le bilan ne compte en « doublons purges » que les doublons
            stats["purged"] = stats.get("purged", 0) + 1
        return True

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
        print(f" Source Channel  : {colorize(title, 'bold')}", flush=True)
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

            # Position dans le lot : sans ça, un long silence donne
            # l'impression que le script est bloqué alors qu'il avance.
            progress = f"[{stats['total']}"
            if self.config.limit:
                progress += f"/{self.config.limit}"

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
                    print(dim(f"  [DOUBLON] #{msg_id} {canonical_name} (TG: {format_size(file_size)}) deja sur le Drive ({format_size(drive_sz)}) [{notes}]"), flush=True)

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
            print(f"\n{colorize('[NOUVEAU]', 'green+bold')} #{msg_id} {raw_filename} ({format_size(file_size)})", flush=True)
            print(f"          -> Destination: {final_cbr_path.relative_to(self.config.target_root)}", flush=True)

            if self.config.dry_run:
                stats["processed"] += 1
                continue

            # LIVE EXECUTION: 1-by-1 Download, Rebuild & Verify
            try:
                self.config.staging_dir.mkdir(parents=True, exist_ok=True)
                issue_temp_dir = self.config.staging_dir / f"temp_{msg_id}"
                issue_temp_dir.mkdir(parents=True, exist_ok=True)
            except OSError as staging_err:
                fallback_staging = Path(tempfile.gettempdir()) / "archiving-helper" / "_staging_temp"
                try:
                    fallback_staging.mkdir(parents=True, exist_ok=True)
                    self.config.staging_dir = fallback_staging
                    issue_temp_dir = self.config.staging_dir / f"temp_{msg_id}"
                    issue_temp_dir.mkdir(parents=True, exist_ok=True)
                    print(colorize(f"          [*] Staging redirigé vers : {fallback_staging}", "yellow"), flush=True)
                except Exception as fatal_err:
                    stats["errors"] += 1
                    print(failure(f"    [ERREUR STOCKAGE] Impossible de créer le dossier temporaire : {fatal_err}"), flush=True)
                    continue

            try:
                local_staging_file = issue_temp_dir / raw_filename
                print(colorize(f"      {progress} Telechargement ({format_size(file_size)})...", "blue"), flush=True)
                # Arret anticipe : des les 512 Ko, l'en-tete du fichier donne le
                # nom Inducks du tome. Si un tome de MEME TAILLE est deja
                # archive, c'est le meme fichier : on coupe le telechargement au
                # lieu de recevoir 30 a 780 Mo pour rien.
                #
                # Telethon ignore la valeur de retour du progress_callback
                # (verifie dans client/downloads.py) : seul un lever d'exception
                # arrete la boucle "async for chunk in _iter_download". On utilise
                # donc une exception dediee, attrapee juste apres l'appel.
                early_exit: Dict[str, object] = {"stem": None, "path": None, "probed": False}

                def _on_progress(current: int, total: int) -> None:
                    report_progress(progress, current, total)
                    if early_exit["probed"]:
                        return
                    if current < HEADER_PROBE_BYTES or total <= 0:
                        return
                    if total != file_size:
                        # taille Telegram et taille reelle differentes : on ne se
                        # fie pas a l'index, on attend la fin du telechargement.
                        early_exit["probed"] = True
                        return
                    stem = identify_inducks_stem_from_header(local_staging_file)
                    if not stem:
                        return
                    # Le nom est lu : la decision est prise une fois pour toutes,
                    # sans relire l'en-tete a chaque bloc recu.
                    early_exit["probed"] = True
                    known = self.catalog.files_by_size.get(file_size)
                    if not known or known.get("ambiguous"):
                        return
                    # L'en-tete donne le nom du scan (« GHL_M_2 »), la
                    # bibliotheque le nom officiel (« fr_GHL_M_2 ») : on compare
                    # les deux formes avant de conclure.
                    known_stem = known["stem"].lower()
                    if known_stem != stem.lower() and known_stem != official_stem(stem).lower():
                        return
                    early_exit["stem"] = stem
                    early_exit["path"] = known["path"]
                    raise _EarlyDuplicateExit(stem, known["path"])

                try:
                    await message.download_media(
                        file=str(local_staging_file),
                        progress_callback=_on_progress,
                    )
                except _EarlyDuplicateExit:
                    # sortie rapide normale : traitee juste apres
                    pass

                if early_exit["stem"] is not None:
                    existing = early_exit["path"]
                    assert isinstance(existing, Path)
                    reset_progress_line()
                    gained = file_size - HEADER_PROBE_BYTES
                    print(
                        success(
                            f"      {progress} Interrompu a {format_size(HEADER_PROBE_BYTES)} "
                            f"(tome deja archive, {format_size(gained)} economises)"
                        ),
                        flush=True,
                    )
                    print(
                        warn(
                            f"          [i] Deja present : {existing.name} "
                            f"({format_size(file_size)}, taille identique)"
                        ),
                        flush=True,
                    )
                    await self.purge_message(entity, msg_id, stats)
                    stats["skipped"] += 1
                    # Le fichier partiel n'a aucune valeur : on le jette.
                    shutil.rmtree(issue_temp_dir, ignore_errors=True)
                    continue

                local_sz = local_staging_file.stat().st_size
                reset_progress_line()
                print(success(f"      {progress} Telecharge ({format_size(local_sz)})"), flush=True)

                # Internal inspection for Inducks canonical name (if name is MD5 or unknown)
                detected_stem = None
                if not re.match(r"^[a-zA-Z]{2,3}_[a-zA-Z0-9]+_\d+", raw_filename):
                    detected_stem = inspect_archive_for_inducks_name(local_staging_file)

                # Nom officiel Inducks : « GHL_M_2 » (scan sans pays, numero
                # compose) devient « fr_GHL_M_2 ». Les noms deja officiels
                # restent inchanges ; un nom non resolu est garde tel quel et
                # resolve_destination l'envoie dans Unknown.
                received_stem = clean_stem(canonical_name)
                final_stem = official_stem(detected_stem or received_stem)
                renamed = final_stem != received_stem
                if renamed:
                    canonical_name = f"{final_stem}{Path(canonical_name).suffix}"
                    target_folder = self.catalog.resolve_destination(canonical_name)
                    final_cbr_path = target_folder / canonical_name
                    label = "De-anonymise" if detected_stem else "Nom Inducks"
                    print(colorize(f"          [*] {label} -> {canonical_name}", "magenta"), flush=True)

                # L'extension suit le contenu, pas le nom recu de Telegram.
                real_ext = archive_extension_from_content(local_staging_file)
                if real_ext and Path(canonical_name).suffix.lower() != real_ext:
                    canonical_name = f"{Path(canonical_name).stem}{real_ext}"
                    final_cbr_path = target_folder / canonical_name
                    print(colorize(f"          [*] Format reel -> {canonical_name}", "magenta"), flush=True)

                # Check if this newly detected canonical file already exists on Drive and is identical!
                if renamed:
                    post_dup = self.catalog.find_duplicate(canonical_name)
                    if post_dup and post_dup["size"] == local_sz and post_dup["path"].exists():
                        print(warn(f"          [!] Deja present sur le Drive ({format_size(post_dup['size'])}) sous son vrai nom Inducks!"), flush=True)
                        await self.purge_message(entity, msg_id, stats)
                        stats["skipped"] += 1
                        continue

                target_folder.mkdir(parents=True, exist_ok=True)

                # Un fichier different porte deja ce nom : on ne l'ecrase jamais.
                # (Sur Windows, shutil.move echoue puis copy2 remplacait le tome.)
                if final_cbr_path.exists():
                    raise RuntimeError(
                        f"Un autre fichier existe deja a destination ({format_size(final_cbr_path.stat().st_size)}) : "
                        f"{final_cbr_path} — rien n'est ecrase."
                    )

                # Deplacement plutot que copie : le staging et la destination sont sur
                # le meme volume (D:), donc c'est un renommage instantane. Mesure a
                # 0,04 s contre 0,82 s en copie sur un tome de 54 Mo. Si le move
                # echoue, le fichier reste dans le staging et la verification le signale.
                try:
                    shutil.move(str(local_staging_file), str(final_cbr_path))
                except OSError:
                    shutil.copy2(str(local_staging_file), str(final_cbr_path))

                # Verification d'integrite
                if not final_cbr_path.exists() or final_cbr_path.stat().st_size == 0:
                    raise RuntimeError("Echec integrite : le fichier depose est vide ou absent.")

                print(success(f"          [3/4] Valide a destination ({format_size(final_cbr_path.stat().st_size)})"), flush=True)

                node_executable = shutil.which("node")
                collection_script = Path(__file__).resolve().parents[1] / "src" / "pipelines" / "4_inducks_collection" / "collection.mjs"
                if not node_executable or not collection_script.exists():
                    raise RuntimeError("Mise à jour de collection indisponible : Node.js ou le module Inducks manque.")
                # meme encodage que pour le catalogue (voir _load_publication_titles)
                collection_result = subprocess.run(
                    [node_executable, str(collection_script), str(final_cbr_path)],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    check=False,
                )
                if collection_result.stdout:
                    print(collection_result.stdout, end="", flush=True)
                if collection_result.stderr:
                    print(collection_result.stderr, end="", flush=True)
                if collection_result.returncode != 0:
                    raise RuntimeError("La mise à jour de collection a échoué ; le message Telegram sera conservé.")

                # Suppression Telegram seulement apres verification, et si la purge est active
                await self.purge_message(entity, msg_id, stats, duplicate=False)

                # Update live catalog
                self.catalog.files_by_name[canonical_name.lower()] = {"path": final_cbr_path, "size": final_cbr_path.stat().st_size}
                self.catalog.files_by_stem[clean_stem(canonical_name).lower()] = {"path": final_cbr_path, "size": final_cbr_path.stat().st_size}
                stats["processed"] += 1

            except Exception as err:
                stats["errors"] += 1
                reset_progress_line()
                print(failure(f"    [ERREUR SECURITE] Tome #{msg_id} non archive : {err}"), flush=True)
                print(dim("                 -> Message Telegram PRESERVE (aucune suppression)."), flush=True)
            finally:
                shutil.rmtree(str(issue_temp_dir), ignore_errors=True)

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

    args = parser.parse_args()

    if args.no_purge and args.purge_identical_only:
        parser.error("--no-purge et --purge-identical-only sont incompatibles.")

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
            # La purge est activée par défaut, mais --no-purge permet de
            # télécharger sans rien supprimer de Telegram.
            overrides["delete_identical_duplicates"] = not args.no_purge

    config = PipelineConfig.from_env(**overrides)
    set_progress_step(config.progress_step_pct)
    pipeline = TelegramArchivePipeline(config)
    asyncio.run(pipeline.run())

if __name__ == "__main__":
    main()
