# CBR → CBZ Conversion

Converts proprietary RAR-based `.cbr` comic archives into open ZIP-based `.cbz` format without re-compressing JPEG images (lossless and fast).

## Features

- **Store Mode / Zero Quality Loss**: Images inside archives are kept bit-for-bit identical.
- **Smart Flattening**: Automatically removes redundant single parent subfolders during re-packaging.
- **Batch Conversion**: Convert entire directories or multiple dragged files.
- **Interactive Cleanup**: Prompts whether to keep or delete original `.cbr` files after successful conversion.
- **Cross-platform**: Available on Windows (`.bat` / `.ps1`) and Linux/macOS (`.sh`).

## Prerequisites

- Windows: 7-Zip or WinRAR installed (PowerShell `Compress-Archive` is built-in).
- Linux / macOS: `7z` or `unrar`, and `zip`.

## Usage

### Windows
- **Drag and Drop**: Drag `.cbr` files or a folder onto `convert-cbr-to-cbz.bat`.
- **PowerShell CLI**:
  ```powershell
  .\convert-cbr-to-cbz.ps1 "C:\path\to\comic.cbr"
  .\convert-cbr-to-cbz.ps1 "C:\path\to\comics_folder" -DeleteOriginal
  ```

### Linux / macOS
```bash
chmod +x convert-cbr-to-cbz.sh
./convert-cbr-to-cbz.sh "/path/to/comics"
```
