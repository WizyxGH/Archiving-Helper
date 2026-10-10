@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Archiving Helper - Archive.org Downloader
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

where node >nul 2>nul
if errorlevel 1 (
    if "!APP_LANG!"=="fr" (
        echo [ERREUR] Node.js n'est pas installé ou n'est pas dans le PATH.
    ) else (
        echo [ERROR] Node.js is not installed or not in PATH.
    )
    pause
    exit /b 1
)

node "%~dp0download_archive_org.mjs" %*

echo.
pause
