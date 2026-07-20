@echo off
setlocal
title Rift Forge
cd /d "%~dp0"

where node.exe >nul 2>nul
if errorlevel 1 (
  echo [Rift Forge] Node.js was not found.
  echo Install Node.js, then run this file again.
  pause
  exit /b 1
)

if not exist "node_modules\vite\bin\vite.js" (
  echo [Rift Forge] Installing required packages...
  call npm.cmd ci
  if errorlevel 1 (
    echo [Rift Forge] Package installation failed.
    pause
    exit /b 1
  )
)

set "RIFT_PORT="
for /f "usebackq delims=" %%P in (`node.exe "scripts\find-open-port.mjs" 4173 4199`) do set "RIFT_PORT=%%P"
if not defined RIFT_PORT (
  echo [Rift Forge] Could not find a free local port from 4173 to 4199.
  echo Close another local server and try again.
  pause
  exit /b 1
)

echo [Rift Forge] Starting the game...
echo [Rift Forge] Address: http://127.0.0.1:%RIFT_PORT%/
echo Keep this window open while playing.
node.exe "node_modules\vite\bin\vite.js" --host 127.0.0.1 --port %RIFT_PORT% --strictPort --open /

if errorlevel 1 (
  echo.
  echo [Rift Forge] The game server stopped with an error.
  pause
)
