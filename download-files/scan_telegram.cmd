@echo off
title Telegram Channel Size Scanner
cd /d "%~dp0"

"C:\Users\starl\AppData\Local\Programs\Python\Python312\python.exe" "%~dp0scan_telegram_channel.py"
if errorlevel 1 (
    py "%~dp0scan_telegram_channel.py"
)

pause
