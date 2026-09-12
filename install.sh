#!/bin/bash
echo "==================================================="
echo "  Hermes Local Intelligence - Installation Script"
echo "==================================================="
echo ""
echo "Checking for Node.js..."
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed!"
    echo "Please install Node.js (v18+) via your package manager."
    exit 1
fi

echo "[1/3] Installing dependencies..."
npm install

echo ""
echo "[2/3] Downloading local AI Model and Llama Server..."
node scripts/setup-llm.js
if [ $? -ne 0 ]; then
    echo "[ERROR] Failed to download LLM components."
    exit 1
fi

echo ""
echo "[3/3] Building the application..."
npm run build

echo ""
echo "==================================================="
echo "  Installation Complete!"
echo "  Run './start.sh' to launch the app."
echo "==================================================="
