@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Archiving Helper - Downloader
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
if "!APP_LANG!"=="fr" (
    echo   [1] Télécharger depuis un lien / URL ou recherche (Archive.org, Blogspot, Web Comic, Direct)
    echo   [2] Télécharger les liens depuis files.txt (Multi-connexions)
    echo   [3] Réparer / Désanonymiser une archive ou dossier (Vers CBZ)
    echo   [4] Scanner de taille d'un canal Telegram (0 octet téléchargé)
    echo   [5] Mode surveillance de dossier (Watch Folder)
    echo   [0] Retour / Quitter
    echo.
    echo ======================================================================
    set /p "CHOICE=Choisissez une option [0-5]: "
) else (
    echo   [1] Download from link / URL or search (Archive.org, Blogspot, Web Comic, Direct)
    echo   [2] Download links from files.txt (Multi-connections)
    echo   [3] Repair / De-anonymize archive or directory (To CBZ)
    echo   [4] Telegram channel size scanner (0 byte downloaded)
    echo   [5] Watch folder mode
    echo   [0] Back / Quit
    echo.
    echo ======================================================================
    set /p "CHOICE=Choose an option [0-5]: "
)

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
if "!APP_LANG!"=="fr" (
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
) else (
    echo   DOWNLOAD FROM LINK / URL OR SEARCH
    echo ======================================================================
    echo.
    echo Paste link (Archive.org, Blogspot, Comic Viewer, Direct) or search keywords:
    echo Examples:
    echo   - Disney Adventures
    echo   - https://archive.org/details/...
    echo   - https://thearabicmagazinmickeymouse.blogspot.com
    echo   - Alben/UltimatePhantomias48.cbr
    echo.
    set /p "TARGET_URL=Link, URL or search: "
)
if "%TARGET_URL%"=="" goto menu

echo.
node "%~dp0download_url.mjs" "%TARGET_URL%"
echo.
pause
goto menu

:download_txt
cls
echo ======================================================================
if "!APP_LANG!"=="fr" (
    echo   TÉLÉCHARGEMENT DEPUIS files.txt
    echo ======================================================================
    echo.
    set "ARCHIVE_FORMAT=CBR"
    set /p "ARCHIVE_FORMAT=Format des tomes Comic Viewer [CBR/CBZ, défaut CBR] : "
) else (
    echo   DOWNLOAD FROM files.txt
    echo ======================================================================
    echo.
    set "ARCHIVE_FORMAT=CBR"
    set /p "ARCHIVE_FORMAT=Comic Viewer format [CBR/CBZ, default CBR]: "
)
if /i not "%ARCHIVE_FORMAT%"=="CBZ" set "ARCHIVE_FORMAT=CBR"
echo.
node "%~dp0download.mjs" "%~dp0files.txt" --format "%ARCHIVE_FORMAT%" --auto-extract
echo.
pause
goto menu

:repair_cbr
cls
echo ======================================================================
if "!APP_LANG!"=="fr" (
    echo   RÉPARATION ET DÉSANONYMISATION CBZ
    echo ======================================================================
    echo.
    echo Glissez-déposez le fichier ou dossier à réparer ci-dessous :
    echo.
    set /p "TARGET_PATH=Chemin du fichier ou dossier : "
) else (
    echo   REPAIR AND DE-ANONYMIZE CBZ
    echo ======================================================================
    echo.
    echo Drag-and-drop the archive file or folder to repair below:
    echo.
    set /p "TARGET_PATH=File or folder path: "
)
if "%TARGET_PATH%"=="" goto menu

set "TARGET_PATH=%TARGET_PATH:"=%"

echo.
node "%~dp0repair_and_repack_cbr.mjs" "%TARGET_PATH%"
echo.
pause
goto menu

:scan_telegram
cls
call "%~dp0scan_telegram.bat"
goto menu

:watch_folder
cls
echo ======================================================================
if "!APP_LANG!"=="fr" (
    echo   MODE SURVEILLANCE DE DOSSIER (WATCH FOLDER)
) else (
    echo   WATCH FOLDER MODE
)
echo ======================================================================
echo.
node "%~dp0download.mjs" --watch
pause
goto menu

:exit_app
exit /b 0
