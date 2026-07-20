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

echo [Rift Forge] Starting the game...
echo Keep this window open while playing.
node.exe "node_modules\vite\bin\vite.js" --open /

if errorlevel 1 (
  echo.
  echo [Rift Forge] The game server stopped with an error.
  pause
)
