# Archive Extraction

Automatically extracts CBR, CBZ, ZIP, RAR, and 7Z archives into individual folders and simplifies nested subfolder structures (flattening).

## Features

- **Multi-engine auto-detection**: Supports 7-Zip, WinRAR, or built-in Windows `tar`.
- **Drag & drop support**: Drop one or multiple archive files or folders directly onto the script.
- **Smart flattening**: If an archive extracts to a single nested folder, its files are automatically moved up one level.
- **Cross-platform**: Provided as `.bat` (Windows) and `.sh` (Linux / macOS).

## Prerequisites

At least one of the following extractors must be installed:
- [7-Zip](https://www.7-zip.org/) (Recommended)
- [WinRAR](https://www.win-rar.com/)
- Built-in `tar` (available on Windows 10/11 and Linux/macOS)

## Usage

### Windows
- **Drag and Drop**: Drag one or several archives / folders onto `extract-archives.bat`.
- **Interactive**: Double-click `extract-archives.bat` and optionally enter a target folder.
- **CLI**:
  ```cmd
  extract-archives.bat "C:\path\to\my\archives"
  extract-archives.bat "C:\path\to\comic.cbr"
  ```

### Linux / macOS
```bash
chmod +x extract-archives.sh
./extract-archives.sh "/path/to/my/archives"
```
