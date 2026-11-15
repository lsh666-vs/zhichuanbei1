param([switch]$SkipBuild,[switch]$AllowNetwork)
$ErrorActionPreference = 'Stop'
$taskProjectRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
. (Join-Path $PSScriptRoot 'env.ps1')
Set-Location -LiteralPath $taskProjectRoot

$taskNodePath = (Get-Command node -ErrorAction Stop).Source
$taskNodeVersion = & $taskNodePath -p 'process.version'
if ($LASTEXITCODE -ne 0 -or $taskNodeVersion -cne 'v24.22.1') { throw 'Release requires exactly Node v24.22.1.' }
$taskArchitecture = & $taskNodePath -p 'process.platform + process.arch'
if ($LASTEXITCODE -ne 0 -or $taskArchitecture -cne 'win32x64') { throw 'This release targets Windows x64; use a Windows x64 Node executable.' }
$taskPnpmVersion = & pnpm --version
if ($LASTEXITCODE -ne 0 -or $taskPnpmVersion -cne '11.25.0') { throw 'Release requires pnpm 11.25.0 for the documented frozen-lockfile installation.' }
$taskLicense = Join-Path $taskProjectRoot 'docs\licenses\NODE-LICENSE.txt'
if (!(Test-Path -LiteralPath $taskLicense -PathType Leaf)) { throw 'The Node v24.22.1 redistribution license is required.' }
if (!$SkipBuild) { & pnpm build; if ($LASTEXITCODE -ne 0) { throw 'Frontend/type build failed; no release was created.' } }
if (!(Test-Path -LiteralPath (Join-Path $taskProjectRoot 'dist\index.html') -PathType Leaf)) { throw 'dist/index.html is missing. Build the current source before packaging.' }

