<#
.SYNOPSIS
    Converts CBR (RAR) comic archives into CBZ (ZIP) format losslessly.
#>
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Inputs,
    [switch]$DeleteOriginal
)

$ErrorActionPreference = 'Stop'

function Find-Extractor {
    # 7-Zip
    $cmd = Get-Command 7z -ErrorAction SilentlyContinue
    if ($cmd) { return @{ Exe = '7z'; Type = '7z' } }
    foreach ($p in @('C:\Program Files\7-Zip\7z.exe', 'C:\Program Files (x86)\7-Zip\7z.exe')) {
        if (Test-Path $p) { return @{ Exe = $p; Type = '7z' } }
    }
    # WinRAR
    $cmd = Get-Command winrar -ErrorAction SilentlyContinue
    if ($cmd) { return @{ Exe = 'winrar'; Type = 'winrar' } }
    foreach ($p in @('C:\Program Files\WinRAR\WinRAR.exe', 'C:\Program Files (x86)\WinRAR\WinRAR.exe')) {
        if (Test-Path $p) { return @{ Exe = $p; Type = 'winrar' } }
    }
    # Tar
    $cmd = Get-Command tar -ErrorAction SilentlyContinue
    if ($cmd) { return @{ Exe = 'tar'; Type = 'tar' } }

    return $null
}

$extractor = Find-Extractor
if (-not $extractor) {
    Write-Error "No supported extractor found. Please install 7-Zip or WinRAR."
    exit 1
}

Write-Host ("[INFO] Using extractor: {0} ({1})" -f $extractor.Exe, $extractor.Type) -ForegroundColor Cyan

function Convert-CbrToCbz {
    param([string]$CbrPath)

    $cbrFile = Get-Item -LiteralPath $CbrPath
    if ($cbrFile.Extension.ToLower() -ne '.cbr') {
        Write-Warning "Skipping non-CBR file: $CbrPath"
        return
    }

    $baseName = $cbrFile.BaseName
    $dir = $cbrFile.DirectoryName
    $cbzPath = Join-Path $dir "$baseName.cbz"

    if (Test-Path -LiteralPath $cbzPath) {
        Write-Warning "Target CBZ already exists: $cbzPath. Skipping."
        return
    }

    Write-Host "`n-------------------------------------------"
    Write-Host ("[CONVERTING] {0} -> {1}.cbz" -f $cbrFile.Name, $baseName) -ForegroundColor Yellow

    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("cbr2cbz_" + [System.Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

    try {
        # Extract
        if ($extractor.Type -eq '7z') {
            $p = Start-Process -FilePath $extractor.Exe -ArgumentList 'x', '-y', "-o`"$tempDir`"", "`"$($cbrFile.FullName)`"" -NoNewWindow -PassThru -Wait
        } elseif ($extractor.Type -eq 'winrar') {
            $p = Start-Process -FilePath $extractor.Exe -ArgumentList 'x', '-idq', '-y', "`"$($cbrFile.FullName)`"", "`"$tempDir\`"" -NoNewWindow -PassThru -Wait
        } elseif ($extractor.Type -eq 'tar') {
            $p = Start-Process -FilePath 'tar' -ArgumentList '-xf', "`"$($cbrFile.FullName)`"", '-C', "`"$tempDir`"" -NoNewWindow -PassThru -Wait
        }

        if ($p.ExitCode -ne 0) {
            throw "Extraction failed with exit code $($p.ExitCode)"
        }

        # Flatten if single folder inside
        while ($true) {
            $subFiles = Get-ChildItem -LiteralPath $tempDir -File
            $subDirs = Get-ChildItem -LiteralPath $tempDir -Directory
            if ($subFiles.Count -eq 0 -and $subDirs.Count -eq 1) {
                $nestedDir = $subDirs[0].FullName
                Get-ChildItem -LiteralPath $nestedDir | Move-Item -Destination $tempDir -Force
                Remove-Item -LiteralPath $nestedDir -Force -Recurse
            } else {
                break
            }
        }

        $allExtracted = Get-ChildItem -LiteralPath $tempDir
        if ($allExtracted.Count -eq 0) {
            throw "No files found after extraction."
        }

        # Compress to temporary zip and rename to .cbz
        $tempZip = Join-Path ([System.IO.Path]::GetTempPath()) ("cbz_" + [System.Guid]::NewGuid().ToString('N') + ".zip")
        Compress-Archive -LiteralPath ($allExtracted | Select-Object -ExpandProperty FullName) -DestinationPath $tempZip
        Move-Item -LiteralPath $tempZip -Destination $cbzPath -Force

        $cbzStat = Get-Item -LiteralPath $cbzPath
        Write-Host ("[SUCCESS] Created: {0} ({1:N2} MB)" -f $cbzPath, ($cbzStat.Length / 1MB)) -ForegroundColor Green

        $node = Get-Command node -ErrorAction SilentlyContinue
        $collectionScript = Join-Path $PSScriptRoot '..\src\pipelines\4_inducks_collection\collection.mjs'
        if ($node -and (Test-Path -LiteralPath $collectionScript)) {
            & $node.Source $collectionScript $cbzPath
            if ($LASTEXITCODE -ne 0) {
                Write-Warning "Archive created, but collection update failed for $cbzPath."
            }
        } else {
            Write-Warning 'Node.js or the collection updater was not found; archive was created without collection update.'
        }

        if ($DeleteOriginal) {
            Remove-Item -LiteralPath $cbrFile.FullName -Force
            Write-Host "  [CLEANUP] Deleted original CBR file." -ForegroundColor Gray
        }
    } finally {
        Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Resolve inputs
$cbrFiles = @()
if (-not $Inputs -or $Inputs.Count -eq 0) {
    $cbrFiles += Get-ChildItem -Filter *.cbr -File
} else {
    foreach ($inp in $Inputs) {
        if (Test-Path -LiteralPath $inp -PathType Container) {
            $cbrFiles += Get-ChildItem -LiteralPath $inp -Filter *.cbr -File
        } elseif (Test-Path -LiteralPath $inp -PathType Leaf) {
            $cbrFiles += Get-Item -LiteralPath $inp
        }
    }
}

if ($cbrFiles.Count -eq 0) {
    Write-Host "[INFO] No .cbr files found to convert." -ForegroundColor Yellow
    exit 0
}

Write-Host ("[INFO] Found {0} CBR archive(s) to convert." -f $cbrFiles.Count) -ForegroundColor Green
foreach ($file in $cbrFiles) {
    try {
        Convert-CbrToCbz -CbrPath $file.FullName
    } catch {
        Write-Host ("[ERROR] Failed to convert {0}: {1}" -f $file.Name, $_.Exception.Message) -ForegroundColor Red
    }
}

Write-Host "`n[COMPLETED] Batch CBR to CBZ conversion finished." -ForegroundColor Green
