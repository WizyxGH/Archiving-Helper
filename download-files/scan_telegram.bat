@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

:: Détection automatique de la langue (FR / EN)
set "APP_LANG=en"
for /f "tokens=3" %%A in ('reg query "HKCU\Control Panel\International" /v LocaleName 2^>nul') do (
    set "LOC_VAL=%%A"
    if /i "!LOC_VAL:~0,2!"=="fr" set "APP_LANG=fr"
)
if defined LANGUAGE (
    if /i "!LANGUAGE:~0,2!"=="fr" set "APP_LANG=fr"
    if /i "!LANGUAGE:~0,2!"=="en" set "APP_LANG=en"
)

if "!APP_LANG!"=="fr" (
    title Archiving Helper - Scanner Telegram
    echo ======================================================
    echo  SCANNER DE FICHIERS TELEGRAM (SANS TÉLÉCHARGEMENT)
    echo ======================================================
) else (
    title Archiving Helper - Telegram Scanner
    echo ======================================================
    echo  TELEGRAM FILE SCANNER (ZERO BYTES DOWNLOADED)
    echo ======================================================
)
echo.

where python >nul 2>nul
if %errorlevel% equ 0 (
    python "%~dp0scan_telegram_channel.py"
) else (
    py -3 "%~dp0scan_telegram_channel.py"
)

echo.
pause
