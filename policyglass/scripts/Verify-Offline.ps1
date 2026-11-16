param([Parameter(Mandatory=$true)][string]$Bundle, [int]$Port = 8791)
$ErrorActionPreference = 'Stop'
$PolicyGlassVerifyRoot = [IO.Path]::GetFullPath($Bundle)
if ([IO.Path]::GetPathRoot($PolicyGlassVerifyRoot) -ine 'D:\') { throw 'Verification bundle must stay on D:.' }
if (-not (Test-Path -LiteralPath (Join-Path $PolicyGlassVerifyRoot 'manifest.json'))) { throw 'Bundle manifest missing.' }
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { throw "Verification port $Port is already occupied." }
. (Join-Path $PolicyGlassVerifyRoot 'scripts\Offline-Environment.ps1')
& (Join-Path $PolicyGlassVerifyRoot 'runtime\python\python.exe') -B (Join-Path $PolicyGlassVerifyRoot 'scripts\offline_manifest.py') verify --root $PolicyGlassVerifyRoot --port $Port
if ($LASTEXITCODE -ne 0) { throw 'Offline verification failed. Inspect .runtime/verification.json and logs in bundle.' }
