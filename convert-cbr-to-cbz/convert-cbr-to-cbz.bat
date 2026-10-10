@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Archiving Helper - Conversion CBR vers CBZ
cd /d "%~dp0"

echo ======================================================================
echo   📚 CONVERSION CBR VERS CBZ (REPACK SANS PERTE)
echo ======================================================================
echo.

set "TARGET_INPUT=%~1"
if "!TARGET_INPUT!"=="" (
    echo Glissez-déposez le fichier ou dossier CBR (ou appuyez sur Entrée pour le dossier courant) :
    set /p "TARGET_INPUT="
    if "!TARGET_INPUT!"=="" set "TARGET_INPUT=%CD%"
)

:: Nettoyer les guillemets éventuels
set "TARGET_INPUT=!TARGET_INPUT:"=!"

echo.
choice /c ON /m "Supprimer les fichiers .cbr originaux apres conversion ? (O/N)"
set "DEL_OPT="
if errorlevel 2 (
    set "DEL_OPT="
) else (
    set "DEL_OPT=-DeleteOriginal"
)

echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0convert-cbr-to-cbz.ps1" !DEL_OPT! "!TARGET_INPUT!"

if errorlevel 1 (
    echo.
    echo [ERROR] La conversion a rencontre des erreurs.
)

echo.
pause
