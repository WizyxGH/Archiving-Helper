@echo off
title Conversion Images -> PDF

REM === Vérifie qu'ImageMagick est installé ===
where magick >nul 2>nul
if errorlevel 1 (
    echo ❌ ImageMagick n'est pas installe ou pas dans le PATH.
    pause
    exit /b
)

REM === Demande du dossier à l'utilisateur ===
echo Veuillez entrer le chemin du dossier contenant les images :
set /p input_folder=

if not exist "%input_folder%" (
    echo ❌ Le dossier n'existe pas !
    pause
    exit /b
)

REM === Nom du PDF final ===
set "output_pdf=result.pdf"

REM === Supprime le PDF existant pour éviter conflit ===
if exist "%output_pdf%" del "%output_pdf%"

REM === Liste des extensions autorisees ===
set "ext_list=jpg jpeg png bmp tiff webp"

REM === Compteur de fichiers ===
set count=0
set file_list=

echo.
echo 🔄 Conversion en cours...

REM === Boucle sur chaque image et creation de PDF temporaire ===
for %%e in (%ext_list%) do (
    for %%f in ("%input_folder%\*.%%e") do (
        if exist "%%f" (
            set /a count+=1
            echo Traitement !count! : %%~nxf
            magick "%%f" "temp_!count!.pdf"
            set "file_list=!file_list! temp_!count!.pdf"
        )
    )
)

REM === Verification qu'il y a au moins un fichier ===
if !count! EQU 0 (
    echo ❌ Aucun fichier image trouve dans le dossier.
    pause
    exit /b
)

REM === Combinaison finale des PDFs temporaires ===
echo.
echo 🔗 Assemblage final du PDF...
magick !file_list! "%output_pdf%"

REM === Supprime les fichiers temporaires ===
for %%f in (temp_*.pdf) do del "%%f"

echo.
echo ✅ PDF genere avec succes : %output_pdf% avec !count! pages
echo.
pause
