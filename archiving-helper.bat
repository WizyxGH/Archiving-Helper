@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Archiving Helper - Assistant BD & Archivage

:: ─── ROUSTAGE AUTOMATIQUE PAR GLISSER-DÉPOSER (DRAG & DROP) ───
if not "%~1"=="" (
    set "DROP_EXT=%~x1"
    set "DROP_PATH=%~1"

    if /i "!DROP_EXT!"==".pdf" (
        cls
        echo [INFO] Détection d'un fichier PDF. Lancement de la conversion...
        call "%~dp0convert-pdf-to-jpg\convert-pdf-to-jpgs.bat" "!DROP_PATH!"
        pause
        exit /b 0
    )
    if /i "!DROP_EXT!"==".txt" goto drop_download
    if /i "!DROP_EXT!"==".dlc" goto drop_download
    
    REM Archives et dossiers -> Réparation & Désanonymisation
    cls
    echo [INFO] Détection d'une archive ou dossier BD. Lancement de la réparation...
    node "%~dp0download-files\repair_and_repack_cbr.mjs" "!DROP_PATH!"
    pause
    exit /b 0

    :drop_download
    cls
    echo [INFO] Détection d'une liste de liens. Lancement du téléchargement...
    node "%~dp0download-files\download.mjs" "!DROP_PATH!"
    pause
    exit /b 0
)

:menu
cls
echo ======================================================================
echo                     📦 ARCHIVING HELPER
echo           Assistant d'Archivage et Traitement de BDs
echo ======================================================================
echo.
echo   [1] ⚡ Archivage Telegram -^> Drive
echo       (Audit des doublons, téléchargement 1 par 1 et tri Inducks)
echo.
echo   [2] 🌐 Télécharger des BDs
echo       (Lecteur Web HD, Blogspot / Blogger, Mediafire, DLC...)
echo.
echo   [3] 🔧 Réparer ^& Désanonymiser des fichiers
echo       (Fusion des parties .part1.rar/.001, détection des codes Inducks)
echo.
echo   [4] 🔄 Outils de Conversion
echo       (PDF ^<^-^> CBR / CBZ / WebP / Images)
echo.
echo   [0] Quitter
echo.
echo ======================================================================
echo  Astuce: Vous pouvez glisser-déposer n'importe quel fichier ou dossier
echo          directement sur ce script pour le traiter automatiquement !
echo ======================================================================
set /p "CHOICE=Votre choix [0-4]: "

if "%CHOICE%"=="1" goto telegram_menu
if "%CHOICE%"=="2" goto download_menu
if "%CHOICE%"=="3" goto repair_menu
if "%CHOICE%"=="4" goto convert_menu
if "%CHOICE%"=="0" exit /b 0
goto menu

:: ──────────────────────────────────────────────────────────────────────
:: [1] TELEGRAM
:: ──────────────────────────────────────────────────────────────────────
:telegram_menu
cls
call "%~dp0download-files\telegram_to_drive.bat"
goto menu

:: ──────────────────────────────────────────────────────────────────────
:: [2] TELECHARGEMENT
:: ──────────────────────────────────────────────────────────────────────
:download_menu
cls
echo ======================================================================
echo   🌐 TÉLÉCHARGEMENT DE BDS
echo ======================================================================
echo.
echo   [1] Télécharger un tome depuis un lecteur Web (ComicMafia HD -^> CBR)
echo   [2] Télécharger / Scraper depuis Blogspot (Mediafire, tomes complets)
echo   [3] Télécharger les liens depuis files.txt (Multi-connexions aria2c)
echo   [4] Mode écoute Click-n-Load (Capture de liens Filecrypt en direct)
echo   [0] Retour au menu principal
echo.
echo ======================================================================
set /p "DL_CHOICE=Votre choix [0-4]: "

if "%DL_CHOICE%"=="1" (
    echo.
    set /p "BOOK_URI=Entrez le lien du tome ou bookUri : "
    if not "!BOOK_URI!"=="" (
        node "%~dp0download-files\download_web_comic.mjs" "!BOOK_URI!"
        pause
    )
    goto download_menu
)
if "%DL_CHOICE%"=="2" (
    echo.
    set /p "BLOG_URL=Entrez l'URL de l'article ou du blog Blogspot : "
    if not "!BLOG_URL!"=="" (
        node "%~dp0download-files\download_blogspot.mjs" "!BLOG_URL!"
        pause
    )
    goto download_menu
)
if "%DL_CHOICE%"=="3" (
    node "%~dp0download-files\download.mjs" "%~dp0download-files\files.txt" --auto-extract
    pause
    goto download_menu
)
if "%DL_CHOICE%"=="4" (
    node "%~dp0download-files\download.mjs"
    pause
    goto download_menu
)
goto menu

:: ──────────────────────────────────────────────────────────────────────
:: [3] REPARATION & DESANONYMISATION
:: ──────────────────────────────────────────────────────────────────────
:repair_menu
cls
echo ======================================================================
echo   🔧 RÉPARATION ET DÉSANONYMISATION DE BDS
echo ======================================================================
echo.
echo Glissez-déposez le fichier ou dossier à réparer :
echo (Archives corrompues, split .part1.rar / .001, hash anonymisé...)
echo.
set /p "REP_PATH=Chemin : "
if not "!REP_PATH!"=="" (
    set "REP_PATH=!REP_PATH:"=!"
    node "%~dp0download-files\repair_and_repack_cbr.mjs" "!REP_PATH!"
    pause
)
goto menu

:: ──────────────────────────────────────────────────────────────────────
:: [4] CONVERSION
:: ──────────────────────────────────────────────────────────────────────
:convert_menu
cls
echo ======================================================================
echo   🔄 BOÎTE À OUTILS DE CONVERSION
echo ======================================================================
echo.
echo   [1] Convertir PDF en JPG / CBZ / CBR (Extraction sans perte)
echo   [2] Convertir CBR en CBZ (Repack ZIP rapide)
echo   [3] Convertir WebP en JPG (ImageMagick)
echo   [4] Assembler des images en un seul PDF (Tri naturel)
echo   [5] Extraire des archives (CBR, CBZ, ZIP, RAR, 7Z)
echo   [0] Retour au menu principal
echo.
echo ======================================================================
set /p "CONV_CHOICE=Votre choix [0-5]: "

if "%CONV_CHOICE%"=="1" call "%~dp0convert-pdf-to-jpg\convert-pdf-to-jpgs.bat"
if "%CONV_CHOICE%"=="2" call "%~dp0convert-cbr-to-cbz\convert-cbr-to-cbz.bat"
if "%CONV_CHOICE%"=="3" call "%~dp0convert-webp-to-jpg\convert-webp-to-jpg.bat"
if "%CONV_CHOICE%"=="4" call "%~dp0images-to-pdf\images-to-pdf.bat"
if "%CONV_CHOICE%"=="5" call "%~dp0extract-archives\extract-archives.bat"
goto menu
