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
set "MSG_TITLE=Archiving Helper - CBR to CBZ Conversion"
set "MSG_HEADER=  📚 CBR TO CBZ CONVERSION (LOSSLESS REPACK)"
set "MSG_PROMPT=Drag-and-drop CBR file or folder [Enter for current directory]:"
set "MSG_DEL_CHOICE=YN"
set "MSG_DEL_PROMPT=Delete original .cbr files after conversion? (Y/N)"
set "MSG_SUCCESS=[✓] Conversion completed successfully!"
set "MSG_ERROR=[ERROR] Conversion encountered errors."
goto init_done

:init_fr
set "MSG_TITLE=Archiving Helper - Conversion CBR vers CBZ"
set "MSG_HEADER=  📚 CONVERSION CBR VERS CBZ (REPACK SANS PERTE)"
set "MSG_PROMPT=Glissez-deposez le fichier ou dossier CBR [Entree pour dossier courant] :"
set "MSG_DEL_CHOICE=ON"
set "MSG_DEL_PROMPT=Supprimer les fichiers .cbr originaux apres conversion ? (O/N)"
set "MSG_SUCCESS=[✓] Conversion terminee avec succes !"
set "MSG_ERROR=[ERREUR] La conversion a rencontre des erreurs."
:init_done

title !MSG_TITLE!

echo ======================================================================
echo !MSG_HEADER!
echo ======================================================================
echo.

set "TARGET_INPUT=%~1"
if "!TARGET_INPUT!"=="" (
    echo !MSG_PROMPT!
    set /p "TARGET_INPUT="
    if "!TARGET_INPUT!"=="" set "TARGET_INPUT=%CD%"
)

rem Nettoyer les guillemets
set "TARGET_INPUT=!TARGET_INPUT:"=!"

echo.
choice /c !MSG_DEL_CHOICE! /m "!MSG_DEL_PROMPT!"
if errorlevel 2 (
    set "DEL_OPT="
) else (
    set "DEL_OPT=-DeleteOriginal"
)

echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0convert-cbr-to-cbz.ps1" !DEL_OPT! "!TARGET_INPUT!"

if errorlevel 1 (
    echo.
    echo !MSG_ERROR!
) else (
    echo.
    echo !MSG_SUCCESS!
)

echo.
pause
