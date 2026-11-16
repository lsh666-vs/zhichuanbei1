$PolicyGlassRoot = Split-Path -Parent $PSScriptRoot
$PolicyGlassRuntime = Join-Path $PolicyGlassRoot '.runtime'
if ([IO.Path]::GetPathRoot($PolicyGlassRuntime) -ine 'D:\') { throw 'PolicyGlass runtime must stay on D:.' }
foreach ($PolicyGlassPart in @('tmp','cache','pip','data','config','virtualenv','torch','mpl','logs')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $PolicyGlassRuntime $PolicyGlassPart) | Out-Null
}
$env:TEMP = Join-Path $PolicyGlassRuntime 'tmp'
$env:TMP = $env:TEMP
$env:TMPDIR = $env:TEMP
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:PYTHONNOUSERSITE = '1'
$env:PYTHONUSERBASE = Join-Path $PolicyGlassRuntime 'data'
$env:XDG_CACHE_HOME = Join-Path $PolicyGlassRuntime 'cache'
$env:XDG_DATA_HOME = Join-Path $PolicyGlassRuntime 'data'
$env:XDG_CONFIG_HOME = Join-Path $PolicyGlassRuntime 'config'
$env:XDG_STATE_HOME = Join-Path $PolicyGlassRuntime 'state'
$env:PIP_CACHE_DIR = Join-Path $PolicyGlassRuntime 'pip'
$env:PIP_DISABLE_PIP_VERSION_CHECK = '1'
$env:PIP_CONFIG_FILE = 'NUL'
$env:VIRTUALENV_OVERRIDE_APP_DATA = Join-Path $PolicyGlassRuntime 'virtualenv'
$env:TORCH_HOME = Join-Path $PolicyGlassRuntime 'torch'
$env:MPLCONFIGDIR = Join-Path $PolicyGlassRuntime 'mpl'
$env:POLICYGLASS_DATA = Join-Path $PolicyGlassRuntime 'data'
$env:OMP_NUM_THREADS = '1'
$env:MKL_NUM_THREADS = '1'
$env:OPENBLAS_NUM_THREADS = '1'
$env:NODE_COMPILE_CACHE = Join-Path $PolicyGlassRuntime 'node-cache'
$env:PNPM_HOME = Join-Path $PolicyGlassRuntime 'pnpm'
$env:COREPACK_HOME = Join-Path $PolicyGlassRuntime 'corepack'
$env:npm_config_cache = Join-Path $PolicyGlassRuntime 'npm'
$env:npm_config_userconfig = Join-Path $PolicyGlassRuntime 'npmrc'
$env:npm_config_update_notifier = 'false'

