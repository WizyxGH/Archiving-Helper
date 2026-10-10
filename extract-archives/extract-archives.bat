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
set "MSG_TITLE=Archiving Helper - Archive Extraction"
set "MSG_HEADER=  📂 EXTRACT AND FLATTEN ARCHIVES (CBR, CBZ, RAR, ZIP)"
set "MSG_ERR_NO_EXTRACTOR=[ERROR] No supported extractor found. Please install WinRAR or 7-Zip."
set "MSG_PROMPT=Drag-and-drop folder containing archives [Enter for current directory]:"
set "MSG_COMPLETE=Extraction completed successfully!"
goto init_done

:init_fr
set "MSG_TITLE=Archiving Helper - Extraction d'archives"
set "MSG_HEADER=  📂 EXTRACTION ET APLATISSEMENT D'ARCHIVES (CBR, CBZ, RAR, ZIP)"
set "MSG_ERR_NO_EXTRACTOR=[ERREUR] Aucun utilitaire d'extraction supporte trouve. Veuillez installer WinRAR ou 7-Zip."
set "MSG_PROMPT=Glissez-deposez le dossier contenant les archives [Entree pour dossier courant] :"
set "MSG_COMPLETE=Extraction terminee avec succes !"
:init_done

title !MSG_TITLE!

echo ======================================================================
echo !MSG_HEADER!
echo ======================================================================
echo.

rem === Auto-detect extraction tool ===
set "EXTRACTOR="
set "EXTRACTOR_TYPE="

where 7z >nul 2>nul
if %errorlevel% equ 0 (
    set "EXTRACTOR=7z"
    set "EXTRACTOR_TYPE=7z"
)

if not defined EXTRACTOR (
    if exist "C:\Program Files\7-Zip\7z.exe" (
        set "EXTRACTOR=C:\Program Files\7-Zip\7z.exe"
        set "EXTRACTOR_TYPE=7z"
    ) else if exist "C:\Program Files (x86)\7-Zip\7z.exe" (
        set "EXTRACTOR=C:\Program Files (x86)\7-Zip\7z.exe"
        set "EXTRACTOR_TYPE=7z"
    )
)

if not defined EXTRACTOR (
    where winrar >nul 2>nul
    if %errorlevel% equ 0 (
        set "EXTRACTOR=winrar"
        set "EXTRACTOR_TYPE=winrar"
    )
)

if not defined EXTRACTOR (
    if exist "C:\Program Files\WinRAR\WinRAR.exe" (
        set "EXTRACTOR=C:\Program Files\WinRAR\WinRAR.exe"
        set "EXTRACTOR_TYPE=winrar"
    ) else if exist "C:\Program Files (x86)\WinRAR\WinRAR.exe" (
        set "EXTRACTOR=C:\Program Files (x86)\WinRAR\WinRAR.exe"
        set "EXTRACTOR_TYPE=winrar"
    )
)

if not defined EXTRACTOR (
    where tar >nul 2>nul
    if %errorlevel% equ 0 (
        set "EXTRACTOR=tar"
        set "EXTRACTOR_TYPE=tar"
    )
)

if not defined EXTRACTOR (
    echo !MSG_ERR_NO_EXTRACTOR!
    pause
    exit /b 1
)

echo [INFO] Extractor: %EXTRACTOR% (%EXTRACTOR_TYPE%)
echo.

rem === Target resolution ===
set "EXTENSIONS=.cbr .cbz .zip .rar .7z"

if "%~1"=="" (
    echo !MSG_PROMPT!
    set /p "TARGET_DIR="
    if not defined TARGET_DIR set "TARGET_DIR=%CD%"
    set "TARGET_DIR=!TARGET_DIR:"=!"
    call :process_directory "!TARGET_DIR!"
) else (
    for %%A in (%*) do (
        if exist "%%~fA\*" (
            call :process_directory "%%~fA"
        ) else (
            call :process_single_file "%%~fA"
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

:process_directory
set "DIR_PATH=%~1"
if not exist "%DIR_PATH%" (
    echo [ERROR] Folder not found: "%DIR_PATH%"
    exit /b
)
echo.
echo ===========================================
echo   Processing folder: "%DIR_PATH%"
echo ===========================================
echo.

pushd "%DIR_PATH%"
for %%F in (*.*) do (
    set "ext=%%~xF"
    for %%E in (%EXTENSIONS%) do (
        if /i "!ext!"=="%%E" (
            call :extract_archive "%%~fF" "%%~dpF" "%%~nF"
        )
    )
)
popd
exit /b

:process_single_file
set "FILE_PATH=%~1"
set "ext=%~x1"
for %%E in (%EXTENSIONS%) do (
    if /i "!ext!"=="%%E" (
        call :extract_archive "%FILE_PATH%" "%~dp1" "%~n1"
        exit /b
    )
)
echo [SKIP] Unsupported extension: "%FILE_PATH%"
exit /b

:extract_archive
set "ARCHIVE_FILE=%~1"
set "DEST_DIR=%~2%~3"
set "ARCHIVE_NAME=%~3"

echo -------------------------------------------
echo [EXTRACTING] %ARCHIVE_NAME%
mkdir "%DEST_DIR%" >nul 2>&1

if "%EXTRACTOR_TYPE%"=="winrar" (
    "%EXTRACTOR%" x -idq -y "%ARCHIVE_FILE%" "%DEST_DIR%\" >nul 2>&1
) else if "%EXTRACTOR_TYPE%"=="7z" (
    "%EXTRACTOR%" x -y -o"%DEST_DIR%" "%ARCHIVE_FILE%" >nul 2>&1
) else if "%EXTRACTOR_TYPE%"=="tar" (
    tar -xf "%ARCHIVE_FILE%" -C "%DEST_DIR%" >nul 2>&1
)

if exist "%DEST_DIR%\" (
    call :flatten "%DEST_DIR%"
    call :count_files "%DEST_DIR%"
) else (
    echo [ERROR] Extraction failed for: "%ARCHIVE_FILE%"
)
exit /b

:flatten
set "TARGET=%~1"

:flatten_loop
set "subfolder="
set /a filecount=0
set /a foldercount=0

for %%F in ("%TARGET%\*") do (
    if not "%%~aF"=="d" set /a filecount+=1
)

for /d %%D in ("%TARGET%\*") do (
    set /a foldercount+=1
    set "subfolder=%%~fD"
)

if %filecount% equ 0 if %foldercount% equ 1 (
    echo [FLATTEN] Moving contents from "!subfolder!" up to "!TARGET!"
    if /i not "!subfolder!"=="!TARGET!" (
        for /f "delims=" %%F in ('dir /b /a "%subfolder%"') do (
            move /y "!subfolder!\%%F" "!TARGET!\" >nul 2>&1
        )
        rd /s /q "!subfolder!" >nul 2>&1
        goto :flatten_loop
    )
)
exit /b

:count_files
set "TARGET=%~1"
set /a finalcount=0
for /f %%C in ('dir /a-d /b /s "%TARGET%" 2^>nul ^| find /c /v ""') do set "finalcount=%%C"
echo [SUCCESS] %finalcount% file(s) extracted into "%TARGET%"
exit /b
