$ErrorActionPreference = 'Stop'
try {
  $taskProjectRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
  . (Join-Path $PSScriptRoot 'env.ps1')
  Set-Location -LiteralPath $taskProjectRoot
  $taskBundledNode = Join-Path $taskProjectRoot 'runtime\node.exe'
  $taskNode = if (Test-Path -LiteralPath $taskBundledNode) { $taskBundledNode } else { (Get-Command node -ErrorAction Stop).Source }
  $taskNodeVersion = & $taskNode -p 'process.version'
  if ($LASTEXITCODE -ne 0 -or $taskNodeVersion -cne 'v24.22.1') { throw 'CounterLab requires Node v24.22.1. Restore the bundled runtime or use the documented source setup.' }
  $taskNodeTarget = & $taskNode -p 'process.platform + process.arch'
  if ($LASTEXITCODE -ne 0 -or $taskNodeTarget -cne 'win32x64') { throw 'This package requires a Windows x64 Node runtime.' }
  if (!(Test-Path -LiteralPath (Join-Path $taskProjectRoot 'dist\index.html'))) { throw 'Frontend build missing. Source checkout: run pnpm install and pnpm build. Release package: extract the complete ZIP again.' }
  if (!(Test-Path -LiteralPath (Join-Path $taskProjectRoot 'node_modules\tsx\package.json'))) { throw 'Production dependencies missing. Extract the complete ZIP, or run pnpm install in a source checkout.' }
  # Node parses .env with the same precedence used for startup; never print keys.
  $taskProbeScript = @'
const path=require('node:path');
const port=Number(process.env.COUNTERLAB_PORT??4317);
if(!Number.isInteger(port)||port<1024||port>65535){process.stderr.write('COUNTERLAB_PORT must be an integer from 1024 to 65535.\n');process.exit(1)}
process.stdout.write(JSON.stringify({port,dataDir:path.resolve(process.env.COUNTERLAB_DATA_DIR??'.runtime')}));
'@
  $taskConfigurationText = & $taskNode --env-file-if-exists=.env -e $taskProbeScript
  if ($LASTEXITCODE -ne 0) { throw 'Invalid local configuration. Check COUNTERLAB_PORT and the syntax of .env.' }
  $taskConfiguration = $taskConfigurationText | ConvertFrom-Json
  Assert-CounterLabDPath $taskConfiguration.dataDir
  foreach ($taskDatabaseFile in @('counterlab.sqlite','counterlab.sqlite-wal','counterlab.sqlite-shm')) { Assert-CounterLabDPath (Join-Path $taskConfiguration.dataDir $taskDatabaseFile) }
  Write-Host 'CounterLab - local algorithm laboratory'
  Write-Host ('Starting http://127.0.0.1:' + $taskConfiguration.port + ' (the server confirms when ready).')
  Write-Host ('Local data: ' + $taskConfiguration.dataDir)
  Write-Host 'Keep this window open. Ctrl+C stops the service. Model access is optional.'
  & $taskNode --env-file-if-exists=.env --import tsx server/index.ts
  $taskExitCode = $LASTEXITCODE
  if ($taskExitCode -ne 0) { Write-Host ('CounterLab stopped with exit code ' + $taskExitCode + '. Check the preceding error, the port, and D: permissions.') -ForegroundColor Red }
  exit $taskExitCode
} catch {
  Write-Host ('CounterLab could not start: ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
