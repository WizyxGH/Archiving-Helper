$ErrorActionPreference = 'Stop'

$sourceDir = $PSScriptRoot
$extensionDir = 'C:\Users\starl\Documents\Projets\Sites\DisneyComicsHub\apps\InducksScanUploader'
$copies = @(
    @{ Source = 'pdf-core.js'; Destination = 'pdf.js' },
    @{ Source = 'jpeg-core.js'; Destination = 'jpegcrop.js' }
)

if (-not (Test-Path -LiteralPath $extensionDir -PathType Container)) {
    throw "InducksScanUploader introuvable : $extensionDir"
}

foreach ($copy in $copies) {
    $source = Join-Path $sourceDir $copy.Source
    $destination = Join-Path $extensionDir $copy.Destination
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Module source introuvable : $source"
    }

    $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    $destinationHash = if (Test-Path -LiteralPath $destination -PathType Leaf) {
        (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
    } else {
        ''
    }
    if ($sourceHash -eq $destinationHash) {
        Write-Output "$($copy.Source) déjà synchronisé."
        continue
    }

    $temporary = "$destination.sync-$PID"
    try {
        Copy-Item -LiteralPath $source -Destination $temporary
        $temporaryHash = (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash
        if ($temporaryHash -ne $sourceHash) {
            throw "La copie de $($copy.Source) n'est pas identique à la source."
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
        throw 'Le contrôle syntaxique de pdf.js a échoué.'
    }
    node --check .\jpegcrop.js
    if ($LASTEXITCODE -ne 0) {
        throw 'Le contrôle syntaxique de jpegcrop.js a échoué.'
    }
    node .\tests\t44.mjs
    if ($LASTEXITCODE -ne 0) {
        throw 'Les tests de régression PDF de l’extension ont échoué.'
    }
} finally {
    Pop-Location
}

Write-Output 'Synchronisation InducksScanUploader terminée ; tests PDF OK.'
