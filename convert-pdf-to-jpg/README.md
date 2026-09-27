# PDF to JPG

`pdf-to-jpg.mjs` extracts JPEG images embedded in PDF files without re-rendering or resampling them. Every page composed of a single JPEG is extracted byte-for-byte and losslessly optimised.

## Features

- **Lossless Extraction**: No rasterization, no DPI guessing, no quality degradation.
- **Batch Processing**: Process single files, multiple files, or entire directories at once.
- **Visual Progress Bar**: Real-time console progress tracking with percentage and byte savings.
- **Direct Comic Archiving**: Create `.cbz` (ZIP) or `.cbr` (RAR) archives automatically.
- **Multi-threaded JPEG Optimization**: Parallel background workers for instantaneous processing.
- **Cross-platform**: Available on Windows (`.bat`), Linux/macOS (`.sh`), and via Node.js CLI.

## Quick Start

### Windows
Drag and drop one or multiple PDF files (or a folder of PDFs) onto `convert-pdf-to-jpgs.bat`.

### Linux / macOS
```bash
chmod +x convert-pdf-to-jpg.sh
./convert-pdf-to-jpg.sh "/path/to/comic.pdf"
```

## Command Line Usage

```powershell
# Basic extraction of a single PDF
node .\pdf-to-jpg.mjs "C:\path\comic.pdf"

# Batch extract all PDFs in a folder
node .\pdf-to-jpg.mjs "C:\path\comics_folder"

# Batch extract multiple specified PDFs
node .\pdf-to-jpg.mjs "comic1.pdf" "comic2.pdf" "comic3.pdf"

# Custom output directory
node .\pdf-to-jpg.mjs "comic.pdf" --output-dir "C:\path\output"

# Custom file naming template
node .\pdf-to-jpg.mjs "comic.pdf" --output-name "{name}_{page:03d}"

# Directly create a CBZ (ZIP) or CBR (RAR) archive
node .\pdf-to-jpg.mjs "comic.pdf" --archive cbz
node .\pdf-to-jpg.mjs "comic.pdf" --archive cbr --keep-jpgs

# Set number of parallel worker threads
node .\pdf-to-jpg.mjs "comic.pdf" --workers 4
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

## Shared NPM Module

The extraction and lossless JPEG cropping engine is located in `package/` and can be used as an independent library in Node.js, browsers, or web extensions:

```sh
npm install @wizyxgh/pdf-to-jpg-core
```
