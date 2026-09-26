import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  HardDrive,
  Cpu,
  Zap,
  Play,
  Square,
  RefreshCw,
  Folder,
  Download,
  Sparkles,
  Check,
  XCircle,
  CheckCircle2
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
  loadedModel?: string | null;
  loadedModelPath?: string | null;
  liveContextSize?: number | null;
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

interface LocalEngineWorkspaceProps {
  config: any;
  onSaveConfig: (updated: any) => Promise<void>;
  onNotify: () => void;
}

export const LocalEngineWorkspace: React.FC<LocalEngineWorkspaceProps> = ({
  config,
  onSaveConfig,
  onNotify
}) => {
  const [loading, setLoading] = useState(true);
  const [modelsDir, setModelsDir] = useState(
    config.modelsPath || './llm/models'
  );
  const [modelsDirExists, setModelsDirExists] = useState<boolean>(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [profiles, setProfiles] = useState<MemoryProfile[]>([]);
  const [primaryServer, setPrimaryServer] = useState<ServerStatus | null>(null);
  const [jevServer, setJevServer] = useState<ServerStatus | null>(null);
  const [detectedBinary, setDetectedBinary] = useState<string | null>(null);
  const [binaryPathInput, setBinaryPathInput] = useState(config.llamaServerBinary || '');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [scriptsResult, setScriptsResult] = useState<any>(null);
  const [bannerMessage, setBannerMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Profile selection
  const [selectedProfile, setSelectedProfile] = useState<string>(
    config.memoryProfile || 'balanced_16gb'
  );

  // Model & Server URLs
  const [llamaUrl, setLlamaUrl] = useState(config.llamaUrl || 'http://127.0.0.1:8080');
  const [decisionUrl, setDecisionUrl] = useState(
    config.decisionModelUrl || 'http://127.0.0.1:1234'
  );
  const [enableDecision, setEnableDecision] = useState(!!config.enableDecisionModel);
  const [threshold, setThreshold] = useState(config.decisionConfidenceThreshold ?? 0.8);
  const [decisionMode, setDecisionMode] = useState<'hybrid' | 'fast_routing'>(
    config.decisionMode || 'hybrid'
  );
  const [timeoutSec, setTimeoutSec] = useState(config.timeoutSeconds ?? 240);
  const [maxContextChars, setMaxContextChars] = useState(config.maxContextChars ?? 1500);

  // Decision Tester Playground
  const [testText, setTestText] = useState(
    'Meeting notes discussing architecture refactoring, removing duplicate controls, and unifying workspaces.'
  );
  const [testQuestion, setTestQuestion] = useState(
    'Which top-level PARA category does this document belong to?'
  );
  const [testOptions, setTestOptions] = useState(
    '01_Projects\n02_Areas\n03_Knowledge\n04_Journal'
  );
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [testError, setTestError] = useState('');

  useEffect(() => {
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/models/status');
      if (res.data) {
        setModels(res.data.models || []);
        setProfiles(res.data.profiles || []);
        setPrimaryServer(res.data.primaryServer || null);
        setJevServer(res.data.jevServer || null);
        setDetectedBinary(res.data.detectedBinary || null);
        if (res.data.modelsDir) {
          setModelsDir(res.data.modelsDir);
        }
        setModelsDirExists(!!res.data.modelsDirExists);
      }
    } catch (e) {
      console.error('Failed to load model server status', e);
    } finally {
      setLoading(false);
    }
  };

  const handleScanDirectory = async () => {
    setActionLoading('scan');
    setBannerMessage(null);
    try {
      const res = await axios.post('/api/models/list', { dirPath: modelsDir });
      setModels(res.data.models || []);
      setModelsDirExists(!!res.data.modelsDirExists);
      if (res.data.modelsDir) {
        setModelsDir(res.data.modelsDir);
      }
      const updated = { ...config, modelsPath: res.data.modelsDir || modelsDir };
      await onSaveConfig(updated);
      setBannerMessage({
        type: 'success',
        text: `Scanned directory "${res.data.modelsDir || modelsDir}": found ${(res.data.models || []).length} .gguf file(s).`
      });
      onNotify();
    } catch (err: any) {
      setBannerMessage({
        type: 'error',
        text: err.response?.data?.error || 'Failed to scan models directory'
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleApplyProfile = async (profileId: string) => {
    setSelectedProfile(profileId);
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return;

    const updated = {
      ...config,
      memoryProfile: profileId,
      primaryModelFile: profile.primaryModel,
      jevModelFile: profile.jevModel,
      contextSize: profile.contextSize,
      threadCount: profile.threads
    };

    setActionLoading('profile');
    setBannerMessage(null);
    try {
      await onSaveConfig(updated);
      setBannerMessage({
        type: 'success',
        text: `Saved preset "${profile.name}" to config (note: this updates default startup settings, it does not reload an already running terminal server).`
      });
      onNotify();
    } catch (e: any) {
      setBannerMessage({
        type: 'error',
        text: 'Failed to save profile: ' + (e.response?.data?.error || e.message)
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleSaveEngineSettings = async () => {
    setActionLoading('save_settings');
    setBannerMessage(null);
    try {
      const updated = {
        ...config,
        llamaUrl,
        decisionModelUrl: decisionUrl,
        enableDecisionModel: enableDecision,
        decisionConfidenceThreshold: threshold,
        decisionMode,
        timeoutSeconds: timeoutSec,
        maxContextChars,
        modelsPath: modelsDir,
        llamaServerBinary: binaryPathInput
      };
      await onSaveConfig(updated);
      await fetchStatus();
      setBannerMessage({
        type: 'success',
        text: 'Local AI Engine settings saved and live server telemetry refreshed.'
      });
      onNotify();
    } catch (err: any) {
      setBannerMessage({
        type: 'error',
        text: 'Failed to save engine settings: ' + (err.response?.data?.error || err.message)
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleServer = async (serverType: 'primary' | 'jev', action: 'start' | 'stop') => {
    setActionLoading(`${serverType}_${action}`);
    setBannerMessage(null);
    try {
      const modelFilename =
        serverType === 'primary'
          ? config.primaryModelFile || 'Hermes-3-Llama-3.2-3B.Q4_K_M.gguf'
          : config.jevModelFile || 'Jev-Style-Qwen3.5-2B-Decision-Q4_K_M.gguf';

      const res = await axios.post('/api/models/control', {
        type: serverType,
        action,
        modelFilename
      });
      setBannerMessage({
        type: 'success',
        text: res.data.message || `Server ${serverType} ${action}ed`
      });
      await fetchStatus();
      onNotify();
    } catch (err: any) {
      setBannerMessage({
        type: 'error',
        text: err.response?.data?.error || `Failed to ${action} ${serverType} server`
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleGenerateScripts = async () => {
    setActionLoading('scripts');
    setBannerMessage(null);
    try {
      const res = await axios.post('/api/models/generate-scripts', {
        modelsDir,
        binaryPath: binaryPathInput || undefined
      });
      setScriptsResult(res.data);
      setBannerMessage({
        type: 'success',
        text: `Startup .bat scripts generated in: ${res.data.directory || res.data.scriptsDir}`
      });
      onNotify();
    } catch (err: any) {
      setBannerMessage({
        type: 'error',
        text: err.response?.data?.error || 'Failed to generate scripts'
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRunPlayground = async () => {
    setTestLoading(true);
    setTestError('');
    setTestResult(null);

    const optionsList = testOptions
      .split('\n')
      .map(o => o.trim())
      .filter(Boolean);
    if (optionsList.length < 2) {
      setTestError('Provide at least 2 options.');
      setTestLoading(false);
      return;
    }

    try {
      const res = await axios.post('/api/decision/test', {
        text: testText,
        question: testQuestion,
        options: optionsList,
        modelUrl: decisionUrl
      });
      setTestResult(res.data);
    } catch (err: any) {
      setTestError(
        err.response?.data?.error || 'Test failed. Ensure Jev server is running at ' + decisionUrl
      );
    } finally {
      setTestLoading(false);
    }
  };

  // Count how many servers are ACTUALLY running right now
  const liveLoadedServers = [
    primaryServer?.status === 'running'
      ? {
          role: 'Primary LLM (Port ' + (primaryServer.port || 8080) + ')',
          model: primaryServer.loadedModel || primaryServer.modelFilename,
          path: primaryServer.loadedModelPath,
          ctx: primaryServer.liveContextSize
        }
      : null,
    jevServer?.status === 'running'
      ? {
          role: 'Decision Router (Port ' + (jevServer.port || 1234) + ')',
          model: jevServer.loadedModel || jevServer.modelFilename,
          path: jevServer.loadedModelPath,
          ctx: jevServer.liveContextSize
        }
      : null
  ].filter(Boolean) as Array<{
    role: string;
    model: string;
    path?: string | null;
    ctx?: number | null;
  }>;

  return (
    <div className="space-y-6">
      {bannerMessage && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
            bannerMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {bannerMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            ) : (
              <XCircle className="w-4 h-4 shrink-0 text-rose-600" />
            )}
            <span>{bannerMessage.text}</span>
          </div>
          <button
            onClick={() => setBannerMessage(null)}
            className="text-[11px] underline ml-4 opacity-75 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Top Banner: Live Loaded Models Telemetry vs Configuration Presets */}
      <div className="bg-white rounded-2xl border border-neutral-200/80 p-6 shadow-xs space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-neutral-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-neutral-900">
                Local AI Engine & Live Server Telemetry
              </h2>
              <p className="text-xs text-neutral-500">
                Real-time inspection via <code className="font-mono">/props</code> &{' '}
                <code className="font-mono">/v1/models</code> on active llama-server endpoints
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                liveLoadedServers.length > 0
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-neutral-100 text-neutral-600'
              }`}
            >
              {liveLoadedServers.length} Model{liveLoadedServers.length === 1 ? '' : 's'} Currently Loaded in RAM
            </span>

            <button
              onClick={fetchStatus}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs text-neutral-600 hover:text-neutral-900 border border-neutral-200 rounded-lg px-2.5 py-1.5 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh Live Status
            </button>
          </div>
        </div>

        {/* Currently Loaded in Memory (Real-Time) */}
        <div>
          <div className="text-xs font-semibold text-neutral-700 mb-2">
            Currently Loaded in Running llama-server Instances ({liveLoadedServers.length}):
          </div>
          {liveLoadedServers.length === 0 ? (
            <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200 text-xs text-neutral-500">
              No running <code className="font-mono">llama-server</code> detected on{' '}
              <code className="font-mono">{llamaUrl}</code> or{' '}
              <code className="font-mono">{decisionUrl}</code>. Start a server in your terminal or click Refresh.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {liveLoadedServers.map((srv, idx) => (
                <div
                  key={idx}
                  className="p-3.5 rounded-xl bg-emerald-50/60 border border-emerald-200 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-emerald-800 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      {srv.role} — ONLINE
                    </div>
                    <div
                      className="text-xs font-mono font-bold text-neutral-900 truncate mt-1"
                      title={srv.path || srv.model}
                    >
                      {srv.model}
                    </div>
                    {srv.path && srv.path !== srv.model && (
                      <div className="text-[11px] font-mono text-neutral-500 truncate">
                        Path: {srv.path}
                      </div>
                    )}
                  </div>
                  {srv.ctx && (
                    <span className="shrink-0 text-[11px] font-mono bg-white border border-emerald-200 text-emerald-800 px-2 py-1 rounded-md">
                      n_ctx: {srv.ctx}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Scanned .gguf Models on Disk */}
        <div className="pt-3 border-t border-neutral-100">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-neutral-700 flex items-center gap-1.5">
              <Folder className="w-3.5 h-3.5 text-neutral-500" />
              Models Found on Disk in <code className="font-mono text-[11px]">{modelsDir}</code> ({models.length}):
            </span>
            <span className="text-[11px] text-neutral-400">
              {modelsDirExists ? 'Directory found' : 'Directory not found — adjust Models Path below'}
            </span>
          </div>

          {models.length === 0 ? (
            <div className="p-3 rounded-xl bg-neutral-50 border border-neutral-200 text-xs text-neutral-400">
              No <code className="font-mono">.gguf</code> files found in <code className="font-mono">{modelsDir}</code>. Set your models folder path below and click Scan.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {models.map(m => {
                const isLoadedInPrimary =
                  primaryServer?.status === 'running' &&
                  primaryServer.loadedModel?.toLowerCase() === m.filename.toLowerCase();
                const isLoadedInJev =
                  jevServer?.status === 'running' &&
                  jevServer.loadedModel?.toLowerCase() === m.filename.toLowerCase();
                const isLoadedNow = isLoadedInPrimary || isLoadedInJev;

                return (
                  <div
                    key={m.filename}
                    className={`p-3.5 rounded-xl border transition-all ${
                      isLoadedNow
                        ? 'border-emerald-500 bg-emerald-50/40 shadow-xs'
                        : 'border-neutral-200 bg-neutral-50/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          isLoadedNow
                            ? 'bg-emerald-600 text-white'
                            : m.isDecisionModel
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-neutral-200 text-neutral-700'
                        }`}
                      >
                        {isLoadedInPrimary
                          ? `LOADED IN RAM (PORT ${primaryServer?.port || 8080})`
                          : isLoadedInJev
                          ? `LOADED IN RAM (PORT ${jevServer?.port || 1234})`
                          : 'ON DISK (NOT LOADED)'}
                      </span>
                      <span className="text-[11px] font-mono text-neutral-500">{m.sizeGb} GB</span>
                    </div>
                    <div
                      className="text-xs font-mono font-semibold text-neutral-900 truncate"
                      title={m.fullPath}
                    >
                      {m.filename}
                    </div>
                    <div className="text-[11px] text-neutral-500 mt-2 pt-1.5 border-t border-neutral-200/60 flex justify-between font-mono">
                      <span>Est. RAM (-c 2048):</span>
                      <span className="font-semibold text-neutral-800">~{m.estimatedRamGb} GB</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Memory Presets (Templates, Not Running Models) */}
        <div className="pt-3 border-t border-neutral-100">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-neutral-700">
              Startup Configuration Presets (Templates for .bat / UI Start — Not Loaded Models):
            </span>
            <span className="text-xs text-neutral-400">Target: 16 GB System RAM</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {profiles.map(p => {
              const isSelected = selectedProfile === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => handleApplyProfile(p.id)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'border-neutral-900 bg-neutral-50 shadow-xs'
                      : 'border-neutral-200 hover:border-neutral-300 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-xs text-neutral-900">{p.name}</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600">
                      Preset (~{p.totalEstimatedRamGb.toFixed(1)} GB)
                    </span>
                  </div>
                  <p className="text-[11px] text-neutral-500 mb-2">{p.description}</p>
                  <div className="flex items-center justify-between text-[11px] text-neutral-500 border-t border-neutral-200/60 pt-1.5 font-mono">
                    <span>Ctx: {p.contextSize}</span>
                    <span>Threads: {p.threads}</span>
                    {isSelected && (
                      <span className="text-neutral-900 font-semibold flex items-center gap-0.5">
                        <Check className="w-3 h-3 text-emerald-600" /> Selected Preset
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Model Server Processes & Directory */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Primary Model Server */}
        <div className="bg-white rounded-2xl border border-neutral-200/80 p-6 space-y-4 shadow-xs">
          <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-blue-500" />
              <h3 className="text-sm font-semibold text-neutral-900">
                Primary Model Server (Extraction & Tags)
              </h3>
            </div>
            <span
              className={`text-xs font-semibold ${
                primaryServer?.status === 'running' ? 'text-emerald-600' : 'text-neutral-400'
              }`}
            >
              {primaryServer?.status === 'running' ? 'Online' : 'Stopped'}
            </span>
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex justify-between items-center py-1">
              <span className="text-neutral-500">Port & URL:</span>
              <span className="font-mono text-neutral-800">
                {primaryServer?.url || llamaUrl}
              </span>
            </div>
            <div className="flex justify-between items-center py-1 border-t border-neutral-100">
              <span className="text-neutral-500">Loaded in Server (Live):</span>
              <span
                className={`font-mono text-[11px] font-semibold ${
                  primaryServer?.status === 'running' ? 'text-emerald-700' : 'text-neutral-400'
                }`}
              >
                {primaryServer?.status === 'running'
                  ? primaryServer.loadedModel || primaryServer.modelFilename
                  : 'None (server stopped)'}
              </span>
            </div>
            <div className="flex justify-between items-center py-1 border-t border-neutral-100">
              <span className="text-neutral-500">Configured Default (for Start button):</span>
              <span className="font-mono text-neutral-600 text-[11px]">
                {config.primaryModelFile || 'Hermes-3-Llama-3.2-3B.Q4_K_M.gguf'}
              </span>
            </div>
            <div className="flex justify-between items-center py-1 border-t border-neutral-100">
              <span className="text-neutral-500">Context Window & Timeout:</span>
              <span className="font-mono text-neutral-800">
                {primaryServer?.liveContextSize
                  ? `${primaryServer.liveContextSize} tokens (live) · `
                  : ''}
                {maxContextChars} chars · {timeoutSec}s timeout
              </span>
            </div>

            <div className="pt-2 flex items-center gap-2">
              {primaryServer?.status === 'running' ? (
                <button
                  onClick={() => handleToggleServer('primary', 'stop')}
                  disabled={actionLoading === 'primary_stop'}
                  className="flex-1 bg-red-50 text-red-700 hover:bg-red-100 px-3 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5"
                >
                  <Square className="w-3.5 h-3.5" /> Stop Managed Server
                </button>
              ) : (
                <button
                  onClick={() => handleToggleServer('primary', 'start')}
                  disabled={actionLoading === 'primary_start'}
                  className="flex-1 bg-neutral-900 text-white hover:bg-neutral-800 px-3 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5 shadow-xs"
                >
                  <Play className="w-3.5 h-3.5 text-emerald-400" /> Start Primary Server
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Jev Decision Router Server */}
        <div className="bg-white rounded-2xl border border-neutral-200/80 p-6 space-y-4 shadow-xs">
          <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-semibold text-neutral-900">
                Decision Router (Jev-Style 2B)
              </h3>
            </div>
            <span
              className={`text-xs font-semibold ${
                jevServer?.status === 'running' ? 'text-emerald-600' : 'text-neutral-400'
              }`}
            >
              {jevServer?.status === 'running' ? 'Online' : 'Stopped'}
            </span>
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex justify-between items-center py-1">
              <span className="text-neutral-500">Port & URL:</span>
              <span className="font-mono text-neutral-800">
                {jevServer?.url || decisionUrl}
              </span>
            </div>
            <div className="flex justify-between items-center py-1 border-t border-neutral-100">
              <span className="text-neutral-500">Loaded in Server (Live):</span>
              <span
                className={`font-mono text-[11px] font-semibold ${
                  jevServer?.status === 'running' ? 'text-emerald-700' : 'text-neutral-400'
                }`}
              >
                {jevServer?.status === 'running'
                  ? jevServer.loadedModel || jevServer.modelFilename
                  : 'None (server stopped)'}
              </span>
            </div>
            <div className="flex justify-between items-center py-1 border-t border-neutral-100">
              <span className="text-neutral-500">Configured Default (for Start button):</span>
              <span className="font-mono text-neutral-600 text-[11px]">
                {config.jevModelFile || 'Jev-Style-Qwen3.5-2B-Decision-Q4_K_M.gguf'}
              </span>
            </div>
            <div className="flex justify-between items-center py-1 border-t border-neutral-100">
              <span className="text-neutral-500">Routing Threshold:</span>
              <span className="font-mono text-neutral-800 font-bold">
                {Math.round(threshold * 100)}% ({decisionMode === 'fast_routing' ? 'Fast' : 'Hybrid'})
              </span>
            </div>

            <div className="pt-2 flex items-center gap-2">
              {jevServer?.status === 'running' ? (
                <button
                  onClick={() => handleToggleServer('jev', 'stop')}
                  disabled={actionLoading === 'jev_stop'}
                  className="flex-1 bg-red-50 text-red-700 hover:bg-red-100 px-3 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5"
                >
                  <Square className="w-3.5 h-3.5" /> Stop Managed Server
                </button>
              ) : (
                <button
                  onClick={() => handleToggleServer('jev', 'start')}
                  disabled={actionLoading === 'jev_start'}
                  className="flex-1 bg-neutral-900 text-white hover:bg-neutral-800 px-3 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5 shadow-xs"
                >
                  <Play className="w-3.5 h-3.5 text-amber-400" /> Start Decision Server
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Unified Engine & Inference Configuration Bar */}
      <div className="bg-white rounded-2xl border border-neutral-200/80 p-6 space-y-4 shadow-xs">
        <h3 className="text-sm font-semibold text-neutral-900 pb-2 border-b border-neutral-100">
          Inference Parameters & Path Settings
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
          <div>
            <label className="block text-neutral-500 mb-1 font-medium">Models Path (.gguf)</label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={modelsDir}
                onChange={e => setModelsDir(e.target.value)}
                className="w-full bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-neutral-900"
              />
              <button
                onClick={handleScanDirectory}
                disabled={actionLoading === 'scan'}
                className="px-2.5 py-1.5 bg-neutral-100 hover:bg-neutral-200 rounded-lg text-neutral-700 shrink-0 font-medium"
              >
                Scan
              </button>
            </div>
          </div>

          <div>
            <label className="block text-neutral-500 mb-1 font-medium">llama-server binary</label>
            <input
              type="text"
              placeholder={detectedBinary || 'e.g. llama-server or full path'}
              value={binaryPathInput}
              onChange={e => setBinaryPathInput(e.target.value)}
              className="w-full bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-neutral-900"
            />
          </div>

          <div>
            <label className="block text-neutral-500 mb-1 font-medium">Decision Threshold</label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0.50"
                max="0.95"
                step="0.05"
                value={threshold}
                onChange={e => setThreshold(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-neutral-200 rounded-lg appearance-none cursor-pointer accent-neutral-900"
              />
              <span className="font-mono font-bold text-neutral-800 w-10">
                {Math.round(threshold * 100)}%
              </span>
            </div>
          </div>

          <div>
            <label className="block text-neutral-500 mb-1 font-medium">Routing Mode</label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDecisionMode('hybrid')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  decisionMode === 'hybrid'
                    ? 'bg-neutral-900 text-white border-neutral-900'
                    : 'bg-neutral-50 text-neutral-600 border-neutral-200'
                }`}
              >
                Hybrid
              </button>
              <button
                onClick={() => setDecisionMode('fast_routing')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  decisionMode === 'fast_routing'
                    ? 'bg-neutral-900 text-white border-neutral-900'
                    : 'bg-neutral-50 text-neutral-600 border-neutral-200'
                }`}
              >
                Fast Route
              </button>
            </div>
          </div>
        </div>

        <div className="pt-3 border-t border-neutral-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4 text-xs text-neutral-600">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={enableDecision}
                onChange={e => setEnableDecision(e.target.checked)}
                className="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900"
              />
              <span className="font-medium text-neutral-800">
                Enable Jev Decision Engine for Pipeline & Inbox
              </span>
            </label>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={handleGenerateScripts}
              disabled={actionLoading === 'scripts'}
              className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Generate .bat / .sh Scripts
            </button>

            <button
              onClick={handleSaveEngineSettings}
              disabled={actionLoading === 'save_settings'}
              className="px-4 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg text-xs font-semibold transition-colors shadow-xs"
            >
              Save Engine Settings
            </button>
          </div>
        </div>
      </div>

      {/* Decision Function Playground */}
      <div className="bg-white rounded-2xl border border-neutral-200/80 p-6 space-y-4 shadow-xs">
        <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-neutral-900">
              Live Decision Function Playground
            </h3>
          </div>
          <span className="text-xs text-neutral-400">
            Test single-token routing with probability readout
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-neutral-500 mb-1">
                Document Snippet
              </label>
              <textarea
                rows={3}
                value={testText}
                onChange={e => setTestText(e.target.value)}
                className="w-full bg-neutral-50 border border-neutral-200 rounded-lg p-2.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-neutral-900 resize-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-500 mb-1">
                Decision Question
              </label>
              <input
                type="text"
                value={testQuestion}
                onChange={e => setTestQuestion(e.target.value)}
                className="w-full bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-1.5 text-xs text-neutral-800 focus:outline-none focus:ring-1 focus:ring-neutral-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-500 mb-1">
                Choices (one per line)
              </label>
              <textarea
                rows={3}
                value={testOptions}
                onChange={e => setTestOptions(e.target.value)}
                className="w-full bg-neutral-50 border border-neutral-200 rounded-lg p-2.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-neutral-900 resize-none"
              />
            </div>

            <button
              onClick={handleRunPlayground}
              disabled={testLoading}
              className="w-full flex items-center justify-center gap-2 bg-neutral-900 text-white hover:bg-neutral-800 px-4 py-2 rounded-lg text-xs font-semibold transition-colors shadow-xs"
            >
              {testLoading ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5 text-amber-400" />
              )}
              Test Decision Inference
            </button>

            {testError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg flex items-center gap-2">
                <XCircle className="w-4 h-4 shrink-0" />
                <span>{testError}</span>
              </div>
            )}
          </div>

          <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-2 border-b border-neutral-200 mb-3">
                <span className="text-xs font-semibold text-neutral-700">
                  Calibrated Decision Output
                </span>
                {testResult && (
                  <span className="text-[11px] font-mono text-neutral-500">
                    {testResult.elapsedMs} ms
                  </span>
                )}
              </div>

              {!testResult ? (
                <div className="h-44 flex flex-col items-center justify-center text-neutral-400 text-xs text-center p-4">
                  <Cpu className="w-8 h-8 opacity-25 mb-2" />
                  <span>Execute test decision to inspect calibrated probabilities.</span>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="p-3 bg-white rounded-lg border border-neutral-200 flex items-center justify-between">
                    <div>
                      <div className="text-[10px] text-neutral-400 uppercase font-semibold">
                        Selected Option
                      </div>
                      <div className="text-sm font-semibold text-neutral-900">
                        {testResult.output.chosen.letter}. {testResult.output.chosen.option}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-neutral-400 uppercase font-semibold">
                        Confidence
                      </div>
                      <div className="text-sm font-bold font-mono text-emerald-600">
                        {Math.round(testResult.output.confidence * 100)}%
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {testResult.output.decisions.map((dec: any, idx: number) => {
                      const pct = Math.round(dec.probability * 100);
                      const isChosen = dec.letter === testResult.output.chosen.letter;
                      return (
                        <div key={idx} className="space-y-1">
                          <div className="flex justify-between text-xs font-mono">
                            <span
                              className={
                                isChosen
                                  ? 'font-semibold text-neutral-900'
                                  : 'text-neutral-600'
                              }
                            >
                              {dec.letter}. {dec.option}
                            </span>
                            <span
                              className={
                                isChosen
                                  ? 'font-bold text-neutral-900'
                                  : 'text-neutral-500'
                              }
                            >
                              {pct}%
                            </span>
                          </div>
                          <div className="w-full bg-neutral-200 rounded-full h-1.5 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                isChosen ? 'bg-emerald-500' : 'bg-neutral-400'
                              }`}
                              style={{ width: `${Math.max(2, pct)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="text-[10px] text-neutral-400 pt-3 border-t border-neutral-200 mt-4 flex items-center justify-between">
              <span>Local calibrated logprobs routing</span>
              <span className="font-mono">port: {jevServer?.port || 1234}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LocalEngineWorkspace;
