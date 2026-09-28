# 📦 Archiving Helper

> Fast, lightweight, and mathematical-lossless automation suite for comic book downloading, conversion, and Inducks library archiving.

---

## 🚀 Features Overview

| Tool | Module | Description | Engine / Tech |
|---|---|---|---|
| **Telegram Archiver** | [`download-files/`](download-files/) | 1-by-1 sequential downloader from Telegram, multi-part archive merger, Inducks country/series auto-sorting, and zero-loss Telegram deletion. | Python 3, Telethon |
| **Duplicate & Audit Scanner** | [`download-files/`](download-files/) | Instant O(1) comparison between Telegram channel media and local Drive archives across `.cbr`, `.cbz`, `.pdf`, `.zip`, `.rar`. Generates detailed CSV audits. | Python 3 |
| **High-Speed Downloader** | [`download-files/`](download-files/) | Multi-connection downloader supporting Click-n-Load (Filecrypt), DLC containers, Mediafire direct resolution, 1fichier, Debriders (Real-Debrid, AllDebrid, Debrid-Link), and Watch Folder. | Node.js, aria2c |
| **Web Comic Downloader** | [`download-files/`](download-files/) | High-speed reader scraper (e.g. ComicMafia) with automatic rate-limit backoff, lossless JPEG header cleaner, and `.cbr` packaging. | Node.js, AdmZip |
| **Blogspot Scraper** | [`download-files/`](download-files/) | Scrapes Blogspot comic blogs, extracts full issues (Mediafire, Archive.org, 4Shared) or full-res `/s0/` scan images into `.cbr`. | Node.js |
| **Repair & De-anonymizer** | [`download-files/`](download-files/) | Restores corrupted/split archives (`.part1.rar`, `.001`), naturally sorts pages `(1, 2, ... 10)`, and extracts Inducks naming directly from internal scans. | Node.js |
| **PDF to JPG / CBZ** | [`convert-pdf-to-jpg/`](convert-pdf-to-jpg/) | Pure lossless direct stream extraction of embedded JPEG scans from PDF albums without re-encoding. | Node.js, pdf-lib |
| **CBR to CBZ Converter** | [`convert-cbr-to-cbz/`](convert-cbr-to-cbz/) | Fast repackaging of RAR archives into standard ZIP-based `.cbz` archives. | PowerShell, Shell |
| **WebP to JPG** | [`convert-webp-to-jpg/`](convert-webp-to-jpg/) | High-speed batch converter for WebP images into standard JPEGs. | ImageMagick |
| **Images to PDF** | [`images-to-pdf/`](images-to-pdf/) | Assembles ordered scan images into clean PDFs with natural page sorting. | ImageMagick |
| **Batch Extractor** | [`extract-archives/`](extract-archives/) | Batch extraction of `.cbr`, `.cbz`, `.zip`, `.rar`, `.7z` with recursive subfolder flattening. | WinRAR / 7-Zip |

---

## ⚡ Quick Start

### 1. Prerequisites
- **Node.js** (v18+)
- **Python** (3.10+) with `telethon` (`pip install telethon`)
- *(Optional)* **ImageMagick** and **WinRAR** (only needed for legacy WebP/RAR batch converters)

### 2. Launch the Suite
- **Windows** : Double-click on [`archiving-helper.bat`](archiving-helper.bat)
- **Linux / macOS** : Run `./archiving-helper.sh`

---

## 🛠️ Configuration (`.env`)

In [`download-files/`](download-files/), copy `.env.example` to `.env`:

```env
# Telegram API (get from https://my.telegram.org)
TELEGRAM_API_ID=your_api_id
TELEGRAM_API_HASH=your_api_hash
TELEGRAM_CHANNEL_URL=https://t.me/...

# Library Storage Paths
TARGET_ARCHIVE_PATH=D:\Duckburg Archives\Disney comics
STAGING_PATH=D:\Duckburg Archives\_staging_temp

# Debrider & Hosters (Optional)
REALDEBRID_API_KEY=
ALLDEBRID_API_KEY=
DEBRIDLINK_API_KEY=
ONEFICHIER_API_KEY=
```

---

## 🏛️ Library Organization (Inducks Hierarchy)

The archiver strictly respects official Inducks codes and English country designations:

```
D:\Duckburg Archives\Disney comics/
├── France/
│   ├── La dynastie Donald Duck - Intégrale Carl Barks/
│   │   ├── fr_DDD_1.cbr
│   │   └── fr_DDD_2.cbr
│   └── Les chroniques de Fantomiald/
│       └── fr_CF_1.cbr
├── Germany/
│   └── Lustiges Taschenbuch/
│       └── de_LTB_1.cbr
└── Brazil/
    └── Almanaque Disney/
        └── br_AD_1.cbr
```

---

## 🛡️ Security & Zero-Loss Guarantee

- **Drive Isolation**: All temporary staging buffers are held on `D:\` (leaving your system `C:\` drive completely free).
- **Post-Verification Purge**: A Telegram message is **NEVER** deleted until the resulting archive has been verified on disk with non-zero byte size and valid integrity.
- **Audit Trails**: Every skipped duplicate is logged to `audit_skipped_files.csv` with exact file sizes, formats, and delta metrics.
