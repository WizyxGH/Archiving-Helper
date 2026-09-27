@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Archiving Helper - Download & Web Comic Pipeline

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
echo          📦 ARCHIVING HELPER - DOWNLOADER & COMIC PIPELINE
echo ======================================================================
echo.
echo   [1] Télécharger un tome Comic Viewer (ComicMafia HD -> CBR)
echo   [2] Télécharger les liens depuis files.txt (Multi-connexions aria2c)
echo   [3] Mode surveillance de dossier (Watch Folder)
echo   [0] Retour au menu principal / Quitter
echo.
echo ======================================================================
set /p "CHOICE=Choisissez une option [0-3]: "

if "%CHOICE%"=="1" goto web_comic
if "%CHOICE%"=="2" goto download_txt
if "%CHOICE%"=="3" goto watch_folder
if "%CHOICE%"=="0" goto exit_app
goto menu

:web_comic
cls
echo ======================================================================
echo   TÉLÉCHARGEMENT COMIC VIEWER (HD LOSSLESS -^> CBR)
echo ======================================================================
echo.
echo Collez le lien Comic Viewer ou le bookUri :
echo Exemples :
echo   - https://comicmafia.to/reader/comic-viewer.html?bookUri=Alben/UltimatePhantomias48.cbr
echo   - Alben/UltimatePhantomias48.cbr
echo.
set /p "BOOK_URI=Lien ou URI : "
if "%BOOK_URI%"=="" goto menu

echo.
node "%~dp0download_web_comic.mjs" "%BOOK_URI%"
echo.
pause
goto menu

:download_txt
cls
echo ======================================================================
echo   TÉLÉCHARGEMENT DEPUIS files.txt
echo ======================================================================
echo.
node "%~dp0download.mjs" "%~dp0files.txt" --auto-extract
echo.
pause
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
