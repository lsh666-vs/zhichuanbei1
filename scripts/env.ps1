$taskProjectRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
function Assert-CounterLabDPath {
  param([Parameter(Mandatory=$true)][string]$Path)
  $taskCheckedPath = [IO.Path]::GetFullPath($Path)
  if ([IO.Path]::GetPathRoot($taskCheckedPath) -ine 'D:\') { throw "CounterLab writes must stay on D:. Rejected path: $taskCheckedPath" }
  # Reject junctions/symlinks so a path spelled D: cannot redirect a write to C:.
  $taskAncestor = $taskCheckedPath
  while ($taskAncestor) {
    if (Test-Path -LiteralPath $taskAncestor) {
      $taskEntry = Get-Item -LiteralPath $taskAncestor -Force -ErrorAction Stop
      if (($taskEntry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "D: write paths must not traverse junctions or symbolic links: $taskAncestor" }
    }
    $taskParent = Split-Path -Path $taskAncestor -Parent
    if ($taskParent -eq $taskAncestor) { break }
    $taskAncestor = $taskParent
  }
}
if ($env:OS -ne 'Windows_NT') { throw 'These scripts support Windows only. No files were created.' }
Assert-CounterLabDPath $taskProjectRoot
$taskRuntimeRoot = Join-Path (Split-Path $taskProjectRoot -Parent) '.counterlab-runtime'
Assert-CounterLabDPath $taskRuntimeRoot
foreach ($taskSubdirectory in @('tmp','cache','npm','pnpm','node-cache','browser','config','data','state','pnpm-store')) {
  $taskCacheDirectory = Join-Path $taskRuntimeRoot $taskSubdirectory
  Assert-CounterLabDPath $taskCacheDirectory
  New-Item -ItemType Directory -Path $taskCacheDirectory -Force -ErrorAction Stop | Out-Null
}
Assert-CounterLabDPath (Join-Path $taskRuntimeRoot 'npmrc')
$env:TEMP = Join-Path $taskRuntimeRoot 'tmp'
$env:TMP = $env:TEMP
$env:npm_config_cache = Join-Path $taskRuntimeRoot 'npm'
$env:npm_config_userconfig = Join-Path $taskRuntimeRoot 'npmrc'
$env:npm_config_update_notifier = 'false'
$env:PNPM_HOME = Join-Path $taskRuntimeRoot 'pnpm'
$env:COREPACK_HOME = Join-Path $taskRuntimeRoot 'cache\corepack'
$env:NODE_COMPILE_CACHE = Join-Path $taskRuntimeRoot 'node-cache'
$env:XDG_CACHE_HOME = Join-Path $taskRuntimeRoot 'cache'
$env:XDG_CONFIG_HOME = Join-Path $taskRuntimeRoot 'config'
$env:XDG_DATA_HOME = Join-Path $taskRuntimeRoot 'data'
$env:XDG_STATE_HOME = Join-Path $taskRuntimeRoot 'state'
$env:pnpm_config_cache_dir = Join-Path $taskRuntimeRoot 'cache\pnpm'
$env:pnpm_config_state_dir = Join-Path $taskRuntimeRoot 'state\pnpm'
$env:pnpm_config_store_dir = Join-Path $taskRuntimeRoot 'pnpm-store'
$env:npm_config_store_dir = $env:pnpm_config_store_dir
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $taskRuntimeRoot 'browser'
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:PIP_CACHE_DIR = Join-Path $taskRuntimeRoot 'cache\pip'
$env:GIT_TERMINAL_PROMPT = '0'

