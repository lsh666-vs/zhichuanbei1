param([Parameter(Mandatory=$true)][string]$ZipPath,[int]$Port=4320)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'env.ps1')
$taskSourceRoot=$taskProjectRoot
$taskArchivePath=[IO.Path]::GetFullPath($ZipPath)
Assert-CounterLabDPath $taskArchivePath
if (!(Test-Path -LiteralPath $taskArchivePath -PathType Leaf)) { throw 'Release ZIP is missing.' }
$taskArchiveHash=(Get-FileHash -LiteralPath $taskArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
$taskChecksumPath=$taskArchivePath + '.sha256'
if(!(Test-Path -LiteralPath $taskChecksumPath -PathType Leaf)){throw 'Release checksum sidecar is missing.'}
$taskExpectedHash=((Get-Content -LiteralPath $taskChecksumPath -Raw -Encoding UTF8).Trim() -split '\s+')[0]
if($taskExpectedHash -notmatch '^[A-Fa-f0-9]{64}$' -or $taskArchiveHash -ine $taskExpectedHash){throw 'Release ZIP checksum does not match its sidecar.'}
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Test port must be 1024-65535.' }
$taskListener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$Port)
try { $taskListener.Start() } finally { $taskListener.Stop() }
$taskCheckRoot='D:\CounterLab release check ' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff')
Assert-CounterLabDPath $taskCheckRoot
if(Test-Path -LiteralPath $taskCheckRoot){throw 'Fresh verification directory already exists.'}
New-Item -ItemType Directory -Path $taskCheckRoot | Out-Null
$taskTotalWatch=[Diagnostics.Stopwatch]::StartNew()
$taskPhaseWatch=[Diagnostics.Stopwatch]::StartNew()
Expand-Archive -LiteralPath $taskArchivePath -DestinationPath $taskCheckRoot
$taskExtractionMs=$taskPhaseWatch.ElapsedMilliseconds
$taskPackageDirectories=@(Get-ChildItem -LiteralPath $taskCheckRoot -Directory)
if($taskPackageDirectories.Count -ne 1){throw 'ZIP must contain exactly one package root.'}
$taskPackageRoot=$taskPackageDirectories[0].FullName
$taskBundledNode=Join-Path $taskPackageRoot 'runtime\node.exe'
if(Test-Path -LiteralPath (Join-Path $taskPackageRoot '.env')){throw 'Release unexpectedly contains private .env.'}
if(Get-ChildItem -LiteralPath $taskPackageRoot -Recurse -Force | Where-Object {($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0}){throw 'Extracted release has links.'}

$taskPhaseWatch.Restart()
$taskManifest=Get-Content -LiteralPath (Join-Path $taskPackageRoot 'RELEASE-MANIFEST.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach($taskEntry in $taskManifest.files){
  $taskFile=[IO.Path]::GetFullPath((Join-Path $taskPackageRoot $taskEntry.path))
  if(!$taskFile.StartsWith($taskPackageRoot + '\',[StringComparison]::OrdinalIgnoreCase)){throw 'Manifest path escapes package.'}
  if(!(Test-Path -LiteralPath $taskFile -PathType Leaf)){throw ('Manifest file missing: '+$taskEntry.path)}
  if((Get-Item -LiteralPath $taskFile).Length -ne $taskEntry.bytes -or (Get-FileHash -LiteralPath $taskFile -Algorithm SHA256).Hash -ine $taskEntry.sha256){throw ('Manifest mismatch: '+$taskEntry.path)}
}
$taskIntegrityMs=$taskPhaseWatch.ElapsedMilliseconds

# Resolve dependencies from outside the source tree, without reading the source .env.
Push-Location -LiteralPath $taskPackageRoot
try {
  $taskResolveScript=@'
process.stdout.write(JSON.stringify({version:process.version,node:process.execPath,tsx:import.meta.resolve('tsx'),fastify:import.meta.resolve('fastify')}));
'@
  $taskResolutionText=& $taskBundledNode --input-type=module -e $taskResolveScript
  if($LASTEXITCODE -ne 0){throw 'Bundled runtime resolution failed.'}
  $taskResolution=$taskResolutionText | ConvertFrom-Json
  if($taskResolution.version -cne 'v24.22.1'){throw 'Wrong bundled Node version.'}
  foreach($taskModule in @($taskResolution.tsx,$taskResolution.fastify)){
    $taskResolvedPath=([Uri]$taskModule).LocalPath
    if(!$taskResolvedPath.StartsWith($taskPackageRoot + '\',[StringComparison]::OrdinalIgnoreCase)){throw 'Module resolved outside the extracted release.'}
  }
} finally {Pop-Location}

# Test-specific configuration only. Never copy or print the repository's .env.
foreach($taskName in @('COUNTERLAB_PORT','COUNTERLAB_DATA_DIR','COUNTERLAB_AI_KEY','COUNTERLAB_AI_BASE_URL','COUNTERLAB_AI_MODEL','COUNTERLAB_AI_PROVIDER')){Remove-Item -LiteralPath ('Env:\'+$taskName) -ErrorAction SilentlyContinue}
$taskDataPath=Join-Path $taskCheckRoot 'test-data'
$taskTestEnvironment='COUNTERLAB_PORT='+$Port+"`r`nCOUNTERLAB_DATA_DIR="+$taskDataPath.Replace('\','/')+"`r`nCOUNTERLAB_AI_KEY=`r`n"
[IO.File]::WriteAllText((Join-Path $taskPackageRoot '.env'),$taskTestEnvironment,[Text.UTF8Encoding]::new($false))
$taskBase='http://127.0.0.1:'+ $Port
$taskService=$null
$taskRunNumber=0
function Invoke-ReleaseApi {
  param([string]$Method,[string]$Path,$Body=$null)
  $taskArguments=@{Method=$Method;Uri=($taskBase+$Path);TimeoutSec=20}
  if($null -ne $Body){$taskArguments.ContentType='application/json; charset=utf-8';$taskArguments.Body=[Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 100 -Compress))}
  return Invoke-RestMethod @taskArguments
}
function Start-ReleaseServer {
  $script:taskRunNumber++
  $taskStartupWatch=[Diagnostics.Stopwatch]::StartNew()
  $taskArguments=@('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+(Join-Path $taskPackageRoot 'scripts\start.ps1')+'"'))
  $script:taskService=Start-Process -FilePath 'powershell.exe' -ArgumentList $taskArguments -WorkingDirectory $taskPackageRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskCheckRoot ('stdout-'+$taskRunNumber+'.txt')) -RedirectStandardError (Join-Path $taskCheckRoot ('stderr-'+$taskRunNumber+'.txt'))
  while($taskStartupWatch.ElapsedMilliseconds -lt 30000){
    if($taskService.HasExited){throw ('Release startup exited '+$taskService.ExitCode+'; inspect D: verification logs.')}
    try{$taskHealth=Invoke-RestMethod -Uri ($taskBase+'/api/health') -TimeoutSec 1;if($taskHealth.ok){return $taskStartupWatch.ElapsedMilliseconds}}catch{}
    Start-Sleep -Milliseconds 100
  }
  throw 'Release startup did not become healthy in 30 seconds.'
}
function Stop-ReleaseServer {
  if($null -eq $script:taskService){return}
  # Terminate only the exact copied Node child. This intentionally tests WAL recovery.
  $taskChildren=@(Get-CimInstance Win32_Process -Filter ('ParentProcessId = '+$script:taskService.Id))
  foreach($taskChild in $taskChildren){
    if($taskChild.ExecutablePath -ieq $taskBundledNode){Stop-Process -Id $taskChild.ProcessId -Force -ErrorAction SilentlyContinue}
  }
  if(!$script:taskService.WaitForExit(5000)){Stop-Process -Id $script:taskService.Id -Force -ErrorAction SilentlyContinue}
  $script:taskService=$null
}
function Wait-ReleaseJob {
  param($Job)
  $taskJobWatch=[Diagnostics.Stopwatch]::StartNew()
  while($taskJobWatch.ElapsedMilliseconds -lt 55000){
    $taskCurrent=Invoke-ReleaseApi 'GET' ('/api/jobs/'+$Job.id)
    if($taskCurrent.state -eq 'completed'){return $taskCurrent}
    if($taskCurrent.state -notin @('queued','running')){throw ('Release job failed: '+$taskCurrent.state+' '+$taskCurrent.error)}
    Start-Sleep -Milliseconds 100
  }
  throw 'Release job did not finish within verification timeout.'
}

$taskRows=@()
$taskIds=@()
try {
  $taskFirstStartupMs=Start-ReleaseServer
  $taskExtractionToHealthMs=$taskTotalWatch.ElapsedMilliseconds
  $taskAi=Invoke-ReleaseApi 'GET' '/api/ai/status'
  if($taskAi.configured -or $taskAi.calls -ne 0){throw 'Release test must be keyless with no model calls.'}
  $taskPage=Invoke-WebRequest -Uri ($taskBase+'/') -UseBasicParsing -TimeoutSec 10
  if($taskPage.StatusCode -ne 200 -or $taskPage.Content -notmatch 'id="root"'){throw 'Packaged frontend was not served.'}
  $taskCatalog=Invoke-ReleaseApi 'GET' '/api/catalog'
  foreach($taskDomain in $taskCatalog.domains){
    $taskEvaluation=Invoke-ReleaseApi 'POST' '/api/evaluate' @{instance=$taskDomain.instance;strategy=$taskDomain.strategy}
    if($taskEvaluation.verdict -ne 'counterexample' -or !$taskEvaluation.witnessVerified){throw 'Domain evaluation failed.'}
    $taskSearch=Wait-ReleaseJob (Invoke-ReleaseApi 'POST' '/api/jobs/search' @{domain=$taskDomain.domain;strategy=$taskDomain.strategy;seed=20261115;attempts=300;size=7;maxValue=20})
    if($taskSearch.result.status -ne 'counterexample' -or !$taskSearch.result.evaluation.witnessVerified){throw 'Domain search failed.'}
    if($taskSearch.progress.checked -ne $taskSearch.result.checked -or $taskSearch.progress.found -ne 1){throw 'Search terminal progress mismatch.'}
    $taskShrink=Wait-ReleaseJob (Invoke-ReleaseApi 'POST' '/api/jobs/shrink' @{evaluation=$taskSearch.result.evaluation})
    $taskFinal=$taskShrink.result.final
    if($taskFinal.verdict -ne 'counterexample' -or !$taskFinal.witnessVerified){throw 'Domain shrink failed.'}
    $taskRegression=Wait-ReleaseJob (Invoke-ReleaseApi 'POST' '/api/jobs/regression' @{instance=$taskFinal.instance;before=$taskDomain.strategy;after=$taskDomain.presets[-1];seed=20261115;count=12})
    if($taskRegression.result.rows.Count -ne 13 -or $taskRegression.result.regressed -ne 0){throw 'Domain regression failed.'}
    $taskSaved=Invoke-ReleaseApi 'POST' '/api/experiments' @{title=('Portable '+$taskDomain.domain);instance=$taskFinal.instance;strategy=$taskDomain.strategy;evaluation=$taskFinal;search=$taskSearch.result;shrink=$taskShrink.result;regression=$taskRegression.result}
    $taskExport=Invoke-ReleaseApi 'GET' ('/api/experiments/'+$taskSaved.id+'/export')
    $taskImported=Invoke-ReleaseApi 'POST' '/api/import' $taskExport
    if($taskImported.id -eq $taskSaved.id -or $taskImported.evaluation.verdict -ne 'counterexample' -or !$taskImported.evaluation.witnessVerified){throw 'Domain import/recompute failed.'}
    $taskReport=Invoke-WebRequest -Uri ($taskBase+'/api/experiments/'+$taskSaved.id+'/report') -UseBasicParsing -TimeoutSec 10
    if($taskReport.StatusCode -ne 200 -or $taskReport.Headers['Content-Type'] -notmatch 'text/html'){throw 'HTML report failed.'}
    $taskIds+=@($taskSaved.id,$taskImported.id)
    $taskRows+=@{domain=$taskDomain.domain;searchChecked=$taskSearch.result.checked;shrinkAccepted=$taskShrink.result.steps.Count;regressionRows=$taskRegression.result.rows.Count;savedAndImported=$true;htmlReport=$true}
  }
  Stop-ReleaseServer
  $taskRestartMs=Start-ReleaseServer
  $taskPersisted=Invoke-ReleaseApi 'GET' '/api/experiments'
  if(@($taskPersisted).Count -ne 6){throw 'Restart did not retain all six saved/imported experiments.'}
  foreach($taskId in $taskIds){if($taskId -notin $taskPersisted.id){throw 'Experiment identity changed across restart.'}}
  $taskAi=Invoke-ReleaseApi 'GET' '/api/ai/status'
  if($taskAi.configured -or $taskAi.calls -ne 0){throw 'Restart unexpectedly configured AI.'}
  $taskEvidence=[ordered]@{kind='portable-candidate-verification';testedAt=(Get-Date).ToUniversalTime().ToString('o');archive=$taskArchivePath;archiveSha256=$taskArchiveHash;sidecarChecksumVerified=$true;freshDirectory=$taskCheckRoot;port=$Port;node=$taskResolution;manifestFiles=$taskManifest.files.Count;extractionMs=$taskExtractionMs;integrityCheckMs=$taskIntegrityMs;startupToHealthMs=$taskFirstStartupMs;extractionThroughIntegrityToHealthMs=$taskExtractionToHealthMs;restartToHealthMs=$taskRestartMs;fullVerificationMs=$taskTotalWatch.ElapsedMilliseconds;keyless=$true;externalModelCalls=0;domainChecks=$taskRows;persistedExperiments=6;shutdownMethod='Exact release Node process termination; SQLite WAL recovery verified on restart';frontendHttp200=$true;browserWorkflowTested=$false;scope='Same Windows host, fresh extraction outside source, custom port/data directory, no dependency download and no model calls. Not a newly provisioned OS or a browser end-to-end test.'}
  $taskEvidenceText=$taskEvidence | ConvertTo-Json -Depth 20
  [IO.File]::WriteAllText((Join-Path $taskCheckRoot 'verification.json'),$taskEvidenceText,[Text.UTF8Encoding]::new($false))
  Write-Output $taskEvidenceText
} finally {Stop-ReleaseServer}
