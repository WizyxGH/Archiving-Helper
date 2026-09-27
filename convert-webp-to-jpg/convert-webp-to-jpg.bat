@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: Get directory containing this script
set "SOURCE_FOLDER=%~dp0"
cd /d "%SOURCE_FOLDER%"

echo Converting .webp files to .jpg in: "%SOURCE_FOLDER%"
echo.

:: Ask user if they want to delete original .webp files after conversion
choice /c YN /m "Do you want to delete .webp files after conversion? (Y/N)"
if errorlevel 2 (
    set "DELETE_ORIGINAL=false"
) else (
    set "DELETE_ORIGINAL=true"
)
echo.

:: Loop through all .webp files in folder
for %%f in (*.webp) do (
    echo Converting "%%f" to "%%~nf.jpg"...
    magick "%%f" "%%~nf.jpg"

    if exist "%%~nf.jpg" (
        echo ✅ Conversion successful: "%%~nf.jpg"

        if "!DELETE_ORIGINAL!"=="true" (
            del "%%f"
            echo 🗑️  Original file "%%f" deleted.
        ) else (
            echo 📂 Original file "%%f" kept.
        )
    ) else (
        echo ❌ Error: file "%%~nf.jpg" was not created.
    )
    echo.
)

echo Conversion complete.
pause
