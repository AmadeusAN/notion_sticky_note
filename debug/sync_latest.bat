@echo off
setlocal EnableExtensions
rem Sync the newest built sticky-note exe into this debug working dir.
rem Source: src-tauri/target/release (falls back to target/debug)
rem Target: debug\app\latest.exe  +  timestamped history copy
cd /d "%~dp0.."

set "SRC=src-tauri\target\release"
if not exist "%SRC%\*.exe" set "SRC=src-tauri\target\debug"

set "NEWEST="
for /f "delims=" %%F in ('dir /b /o-d /a-d "%SRC%\*.exe" 2^>nul') do (
  if not defined NEWEST set "NEWEST=%%F"
)
if not defined NEWEST (
  echo [sync] No built exe found under %SRC%
  echo [sync] Run "npm run tauri build" first, then retry.
  exit /b 1
)

set "APP=%~dp0app"
if not exist "%APP%" mkdir "%APP%"
if not exist "%APP%\history" mkdir "%APP%\history"

rem Format file mtime as a filename-safe stamp, e.g. 2026-10-29_22-15-04
set "STAMP="
for %%A in ("%SRC%\%NEWEST%") do set "STAMP=%%~tA"
set "STAMP=%STAMP: =_%"
set "STAMP=%STAMP:/=-%"
set "STAMP=%STAMP::=-%"

copy /y "%SRC%\%NEWEST%" "%APP%\latest.exe" >nul
if errorlevel 1 (
  echo [sync] Copy failed.
  exit /b 1
)
copy /y "%SRC%\%NEWEST%" "%APP%\history\%STAMP%_%NEWEST%" >nul

for %%A in ("%APP%\latest.exe") do set "SIZE=%%~zA"
echo [sync] OK: %SRC%\%NEWEST%  -^>  debug\app\latest.exe  (%SIZE% bytes)
exit /b 0