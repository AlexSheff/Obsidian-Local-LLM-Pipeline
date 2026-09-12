#!/bin/bash
cd "$(dirname "$0")"
echo "==================================================="
echo "  Hermes Local Intelligence - Startup Script"
echo "==================================================="
echo ""

echo "[1/3] Starting Llama 3.1 Server in background..."
chmod +x ./llm/bin/llama-server
./llm/bin/llama-server -m ./llm/models/Hermes-3-Llama-3.2-3B.Q4_K_M.gguf -c 2048 -ngl -1 > ./llm/server.log 2>&1 &
LLAMA_PID=$!

echo "[2/3] Waiting 5 seconds for the AI model to load..."
sleep 5

echo "[3/3] Starting Hermes Web Dashboard..."
echo "Dashboard running at http://localhost:3000"
echo "Press Ctrl+C to stop both servers."

# Trap Ctrl+C and kill background llama-server
trap "echo 'Stopping Llama Server...'; kill $LLAMA_PID; exit" INT TERM

npm run start
