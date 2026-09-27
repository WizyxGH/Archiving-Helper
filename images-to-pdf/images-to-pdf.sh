#!/usr/bin/env bash
set -e

# === Detect ImageMagick ===
MAGICK_CMD=""
if command -v magick >/dev/null 2>&1; then
    MAGICK_CMD="magick"
elif command -v convert >/dev/null 2>&1; then
    MAGICK_CMD="convert"
else
    echo "[ERROR] ImageMagick is not installed. Please install ImageMagick."
    exit 1
fi

TARGET_DIR="${1:-.}"
if [ ! -d "$TARGET_DIR" ]; then
    if [ -f "$TARGET_DIR" ]; then
        TARGET_DIR="$(dirname "$TARGET_DIR")"
    else
        echo "[ERROR] Directory not found: $TARGET_DIR"
        exit 1
    fi
fi

DIR_NAME="$(basename "$(cd "$TARGET_DIR" && pwd)")"
OUT_PDF="$TARGET_DIR/$DIR_NAME.pdf"

echo "[INFO] Processing directory: $TARGET_DIR"

LIST_FILE=$(mktemp)
trap 'rm -f "$LIST_FILE"' EXIT

find "$TARGET_DIR" -maxdepth 1 -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.bmp" -o -iname "*.tiff" -o -iname "*.webp" \) | sort -V > "$LIST_FILE"

COUNT=$(wc -l < "$LIST_FILE")
if [ "$COUNT" -eq 0 ]; then
    echo "[ERROR] No supported images found in $TARGET_DIR"
    exit 1
fi

echo "[INFO] Found $COUNT image(s). Assembling into $OUT_PDF..."
"$MAGICK_CMD" @"$LIST_FILE" "$OUT_PDF"

echo "[SUCCESS] PDF created successfully: $OUT_PDF ($COUNT pages)"
