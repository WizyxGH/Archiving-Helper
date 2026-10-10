@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: Détection automatique de la langue (FR / EN)
set "APP_LANG=en"
for /f "tokens=3" %%A in ('reg query "HKCU\Control Panel\International" /v LocaleName 2^>nul') do (
    set "LOC_VAL=%%A"
    if /i "!LOC_VAL:~0,2!"=="fr" set "APP_LANG=fr"
)
if defined LANGUAGE (
    if /i "!LANGUAGE:~0,2!"=="fr" set "APP_LANG=fr"
    if /i "!LANGUAGE:~0,2!"=="en" set "APP_LANG=en"
)

title Archiving Helper
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    if "!APP_LANG!"=="fr" (
        echo [ERREUR] Node.js est requis mais introuvable dans le PATH.
        echo Veuillez installer Node.js depuis https://nodejs.org/
    ) else (
        echo [ERROR] Node.js is required but was not found in PATH.
        echo Please install Node.js from https://nodejs.org/
    )
    pause
    exit /b 1
)

if not exist "%~dp0node_modules\adm-zip\package.json" (
    where npm >nul 2>nul
    if errorlevel 1 (
        if "!APP_LANG!"=="fr" (
            echo [ERREUR] npm est requis pour installer les dépendances du projet.
        ) else (
            echo [ERROR] npm is required to install the missing project dependencies.
        )
        pause
        exit /b 1
    )
    if "!APP_LANG!"=="fr" (
        echo [*] Installation des dépendances d'Archiving Helper...
    ) else (
        echo [*] Installing Archiving Helper dependencies...
    )
    call npm install --prefix "%~dp0"
    if errorlevel 1 (
        if "!APP_LANG!"=="fr" (
            echo [ERREUR] L'installation des dépendances a échoué.
        ) else (
            echo [ERROR] Dependency installation failed.
        )
        pause
        exit /b 1
    )
)

node "%~dp0src\cli\menu.mjs" %*
if errorlevel 1 pause
