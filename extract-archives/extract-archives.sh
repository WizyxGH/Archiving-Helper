#!/usr/bin/env bash
set -e

# === Detect extraction tool ===
EXTRACTOR=""
EXTRACTOR_TYPE=""

if command -v 7z >/dev/null 2>&1; then
    EXTRACTOR="7z"
    EXTRACTOR_TYPE="7z"
elif command -v unrar >/dev/null 2>&1; then
    EXTRACTOR="unrar"
    EXTRACTOR_TYPE="unrar"
elif command -v unzip >/dev/null 2>&1; then
    EXTRACTOR="unzip"
    EXTRACTOR_TYPE="unzip"
elif command -v tar >/dev/null 2>&1; then
    EXTRACTOR="tar"
    EXTRACTOR_TYPE="tar"
else
    echo "[ERROR] No extractor found. Please install 7z, unrar, unzip or tar."
    exit 1
fi

echo "[INFO] Using extractor: $EXTRACTOR ($EXTRACTOR_TYPE)"

flatten() {
    local target="$1"
    while true; do
        local filecount
        filecount=$(find "$target" -maxdepth 1 -type f | wc -l)
        local foldercount
        foldercount=$(find "$target" -maxdepth 1 -mindepth 1 -type d | wc -l)

        if [ "$filecount" -eq 0 ] && [ "$foldercount" -eq 1 ]; then
            local subfolder
            subfolder=$(find "$target" -maxdepth 1 -mindepth 1 -type d | head -n 1)
            echo "[FLATTEN] Moving contents from $subfolder up to $target"
            find "$subfolder" -mindepth 1 -maxdepth 1 -exec mv -t "$target" {} +
            rmdir "$subfolder"
        else
            break
        fi
    done
}

extract_file() {
    local file="$1"
    local dir
    dir="$(dirname "$file")"
    local filename
    filename="$(basename "$file")"
    local basename="${filename%.*}"
    local dest="$dir/$basename"

    echo "-------------------------------------------"
    echo "[EXTRACTING] $filename -> $dest"
    mkdir -p "$dest"

    case "$EXTRACTOR_TYPE" in
        7z)
            7z x -y -o"$dest" "$file" >/dev/null
            ;;
        unrar)
            unrar x -y "$file" "$dest/" >/dev/null
            ;;
        unzip)
            unzip -q -o "$file" -d "$dest"
            ;;
        tar)
            tar -xf "$file" -C "$dest"
            ;;
    esac

    flatten "$dest"
    local count
    count=$(find "$dest" -type f | wc -l)
    echo "[SUCCESS] $count file(s) in $dest"
}

process_target() {
    local target="$1"
    if [ -d "$target" ]; then
        echo "Processing directory: $target"
        find "$target" -maxdepth 1 -type f \( -iname "*.cbr" -o -iname "*.cbz" -o -iname "*.zip" -o -iname "*.rar" -o -iname "*.7z" \) | while read -r f; do
            extract_file "$f"
        done
    elif [ -f "$target" ]; then
        extract_file "$target"
    fi
}

if [ "$#" -eq 0 ]; then
    read -rp "Enter directory containing archives (default: current dir): " input_dir
    target_dir="${input_dir:-.}"
    process_target "$target_dir"
else
    for arg in "$@"; do
        process_target "$arg"
    done
fi

echo "==========================================="
echo "Extraction complete."
