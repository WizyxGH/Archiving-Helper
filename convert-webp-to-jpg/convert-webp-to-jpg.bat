@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title WebP to JPG Conversion

where magick >nul 2>nul
if errorlevel 1 (
    echo [ERROR] ImageMagick is not installed or not in PATH.
    echo Please install ImageMagick from https://imagemagick.org/
    pause
    exit /b 1
)

:: Prompt for deletion preference
echo.
choice /c YN /m "Do you want to delete original .webp files after conversion? (Y/N)"
if errorlevel 2 (
    set "DELETE_ORIGINAL=false"
) else (
    set "DELETE_ORIGINAL=true"
)
echo.

if "%~1"=="" (
    call :convert_dir "%CD%"
) else (
    for %%A in (%*) do (
        if exist "%%~fA\*" (
            call :convert_dir "%%~fA"
        ) else (
            call :convert_file "%%~fA"
        )
    )
)

echo.
echo ===========================================
echo   Conversion complete.
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
    echo [CONVERTING] "%%f" -> "%%~nf.jpg"
    magick "%%f" -quality 95 "%%~nf.jpg"
    if exist "%%~nf.jpg" (
        if "!DELETE_ORIGINAL!"=="true" del "%%f"
    ) else (
        echo [ERROR] Failed to convert: "%%f"
    )
)
if %count% equ 0 (
    echo [INFO] No .webp files found in this directory.
) else (
    echo [SUCCESS] %count% file(s) processed.
)
popd
exit /b

:convert_file
set "FILE_PATH=%~1"
if /i not "%~x1"==".webp" (
    echo [SKIP] Not a WebP file: "%FILE_PATH%"
    exit /b
)
set "OUT_FILE=%~dpn1.jpg"
echo [CONVERTING] "%FILE_PATH%" -> "%OUT_FILE%"
magick "%FILE_PATH%" -quality 95 "%OUT_FILE%"
if exist "%OUT_FILE%" (
    echo [SUCCESS] Created "%OUT_FILE%"
    if "!DELETE_ORIGINAL!"=="true" del "%FILE_PATH%"
) else (
    echo [ERROR] Failed to convert: "%FILE_PATH%"
)
exit /b
