# WebP → JPG Conversion

Converts `.webp` files to `.jpg` using ImageMagick at 95% quality.

## Features

- **Drag & Drop**: Drag one or multiple `.webp` files or folders directly onto the script.
- **Batch Processing**: Converts entire directories in one go.
- **Interactive Cleanup**: Prompts whether to keep or delete original `.webp` files.
- **Cross-platform**: Available for Windows (`.bat`) and Linux/macOS (`.sh`).

## Prerequisites

- [ImageMagick](https://imagemagick.org/) installed and available in `PATH` (`magick` or `convert`).

## Usage

### Windows
- **Drag and Drop**: Drag `.webp` files or a folder onto `convert-webp-to-jpg.bat`.
- **In-place**: Double-click `convert-webp-to-jpg.bat` in a folder containing `.webp` files.

### Linux / macOS
```bash
chmod +x convert-webp-to-jpg.sh
./convert-webp-to-jpg.sh "/path/to/folder"
```
