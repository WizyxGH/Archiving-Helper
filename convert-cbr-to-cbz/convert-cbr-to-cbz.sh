#!/usr/bin/env bash
set -e

EXTRACTOR=""
if command -v 7z >/dev/null 2>&1; then
    EXTRACTOR="7z"
elif command -v unrar >/dev/null 2>&1; then
    EXTRACTOR="unrar"
else
    echo "[ERROR] No RAR extractor found. Please install 7z or unrar."
    exit 1
fi

if ! command -v zip >/dev/null 2>&1; then
    echo "[ERROR] 'zip' command not found. Please install zip."
    exit 1
fi

read -rp "Do you want to delete original .cbr files after conversion? (y/N): " choice
case "$choice" in
    y|Y) DELETE_ORIGINAL=true ;;
    *)   DELETE_ORIGINAL=false ;;
esac

convert_cbr() {
    local cbr="$1"
    local dir
    dir="$(dirname "$cbr")"
    local filename
    filename="$(basename "$cbr")"
    local basename="${filename%.*}"
    local cbz="$dir/$basename.cbz"

    if [ -f "$cbz" ]; then
        echo "[WARN] Target CBZ already exists: $cbz. Skipping."
        return
    fi

    echo "-------------------------------------------"
    echo "[CONVERTING] $filename -> $basename.cbz"

    local tmpdir
    tmpdir=$(mktemp -d)

    if [ "$EXTRACTOR" = "7z" ]; then
        7z x -y -o"$tmpdir" "$cbr" >/dev/null
    else
        unrar x -y "$cbr" "$tmpdir/" >/dev/null
    fi

    # Flatten if single nested directory
    local filecount foldercount
    filecount=$(find "$tmpdir" -maxdepth 1 -type f | wc -l)
    foldercount=$(find "$tmpdir" -maxdepth 1 -mindepth 1 -type d | wc -l)
    if [ "$filecount" -eq 0 ] && [ "$foldercount" -eq 1 ]; then
        local subfolder
        subfolder=$(find "$tmpdir" -maxdepth 1 -mindepth 1 -type d | head -n 1)
        find "$subfolder" -mindepth 1 -maxdepth 1 -exec mv -t "$tmpdir" {} +
        rmdir "$subfolder"
    fi

    (cd "$tmpdir" && zip -q -r -0 "$cbz" .)
    rm -rf "$tmpdir"

    echo "[SUCCESS] Created: $cbz"
    local script_dir
    script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
    local collection_script="$script_dir/../src/pipelines/4_inducks_collection/collection.mjs"
    if command -v node >/dev/null 2>&1 && [ -f "$collection_script" ]; then
        node "$collection_script" "$cbz" || echo "[WARN] Collection update failed for $cbz."
    else
        echo "[WARN] Node.js or the collection updater was not found; archive was created without collection update."
    fi

    if [ "$DELETE_ORIGINAL" = true ]; then
        rm "$cbr"
        echo "  [CLEANUP] Deleted original CBR."
    fi
}

if [ "$#" -eq 0 ]; then
    find . -maxdepth 1 -type f -iname "*.cbr" | while read -r f; do
        convert_cbr "$f"
    done
else
    for arg in "$@"; do
        if [ -d "$arg" ]; then
            find "$arg" -maxdepth 1 -type f -iname "*.cbr" | while read -r f; do
                convert_cbr "$f"
            done
        elif [ -f "$arg" ]; then
            convert_cbr "$arg"
        fi
    done
fi

echo "==========================================="
echo "Conversion complete."
