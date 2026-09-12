@echo off
echo ===================================================
echo   Hermes Local Intelligence - Installation Script
echo ===================================================
echo.
echo Checking for Node.js...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed! 
    echo Please download and install it from https://nodejs.org/
    echo.
    pause
    exit /b
)

echo [1/3] Installing dependencies (this may take a minute)...
call npm install

echo.
echo [2/3] Downloading local AI Model and Llama Server...
node scripts\setup-llm.js
if %errorlevel% neq 0 (
    echo [ERROR] Failed to download LLM components. Check your internet connection.
    pause
    exit /b
)

echo.
echo [3/3] Building the application...
call npm run build

echo.
echo ===================================================
echo   Installation Complete!
echo   You can now run 'start.bat' to launch the app.
echo ===================================================
pause
