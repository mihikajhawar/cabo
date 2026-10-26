@echo off
title Cabo
cd /d "%~dp0"
if not exist node_modules (
  echo First run: installing, this takes a few minutes...
  call npm install
)
echo.
echo Starting Cabo. When you see "Ready", open http://localhost:3000
echo Keep this window open while playing. Close it to stop the game.
echo.
start "" /min cmd /c "timeout /t 8 >nul & start http://localhost:3000"
call npm run dev
pause
