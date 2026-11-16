$taskRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
if ([IO.Path]::GetPathRoot($taskRoot) -ine 'D:\') { throw 'Use a D: checkout.' }
$taskCache = Join-Path $taskRoot '.runtime'
foreach ($part in @('tmp','pip','cache','config','data','mpl')) {
  New-Item -ItemType Directory -Force -Path (Join-Path $taskCache $part) | Out-Null
}
$env:TEMP = Join-Path $taskCache 'tmp'
$env:TMP = $env:TEMP
$env:PIP_CACHE_DIR = Join-Path $taskCache 'pip'
$env:XDG_CACHE_HOME = Join-Path $taskCache 'cache'
$env:XDG_CONFIG_HOME = Join-Path $taskCache 'config'
$env:XDG_DATA_HOME = Join-Path $taskCache 'data'
$env:MPLCONFIGDIR = Join-Path $taskCache 'mpl'
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:PYTHONNOUSERSITE = '1'
$env:LIGHTFORGE_DATA_DIR = Join-Path $taskCache 'data'
$env:GIT_TERMINAL_PROMPT = '0'
$env:OMP_NUM_THREADS = '4'
$env:OPENBLAS_NUM_THREADS = '4'
