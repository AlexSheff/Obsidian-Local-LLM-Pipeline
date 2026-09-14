@echo off
setlocal
cd /d "%~dp0"

echo ===================================================
echo   Hermes Local Intelligence - Startup Script
echo ===================================================
echo.

echo [1/3] Starting Llama 3.1 Server in a new window...
start "Hermes Llama Server" cmd /k ".\llm\bin\llama-server.exe -m .\llm\models\Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf -c 6000 -t 6 -ngl -1"

echo [2/3] Waiting 5 seconds for the AI model to load...
timeout /t 5 /nobreak > nul

echo [3/3] Starting Hermes Web Dashboard...
start http://localhost:3000

echo.
echo ===================================================
echo   Dashboard is opening in your browser!
echo   Keep this window open to run the Node.js server.
echo   Press Ctrl+C to stop.
echo ===================================================
call npm run start
