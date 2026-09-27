@echo off
setlocal
title Lossless PDF to JPG Extraction

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is not installed or not in PATH.
    pause
    exit /b 1
)

if "%~1"=="" (
    echo Drag and drop a PDF file onto this script.
    echo.
    echo Available CLI options:
    echo   --output-dir  ^<folder^>        Output folder for JPGs
    echo   --output-name ^<template^>      Filename template, e.g.: {name}_{page:03d}
    echo   --archive     cbr^|cbz         Create a CBR or CBZ archive after extraction
    echo   --keep-jpgs                    Keep JPG folder after archiving
    echo   --workers     ^<count^>        Parallel workers count (1-32)
    pause
    exit /b 2
)

node "%~dp0pdf-to-jpg.mjs" %*
if errorlevel 1 (
    echo.
    echo Extraction failed.
    pause
    exit /b 1
)

echo.
pause
