#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

while true; do
    clear
    echo "========================================================"
    echo "              📦 ARCHIVING HELPER SUITE"
    echo "========================================================"
    echo ""
    echo "  [1] Convert PDF to JPG / CBZ / CBR (Lossless extraction)"
    echo "  [2] Convert CBR to CBZ (Lossless repack)"
    echo "  [3] Convert WebP to JPG (ImageMagick)"
    echo "  [4] Assemble Images to PDF (Natural page ordering)"
    echo "  [5] Extract Archives (CBR, CBZ, ZIP, RAR, 7Z)"
    echo ""
    echo "  ─── Comic Download & Processing ───────────────────────"
    echo "  [6] Download Files (Direct, Debrider, DLC, Click-n-Load)"
    echo "  [7] Download Web Comic (Comic Viewer HD -> CBR)"
    echo "  [8] Scrape & Download Blogspot (Lossless CBR / Links)"
    echo "  [9] Repair & De-anonymize Comics (Inducks naming)"
    echo "  [10] Telegram Archival Pipeline (Drive Sorting & Audit)"
    echo ""
    echo "  ─── Maintenance ────────────────────────────────────────"
    echo "  [11] Run Core Unit Tests"
    echo "  [0]  Exit"
    echo ""
    echo "========================================================"
    read -rp "Select an option [0-11]: " choice

    case "$choice" in
        1)
            bash "$SCRIPT_DIR/convert-pdf-to-jpg/convert-pdf-to-jpg.sh"
            read -rp "Press Enter to continue..."
            ;;
        2)
            bash "$SCRIPT_DIR/convert-cbr-to-cbz/convert-cbr-to-cbz.sh"
            read -rp "Press Enter to continue..."
            ;;
        3)
            bash "$SCRIPT_DIR/convert-webp-to-jpg/convert-webp-to-jpg.sh"
            read -rp "Press Enter to continue..."
            ;;
        4)
            bash "$SCRIPT_DIR/images-to-pdf/images-to-pdf.sh"
            read -rp "Press Enter to continue..."
            ;;
        5)
            bash "$SCRIPT_DIR/extract-archives/extract-archives.sh"
            read -rp "Press Enter to continue..."
            ;;
        6)
            node "$SCRIPT_DIR/download-files/download.mjs"
            read -rp "Press Enter to continue..."
            ;;
        7)
            read -rp "Enter Web Comic URI/Link: " uri
            node "$SCRIPT_DIR/download-files/download_web_comic.mjs" "$uri"
            read -rp "Press Enter to continue..."
            ;;
        8)
            read -rp "Enter Blogspot URL: " blog_url
            node "$SCRIPT_DIR/download-files/download_blogspot.mjs" "$blog_url"
            read -rp "Press Enter to continue..."
            ;;
        9)
            read -rp "Enter file or folder to repair: " target
            node "$SCRIPT_DIR/download-files/repair_and_repack_cbr.mjs" "$target"
            read -rp "Press Enter to continue..."
            ;;
        10)
            python3 "$SCRIPT_DIR/download-files/telegram_to_drive_pipeline.py"
            read -rp "Press Enter to continue..."
            ;;
        11)
            (cd "$SCRIPT_DIR/convert-pdf-to-jpg/package" && npm test)
            read -rp "Press Enter to continue..."
            ;;
        0)
            exit 0
            ;;
        *)
            echo "Invalid option."
            sleep 1
            ;;
    esac
done
