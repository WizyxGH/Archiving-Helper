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
set "MSG_TITLE=Archiving Helper - WebP to JPG Conversion"
set "MSG_HEADER=  🖼️ WEBP TO JPG CONVERSION (IMAGEMAGICK)"
set "MSG_MAGICK_ERR=[ERROR] ImageMagick is not installed or not in PATH."
set "MSG_MAGICK_URL=Please install ImageMagick from https://imagemagick.org/"
set "MSG_DEL_CHOICE=YN"
set "MSG_DEL_PROMPT=Delete original .webp files after conversion? (Y/N)"
set "MSG_PROMPT=Drag-and-drop WebP folder or file [Enter for current directory]:"
set "MSG_COMPLETE=Conversion completed successfully!"
goto init_done

:init_fr
set "MSG_TITLE=Archiving Helper - Conversion WebP vers JPG"
set "MSG_HEADER=  🖼️ CONVERSION WEBP VERS JPG (IMAGEMAGICK)"
set "MSG_MAGICK_ERR=[ERREUR] ImageMagick n'est pas installe ou n'est pas dans le PATH."
set "MSG_MAGICK_URL=Veuillez installer ImageMagick depuis https://imagemagick.org/"
set "MSG_DEL_CHOICE=ON"
set "MSG_DEL_PROMPT=Supprimer les fichiers .webp originaux apres conversion ? (O/N)"
set "MSG_PROMPT=Glissez-deposez le dossier ou fichier WebP [Entree pour dossier courant] :"
set "MSG_COMPLETE=Conversion terminee avec succes !"
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

echo.
choice /c !MSG_DEL_CHOICE! /m "!MSG_DEL_PROMPT!"
if errorlevel 2 (
    set "DELETE_ORIGINAL=false"
) else (
    set "DELETE_ORIGINAL=true"
)
echo.

if "%~1"=="" (
    echo !MSG_PROMPT!
    set /p "TARGET_INPUT="
    if "!TARGET_INPUT!"=="" set "TARGET_INPUT=%CD%"
    set "TARGET_INPUT=!TARGET_INPUT:"=!"
    if exist "!TARGET_INPUT!\*" (
        call :convert_dir "!TARGET_INPUT!"
    ) else (
        call :convert_file "!TARGET_INPUT!"
    )
) else (
    for %%A in (%*) do (
        set "ITEM=%%~fA"
        set "ITEM=!ITEM:"=!"
        if exist "!ITEM!\*" (
            call :convert_dir "!ITEM!"
        ) else (
            call :convert_file "!ITEM!"
        )
    )
)

echo.
echo ===========================================
echo   !MSG_COMPLETE!
echo ===========================================
echo.
pause
exit /b 0

:convert_dir
set "DIR_PATH=%~1"
echo [INFO] Converting all WebP files in: "%DIR_PATH%"
pushd "%DIR_PATH%"
set /a count=0
for %%f in (*.webp) do (
    set /a count+=1
    echo [CONVERTING] "%%f" -^> "%%~nf.jpg"
    magick "%%f" -quality 95 "%%~nf.jpg"
    if exist "%%~nf.jpg" (
        if "!DELETE_ORIGINAL!"=="true" del "%%f"
    ) else (
        echo [ERROR] Failed to convert: "%%f"
    )
)
if %count% equ 0 echo [INFO] No .webp files found in this directory.
if %count% gtr 0 echo [SUCCESS] %count% files processed.
popd
exit /b

:convert_file
set "FILE_PATH=%~1"
if /i not "%~x1"==".webp" (
    echo [SKIP] Not a WebP file: "%FILE_PATH%"
    exit /b
)
set "OUT_FILE=%~dpn1.jpg"
echo [CONVERTING] "%FILE_PATH%" -^> "%OUT_FILE%"
magick "%FILE_PATH%" -quality 95 "%OUT_FILE%"
if exist "%OUT_FILE%" (
    echo [SUCCESS] Created: "%OUT_FILE%"
    if "!DELETE_ORIGINAL!"=="true" del "%FILE_PATH%"
) else (
    echo [ERROR] Failed to convert: "%FILE_PATH%"
)
exit /b
