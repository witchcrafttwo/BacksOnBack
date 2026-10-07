@echo off
rem BacksOnBacks - one-click internet launch: production server + Cloudflare quick tunnel.
rem Builds only when the source changed, serves dist on the LAN (port 4173),
rem and publishes it on the internet at a https://*.trycloudflare.com URL (needs cloudflared).
rem The actual work is done by "scripts\serve.mjs --tunnel" (same as "npm run tunnel").
rem Keep this file ASCII-only: cmd.exe reads batch files in the OEM code page.
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js was not found. Please install Node.js and try again.
  pause
  exit /b 1
)
node scripts\serve.mjs --tunnel
pause
