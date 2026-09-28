@echo off
setlocal
title Telegram Channel Size Scanner
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
    echo Python n'est pas installe ou n'est pas dans le PATH.
    pause
    exit /b 1
)

python scan_telegram_channel.py
pause
