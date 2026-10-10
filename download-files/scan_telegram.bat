@echo off
title Telegram Channel Size Scanner
cd /d "%~dp0"

echo ======================================================
echo  SCANNER DE FICHIERS TELEGRAM (SANS TELECHARGEMENT)
echo ======================================================
echo.

where python >nul 2>nul
if %errorlevel% equ 0 (
    python "%~dp0scan_telegram_channel.py"
) else (
    py -3 "%~dp0scan_telegram_channel.py"
)

echo.
pause
