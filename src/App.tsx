/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Folder,
  Play,
  Square,
  Activity,
  FolderSearch,
  HardDrive,
  Loader2,
  AlertCircle,
  BookOpen,
  CheckCircle2,
  X
} from 'lucide-react';
import axios from 'axios';
import { PipelineWorkspace } from './components/PipelineWorkspace';
import { VaultWorkspace } from './components/VaultWorkspace';
import { LocalEngineWorkspace } from './components/LocalEngineWorkspace';
import { KnowledgeExplorer } from './components/KnowledgeExplorer';

type LogEntry = {
  timestamp: string;
  message: string;
  type: 'info' | 'error' | 'success' | 'warn';
};

export default function App() {
  const [config, setConfig] = useState({
    vaultPath: '',
    llamaUrl: 'http://127.0.0.1:8080',
    timeoutSeconds: 240,
    maxContextChars: 1500,
    decisionModelUrl: 'http://127.0.0.1:1234',
    enableDecisionModel: false,
    decisionConfidenceThreshold: 0.8,
    decisionMode: 'hybrid' as 'hybrid' | 'fast_routing',
    modelsPath: 'D:/Obsidian/Alex/Vault/llm/models',
    llamaServerBinary: '',
    autoStartJevServer: true,
    autoStartPrimaryServer: false,
    memoryProfile: 'balanced_16gb' as 'balanced_16gb' | 'solo_7b' | 'custom',
    contextSize: 2048,
    threadCount: 4,
    primaryModelFile: 'Hermes-3-Llama-3.2-3B.Q4_K_M.gguf',
    jevModelFile: 'Jev-Style-Qwen3.5-2B-Decision-Q4_K_M.gguf'
  });

  const [isWatching, setIsWatching] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [confirmInitModal, setConfirmInitModal] = useState(false);
  const [refineData, setRefineData] = useState<any>({});
  const [activeTab, setActiveTab] = useState<'knowledge' | 'vault' | 'pipeline' | 'models'>('knowledge');
  const [triageCount, setTriageCount] = useState(0);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchLogs, 2500);
    return () => clearInterval(interval);
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const fetchStatus = async () => {
    try {
      const [configRes, statusRes, logsRes, triageRes] = await Promise.all([
        axios.get('/api/config'),
        axios.get('/api/status'),
        axios.get('/api/logs'),
        axios.get('/api/decision/triage').catch(() => ({ data: { count: 0 } }))
      ]);
      setConfig(configRes.data);
      setIsWatching(statusRes.data.isWatching);
      setRefineData({
        queueLength: statusRes.data.refineQueueLength || 0,
        total: statusRes.data.refineTotal || 0,
        completed: statusRes.data.refineCompleted || 0,
        isRefining: statusRes.data.isRefining
      });
      setLogs(Array.isArray(logsRes.data) ? logsRes.data : []);
      setTriageCount(triageRes.data?.count || 0);
    } catch (err) {
      setError('Could not connect to backend server.');
    } finally {
      setLoading(false);
    }
  };

  const fetchLogs = async () => {
    try {
      const logsRes = await axios.get('/api/logs');
      if (Array.isArray(logsRes.data)) {
        setLogs(logsRes.data);
      }

      const statusRes = await axios.get('/api/status');
      setIsWatching(statusRes.data.isWatching);
      setRefineData({
        queueLength: statusRes.data.refineQueueLength || 0,
        total: statusRes.data.refineTotal || 0,
        completed: statusRes.data.refineCompleted || 0,
        isRefining: statusRes.data.isRefining
      });

      const triageRes = await axios
        .get('/api/decision/triage')
        .catch(() => ({ data: { count: 0 } }));
      setTriageCount(triageRes.data?.count || 0);
    } catch (e) {
      // ignore periodic poll errors
    }
  };

  const handleSaveConfig = async (updated: any) => {
    try {
      await axios.post('/api/config', updated);
      setConfig(updated);
      showToast('Configuration updated successfully');
      fetchStatus();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save configuration');
      throw err;
    }
  };

  const handleToggleWatcher = async () => {
    setError('');
    try {
      if (isWatching) {
        await axios.post('/api/stop');
        showToast('Pipeline watcher stopped');
      } else {
        await axios.post('/api/start');
        showToast('Pipeline watcher active on 00_Inbox');
      }
      await fetchStatus();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to toggle pipeline watcher');
    }
  };

  const handleInitVault = () => {
    if (!config.vaultPath) {
      setError('Please configure your Obsidian Vault path first.');
      return;
    }
    setConfirmInitModal(true);
  };

  const executeInitVault = async () => {
    setConfirmInitModal(false);
    try {
      await axios.post('/api/init-vault');
      showToast('Standard PARA structure initialized in Vault!');
      fetchLogs();
    } catch (err: any) {
      setError('Error initializing vault: ' + (err.response?.data?.error || err.message));
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-neutral-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-100/70 text-neutral-900 font-sans antialiased">
      {/* Top Application Bar */}
      <header className="bg-white border-b border-neutral-200 px-8 py-4 sticky top-0 z-30 shadow-xs">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-neutral-900 rounded-xl flex items-center justify-center text-white shadow-xs">
              <Folder className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-semibold tracking-tight text-neutral-900">
                  Obsidian Local LLM Pipeline
                </h1>
                <span className="text-xs text-neutral-400 font-mono">v3.6</span>
              </div>
              <p className="text-xs text-neutral-500 font-mono">
                {config.vaultPath ? config.vaultPath : 'Vault path not set'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs font-medium px-3 py-1.5 bg-neutral-50 border border-neutral-200 rounded-lg">
              <span
                className={`w-2 h-2 rounded-full ${
                  isWatching ? 'bg-emerald-500 animate-pulse' : 'bg-neutral-300'
                }`}
              />
              <span className="text-neutral-700">
                {isWatching ? 'Watching 00_Inbox' : 'Pipeline Idle'}
              </span>
            </div>

            <button
              onClick={handleToggleWatcher}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-medium text-xs transition-colors shadow-xs ${
                isWatching
                  ? 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200 border border-neutral-200'
                  : 'bg-neutral-900 text-white hover:bg-neutral-800'
              }`}
            >
              {isWatching ? (
                <>
                  <Square className="w-3.5 h-3.5" /> Stop
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 text-emerald-400" /> Start
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-6xl mx-auto px-6 py-6">
        {error && (
          <div className="mb-6 p-3.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
              <span>{error}</span>
            </div>
            <button onClick={() => setError('')} className="text-rose-500 hover:text-rose-800">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {toastMessage && (
          <div className="mb-6 p-3.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-xs flex items-center justify-between shadow-xs">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{toastMessage}</span>
            </div>
            <button onClick={() => setToastMessage(null)} className="text-emerald-600 hover:text-emerald-800">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* 4 Master Architectural Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-neutral-200 mb-6 pb-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab('knowledge')}
            className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg transition-all ${
              activeTab === 'knowledge'
                ? 'bg-white text-neutral-900 shadow-xs border border-neutral-200/80'
                : 'text-neutral-500 hover:text-neutral-900 hover:bg-white/50'
            }`}
          >
            <BookOpen className="w-4 h-4 text-indigo-500" />
            <span>1. Knowledge Base & Search</span>
          </button>

          <button
            onClick={() => setActiveTab('vault')}
            className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg transition-all ${
              activeTab === 'vault'
                ? 'bg-white text-neutral-900 shadow-xs border border-neutral-200/80'
                : 'text-neutral-500 hover:text-neutral-900 hover:bg-white/50'
            }`}
          >
            <FolderSearch className="w-4 h-4 text-amber-500" />
            <span>2. Vault Revisor & Cleaner</span>
            {triageCount > 0 && (
              <span className="ml-1 px-1.5 py-0.2 bg-amber-100 text-amber-800 text-[10px] font-bold rounded">
                {triageCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('pipeline')}
            className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg transition-all ${
              activeTab === 'pipeline'
                ? 'bg-white text-neutral-900 shadow-xs border border-neutral-200/80'
                : 'text-neutral-500 hover:text-neutral-900 hover:bg-white/50'
            }`}
          >
            <Activity className="w-4 h-4 text-emerald-600" />
            <span>3. Automation Pipeline</span>
          </button>

          <button
            onClick={() => setActiveTab('models')}
            className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg transition-all ${
              activeTab === 'models'
                ? 'bg-white text-neutral-900 shadow-xs border border-neutral-200/80'
                : 'text-neutral-500 hover:text-neutral-900 hover:bg-white/50'
            }`}
          >
            <HardDrive className="w-4 h-4 text-blue-500" />
            <span>4. Local AI Engine & Hardware</span>
          </button>
        </div>

        {/* Active Domain Workspace */}
        {activeTab === 'knowledge' && (
          <KnowledgeExplorer
            vaultPath={config.vaultPath}
            onNotify={fetchLogs}
          />
        )}

        {activeTab === 'vault' && (
          <VaultWorkspace
            vaultPath={config.vaultPath}
            config={config}
            triageCount={triageCount}
            onNotify={fetchLogs}
            onSaveConfig={handleSaveConfig}
          />
        )}

        {activeTab === 'pipeline' && (
          <PipelineWorkspace
            config={config}
            isWatching={isWatching}
            logs={logs}
            refineData={refineData}
            onSaveConfig={handleSaveConfig}
            onToggleWatcher={handleToggleWatcher}
            onRefreshLogs={fetchLogs}
            onInitVault={handleInitVault}
          />
        )}

        {activeTab === 'models' && (
          <LocalEngineWorkspace
            config={config}
            onSaveConfig={handleSaveConfig}
            onNotify={fetchLogs}
          />
        )}

        {/* In-App Confirmation Modal for Initializing Vault */}
        {confirmInitModal && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 backdrop-blur-xs">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-neutral-200 space-y-4">
              <div className="flex items-center gap-3 text-amber-600">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                  <Folder className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-neutral-900">Initialize Standard PARA Structure</h3>
                  <p className="text-xs text-neutral-500">Create core knowledge directories</p>
                </div>
              </div>

              <p className="text-xs text-neutral-600 leading-relaxed">
                This will create standard PARA folders (00_Inbox, 01_Projects, 02_Areas, 03_Knowledge, 04_Journal, 05_Resources, 06_Archive, 99_System) in your vault:
                <span className="block mt-1 font-mono text-[11px] text-neutral-800 bg-neutral-50 p-2 rounded border border-neutral-200">
                  {config.vaultPath}
                </span>
              </p>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setConfirmInitModal(false)}
                  className="px-3.5 py-1.5 text-xs text-neutral-600 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={executeInitVault}
                  className="px-4 py-1.5 text-xs text-white bg-neutral-900 hover:bg-neutral-800 rounded-lg transition-colors font-semibold shadow-xs"
                >
                  Initialize Structure
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
