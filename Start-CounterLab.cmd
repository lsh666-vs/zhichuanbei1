@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1"
set "COUNTERLAB_EXIT_CODE=%ERRORLEVEL%"
if not "%COUNTERLAB_EXIT_CODE%"=="0" pause
exit /b %COUNTERLAB_EXIT_CODE%
