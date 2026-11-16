param(
  [ValidateSet('Start','Stop')][string]$Action = 'Start',
  [string]$AppRoot = '',
  [string]$NodePath = '',
  [string]$EnvFile = '',
  [string]$DataDir = ''
)
$ErrorActionPreference = 'Stop'
try {
  . (Join-Path $PSScriptRoot 'env.ps1')
  $taskServiceRoot = if ($AppRoot) { [IO.Path]::GetFullPath($AppRoot) } else { $taskProjectRoot }
  Assert-CounterLabDPath $taskServiceRoot
  $taskServiceNode = if ($NodePath) { [IO.Path]::GetFullPath($NodePath) } elseif (Test-Path -LiteralPath (Join-Path $taskServiceRoot 'runtime\node.exe')) { Join-Path $taskServiceRoot 'runtime\node.exe' } else { (Get-Command node -ErrorAction Stop).Source }
  $taskServiceEnv = if ($EnvFile) { [IO.Path]::GetFullPath($EnvFile) } else { Join-Path $taskServiceRoot '.env' }
  if ($DataDir) { Assert-CounterLabDPath $DataDir; $env:COUNTERLAB_DATA_DIR = [IO.Path]::GetFullPath($DataDir) }
  $taskServiceProbe = @'
const path=require('node:path');
const port=Number(process.env.COUNTERLAB_PORT??4317);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid COUNTERLAB_PORT');
process.stdout.write(JSON.stringify({port,dataDir:path.resolve(process.argv[1],process.env.COUNTERLAB_DATA_DIR??'.runtime')}));
'@
  $taskServiceConfigurationText = & $taskServiceNode ('--env-file-if-exists=' + $taskServiceEnv) -e $taskServiceProbe $taskServiceRoot
  if ($LASTEXITCODE -ne 0) { throw 'Invalid application configuration.' }
  $taskServiceConfiguration = $taskServiceConfigurationText | ConvertFrom-Json
  $taskServiceData = $taskServiceConfiguration.dataDir
  Assert-CounterLabDPath $taskServiceData
  $taskServiceState = Join-Path $taskServiceData 'background-service.json'
  Assert-CounterLabDPath $taskServiceState

  if ($Action -eq 'Stop') {
    if (!(Test-Path -LiteralPath $taskServiceState)) { Write-Host 'No managed CounterLab process was recorded.'; exit 0 }
    $taskRecorded = Get-Content -LiteralPath $taskServiceState -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($taskRecorded.appRoot -ine $taskServiceRoot) { throw 'Recorded process belongs to a different application directory.' }
    $taskExisting = Get-Process -Id ([int]$taskRecorded.processId) -ErrorAction SilentlyContinue
    if (!$taskExisting) { Write-Host 'CounterLab is already stopped.'; exit 0 }
    # A reused PID must never terminate an unrelated process.
    if ($taskExisting.Path -ine $taskRecorded.executable -or $taskExisting.StartTime.ToUniversalTime().ToString('o') -cne $taskRecorded.startedAt) { throw 'Process identity has changed; refusing to stop it.' }
    Stop-Process -Id $taskExisting.Id -ErrorAction Stop
    $taskExisting.WaitForExit(5000) | Out-Null
    Write-Host 'CounterLab stopped. Saved experiments remain on D:.'
    exit 0
  }

  if (!(Test-Path -LiteralPath (Join-Path $taskServiceRoot 'dist\index.html'))) { throw 'Frontend build missing; build the app or extract the complete portable package.' }
  $env:COUNTERLAB_DATA_DIR = $taskServiceData
  $taskServicePort = $taskServiceConfiguration.port
  $taskServiceUrl = 'http://127.0.0.1:' + $taskServicePort
  try {
    $taskHealth = Invoke-RestMethod -Uri ($taskServiceUrl + '/api/health') -TimeoutSec 1
    if ($taskHealth.ok -and $taskHealth.engineVersion -eq '1.0.0') { Write-Host ('CounterLab is already running: ' + $taskServiceUrl); exit 0 }
  } catch { }
  New-Item -ItemType Directory -Path $taskServiceData -Force | Out-Null
  foreach ($taskDatabaseFile in @('counterlab.sqlite','counterlab.sqlite-wal','counterlab.sqlite-shm')) { Assert-CounterLabDPath (Join-Path $taskServiceData $taskDatabaseFile) }
  $taskServiceLogs = Join-Path $taskServiceData 'logs'
  Assert-CounterLabDPath $taskServiceLogs
  New-Item -ItemType Directory -Path $taskServiceLogs -Force | Out-Null
  $taskServiceStamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
  $taskServiceOut = Join-Path $taskServiceLogs ('server-' + $taskServiceStamp + '.out.log')
  $taskServiceError = Join-Path $taskServiceLogs ('server-' + $taskServiceStamp + '.err.log')
  # PS5 concatenates ArgumentList arrays. Quote the env-file argument explicitly.
  $taskServiceArguments = '"--env-file-if-exists=' + $taskServiceEnv + '" --import tsx server/index.ts'
  $taskServiceProcess = Start-Process -FilePath $taskServiceNode -ArgumentList $taskServiceArguments -WorkingDirectory $taskServiceRoot -WindowStyle Hidden -RedirectStandardOutput $taskServiceOut -RedirectStandardError $taskServiceError -PassThru
  $taskServiceRecord = [ordered]@{ processId=$taskServiceProcess.Id; executable=$taskServiceNode; startedAt=$taskServiceProcess.StartTime.ToUniversalTime().ToString('o'); appRoot=$taskServiceRoot; url=$taskServiceUrl; stdout=$taskServiceOut; stderr=$taskServiceError }
  [IO.File]::WriteAllText($taskServiceState, ($taskServiceRecord | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
  $taskServiceDeadline = [DateTime]::UtcNow.AddSeconds(15)
  do {
    if ($taskServiceProcess.HasExited) { throw ('Server exited during startup. See ' + $taskServiceError) }
    try {
      $taskHealth = Invoke-RestMethod -Uri ($taskServiceUrl + '/api/health') -TimeoutSec 1
      if ($taskHealth.ok -and $taskHealth.engineVersion -eq '1.0.0') { Write-Host ('CounterLab is ready: ' + $taskServiceUrl); Write-Host 'The server runs independently in the background. This launcher can close.'; exit 0 }
    } catch { }
    Start-Sleep -Milliseconds 150
  } while ([DateTime]::UtcNow -lt $taskServiceDeadline)
  throw ('Server readiness timed out. See ' + $taskServiceError)
} catch {
  Write-Host ('CounterLab: ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
