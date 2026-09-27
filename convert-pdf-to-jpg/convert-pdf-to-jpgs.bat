@echo off
setlocal enabledelayedexpansion
title Lossless PDF to JPG Extraction

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js [v18 or higher] from https://nodejs.org/
    pause
    exit /b 1
)

if "%~1"=="" (
    echo Enter a PDF file or folder path [or drag and drop files onto this script]:
    set /p "TARGET_INPUT="
    if not defined TARGET_INPUT (
        echo.
        echo Available CLI options:
        echo   --output-dir  ^<folder^>        Output folder for JPGs
        echo   --output-name ^<template^>      Filename template, e.g.: {name}_{page:03d}
        echo   --archive     cbr^|cbz         Create a CBR or CBZ archive after extraction
        echo   --keep-jpgs                    Keep JPG folder after archiving
        echo   --workers     ^<count^>        Parallel workers count [1-32]
        pause
        exit /b 2
    )
    node "%~dp0pdf-to-jpg.mjs" "!TARGET_INPUT!"
) else (
    node "%~dp0pdf-to-jpg.mjs" %*
)

if errorlevel 1 (
    echo.
    echo [ERROR] Extraction finished with errors.
    pause
    exit /b 1
)

echo.
pause
