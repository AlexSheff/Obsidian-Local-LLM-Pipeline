import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Play,
  Square,
  Activity,
  Folder,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  FileText,
  BookOpen,
  PieChart as PieIcon,
  Sparkles,
  ArrowRight,
  Settings,
  Trash2
} from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';

interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'error' | 'success' | 'warn';
}

interface PipelineWorkspaceProps {
  config: any;
  isWatching: boolean;
  logs: LogEntry[];
  refineData: {
    queueLength: number;
    total: number;
    completed: number;
    isRefining: boolean;
  };
  onSaveConfig: (updatedConfig: any) => Promise<void>;
  onToggleWatcher: () => Promise<void>;
  onRefreshLogs: () => Promise<void>;
  onInitVault: () => Promise<void>;
}

const CATEGORY_COLORS: Record<string, string> = {
  '01_Projects': '#059669',
  '02_Areas': '#2563eb',
  '03_Knowledge': '#7c3aed',
  '04_Journal': '#d97706',
  '99_System': '#64748b',
  'unknown': '#94a3b8'
};

export const PipelineWorkspace: React.FC<PipelineWorkspaceProps> = ({
  config,
  isWatching,
  logs,
  refineData,
  onSaveConfig,
  onToggleWatcher,
  onRefreshLogs,
  onInitVault
}) => {
  const [vaultPathInput, setVaultPathInput] = useState(config.vaultPath || '');
  const [savingVault, setSavingVault] = useState(false);
  const [forceRefine, setForceRefine] = useState(false);
  const [digestLoading, setDigestLoading] = useState(false);
  const [digestMessage, setDigestMessage] = useState('');
  const [logFilter, setLogFilter] = useState<'all' | 'success' | 'warn' | 'error'>('all');
  const [purgingGhosts, setPurgingGhosts] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{
    message: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);

  // Vault registry stats
  const [registry, setRegistry] = useState<any[]>([]);
  const [loadingRegistry, setLoadingRegistry] = useState(false);

  useEffect(() => {
    fetchRegistry();
  }, []);

  const fetchRegistry = async () => {
    setLoadingRegistry(true);
    try {
      const res = await axios.get('/api/registry');
      if (Array.isArray(res.data)) {
        setRegistry(res.data);
      }
    } catch (e) {
      // ignore
    } finally {
      setLoadingRegistry(false);
    }
  };

  const handleSaveVaultPath = async () => {
    setSavingVault(true);
    setActionFeedback(null);
    try {
      await onSaveConfig({ ...config, vaultPath: vaultPathInput });
      setActionFeedback({ message: 'Vault path saved successfully.', type: 'success' });
    } catch (err: any) {
      setActionFeedback({ message: 'Failed to save vault path: ' + err.message, type: 'error' });
    } finally {
      setSavingVault(false);
    }
  };

  const handleRefine = async () => {
    setActionFeedback(null);
    try {
      const res = await axios.post('/api/refine-vault', { force: forceRefine });
      setActionFeedback({ message: res.data.message, type: 'info' });
      onRefreshLogs();
    } catch (err: any) {
      setActionFeedback({
        message: err.response?.data?.error || err.message,
        type: 'error'
      });
    }
  };

  const handleStopRefine = async () => {
    setActionFeedback(null);
    try {
      await axios.post('/api/stop-refine');
      setActionFeedback({ message: 'Refinement queue stopped.', type: 'info' });
      onRefreshLogs();
    } catch (err: any) {
      setActionFeedback({
        message: 'Failed to stop refinement: ' + err.message,
        type: 'error'
      });
    }
  };

  const handlePurgeGhosts = async () => {
    setPurgingGhosts(true);
    setActionFeedback(null);
    try {
      const res = await axios.post('/api/vault/purge-ghosts');
      if (res.data.purgedCount > 0) {
        setActionFeedback({
          message: `Purged ${res.data.purgedCount} empty ghost notes to safe trash backup (Snapshot: ${res.data.snapshotId}).`,
          type: 'success'
        });
      } else {
        setActionFeedback({
          message: 'Zero empty ghost notes detected. Your vault is clean!',
          type: 'info'
        });
      }
      fetchRegistry();
      onRefreshLogs();
    } catch (err: any) {
      setActionFeedback({
        message: 'Failed to purge ghost notes: ' + (err.response?.data?.error || err.message),
        type: 'error'
      });
    } finally {
      setPurgingGhosts(false);
    }
  };

  const handleGenerateDigest = async () => {
    setDigestLoading(true);
    setDigestMessage('');
    try {
      await axios.post('/api/generate-digest');
      setDigestMessage('Daily Digest generated successfully in 04_Journal/Daily/');
      fetchRegistry();
      onRefreshLogs();
    } catch (err: any) {
      setDigestMessage('Error generating digest: ' + (err.response?.data?.error || err.message));
    } finally {
      setDigestLoading(false);
    }
  };

  // Group registry by category
  const categoryStats = registry.reduce((acc, curr) => {
    const cat = curr.category || '03_Knowledge';
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const pieData = Object.keys(categoryStats)
    .map(key => ({
      name: key,
      value: categoryStats[key]
    }))
    .sort((a, b) => b.value - a.value);

  const filteredLogs = logs.filter(l => {
    if (logFilter === 'all') return true;
    return l.type === logFilter;
  });

  return (
    <div className="space-y-6">
      {/* Top Controller Bar */}
      <div className="bg-white rounded-2xl border border-neutral-200/80 p-6 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-neutral-100">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <span
                className={`w-3 h-3 rounded-full ${
                  isWatching ? 'bg-emerald-500 animate-pulse' : 'bg-neutral-300'
                }`}
              />
              <h2 className="text-base font-semibold text-neutral-900">
                {isWatching ? 'Pipeline Active — Watching 00_Inbox' : 'Pipeline Idle'}
              </h2>
            </div>
            <p className="text-xs text-neutral-500">
              {isWatching
                ? 'Automatic ingestion, LLM classification, frontmatter injection, and PARA routing running in real time.'
                : 'Drop new documents, audio, or notes into 00_Inbox and activate pipeline to process.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={onToggleWatcher}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-xs transition-all shadow-xs ${
                isWatching
                  ? 'bg-neutral-100 text-neutral-800 hover:bg-neutral-200 border border-neutral-200'
                  : 'bg-neutral-900 text-white hover:bg-neutral-800'
              }`}
            >
              {isWatching ? (
                <>
                  <Square className="w-3.5 h-3.5" /> Stop Pipeline
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 text-emerald-400" /> Start Pipeline
                </>
              )}
            </button>

            <button
              onClick={handleGenerateDigest}
              disabled={digestLoading}
              className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-medium text-neutral-700 bg-white hover:bg-neutral-50 border border-neutral-200 transition-colors"
            >
              <BookOpen className="w-3.5 h-3.5 text-neutral-500" />
              Generate Daily Digest
            </button>
          </div>
        </div>

        {/* Vault Path & Fast Initialization */}
        <div className="mt-5 grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-neutral-600 mb-1.5">
              Obsidian Vault Path
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={vaultPathInput}
                onChange={e => setVaultPathInput(e.target.value)}
                placeholder="e.g. D:/Obsidian/Vault or /home/user/vault"
                className="flex-1 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-neutral-900"
              />
              <button
                onClick={handleSaveVaultPath}
                disabled={savingVault}
                className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg text-xs font-semibold transition-colors"
              >
                Save
              </button>
            </div>
          </div>

          <div className="md:col-span-1">
            <button
              onClick={onInitVault}
              className="w-full bg-neutral-100 hover:bg-neutral-200 text-neutral-800 px-3 py-2 rounded-lg text-xs font-medium transition-colors border border-neutral-200"
            >
              Initialize Structure
            </button>
          </div>
        </div>

        {digestMessage && (
          <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs">
            {digestMessage}
          </div>
        )}
      </div>

      {/* Main Grid: Activity Stream + Vault Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Activity Stream */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-neutral-200/80 flex flex-col h-[620px] overflow-hidden shadow-xs">
          <div className="border-b border-neutral-100 p-4 px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-neutral-50/40">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-neutral-500" />
              <h3 className="text-sm font-semibold text-neutral-900">Live Activity Stream</h3>
            </div>

            <div className="flex items-center gap-1 bg-neutral-100 p-0.5 rounded-lg text-xs">
              <button
                onClick={() => setLogFilter('all')}
                className={`px-2 py-1 rounded transition-colors ${
                  logFilter === 'all'
                    ? 'bg-white font-semibold text-neutral-900 shadow-xs'
                    : 'text-neutral-500 hover:text-neutral-900'
                }`}
              >
                All ({logs.length})
              </button>
              <button
                onClick={() => setLogFilter('success')}
                className={`px-2 py-1 rounded transition-colors ${
                  logFilter === 'success'
                    ? 'bg-white font-semibold text-emerald-700 shadow-xs'
                    : 'text-neutral-500 hover:text-neutral-900'
                }`}
              >
                Success
              </button>
              <button
                onClick={() => setLogFilter('warn')}
                className={`px-2 py-1 rounded transition-colors ${
                  logFilter === 'warn'
                    ? 'bg-white font-semibold text-amber-700 shadow-xs'
                    : 'text-neutral-500 hover:text-neutral-900'
                }`}
              >
                Warn
              </button>
              <button
                onClick={() => setLogFilter('error')}
                className={`px-2 py-1 rounded transition-colors ${
                  logFilter === 'error'
                    ? 'bg-white font-semibold text-rose-700 shadow-xs'
                    : 'text-neutral-500 hover:text-neutral-900'
                }`}
              >
                Error
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-3 font-mono text-xs">
            {filteredLogs.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-neutral-400 gap-2">
                <FileText className="w-8 h-8 opacity-20" />
                <p className="font-sans text-xs">No activity entries matching this filter</p>
              </div>
            ) : (
              filteredLogs.map((log, idx) => (
                <div key={idx} className="flex gap-3 items-start leading-relaxed">
                  <span className="text-neutral-400 text-[11px] shrink-0 mt-0.5 select-none">
                    {new Date(log.timestamp).toLocaleTimeString([], { hour12: false })}
                  </span>
                  <span
                    className={`flex-1 ${
                      log.type === 'error'
                        ? 'text-rose-600 font-semibold'
                        : log.type === 'warn'
                        ? 'text-amber-600'
                        : log.type === 'success'
                        ? 'text-emerald-600'
                        : 'text-neutral-700'
                    }`}
                  >
                    {log.message}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Col: Vault Overview & Quick Refine */}
        <div className="space-y-6">
          {/* Vault Maintenance Box */}
          <div className="bg-white rounded-2xl border border-neutral-200/80 p-6 space-y-4 shadow-xs">
            <h3 className="text-sm font-semibold text-neutral-900 pb-2 border-b border-neutral-100">
              Batch Vault Refinement
            </h3>

            <p className="text-xs text-neutral-500 leading-relaxed">
              Processes notes already in your vault: updates frontmatter, tags language (#ru/#en), and reorganizes into standard PARA folders.
            </p>

            {refineData.total > 0 && (
              <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-200 text-xs space-y-1.5">
                <div className="flex justify-between font-medium">
                  <span className="text-neutral-600">Progress:</span>
                  <span className="text-neutral-900 font-mono font-bold">
                    {refineData.completed} / {refineData.total}
                  </span>
                </div>
                <div className="w-full bg-neutral-200 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-neutral-900 h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round((refineData.completed / (refineData.total || 1)) * 100)
                      )}%`
                    }}
                  />
                </div>
              </div>
            )}

            {!refineData.isRefining ? (
              <div className="space-y-2">
                <button
                  onClick={handleRefine}
                  className="w-full py-2 px-3 bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg text-xs font-semibold transition-colors shadow-xs"
                >
                  {forceRefine ? 'Force Re-Analyze All Vault Notes' : 'Refine Unprocessed Vault Notes'}
                </button>
                <label className="flex items-center gap-2 px-1 text-xs text-neutral-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={forceRefine}
                    onChange={e => setForceRefine(e.target.checked)}
                    className="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900"
                  />
                  <span>Force mode (re-scan even if previously processed)</span>
                </label>
              </div>
            ) : (
              <button
                onClick={handleStopRefine}
                className="w-full py-2 px-3 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-lg text-xs font-semibold transition-colors border border-rose-200"
              >
                Stop Refinement
              </button>
            )}

            {/* Ghost Notes / Empty Notes Hygiene Action */}
            <div className="pt-3 border-t border-neutral-100 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-neutral-800">Vault Hygiene</span>
                <span className="text-[10px] text-neutral-400">Zero-resource protection</span>
              </div>
              <button
                onClick={handlePurgeGhosts}
                disabled={purgingGhosts}
                className="w-full py-2 px-3 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-800 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-xs disabled:opacity-50"
              >
                <Trash2 className={`w-3.5 h-3.5 ${purgingGhosts ? 'animate-spin' : ''}`} />
                {purgingGhosts ? 'Purging Ghost Notes...' : 'Purge Empty Ghost Notes'}
              </button>
              <p className="text-[11px] text-neutral-500 leading-tight">
                Removes notes with metadata only and zero body text. Safely backed up to 99_System/_trash/ for instant undo.
              </p>
            </div>

            {actionFeedback && (
              <div
                className={`p-3 rounded-xl border text-xs leading-relaxed ${
                  actionFeedback.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : actionFeedback.type === 'error'
                    ? 'bg-rose-50 border-rose-200 text-rose-900'
                    : 'bg-neutral-50 border-neutral-200 text-neutral-800'
                }`}
              >
                {actionFeedback.message}
              </div>
            )}
          </div>

          {/* Integrated PARA Category Distribution */}
          <div className="bg-white rounded-2xl border border-neutral-200/80 p-6 space-y-4 shadow-xs">
            <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
              <h3 className="text-sm font-semibold text-neutral-900">PARA Category Distribution</h3>
              <span className="text-xs font-mono text-neutral-500 font-semibold">
                {registry.length} notes
              </span>
            </div>

            {pieData.length === 0 ? (
              <div className="py-8 text-center text-xs text-neutral-400">
                No indexed notes yet. Process notes or run refinement to populate.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="h-32">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={30}
                        outerRadius={50}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {pieData.map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={CATEGORY_COLORS[entry.name] || '#94a3b8'}
                          />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="space-y-1 text-xs pt-2 border-t border-neutral-100">
                  {pieData.slice(0, 4).map(item => (
                    <div key={item.name} className="flex justify-between items-center py-0.5">
                      <span className="flex items-center gap-2 text-neutral-600">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{
                            backgroundColor: CATEGORY_COLORS[item.name] || '#94a3b8'
                          }}
                        />
                        {item.name}
                      </span>
                      <span className="font-mono text-neutral-900 font-medium">
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PipelineWorkspace;
