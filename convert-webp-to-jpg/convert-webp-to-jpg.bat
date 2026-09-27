@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: Récupère le dossier contenant ce script
set "SOURCE_FOLDER=%~dp0"
cd /d "%SOURCE_FOLDER%"

echo Conversion des fichiers .webp en .jpg dans : "%SOURCE_FOLDER%"
echo.

:: Demande à l'utilisateur s'il veut supprimer les fichiers .webp après conversion
choice /c ON /m "Souhaites-tu supprimer les fichiers .webp après conversion ? (O/N)"
if errorlevel 2 (
    set "DELETE_ORIGINAL=false"
) else (
    set "DELETE_ORIGINAL=true"
)
echo.

:: Boucle sur tous les fichiers .webp dans le dossier
for %%f in (*.webp) do (
    echo Conversion de "%%f" en "%%~nf.jpg"...
    magick "%%f" "%%~nf.jpg"

    if exist "%%~nf.jpg" (
        echo ✅ Conversion réussie : "%%~nf.jpg"

        if "!DELETE_ORIGINAL!"=="true" (
            del "%%f"
            echo 🗑️  Fichier original "%%f" supprimé.
        ) else (
            echo 📂 Fichier original "%%f" conservé.
        )
    ) else (
        echo ❌ Erreur : le fichier "%%~nf.jpg" n’a pas été créé.
    )
    echo.
)

echo Conversion terminée.
pause
