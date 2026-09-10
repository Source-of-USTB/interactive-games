@echo off
setlocal
where pwsh >nul 2>nul && (set "PS=pwsh") || (set "PS=powershell")
"%PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0diagnose-easy-public.ps1" %*
exit /b %errorlevel%
