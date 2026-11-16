param([string]$Name = ('PolicyGlass-win-x64-' + (Get-Date -Format 'yyyyMMdd-HHmmss')), [switch]$Zip, [switch]$IncludeStudy)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Environment.ps1')
if ($Name -notmatch '^[A-Za-z0-9_-]{1,80}$') { throw 'Use a simple release directory name.' }
Push-Location $PolicyGlassRoot
try {
    pnpm.cmd --dir frontend exec tsc -b
    if ($LASTEXITCODE -ne 0) { throw 'Current frontend type check failed.' }
    node.exe (Join-Path $PSScriptRoot 'build_license_modules.mjs') 'frontend/dist' '.runtime/release-rendered-modules.json'
    if ($LASTEXITCODE -ne 0) { throw 'Current frontend attribution build failed.' }
    $PolicyGlassNpmTree = Join-Path $PolicyGlassRuntime 'release-production-tree.json'
    $PolicyGlassTreeText = pnpm.cmd --dir frontend list --prod --depth 100 --json
    if ($LASTEXITCODE -ne 0) { throw 'Installed production dependency inventory failed.' }
    [IO.File]::WriteAllText($PolicyGlassNpmTree, ($PolicyGlassTreeText -join "`n"), [Text.UTF8Encoding]::new($false))
    $PolicyGlassBuildArguments = @((Join-Path $PSScriptRoot 'offline_manifest.py'), 'build', '--project', $PolicyGlassRoot, '--name', $Name, '--npm-tree', $PolicyGlassNpmTree, '--rendered-modules', (Join-Path $PolicyGlassRuntime 'release-rendered-modules.json'))
    if ($IncludeStudy) { $PolicyGlassBuildArguments += '--include-study' }
    & (Join-Path $PolicyGlassRoot '.venv\Scripts\python.exe') @PolicyGlassBuildArguments
    if ($LASTEXITCODE -ne 0) { throw 'Offline assembly failed; partial output is retained for diagnosis.' }
    $PolicyGlassBundle = Join-Path $PolicyGlassRuntime ('release\' + $Name)
    if ($Zip) {
        & (Join-Path $PolicyGlassBundle 'runtime\python\python.exe') -B (Join-Path $PSScriptRoot 'offline_manifest.py') zip --root $PolicyGlassBundle
        if ($LASTEXITCODE -ne 0) { throw 'Archive creation failed.' }
    }
    Write-Output $PolicyGlassBundle
} finally { Pop-Location }
