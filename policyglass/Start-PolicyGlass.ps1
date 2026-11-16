param([int]$Port=8787)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'scripts\Environment.ps1')
Push-Location $PSScriptRoot
try {
    if (-not (Test-Path -LiteralPath 'frontend\dist\index.html')) { throw 'Build the frontend first: .\scripts\Build-Frontend.ps1' }
    Write-Host "PolicyGlass workbench: http://127.0.0.1:$Port/"
    Write-Host "Scientific API: http://127.0.0.1:$Port/docs"
    & '.\.venv\Scripts\python.exe' -m policyglass.cli serve --port $Port
} finally { Pop-Location }
