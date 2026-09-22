@echo off
title CIMS Server Launcher

echo =================================================
echo  Starting CIMS in Single-Port Mode (Port 5000)
echo =================================================
echo.

echo [1/3] Building the frontend application...
echo      (This may take a minute)
cd frontend
call npm run build
echo.
echo      ...Frontend build complete.
echo.

echo [1.5/3] Checking for running servers on port 5000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5000" ^| findstr "LISTENING"') do (
    echo      Found existing process with PID %%a. Attempting to stop it...
    taskkill /F /PID %%a > nul
    echo      ...Process stopped.
)
echo      Port 5000 is clear.
echo.

echo [2/3] Starting the backend server...
cd ../backend
start "CIMS Backend" cmd /k "npm start"
echo.
echo      ...Backend server is starting in a new window.
echo.

echo [3/3] Opening the application in your browser...
timeout /t 5 /nobreak > nul
start http://localhost:5000
echo.
echo      ...Done! The application is running at http://localhost:5000
echo.

pause