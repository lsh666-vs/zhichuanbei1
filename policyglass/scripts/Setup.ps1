param([string]$PythonExecutable = 'D:\Dev\Python312\python.exe', [string]$VenvDirectory = '.venv')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Environment.ps1')
Push-Location $PolicyGlassRoot
try {
    $PolicyGlassVenv = [IO.Path]::GetFullPath((Join-Path $PolicyGlassRoot $VenvDirectory))
    if (-not $PolicyGlassVenv.StartsWith($PolicyGlassRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Environment must stay inside project' }
    $PolicyGlassPython = Join-Path $PolicyGlassVenv 'Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $PolicyGlassPython)) {
        $PolicyGlassBootstrap = Join-Path $PolicyGlassRuntime 'virtualenv.pyz'
        $PolicyGlassBootstrapHash = '596fdc9d21af010ac7570eafa144f6f4d4ff1c06f308ed0ca4fcd77e7595f077'
        if (-not (Test-Path -LiteralPath $PolicyGlassBootstrap)) {
            Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/virtualenv/3.12/virtualenv.pyz' -OutFile $PolicyGlassBootstrap
        }
        if ((Get-FileHash -LiteralPath $PolicyGlassBootstrap -Algorithm SHA256).Hash.ToLowerInvariant() -ne $PolicyGlassBootstrapHash) {
            throw 'Bootstrap bytes changed. Verify official provenance before updating the pinned hash.'
        }
        $PolicyGlassBootstrapCode = 'import runpy,sys; sys.argv=[sys.argv[1],"--no-periodic-update",sys.argv[2]]; runpy.run_path(sys.argv[0],run_name="__main__")'
        & $PythonExecutable -c $PolicyGlassBootstrapCode $PolicyGlassBootstrap $PolicyGlassVenv
        if ($LASTEXITCODE -ne 0) { throw 'Isolated environment bootstrap failed' }
    }
    & $PolicyGlassPython -m pip install -r requirements-win-py312.lock
    if ($LASTEXITCODE -ne 0) { throw 'Locked dependency install failed' }
    & $PolicyGlassPython -m pip install --no-deps --no-build-isolation -e .
    if ($LASTEXITCODE -ne 0) { throw 'Project install failed' }
    pnpm.cmd --dir physics install --frozen-lockfile --ignore-scripts --store-dir (Join-Path $PolicyGlassRuntime 'pnpm-store')
    if ($LASTEXITCODE -ne 0) { throw 'Canonical physics dependency install failed' }
    & $PolicyGlassPython -m pip check
    if ($LASTEXITCODE -ne 0) { throw 'Dependency validation failed' }
} finally { Pop-Location }
