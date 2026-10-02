# Archiving Helper

Fast, lightweight automation suite for comic book downloading, conversion, and archiving.

## Tools Overview

| Directory | Description | Key Tech |
|-----------|-------------|----------|
| [\download-files/\](download-files/) | High-speed batch downloader with Click'n'Load (Filecrypt), DLC decryption, 1fichier resolver & aria2c acceleration | Node.js, aria2c |
| [\convert-pdf-to-jpg/\](convert-pdf-to-jpg/) | Lossless PDF-to-JPEG page extractor & CBZ/CBR converter | Node.js |
| [\convert-webp-to-jpg/\](convert-webp-to-jpg/) | Convert WebP images to JPG format | ImageMagick |
| [\images-to-pdf/\](images-to-pdf/) | Assemble images into a unified PDF document | ImageMagick |
| [\extract-archives/\](extract-archives/) | Batch extract CBR/CBZ/ZIP/RAR with nested folder flattening | WinRAR |

## Quick Start

Every tool supports Windows **drag-and-drop** (.bat launchers) or direct command line usage.
Refer to each subfolder's \README.md\ for dedicated options.

## Automatic Inducks Collection Updates

Successfully created or repaired CBR/CBZ archives are checked and registered automatically. Certified issues are copied into the configured Inducks library when its drive is available, added or updated in a local CSV, and prepared in a pending-upload folder. The Telegram pipeline performs this update before deleting the source message.

- Collection CSV: `download-files/files_downloads/inducks_collection.csv`
- Pending Inducks packages: `download-files/files_downloads/inducks_upload_pending/`
- Set `INDUCKS_COLLECTION_DIR` to change the local CSV and pending-package directory.
- Set `TARGET_ARCHIVE_PATH` to change the Inducks library root. It can also be set in `download-files/.env`; otherwise the existing default is `D:\Duckburg Archives\Disney comics`.
- Set `INDUCKS_DATA_DIR` to the directory containing `inducks_issue.isv` and `inducks_entry.isv` if the local Inducks dump is stored elsewhere.

Packages are prepared for review only. Choose **[8] Examiner les paquets Inducks en attente** in the main menu to open the folder; no files are uploaded to Inducks.org automatically. Unknown issues, unverified formats, unavailable storage drives, and conflicting destination files are kept visible for review rather than silently renamed or overwritten.

---

*Automate comic book archiving with maximum speed and zero quality loss.*
