import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  HardDrive,
  Cpu,
  Zap,
  Play,
  Square,
  RefreshCw,
  Sliders,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Folder,
  Download,
  Sparkles,
  Layers,
  Check,
  XCircle
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
    config.modelsPath || 'D:/Obsidian/Alex/Vault/llm/models'
  );
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [profiles, setProfiles] = useState<MemoryProfile[]>([]);
  const [primaryServer, setPrimaryServer] = useState<ServerStatus | null>(null);
  const [jevServer, setJevServer] = useState<ServerStatus | null>(null);
  const [detectedBinary, setDetectedBinary] = useState<string | null>(null);
  const [binaryPathInput, setBinaryPathInput] = useState(config.llamaServerBinary || '');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [scriptsResult, setScriptsResult] = useState<any>(null);

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
      }
    } catch (e) {
      console.error('Failed to load model server status', e);
    } finally {
      setLoading(false);
    }
  };

  const handleScanDirectory = async () => {
    setActionLoading('scan');
    try {
      const res = await axios.post('/api/models/list', { dirPath: modelsDir });
      setModels(res.data.models || []);
      const updated = { ...config, modelsPath: modelsDir };
      await onSaveConfig(updated);
      onNotify();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to scan models directory');
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
    try {
      await onSaveConfig(updated);
      onNotify();
    } catch (e: any) {
      alert('Failed to save profile: ' + e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleSaveEngineSettings = async () => {
    setActionLoading('save_settings');
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
      alert('Local AI Engine settings saved successfully.');
      onNotify();
    } catch (err: any) {
      alert('Failed to save engine settings: ' + err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleServer = async (serverType: 'primary' | 'jev', action: 'start' | 'stop') => {
    setActionLoading(`${serverType}_${action}`);
    try {
      const endpoint =
        action === 'start' ? '/api/models/server/start' : '/api/models/server/stop';
      const payload =
        action === 'start'
          ? {
              serverType,
              modelFile:
                serverType === 'primary'
                  ? config.primaryModelFile || 'Hermes-3-Llama-3.2-3B.Q4_K_M.gguf'
                  : config.jevModelFile || 'Jev-Style-Qwen3.5-2B-Decision-Q4_K_M.gguf',
              binaryPath: binaryPathInput || undefined
            }
          : { serverType };

      const res = await axios.post(endpoint, payload);
      alert(res.data.message || `Server ${serverType} ${action}ed`);
      await fetchStatus();
      onNotify();
    } catch (err: any) {
      alert(err.response?.data?.error || `Failed to ${action} ${serverType} server`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleGenerateScripts = async () => {
    setActionLoading('scripts');
    try {
      const res = await axios.post('/api/models/generate-scripts', {
        modelsDir,
        binaryPath: binaryPathInput || undefined
      });
      setScriptsResult(res.data);
      alert('Start scripts generated in: ' + res.data.scriptsDir);
      onNotify();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to generate scripts');
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

  return (
    <div className="space-y-6">
      {/* Top Banner: Architecture & Safe Memory Allocation */}
      <div className="bg-white rounded-2xl border border-neutral-200/80 p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-neutral-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-neutral-900">
                Local AI Engine & 16GB RAM Architecture
              </h2>
              <p className="text-xs text-neutral-500">
                Calibrated Dual-Server Pipeline: 100ms Jev Decision Router + 3B Synthesis Model
              </p>
            </div>
          </div>

          <button
            onClick={fetchStatus}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-neutral-600 hover:text-neutral-900 border border-neutral-200 rounded-lg px-2.5 py-1.5 transition-colors self-start md:self-auto"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Status
          </button>
        </div>

        {/* Memory Profiles */}
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-neutral-700">
              Hardware Profile & RAM Allocation:
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
                  className={`p-4 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'border-neutral-900 bg-neutral-50 shadow-xs'
                      : 'border-neutral-200 hover:border-neutral-300 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-semibold text-xs text-neutral-900">{p.name}</span>
                    <span
                      className={`text-[11px] font-mono font-bold ${
                        p.fits16GbRamSafely ? 'text-emerald-600' : 'text-amber-600'
                      }`}
                    >
                      ~{p.totalEstimatedRamGb.toFixed(1)} GB RAM
                    </span>
                  </div>
                  <p className="text-xs text-neutral-500 mb-3">{p.description}</p>
                  <div className="flex items-center justify-between text-[11px] text-neutral-500 border-t border-neutral-200/60 pt-2 font-mono">
                    <span>Ctx: {p.contextSize}</span>
                    <span>Threads: {p.threads}</span>
                    {isSelected && (
                      <span className="text-neutral-900 font-semibold flex items-center gap-0.5">
                        <Check className="w-3 h-3 text-emerald-600" /> Active
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
              <span className="text-neutral-500">Active Model:</span>
              <span className="font-mono text-neutral-800 text-[11px]">
                {config.primaryModelFile || 'Hermes-3-Llama-3.2-3B.Q4_K_M.gguf'}
              </span>
            </div>
            <div className="flex justify-between items-center py-1 border-t border-neutral-100">
              <span className="text-neutral-500">Context Window & Timeout:</span>
              <span className="font-mono text-neutral-800">
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
                  <Square className="w-3.5 h-3.5" /> Stop Server
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
              <span className="text-neutral-500">Active Model:</span>
              <span className="font-mono text-neutral-800 text-[11px]">
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
                  <Square className="w-3.5 h-3.5" /> Stop Server
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
