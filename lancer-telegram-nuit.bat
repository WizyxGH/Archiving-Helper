@echo off
chcp 65001 >nul
title Archiving Helper - Telegram vers D:
cd /d "%~dp0"
set "PY=C:\Users\starl\AppData\Local\Programs\Python\Python312\python.exe"

echo ======================================================================
echo   TELEGRAM -> D:\Duckburg Archives
echo ======================================================================
echo.
echo   Mode AUDIT (simulation, rien n'est ecrit) : appendre 1
echo   Mode LIVE + purge des doublons Telegram   : appendre 2
echo   Mode LIVE sans purge (recommande)          : appendre 3
echo.
set /p "MODE=Votre choix : "

if "%MODE%"=="1" goto audit
if "%MODE%"=="2" goto live_purge
if "%MODE%"=="3" goto live_safe
echo Choix non reconnu.
pause
exit /b 0

:audit
echo.
%PY% "%~dp0download-files\telegram_to_drive_pipeline.py" --limit 20
pause
exit /b 0

:live_safe
echo.
echo [!] TELECHARGE SANS RIEN SUPPRIMER SUR TELEGRAM
echo     Le message Telegram n'est conserve que si le tome a bien ete depose.
echo.
set /p "CONF=Confirmez-vous ? (OUI) : "
if /i "%CONF%"=="OUI" (
    %PY% "%~dp0download-files\telegram_to_drive_pipeline.py" --run --no-purge
) else (
    echo Annule.
)
pause
exit /b 0

:live_purge
echo.
echo ======================================================================
echo  [!] MODE DANGEREUX
echo      Les doublons deja presents sur le disque avec une taille
echo      identique seront SUPPRIMES de Telegram.
echo      Assurez-vous que votre synchronisation est a jour.
echo ======================================================================
echo.
set /p "CONF=Confirmez-vous ? (OUI) : "
if /i "%CONF%"=="OUI" (
    %PY% "%~dp0download-files\telegram_to_drive_pipeline.py" --run
) else (
    echo Annule.
)
pause
exit /b 0
