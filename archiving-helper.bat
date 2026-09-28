@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Archiving Helper - Complete Comic & Document Suite

:menu
cls
echo ======================================================================
echo                     📦 ARCHIVING HELPER SUITE
echo ======================================================================
echo.
echo   [1] Convertir PDF en JPG / CBZ / CBR (Extraction lossless)
echo   [2] Convertir CBR en CBZ (Repack rapide)
echo   [3] Convertir WebP en JPG (ImageMagick)
echo   [4] Assembler des Images en PDF (Tri naturel)
echo   [5] Extraire des Archives (CBR, CBZ, ZIP, RAR, 7Z)
echo.
echo   ─── Modules de Téléchargement ^& Pipeline BD ───────────────────────
echo   [6] Téléchargement Multi-sources (Aria2c, Debriders, 1fichier, DLC)
echo   [7] Téléchargement Web Comic (Comic Viewer HD -^> CBR)
echo   [8] Scraper ^& Téléchargeur Blogspot (Albums -^> CBR / Liens)
echo   [9] Réparer ^& Désanonymiser des BDs (Nomenclature Inducks)
echo   [10] Pipeline Archivage Telegram (1 par 1 vers Drive ^& Audit)
echo.
echo   ─── Maintenance ──────────────────────────────────────────────────
echo   [11] Lancer les Tests Unitaires
echo   [0]  Quitter
echo.
echo ======================================================================
set /p "CHOICE=Choisissez une option [0-11]: "

if "%CHOICE%"=="1" goto pdf_to_jpg
if "%CHOICE%"=="2" goto cbr_to_cbz
if "%CHOICE%"=="3" goto webp_to_jpg
if "%CHOICE%"=="4" goto images_to_pdf
if "%CHOICE%"=="5" goto extract_archives
if "%CHOICE%"=="6" goto download_files
if "%CHOICE%"=="7" goto web_comic
if "%CHOICE%"=="8" goto blogspot_comic
if "%CHOICE%"=="9" goto repair_cbr
if "%CHOICE%"=="10" goto telegram_pipeline
if "%CHOICE%"=="11" goto run_tests
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

:web_comic
cls
echo ======================================================================
echo   TÉLÉCHARGEMENT COMIC VIEWER (HD LOSSLESS -^> CBR)
echo ======================================================================
echo.
set /p "BOOK_URI=Lien ou URI du tome (ex: Alben/UltimatePhantomias48.cbr) : "
if "%BOOK_URI%"=="" goto menu
echo.
node "%~dp0download-files\download_web_comic.mjs" "%BOOK_URI%"
echo.
pause
goto menu

:blogspot_comic
cls
echo ======================================================================
echo   SCRAPER & TÉLÉCHARGEUR BLOGSPOT / BLOGGER
echo ======================================================================
echo.
set /p "BLOG_URL=URL de l'article ou du blog Blogspot : "
if "%BLOG_URL%"=="" goto menu
echo.
node "%~dp0download-files\download_blogspot.mjs" "%BLOG_URL%"
echo.
pause
goto menu

:repair_cbr
cls
echo ======================================================================
echo   RÉPARATION ET DÉSANONYMISATION CBR
echo ======================================================================
echo.
set /p "TARGET_PATH=Glissez-déposez le fichier ou dossier : "
if "%TARGET_PATH%"=="" goto menu
set "TARGET_PATH=%TARGET_PATH:"=%"
echo.
node "%~dp0download-files\repair_and_repack_cbr.mjs" "%TARGET_PATH%"
echo.
pause
goto menu

:telegram_pipeline
cls
call "%~dp0download-files\telegram_to_drive.bat"
goto menu

:run_tests
cls
echo [INFO] Exécution des tests unitaires...
cd /d "%~dp0convert-pdf-to-jpg\package"
call npm test
pause
cd /d "%~dp0"
goto menu

:exit_app
exit /b 0
