import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  HardDrive,
  Cpu,
  Zap,
  Play,
  Square,
  RefreshCw,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Folder,
  Download,
  Sliders,
  ShieldCheck,
  Activity,
  Layers
} from 'lucide-react';

interface ModelInfo {
  filename: string;
  fullPath: string;
  sizeGb: number;
  estimatedRamGb: number;
  isDecisionModel: boolean;
  isPrimaryModel: boolean;
}

interface ServerStatus {
  type: 'primary' | 'jev';
  port: number;
  url: string;
  modelFilename: string;
  status: 'running' | 'stopped' | 'starting' | 'error';
  pid?: number;
  lastError?: string;
  startedAt?: string;
}

interface MemoryProfile {
  id: string;
  name: string;
  description: string;
  primaryModel: string;
  jevModel: string;
  contextSize: number;
  threads: number;
  totalEstimatedRamGb: number;
  fits16GbRamSafely: boolean;
}

interface ModelMemoryManagerProps {
  config: any;
  onSaveConfig: (updated: any) => Promise<void>;
  onNotify: () => void;
}

export default function ModelMemoryManager({ config, onSaveConfig, onNotify }: ModelMemoryManagerProps) {
  const [loading, setLoading] = useState(true);
  const [modelsDir, setModelsDir] = useState(config.modelsPath || 'D:/Obsidian/Alex/Vault/llm/models');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [profiles, setProfiles] = useState<MemoryProfile[]>([]);
  const [primaryServer, setPrimaryServer] = useState<ServerStatus | null>(null);
  const [jevServer, setJevServer] = useState<ServerStatus | null>(null);
  const [detectedBinary, setDetectedBinary] = useState<string | null>(null);
  const [binaryPathInput, setBinaryPathInput] = useState(config.llamaServerBinary || '');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [scriptsResult, setScriptsResult] = useState<any>(null);

  // Profile selection
  const [selectedProfile, setSelectedProfile] = useState<string>(config.memoryProfile || 'balanced_16gb');

  useEffect(() => {
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/models/status');
      setModels(res.data.models || []);
      setProfiles(res.data.profiles || []);
      setPrimaryServer(res.data.primaryServer || null);
      setJevServer(res.data.jevServer || null);
      setDetectedBinary(res.data.detectedBinary || null);
      if (res.data.modelsDir) setModelsDir(res.data.modelsDir);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleControlServer = async (type: 'primary' | 'jev' | 'all', action: 'start' | 'stop') => {
    setActionLoading(`${type}_${action}`);
    try {
      await axios.post('/api/models/control', { type, action });
      await fetchStatus();
      onNotify();
    } catch (err: any) {
      alert(err.response?.data?.error || `Failed to ${action} server`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleGenerateScripts = async () => {
    setActionLoading('scripts');
    try {
      const res = await axios.post('/api/models/generate-scripts', {
        modelsDir
      });
      setScriptsResult(res.data);
      onNotify();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed generating startup scripts');
    } finally {
      setActionLoading(null);
    }
  };

  const handleApplyProfile = async (profileId: string) => {
    setSelectedProfile(profileId);
    const prof = profiles.find(p => p.id === profileId);
    if (!prof) return;

    const updated = {
      ...config,
      memoryProfile: profileId,
      contextSize: prof.contextSize,
      threadCount: prof.threads,
      primaryModelFile: prof.primaryModel,
      jevModelFile: prof.jevModel || config.jevModelFile
    };

    await onSaveConfig(updated);
    alert(`Applied memory profile: "${prof.name}". Context window limited to ${prof.contextSize} tokens.`);
  };

  return (
    <div className="space-y-6">
      {/* 16GB Memory & Disk Diagnostic Card */}
      <div className="bg-gradient-to-br from-neutral-900 to-neutral-800 text-white rounded-2xl p-6 border border-neutral-700 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <HardDrive className="w-5 h-5 text-amber-400" />
              <h2 className="text-base font-semibold">RAM Optimization (16 GB) & Disk Swap Protection (100% I/O)</h2>
            </div>
            <p className="text-xs text-neutral-300 max-w-2xl leading-relaxed">
              Why 16GB RAM and SSD/HDD spiked to 100%: concurrently loading 7B + 3B + 2B models with unconstrained 32k
              context exceeds 14–16GB RAM, forcing Windows into aggressive paging (pagefile.sys disk thrashing).
            </p>
          </div>

          <button
            onClick={fetchStatus}
            className="flex items-center gap-1.5 text-xs text-neutral-300 hover:text-white bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-1.5 self-start md:self-auto transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Status
          </button>
        </div>

        {/* Recommended Architecture Banner */}
        <div className="mt-5 p-4 rounded-xl bg-neutral-800/80 border border-neutral-700 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="border-r border-neutral-700/60 pr-4">
            <div className="text-neutral-400 font-medium">Safe Memory Profile:</div>
            <div className="text-amber-300 font-semibold text-sm mt-0.5">Balanced Tandem (3.6 GB RAM)</div>
            <div className="text-[11px] text-neutral-400 mt-1">
              Hermes 3B (port 8080) + Jev 2B (port 1234). Leaves &gt;12 GB free RAM for Windows!
            </div>
          </div>

          <div className="border-r border-neutral-700/60 pr-4">
            <div className="text-neutral-400 font-medium">Context Window Limit:</div>
            <div className="text-emerald-400 font-semibold text-sm mt-0.5">-c 2048 (instead of 32k)</div>
            <div className="text-[11px] text-neutral-400 mt-1">
              Reduces KV cache footprint from 3–5 GB down to ~150 MB. Prevents disk swapping.
            </div>
          </div>

          <div>
            <div className="text-neutral-400 font-medium">CPU Worker Threads:</div>
            <div className="text-blue-300 font-semibold text-sm mt-0.5">-t 4 cores</div>
            <div className="text-[11px] text-neutral-400 mt-1">
              Leaves cores available for Windows UI and smooth responsiveness.
            </div>
          </div>
        </div>
      </div>

      {/* Models in Directory Card */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Folder className="w-5 h-5 text-neutral-500" />
            <div>
              <h3 className="text-sm font-semibold text-neutral-900">Models in Directory</h3>
              <p className="text-xs text-neutral-500 font-mono">{modelsDir}</p>
            </div>
          </div>

          <button
            onClick={handleGenerateScripts}
            disabled={actionLoading === 'scripts'}
            className="flex items-center gap-1.5 text-xs font-medium bg-neutral-900 text-white hover:bg-neutral-800 px-3 py-1.5 rounded-lg transition-colors shadow-sm"
          >
            <Download className="w-3.5 h-3.5 text-amber-400" />
            Generate .bat Startup Scripts
          </button>
        </div>

        {scriptsResult && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center justify-between">
            <span>
              Scripts successfully created in folder <code className="font-mono bg-emerald-100 px-1 py-0.5 rounded">{scriptsResult.directory}</code>:
              {' '}{scriptsResult.files.join(', ')}
            </span>
          </div>
        )}

        {/* Models Table */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {models.length === 0 ? (
            <div className="col-span-3 text-center py-6 text-neutral-400 text-xs">
              No .gguf files found in {modelsDir} yet.
            </div>
          ) : (
            models.map(m => (
              <div
                key={m.filename}
                className="border border-neutral-200 rounded-xl p-3.5 bg-neutral-50/50 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        m.isDecisionModel
                          ? 'bg-purple-100 text-purple-700'
                          : m.filename.includes('7B')
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-blue-100 text-blue-700'
                      }`}
                    >
                      {m.isDecisionModel ? 'DECISION ROUTER' : m.filename.includes('7B') ? 'HEAVY CODER' : 'PRIMARY LLM'}
                    </span>
                    <span className="text-[11px] font-mono text-neutral-500">{m.sizeGb} GB</span>
                  </div>

                  <div className="font-semibold text-xs text-neutral-900 mt-2 truncate" title={m.filename}>
                    {m.filename}
                  </div>
                </div>

                <div className="mt-3 pt-2 border-t border-neutral-200/60 flex items-center justify-between text-[11px] text-neutral-500">
                  <span>RAM at -c 2048:</span>
                  <span className="font-bold text-neutral-800">~{m.estimatedRamGb} GB</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Server Processes Control Card */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* JEV Decision Server Status (Port 1234) */}
        <div className="bg-white rounded-2xl border border-neutral-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-purple-600" />
              <h4 className="text-sm font-semibold text-neutral-900">Jev Decision Server (Port 1234)</h4>
            </div>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 ${
                jevServer?.status === 'running'
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  : 'bg-neutral-100 text-neutral-600'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  jevServer?.status === 'running' ? 'bg-emerald-500 animate-pulse' : 'bg-neutral-400'
                }`}
              />
              {jevServer?.status === 'running' ? 'ONLINE (1234)' : 'STOPPED'}
            </span>
          </div>

          <div className="text-xs text-neutral-600 space-y-1 bg-neutral-50 p-3 rounded-xl font-mono">
            <div>Model: Jev-Style-Qwen3.5-2B-Decision-Q4_K_M.gguf</div>
            <div>Footprint: ~1.4 GB RAM | Flags: -c 2048 -t 4</div>
            <div>Purpose: Sub-100ms note classification and single-token decision routing</div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            {jevServer?.status === 'running' ? (
              <button
                onClick={() => handleControlServer('jev', 'stop')}
                disabled={actionLoading === 'jev_stop'}
                className="flex-1 bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
              >
                <Square className="w-3.5 h-3.5" />
                Stop Jev Server
              </button>
            ) : (
              <button
                onClick={() => handleControlServer('jev', 'start')}
                disabled={actionLoading === 'jev_start'}
                className="flex-1 bg-neutral-900 text-white hover:bg-neutral-800 px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
              >
                <Play className="w-3.5 h-3.5 text-amber-400" />
                Start Jev Server
              </button>
            )}
          </div>
        </div>

        {/* Primary LLM Server Status (Port 8080) */}
        <div className="bg-white rounded-2xl border border-neutral-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-blue-600" />
              <h4 className="text-sm font-semibold text-neutral-900">Primary LLM Server (Port 8080)</h4>
            </div>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 ${
                primaryServer?.status === 'running'
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  : 'bg-neutral-100 text-neutral-600'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  primaryServer?.status === 'running' ? 'bg-emerald-500 animate-pulse' : 'bg-neutral-400'
                }`}
              />
              {primaryServer?.status === 'running' ? 'ONLINE (8080)' : 'STOPPED'}
            </span>
          </div>

          <div className="text-xs text-neutral-600 space-y-1 bg-neutral-50 p-3 rounded-xl font-mono">
            <div>Model: Hermes-3-Llama-3.2-3B.Q4_K_M.gguf</div>
            <div>Footprint: ~2.2 GB RAM | Flags: -c 2048 -t 4</div>
            <div>Purpose: Titles, semantic tags, summaries, and narrative contradiction audit</div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            {primaryServer?.status === 'running' ? (
              <button
                onClick={() => handleControlServer('primary', 'stop')}
                disabled={actionLoading === 'primary_stop'}
                className="flex-1 bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
              >
                <Square className="w-3.5 h-3.5" />
                Stop Primary Server
              </button>
            ) : (
              <button
                onClick={() => handleControlServer('primary', 'start')}
                disabled={actionLoading === 'primary_start'}
                className="flex-1 bg-neutral-900 text-white hover:bg-neutral-800 px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
              >
                <Play className="w-3.5 h-3.5 text-blue-400" />
                Start Primary Server
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
