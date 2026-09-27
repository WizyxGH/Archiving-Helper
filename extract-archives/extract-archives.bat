@echo off
setlocal enabledelayedexpansion

:: === Configuration ===
set "WINRAR_PATH=C:\Program Files\WinRAR\WinRAR.exe"
set "INPUT_FOLDER=C:\Users\starl\Documents\Disney comics\Scans\Germany\LTB 001-584 - filecrypt.cc"
set "EXTENSIONS=.cbr .cbz .zip .rar"

echo.
echo =============================
echo   Starting extraction
echo =============================
echo.

:: Change to target directory
cd /d "%INPUT_FOLDER%" || (
    echo Input folder not found.
    pause
    exit /b
)

:: Iterate through files
for %%F in (*.*) do (
    set "file=%%F"
    set "ext=%%~xF"
    set "ext=!ext:~1!"
    
    :: Check if extension is in allowed archives
    for %%E in (%EXTENSIONS%) do (
        if /I ".!ext!"=="%%E" (
            echo Extracting !file!...

            set "folderName=%%~nF"
            mkdir "!folderName!" >nul 2>&1

            "%WINRAR_PATH%" x -idq -y "%%F" ".\!folderName!\" >nul

            if exist ".\!folderName!\" (
                call :flatten ".\!folderName!"
                call :count_files ".\!folderName!"
            ) else (
                echo [ERROR] Extraction failed: !file!
            )
        )
    )
)

echo.
echo Extraction complete. Press any key to exit...
pause
exit /b

:: === FLATTEN function to simplify nested directory structure ===
:flatten
set "target=%~1"

:flatten_loop
set "subfolder="
set "filecount=0"
set "foldercount=0"

for %%F in ("%target%\*") do (
    if not "%%~aF"=="d" set /a filecount+=1
)

for /d %%D in ("%target%\*") do (
    set /a foldercount+=1
    set "subfolder=%%~fD"
)

if "%filecount%"=="0" if "%foldercount%"=="1" (
    echo Flattening: !subfolder! into !target!

    if /I not "!subfolder!"=="!target!" (
        for /f "delims=" %%F in ('dir /b /a "%subfolder%"') do (
            move /Y "!subfolder!\%%F" "!target!\">nul
        )
        rd /S /Q "!subfolder!"
        goto :flatten_loop
    )
)

exit /b

:: === COUNT_FILES function to count files in final directory ===
:count_files
set "target=%~1"
set "finalcount=0"

for /f %%C in ('dir /a-d /b /s "%target%" ^| find /c /v ""') do set finalcount=%%C

echo File count in !target!: !finalcount!

exit /b
