import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Cpu,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  FolderInput,
  Sliders,
  Play,
  ArrowRight,
  ShieldCheck,
  Check,
  Sparkles,
  Zap
} from 'lucide-react';

interface DecisionClassifierProps {
  config: any;
  onSaveConfig: (updatedConfig: any) => Promise<void>;
  onNotify: () => void;
}

interface TriageItem {
  id: string;
  filePath: string;
  relativePath: string;
  filename: string;
  contentType: string;
  confidence: number;
  topFolder: string;
  distribution: Array<{ letter: string; option: string; probability: number }>;
  timestamp: string;
}

export default function DecisionClassifier({ config, onSaveConfig, onNotify }: DecisionClassifierProps) {
  const [modelStatus, setModelStatus] = useState<{
    online: boolean;
    checking: boolean;
    latencyMs?: number;
    error?: string;
  }>({ online: false, checking: false });

  // Config local state
  const [decisionUrl, setDecisionUrl] = useState(config.decisionModelUrl || 'http://127.0.0.1:1234');
  const [enableDecision, setEnableDecision] = useState(!!config.enableDecisionModel);
  const [threshold, setThreshold] = useState(config.decisionConfidenceThreshold ?? 0.80);
  const [decisionMode, setDecisionMode] = useState<'hybrid' | 'fast_routing'>(config.decisionMode || 'hybrid');

  // Playground state
  const [testText, setTestText] = useState('Shares of the chipmaker jumped 8% after it raised revenue forecast.');
  const [testQuestion, setTestQuestion] = useState('Which news section does this article belong to?');
  const [testOptions, setTestOptions] = useState('World\nSports\nBusiness\nScience/Technology');
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [testError, setTestError] = useState('');

  // Triage state
  const [triageQueue, setTriageQueue] = useState<TriageItem[]>([]);
  const [loadingTriage, setLoadingTriage] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // Batch fast triage state
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchMessage, setBatchMessage] = useState('');

  useEffect(() => {
    checkConnection();
    fetchTriageQueue();
  }, []);

  const checkConnection = async (urlToCheck?: string) => {
    setModelStatus(prev => ({ ...prev, checking: true, error: undefined }));
    const targetUrl = urlToCheck || decisionUrl;
    try {
      const start = Date.now();
      const res = await axios.get(`/api/decision/status?url=${encodeURIComponent(targetUrl)}`);
      const latency = Date.now() - start;
      if (res.data.online) {
        setModelStatus({ online: true, checking: false, latencyMs: latency });
      } else {
        setModelStatus({ online: false, checking: false, error: res.data.error || 'Server offline' });
      }
    } catch (err: any) {
      setModelStatus({
        online: false,
        checking: false,
        error: err.response?.data?.error || err.message || 'Connection failed'
      });
    }
  };

  const fetchTriageQueue = async () => {
    setLoadingTriage(true);
    try {
      const res = await axios.get('/api/decision/triage');
      setTriageQueue(res.data.triageQueue || []);
    } catch (err) {
      // ignore
    } finally {
      setLoadingTriage(false);
    }
  };

  const handleSaveSettings = async () => {
    const updated = {
      ...config,
      decisionModelUrl: decisionUrl,
      enableDecisionModel: enableDecision,
      decisionConfidenceThreshold: Number(threshold),
      decisionMode
    };
    await onSaveConfig(updated);
    checkConnection(decisionUrl);
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
      setTestError('Please provide at least 2 options (one per line).');
      setTestLoading(false);
      return;
    }

    try {
      const res = await axios.post('/api/decision/test', {
        text: testText,
        question: testQuestion,
        options: optionsList,
        decisionModelUrl: decisionUrl
      });
      setTestResult(res.data);
    } catch (err: any) {
      setTestError(err.response?.data?.error || err.message || 'Decision call failed');
    } finally {
      setTestLoading(false);
    }
  };

  const handleResolveTriage = async (item: TriageItem, targetFolder: string) => {
    setResolvingId(item.id);
    try {
      await axios.post('/api/decision/triage/resolve', {
        filePath: item.filePath,
        targetFolder
      });
      setTriageQueue(prev => prev.filter(q => q.id !== item.id));
      onNotify();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to resolve note');
    } finally {
      setResolvingId(null);
    }
  };

  const handleStartFastTriage = async () => {
    if (!window.confirm('Run high-speed Jev-style triage across unrefined notes? High confidence notes will be routed, ambiguous ones queued for review.')) return;
    setBatchRunning(true);
    setBatchMessage('Starting high-speed decision pass...');
    try {
      const res = await axios.post('/api/decision/fast-route-vault');
      setBatchMessage(res.data.message || 'Fast triage completed.');
      fetchTriageQueue();
      onNotify();
    } catch (err: any) {
      setBatchMessage(`Error: ${err.response?.data?.error || err.message}`);
    } finally {
      setBatchRunning(false);
    }
  };

  const loadPreset = (preset: 'contentType' | 'folders' | 'bool') => {
    if (preset === 'contentType') {
      setTestText('import { useState } from "react";\nexport function useToken() { ... }');
      setTestQuestion('What is the primary content type of this document?');
      setTestOptions('Technical Code, API or Configuration\nMeeting Transcript or Interview Dialogue\nCreative Fiction or Poem\nKnowledge Article or Essay\nPersonal Journal or Daily Note');
    } else if (preset === 'folders') {
      setTestText('Roadmap for ArtMaze exhibition 2026. Budget, lighting setup, and guest artists.');
      setTestQuestion('Which project folder does this note belong to?');
      setTestOptions('01_Projects/ArtMaze\n01_Projects/CleanNet Franchise\n03_Knowledge/Programming\n04_Journal/Daily');
    } else if (preset === 'bool') {
      setTestText('This file contains an API secret key for production database.');
      setTestQuestion('Does this note contain sensitive credentials?');
      setTestOptions('Yes\nNo');
    }
  };

  return (
    <div className="space-y-8">
      {/* Top Banner: Architecture & Capabilities */}
      <div className="bg-gradient-to-r from-neutral-900 to-neutral-800 text-white rounded-2xl p-6 shadow-sm border border-neutral-700">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/20 text-blue-300 border border-blue-400/30 flex items-center gap-1.5">
                <Zap className="w-3 h-3 text-blue-400" />
                Tier-1 Decision Classifier
              </span>
              <span className="text-xs text-neutral-400 font-mono">Jev-Style-Qwen3.5-2B (GGUF)</span>
            </div>
            <h2 className="text-lg font-semibold tracking-tight text-white">System One Decision & Fast Router</h2>
            <p className="text-sm text-neutral-300 max-w-2xl">
              Uses calibrated single-token probability distributions (<span className="text-blue-300 font-mono">ECE 0.017</span>) for instant folder routing, document type dispatching, and confidence-gated automated moves in ~100ms.
            </p>
          </div>

          <div className="flex items-center gap-3 bg-neutral-800/80 border border-neutral-700 rounded-xl px-4 py-3 shrink-0">
            <div className="flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full ${modelStatus.online ? 'bg-emerald-500' : 'bg-rose-500'}`} />
              <div className="text-xs">
                <div className="font-semibold text-neutral-200">
                  {modelStatus.checking ? 'Checking...' : modelStatus.online ? 'Decision Engine Online' : 'Offline / Unreachable'}
                </div>
                <div className="text-neutral-400 font-mono">
                  {modelStatus.latencyMs ? `${modelStatus.latencyMs} ms latency` : decisionUrl}
                </div>
              </div>
            </div>
            <button
              onClick={() => checkConnection()}
              disabled={modelStatus.checking}
              className="p-1.5 text-neutral-400 hover:text-white transition-colors rounded-lg hover:bg-neutral-700"
              title="Ping Decision Server"
            >
              <RefreshCw className={`w-4 h-4 ${modelStatus.checking ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Grid: Settings & Fast Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Settings Card */}
        <div className="md:col-span-1 bg-white rounded-2xl border border-neutral-200 p-6 space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-neutral-500" />
              <h3 className="text-sm font-semibold text-neutral-900">Decision Engine Config</h3>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={enableDecision}
                onChange={e => setEnableDecision(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-neutral-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-neutral-900"></div>
            </label>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-neutral-500 mb-1.5">
                Decision Server Endpoint (LM Studio / llama.cpp)
              </label>
              <input
                type="text"
                value={decisionUrl}
                onChange={e => setDecisionUrl(e.target.value)}
                placeholder="http://127.0.0.1:1234 or :8080"
                className="w-full bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 text-sm font-mono text-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              />
              <p className="text-[11px] text-neutral-400 mt-1">
                Port 1234 for LM Studio, or 8080 for llama-server.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-500 mb-1.5">Pipeline Operating Mode</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDecisionMode('hybrid')}
                  className={`px-3 py-2 text-xs font-medium rounded-lg border text-left transition-all ${
                    decisionMode === 'hybrid'
                      ? 'border-neutral-900 bg-neutral-900 text-white'
                      : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50'
                  }`}
                >
                  <div className="font-semibold">Hybrid Tier-1/2</div>
                  <div className="text-[10px] opacity-80 mt-0.5">Jev guides folder, LLM writes tags</div>
                </button>
                <button
                  type="button"
                  onClick={() => setDecisionMode('fast_routing')}
                  className={`px-3 py-2 text-xs font-medium rounded-lg border text-left transition-all ${
                    decisionMode === 'fast_routing'
                      ? 'border-neutral-900 bg-neutral-900 text-white'
                      : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50'
                  }`}
                >
                  <div className="font-semibold">Fast Route Only</div>
                  <div className="text-[10px] opacity-80 mt-0.5">Direct 100ms move if high confidence</div>
                </button>
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-medium text-neutral-500">Auto-Move Confidence Threshold</label>
                <span className="text-xs font-mono font-semibold text-neutral-800">
                  {Math.round(threshold * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.50"
                max="0.95"
                step="0.05"
                value={threshold}
                onChange={e => setThreshold(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-neutral-200 rounded-lg appearance-none cursor-pointer accent-neutral-900"
              />
              <div className="flex justify-between text-[10px] text-neutral-400 mt-1">
                <span>50% (Permissive)</span>
                <span>80% (Recommended)</span>
                <span>95% (Strict)</span>
              </div>
            </div>

            <button
              onClick={handleSaveSettings}
              className="w-full bg-neutral-900 text-white hover:bg-neutral-800 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              Save Decision Settings
            </button>

            <button
              onClick={handleStartFastTriage}
              disabled={batchRunning}
              className="w-full flex items-center justify-center gap-2 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              {batchRunning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              Fast Jev Triage (Vault)
            </button>

            {batchMessage && (
              <p className="text-xs font-mono text-neutral-600 bg-neutral-50 p-2.5 rounded-lg border border-neutral-200">
                {batchMessage}
              </p>
            )}
          </div>
        </div>

        {/* Live Playground / Tester */}
        <div className="md:col-span-2 bg-white rounded-2xl border border-neutral-200 p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-neutral-500" />
              <h3 className="text-sm font-semibold text-neutral-900">Decision Function Playground</h3>
            </div>
            <div className="flex items-center gap-1 text-xs">
              <span className="text-neutral-400 mr-1">Presets:</span>
              <button
                onClick={() => loadPreset('folders')}
                className="px-2 py-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded text-[11px]"
              >
                Folder Routing
              </button>
              <button
                onClick={() => loadPreset('contentType')}
                className="px-2 py-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded text-[11px]"
              >
                Content Type
              </button>
              <button
                onClick={() => loadPreset('bool')}
                className="px-2 py-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded text-[11px]"
              >
                Sensitive Bool
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">State / Document Snippet</label>
                <textarea
                  rows={4}
                  value={testText}
                  onChange={e => setTestText(e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-lg p-2.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-neutral-900 resize-none"
                  placeholder="Paste note snippet..."
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">Decision Question</label>
                <input
                  type="text"
                  value={testQuestion}
                  onChange={e => setTestQuestion(e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-1.5 text-xs text-neutral-800 focus:outline-none focus:ring-1 focus:ring-neutral-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">Options (one per line, max 26)</label>
                <textarea
                  rows={4}
                  value={testOptions}
                  onChange={e => setTestOptions(e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-lg p-2.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-neutral-900 resize-none"
                />
              </div>

              <button
                onClick={handleRunPlayground}
                disabled={testLoading}
                className="w-full flex items-center justify-center gap-2 bg-neutral-900 text-white hover:bg-neutral-800 px-4 py-2 rounded-lg text-xs font-medium transition-colors"
              >
                {testLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                Execute Jev Decision (Single Token)
              </button>

              {testError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg flex items-center gap-2">
                  <XCircle className="w-4 h-4 shrink-0" />
                  <span>{testError}</span>
                </div>
              )}
            </div>

            {/* Results Display */}
            <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-2 border-b border-neutral-200 mb-3">
                  <span className="text-xs font-semibold text-neutral-700">Calibrated Output Distribution</span>
                  {testResult && (
                    <span className="text-[11px] font-mono text-neutral-500">
                      {testResult.elapsedMs} ms | {testResult.output.calibrated ? 'Calibrated Logprobs' : 'Single Token'}
                    </span>
                  )}
                </div>

                {!testResult ? (
                  <div className="h-48 flex flex-col items-center justify-center text-neutral-400 text-xs text-center p-4">
                    <Cpu className="w-8 h-8 opacity-30 mb-2" />
                    <span>Run a test decision to see the calibrated probability distribution across choices.</span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="p-3 bg-white rounded-lg border border-neutral-200 flex items-center justify-between">
                      <div>
                        <div className="text-[10px] text-neutral-400 uppercase font-semibold">Chosen Option</div>
                        <div className="text-sm font-semibold text-neutral-900">
                          {testResult.output.chosen.letter}. {testResult.output.chosen.option}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-neutral-400 uppercase font-semibold">Confidence</div>
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
                              <span className={isChosen ? 'font-semibold text-neutral-900' : 'text-neutral-600'}>
                                {dec.letter}. {dec.option}
                              </span>
                              <span className={isChosen ? 'font-bold text-neutral-900' : 'text-neutral-500'}>
                                {pct}%
                              </span>
                            </div>
                            <div className="w-full bg-neutral-200 rounded-full h-2 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${
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

              <div className="text-[10px] text-neutral-400 pt-3 border-t border-neutral-200/60 mt-4 flex items-center justify-between">
                <span>Pass-through template: answers strictly in declared letters</span>
                <span className="font-mono">Top-1 argmax</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Triage & Human Review Queue Card */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-6 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-neutral-700" />
            <div>
              <h3 className="text-sm font-semibold text-neutral-900">
                Confidence-Gated Review Queue ({triageQueue.length})
              </h3>
              <p className="text-xs text-neutral-500">
                Notes where model confidence fell below {Math.round(threshold * 100)}%. Confirm or pick with 1-click.
              </p>
            </div>
          </div>
          <button
            onClick={fetchTriageQueue}
            disabled={loadingTriage}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingTriage ? 'animate-spin' : ''}`} />
            Refresh Queue
          </button>
        </div>

        {triageQueue.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center text-neutral-400 gap-2">
            <CheckCircle2 className="w-8 h-8 text-emerald-500/40" />
            <p className="text-sm font-medium text-neutral-600">Review Queue Clean</p>
            <p className="text-xs text-neutral-400">
              All processed notes met the {Math.round(threshold * 100)}% confidence threshold or none require triage.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {triageQueue.map(item => (
              <div
                key={item.id}
                className="bg-neutral-50 border border-neutral-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="space-y-1.5 max-w-md">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-neutral-900 font-mono">
                      {item.filename}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800 border border-amber-200">
                      {Math.round(item.confidence * 100)}% Conf
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-neutral-200 text-neutral-700">
                      {item.contentType}
                    </span>
                  </div>
                  <div className="text-xs text-neutral-500">
                    Location: <span className="font-mono text-neutral-700">{item.relativePath || 'Root'}</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-neutral-400 mr-1">Move to:</span>
                  {item.distribution?.slice(0, 3).map((choice, cIdx) => (
                    <button
                      key={cIdx}
                      disabled={resolvingId === item.id}
                      onClick={() => handleResolveTriage(item, choice.option)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5 ${
                        cIdx === 0
                          ? 'bg-neutral-900 text-white hover:bg-neutral-800 border-neutral-900'
                          : 'bg-white text-neutral-700 hover:bg-neutral-100 border-neutral-200'
                      }`}
                    >
                      <span>{choice.option}</span>
                      <span className="text-[10px] opacity-75 font-mono">
                        ({Math.round(choice.probability * 100)}%)
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
