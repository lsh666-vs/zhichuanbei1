param([string]$Python = 'D:\Dev\Python312\python.exe')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'env.ps1')
$taskProject = Split-Path $PSScriptRoot -Parent
$taskVenvPython = Join-Path $taskProject '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $taskVenvPython)) {
  $taskBootstrap = Join-Path $taskProject '.runtime\bootstrap'
  & $Python -m pip install --target $taskBootstrap 'virtualenv==21.15.6'
  if ($LASTEXITCODE -ne 0) { throw 'virtualenv bootstrap failed' }
  # The base embedded Python ignores PYTHONPATH; explicitly insert the D: bootstrap.
  & $Python -c 'import sys,runpy;sys.path.insert(0,sys.argv[1]);sys.argv=["virtualenv",sys.argv[2]];runpy.run_module("virtualenv",run_name="__main__")' $taskBootstrap (Join-Path $taskProject '.venv')
  if ($LASTEXITCODE -ne 0) { throw 'Isolated environment creation failed' }
}
& $taskVenvPython -m pip install -r (Join-Path $taskProject 'requirements-win-py312.lock')
if ($LASTEXITCODE -ne 0) { throw 'Pinned dependency installation failed' }
& $taskVenvPython -m pip install --no-deps --no-build-isolation -e $taskProject
if ($LASTEXITCODE -ne 0) { throw 'Project installation failed' }
& $taskVenvPython -m lightforge.cli --help
if ($LASTEXITCODE -ne 0) { throw 'CLI import check failed' }
