import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Play,
  Square,
  Activity,
  BookOpen,
  FolderSearch,
  Copy,
  AlertCircle,
  Share2,
  Sparkles,
  Tag
} from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import DirectoryRevisor from './DirectoryRevisor';
import DuplicateCleaner from './DuplicateCleaner';
import { TriagePanel } from './TriagePanel';
import { HypergraphWorkspace } from './HypergraphWorkspace';
import { TagTaxonomyWorkspace } from './TagTaxonomyWorkspace';

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
  triageCount?: number;
  onSaveConfig: (updatedConfig: any) => Promise<void>;
  onToggleWatcher: () => Promise<void>;
  onRefreshLogs: () => Promise<void>;
  onInitVault: () => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  '01_Projects': '#059669',
  '02_Areas': '#2563eb',
  '03_Knowledge': '#7c3aed',
  '04_Journal': '#d97706',
  '99_System': '#64748b',
  unknown: '#94a3b8'
};

export const PipelineWorkspace: React.FC<PipelineWorkspaceProps> = ({
  config,
  isWatching,
  logs,
  refineData,
  triageCount = 0,
  onSaveConfig,
  onToggleWatcher,
  onRefreshLogs,
  onInitVault
}) => {
  const [vaultPathInput, setVaultPathInput] = useState(config.vaultPath || '');
  const [savingVault, setSavingVault] = useState(false);
  const [forceRefine, setForceRefine] = useState(false);
  const [smartRename, setSmartRename] = useState(true);
  const [digestLoading, setDigestLoading] = useState(false);
  const [logFilter, setLogFilter] = useState<'all' | 'success' | 'warn' | 'error'>('all');
  const [purgingGhosts, setPurgingGhosts] = useState(false);
  const [runningUnified, setRunningUnified] = useState(false);
  const [activeToolTab, setActiveToolTab] = useState<
    'overview' | 'triage' | 'revisor' | 'duplicates' | 'hypergraph'
  >('overview');
  const [actionFeedback, setActionFeedback] = useState<{
    message: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);

  const [registry, setRegistry] = useState<any[]>([]);
  const [vaultStructure, setVaultStructure] = useState<{
    folders: string[];
    projectsRoot: string;
    projects: Array<{ id: string; folder: string; aliases: string[] }>;
  }>({ folders: [], projectsRoot: '01_Projects', projects: [] });
  const [pruningEmpty, setPruningEmpty] = useState(false);
  const [syncingProjects, setSyncingProjects] = useState(false);
  const [normalizingTags, setNormalizingTags] = useState(false);
  const [optimizingObsidian, setOptimizingObsidian] = useState(false);
  const [lastSnapshotId, setLastSnapshotId] = useState<string | null>(null);
  const [rollingBackSnapshot, setRollingBackSnapshot] = useState(false);
  const [creatingDemo, setCreatingDemo] = useState(false);

  useEffect(() => {
    setVaultPathInput(config.vaultPath || '');
    fetchVaultStructure();
  }, [config.vaultPath]);

  useEffect(() => {
    fetchRegistry();
    fetchVaultStructure();
  }, []);

  const fetchVaultStructure = async () => {
    try {
      const res = await axios.get('/api/vault/structure');
      if (res.data) {
        setVaultStructure({
          folders: Array.isArray(res.data.folders) ? res.data.folders : [],
          projectsRoot: res.data.projectsRoot || '01_Projects',
          projects: Array.isArray(res.data.projects) ? res.data.projects : []
        });
      }
    } catch {}
  };

  const fetchRegistry = async () => {
    try {
      const res = await axios.get('/api/registry');
      if (Array.isArray(res.data)) {
        setRegistry(res.data);
      }
    } catch {}
  };

  const handleSaveVaultPath = async () => {
    setSavingVault(true);
    setActionFeedback(null);
    try {
      await onSaveConfig({ ...config, vaultPath: vaultPathInput });
      await fetchVaultStructure();
      setActionFeedback({
        message: 'Vault path connected. Folder hierarchy and projects discovered dynamically from disk.',
        type: 'success'
      });
    } catch (err: any) {
      setActionFeedback({ message: 'Failed to save path: ' + err.message, type: 'error' });
    } finally {
      setSavingVault(false);
    }
  };

  const handlePruneEmptyFolders = async () => {
    setPruningEmpty(true);
    setActionFeedback(null);
    try {
      const res = await axios.post('/api/vault/prune-empty');
      const count = res.data?.prunedCount || 0;
      await fetchVaultStructure();
      onRefreshLogs();
      setActionFeedback({
        message:
          count > 0
            ? `Removed ${count} empty folder(s) from vault: ${res.data.removedFolders.join(', ')}`
            : 'Checked vault — no empty folders remain.',
        type: count > 0 ? 'success' : 'info'
      });
    } catch (err: any) {
      setActionFeedback({
        message: 'Empty folder cleanup failed: ' + (err.response?.data?.error || err.message),
        type: 'error'
      });
    } finally {
      setPruningEmpty(false);
    }
  };

  const handleSyncVaultProjects = async () => {
    setSyncingProjects(true);
    setActionFeedback(null);
    try {
      await axios.post('/api/projects/bootstrap');
      await fetchVaultStructure();
      onRefreshLogs();
      setActionFeedback({
        message: 'Synced project registry directly from your Vault directory structure.',
        type: 'success'
      });
    } catch (err: any) {
      setActionFeedback({
        message: 'Project sync failed: ' + (err.response?.data?.error || err.message),
        type: 'error'
      });
    } finally {
      setSyncingProjects(false);
    }
  };

  const handleNormalizeAllTags = async () => {
    setNormalizingTags(true);
    setActionFeedback(null);
    try {
      const res = await axios.post('/api/vault/tags/classify-and-route', {
        dryRun: false,
        routeFiles: true
      });
      if (res.data?.snapshotId) {
        setLastSnapshotId(res.data.snapshotId);
      }
      await fetchVaultStructure();
      fetchRegistry();
      onRefreshLogs();
      setActionFeedback({
        message:
          res.data?.message ||
          `Updated tags on ${res.data?.updatedCount || 0} notes (${res.data?.projectsMatchedCount || 0} matched to projects) and routed ${res.data?.movedCount || 0} files to directories.`,
        type: 'success'
      });
    } catch (err: any) {
      setActionFeedback({
        message: 'Tag classification & routing failed: ' + (err.response?.data?.error || err.message),
        type: 'error'
      });
    } finally {
      setNormalizingTags(false);
    }
  };

  const handleRollbackSnapshot = async () => {
    if (!lastSnapshotId) return;
    setRollingBackSnapshot(true);
    try {
      const res = await axios.post('/api/snapshots/rollback', {
        snapshotId: lastSnapshotId
      });
      setLastSnapshotId(null);
      await fetchVaultStructure();
      fetchRegistry();
      onRefreshLogs();
      setActionFeedback({
        message: res.data?.message || 'Rolled back snapshot and restored files to their original paths and tags.',
        type: 'info'
      });
    } catch (err: any) {
      setActionFeedback({
        message: 'Rollback failed: ' + (err.response?.data?.error || err.message),
        type: 'error'
      });
    } finally {
      setRollingBackSnapshot(false);
    }
  };

  const handleOptimizeObsidian = async () => {
    setOptimizingObsidian(true);
    setActionFeedback(null);
    try {
      const res = await axios.post('/api/vault/optimize-obsidian', { keepSnapshots: 1 });
      onRefreshLogs();
      setActionFeedback({
        message:
          res.data?.message ||
          'Optimized vault for fast Obsidian startup (.obsidian/app.json ignore filters active, old backups & MOC bloat cleaned).',
        type: 'success'
      });
    } catch (err: any) {
      setActionFeedback({
        message: 'Vault optimization failed: ' + (err.response?.data?.error || err.message),
        type: 'error'
      });
    } finally {
      setOptimizingObsidian(false);
    }
  };

  const handleCreateDemoVault = async () => {
    setCreatingDemo(true);
    setActionFeedback(null);
    try {
      const res = await axios.post('/api/vault/create-demo');
      if (res.data?.config) {
        await onSaveConfig(res.data.config);
      }
      await fetchVaultStructure();
      fetchRegistry();
      onRefreshLogs();
      setActionFeedback({
        message: res.data?.message || 'Sample Obsidian Vault created and connected!',
        type: 'success'
      });
    } catch (err: any) {
      setActionFeedback({
        message: 'Sample vault creation failed: ' + (err.response?.data?.error || err.message),
        type: 'error'
      });
    } finally {
      setCreatingDemo(false);
    }
  };

  const handleRunUnifiedPipeline = async () => {
    setRunningUnified(true);
    setActionFeedback(null);
    try {
      // Stage 1: Sync discovered project folders
      await axios.post('/api/projects/bootstrap').catch(() => {});

      // Stage 2: Purge empty ghost files
      const ghostRes = await axios.post('/api/vault/purge-ghosts').catch(() => ({ data: { purgedCount: 0 } }));
      const purged = ghostRes.data?.purgedCount || 0;

      // Stage 3: Clean exact duplicates & merge unique tags
      const dupRes = await axios
        .post('/api/duplicates/clean', { allExact: true })
        .catch(() => ({ data: { removedCount: 0 } }));
      const deduped = dupRes.data?.removedCount || 0;

      // Stage 4: Deterministic Project Detection, Orthogonal Tag Update (L0-L7) & Tag-Based Directory Routing
      const tagRouteRes = await axios
        .post('/api/vault/tags/classify-and-route', {
          dryRun: false,
          routeFiles: true
        })
        .catch(() => ({ data: { updatedCount: 0, movedCount: 0, projectsMatchedCount: 0, snapshotId: null } }));
      const tagsUpdated = tagRouteRes.data?.updatedCount || 0;
      const tagMoved = tagRouteRes.data?.movedCount || 0;
      if (tagRouteRes.data?.snapshotId) {
        setLastSnapshotId(tagRouteRes.data.snapshotId);
      }

      // Stage 5: Prune any existing empty directories, optimize Obsidian startup & sync Project Harness
      const pruneRes = await axios
        .post('/api/vault/prune-empty')
        .catch(() => ({ data: { prunedCount: 0 } }));
      const pruned = (pruneRes.data?.prunedCount || 0) + (tagRouteRes.data?.prunedFoldersCount || 0);

      await axios.post('/api/projects/harness/sync', { routeScattered: false }).catch(() => {});
      await axios.post('/api/vault/optimize-obsidian', { keepSnapshots: 1 }).catch(() => {});

      const refineRes = await axios
        .post('/api/refine-vault', {
          force: forceRefine,
          smartRename
        })
        .catch(() => ({ data: { total: 0 } }));

      setActionFeedback({
        message: `Full Auto-Pipeline complete: updated clean #tags on ${tagsUpdated} note(s), routed ${tagMoved} file(s), synced Project Harness, optimized .obsidian/app.json startup speed, purged ${purged} ghost note(s), merged ${deduped} duplicate(s), and pruned ${pruned} empty folder(s).`,
        type: 'success'
      });
      fetchRegistry();
      fetchVaultStructure();
      onRefreshLogs();
    } catch (err: any) {
      setActionFeedback({
        message: 'Failed to start pipeline: ' + (err.response?.data?.error || err.message),
        type: 'error'
      });
    } finally {
      setRunningUnified(false);
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
        message: 'Failed to stop queue: ' + err.message,
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
          message: `Moved ${res.data.purgedCount} empty ghost note(s) to backup trash (Snapshot: ${res.data.snapshotId}).`,
          type: 'success'
        });
      } else {
        setActionFeedback({
          message: 'Zero empty ghost notes found — vault is clean.',
          type: 'info'
        });
      }
      fetchRegistry();
      onRefreshLogs();
    } catch (err: any) {
      setActionFeedback({
        message: 'Cleanup error: ' + (err.response?.data?.error || err.message),
        type: 'error'
      });
    } finally {
      setPurgingGhosts(false);
    }
  };

  const handleGenerateDigest = async () => {
    setDigestLoading(true);
    setActionFeedback(null);
    try {
      await axios.post('/api/generate-digest');
      setActionFeedback({
        message: 'Daily digest created in 04_Journal/Daily/',
        type: 'success'
      });
      fetchRegistry();
      onRefreshLogs();
    } catch (err: any) {
      setActionFeedback({
        message: 'Digest generation failed: ' + (err.response?.data?.error || err.message),
        type: 'error'
      });
    } finally {
      setDigestLoading(false);
    }
  };

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
      <div className="bg-white rounded-2xl border border-neutral-200 p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-5 border-b border-neutral-100">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-neutral-900">
              Unified Pipeline: PARA Deployment, Dual-Model Project Sorting (Jev + LLM) & Vault Audit
            </h2>
            <p className="text-xs text-neutral-500">
              Deploy PARA folders, sort project and knowledge documents with Jev (1234) + Primary LLM (8080), and clean duplicates in a single workspace.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleRunUnifiedPipeline}
              disabled={runningUnified || refineData.isRefining}
              className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-xs bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-50 transition-colors whitespace-nowrap"
              title="1-Click Autopilot: Sync Projects -> Purge Ghosts -> Deduplicate -> Update L0-L7 Tags & Route Files -> Prune Empty Folders"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span>
                {runningUnified
                  ? 'Running Full Auto-Pipeline...'
                  : '3. Run Full Auto-Pipeline (Tag + Route + Clean)'}
              </span>
            </button>

            <button
              onClick={handleGenerateDigest}
              disabled={digestLoading}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium text-neutral-700 bg-white hover:bg-neutral-50 border border-neutral-200 transition-colors whitespace-nowrap"
            >
              <BookOpen className="w-3.5 h-3.5 text-neutral-500" />
              <span>Generate Daily Digest</span>
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-neutral-600 mb-1.5">
              1. Obsidian Vault Directory Path
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={vaultPathInput}
                onChange={e => setVaultPathInput(e.target.value)}
                placeholder="e.g. C:/Users/Name/Documents/ObsidianVault"
                className="flex-1 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-neutral-900"
              />
              <button
                onClick={handleSaveVaultPath}
                disabled={savingVault}
                className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg text-xs font-semibold transition-colors whitespace-nowrap"
              >
                Save Path
              </button>
            </div>
          </div>

          <div className="md:col-span-1 flex gap-2">
            <button
              onClick={onInitVault}
              className="flex-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 px-3 py-2 rounded-lg text-xs font-medium transition-colors border border-neutral-200 whitespace-nowrap"
            >
              2. Init PARA
            </button>
            <button
              onClick={handleCreateDemoVault}
              disabled={creatingDemo}
              title="Create and connect a ready-to-use Sample Obsidian Vault with 5 notes in 00_Inbox"
              className="bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 px-3 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap"
            >
              {creatingDemo ? '...' : 'Sample Vault'}
            </button>
          </div>
        </div>

        <div className="mt-4 pt-3.5 border-t border-neutral-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600 tabular-nums">
            <span className="font-semibold text-neutral-900">
              {vaultStructure.folders.length} folders
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-neutral-900">
              {vaultStructure.projects.length} projects discovered
            </span>
            {vaultStructure.projects.length > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-neutral-500">
                  {vaultStructure.projects.map(p => p.folder).join(' · ')}
                </span>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              onClick={handleNormalizeAllTags}
              disabled={normalizingTags}
              className="px-3 py-1.5 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-medium transition-colors"
              title="Detect which project each .md file belongs to, update clean #tags, and distribute files into directories"
            >
              {normalizingTags ? 'Tagging & Routing...' : 'Quick #Tag & Route'}
            </button>
            <button
              onClick={handleSyncVaultProjects}
              disabled={syncingProjects}
              className="px-3 py-1.5 rounded-lg bg-white hover:bg-neutral-100 text-neutral-700 border border-neutral-200 text-xs font-medium transition-colors"
            >
              {syncingProjects ? 'Scanning...' : 'Re-Scan Projects'}
            </button>
            <button
              onClick={handleOptimizeObsidian}
              disabled={optimizingObsidian}
              className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 text-xs font-medium transition-colors"
              title="Clean accumulated 99_System backups, deduplicate MOC links, and configure .obsidian/app.json ignore filters so Obsidian starts instantly"
            >
              {optimizingObsidian ? 'Optimizing...' : 'Fast Obsidian Startup'}
            </button>
            <button
              onClick={handlePruneEmptyFolders}
              disabled={pruningEmpty}
              className="px-3 py-1.5 rounded-lg bg-white hover:bg-neutral-100 text-neutral-700 border border-neutral-200 text-xs font-medium transition-colors"
            >
              {pruningEmpty ? 'Cleaning...' : 'Prune Empty Folders'}
            </button>
          </div>
        </div>

        <div className="mt-4 pt-3.5 border-t border-neutral-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 bg-neutral-100 p-1 rounded-xl overflow-x-auto">
            <button
              onClick={() => setActiveToolTab('overview')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                activeToolTab === 'overview'
                  ? 'bg-white text-neutral-900 shadow-xs font-semibold'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <Activity className="w-3.5 h-3.5 text-emerald-600" />
              <span>Pipeline & Live Logs</span>
            </button>

            <button
              onClick={() => setActiveToolTab('triage')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                activeToolTab === 'triage'
                  ? 'bg-white text-neutral-900 shadow-xs font-semibold'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
              <span className="tabular-nums">Ambiguity Triage ({triageCount})</span>
            </button>

            <button
              onClick={() => setActiveToolTab('revisor')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                activeToolTab === 'revisor'
                  ? 'bg-white text-neutral-900 shadow-xs font-semibold'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <FolderSearch className="w-3.5 h-3.5 text-blue-600" />
              <span>Project & Directory Audit</span>
            </button>

            <button
              onClick={() => setActiveToolTab('duplicates')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                activeToolTab === 'duplicates'
                  ? 'bg-white text-neutral-900 shadow-xs font-semibold'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <Copy className="w-3.5 h-3.5 text-neutral-700" />
              <span>Duplicate Cleaner</span>
            </button>

            <button
              onClick={() => setActiveToolTab('hypergraph')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                activeToolTab === 'hypergraph'
                  ? 'bg-white text-neutral-900 shadow-xs font-semibold'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <Share2 className="w-3.5 h-3.5 text-indigo-600" />
              <span>Semantic Hypergraph (DSH)</span>
            </button>
          </div>
        </div>

        {actionFeedback && (
          <div
            className={`mt-4 p-3 rounded-xl border text-xs leading-relaxed flex flex-wrap items-center justify-between gap-2 ${
              actionFeedback.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : actionFeedback.type === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-900'
                : 'bg-neutral-50 border-neutral-200 text-neutral-800'
            }`}
          >
            <span>{actionFeedback.message}</span>
            {lastSnapshotId && (
              <button
                onClick={handleRollbackSnapshot}
                disabled={rollingBackSnapshot}
                className="px-3 py-1 rounded-lg bg-white hover:bg-neutral-100 text-neutral-800 border border-neutral-200 text-xs font-semibold transition-colors shrink-0"
              >
                {rollingBackSnapshot ? 'Restoring...' : 'Undo Last Routing (Restore Snapshot)'}
              </button>
            )}
          </div>
        )}
      </div>

      {activeToolTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white rounded-2xl border border-neutral-200 flex flex-col h-[600px] overflow-hidden">
            <div className="border-b border-neutral-100 p-4 px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-neutral-50/40">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-neutral-500" />
                <h3 className="text-sm font-semibold text-neutral-900">
                  Pipeline Activity Stream (Jev + LLM)
                </h3>
              </div>

              <div className="flex items-center gap-1 bg-neutral-100 p-0.5 rounded-lg text-xs">
                <button
                  onClick={() => setLogFilter('all')}
                  className={`px-2 py-1 rounded transition-colors tabular-nums ${
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
                  Errors
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-2.5 font-mono text-xs">
              {filteredLogs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-neutral-400 gap-2">
                  <p className="font-sans text-xs">No log entries matching the selected filter</p>
                </div>
              ) : (
                filteredLogs.map((log, idx) => (
                  <div key={idx} className="flex gap-3 items-start leading-relaxed">
                    <span className="text-neutral-400 text-[11px] shrink-0 mt-0.5 select-none tabular-nums">
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

          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-neutral-200 p-6 space-y-4">
              <h3 className="text-sm font-semibold text-neutral-900 pb-2 border-b border-neutral-100">
                3. Dual-Model Sorting & Classification
              </h3>

              <p className="text-xs text-neutral-600 leading-relaxed">
                <strong>Jev Decision Server (Port 1234)</strong> classifies document category and project affiliation, while <strong>Primary LLM (Port 8080)</strong> extracts clean titles and tags. Semantic guardrails route project roadmaps to their exact project folders.
              </p>

              {refineData.total > 0 && (
                <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-200 text-xs space-y-1.5">
                  <div className="flex justify-between font-medium">
                    <span className="text-neutral-600">Processed files:</span>
                    <span className="text-neutral-900 font-mono font-bold tabular-nums">
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
                <div className="space-y-2.5">
                  <button
                    onClick={handleRunUnifiedPipeline}
                    disabled={runningUnified}
                    className="w-full py-2.5 px-3 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                    <span>
                      {runningUnified
                        ? 'Running Auto-Pipeline...'
                        : 'Run Full Auto-Pipeline (Clean + Sort + Prune Empty)'}
                    </span>
                  </button>

                  <div className="pt-2 space-y-1.5 border-t border-neutral-100">
                    <label className="flex items-center gap-2 text-xs text-neutral-700 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={smartRename}
                        onChange={e => setSmartRename(e.target.checked)}
                        className="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900"
                      />
                      <span>Smart Rename (preserves series numbers & project codes)</span>
                    </label>

                    <label className="flex items-center gap-2 text-xs text-neutral-600 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={forceRefine}
                        onChange={e => setForceRefine(e.target.checked)}
                        className="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900"
                      />
                      <span>Force Re-Scan All Notes (including already refined)</span>
                    </label>
                  </div>
                </div>
              ) : (
                <button
                  onClick={handleStopRefine}
                  className="w-full py-2.5 px-3 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-xl text-xs font-semibold transition-colors border border-rose-200"
                >
                  Stop Sorting Queue
                </button>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-neutral-200 p-6 space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
                <h3 className="text-sm font-semibold text-neutral-900">PARA Distribution</h3>
                <span className="text-xs font-mono text-neutral-500 font-semibold tabular-nums">
                  {registry.length} notes
                </span>
              </div>

              {pieData.length === 0 ? (
                <div className="py-6 text-center text-xs text-neutral-400">
                  Run the pipeline to build folder distribution metrics.
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
                    {pieData.slice(0, 5).map(item => (
                      <div key={item.name} className="flex justify-between items-center py-0.5">
                        <span className="text-neutral-600 font-mono text-[11px]">{item.name}</span>
                        <span className="font-mono text-neutral-900 font-medium tabular-nums">
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
      )}

      {activeToolTab === 'triage' && (
        <TriagePanel
          config={config}
          onSaveConfig={onSaveConfig}
          onNotify={onRefreshLogs}
        />
      )}

      {activeToolTab === 'revisor' && (
        <DirectoryRevisor
          vaultPath={config.vaultPath}
          onNotify={onRefreshLogs}
        />
      )}

      {activeToolTab === 'duplicates' && (
        <DuplicateCleaner onNotify={onRefreshLogs} />
      )}

      {activeToolTab === 'hypergraph' && (
        <HypergraphWorkspace
          vaultPath={config.vaultPath}
          onNotify={onRefreshLogs}
        />
      )}
    </div>
  );
};

export default PipelineWorkspace;
