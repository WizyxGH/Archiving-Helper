# Archive Extraction

Automatically extracts all CBR, CBZ, ZIP, and RAR files from a folder and simplifies nested subfolder structures (flattening).

## Prerequisites

- [WinRAR](https://www.win-rar.com/) installed in `C:\Program Files\WinRAR\` (or update the path in the script)

## Configuration

Edit the variables at the top of the script before running:

```bat
set "WINRAR_PATH=C:\Program Files\WinRAR\WinRAR.exe"
set "INPUT_FOLDER=C:\path\to\my\archives"
set "EXTENSIONS=.cbr .cbz .zip .rar"
```

## How It Works

1. Scans all files in `INPUT_FOLDER`
2. For each recognized archive, creates a subfolder of the same name and extracts into it
3. **Flatten**: if the extracted content contains only a single subfolder, moves files up one level (prevents redundant nested folders)
4. Displays the final file count for each extracted folder

## Usage

Double-click `extract-archives.bat` after configuring the variables.
