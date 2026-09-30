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
  HardDrive,
  Loader2,
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Network,
  X
} from 'lucide-react';
import axios from 'axios';
import { PipelineWorkspace } from './components/PipelineWorkspace';
import { LocalEngineWorkspace } from './components/LocalEngineWorkspace';
import { KnowledgeExplorer } from './components/KnowledgeExplorer';
import { TagTaxonomyWorkspace } from './components/TagTaxonomyWorkspace';

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
    modelsPath: './llm/models',
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
  const [activeTab, setActiveTab] = useState<'knowledge' | 'clusters_tags' | 'pipeline' | 'models'>('knowledge');
  const [externalSelectedNotePath, setExternalSelectedNotePath] = useState<string | null>(null);
  const [externalSelectedTag, setExternalSelectedTag] = useState<string | null>(null);
  const [triageCount, setTriageCount] = useState(0);
  const [quickVaultInput, setQuickVaultInput] = useState('');
  const [creatingDemoVault, setCreatingDemoVault] = useState(false);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchLogs, 2500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (config.vaultPath) {
      setQuickVaultInput(config.vaultPath);
    }
  }, [config.vaultPath]);

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
    } catch {
      setError('Failed to connect to the local backend server.');
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
    } catch {
      // ignore periodic poll errors
    }
  };

  const handleSaveConfig = async (updated: any) => {
    try {
      await axios.post('/api/config', updated);
      setConfig(updated);
      showToast('Configuration saved successfully');
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
        showToast('00_Inbox watcher stopped');
      } else {
        await axios.post('/api/start');
        showToast('00_Inbox watcher started');
      }
      await fetchStatus();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to toggle watcher');
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
      showToast('PARA folder structure initialized in vault!');
      fetchLogs();
    } catch (err: any) {
      setError('Vault initialization failed: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleCreateDemoVault = async () => {
    setCreatingDemoVault(true);
    setError('');
    try {
      const res = await axios.post('/api/vault/create-demo');
      if (res.data?.config) {
        setConfig(res.data.config);
      }
      showToast(res.data?.message || 'Sample Obsidian Vault created and connected!');
      await fetchStatus();
    } catch (err: any) {
      setError('Failed to create sample vault: ' + (err.response?.data?.error || err.message));
    } finally {
      setCreatingDemoVault(false);
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
      {/* 3-Zone Top Bar Contract */}
      <header className="bg-white border-b border-neutral-200 px-6 py-3.5 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          {/* Zone 1: Single text element wordmark */}
          <span className="text-base font-semibold tracking-tight text-neutral-900 whitespace-nowrap">
            Obsidian Local LLM Pipeline
          </span>

          {/* Zone 2: Clean Single-Line Navigation Links */}
          <nav className="flex items-center gap-6 text-xs font-medium text-neutral-600 overflow-x-auto">
            <button
              onClick={() => setActiveTab('knowledge')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                activeTab === 'knowledge'
                  ? 'border-neutral-900 text-neutral-900 font-semibold'
                  : 'border-transparent hover:text-neutral-900'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>1. Vault & Notes</span>
            </button>

            <button
              onClick={() => setActiveTab('clusters_tags')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                activeTab === 'clusters_tags'
                  ? 'border-neutral-900 text-neutral-900 font-semibold'
                  : 'border-transparent hover:text-neutral-900'
              }`}
            >
              <Network className="w-3.5 h-3.5 text-emerald-600" />
              <span>2. Semantic Clusters & #Tags</span>
            </button>

            <button
              onClick={() => setActiveTab('pipeline')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                activeTab === 'pipeline'
                  ? 'border-neutral-900 text-neutral-900 font-semibold'
                  : 'border-transparent hover:text-neutral-900'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>
                3. Pipeline & Audits{triageCount > 0 ? ` (${triageCount})` : ''}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('models')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                activeTab === 'models'
                  ? 'border-neutral-900 text-neutral-900 font-semibold'
                  : 'border-transparent hover:text-neutral-900'
              }`}
            >
              <HardDrive className="w-3.5 h-3.5" />
              <span>4. Local LLM Engine</span>
            </button>
          </nav>

          {/* Zone 3: Primary Action */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={handleToggleWatcher}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-medium text-xs transition-colors whitespace-nowrap ${
                isWatching
                  ? 'bg-neutral-100 text-neutral-800 hover:bg-neutral-200 border border-neutral-200'
                  : 'bg-neutral-900 text-white hover:bg-neutral-800'
              }`}
            >
              {isWatching ? (
                <>
                  <Square className="w-3.5 h-3.5" /> Stop 00_Inbox
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 text-emerald-400" /> Watch 00_Inbox
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        {error && (
          <div className="mb-5 p-3.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl text-xs flex items-center justify-between">
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
          <div className="mb-5 p-3.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{toastMessage}</span>
            </div>
            <button onClick={() => setToastMessage(null)} className="text-emerald-600 hover:text-emerald-800">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Friendly 1-Click Onboarding Banner if Vault Path is not configured yet */}
        {!config.vaultPath && (
          <div className="mb-6 bg-white rounded-2xl border border-neutral-200 p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
                <Folder className="w-4 h-4 text-emerald-600" />
                <span>Step 1: Connect Your Obsidian Vault (or Launch a Ready-to-Use Sample Vault)</span>
              </div>
              <p className="text-xs text-neutral-500">
                Enter the local folder path to your Obsidian Vault, or click <strong>Create & Connect Sample Vault</strong> to immediately test L0–L7 Tag Import/Export, Project Detection, and Automated Directory Routing.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
              <input
                type="text"
                value={quickVaultInput}
                onChange={e => setQuickVaultInput(e.target.value)}
                placeholder="e.g. C:/Users/Name/Documents/ObsidianVault"
                className="w-full sm:w-72 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-neutral-900"
              />
              <button
                onClick={() => {
                  if (quickVaultInput.trim()) {
                    handleSaveConfig({ ...config, vaultPath: quickVaultInput.trim() });
                  }
                }}
                disabled={!quickVaultInput.trim()}
                className="px-3.5 py-2 bg-neutral-900 hover:bg-neutral-800 disabled:opacity-40 text-white rounded-lg text-xs font-semibold transition-colors whitespace-nowrap"
              >
                Connect Vault
              </button>
              <button
                onClick={handleCreateDemoVault}
                disabled={creatingDemoVault}
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-colors whitespace-nowrap"
              >
                {creatingDemoVault ? 'Creating Sample...' : '1-Click Sample Vault'}
              </button>
            </div>
          </div>
        )}

        {/* Active Domain Workspace */}
        {activeTab === 'knowledge' && (
          <KnowledgeExplorer
            vaultPath={config.vaultPath}
            externalSelectedNotePath={externalSelectedNotePath}
            externalSelectedTag={externalSelectedTag}
            onOpenClustersTab={() => setActiveTab('clusters_tags')}
            onNotify={fetchLogs}
          />
        )}

        {activeTab === 'clusters_tags' && (
          <TagTaxonomyWorkspace
            vaultPath={config.vaultPath}
            onOpenNote={relPath => {
              setExternalSelectedNotePath(relPath);
              setActiveTab('knowledge');
            }}
            onSelectTagFilter={tag => {
              setExternalSelectedTag(tag);
              setActiveTab('knowledge');
            }}
            onNotify={fetchLogs}
          />
        )}

        {activeTab === 'pipeline' && (
          <PipelineWorkspace
            config={config}
            isWatching={isWatching}
            logs={logs}
            refineData={refineData}
            triageCount={triageCount}
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
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 border border-neutral-200 space-y-4">
              <div className="flex items-center gap-3 text-amber-600">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                  <Folder className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-neutral-900">
                    Initialize Standard PARA Structure
                  </h3>
                  <p className="text-xs text-neutral-500">Deploy root knowledge base directories</p>
                </div>
              </div>

              <p className="text-xs text-neutral-600 leading-relaxed">
                This will create the core PARA directories (00_Inbox, 01_Projects, 02_Areas, 03_Knowledge, 04_Journal, 05_Ideas, 99_System) inside your configured vault:
                <span className="block mt-1.5 font-mono text-[11px] text-neutral-800 bg-neutral-50 p-2 rounded border border-neutral-200">
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
                  className="px-4 py-1.5 text-xs text-white bg-neutral-900 hover:bg-neutral-800 rounded-lg transition-colors font-semibold"
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
