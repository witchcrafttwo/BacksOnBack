@echo off
rem BacksOnBacks - one-click production server.
rem Builds only when the source changed since the last build, then serves dist on the LAN (port 4173).
rem The actual work is done by scripts\serve.mjs (same as "npm run lan").
rem Keep this file ASCII-only: cmd.exe reads batch files in the OEM code page.
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js was not found. Please install Node.js and try again.
  pause
  exit /b 1
)
node scripts\serve.mjs
pause
