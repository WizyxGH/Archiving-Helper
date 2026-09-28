@echo off
title Telegram Channel Size Scanner
cd /d "%~dp0"

echo ======================================================
echo  SCANNER DE FICHIERS TELEGRAM (SANS TELECHARGEMENT)
echo ======================================================
echo.

"C:\Users\starl\AppData\Local\Programs\Python\Python312\python.exe" "%~dp0scan_telegram_channel.py"
if errorlevel 1 (
    py "%~dp0scan_telegram_channel.py"
)

echo.
pause
