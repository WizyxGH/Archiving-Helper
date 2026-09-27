@echo off
setlocal
title Extraction optimisee PDF vers JPG

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js n'est pas installe ou pas dans le PATH.
    pause
    exit /b 1
)

if "%~1"=="" (
    echo Glissez un fichier PDF sur ce script.
    pause
    exit /b 2
)

node "%~dp0pdf-to-jpg.mjs" %*
if errorlevel 1 (
    echo.
    echo Echec de l'extraction.
    pause
    exit /b 1
)

echo.
pause
