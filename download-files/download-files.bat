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
echo   [1] Télécharger un tome Comic Viewer (CBR par défaut, CBZ au choix)
echo   [2] Télécharger les liens depuis files.txt (Multi-connexions)
echo   [3] Réparer / Désanonymiser une archive ou dossier (Vers CBZ)
echo   [4] Télécharger / Crawler des BDs Blogspot / Blogger (HD -^> CBR)
echo   [5] Scanner de taille d'un canal Telegram (0 octet telecharge)
echo   [6] Mode surveillance de dossier (Watch Folder)
echo   [0] Retour / Quitter
echo.
echo ======================================================================
set /p "CHOICE=Choisissez une option [0-6]: "

if "%CHOICE%"=="1" goto web_comic
if "%CHOICE%"=="2" goto download_txt
if "%CHOICE%"=="3" goto repair_cbr
if "%CHOICE%"=="4" goto blogspot_comic
if "%CHOICE%"=="5" goto scan_telegram
if "%CHOICE%"=="6" goto watch_folder
if "%CHOICE%"=="0" goto exit_app
goto menu

:web_comic
cls
echo ======================================================================
echo   TÉLÉCHARGEMENT COMIC VIEWER (HD LOSSLESS -^> CBZ)
echo ======================================================================
echo.
echo Collez le lien Comic Viewer ou le bookUri :
echo Exemple : Alben/UltimatePhantomias48.cbr
echo.
set /p "BOOK_URI=Lien ou URI : "
if "%BOOK_URI%"=="" goto menu

set "ARCHIVE_FORMAT=CBR"
set /p "ARCHIVE_FORMAT=Format [CBR/CBZ, défaut CBR] : "
if /i not "%ARCHIVE_FORMAT%"=="CBZ" set "ARCHIVE_FORMAT=CBR"

echo.
node "%~dp0download_web_comic.mjs" "%BOOK_URI%" "%ARCHIVE_FORMAT%"
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

:blogspot_comic
cls
echo ======================================================================
echo   TÉLÉCHARGEMENT & SCRAPING BLOGSPOT / BLOGGER (HD -^> CBR)
echo ======================================================================
echo.
echo Collez l'URL de l'article ou du blog Blogspot :
echo Exemple : https://thearabicmagazinmickeymouse.blogspot.com
echo.
set /p "BLOG_URL=URL : "
if "%BLOG_URL%"=="" goto menu

echo.
node "%~dp0download_blogspot.mjs" "%BLOG_URL%"
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
