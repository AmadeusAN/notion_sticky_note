@echo off
setlocal EnableExtensions
rem One-click open of the newest built sticky-note exe.
rem Syncs first so it always launches the latest build.
cd /d "%~dp0"
rem Close a running instance so the exe file lock is released before overwrite
taskkill /f /im latest.exe >nul 2>&1
ping -n 2 127.0.0.1 >nul
call "%~dp0sync_latest.bat"
if errorlevel 1 (
  echo.
  echo [run] Nothing to launch: no built exe yet. Run "npm run tauri build" first, then retry.
  pause
  exit /b 1
)
start "" "%CD%\app\latest.exe"