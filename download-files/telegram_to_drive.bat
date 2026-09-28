@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Pipeline Telegram -^> D:\Duckburg Archives
cd /d "%~dp0"

:: Détection automatique de Python (compatible tout PC)
set "PY_CMD=python"
where python >nul 2>nul
if errorlevel 1 (
    where py >nul 2>nul
    if not errorlevel 1 (
        set "PY_CMD=py -3"
    ) else if exist "C:\Users\starl\AppData\Local\Programs\Python\Python312\python.exe" (
        set "PY_CMD=C:\Users\starl\AppData\Local\Programs\Python\Python312\python.exe"
    ) else (
        echo [ERREUR] Python n'a pas été trouvé sur ce PC.
        echo Veuillez installer Python depuis https://www.python.org
        pause
        exit /b 1
    )
)

echo ======================================================================
echo    PIPELINE ARCHIVAGE TELEGRAM -^> DRIVE
echo ======================================================================
echo.
echo   [1] 🔎 Mode AUDIT & SIMULATION
echo       (Compare avec le Drive et génère le rapport CSV sans rien télécharger)
echo.
echo   [2] ⚡ Mode EXÉCUTION RÉELLE
echo       (Téléchargement 1 par 1 sur D:\, vérification puis nettoyage)
echo.
echo   [0] Retour au menu principal
echo.
echo ======================================================================
set /p "MODE=Votre choix [0-2]: "

if "%MODE%"=="1" (
    echo.
    echo [*] Lancement du mode AUDIT & SIMULATION...
    !PY_CMD! "%~dp0telegram_to_drive_pipeline.py"
    echo.
    pause
    exit /b 0
)

if "%MODE%"=="2" (
    echo.
    echo ======================================================================
    echo  [!] ATTENTION : MODE EXÉCUTION RÉELLE
    echo      Les nouveaux tomes seront déposés sur votre Drive et
    echo      les messages validés seront purgés de Telegram.
    echo ======================================================================
    echo.
    set /p "CONFIRM=Confirmez-vous le lancement ? (tapez OUI) : "
    if /i "!CONFIRM!"=="OUI" (
        !PY_CMD! "%~dp0telegram_to_drive_pipeline.py" --run
    ) else (
        echo Annulé.
    )
    echo.
    pause
    exit /b 0
)

exit /b 0
