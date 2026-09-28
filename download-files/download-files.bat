@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Archiving Helper - Download & Comic Pipeline

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
echo   [1] Télécharger un tome Comic Viewer (ComicMafia HD -^> CBR)
echo   [2] Télécharger les liens depuis files.txt (Multi-connexions)
echo   [3] Réparer / Désanonymiser une archive ou dossier (Vers CBR)
echo   [4] Mode surveillance de dossier (Watch Folder)
echo   [0] Retour / Quitter
echo.
echo ======================================================================
set /p "CHOICE=Choisissez une option [0-4]: "

if "%CHOICE%"=="1" goto web_comic
if "%CHOICE%"=="2" goto download_txt
if "%CHOICE%"=="3" goto repair_cbr
if "%CHOICE%"=="4" goto watch_folder
if "%CHOICE%"=="0" goto exit_app
goto menu

:web_comic
cls
echo ======================================================================
echo   TÉLÉCHARGEMENT COMIC VIEWER (HD LOSSLESS -^> CBR)
echo ======================================================================
echo.
echo Collez le lien Comic Viewer ou le bookUri :
echo Exemple : Alben/UltimatePhantomias48.cbr
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

:repair_cbr
cls
echo ======================================================================
echo   RÉPARATION ET DÉSANONYMISATION CBR
echo ======================================================================
echo.
echo Glissez-déposez le fichier ou dossier à réparer ci-dessous :
echo.
set /p "TARGET_PATH=Chemin du fichier ou dossier : "
if "%TARGET_PATH%"=="" goto menu

REM Remove quotes if present
set "TARGET_PATH=%TARGET_PATH:"=%"

echo.
node "%~dp0repair_and_repack_cbr.mjs" "%TARGET_PATH%"
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
