# Archiving Helper

A comprehensive toolkit to automate comic book, manga, and document archiving workflows.

## Available Tools

| Tool Directory | Description | Dependencies | Windows | Linux / macOS |
|----------------|-------------|--------------|---------|---------------|
| [`convert-pdf-to-jpg/`](convert-pdf-to-jpg/) | Extract JPEG pages from PDF losslessly, with optional CBZ/CBR archiving | Node.js (>= 18) | `.bat` / CLI | `.sh` / CLI |
| [`convert-cbr-to-cbz/`](convert-cbr-to-cbz/) | Repack proprietary CBR (RAR) archives into standard CBZ (ZIP) format | 7-Zip or WinRAR | `.bat` / `.ps1` | `.sh` |
| [`convert-webp-to-jpg/`](convert-webp-to-jpg/) | Convert WebP image batches to high-quality JPGs | ImageMagick | `.bat` | `.sh` |
| [`images-to-pdf/`](images-to-pdf/) | Assemble images into PDF with natural page sorting (`1, 2, 10...`) | ImageMagick | `.bat` | `.sh` |
| [`extract-archives/`](extract-archives/) | Batch extract CBR/CBZ/ZIP/RAR/7Z archives with auto-flattening | 7-Zip, WinRAR, or `tar` | `.bat` | `.sh` |

---

## Unified Launcher

You can launch an interactive menu that provides access to all tools from a single place:

- **Windows**: Double-click [`archiving-helper.bat`](archiving-helper.bat)
- **Linux / macOS**: Run [`./archiving-helper.sh`](archiving-helper.sh)

---

## Quick Highlights

### ⚡ Lossless PDF Extraction
`convert-pdf-to-jpg` extracts the exact JPEG byte streams embedded in PDFs without decoding or re-encoding. Supports batch extraction across multiple PDFs or folders, parallel JPEG worker optimization, and direct CBZ creation.

### 📚 Natural Page Sorting for Images
`images-to-pdf` uses natural alphanumeric sorting to ensure pages with non-padded numbers (`page_1.jpg`, `page_10.jpg`, `page_2.jpg`) are assembled in true reading sequence (`1 -> 2 -> 10`).

### 📦 CBR to CBZ Conversion
Converts legacy or proprietary `.cbr` comic archives into open standard `.cbz` archives in store mode (fast and lossless).

### 🧪 Automated CI/CD
Includes a zero-dependency unit test suite executed across Node.js 18, 20, and 22 on Linux, macOS, and Windows via GitHub Actions.

---

*I often archive comic books. As it takes me a lot of time, I've created little scripts to automate this process and I've decided to share them with the world so that everyone can benefit from them.*
