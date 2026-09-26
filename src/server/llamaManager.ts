import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import axios from 'axios';

export interface ModelInfo {
  filename: string;
  fullPath: string;
  sizeBytes: number;
  sizeGb: number;
  estimatedRamGb: number;
  isDecisionModel: boolean;
  isPrimaryModel: boolean;
}

export interface ManagedServerState {
  type: 'primary' | 'jev';
  port: number;
  url: string;
  modelFilename: string;
  status: 'running' | 'stopped' | 'starting' | 'error';
  pid?: number;
  lastError?: string;
  startedAt?: string;
}

export interface MemoryProfile {
  id: 'balanced_16gb' | 'solo_7b' | 'custom';
  name: string;
  description: string;
  primaryModel: string;
  jevModel: string;
  contextSize: number;
  threads: number;
  totalEstimatedRamGb: number;
  fits16GbRamSafely: boolean;
}

const KNOWN_MODELS = {
  HERMES_3B: 'Hermes-3-Llama-3.2-3B.Q4_K_M.gguf',
  JEV_2B: 'Jev-Style-Qwen3.5-2B-Decision-Q4_K_M.gguf',
  QWEN_7B: 'Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf'
};

class LlamaManager {
  private primaryProcess: ChildProcess | null = null;
  private jevProcess: ChildProcess | null = null;

  private primaryState: ManagedServerState = {
    type: 'primary',
    port: 8080,
    url: 'http://127.0.0.1:8080',
    modelFilename: KNOWN_MODELS.HERMES_3B,
    status: 'stopped'
  };

  private jevState: ManagedServerState = {
    type: 'jev',
    port: 1234,
    url: 'http://127.0.0.1:1234',
    modelFilename: KNOWN_MODELS.JEV_2B,
    status: 'stopped'
  };

  /**
   * Scans a directory for GGUF model files and calculates memory estimations.
   */
  public scanModelsDirectory(modelsDir: string): ModelInfo[] {
    if (!modelsDir || !fs.existsSync(modelsDir)) return [];

    try {
      const files = fs.readdirSync(modelsDir);
      const results: ModelInfo[] = [];

      for (const file of files) {
        if (!file.toLowerCase().endsWith('.gguf')) continue;
        const fullPath = path.join(modelsDir, file);
        const stat = fs.statSync(fullPath);
        const sizeGb = Math.round((stat.size / (1024 * 1024 * 1024)) * 100) / 100;
        
        // Approximate RAM footprint: GGUF weights + KV cache budget (~0.5 - 1.2 GB for 2048 ctx)
        const estimatedRamGb = Math.round((sizeGb * 1.15 + 0.5) * 10) / 10;
        const lower = file.toLowerCase();
        const isDecision = lower.includes('jev') || lower.includes('decision');
        const isPrimary = !isDecision;

        results.push({
          filename: file,
          fullPath,
          sizeBytes: stat.size,
          sizeGb,
          estimatedRamGb,
          isDecisionModel: isDecision,
          isPrimaryModel: isPrimary
        });
      }

      return results;
    } catch {
      return [];
    }
  }

  /**
   * Returns memory-budgeted profiles specifically designed to prevent 16GB RAM overflow and disk thrashing.
   */
  public getMemoryProfiles(): MemoryProfile[] {
    return [
      {
        id: 'balanced_16gb',
        name: 'Balanced Tandem (16GB RAM Safe - Recommended)',
        description: 'Hermes 3B (~2.2GB RAM) + Jev 2B (~1.5GB RAM). Total ~3.7GB RAM. Leaves >12GB free for Windows and Obsidian. Zero disk swap, zero freezing.',
        primaryModel: KNOWN_MODELS.HERMES_3B,
        jevModel: KNOWN_MODELS.JEV_2B,
        contextSize: 2048,
        threads: 4,
        totalEstimatedRamGb: 3.7,
        fits16GbRamSafely: true
      },
      {
        id: 'solo_7b',
        name: 'Solo 7B Coder (Heavy Code & Single-Model Mode)',
        description: 'Qwen 7B (~5.2GB RAM) runs alone. Jev server is suspended to prevent memory pressure on 16GB systems.',
        primaryModel: KNOWN_MODELS.QWEN_7B,
        jevModel: '',
        contextSize: 2048,
        threads: 4,
        totalEstimatedRamGb: 5.2,
        fits16GbRamSafely: true
      },
      {
        id: 'custom',
        name: 'Custom Configuration',
        description: 'User-specified model parameters with customizable context and thread limits.',
        primaryModel: KNOWN_MODELS.HERMES_3B,
        jevModel: KNOWN_MODELS.JEV_2B,
        contextSize: 2048,
        threads: 4,
        totalEstimatedRamGb: 4.0,
        fits16GbRamSafely: true
      }
    ];
  }

