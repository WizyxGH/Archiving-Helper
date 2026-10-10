@echo off
chcp 65001 >nul
title Archiving Helper - Archive.org Downloader

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not in PATH.
    pause
    exit /b 1
)

node "%~dp0download_archive_org.mjs" %*

echo.
pause

