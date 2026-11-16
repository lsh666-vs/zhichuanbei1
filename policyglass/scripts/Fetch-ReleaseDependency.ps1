param([Parameter(Mandatory=$true)][string]$Url, [Parameter(Mandatory=$true)][string]$OutFile)
$ErrorActionPreference = 'Stop'
$PolicyGlassDownloadTarget = [IO.Path]::GetFullPath($OutFile)
if ([IO.Path]::GetPathRoot($PolicyGlassDownloadTarget) -ine 'D:\') { throw 'Release downloads must stay on D:.' }
if (-not $Url.StartsWith('https://', [StringComparison]::OrdinalIgnoreCase)) { throw 'Official dependency transport must use HTTPS.' }
if (Test-Path -LiteralPath $PolicyGlassDownloadTarget) { throw 'Download target already exists; preserve it and use a new path.' }
Invoke-WebRequest -Uri $Url -OutFile $PolicyGlassDownloadTarget -TimeoutSec 90
