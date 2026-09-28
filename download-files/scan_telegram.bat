@echo off
setlocal enabledelayedexpansion
title Telegram Channel Size Scanner
cd /d "%~dp0"

set "PYTHON_BIN=C:\Users\starl\AppData\Local\Programs\Python\Python312\python.exe"
if exist "!PYTHON_BIN!" (
    "!PYTHON_BIN!" "%~dp0scan_telegram_channel.py"
    goto :end
)

py -3 "%~dp0scan_telegram_channel.py"
if not errorlevel 1 goto :end

python "%~dp0scan_telegram_channel.py"

:end
echo.
pause
