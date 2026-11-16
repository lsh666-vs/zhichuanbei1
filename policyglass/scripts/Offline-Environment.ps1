$PolicyGlassRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
if ([IO.Path]::GetPathRoot($PolicyGlassRoot) -ine 'D:\') { throw 'Extract the complete offline package to D: before running.' }
$PolicyGlassDirectoryCheck = Get-Item -LiteralPath $PolicyGlassRoot
while ($PolicyGlassDirectoryCheck) {
    if ($PolicyGlassDirectoryCheck.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Use an ordinary D: directory; junction/symlink ancestors are refused before writes.' }
    $PolicyGlassDirectoryCheck = $PolicyGlassDirectoryCheck.Parent
}
$PolicyGlassRuntime = Join-Path $PolicyGlassRoot '.runtime'
foreach ($PolicyGlassPart in @('tmp','cache','data','config','state','logs','torch','mpl')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $PolicyGlassRuntime $PolicyGlassPart) | Out-Null
}
$env:TEMP = Join-Path $PolicyGlassRuntime 'tmp'
$env:TMP = $env:TEMP
$env:TMPDIR = $env:TEMP
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:PYTHONNOUSERSITE = '1'
$env:PYTHONUSERBASE = Join-Path $PolicyGlassRuntime 'data'
$env:PYTHONPATH = ''
$env:PYTHONHOME = ''
$env:XDG_CACHE_HOME = Join-Path $PolicyGlassRuntime 'cache'
$env:XDG_DATA_HOME = Join-Path $PolicyGlassRuntime 'data'
$env:XDG_CONFIG_HOME = Join-Path $PolicyGlassRuntime 'config'
$env:XDG_STATE_HOME = Join-Path $PolicyGlassRuntime 'state'
$env:TORCH_HOME = Join-Path $PolicyGlassRuntime 'torch'
$env:MPLCONFIGDIR = Join-Path $PolicyGlassRuntime 'mpl'
$env:NODE_COMPILE_CACHE = Join-Path $PolicyGlassRuntime 'node-cache'
$env:POLICYGLASS_DATA = Join-Path $PolicyGlassRuntime 'data'
$env:POLICYGLASS_NODE = Join-Path $PolicyGlassRoot 'runtime\node\node.exe'
$env:OMP_NUM_THREADS = '1'
$env:MKL_NUM_THREADS = '1'
$env:OPENBLAS_NUM_THREADS = '1'
# Core distribution is offline. Optional provider credentials are never inherited.
$env:DEEPSEEK_API_KEY = ''
$env:DEEPSEEK_BASE_URL = ''
$env:HTTP_PROXY = ''
$env:HTTPS_PROXY = ''
$env:ALL_PROXY = ''
$env:NO_PROXY = '127.0.0.1,localhost'
$env:PATH = (Join-Path $PolicyGlassRoot 'runtime\node') + ';' + (Join-Path $PolicyGlassRoot 'runtime\python') + ';' + $env:SystemRoot + '\System32;' + $env:SystemRoot
