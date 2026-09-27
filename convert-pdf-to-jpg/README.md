# PDF to JPG

`pdf-to-jpg.mjs` extracts the JPEG images embedded in a PDF without rendering it at an
arbitrary resolution. Every page that is a single JPEG is copied out byte-for-byte and
losslessly optimised.

## Usage on Windows

Drag and drop a single PDF onto `convert-pdf-to-jpgs.bat`.

Node.js must be installed and available in `PATH`. JPGs are written to a folder named
`<pdf-name>_jpg` next to the PDF. The output folder must not already exist.

From the command line:

```powershell
node .\pdf-to-jpg.mjs "C:\path\my-issue.pdf"
node .\pdf-to-jpg.mjs "C:\path\my-issue.pdf" --output-dir "C:\path\images"
node .\pdf-to-jpg.mjs "C:\path\my-issue.pdf" --output-name "{name}_{page:03d}"
node .\pdf-to-jpg.mjs "C:\path\my-issue.pdf" --archive cbz
node .\pdf-to-jpg.mjs "C:\path\my-issue.pdf" --archive cbr --keep-jpgs
node .\pdf-to-jpg.mjs "C:\path\my-issue.pdf" --workers 4
```

## Options

| Option | Description |
|--------|-------------|
| `--output-dir <dir>` | Output folder for JPGs (created automatically) |
| `--output-name <template>` | Filename template (see below) |
| `--archive cbr\|cbz` | Pack extracted JPGs into a CBR or CBZ archive |
| `--keep-jpgs` | Keep the JPG folder after archiving (default: deleted) |
| `--workers <n>` | Number of parallel workers (1–32, default: auto) |

### Filename template (`--output-name`)

The template controls the name of each output JPG (`.jpg` is appended automatically):

| Placeholder | Description | Example |
|-------------|-------------|---------|
| `{name}` | PDF filename without extension | `JM2045` |
| `{page}` | 1-based page number | `7` |
| `{page:03d}` | Page number zero-padded to N digits | `007` |
| `{total}` | Total number of pages | `52` |
| `{date}` | ISO date `YYYY-MM-DD` | `2026-09-27` |
| `{year}` | 4-digit year | `2026` |
| `{month}` | 2-digit month (01–12) | `09` |
| `{day}` | 2-digit day (01–31) | `27` |

Default: `{name}_{page:04d}` → `my-issue_0001.jpg`, `my-issue_0002.jpg`, …

### Archive output (`--archive`)

| Format | Extension | Requirement | Compression |
|--------|-----------|-------------|-------------|
| `cbz` | `.cbz` | PowerShell (built into Windows) | ZIP store (`-m0`) |
| `cbr` | `.cbr` | [WinRAR](https://www.rarlab.com/) installed | RAR store (`-m0`) |

The archive is placed **next to the PDF** (or in the parent of `--output-dir`).
The JPG folder is **deleted after archiving** unless `--keep-jpgs` is set.

> **Why store mode (-m0)?**
> JPEG data is already compressed. Re-compressing it saves nothing but wastes time.
> The resulting CBZ/CBR is as compact as possible without touching the JPEG bytes.

## How it works / Limitations

- Only pages that consist of a single embedded JPEG are extracted, in page order,
  without decoding or re-encoding.
- If the PDF defines a visible crop box smaller than the embedded image, the image
  is losslessly cropped to the JPEG block grid, matching InducksScanUploader behaviour.
- Extracted images are optimised without altering JPEG coefficients; private metadata
  is stripped when optimisation allows it.
- Encrypted PDFs, vector pages, JPEG 2000 images, and pages containing multiple images
  are not supported. If any page cannot be extracted the tool exits with an error and
  keeps no partial output.
- An existing output folder is never overwritten.

## Architecture

```
convert-pdf-to-jpg/
  package/                    ← npm package @starl/pdf-to-jpg-core
    src/
      index.mjs               ← Public API: createIsu, loadCore, formatOutputName
      pdf-core.js             ← Shared reference source (IIFE, browser-compatible)
      jpeg-core.js            ← Shared reference source (IIFE, browser-compatible)
    package.json
    README.md
  pdf-to-jpg.mjs              ← Node.js CLI
  jpeg-worker.mjs             ← Parallel JPEG optimisation worker
  convert-pdf-to-jpgs.bat     ← Windows drag-and-drop launcher
  sync-to-inducks.ps1         ← Copies core libs to InducksScanUploader and runs its tests
  .npmrc                      ← GitHub Packages registry config
```

## Shared package `@starl/pdf-to-jpg-core`

`pdf-core.js` and `jpeg-core.js` inside `package/src/` are the canonical sources shared
between this CLI tool and the InducksScanUploader browser extension.

### Syncing to InducksScanUploader

After modifying `package/src/pdf-core.js` or `package/src/jpeg-core.js`, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\sync-to-inducks.ps1
```

The script copies the sources to `pdf.js` and `jpegcrop.js` in InducksScanUploader,
checks their syntax, and runs the PDF regression tests.

### Publishing to GitHub Packages

1. Create a GitHub token with `write:packages` and add it to `~/.npmrc`:
   ```
   //npm.pkg.github.com/:_authToken=ghp_...
   ```
2. Initialise a GitHub repository, then:
   ```powershell
   cd package
   npm publish
   ```
