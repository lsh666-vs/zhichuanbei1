param([switch]$InstallBrowser, [string[]]$Spec=@())
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Environment.ps1')
foreach ($PolicyGlassPort in @(8787,5173)) {
    if (Get-NetTCPConnection -State Listen -LocalPort $PolicyGlassPort -ErrorAction SilentlyContinue) { throw "Port $PolicyGlassPort is occupied. Stop the known service before running isolated E2E." }
}
$PolicyGlassApiProcess=$null
$PolicyGlassViteProcess=$null
$PolicyGlassLog=Join-Path $PolicyGlassRuntime 'e2e'
New-Item -ItemType Directory -Force -Path $PolicyGlassLog | Out-Null
Push-Location $PolicyGlassRoot
try {
    & .\scripts\Build-Frontend.ps1
    if ($LASTEXITCODE -ne 0) { throw 'Build prerequisite failed' }
    $PolicyGlassPython=Join-Path $PolicyGlassRoot '.venv\Scripts\python.exe'
    $PolicyGlassNode=(Get-Command node.exe).Source
    $PolicyGlassApiProcess=Start-Process -FilePath $PolicyGlassPython -ArgumentList @('-m','policyglass.cli','serve','--port','8787','--data','.runtime/e2e-store') -WorkingDirectory $PolicyGlassRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PolicyGlassLog 'api.stdout.log') -RedirectStandardError (Join-Path $PolicyGlassLog 'api.stderr.log') -PassThru
    $PolicyGlassViteProcess=Start-Process -FilePath $PolicyGlassNode -ArgumentList @('node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort') -WorkingDirectory (Join-Path $PolicyGlassRoot 'frontend') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PolicyGlassLog 'vite.stdout.log') -RedirectStandardError (Join-Path $PolicyGlassLog 'vite.stderr.log') -PassThru
    $PolicyGlassReady=$false
    for ($PolicyGlassAttempt=0;$PolicyGlassAttempt -lt 40;$PolicyGlassAttempt++) {
        try { $null=Invoke-RestMethod 'http://127.0.0.1:8787/api/health'; $null=Invoke-WebRequest 'http://127.0.0.1:5173/'; $PolicyGlassReady=$true; break } catch { Start-Sleep -Milliseconds 250 }
    }
    if (-not $PolicyGlassReady) { throw 'Owned services failed readiness; inspect .runtime/e2e logs' }
    Push-Location frontend
    try {
        if ($InstallBrowser) { pnpm.cmd exec playwright install chromium; if ($LASTEXITCODE -ne 0) { throw 'D: browser install failed' } }
        pnpm.cmd exec playwright test @Spec
        if ($LASTEXITCODE -ne 0) { throw 'Real browser E2E failed' }
    } finally { Pop-Location }
} finally {
    foreach ($PolicyGlassProcess in @($PolicyGlassViteProcess,$PolicyGlassApiProcess)) {
        if ($PolicyGlassProcess -and -not $PolicyGlassProcess.HasExited) { Stop-Process -Id $PolicyGlassProcess.Id -ErrorAction SilentlyContinue }
    }
    Pop-Location
}
