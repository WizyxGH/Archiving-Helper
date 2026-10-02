@echo off
chcp 65001 >nul
title Archiving Helper
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js is required but was not found in PATH.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

if not exist "%~dp0node_modules\adm-zip\package.json" (
    where npm >nul 2>nul
    if errorlevel 1 (
        echo [ERROR] npm is required to install the missing project dependencies.
        pause
        exit /b 1
    )
    echo [*] Installing Archiving Helper dependencies...
    call npm install --prefix "%~dp0"
    if errorlevel 1 (
        echo [ERROR] Dependency installation failed.
        pause
        exit /b 1
    )
)

node "%~dp0src\cli\menu.mjs" %*
if errorlevel 1 pause
