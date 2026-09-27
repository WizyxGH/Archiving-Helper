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
    echo.
    echo Options disponibles (en ligne de commande) :
    echo   --output-dir  ^<dossier^>      Dossier de sortie des JPGs
    echo   --output-name ^<template^>     Nom des fichiers, ex: {name}_{page:03d}
    echo   --archive     cbr^|cbz        Creer une archive CBR ou CBZ apres extraction
    echo   --keep-jpgs                   Conserver le dossier JPG apres archivage
    echo   --workers     ^<nombre^>       Workers paralleles (1-32)
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
