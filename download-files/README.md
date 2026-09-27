# High-Speed Batch Downloader & Archiving Pipeline

Lightweight, ultra-fast download manager and post-processing pipeline designed to replace heavy Java downloaders like JDownloader 2 for comic archives, PDFs, and direct hosters.

## Features

- ⚡ **Aria2c Multi-Connection Acceleration**: Downloads with up to 16 parallel connections per file (`-x16 -s16 -k1M`), maximizing bandwidth.
- 📦 **Filecrypt & Container Support**:
  - **Click'n'Load (CNL2) Server**: Runs a lightweight local Click'n'Load receiver on port `9666`. Click "Click'n'Load" on Filecrypt in your browser and downloads start instantly!
  - **DLC Container Decryption**: Drag & drop any `.dlc` container file to decrypt and download all files.
- 🔗 **Direct Host Support**:
  - **1fichier**: Automatic link resolver (handles free download flow + API key support).
  - **Direct HTTP/HTTPS**: Fast multi-threaded stream with progress tracking, speed, ETA, and resume support.
- 🔄 **Integrated Post-Processing Pipeline**:
  - **Auto-Extract**: Automatically unpacks CBR, CBZ, ZIP, RAR, 7z archives with smart single-folder flattening.
  - **Auto-Convert**: Optionally converts extracted PDF files into lossless CBZ/JPG via `convert-pdf-to-jpg`.
  - **Clean Archives**: Automatically deletes source archive files after extraction to save disk space.
- 👁️ **Watch Folder Mode**: Monitors a directory and automatically downloads & processes any new `.txt` or `.dlc` file.

---

## Quick Start on Windows

### 1. Click'n'Load from Browser (Filecrypt)
1. Double-click `download-files.bat`.
2. Visit Filecrypt in your browser (e.g. Chrome / Firefox).
3. Click the **Click'n'Load** button.
4. The files will be captured, decrypted, and downloaded at maximum speed!

### 2. Drag & Drop
- Drag & drop a `.txt` file (containing URLs, one per line) or a `.dlc` file onto `download-files.bat`.

---

## Command Line Usage

```powershell
# Download from a list of URLs or a DLC container
node .\download.mjs "C:\path\links.txt"
node .\download.mjs "C:\path\container.dlc"

# Custom output directory
node .\download.mjs "C:\path\links.txt" --output-dir "C:\Downloads\Comics"

# Start Click'n'Load background listener
node .\download.mjs --server

# Watch folder mode (auto-download any new .dlc or .txt file)
node .\download.mjs --watch "C:\Users\starl\Downloads"

# Full comic pipeline: Download -> Extract -> Convert PDFs -> Delete raw archives
node .\download.mjs "links.txt" --auto-extract --auto-convert --clean-archives
```

## Options

| Option | Description |
|--------|-------------|
| `--output-dir <dir>` | Destination directory for downloaded files |
| `--connections <n>` | Parallel connections per file with aria2c (default: 16) |
| `--concurrent <n>` | Number of concurrent downloads (default: 4) |
| `--no-aria2` | Force native Node.js streaming instead of aria2c |
| `--auto-extract` | Automatically extract CBR, CBZ, ZIP, RAR and flatten folders |
| `--clean-archives` | Delete source archive files after successful extraction |
| `--auto-convert` | Automatically convert PDF files to lossless CBZ |
| `--api-key <key>` | 1fichier API key (bypasses free waiting limits) |
| `--server, --cnl` | Start Click'n'Load local receiver |
| `--watch [folder]` | Watch directory for new `.txt` or `.dlc` files |

---

## Requirements

- **Node.js** >= 18
- **aria2c** (automatically downloaded on first run into `bin/` if not present in `PATH`)
- **WinRAR** (optional, used for `.rar`/`.cbr` extraction if available)