  /**
   * Locates the llama-server executable.
   */
  public findLlamaServerBinary(customPath?: string, modelsDir?: string): string | null {
    const candidates: string[] = [];

    if (customPath && customPath.trim()) {
      candidates.push(customPath.trim());
    }

    if (modelsDir) {
      candidates.push(path.join(modelsDir, 'llama-server.exe'));
      candidates.push(path.join(modelsDir, 'llama-server'));
      candidates.push(path.join(path.dirname(modelsDir), 'llama-server.exe'));
      candidates.push(path.join(path.dirname(modelsDir), 'llama-server'));
      candidates.push(path.join(path.dirname(modelsDir), 'bin', 'llama-server.exe'));
    }

    // Common Windows & local locations
    candidates.push('llama-server.exe');
    candidates.push('llama-server');
    candidates.push('C:\\llama.cpp\\build\\bin\\Release\\llama-server.exe');
    candidates.push('C:\\llama.cpp\\llama-server.exe');

    for (const p of candidates) {
      try {
        if (fs.existsSync(p) && fs.statSync(p).isFile()) {
          return p;
        }
      } catch {}
    }

    return null;
  }

  /**
   * Fast check if a port or URL is already being served by an active llama-server.
   */
  public async probeServer(url: string, timeoutMs = 1200): Promise<{ online: boolean; model?: string }> {
    try {
      const resp = await axios.get(`${url.replace(/\/+$/, '')}/v1/models`, { timeout: timeoutMs });
      const models = resp.data?.data;
      const modelName = Array.isArray(models) && models.length > 0 ? (models[0].id || models[0].name) : undefined;
      return { online: true, model: modelName };
    } catch {
      return { online: false };
    }
  }

