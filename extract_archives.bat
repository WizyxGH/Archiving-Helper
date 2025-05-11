@echo off
setlocal enabledelayedexpansion

:: === Configuration ===
set "WINRAR_PATH=C:\Program Files\WinRAR\WinRAR.exe"
set "INPUT_FOLDER=C:\Users\starl\Documents\Disney comics\Scans\Germany\LTB 001-584 - filecrypt.cc"
set "EXTENSIONS=.cbr .cbz .zip .rar"

echo.
echo =============================
echo   Début de l'extraction
echo =============================
echo.

:: Aller dans le dossier cible
cd /d "%INPUT_FOLDER%" || (
    echo Le dossier d'entrée est introuvable.
    pause
    exit /b
)

:: Parcourir les fichiers
for %%F in (*.*) do (
    set "file=%%F"
    set "ext=%%~xF"
    set "ext=!ext:~1!"
    
    :: Vérifie si l'extension fait partie des archives autorisées
    for %%E in (%EXTENSIONS%) do (
        if /I ".!ext!"=="%%E" (
            echo Extraction de !file!...

            set "folderName=%%~nF"
            mkdir "!folderName!" >nul 2>&1

            "%WINRAR_PATH%" x -idq -y "%%F" ".\!folderName!\" >nul

            if exist ".\!folderName!\" (
                call :flatten ".\!folderName!"
                call :count_files ".\!folderName!"
            ) else (
                echo [ERREUR] Extraction échouée : !file!
            )
        )
    )
)

echo.
echo Extraction terminée. Appuyez sur une touche pour fermer...
pause
exit /b

:: === Fonction FLATTEN pour simplifier la structure ===
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
    echo Réduction : !subfolder! vers !target!

    if /I not "!subfolder!"=="!target!" (
        for /f "delims=" %%F in ('dir /b /a "%subfolder%"') do (
            move /Y "!subfolder!\%%F" "!target!\">nul
        )
        rd /S /Q "!subfolder!"
        goto :flatten_loop
    )
)

exit /b

:: === Fonction COUNT_FILES pour compter les fichiers dans le dossier final ===
:count_files
set "target=%~1"
set "finalcount=0"

for /f %%C in ('dir /a-d /b /s "%target%" ^| find /c /v ""') do set finalcount=%%C

echo Nombre de fichiers dans !target! : !finalcount!

exit /b