$taskReleaseRoot = [IO.Path]::GetFullPath((Join-Path $taskProjectRoot 'release'))
Assert-CounterLabDPath $taskReleaseRoot
$taskOutput = Join-Path $taskReleaseRoot ('CounterLab-win-x64-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
Assert-CounterLabDPath $taskOutput
if (Test-Path -LiteralPath $taskOutput) { throw 'Release output already exists; refusing to overwrite.' }
New-Item -ItemType Directory -Path $taskOutput,(Join-Path $taskOutput 'runtime'),(Join-Path $taskOutput 'scripts'),(Join-Path $taskOutput 'src') | Out-Null
# Explicit allowlist: no private .env, databases, developer history or source node_modules.
foreach ($taskFile in @('package.json','pnpm-lock.yaml','pnpm-workspace.yaml','.env.example','README.md','Start-CounterLab.cmd')) {
  Copy-Item -LiteralPath (Join-Path $taskProjectRoot $taskFile) -Destination $taskOutput
}
foreach ($taskFolder in @('dist','server','examples')) { Copy-Item -LiteralPath (Join-Path $taskProjectRoot $taskFolder) -Destination $taskOutput -Recurse }
foreach ($taskFolder in @('engine','shared')) { Copy-Item -LiteralPath (Join-Path $taskProjectRoot ('src\' + $taskFolder)) -Destination (Join-Path $taskOutput 'src') -Recurse }
foreach ($taskScript in @('env.ps1','start.ps1')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $taskScript) -Destination (Join-Path $taskOutput 'scripts') }
Copy-Item -LiteralPath $taskNodePath -Destination (Join-Path $taskOutput 'runtime\node.exe')
Copy-Item -LiteralPath $taskLicense -Destination (Join-Path $taskOutput 'runtime\LICENSE.txt')
New-Item -ItemType Directory -Path (Join-Path $taskOutput 'docs\licenses'),(Join-Path $taskOutput 'docs\design') | Out-Null
foreach ($taskDoc in @('USER_GUIDE.md','ARCHITECTURE.md','KNOWN_LIMITS.md','THIRD_PARTY.md','REPRODUCIBILITY.md','DEVELOPMENT_PLAN.md','ACCEPTANCE.md','TEST_REPORT.md')) { Copy-Item -LiteralPath (Join-Path $taskProjectRoot ('docs\' + $taskDoc)) -Destination (Join-Path $taskOutput 'docs') }
Copy-Item -LiteralPath (Join-Path $taskProjectRoot 'docs\screenshots') -Destination (Join-Path $taskOutput 'docs') -Recurse
New-Item -ItemType Directory -Path (Join-Path $taskOutput 'evidence') | Out-Null
foreach ($taskEvidence in @('README.md','engine-development.md','server-development.md','ITERATION_CHAINS.md','ui-development.md','ui-component-review.md','000-kickoff.md')) { Copy-Item -LiteralPath (Join-Path $taskProjectRoot ('evidence\' + $taskEvidence)) -Destination (Join-Path $taskOutput 'evidence') }
# Keep private/raw history out of the portable package; link its public source record instead.
$taskPackagedIndex = Join-Path $taskOutput 'evidence\ITERATION_CHAINS.md'
$taskPackagedIndexText = Get-Content -LiteralPath $taskPackagedIndex -Raw -Encoding UTF8
$taskPackagedIndexText = $taskPackagedIndexText.Replace('[可见历史快照](visible-history-20261115.json)', '[可见历史快照（源码仓库）](https://github.com/lsh666-vs/zhichuanbei1/blob/main/evidence/visible-history-20261115.json)')
[IO.File]::WriteAllText($taskPackagedIndex, $taskPackagedIndexText, [Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath $taskLicense -Destination (Join-Path $taskOutput 'docs\licenses\NODE-LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $taskProjectRoot 'docs\design\ASSETS.md') -Destination (Join-Path $taskOutput 'docs\design\ASSETS.md')
Copy-Item -LiteralPath (Join-Path $taskProjectRoot 'docs\design\workbench-reference-v1.png') -Destination (Join-Path $taskOutput 'docs\design\workbench-reference-v1.png')

# Copy imports avoid hardlinks to the store; hoisting avoids source-workspace symlinks.
$taskInstallArguments = @('--dir',$taskOutput,'install','--prod','--frozen-lockfile','--ignore-scripts','--config.node-linker=hoisted','--config.package-import-method=copy',('--store-dir=' + $env:pnpm_config_store_dir))
if (!$AllowNetwork) { $taskInstallArguments += '--offline' }
& pnpm @taskInstallArguments
if ($LASTEXITCODE -ne 0) { throw 'Clean production install failed. Populate the D: pnpm cache with pnpm install --frozen-lockfile, or rerun with -AllowNetwork. Incomplete output was retained for diagnosis; no ZIP was published.' }

$taskEntries = @(Get-ChildItem -LiteralPath $taskOutput -Recurse -Force)
if ($taskEntries | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 }) { throw 'The release contains a junction/symlink. Refusing a nonportable package.' }
$taskForbiddenFiles = @($taskEntries | Where-Object {
  (!$_.PSIsContainer -and ($_.Name -eq '.env' -or ($_.Name -like '.env.*' -and $_.Name -ne '.env.example') -or $_.Name -match '\.(?:sqlite(?:-.*)?|db(?:-.*)?|pem|key)$' -or $_.Name -like 'id_ed25519*' -or $_.Name -like 'id_rsa*')) -or
  ($_.PSIsContainer -and $_.Name -in @('.runtime','.git'))
})
if ($taskForbiddenFiles.Count -gt 0) { throw ('Release contains forbidden private/runtime artifacts: ' + (($taskForbiddenFiles | ForEach-Object { $_.FullName.Substring($taskOutput.Length + 1) }) -join ', ')) }
$taskSecretTextFiles = @($taskEntries | Where-Object { !$_.PSIsContainer -and $_.Extension -in @('.js','.cjs','.mjs','.json','.md','.txt','.yaml','.yml','.ts','.ps1','.cmd','.html','.css','.svg') })
foreach ($taskTextFile in $taskSecretTextFiles) {
  if (Select-String -LiteralPath $taskTextFile.FullName -Pattern '-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----','\bsk-[A-Za-z0-9_-]{20,}\b' -Quiet) {
    throw ('A possible private key/token was found in ' + $taskTextFile.FullName.Substring($taskOutput.Length + 1) + '; no secret content was printed.')
  }
}

# Verify loading from the release root with only its copied runtime/dependencies.
Push-Location -LiteralPath $taskOutput
try {
  $taskSmokeScript = @'
import {evaluate,demoInstance,defaultStrategy} from './src/engine/index.ts';
import {buildApp} from './server/app.ts';
for(const domain of ['interval','knapsack','graph']){const result=evaluate(demoInstance(domain),defaultStrategy(domain));if(result.verdict!=='counterexample'||!result.witnessVerified)throw new Error('Release witness verification failed: '+domain)}
if(typeof buildApp!=='function')throw new Error('Release server dependencies did not load');
process.stdout.write('Standalone production dependencies and three domain witnesses verified.\n');
'@
  & (Join-Path $taskOutput 'runtime\node.exe') --import tsx --input-type=module -e $taskSmokeScript
  if ($LASTEXITCODE -ne 0) { throw 'Standalone dependency/witness smoke check failed; no ZIP was published.' }
} finally { Pop-Location }

$taskPackage = Get-Content -LiteralPath (Join-Path $taskOutput 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$taskFileManifest = @(Get-ChildItem -LiteralPath $taskOutput -Recurse -Force -File | Sort-Object FullName | ForEach-Object {
  [ordered]@{ path=$_.FullName.Substring($taskOutput.Length + 1).Replace('\','/'); bytes=$_.Length; sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
})
$taskManifest = [ordered]@{format='counterlab-release';version=1;createdAt=(Get-Date).ToUniversalTime().ToString('o');packageVersion=$taskPackage.version;platform='win32';architecture='x64';nodeVersion=$taskNodeVersion;pnpmVersion=$taskPnpmVersion;files=$taskFileManifest}
$taskManifestText = $taskManifest | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText((Join-Path $taskOutput 'RELEASE-MANIFEST.json'), $taskManifestText, [Text.UTF8Encoding]::new($false))
$taskZip = $taskOutput + '.zip'
Assert-CounterLabDPath $taskZip
Compress-Archive -LiteralPath $taskOutput -DestinationPath $taskZip -CompressionLevel Optimal
$taskArchiveHash = (Get-FileHash -LiteralPath $taskZip -Algorithm SHA256).Hash.ToLowerInvariant()
($taskArchiveHash + '  ' + (Split-Path -Leaf $taskZip)) | Set-Content -LiteralPath ($taskZip + '.sha256') -Encoding ASCII
Write-Output ('Release folder: ' + $taskOutput)
Write-Output ('ZIP: ' + $taskZip)
Write-Output ('SHA256: ' + $taskArchiveHash)
