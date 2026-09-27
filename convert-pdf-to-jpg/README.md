# PDF to JPG

`pdf-to-jpg.mjs` extracts JPEG images embedded in PDF files without re-rendering or resampling them. Every page composed of a single JPEG is extracted byte-for-byte and losslessly optimised.

## Windows Quick Start

Drag and drop a PDF file onto `convert-pdf-to-jpgs.bat`.

Node.js (>= 18) must be installed and accessible in `PATH`. The resulting JPG files are written to a `<pdf-name>_jpg` folder next to the PDF.

## Command Line Usage

```powershell
# Basic extraction to a folder
node .\pdf-to-jpg.mjs "C:\path\comic.pdf"

# Custom output directory
node .\pdf-to-jpg.mjs "C:\path\comic.pdf" --output-dir "C:\path\output"

# Custom file naming template
node .\pdf-to-jpg.mjs "C:\path\comic.pdf" --output-name "{name}_{page:03d}"

# Directly create a CBZ (ZIP) or CBR (RAR) archive
node .\pdf-to-jpg.mjs "C:\path\comic.pdf" --archive cbz
node .\pdf-to-jpg.mjs "C:\path\comic.pdf" --archive cbr --keep-jpgs

# Set number of parallel worker threads
node .\pdf-to-jpg.mjs "C:\path\comic.pdf" --workers 4
```

## Options

| Option | Description |
|--------|-------------|
| `--output-dir <dir>` | Output folder for JPG files (created automatically) |
| `--output-name <template>` | Filename template (without extension) |
| `--archive <cbr\|cbz>` | Pack extracted JPGs into a CBR (RAR) or CBZ (ZIP) archive |
| `--keep-jpgs` | Keep the JPG folder after archiving (default: deleted) |
| `--workers <n>` | Parallel workers count (1–32, default: auto) |

### Filename Template (`--output-name`)

| Placeholder | Description | Example |
|-------------|-------------|---------|
| `{name}` | PDF file name without extension | `JM2045` |
| `{page}` | 1-based page number | `7` |
| `{page:03d}` | Page number zero-padded to N digits | `007` |
| `{total}` | Total number of pages | `52` |
| `{date}` | ISO date `YYYY-MM-DD` | `2026-09-27` |
| `{year}` | 4-digit year | `2026` |
| `{month}` | 2-digit month (01–12) | `09` |
| `{day}` | 2-digit day (01–31) | `27` |

Default: `{name}_{page:04d}` (e.g. `comic_0001.jpg`, `comic_0002.jpg`).

### Archive Output (`--archive`)

- **`cbz`**: Built with PowerShell `Compress-Archive` (no third-party software needed on Windows).
- **`cbr`**: Built with WinRAR (`Rar.exe` in `PATH` or standard installation directory).
- Uses store mode (`-m0`): JPEG data is already compressed, so re-compressing is avoided for maximum speed.

## Architecture

```
convert-pdf-to-jpg/
  package/                    ← Shared npm library (@wizyxgh/pdf-to-jpg-core)
    src/
      index.mjs               ← Public API (createIsu, loadCore, formatOutputName)
      pdf-core.js             ← Pure lossless PDF extraction core
      jpeg-core.js            ← Lossless JPEG cropping and optimization core
    package.json
    README.md
  pdf-to-jpg.mjs              ← CLI tool
  jpeg-worker.mjs             ← Parallel JPEG optimisation worker
  convert-pdf-to-jpgs.bat     ← Windows launcher
  publish.ps1                 ← Helper script to publish the npm package
```

## Shared NPM Module

The extraction and lossless JPEG cropping engine is located in `package/` and can be used as an independent library in Node.js, browsers, or web extensions:

```sh
npm install @wizyxgh/pdf-to-jpg-core
```
