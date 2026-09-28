@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Archiving Helper - Unified Suite

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
echo   [6] Download Files (Direct, Debrider, DLC & Web Viewer)
echo   [7] Repair & De-anonymize Comics (CBR / Multi-Part)
echo   [8] Run Core Unit Tests
echo   [0] Exit
echo.
echo ========================================================
set /p "CHOICE=Select an option [0-8]: "

if "%CHOICE%"=="1" goto pdf_to_jpg
if "%CHOICE%"=="2" goto cbr_to_cbz
if "%CHOICE%"=="3" goto webp_to_jpg
if "%CHOICE%"=="4" goto images_to_pdf
if "%CHOICE%"=="5" goto extract_archives
if "%CHOICE%"=="6" goto download_files
if "%CHOICE%"=="7" goto repair_cbr
if "%CHOICE%"=="8" goto run_tests
if "%CHOICE%"=="0" goto exit_app
goto menu

:pdf_to_jpg
cls
call "%~dp0convert-pdf-to-jpg\convert-pdf-to-jpgs.bat"
goto menu

:cbr_to_cbz
cls
call "%~dp0convert-cbr-to-cbz\convert-cbr-to-cbz.bat"
goto menu

:webp_to_jpg
cls
call "%~dp0convert-webp-to-jpg\convert-webp-to-jpg.bat"
goto menu

:images_to_pdf
cls
call "%~dp0images-to-pdf\images-to-pdf.bat"
goto menu

:extract_archives
cls
call "%~dp0extract-archives\extract-archives.bat"
goto menu

:download_files
cls
call "%~dp0download-files\download-files.bat"
goto menu

:repair_cbr
cls
call "%~dp0download-files\download-files.bat"
goto menu

:run_tests
cls
echo [INFO] Running package unit tests...
cd /d "%~dp0convert-pdf-to-jpg\package"
call npm test
pause
cd /d "%~dp0"
goto menu

:exit_app
exit /b 0
