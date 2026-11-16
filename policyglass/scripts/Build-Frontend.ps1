param([switch]$Install)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Environment.ps1')
Push-Location (Join-Path $PolicyGlassRoot 'frontend')
try {
    if ($Install -or -not (Test-Path -LiteralPath 'node_modules')) {
        pnpm.cmd install --frozen-lockfile --store-dir (Join-Path $PolicyGlassRuntime 'pnpm-store')
        if ($LASTEXITCODE -ne 0) { throw 'Frontend locked install failed' }
    }
    pnpm.cmd build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
} finally { Pop-Location }
