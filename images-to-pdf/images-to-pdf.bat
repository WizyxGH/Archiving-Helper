@echo off
setlocal enabledelayedexpansion
title Images to PDF

where magick >nul 2>nul
if errorlevel 1 (
    echo [ERROR] ImageMagick is not installed or not in PATH.
    echo Please install ImageMagick from https://imagemagick.org/
    pause
    exit /b 1
)

set "TARGET_DIR="
set "OUTPUT_PDF="

if "%~1"=="" (
    echo Enter the path of the folder containing images [or press Enter for current directory]:
    set /p "TARGET_DIR="
    if not defined TARGET_DIR set "TARGET_DIR=%CD%"
) else (
    if exist "%~1\*" (
        set "TARGET_DIR=%~f1"
    ) else (
        set "TARGET_DIR=%~dp1"
    )
)

if not exist "%TARGET_DIR%" (
    echo [ERROR] Folder does not exist: "%TARGET_DIR%"
    pause
    exit /b 1
)

echo [INFO] Processing images in: "%TARGET_DIR%"

:: Run PowerShell script for natural sorting and direct assembly via ImageMagick
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference = 'Stop';" ^
    "$dir = '%TARGET_DIR%';" ^
    "$exts = @('.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.webp');" ^
    "$files = Get-ChildItem -LiteralPath $dir -File | Where-Object { $exts -contains $_.Extension.ToLower() } | Sort-Object { [regex]::Replace($_.Name, '\d+', { $args[0].Value.PadLeft(20, '0') }) };" ^
    "if ($files.Count -eq 0) { Write-Host '[ERROR] No supported images found.' -ForegroundColor Red; exit 2; }" ^
    "Write-Host ('[INFO] Found {0} image(s). Assembling into PDF...' -f $files.Count);" ^
    "$listFile = [System.IO.Path]::GetTempFileName();" ^
    "try {" ^
    "  $files | ForEach-Object { Add-Content -LiteralPath $listFile -Value ('`\"{0}`\"' -f $_.FullName) };" ^
    "  $parentName = (Get-Item -LiteralPath $dir).Name;" ^
    "  $outPdf = Join-Path $dir ('{0}.pdf' -f $parentName);" ^
    "  Write-Host ('[INFO] Output PDF: {0}' -f $outPdf);" ^
    "  $proc = Start-Process -FilePath 'magick' -ArgumentList ('@{0}' -f $listFile), ('`\"{0}`\"' -f $outPdf) -NoNewWindow -PassThru -Wait;" ^
    "  if ($proc.ExitCode -ne 0) { throw ('ImageMagick exited with code {0}' -f $proc.ExitCode) }" ^
    "  Write-Host ('[SUCCESS] PDF created successfully: {0} ({1} pages)' -f $outPdf, $files.Count) -ForegroundColor Green;" ^
    "} finally {" ^
    "  Remove-Item -LiteralPath $listFile -Force -ErrorAction SilentlyContinue;" ^
    "}"

if errorlevel 1 (
    echo.
    echo [ERROR] PDF generation failed.
)

echo.
pause
