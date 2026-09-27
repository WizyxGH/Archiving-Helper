$ErrorActionPreference = 'Stop'

$packageSrcDir = Join-Path $PSScriptRoot 'package\src'
$extensionDir = 'C:\Users\starl\Documents\Projets\Sites\DisneyComicsHub\apps\InducksScanUploader'
$copies = @(
    @{ Source = 'pdf-core.js'; Destination = 'pdf.js' },
    @{ Source = 'jpeg-core.js'; Destination = 'jpegcrop.js' }
)

if (-not (Test-Path -LiteralPath $extensionDir -PathType Container)) {
    throw "InducksScanUploader not found: $extensionDir"
}

foreach ($copy in $copies) {
    $source = Join-Path $packageSrcDir $copy.Source
    $destination = Join-Path $extensionDir $copy.Destination
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Source module not found: $source"
    }

    $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    $destinationHash = if (Test-Path -LiteralPath $destination -PathType Leaf) {
        (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
    } else {
        ''
    }
    if ($sourceHash -eq $destinationHash) {
        Write-Output "$($copy.Source) already up to date."
        continue
    }

    $temporary = "$destination.sync-$PID"
    try {
        Copy-Item -LiteralPath $source -Destination $temporary
        $temporaryHash = (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash
        if ($temporaryHash -ne $sourceHash) {
            throw "Copy of $($copy.Source) does not match the source (hash mismatch)."
        }
        Move-Item -LiteralPath $temporary -Destination $destination -Force
        Write-Output "$($copy.Source) -> $($copy.Destination)"
    } finally {
        if (Test-Path -LiteralPath $temporary) {
            Remove-Item -LiteralPath $temporary -Force
        }
    }
}

Push-Location $extensionDir
try {
    node --check .\pdf.js
    if ($LASTEXITCODE -ne 0) {
        throw 'Syntax check failed for pdf.js.'
    }
    node --check .\jpegcrop.js
    if ($LASTEXITCODE -ne 0) {
        throw 'Syntax check failed for jpegcrop.js.'
    }
    node .\tests\t44.mjs
    if ($LASTEXITCODE -ne 0) {
        throw 'PDF regression tests in the extension failed.'
    }
} finally {
    Pop-Location
}

Write-Output 'InducksScanUploader sync complete. PDF tests passed.'
