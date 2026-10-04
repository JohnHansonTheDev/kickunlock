@echo off
title KickUnlock Server
cd /d "%~dp0"

echo ============================================
echo  KickUnlock v1.0.0-alpha - free Kick streams
echo ============================================
echo.

rem Prefer the bundled portable Node (no install needed).
set NODE_EXE=%~dp0runtime\node.exe
if not exist "%NODE_EXE%" (
  where node >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] No Node.js found and no bundled runtime.
    echo Get Node from https://nodejs.org/ or restore the runtime\ folder.
    pause
    exit /b 1
  )
  set NODE_EXE=node
  echo [INFO] Using system Node.js.
) else (
  echo [INFO] Using bundled portable Node (nothing to install).
)
echo.
echo [START] Launching server... watch this window for logs.
echo  App will open at http://localhost:3001
echo  Close this window to stop the server.
echo  --------------------------------------------
echo.

start "" "http://localhost:3001"
call "%NODE_EXE%" server.js

pause
