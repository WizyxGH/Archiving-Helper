$ErrorActionPreference = 'Stop'

$packageDir = Join-Path $PSScriptRoot 'package'

Write-Output 'Publishing @wizyxgh/pdf-to-jpg-core to GitHub Packages...'
Push-Location $packageDir
try {
    npm publish
    if ($LASTEXITCODE -ne 0) { throw 'npm publish failed.' }
} finally {
    Pop-Location
}
Write-Output 'Package published successfully.'
