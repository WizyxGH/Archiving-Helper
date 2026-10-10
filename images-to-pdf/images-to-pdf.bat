@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem Detection langue FR / EN
set "APP_LANG=en"
for /f "tokens=3" %%A in ('reg query "HKCU\Control Panel\International" /v LocaleName 2^>nul') do (
    set "LOC_VAL=%%A"
    if /i "!LOC_VAL:~0,2!"=="fr" set "APP_LANG=fr"
)
if defined LANGUAGE (
    if /i "!LANGUAGE:~0,2!"=="fr" set "APP_LANG=fr"
    if /i "!LANGUAGE:~0,2!"=="en" set "APP_LANG=en"
)

if "!APP_LANG!"=="fr" goto init_fr
:init_en
set "MSG_TITLE=Archiving Helper - Assemble Images into PDF"
set "MSG_HEADER=  📑 ASSEMBLE IMAGES INTO A PDF FILE (IMAGEMAGICK)"
set "MSG_MAGICK_ERR=[ERROR] ImageMagick is not installed or not in PATH."
set "MSG_MAGICK_URL=Please install ImageMagick from https://imagemagick.org/"
set "MSG_PROMPT=Drag-and-drop folder containing images [Enter for current directory]:"
set "MSG_NOT_FOUND=[ERROR] Folder does not exist:"
set "MSG_PROCESSING=[INFO] Processing images in:"
set "MSG_SUCCESS=[✓] PDF created successfully!"
set "MSG_ERROR=[!] PDF generation failed."
goto init_done

:init_fr
set "MSG_TITLE=Archiving Helper - Assembler des images en PDF"
set "MSG_HEADER=  📑 ASSEMBLER DES IMAGES EN UN FICHIER PDF (IMAGEMAGICK)"
set "MSG_MAGICK_ERR=[ERREUR] ImageMagick n'est pas installe ou n'est pas dans le PATH."
set "MSG_MAGICK_URL=Veuillez installer ImageMagick depuis https://imagemagick.org/"
set "MSG_PROMPT=Glissez-deposez le dossier contenant les images [Entree pour dossier courant] :"
set "MSG_NOT_FOUND=[ERREUR] Dossier introuvable :"
set "MSG_PROCESSING=[INFO] Traitement des images dans :"
set "MSG_SUCCESS=[✓] PDF cree avec succes !"
set "MSG_ERROR=[!] Echec de la creation du PDF."
:init_done

title !MSG_TITLE!

echo ======================================================================
echo !MSG_HEADER!
echo ======================================================================
echo.

where magick >nul 2>nul
if errorlevel 1 (
    echo !MSG_MAGICK_ERR!
    echo !MSG_MAGICK_URL!
    pause
    exit /b 1
)

set "TARGET_DIR="
set "OUTPUT_PDF="

if "%~1"=="" (
    echo !MSG_PROMPT!
    set /p "TARGET_DIR="
    if not defined TARGET_DIR set "TARGET_DIR=%CD%"
) else (
    if exist "%~1\*" (
        set "TARGET_DIR=%~f1"
    ) else (
        set "TARGET_DIR=%~dp1"
    )
)

set "TARGET_DIR=!TARGET_DIR:"=!"

if not exist "%TARGET_DIR%" (
    echo !MSG_NOT_FOUND! "%TARGET_DIR%"
    pause
    exit /b 1
)

echo !MSG_PROCESSING! "%TARGET_DIR%"

rem Run PowerShell script for natural sorting and direct assembly via ImageMagick
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
    "  Write-Host '[SUCCESS] PDF generated successfully!' -ForegroundColor Green;" ^
    "} finally {" ^
    "  if (Test-Path $listFile) { Remove-Item -LiteralPath $listFile -Force }" ^
    "}"

if errorlevel 1 (
    echo.
    echo !MSG_ERROR!
) else (
    echo.
    echo !MSG_SUCCESS!
)

echo.
pause
