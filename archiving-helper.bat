@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Archiving Helper - Unified Suite

:: === Check if files were dropped directly onto archiving-helper.bat ===
if not "%~1"=="" (
    set "FIRST_EXT=%~x1"
    if /i "!FIRST_EXT!"==".pdf" goto dropped_pdf
    if /i "!FIRST_EXT!"==".cbr" goto dropped_cbr
    if /i "!FIRST_EXT!"==".webp" goto dropped_webp
    if /i "!FIRST_EXT!"==".cbz" goto dropped_archive
    if /i "!FIRST_EXT!"==".zip" goto dropped_archive
    if /i "!FIRST_EXT!"==".rar" goto dropped_archive
    if /i "!FIRST_EXT!"==".7z" goto dropped_archive
    if exist "%~1\*" goto dropped_folder
)

:menu
cls
echo ========================================================
echo               📦 ARCHIVING HELPER SUITE
echo ========================================================
echo.
echo   [1] Convert PDF to JPG / CBZ / CBR (Lossless extraction)
echo   [2] Convert CBR to CBZ (Lossless repack)
echo   [3] Convert WebP to JPG (ImageMagick)
echo   [4] Assemble Images to PDF (Natural page ordering)
echo   [5] Extract Archives (CBR, CBZ, ZIP, RAR, 7Z)
echo   [6] Run Core Unit Tests
echo   [0] Exit
echo.
echo ========================================================
set "CHOICE="
set /p "CHOICE=Select an option [0-6]: "

if "%CHOICE%"=="1" goto pdf_to_jpg
if "%CHOICE%"=="2" goto cbr_to_cbz
if "%CHOICE%"=="3" goto webp_to_jpg
if "%CHOICE%"=="4" goto images_to_pdf
if "%CHOICE%"=="5" goto extract_archives
if "%CHOICE%"=="6" goto run_tests
if "%CHOICE%"=="0" goto exit_app
goto menu

:: ─── 1. PDF to JPG / CBZ ───────────────────────────────────────────────────
:pdf_to_jpg
cls
echo ========================================================
echo   [1] PDF to JPG / CBZ / CBR (Lossless Extraction)
echo ========================================================
echo.
echo Drag and drop a PDF file or folder here, or paste path:
echo (or press Enter to return to menu)
set "PDF_INPUT="
set /p "PDF_INPUT=> "
if not defined PDF_INPUT goto menu
set "PDF_INPUT=!PDF_INPUT:"=!"
if not exist "!PDF_INPUT!" (
    echo [ERROR] File or folder not found: "!PDF_INPUT!"
    pause
    goto pdf_to_jpg
)

echo.
echo Output format:
echo   [1] JPG folder only (default)
echo   [2] CBZ comic archive (ZIP)
echo   [3] CBR comic archive (WinRAR)
set "FMT_CHOICE=1"
set /p "FMT_CHOICE=Select output format [1-3, default 1]: "

set "ARCHIVE_OPT="
if "%FMT_CHOICE%"=="2" set "ARCHIVE_OPT=--archive cbz"
if "%FMT_CHOICE%"=="3" set "ARCHIVE_OPT=--archive cbr"

echo.
node "%~dp0convert-pdf-to-jpg\pdf-to-jpg.mjs" "!PDF_INPUT!" !ARCHIVE_OPT!
echo.
pause
goto menu

:: ─── 2. CBR to CBZ ─────────────────────────────────────────────────────────
:cbr_to_cbz
cls
echo ========================================================
echo   [2] CBR to CBZ (Lossless Repack)
echo ========================================================
echo.
echo Drag and drop a .cbr file or folder here, or paste path:
echo (or press Enter to return to menu)
set "CBR_INPUT="
set /p "CBR_INPUT=> "
if not defined CBR_INPUT goto menu
set "CBR_INPUT=!CBR_INPUT:"=!"
if not exist "!CBR_INPUT!" (
    echo [ERROR] File or folder not found: "!CBR_INPUT!"
    pause
    goto cbr_to_cbz
)

