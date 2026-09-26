@echo off
setlocal
cd /d "%~dp0"

echo ===================================================
echo   Obsidian Local LLM Pipeline - Startup Script
echo ===================================================
echo.

REM Allocate 4GB max heap to Node.js to prevent OOM on large vaults
set NODE_OPTIONS=--max-old-space-size=4096

echo [1/3] Starting Llama Server in a new window (if present in .\llm\bin)...
if exist ".\llm\bin\llama-server.exe" (
    start "Obsidian Local LLM Pipeline Llama Server" cmd /k ".\llm\bin\llama-server.exe -m .\llm\models\Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf -c 4096 -np 1 -t 4"
    echo [2/3] Waiting 5 seconds for the AI model to load...
    timeout /t 5 /nobreak > nul
) else (
    echo [1/3] Custom model path used. JEV / Primary servers managed via Web UI or external launcher.
)

echo [3/3] Starting Obsidian Local LLM Pipeline Web Dashboard...
start http://localhost:3000

:server_loop
echo.
echo ===================================================
echo   Dashboard is running at http://localhost:3000
echo   Keep this window open to run the Node.js server.
echo   Press Ctrl+C to stop.
echo ===================================================
if exist "server.ts" (
    call npm run build
)
if exist "dist\server.cjs" (
    call npm run start
) else (
    call npm run dev
)

echo.
echo [WARNING] Server process exited with code %ERRORLEVEL%.
echo Check emergency_crash_log.txt for details if this was unexpected.
choice /C YN /T 5 /D Y /M "Restart the Node.js server automatically?"
if errorlevel 2 goto :end
goto :server_loop

:end
pause
