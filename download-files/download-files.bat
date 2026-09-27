@echo off
setlocal
title High-Speed Downloader ^& Comic Pipeline

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is not installed or not in PATH.
    pause
    exit /b 1
)

if "%~1"=="" (
    echo ======================================================================
    echo   High-Speed Downloader ^& Archiving Pipeline
    echo ======================================================================
    echo.
    echo 1. Drag ^& drop a .txt (links) or .dlc file onto this script to download.
    echo 2. OR keep this window open to capture Click'n'Load from Filecrypt!
    echo.
    echo Starting Click'n'Load listener ^& interactive console...
    echo.
    node "%~dp0download.mjs"
    pause
    exit /b 0
)

node "%~dp0download.mjs" %*
if errorlevel 1 (
    echo.
    echo Download failed.
    pause
    exit /b 1
)

echo.
pause
