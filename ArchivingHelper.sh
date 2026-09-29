#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v node >/dev/null 2>&1; then
    echo "[ERROR] Node.js is required but not installed."
    exit 1
fi

exec node "$SCRIPT_DIR/src/cli/menu.mjs" "$@"
