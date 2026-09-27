# Images → PDF

Assembles all images from a folder into a single PDF file using ImageMagick.

## Prerequisites

- [ImageMagick](https://imagemagick.org/) installed and available in `PATH` (`magick`)

## Usage

1. **Double-click** `images-to-pdf.bat`
2. Enter the folder path containing the images when prompted
3. The output PDF is generated in the current directory as `result.pdf`

## Supported Image Formats

`jpg`, `jpeg`, `png`, `bmp`, `tiff`, `webp`

## Notes

- Images are processed in alphabetical order by extension and filename
- If `result.pdf` already exists, it will be overwritten
- Temporary files (`temp_N.pdf`) are deleted automatically
