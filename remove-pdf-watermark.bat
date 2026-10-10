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
set "MSG_TITLE=Archiving Helper - PDF Watermark Remover"
set "MSG_HEADER=  🧹 PDF WATERMARK REMOVER (100%% LOSSLESS IMAGE PRESERVATION)"
set "MSG_PY_ERR=[ERROR] Python is not installed or not in PATH."
set "MSG_PY_URL=Please install Python from https://python.org/"
set "MSG_PROMPT=Drag-and-drop the PDF file to clean:"
set "MSG_NO_INPUT=[INFO] No file specified."
set "MSG_NOT_FOUND=[ERROR] File not found:"
set "MSG_SUCCESS=[✓] Cleaning completed successfully!"
set "MSG_ERROR=[!] Cleaning encountered an error."
goto init_done

:init_fr
set "MSG_TITLE=Archiving Helper - Suppression de filigranes PDF"
set "MSG_HEADER=  🧹 SUPPRESSION DE FILIGRANES PDF (100%% SANS PERTE D'IMAGES)"
set "MSG_PY_ERR=[ERREUR] Python n'est pas installe ou n'est pas dans le PATH."
set "MSG_PY_URL=Veuillez installer Python depuis https://python.org/"
set "MSG_PROMPT=Glissez-deposez le fichier PDF a nettoyer :"
set "MSG_NO_INPUT=[INFO] Aucun fichier specifie."
set "MSG_NOT_FOUND=[ERREUR] Fichier introuvable :"
set "MSG_SUCCESS=[✓] Nettoyage termine avec succes !"
set "MSG_ERROR=[!] Le nettoyage a rencontre une erreur."
:init_done

title !MSG_TITLE!

echo ======================================================================
echo !MSG_HEADER!
echo ======================================================================
echo.

set "PY_CMD="
where python >nul 2>nul
if %errorlevel% equ 0 set "PY_CMD=python"
if not defined PY_CMD (
    where py >nul 2>nul
    if %errorlevel% equ 0 set "PY_CMD=py -3"
)

if not defined PY_CMD (
    echo !MSG_PY_ERR!
    echo !MSG_PY_URL!
    pause
    exit /b 1
)

set "TARGET_INPUT=%~1"
if "!TARGET_INPUT!"=="" (
    echo !MSG_PROMPT!
    set /p "TARGET_INPUT="
)

if "!TARGET_INPUT!"=="" (
    echo !MSG_NO_INPUT!
    pause
    exit /b 0
)

set "TARGET_INPUT=!TARGET_INPUT:"=!"

if not exist "!TARGET_INPUT!" (
    echo !MSG_NOT_FOUND! "!TARGET_INPUT!"
    pause
    exit /b 1
)

echo.
%PY_CMD% "%~dp0src\core\pdf_watermark_remover.py" "!TARGET_INPUT!"

if errorlevel 1 (
    echo.
    echo !MSG_ERROR!
) else (
    echo.
    echo !MSG_SUCCESS!
)

echo.
pause
