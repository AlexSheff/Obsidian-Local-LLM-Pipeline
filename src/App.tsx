/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Play, Square, Settings, FileText, Activity, AlertCircle, Folder, Loader2, BarChart2, LayoutDashboard } from 'lucide-react';
import axios from 'axios';
import Analytics from './components/Analytics';

type LogEntry = {
  timestamp: string;
  message: string;
  type: 'info' | 'error' | 'success';
};

export default function App() {
  const [config, setConfig] = useState({ vaultPath: '', llamaUrl: 'http://127.0.0.1:8080' });
  const [isWatching, setIsWatching] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'analytics'>('dashboard');

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, []);

  const fetchStatus = async () => {
    try {
      const [configRes, statusRes, logsRes] = await Promise.all([
        axios.get('/api/config'),
        axios.get('/api/status'),
        axios.get('/api/logs')
      ]);
      setConfig(configRes.data);
      setIsWatching(statusRes.data.isWatching);
      setLogs(logsRes.data);
    } catch (err) {
      setError('Could not connect to backend server.');
    } finally {
      setLoading(false);
    }
  };

  const fetchLogs = async () => {
    try {
      const logsRes = await axios.get('/api/logs');
      setLogs(logsRes.data);
      
      const statusRes = await axios.get('/api/status');
      setIsWatching(statusRes.data.isWatching);
    } catch (e) {
      // ignore periodic fetch errors
    }
  };

  const handleSaveConfig = async () => {
    try {
      await axios.post('/api/config', config);
      alert('Configuration saved');
    } catch (err) {
      alert('Error saving configuration');
    }
  };

  const handleInitVault = async () => {
    if (!config.vaultPath) {
      alert('Please enter a vault path and save configuration first.');
      return;
    }
    const confirm = window.confirm('This will create the full directory structure in the specified Vault Path. Continue?');
    if (!confirm) return;
    
    try {
      await axios.post('/api/init-vault');
      alert('Vault initialized successfully!');
      fetchLogs(); // refresh logs
    } catch (err: any) {
      alert('Error initializing vault: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleStartStop = async () => {
    setError('');
    try {
      if (isWatching) {
        await axios.post('/api/stop');
      } else {
        await axios.post('/api/start');
      }
      await fetchStatus();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to toggle watcher');
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
    <div className="min-h-screen bg-neutral-100 text-neutral-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 px-8 py-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-neutral-900 rounded-xl flex items-center justify-center text-white">
              <Folder className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-neutral-900">Hermes Local Intelligence</h1>
              <p className="text-sm text-neutral-500">Obsidian Inbox Pipeline</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-2 text-sm font-medium">
              <span className={`w-2.5 h-2.5 rounded-full ${isWatching ? 'bg-emerald-500' : 'bg-neutral-300'}`}></span>
              {isWatching ? 'Watching 00_Inbox' : 'Idle'}
            </span>
            <button
              onClick={handleStartStop}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                isWatching 
                  ? 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                  : 'bg-neutral-900 text-white hover:bg-neutral-800'
              }`}
            >
              {isWatching ? (
                <><Square className="w-4 h-4" /> Stop Pipeline</>
              ) : (
                <><Play className="w-4 h-4" /> Start Pipeline</>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-8 py-8">
        
        {/* Navigation Tabs */}
        <div className="flex items-center gap-4 border-b border-neutral-200 mb-8 pb-px">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`flex items-center gap-2 pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'dashboard' ? 'border-neutral-900 text-neutral-900' : 'border-transparent text-neutral-500 hover:text-neutral-700'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            Dashboard
          </button>
          <button
            onClick={() => setActiveTab('analytics')}
            className={`flex items-center gap-2 pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'analytics' ? 'border-neutral-900 text-neutral-900' : 'border-transparent text-neutral-500 hover:text-neutral-700'
            }`}
          >
            <BarChart2 className="w-4 h-4" />
            Analytics & Reports
          </button>
        </div>

        {activeTab === 'dashboard' ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Left Col - Settings */}
            <div className="md:col-span-1 space-y-6">
              <section className="bg-white rounded-2xl border border-neutral-200 p-6">
                <div className="flex items-center gap-2 mb-6">
                  <Settings className="w-5 h-5 text-neutral-400" />
                  <h2 className="text-sm font-semibold text-neutral-900">Configuration</h2>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-neutral-500 mb-1.5">Obsidian Vault Absolute Path</label>
                    <input 
                      type="text" 
                      value={config.vaultPath}
                  onChange={(e) => setConfig({...config, vaultPath: e.target.value})}
                  placeholder="e.g. D:/Obsidian/Vault"
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
                />
              </div>
              
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1.5">Llama.cpp Server URL</label>
                <input 
                  type="text" 
                  value={config.llamaUrl}
                  onChange={(e) => setConfig({...config, llamaUrl: e.target.value})}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
                />
              </div>
              
              <div className="flex flex-col gap-2 pt-2">
                <button 
                  onClick={handleSaveConfig}
                  className="w-full bg-neutral-900 text-white hover:bg-neutral-800 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  Save Settings
                </button>
                <button 
                  onClick={handleInitVault}
                  className="w-full bg-neutral-100 text-neutral-700 hover:bg-neutral-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  Initialize Vault Structure
                </button>
              </div>
            </div>
            
            {error && (
              <div className="mt-4 p-3 bg-red-50 text-red-600 rounded-lg flex items-start gap-2 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <p>{error}</p>
              </div>
            )}
          </section>
          
          <section className="bg-white rounded-2xl border border-neutral-200 p-6">
            <h2 className="text-sm font-semibold text-neutral-900 mb-4">Pipeline Status</h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-center py-1">
                <span className="text-neutral-500">LLM Server</span>
                <span className="font-medium text-neutral-900">{config.llamaUrl.includes('127.0.0.1') || config.llamaUrl.includes('localhost') ? 'Loopback Valid' : 'Warning'}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-t border-neutral-100">
                <span className="text-neutral-500">Inbox Folder</span>
                <span className="font-medium text-neutral-900">{config.vaultPath ? 'Configured' : 'Not Set'}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-t border-neutral-100">
                <span className="text-neutral-500">Processing Mode</span>
                <span className="font-medium text-neutral-900">Semantic & PARA</span>
              </div>
            </div>
          </section>
        </div>

        {/* Right Col - Logs */}
        <div className="md:col-span-2">
          <section className="bg-white rounded-2xl border border-neutral-200 flex flex-col h-[600px] overflow-hidden">
            <div className="border-b border-neutral-200 p-4 px-6 flex items-center justify-between bg-neutral-50/50">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-neutral-400" />
                <h2 className="text-sm font-semibold text-neutral-900">Activity Log</h2>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {logs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-neutral-400 gap-3">
                  <FileText className="w-8 h-8 opacity-20" />
                  <p className="text-sm">No activity recorded yet</p>
                </div>
              ) : (
                logs.map((log, idx) => (
                  <div key={idx} className="flex gap-4 text-sm font-mono items-start">
                    <div className="text-neutral-400 shrink-0 mt-0.5">
                      {new Date(log.timestamp).toLocaleTimeString([], { hour12: false })}
                    </div>
                    <div className={`flex-1 ${
                      log.type === 'error' ? 'text-red-500' :
                      log.type === 'success' ? 'text-emerald-600' :
                      'text-neutral-700'
                    }`}>
                      {log.message}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
      ) : (
        <Analytics />
      )}
      </main>
    </div>
  );
}

