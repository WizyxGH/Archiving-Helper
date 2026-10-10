@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Archiving Helper - Downloader

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not in PATH.
    pause
    exit /b 1
)

if not "%~1"=="" (
    node "%~dp0download.mjs" %*
    pause
    exit /b 0
)

:menu
cls
echo ======================================================================
echo          📦 ARCHIVING HELPER - DOWNLOADER
echo ======================================================================
echo.
echo   [1] Télécharger depuis un lien / URL ou recherche (Archive.org, Blogspot, Web Comic, Direct)
echo   [2] Télécharger les liens depuis files.txt (Multi-connexions)
echo   [3] Réparer / Désanonymiser une archive ou dossier (Vers CBZ)
echo   [4] Scanner de taille d'un canal Telegram (0 octet telecharge)
echo   [5] Mode surveillance de dossier (Watch Folder)
echo   [0] Retour / Quitter
echo.
echo ======================================================================
set /p "CHOICE=Choisissez une option [0-5]: "

if "%CHOICE%"=="1" goto unified_download
if "%CHOICE%"=="2" goto download_txt
if "%CHOICE%"=="3" goto repair_cbr
if "%CHOICE%"=="4" goto scan_telegram
if "%CHOICE%"=="5" goto watch_folder
if "%CHOICE%"=="0" goto exit_app
goto menu

:unified_download
cls
echo ======================================================================
echo   TÉLÉCHARGEMENT DEPUIS UN LIEN / URL OU RECHERCHE
echo ======================================================================
echo.
echo Collez le lien (Archive.org, Blogspot, Comic Viewer, Direct) ou des mots-clés :
echo Exemples :
echo   - Disney Adventures
echo   - https://archive.org/details/...
echo   - https://thearabicmagazinmickeymouse.blogspot.com
echo   - Alben/UltimatePhantomias48.cbr
echo.
set /p "TARGET_URL=Lien, URL ou recherche : "
if "%TARGET_URL%"=="" goto menu

echo.
node "%~dp0download_url.mjs" "%TARGET_URL%"
echo.
pause
goto menu

:download_txt
cls
echo ======================================================================
echo   TÉLÉCHARGEMENT DEPUIS files.txt
echo ======================================================================
echo.
set "ARCHIVE_FORMAT=CBR"
set /p "ARCHIVE_FORMAT=Format des tomes Comic Viewer [CBR/CBZ, défaut CBR] : "
if /i not "%ARCHIVE_FORMAT%"=="CBZ" set "ARCHIVE_FORMAT=CBR"
echo.
node "%~dp0download.mjs" "%~dp0files.txt" --format "%ARCHIVE_FORMAT%" --auto-extract
echo.
pause
goto menu

:repair_cbr
cls
echo ======================================================================
echo   RÉPARATION ET DÉSANONYMISATION CBZ
echo ======================================================================
echo.
echo Glissez-déposez le fichier ou dossier à réparer ci-dessous :
echo.
set /p "TARGET_PATH=Chemin du fichier ou dossier : "
if "%TARGET_PATH%"=="" goto menu

set "TARGET_PATH=%TARGET_PATH:"=%"

echo.
node "%~dp0repair_and_repack_cbr.mjs" "%TARGET_PATH%"
echo.
pause
goto menu

:scan_telegram
cls
call "%~dp0scan_telegram.cmd"
goto menu

:watch_folder
cls
echo ======================================================================
echo   MODE SURVEILLANCE DE DOSSIER (WATCH FOLDER)
echo ======================================================================
echo.
node "%~dp0download.mjs" --watch
pause
goto menu

:exit_app
exit /b 0
