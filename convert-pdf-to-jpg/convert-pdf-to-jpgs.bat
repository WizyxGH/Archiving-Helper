@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem Detection langue FR / EN
set "APP_LANG=en"
for /f "tokens=3" %%A in ('reg query "HKCU\Control Panel\International" /v LocaleName 2^>nul') do (
    set "LOC_VAL=%%A"
    if /i "!LOC_VAL:~0,2!"=="fr" set "APP_LANG=fr"
)
if defined LANGUAGE (
    if /i "!LANGUAGE:~0,2!"=="fr" set "APP_LANG=fr"
    if /i "!LANGUAGE:~0,2!"=="en" set "APP_LANG=en"
)

if "!APP_LANG!"=="fr" goto init_fr
:init_en
set "MSG_TITLE=Archiving Helper - PDF to JPG / CBZ Extraction"
set "MSG_HEADER=  📄 LOSSLESS PDF TO JPG / CBZ / CBR EXTRACTION"
set "MSG_NODE_ERR=[ERROR] Node.js is not installed or not in PATH."
set "MSG_NODE_URL=Please install Node.js from https://nodejs.org/"
set "MSG_PROMPT=Drag-and-drop a PDF file or folder (or enter its path):"
set "MSG_NO_INPUT=[INFO] No path specified."
set "MSG_ARCHIVE_ASK=Would you like to create an archive after extraction?"
set "MSG_ARCHIVE_CBZ=  [1] CBZ (Recommended)"
set "MSG_ARCHIVE_CBR=  [2] CBR"
set "MSG_ARCHIVE_NONE=  [3] No (keep JPG image folder only)"
set "MSG_ARCHIVE_CHOICE=Your choice [1-3, default 1]: "
set "MSG_SUCCESS=[✓] Extraction completed successfully!"
set "MSG_ERROR=[!] Extraction completed with errors."
goto init_done

:init_fr
set "MSG_TITLE=Archiving Helper - Extraction PDF vers JPG / CBZ"
set "MSG_HEADER=  📄 EXTRACTION SANS PERTE PDF VERS JPG / CBZ / CBR"
set "MSG_NODE_ERR=[ERREUR] Node.js n'est pas installe ou n'est pas dans le PATH."
set "MSG_NODE_URL=Veuillez installer Node.js depuis https://nodejs.org/"
set "MSG_PROMPT=Glissez-deposez un fichier ou dossier PDF (ou entrez son chemin) :"
set "MSG_NO_INPUT=[INFO] Aucun chemin specifie."
set "MSG_ARCHIVE_ASK=Desirez-vous creer une archive apres extraction ?"
set "MSG_ARCHIVE_CBZ=  [1] CBZ (Recommande)"
set "MSG_ARCHIVE_CBR=  [2] CBR"
set "MSG_ARCHIVE_NONE=  [3] Non (garder le dossier d'images JPG uniquement)"
set "MSG_ARCHIVE_CHOICE=Votre choix [1-3, defaut 1] : "
set "MSG_SUCCESS=[✓] Extraction terminee avec succes !"
set "MSG_ERROR=[!] L'extraction s'est terminee avec des erreurs."
:init_done

title !MSG_TITLE!

where node >nul 2>nul
if errorlevel 1 (
    echo !MSG_NODE_ERR!
    echo !MSG_NODE_URL!
    echo.
    pause
    exit /b 1
)

if not "%~1"=="" (
    node "%~dp0pdf-to-jpg.mjs" %*
    goto finish
)

echo ======================================================================
echo !MSG_HEADER!
echo ======================================================================
echo.

set "TARGET_INPUT="
echo !MSG_PROMPT!
set /p "TARGET_INPUT="

if not defined TARGET_INPUT (
    echo.
    echo !MSG_NO_INPUT!
    echo.
    pause
    exit /b 0
)

rem Nettoyer les guillemets
set "TARGET_INPUT=!TARGET_INPUT:"=!"

echo.
echo !MSG_ARCHIVE_ASK!
echo !MSG_ARCHIVE_CBZ!
echo !MSG_ARCHIVE_CBR!
echo !MSG_ARCHIVE_NONE!
set "ARCHIVE_CHOICE="
set /p "ARCHIVE_CHOICE=!MSG_ARCHIVE_CHOICE!"

set "ARCHIVE_ARG=--archive cbz"
if "!ARCHIVE_CHOICE!"=="2" set "ARCHIVE_ARG=--archive cbr"
if "!ARCHIVE_CHOICE!"=="3" set "ARCHIVE_ARG="

echo.
node "%~dp0pdf-to-jpg.mjs" "!TARGET_INPUT!" !ARCHIVE_ARG!

:finish
if errorlevel 1 (
    echo.
    echo !MSG_ERROR!
) else (
    echo.
    echo !MSG_SUCCESS!
)

echo.
pause
