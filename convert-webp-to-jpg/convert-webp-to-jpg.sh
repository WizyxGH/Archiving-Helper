#!/usr/bin/env bash
set -e

MAGICK_CMD=""
if command -v magick >/dev/null 2>&1; then
    MAGICK_CMD="magick"
elif command -v convert >/dev/null 2>&1; then
    MAGICK_CMD="convert"
else
    echo "[ERROR] ImageMagick is not installed. Please install ImageMagick."
    exit 1
fi

read -rp "Do you want to delete original .webp files after conversion? (y/N): " choice
case "$choice" in
    y|Y) DELETE_ORIGINAL=true ;;
    *)   DELETE_ORIGINAL=false ;;
esac

convert_file() {
    local file="$1"
    local dir
    dir="$(dirname "$file")"
    local filename
    filename="$(basename "$file")"
    local basename="${filename%.*}"
    local out="$dir/$basename.jpg"

    echo "[CONVERTING] $file -> $out"
    "$MAGICK_CMD" "$file" -quality 95 "$out"
    if [ -f "$out" ]; then
        if [ "$DELETE_ORIGINAL" = true ]; then
            rm "$file"
        fi
    else
        echo "[ERROR] Failed to convert $file"
    fi
}

convert_dir() {
    local dir="$1"
    echo "[INFO] Processing directory: $dir"
    find "$dir" -maxdepth 1 -type f -iname "*.webp" | while read -r f; do
        convert_file "$f"
    done
}

if [ "$#" -eq 0 ]; then
    convert_dir "."
else
    for arg in "$@"; do
        if [ -d "$arg" ]; then
            convert_dir "$arg"
        elif [ -f "$arg" ]; then
            convert_file "$arg"
        fi
    done
fi

echo "==========================================="
echo "Conversion complete."
