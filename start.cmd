@echo off
rem Windows: double-click to start Edgelands and open it in the browser.
cd /d "%~dp0"
where bun >nul 2>nul || (
  echo Bun is not installed. Install it with this command in PowerShell, then double-click start.cmd again:
  echo   powershell -c "irm bun.sh/install.ps1 ^| iex"
  pause
  exit /b 1
)
bun start
pause