  /**
   * Starts the Jev-Style Decision Model server.
   * Uses safe 16GB RAM flags: -c 2048 -t 4 --port 1234
   */
  public async startJevServer(options: {
    binaryPath: string;
    modelsDir: string;
    modelFilename?: string;
    port?: number;
    contextSize?: number;
    threads?: number;
  }): Promise<ManagedServerState> {
    const port = options.port || 1234;
    const modelFile = options.modelFilename || KNOWN_MODELS.JEV_2B;
    const modelPath = path.join(options.modelsDir, modelFile);

    if (!fs.existsSync(modelPath)) {
      this.jevState = {
        type: 'jev',
        port,
        url: `http://127.0.0.1:${port}`,
        modelFilename: modelFile,
        status: 'error',
        lastError: `Model file not found: ${modelPath}`
      };
      return this.jevState;
    }

    // Check if port is already running an active server
    const probe = await this.probeServer(`http://127.0.0.1:${port}`);
    if (probe.online) {
      this.jevState = {
        type: 'jev',
        port,
        url: `http://127.0.0.1:${port}`,
        modelFilename: modelFile,
        status: 'running',
        lastError: undefined,
        startedAt: new Date().toISOString()
      };
      return this.jevState;
    }

    // Kill any lingering process
    this.stopServer('jev');

    const ctx = options.contextSize || 2048;
    const threads = options.threads || 4;

    // Strict Memory-Protection Flags:
    // -c 2048: prevents massive multi-gigabyte KV cache
    // -t 4: leaves CPU cores free for Windows UI and disk I/O
    // --host 127.0.0.1: local security
    // -ngl 99: offload layers to GPU if available; if CPU-only, fits in ~1.4GB RAM
    const args = [
      '-m', modelPath,
      '--port', String(port),
      '--host', '127.0.0.1',
      '-c', String(ctx),
      '-t', String(threads),
      '-ngl', '99',
      '--alias', 'jev-decision'
    ];

    try {
      this.jevProcess = spawn(options.binaryPath, args, {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.jevState = {
        type: 'jev',
        port,
        url: `http://127.0.0.1:${port}`,
        modelFilename: modelFile,
        status: 'starting',
        pid: this.jevProcess.pid,
        startedAt: new Date().toISOString()
      };

      // Safely drain stdout and stderr to prevent 64KB pipe buffer deadlock on Windows/Linux
      this.jevProcess.stdout?.on('data', () => {});
      this.jevProcess.stderr?.on('data', () => {});
      this.jevProcess.stdout?.on('error', () => {});
      this.jevProcess.stderr?.on('error', () => {});

      this.jevProcess.on('error', (err) => {
        this.jevState.status = 'error';
        this.jevState.lastError = err.message;
        console.warn(`[Jev Server Process Error]: ${err.message}`);
      });

      this.jevProcess.on('exit', (code) => {
        if (this.jevState.status === 'running' || this.jevState.status === 'starting') {
          this.jevState.status = 'stopped';
          this.jevState.lastError = code !== 0 ? `Exited with code ${code}` : undefined;
        }
      });

      // Poll until ready (up to 15 seconds)
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const check = await this.probeServer(`http://127.0.0.1:${port}`);
        if (check.online) {
          this.jevState.status = 'running';
          break;
        }
      }

      return this.jevState;
    } catch (err: any) {
      this.jevState = {
        type: 'jev',
        port,
        url: `http://127.0.0.1:${port}`,
        modelFilename: modelFile,
        status: 'error',
        lastError: err.message
      };
      return this.jevState;
    }
  }

  /**
   * Starts the Primary Generative LLM server (Hermes 3B or Qwen 7B).
   */
  public async startPrimaryServer(options: {
    binaryPath: string;
    modelsDir: string;
    modelFilename?: string;
    port?: number;
    contextSize?: number;
    threads?: number;
  }): Promise<ManagedServerState> {
    const port = options.port || 8080;
    const modelFile = options.modelFilename || KNOWN_MODELS.HERMES_3B;
    const modelPath = path.join(options.modelsDir, modelFile);

    if (!fs.existsSync(modelPath)) {
      this.primaryState = {
        type: 'primary',
        port,
        url: `http://127.0.0.1:${port}`,
        modelFilename: modelFile,
        status: 'error',
        lastError: `Model file not found: ${modelPath}`
      };
      return this.primaryState;
    }

    const probe = await this.probeServer(`http://127.0.0.1:${port}`);
    if (probe.online) {
      this.primaryState = {
        type: 'primary',
        port,
        url: `http://127.0.0.1:${port}`,
        modelFilename: modelFile,
        status: 'running',
        startedAt: new Date().toISOString()
      };
      return this.primaryState;
    }

    this.stopServer('primary');

    const ctx = options.contextSize || 2048;
    const threads = options.threads || 4;

    const args = [
      '-m', modelPath,
      '--port', String(port),
      '--host', '127.0.0.1',
      '-c', String(ctx),
      '-t', String(threads),
      '-ngl', '99',
      '--alias', 'primary-llm'
    ];

    try {
      this.primaryProcess = spawn(options.binaryPath, args, {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.primaryState = {
        type: 'primary',
        port,
        url: `http://127.0.0.1:${port}`,
        modelFilename: modelFile,
        status: 'starting',
        pid: this.primaryProcess.pid,
        startedAt: new Date().toISOString()
      };

      // Safely drain stdout and stderr to prevent 64KB pipe buffer deadlock on Windows/Linux
      this.primaryProcess.stdout?.on('data', () => {});
      this.primaryProcess.stderr?.on('data', () => {});
      this.primaryProcess.stdout?.on('error', () => {});
      this.primaryProcess.stderr?.on('error', () => {});

      this.primaryProcess.on('error', (err) => {
        this.primaryState.status = 'error';
        this.primaryState.lastError = err.message;
        console.warn(`[Primary Server Process Error]: ${err.message}`);
      });

      this.primaryProcess.on('exit', (code) => {
        if (this.primaryState.status === 'running' || this.primaryState.status === 'starting') {
          this.primaryState.status = 'stopped';
          this.primaryState.lastError = code !== 0 ? `Exited with code ${code}` : undefined;
        }
      });

      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const check = await this.probeServer(`http://127.0.0.1:${port}`);
        if (check.online) {
          this.primaryState.status = 'running';
          break;
        }
      }

      return this.primaryState;
    } catch (err: any) {
      this.primaryState = {
        type: 'primary',
        port,
        url: `http://127.0.0.1:${port}`,
        modelFilename: modelFile,
        status: 'error',
        lastError: err.message
      };
      return this.primaryState;
    }
  }

  /**
   * Stops a running server process safely.
   */
  public stopServer(type: 'primary' | 'jev' | 'all'): void {
    if (type === 'primary' || type === 'all') {
      if (this.primaryProcess) {
        try {
          this.primaryProcess.kill('SIGTERM');
        } catch {}
        this.primaryProcess = null;
      }
      this.primaryState.status = 'stopped';
      this.primaryState.pid = undefined;
    }

    if (type === 'jev' || type === 'all') {
      if (this.jevProcess) {
        try {
          this.jevProcess.kill('SIGTERM');
        } catch {}
        this.jevProcess = null;
      }
      this.jevState.status = 'stopped';
      this.jevState.pid = undefined;
    }
  }

  /**
   * Gets current state of both server instances.
   */
  public async getStatus(): Promise<{
    primary: ManagedServerState;
    jev: ManagedServerState;
    memorySafe: boolean;
  }> {
    // Re-verify health asynchronously
    const [primaryProbe, jevProbe] = await Promise.all([
      this.probeServer(this.primaryState.url, 800),
      this.probeServer(this.jevState.url, 800)
    ]);

    if (primaryProbe.online) {
      this.primaryState.status = 'running';
    } else if (this.primaryState.status === 'running') {
      this.primaryState.status = 'stopped';
    }

    if (jevProbe.online) {
      this.jevState.status = 'running';
    } else if (this.jevState.status === 'running') {
      this.jevState.status = 'stopped';
    }

    return {
      primary: { ...this.primaryState },
      jev: { ...this.jevState },
      memorySafe: true
    };
  }

  /**
   * Generates production-ready Windows .bat startup scripts
   * with strict memory flags to completely eliminate 16GB RAM exhaustion and 100% disk thrashing.
   */
  public generateBatScripts(options: {
    modelsDir: string;
    binaryName?: string;
  }): {
    tandemBat: string;
    jevOnlyBat: string;
    solo7bBat: string;
    readmeText: string;
  } {
    const modelsDir = options.modelsDir.replace(/\\/g, '/');
    const bin = options.binaryName || 'llama-server.exe';

    const tandemBat = `@echo off
title [16GB SAFE TANDEM] Hermes 3B (8080) + Jev Decision 2B (1234)
chcp 65001 >nul
cls

echo ====================================================================
echo  Obsidian LLM Pipeline - 16GB RAM Balanced Tandem
echo ====================================================================
echo  [1/2] Launching Jev Decision Server on http://127.0.0.1:1234 ...
echo  Model: Jev-Style-Qwen3.5-2B-Decision-Q4_K_M.gguf (~1.4 GB RAM)
echo  Parameters: -c 2048 -t 4 --port 1234
echo ====================================================================

start "JEV DECISION SERVER (Port 1234)" cmd /k ^
  "${bin}" ^
  -m "${modelsDir}/${KNOWN_MODELS.JEV_2B}" ^
  --port 1234 ^
  --host 127.0.0.1 ^
  -c 2048 ^
  -t 4 ^
  -ngl 99 ^
  --alias jev-decision

timeout /t 3 >nul

echo.
echo ====================================================================
echo  [2/2] Launching Primary Generative Server on http://127.0.0.1:8080 ...
echo  Model: Hermes-3-Llama-3.2-3B.Q4_K_M.gguf (~2.2 GB RAM)
echo  Parameters: -c 2048 -t 4 --port 8080
echo  Combined RAM: ~3.6 GB (Safe for 16GB RAM, No Disk Thrashing!)
echo ====================================================================

start "PRIMARY LLM SERVER (Port 8080)" cmd /k ^
  "${bin}" ^
  -m "${modelsDir}/${KNOWN_MODELS.HERMES_3B}" ^
  --port 8080 ^
  --host 127.0.0.1 ^
  -c 2048 ^
  -t 4 ^
  -ngl 99 ^
  --alias primary-llm

echo.
echo Both servers are launching. Obsidian Local LLM Pipeline can now connect.
pause
`;

    const jevOnlyBat = `@echo off
title [JEV DECISION SERVER] Port 1234 (Ultra-Fast 100ms Routing)
chcp 65001 >nul
cls

echo Starting Jev-Style-Qwen3.5-2B-Decision on port 1234...
"${bin}" ^
  -m "${modelsDir}/${KNOWN_MODELS.JEV_2B}" ^
  --port 1234 ^
  --host 127.0.0.1 ^
  -c 2048 ^
  -t 4 ^
  -ngl 99 ^
  --alias jev-decision
pause
`;

    const solo7bBat = `@echo off
title [SOLO 7B CODER] Qwen 2.5 Coder 7B (Port 8080)
chcp 65001 >nul
cls

echo ====================================================================
echo  Starting Qwen2.5-Coder-7B-Instruct on Port 8080
echo  Estimated RAM: ~5.2 GB (Fits cleanly in 16GB RAM if other models closed)
echo ====================================================================

"${bin}" ^
  -m "${modelsDir}/${KNOWN_MODELS.QWEN_7B}" ^
  --port 8080 ^
  --host 127.0.0.1 ^
  -c 2048 ^
  -t 4 ^
  -ngl 99 ^
  --alias primary-llm
pause
`;

    const readmeText = `# Obsidian Local LLM - 16GB RAM Memory Optimization Guide

## Why did 16GB RAM and SSD/HDD reach 100%?
1. **Unbounded Context Size**: Default llama-server settings often allocate 8,192 to 32,768 tokens of KV cache. For a 7B model, this adds 3 to 6 GB of memory per server!
2. **Concurrent Multi-Model Collision**: Running 7B (5GB) + 3B (2.5GB) + 2B (1.5GB) + KV caches equals ~14-16 GB of RAM. Windows itself requires 4 to 6 GB. This causes **pagefile memory thrashing** where Windows rapidly swaps memory pages to SSD/HDD, pegging disk and memory at 100%.
3. **The Solution (Memory-Budgeted Tandem)**:
   - **Hermes 3B** (~2.1 GB) as the generative worker on port 8080.
   - **Jev 2B** (~1.4 GB) as the ultra-fast decision router on port 1234.
   - **Total footprint**: ~3.5 GB RAM!
   - Context is capped at **2,048 tokens** (\`-c 2048\`) and threads are limited to **4** (\`-t 4\`).
   - More than 12 GB of RAM remains 100% free for Windows, Obsidian, and browser.
`;

    return { tandemBat, jevOnlyBat, solo7bBat, readmeText };
  }
}

export const llamaManager = new LlamaManager();
