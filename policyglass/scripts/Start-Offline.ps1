param([int]$Port = 8787)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Offline-Environment.ps1')
if ($Port -ne 8787) { Write-Warning 'The graphical origin policy is configured for port8787. Other ports are for API-only verification.' }
Push-Location $PolicyGlassRoot
try {
    Write-Host "PolicyGlass offline: http://127.0.0.1:$Port/ (Ctrl+C stops this service)"
    & (Join-Path $PolicyGlassRoot 'runtime\python\python.exe') -B -m policyglass.cli serve --port $Port --data $env:POLICYGLASS_DATA
    if ($LASTEXITCODE -ne 0) { throw 'Offline service exited with an error.' }
} finally { Pop-Location }
