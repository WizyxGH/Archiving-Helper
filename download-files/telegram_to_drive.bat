@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Pipeline Telegram -^> D:\Duckburg Archives
cd /d "%~dp0"

echo ======================================================================
echo    PIPELINE ARCHIVAGE TELEGRAM -^> D:\Duckburg Archives\Disney comics
echo ======================================================================
echo.
echo   [1] Mode AUDIT ^& SIMULATION (Vérification sans téléchargement ni suppression)
echo   [2] Mode EXÉCUTION RÉELLE (1 par 1, Dépôt Drive, Suppression sécurisée)
echo   [0] Annuler
echo.
echo ======================================================================
set /p "MODE=Choisissez un mode [0-2]: "

if "%MODE%"=="1" (
    echo.
    echo [*] Lancement en mode SIMULATION / AUDIT...
    "C:\Users\starl\AppData\Local\Programs\Python\Python312\python.exe" "%~dp0telegram_to_drive_pipeline.py"
    pause
    exit /b 0
)

if "%MODE%"=="2" (
    echo.
    echo [!] ATTENTION : Mode exécution réelle.
    echo     Les fichiers validés seront déposés sur D:\ et les messages Telegram supprimés.
    echo.
    set /p "CONFIRM=Confirmez-vous le lancement ? (tapez OUI) : "
    if /i "!CONFIRM!"=="OUI" (
        "C:\Users\starl\AppData\Local\Programs\Python\Python312\python.exe" "%~dp0telegram_to_drive_pipeline.py" --run
    ) else (
        echo Annulé.
    )
    pause
    exit /b 0
)

exit /b 0
