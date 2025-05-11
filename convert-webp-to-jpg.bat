@echo off
setlocal enabledelayedexpansion

set "SOURCE_FOLDER=C:\Users\starl\Downloads\test"

echo Conversion des fichiers .webp en .jpg dans : %SOURCE_FOLDER%
cd /d "%SOURCE_FOLDER%"

:: Demande à l'utilisateur s'il veut supprimer les fichiers .webp après conversion
choice /c ON /m "Souhaites-tu supprimer les fichiers .webp après conversion ? (O/N)"
if errorlevel 2 (
    set "DELETE_ORIGINAL=false"
) else (
    set "DELETE_ORIGINAL=true"
)

for %%f in (*.webp) do (
    echo.
    echo Conversion de "%%f" en "%%~nf.jpg"...
    magick "%%f" "%%~nf.jpg"

    if "!DELETE_ORIGINAL!"=="true" (
        del "%%f"
        echo Fichier "%%f" supprimé.
    ) else (
        echo Fichier "%%f" conservé.
    )
)

echo.
echo Conversion terminée.
pause
