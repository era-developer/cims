@echo off
echo CIMS -- Component Inventory Management System
echo ==============================================

where node >nul 2>&1
if %errorlevel% neq 0 (
  echo ERROR: Node.js not found. Install from https://nodejs.org
  pause
  exit /b 1
)

echo Installing backend...
cd backend
call npm install

echo Installing frontend...
cd ..\frontend
call npm install

echo Building frontend...
call npm run build

echo Starting CIMS server...
cd ..\backend
node server.js

pause
