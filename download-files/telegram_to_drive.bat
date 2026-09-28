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

if "%~1"=="1" goto run_audit
if "%~1"=="2" goto run_live
if "%~1"=="3" goto run_purge_only

echo ======================================================================
echo    PIPELINE ARCHIVAGE TELEGRAM -^> DRIVE
echo ======================================================================
echo.
echo   [1] 🔎 Mode AUDIT & SIMULATION
echo       (Compare avec le Drive et génère le rapport CSV sans rien télécharger)
echo.
echo   [2] ⚡ Mode EXÉCUTION RÉELLE COMPLÈTE
echo       (Purge les doublons identiques + télécharge 1 par 1 sur D:\ + purge TG)
echo.
echo   [3] 🧹 Mode PURGE DES DOUBLONS UNIQUEMENT
echo       (Supprime uniquement les messages Telegram déjà présents à l'identique sur D:\)
echo.
echo   [0] Retour au menu principal
echo.
echo ======================================================================
set /p "MODE=Votre choix [0-3]: "

if "%MODE%"=="1" goto run_audit
if "%MODE%"=="2" goto run_live
if "%MODE%"=="3" goto run_purge_only
exit /b 0

:run_audit
echo.
echo [*] Lancement du mode AUDIT & SIMULATION...
!PY_CMD! "%~dp0telegram_to_drive_pipeline.py"
echo.
pause
exit /b 0

:run_live
echo.
echo ======================================================================
echo  [!] ATTENTION : MODE EXÉCUTION RÉELLE COMPLÈTE
echo      • Les doublons 100%% identiques sur D:\ seront purgés de Telegram.
echo      • Les nouveaux tomes seront téléchargés 1 par 1 sur D:\.
echo      • Chaque tome validé sera purgé de Telegram (zéro perte).
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

:run_purge_only
echo.
echo ======================================================================
echo  [!] PURGE DES DOUBLONS IDENTIQUES SUR TELEGRAM
echo      Les messages Telegram correspondant à des tomes déjà présents
echo      avec une taille identique sur votre Drive vont être supprimés.
echo      Aucun nouveau tome ne sera téléchargé dans ce mode.
echo ======================================================================
echo.
set /p "CONFIRM=Confirmez-vous la purge des doublons ? (tapez OUI) : "
if /i "!CONFIRM!"=="OUI" (
    !PY_CMD! "%~dp0telegram_to_drive_pipeline.py" --purge-identical-only
) else (
    echo Annulé.
)
echo.
pause
exit /b 0
