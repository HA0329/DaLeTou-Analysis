@echo off
rem ============================================================
rem  DaLeTou Analysis - one-click launcher (Windows)
rem  1) check Node.js  2) start local server  3) open browser
rem  ASCII-only output on purpose: avoids console codepage issues
rem ============================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install Node.js 18+ from https://nodejs.org/
  echo         Then run this file again.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 18 (
  echo [WARN] Node.js %NODE_MAJOR% detected; 18+ is recommended.
  echo        Browsing still works, but "Online update" / "Write data file" need Node 18+.
)

echo Starting local server (http://127.0.0.1:8123/) ...
start "DaLeTou Server" /min cmd /c "node server.js"

rem Wait for /health up to ~10s so the browser never opens a dead page
set /a tries=0
:waitloop
set /a tries+=1
curl -s -o nul --max-time 2 http://127.0.0.1:8123/health
if not errorlevel 1 goto ready
if %tries% LSS 10 (
  timeout /t 1 /nobreak >nul
  goto waitloop
)
echo [WARN] Server did not answer in 10s; opening browser anyway.
echo        Check the minimized "DaLeTou Server" window for errors.

:ready
start "" "http://127.0.0.1:8123/"
endlocal