echo.
choice /c YN /m "Delete original .cbr after conversion? (Y/N)"
set "DEL_OPT="
if errorlevel 2 (set "DEL_OPT=") else (set "DEL_OPT=-DeleteOriginal")

echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0convert-cbr-to-cbz\convert-cbr-to-cbz.ps1" !DEL_OPT! "!CBR_INPUT!"
echo.
pause
goto menu

:: ─── 3. WebP to JPG ────────────────────────────────────────────────────────
:webp_to_jpg
cls
echo ========================================================
echo   [3] WebP to JPG Conversion
echo ========================================================
echo.
echo Drag and drop a .webp file or folder here, or paste path:
echo (or press Enter to return to menu)
set "WEBP_INPUT="
set /p "WEBP_INPUT=> "
if not defined WEBP_INPUT goto menu
set "WEBP_INPUT=!WEBP_INPUT:"=!"
if not exist "!WEBP_INPUT!" (
    echo [ERROR] File or folder not found: "!WEBP_INPUT!"
    pause
    goto webp_to_jpg
)

echo.
call "%~dp0convert-webp-to-jpg\convert-webp-to-jpg.bat" "!WEBP_INPUT!"
goto menu

:: ─── 4. Images to PDF ──────────────────────────────────────────────────────
:images_to_pdf
cls
echo ========================================================
echo   [4] Assemble Images to PDF (Natural Sorting)
echo ========================================================
echo.
echo Drag and drop the folder containing images here:
echo (or press Enter to return to menu)
set "IMG_INPUT="
set /p "IMG_INPUT=> "
if not defined IMG_INPUT goto menu
set "IMG_INPUT=!IMG_INPUT:"=!"
if not exist "!IMG_INPUT!" (
    echo [ERROR] Folder not found: "!IMG_INPUT!"
    pause
    goto images_to_pdf
)

echo.
call "%~dp0images-to-pdf\images-to-pdf.bat" "!IMG_INPUT!"
goto menu

:: ─── 5. Extract Archives ───────────────────────────────────────────────────
:extract_archives
cls
echo ========================================================
echo   [5] Extract Archives (CBR, CBZ, ZIP, RAR, 7Z)
echo ========================================================
echo.
echo Drag and drop an archive file or folder here:
echo (or press Enter to return to menu)
set "EXT_INPUT="
set /p "EXT_INPUT=> "
if not defined EXT_INPUT goto menu
set "EXT_INPUT=!EXT_INPUT:"=!"
if not exist "!EXT_INPUT!" (
    echo [ERROR] File or folder not found: "!EXT_INPUT!"
    pause
    goto extract_archives
)

echo.
call "%~dp0extract-archives\extract-archives.bat" "!EXT_INPUT!"
goto menu

:: ─── 6. Run Unit Tests ─────────────────────────────────────────────────────
:run_tests
cls
echo ========================================================
echo   [6] Running Package Unit Tests
echo ========================================================
echo.
cd /d "%~dp0convert-pdf-to-jpg\package"
call npm test
cd /d "%~dp0"
echo.
pause
goto menu

:: ─── Drag & Drop Handlers ──────────────────────────────────────────────────
:dropped_pdf
call "%~dp0convert-pdf-to-jpg\convert-pdf-to-jpgs.bat" %*
exit /b 0

:dropped_cbr
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0convert-cbr-to-cbz\convert-cbr-to-cbz.ps1" %*
pause
exit /b 0

:dropped_webp
call "%~dp0convert-webp-to-jpg\convert-webp-to-jpg.bat" %*
exit /b 0

:dropped_archive
call "%~dp0extract-archives\extract-archives.bat" %*
exit /b 0

:dropped_folder
echo Dropped folder: "%~1"
goto menu

:exit_app
exit /b 0
