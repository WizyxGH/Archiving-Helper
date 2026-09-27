@echo off
setlocal
title PDF to JPG extraction

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is not installed or not in PATH.
    pause
    exit /b 1
)

if "%~1"=="" (
    echo Drop a PDF file onto this script to convert it.
    echo.
    echo Command-line options:
    echo   --output-dir  ^<folder^>      Output folder for JPGs
    echo   --output-name ^<template^>    File naming template, e.g. {name}_{page:03d}
    echo   --archive     cbr^|cbz       Pack JPGs into a CBR or CBZ archive after extraction
    echo   --keep-jpgs                   Keep the JPG folder after archiving
    echo   --workers     ^<count^>       Parallel workers (1-32)
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
