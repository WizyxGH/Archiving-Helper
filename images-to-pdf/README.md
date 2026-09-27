# Images → PDF

Assembles all images in a folder into a single PDF file using ImageMagick, with automatic **natural sorting** to preserve correct comic book and document page order (`1, 2, 10...` instead of `1, 10, 2...`).

## Features

- **Natural Numerical Sorting**: Ensures pages are ordered in correct numeric sequence regardless of leading zero padding.
- **Fast Direct Assembly**: Streams images directly into ImageMagick without creating slow temporary intermediate files.
- **Drag & Drop Support**: Drop any folder or image directly onto the script.
- **Cross-platform**: Available for Windows (`.bat`) and Linux/macOS (`.sh`).

## Prerequisites

- [ImageMagick](https://imagemagick.org/) installed and available in `PATH` (`magick` or `convert`).

## Usage

### Windows
- **Drag and Drop**: Drag a folder containing images onto `images-to-pdf.bat`.
- **Interactive**: Double-click `images-to-pdf.bat` and optionally specify a folder path.
- **Output**: Generates `<folder-name>.pdf` inside the target directory.

### Linux / macOS
```bash
chmod +x images-to-pdf.sh
./images-to-pdf.sh "/path/to/my/images"
```

## Supported Image Formats

`jpg`, `jpeg`, `png`, `bmp`, `tiff`, `webp`
