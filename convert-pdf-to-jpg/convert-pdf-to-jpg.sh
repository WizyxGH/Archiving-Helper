#!/usr/bin/env bash
set -e

if ! command -v node >/dev/null 2>&1; then
    echo "[ERROR] Node.js is not installed. Please install Node.js (>= 18)."
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$#" -eq 0 ]; then
    read -rp "Enter PDF file or folder path: " input_path
    if [ -z "$input_path" ]; then
        node "$SCRIPT_DIR/pdf-to-jpg.mjs" --help
        exit 2
    fi
    node "$SCRIPT_DIR/pdf-to-jpg.mjs" "$input_path"
else
    node "$SCRIPT_DIR/pdf-to-jpg.mjs" "$@"
fi
