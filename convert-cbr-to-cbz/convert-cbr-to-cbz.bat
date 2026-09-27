@echo off
setlocal
title CBR to CBZ Converter

echo.
choice /c YN /m "Do you want to delete original .cbr files after conversion? (Y/N)"
set "DEL_OPT="
if errorlevel 2 (
    set "DEL_OPT="
) else (
    set "DEL_OPT=-DeleteOriginal"
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0convert-cbr-to-cbz.ps1" %DEL_OPT% %*

if errorlevel 1 (
    echo.
    echo [ERROR] Conversion encountered errors.
)

echo.
pause
