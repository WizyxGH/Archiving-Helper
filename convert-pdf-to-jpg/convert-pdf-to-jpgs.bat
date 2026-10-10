@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Archiving Helper - Extraction PDF vers JPG / CBZ
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo [ERREUR] Node.js n'est pas installe ou n'est pas dans le PATH.
    echo Veuillez installer Node.js depuis https://nodejs.org/
    echo.
    pause
    exit /b 1
)

if not "%~1"=="" (
    node "%~dp0pdf-to-jpg.mjs" %*
    goto finish
)

echo ======================================================================
echo   📄 EXTRACTION SANS PERTE PDF VERS JPG / CBZ / CBR
echo ======================================================================
echo.
set "TARGET_INPUT="
echo Glissez-déposez un fichier ou dossier PDF (ou entrez son chemin) :
set /p "TARGET_INPUT="
if not defined TARGET_INPUT (
    echo.
    echo [INFO] Aucun chemin spécifié.
    echo.
    echo Options disponibles en ligne de commande :
    echo   --output-dir  ^<dossier^>     Dossier de sortie pour les JPG
    echo   --output-name ^<modèle^>      Modèle de nom, ex: {name}_{page:03d}
    echo   --archive     cbz           Créer une archive CBZ après extraction
    echo   --archive     cbr           Créer une archive CBR après extraction
    echo   --keep-jpgs                 Conserver le dossier JPG après compression
    echo   --workers     ^<nombre^>      Nombre de threads parallèles (1-32)
    echo.
    pause
    exit /b 0
)

:: Nettoyer les guillemets éventuels
set "TARGET_INPUT=!TARGET_INPUT:"=!"

echo.
echo Désirez-vous créer une archive après extraction ?
echo   [1] CBZ (Recommandé)
echo   [2] CBR
echo   [3] Non (garder le dossier d'images JPG uniquement)
set "ARCHIVE_CHOICE="
set /p "ARCHIVE_CHOICE=Votre choix [1-3, défaut 1] : "

set "ARCHIVE_ARG=--archive cbz"
if "!ARCHIVE_CHOICE!"=="2" set "ARCHIVE_ARG=--archive cbr"
if "!ARCHIVE_CHOICE!"=="3" set "ARCHIVE_ARG="

echo.
node "%~dp0pdf-to-jpg.mjs" "!TARGET_INPUT!" !ARCHIVE_ARG!

:finish
if errorlevel 1 (
    echo.
    echo [!] L'extraction s'est terminée avec des erreurs.
) else (
    echo.
    echo [✓] Extraction terminée avec succès !
)

echo.
pause
