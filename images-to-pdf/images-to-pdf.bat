@echo off
title Images -> PDF Conversion

REM === Check ImageMagick installation ===
where magick >nul 2>nul
if errorlevel 1 (
    echo ❌ ImageMagick is not installed or not in PATH.
    pause
    exit /b
)

REM === Prompt user for folder ===
echo Please enter the path of the folder containing images:
set /p input_folder=

if not exist "%input_folder%" (
    echo ❌ The folder does not exist!
    pause
    exit /b
)

REM === Output PDF filename ===
set "output_pdf=result.pdf"

REM === Remove existing PDF to avoid conflicts ===
if exist "%output_pdf%" del "%output_pdf%"

REM === Allowed extensions ===
set "ext_list=jpg jpeg png bmp tiff webp"

REM === File counter ===
set count=0
set file_list=

echo.
echo 🔄 Converting...

REM === Loop through images and create temporary PDFs ===
for %%e in (%ext_list%) do (
    for %%f in ("%input_folder%\*.%%e") do (
        if exist "%%f" (
            set /a count+=1
            echo Processing !count!: %%~nxf
            magick "%%f" "temp_!count!.pdf"
            set "file_list=!file_list! temp_!count!.pdf"
        )
    )
)

REM === Verify at least one file was processed ===
if !count! EQU 0 (
    echo ❌ No image files found in the folder.
    pause
    exit /b
)

REM === Final merge into output PDF ===
echo.
echo 🔗 Assembling final PDF...
magick !file_list! "%output_pdf%"

REM === Clean up temporary PDFs ===
for %%f in (temp_*.pdf) do del "%%f"

echo.
echo ✅ PDF generated successfully: %output_pdf% with !count! pages
echo.
pause
