param([int]$Port=8787)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'scripts\Environment.ps1')
Push-Location $PSScriptRoot
try {
    Write-Host "PolicyGlass Stage1 scientific API: http://127.0.0.1:$Port/docs"
    Write-Host 'The complete React/3D teaching interface is delivered in Stage2.'
    & '.\.venv\Scripts\python.exe' -m policyglass.cli serve --port $Port
} finally { Pop-Location }
