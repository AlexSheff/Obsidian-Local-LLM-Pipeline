import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  FolderSearch,
  CheckCircle2,
  AlertTriangle,
  FolderGit2,
  ArrowRight,
  ShieldCheck,
  Film,
  FileCode,
  FileQuestion,
  Layers,
  Sparkles,
  Loader2,
  RefreshCw,
  FolderOpen,
  Check,
  Filter,
  Trash2,
  FileText,
  Undo2,
  FolderTree,
  XCircle,
  CheckSquare,
  Square,
  Info
} from 'lucide-react';

export interface FileRevisionItem {
  id: string;
  filename: string;
  relativePath: string;
  absolutePath: string;
  title: string;
  existingTags: string[];
  snippet: string;
  extension: string;
  detectedType: 'scenario' | 'project_asset' | 'technical_code' | 'foreign_project' | 'knowledge' | 'general' | 'raw_document' | 'junk';
  coherenceScore: number;
  isOutlier: boolean;
  isRawDoc: boolean;
  isJunk: boolean;
  contradictionReason: string;
  suggestedTargetFolder: string;
  suggestedAction: 'move' | 'convert_to_md' | 'delete_junk';
  confidence: number;
  selectedForMove?: boolean;
}

export interface DirectoryAuditReport {
  directoryPath: string;
  totalFiles: number;
  totalSubfoldersScanned: number;
  dominantTopic: string;
  summary: string;
  overallCoherence: number;
  hasContradictions: boolean;
  outliersCount: number;
  scenariosCount: number;
  rawDocsCount: number;
  junkCount: number;
  items: FileRevisionItem[];
  timestamp: string;
}

interface DirectoryRevisorProps {
  onNotify: () => void;
}

export const DirectoryRevisor: React.FC<DirectoryRevisorProps> = ({ onNotify }) => {
  const [folders, setFolders] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [customFolder, setCustomFolder] = useState<string>('');
  const [recursive, setRecursive] = useState<boolean>(true);
  const [maxDepth, setMaxDepth] = useState<number>(10);
  const [includeNonMarkdown, setIncludeNonMarkdown] = useState<boolean>(true);
  const [cleanupEmptyFolders, setCleanupEmptyFolders] = useState<boolean>(true);

  const [loadingFolders, setLoadingFolders] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [report, setReport] = useState<DirectoryAuditReport | null>(null);

  // Filter & item state
  const [filterType, setFilterType] = useState<
    'all' | 'outliers' | 'junk' | 'scenarios' | 'raw_docs' | 'aligned'
  >('outliers');
  const [subfolderFilter, setSubfolderFilter] = useState<string>('all');
  const [items, setItems] = useState<FileRevisionItem[]>([]);

  // Apply state
  const [applying, setApplying] = useState(false);
  const [purgingGhosts, setPurgingGhosts] = useState(false);
  const [reorganizingAll, setReorganizingAll] = useState(false);
  const [reorganizeMsg, setReorganizeMsg] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<{
    movedCount: number;
    convertedCount: number;
    deletedJunkCount: number;
    prunedFoldersCount: number;
    snapshotId: string;
  } | null>(null);

  // Rollback state
  const [rollingBack, setRollingBack] = useState(false);
  const [rollbackSuccess, setRollbackSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetchFolders();
  }, []);

  const fetchFolders = async () => {
    setLoadingFolders(true);
    try {
      const res = await axios.get('/api/folders');
      if (res.data && Array.isArray(res.data.folders)) {
        setFolders(res.data.folders);
      }
    } catch {
      setFolders([]);
    } finally {
      setLoadingFolders(false);
    }
  };

  const handleRunAudit = async () => {
    const targetDir = customFolder.trim() !== '' ? customFolder.trim() : selectedFolder;

    setAuditing(true);
    setAuditError(null);
    setApplyResult(null);
    setRollbackSuccess(null);
    setReorganizeMsg(null);

    try {
      const res = await axios.post('/api/revisor/audit', {
        relativeDir: targetDir,
        recursive,
        maxDepth,
        includeNonMarkdown
      });

      const auditData: DirectoryAuditReport = res.data;
      setReport(auditData);

      // Auto-select outliers, junk, and raw docs by default for rapid triage
      const initialItems = (auditData.items || []).map(item => ({
        ...item,
        selectedForMove: item.isOutlier || item.isJunk || item.isRawDoc
      }));

      setItems(initialItems);

      // Set default filter based on what issues are discovered
      if (auditData.junkCount > 0) {
        setFilterType('junk');
      } else if (auditData.outliersCount > 0) {
        setFilterType('outliers');
      } else if (auditData.rawDocsCount > 0) {
        setFilterType('raw_docs');
      } else {
        setFilterType('all');
      }
      setSubfolderFilter('all');
    } catch (err: any) {
      setAuditError(
        err.response?.data?.error ||
          err.message ||
          'Failed to audit directory. Ensure local model server is online.'
      );
    } finally {
      setAuditing(false);
    }
  };

  const handleToggleSelect = (id: string) => {
    setItems(prev =>
      prev.map(i => (i.id === id ? { ...i, selectedForMove: !i.selectedForMove } : i))
    );
  };

  const handleTargetFolderChange = (id: string, folder: string) => {
    setItems(prev =>
      prev.map(i => (i.id === id ? { ...i, suggestedTargetFolder: folder } : i))
    );
  };

  const handleActionChange = (id: string, action: 'move' | 'convert_to_md' | 'delete_junk') => {
    setItems(prev =>
      prev.map(i => (i.id === id ? { ...i, suggestedAction: action } : i))
    );
  };

  const handleSelectAll = (select: boolean) => {
    setItems(prev => prev.map(i => ({ ...i, selectedForMove: select })));
  };

  const handleSelectByType = (type: 'outliers' | 'junk' | 'raw_docs') => {
    setItems(prev =>
      prev.map(i => {
        let shouldSelect = false;
        if (type === 'outliers') shouldSelect = i.isOutlier;
        if (type === 'junk') shouldSelect = i.isJunk;
        if (type === 'raw_docs') shouldSelect = i.isRawDoc;
        return { ...i, selectedForMove: shouldSelect };
      })
    );
  };

  const handlePurgeAllGhostNotes = async () => {
    const targetDir = customFolder.trim() !== '' ? customFolder.trim() : selectedFolder;
    setPurgingGhosts(true);
    setAuditError(null);
    setReorganizeMsg(null);
    try {
      const res = await axios.post('/api/vault/purge-ghosts', { folder: targetDir });
      if (res.data.purgedCount > 0) {
        setApplyResult({
          movedCount: 0,
          convertedCount: 0,
          deletedJunkCount: res.data.purgedCount,
          prunedFoldersCount: 0,
          snapshotId: res.data.snapshotId
        });
        const purgedPaths = new Set(res.data.files.map((f: any) => f.filePath));
        setItems(prev => prev.filter(i => !purgedPaths.has(i.absolutePath)));
        if (report) {
          setReport({
            ...report,
            junkCount: Math.max(0, report.junkCount - res.data.purgedCount),
            totalFiles: Math.max(0, report.totalFiles - res.data.purgedCount)
          });
        }
      } else {
        setReorganizeMsg('No empty ghost notes found in selected scope.');
      }
      onNotify();
    } catch (err: any) {
      setAuditError(err.response?.data?.error || err.message || 'Failed to purge ghost notes');
    } finally {
      setPurgingGhosts(false);
    }
  };

  const handleReorganizeAll = async () => {
    setReorganizingAll(true);
    setAuditError(null);
    setReorganizeMsg(null);
    try {
      const res = await axios.post('/api/vault/reorganize-all', { confirm: true }, { timeout: 300000 });
      setApplyResult({
        movedCount: res.data.movedCount ?? 0,
        convertedCount: res.data.convertedCount ?? 0,
        deletedJunkCount: res.data.deletedJunkCount ?? 0,
        prunedFoldersCount: res.data.prunedFoldersCount ?? 0,
        snapshotId: res.data.snapshotId
      });
      setReorganizeMsg(res.data.message || 'Vault reorganized successfully!');
      setItems(prev => prev.filter(i => !i.isOutlier && !i.isJunk && !i.isRawDoc));
      await fetchFolders();
      onNotify();
    } catch (err: any) {
      setAuditError(err.response?.data?.error || err.message || 'Failed to reorganize vault');
    } finally {
      setReorganizingAll(false);
    }
  };

  const handleApplyRevision = async () => {
    const toProcess = items.filter(i => i.selectedForMove);
    if (toProcess.length === 0) {
      setAuditError('Please select at least one file to process.');
      return;
    }

    setApplying(true);
    setAuditError(null);
    try {
      const payload = {
        itemsToMove: toProcess.map(i => ({
          filePath: i.absolutePath,
          targetFolder: i.suggestedTargetFolder,
          detectedType: i.detectedType,
          action: i.suggestedAction || 'move'
        })),
        cleanupEmptyFolders,
        confirm: true
      };

      const res = await axios.post('/api/revisor/apply', payload);
      setApplyResult({
        movedCount: res.data.movedCount ?? 0,
        convertedCount: res.data.convertedCount ?? 0,
        deletedJunkCount: res.data.deletedJunkCount ?? 0,
        prunedFoldersCount: res.data.prunedFoldersCount ?? 0,
        snapshotId: res.data.snapshotId
      });

      const moved = res.data.movedCount ?? 0;
      const converted = res.data.convertedCount ?? 0;
      const junked = res.data.deletedJunkCount ?? 0;

      // Remove processed items from the list
      setItems(prev => prev.filter(i => !toProcess.some(m => m.id === i.id)));
      if (report) {
        setReport({
          ...report,
          totalFiles: Math.max(0, report.totalFiles - toProcess.length),
          outliersCount: Math.max(0, report.outliersCount - moved),
          junkCount: Math.max(0, report.junkCount - junked),
          rawDocsCount: Math.max(0, report.rawDocsCount - converted)
        });
      }
      onNotify();
    } catch (err: any) {
      setAuditError(err.response?.data?.error || 'Failed to process revision plan');
    } finally {
      setApplying(false);
    }
  };

  const handleRollback = async () => {
    if (!applyResult?.snapshotId) return;

    setRollingBack(true);
    setAuditError(null);
    try {
      const res = await axios.post('/api/revisor/rollback', {
        snapshotId: applyResult.snapshotId
      });
      setRollbackSuccess(`Restored ${res.data.restoredCount} files from backup.`);
      setApplyResult(null);
      // Re-run audit to reflect restored files
      await handleRunAudit();
      onNotify();
    } catch (err: any) {
      setAuditError(err.response?.data?.error || 'Failed to rollback');
    } finally {
      setRollingBack(false);
    }
  };

  // Extract unique subfolder paths for the subfolder dropdown
  const subfoldersList = Array.from(
    new Set(
      items
        .map(i => {
          const parts = i.relativePath.split('/');
          parts.pop(); // remove filename
          return parts.join('/');
        })
        .filter(Boolean)
    )
  ).sort();

  // Filter items
  const filteredItems = items.filter(item => {
    // Subfolder filter
    if (subfolderFilter !== 'all') {
      const parts = item.relativePath.split('/');
      parts.pop();
      const itemSub = parts.join('/');
      if (itemSub !== subfolderFilter) return false;
    }

    if (filterType === 'outliers') return item.isOutlier && !item.isJunk;
    if (filterType === 'junk') return item.isJunk;
    if (filterType === 'scenarios') return item.detectedType === 'scenario';
    if (filterType === 'raw_docs') return item.isRawDoc;
    if (filterType === 'aligned') return !item.isOutlier && !item.isJunk && !item.isRawDoc;
    return true;
  });

  const selectedCount = items.filter(i => i.selectedForMove).length;

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
              <FolderSearch className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-neutral-900">
                Directory Revisor & Project Clustering
              </h2>
              <p className="text-xs text-neutral-500">
                Recursive subfolder scanning, project contradictions, raw document conversion & junk/ghost note cleanup
              </p>
            </div>
          </div>

          <button
            onClick={fetchFolders}
            disabled={loadingFolders}
            className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-900 border border-neutral-200 rounded-lg px-2.5 py-1.5 transition-colors self-start md:self-auto"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingFolders ? 'animate-spin' : ''}`} />
            Refresh Folders
          </button>
        </div>

        {/* Directory Selector & Recursive Configuration Bar */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="md:col-span-1">
            <label className="block text-xs font-medium text-neutral-600 mb-1.5">
              Vault Directory to Audit
            </label>
            <select
              value={selectedFolder}
              onChange={e => {
                setSelectedFolder(e.target.value);
                setCustomFolder('');
              }}
              className="w-full bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900 font-mono text-xs"
            >
              <option value="">Whole Vault (Root & all folders)</option>
              {folders.map(f => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-1">
            <label className="block text-xs font-medium text-neutral-600 mb-1.5">
              Or enter relative folder path
            </label>
            <input
              type="text"
              placeholder="e.g. 01_Projects/CleanNet"
              value={customFolder}
              onChange={e => setCustomFolder(e.target.value)}
              className="w-full bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900 font-mono text-xs"
            />
          </div>

          <div className="md:col-span-1">
            <label className="block text-xs font-medium text-neutral-600 mb-1.5">
              Scan Depth
            </label>
            <select
              value={maxDepth}
              onChange={e => setMaxDepth(Number(e.target.value))}
              disabled={!recursive}
              className="w-full bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900 text-xs"
            >
              <option value={1}>1 level (Top-level only)</option>
              <option value={3}>3 levels deep</option>
              <option value={5}>5 levels deep</option>
              <option value={10}>10 levels deep (Full Tree)</option>
            </select>
          </div>

          <div className="md:col-span-1 flex flex-col gap-2">
            <button
              onClick={handleRunAudit}
              disabled={auditing || reorganizingAll}
              className="w-full bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-50 px-4 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-2 transition-colors shadow-xs"
            >
              {auditing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Scanning...
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  Audit Selected Scope
                </>
              )}
            </button>

            <button
              onClick={handlePurgeAllGhostNotes}
              disabled={purgingGhosts || auditing || reorganizingAll}
              className="w-full bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
              title="Purge empty notes with zero body content in selected folder/vault with 1-click snapshot rollback"
            >
              {purgingGhosts ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-600" />
                  Purging...
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                  Purge Empty Ghost Notes
                </>
              )}
            </button>
          </div>
        </div>

        {/* Master 1-Click Vault Reorganization Banner */}
        <div className="mt-4 p-3 bg-neutral-50 border border-neutral-200 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <FolderGit2 className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-semibold text-neutral-900">
                1-Click Master Vault Reorganization & Clean Structure
              </p>
              <p className="text-[11px] text-neutral-500">
                Audits whole vault, purges all ghost notes, relocates misplaced files to PARA & prunes empty directories with safe undo snapshot.
              </p>
            </div>
          </div>

          <button
            onClick={handleReorganizeAll}
            disabled={reorganizingAll || auditing}
            className="shrink-0 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-medium px-4 py-2 rounded-lg flex items-center gap-1.5 shadow-xs transition-colors"
          >
            {reorganizingAll ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Reorganizing Vault...
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-emerald-200" />
                Reorganize Entire Vault
              </>
            )}
          </button>
        </div>

        {reorganizeMsg && (
          <div className="mt-4 p-3.5 bg-emerald-50 text-emerald-800 rounded-xl text-xs flex items-center gap-2 border border-emerald-200">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{reorganizeMsg}</span>
          </div>
        )}

        {/* Scan Options Checkboxes */}
        <div className="mt-4 pt-3 border-t border-neutral-100 flex flex-wrap items-center gap-6 text-xs text-neutral-600">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={recursive}
              onChange={e => setRecursive(e.target.checked)}
              className="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900"
            />
            <span className="font-medium text-neutral-800">
              Recursive Subfolder Audit (traverse all nested subfolders)
            </span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={includeNonMarkdown}
              onChange={e => setIncludeNonMarkdown(e.target.checked)}
              className="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900"
            />
            <span className="font-medium text-neutral-800">
              Include Non-Markdown Files (Word, PDF, text documents & junk files)
            </span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer ml-auto">
            <input
              type="checkbox"
              checked={cleanupEmptyFolders}
              onChange={e => setCleanupEmptyFolders(e.target.checked)}
              className="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900"
            />
            <span className="text-neutral-700">
              Prune empty subfolders after relocation / cleanup
            </span>
          </label>
        </div>

        {auditError && (
          <div className="mt-4 p-3.5 bg-red-50 text-red-700 rounded-xl text-xs flex items-center gap-2 border border-red-200">
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
            <span>{auditError}</span>
          </div>
        )}

        {rollbackSuccess && (
          <div className="mt-4 p-3.5 bg-emerald-50 text-emerald-800 rounded-xl text-xs flex items-center gap-2 border border-emerald-200">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{rollbackSuccess}</span>
          </div>
        )}
      </div>

      {/* Audit Report Summary */}
      {report && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-6 space-y-6 shadow-xs">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-neutral-100">
            <div>
              <div className="flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-neutral-400" />
                <h3 className="text-base font-semibold text-neutral-900 font-mono">
                  {report.directoryPath}
                </h3>
              </div>
              <p className="text-xs text-neutral-500 mt-1">
                Dominant Theme:{' '}
                <span className="font-semibold text-neutral-800">{report.dominantTopic}</span>
                {report.totalSubfoldersScanned > 0 && (
                  <span className="ml-2 text-neutral-400">
                    ({report.totalSubfoldersScanned} subfolders scanned)
                  </span>
                )}
              </p>
            </div>

            {/* Metrics Badges */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="px-3 py-1 bg-neutral-100 rounded-lg text-xs font-medium text-neutral-700">
                Total Files: <span className="font-bold">{report.totalFiles}</span>
              </div>

              <div
                className={`px-3 py-1 rounded-lg text-xs font-medium ${
                  report.overallCoherence >= 75
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                }`}
              >
                Coherence: <span className="font-bold">{report.overallCoherence}%</span>
              </div>

              {report.junkCount > 0 && (
                <div className="px-3 py-1 bg-rose-50 text-rose-800 border border-rose-200 rounded-lg text-xs font-medium flex items-center gap-1">
                  <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                  Ghost Notes & Junk: <span className="font-bold">{report.junkCount}</span>
                </div>
              )}

              {report.rawDocsCount > 0 && (
                <div className="px-3 py-1 bg-blue-50 text-blue-800 border border-blue-200 rounded-lg text-xs font-medium flex items-center gap-1">
                  <FileText className="w-3.5 h-3.5 text-blue-600" />
                  Raw Docs: <span className="font-bold">{report.rawDocsCount}</span>
                </div>
              )}

              {report.scenariosCount > 0 && (
                <div className="px-3 py-1 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg text-xs font-medium flex items-center gap-1">
                  <Film className="w-3.5 h-3.5" />
                  Scenarios: <span className="font-bold">{report.scenariosCount}</span>
                </div>
              )}

              {report.outliersCount > 0 && (
                <div className="px-3 py-1 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg text-xs font-medium flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Misplaced: <span className="font-bold">{report.outliersCount}</span>
                </div>
              )}
            </div>
          </div>

          {/* Directory Scope Description */}
          {report.summary && (
            <div className="p-3.5 bg-neutral-50 rounded-xl border border-neutral-200/70 text-xs text-neutral-700 leading-relaxed">
              <span className="font-semibold text-neutral-900">Directory Profile: </span>
              {report.summary}
            </div>
          )}

          {/* Action Notification Banner & Instant Rollback */}
          {applyResult && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-emerald-900">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <div>
                  <p className="font-semibold text-emerald-950">
                    Reorganization and cleanup finished successfully!
                  </p>
                  <p className="text-emerald-800 mt-0.5">
                    Moved <strong>{applyResult.movedCount}</strong> files, converted{' '}
                    <strong>{applyResult.convertedCount}</strong> raw docs to Markdown, purged{' '}
                    <strong>{applyResult.deletedJunkCount}</strong> ghost notes / junk, and pruned{' '}
                    <strong>{applyResult.prunedFoldersCount}</strong> empty subfolders.
                  </p>
                </div>
              </div>

              <button
                onClick={handleRollback}
                disabled={rollingBack}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-emerald-300 rounded-lg text-emerald-800 font-medium hover:bg-emerald-100 transition-colors shrink-0 shadow-xs"
              >
                {rollingBack ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Undo2 className="w-3.5 h-3.5" />
                )}
                Undo / Rollback Snapshot
              </button>
            </div>
          )}

          {/* Filters, Subfolder Picker & Batch Actions */}
          <div className="space-y-3 pt-2">
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3">
              {/* Category Filter Tabs */}
              <div className="flex flex-wrap items-center gap-1 bg-neutral-100 p-1 rounded-xl">
                <button
                  onClick={() => setFilterType('all')}
                  className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                    filterType === 'all'
                      ? 'bg-white text-neutral-900 shadow-xs'
                      : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  All Files ({items.length})
                </button>

                {report.junkCount > 0 && (
                  <button
                    onClick={() => setFilterType('junk')}
                    className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors flex items-center gap-1 ${
                      filterType === 'junk'
                        ? 'bg-white text-rose-800 shadow-xs font-bold'
                        : 'text-rose-700 hover:text-rose-900'
                    }`}
                  >
                    <Trash2 className="w-3 h-3" />
                    Ghost Notes & Junk ({report.junkCount})
                  </button>
                )}

                <button
                  onClick={() => setFilterType('outliers')}
                  className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                    filterType === 'outliers'
                      ? 'bg-white text-neutral-900 shadow-xs'
                      : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  Misplaced & Contradictions ({report.outliersCount})
                </button>

                {report.rawDocsCount > 0 && (
                  <button
                    onClick={() => setFilterType('raw_docs')}
                    className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors flex items-center gap-1 ${
                      filterType === 'raw_docs'
                        ? 'bg-white text-blue-900 shadow-xs font-bold'
                        : 'text-blue-700 hover:text-blue-900'
                    }`}
                  >
                    <FileText className="w-3 h-3" />
                    Raw Docs ({report.rawDocsCount})
                  </button>
                )}

                {report.scenariosCount > 0 && (
                  <button
                    onClick={() => setFilterType('scenarios')}
                    className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                      filterType === 'scenarios'
                        ? 'bg-white text-neutral-900 shadow-xs'
                        : 'text-neutral-600 hover:text-neutral-900'
                    }`}
                  >
                    Scenarios ({report.scenariosCount})
                  </button>
                )}

                <button
                  onClick={() => setFilterType('aligned')}
                  className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                    filterType === 'aligned'
                      ? 'bg-white text-neutral-900 shadow-xs'
                      : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  Aligned ({items.filter(i => !i.isOutlier && !i.isJunk && !i.isRawDoc).length})
                </button>
              </div>

              {/* Subfolder Dropdown Filter */}
              {subfoldersList.length > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <FolderTree className="w-4 h-4 text-neutral-400" />
                  <span className="text-neutral-500">Subfolder:</span>
                  <select
                    value={subfolderFilter}
                    onChange={e => setSubfolderFilter(e.target.value)}
                    className="bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1 text-xs text-neutral-800 focus:outline-none focus:ring-1 focus:ring-neutral-900 font-mono"
                  >
                    <option value="all">All Subfolders ({subfoldersList.length + 1})</option>
                    {subfoldersList.map(sub => (
                      <option key={sub} value={sub}>
                        📁 {sub}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Batch Selection & Action Execution Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-neutral-50 rounded-xl border border-neutral-200">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-neutral-700">Quick Select:</span>
                <button
                  onClick={() => handleSelectAll(true)}
                  className="px-2 py-1 bg-white border border-neutral-200 rounded hover:bg-neutral-100 text-neutral-700 font-medium"
                >
                  All ({items.length})
                </button>
                {report.junkCount > 0 && (
                  <button
                    onClick={() => handleSelectByType('junk')}
                    className="px-2 py-1 bg-rose-50 border border-rose-200 rounded hover:bg-rose-100 text-rose-800 font-medium"
                  >
                    Ghost Notes & Junk ({report.junkCount})
                  </button>
                )}
                {report.outliersCount > 0 && (
                  <button
                    onClick={() => handleSelectByType('outliers')}
                    className="px-2 py-1 bg-amber-50 border border-amber-200 rounded hover:bg-amber-100 text-amber-800 font-medium"
                  >
                    Outliers ({report.outliersCount})
                  </button>
                )}
                {report.rawDocsCount > 0 && (
                  <button
                    onClick={() => handleSelectByType('raw_docs')}
                    className="px-2 py-1 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 text-blue-800 font-medium"
                  >
                    Raw Docs ({report.rawDocsCount})
                  </button>
                )}
                <button
                  onClick={() => handleSelectAll(false)}
                  className="px-2 py-1 bg-white border border-neutral-200 rounded hover:bg-neutral-100 text-neutral-500"
                >
                  Deselect All
                </button>
              </div>

              <div className="flex items-center gap-2 ml-auto">
                {report.junkCount > 0 && (
                  <button
                    onClick={handlePurgeAllGhostNotes}
                    disabled={purgingGhosts || applying}
                    className="bg-rose-50 hover:bg-rose-100 border border-rose-300 text-rose-800 text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5 transition-colors shadow-xs"
                    title="Safely remove all notes with zero body content in this directory (with undo snapshot)"
                  >
                    {purgingGhosts ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                    )}
                    Purge All Ghost Notes ({report.junkCount})
                  </button>
                )}

                <button
                  onClick={handleApplyRevision}
                  disabled={applying || selectedCount === 0}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold px-4 py-2 rounded-lg flex items-center gap-2 transition-colors shadow-sm"
                >
                  {applying ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Executing Reorganization...
                    </>
                  ) : (
                    <>
                      <ArrowRight className="w-4 h-4" />
                      Execute Reorganization & Cleanup ({selectedCount} selected)
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Files List */}
          <div className="space-y-3">
            {filteredItems.length === 0 ? (
              <div className="text-center py-12 text-neutral-400 text-xs">
                No files match the selected filter.
              </div>
            ) : (
              filteredItems.map(item => {
                const isScenario = item.detectedType === 'scenario';
                const isForeign = item.detectedType === 'foreign_project';
                const isTech = item.detectedType === 'technical_code';
                const isJunk = item.isJunk;
                const isRawDoc = item.isRawDoc;

                // Subfolder path badge
                const pathParts = item.relativePath.split('/');
                pathParts.pop();
                const subfolderDisplay = pathParts.join('/');

                return (
                  <div
                    key={item.id}
                    className={`border rounded-xl p-4 transition-all ${
                      isJunk
                        ? 'border-rose-300 bg-rose-50/30'
                        : item.isOutlier
                        ? 'border-amber-200 bg-amber-50/30'
                        : isRawDoc
                        ? 'border-blue-200 bg-blue-50/20'
                        : 'border-neutral-200 bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <input
                          type="checkbox"
                          checked={!!item.selectedForMove}
                          onChange={() => handleToggleSelect(item.id)}
                          className="mt-1 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900 cursor-pointer"
                        />

                        <div className="min-w-0 flex-1">
                          {/* File Path & Badges */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm text-neutral-900 font-mono">
                              {item.filename}
                            </span>

                            {subfolderDisplay && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-neutral-100 text-neutral-600 border border-neutral-200 flex items-center gap-1">
                                📁 {subfolderDisplay}/
                              </span>
                            )}

                            {isJunk && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200 flex items-center gap-1">
                                <Trash2 className="w-3 h-3 text-rose-600" />
                                {item.contradictionReason?.toLowerCase().includes('ghost')
                                  ? '👻 GHOST NOTE (NO BODY)'
                                  : '🗑️ JUNK FILE'}
                              </span>
                            )}

                            {isRawDoc && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200 flex items-center gap-1">
                                <FileText className="w-3 h-3" />
                                RAW DOC ({item.extension.toUpperCase()})
                              </span>
                            )}

                            {isScenario && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200 flex items-center gap-1">
                                <Film className="w-3 h-3" />
                                SCENARIO / SCRIPT
                              </span>
                            )}

                            {isForeign && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200 flex items-center gap-1">
                                <FolderGit2 className="w-3 h-3" />
                                FOREIGN PROJECT
                              </span>
                            )}

                            {isTech && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200 flex items-center gap-1">
                                <FileCode className="w-3 h-3" />
                                CODE / TECHNICAL
                              </span>
                            )}

                            {!item.isOutlier && !isJunk && !isRawDoc && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                                <Check className="w-3 h-3" />
                                ALIGNED
                              </span>
                            )}

                            <span className="text-[11px] text-neutral-400 font-mono">
                              (Coherence: {item.coherenceScore}%)
                            </span>
                          </div>

                          {/* Contradiction / Issue Explanation */}
                          {(item.isOutlier || isJunk || isRawDoc) && item.contradictionReason && (
                            <p
                              className={`text-xs mt-1.5 font-medium rounded-md p-2 border ${
                                isJunk
                                  ? 'bg-rose-100/70 text-rose-950 border-rose-200'
                                  : isRawDoc
                                  ? 'bg-blue-100/70 text-blue-950 border-blue-200'
                                  : 'bg-amber-100/70 text-amber-950 border-amber-200'
                              }`}
                            >
                              {isJunk ? '🗑️ ' : isRawDoc ? '📄 ' : '⚠️ '}
                              <strong>Issue:</strong> {item.contradictionReason}
                            </p>
                          )}

                          {/* Snippet Preview */}
                          <p className="text-xs text-neutral-500 mt-2 line-clamp-2 italic font-serif">
                            "{item.snippet}"
                          </p>

                          {/* Target Folder & Action Controls */}
                          {(item.isOutlier || isJunk || isRawDoc) && (
                            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs pt-2 border-t border-neutral-200/50">
                              <div className="flex items-center gap-1.5">
                                <span className="text-neutral-500 font-medium">Action:</span>
                                <select
                                  value={item.suggestedAction}
                                  onChange={e =>
                                    handleActionChange(
                                      item.id,
                                      e.target.value as 'move' | 'convert_to_md' | 'delete_junk'
                                    )
                                  }
                                  className="bg-white border border-neutral-300 rounded px-2 py-1 text-xs font-medium text-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
                                >
                                  {isJunk && <option value="delete_junk">🗑️ Purge Junk / Ghost Note</option>}
                                  {isRawDoc && (
                                    <option value="convert_to_md">
                                      📄 Convert to Markdown Note
                                    </option>
                                  )}
                                  <option value="move">🚚 Move to Target Folder</option>
                                  {!isJunk && <option value="delete_junk">🗑️ Delete File</option>}
                                </select>
                              </div>

                              {item.suggestedAction !== 'delete_junk' && (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-neutral-500 font-medium">Target folder:</span>
                                  <input
                                    type="text"
                                    value={item.suggestedTargetFolder}
                                    onChange={e => handleTargetFolderChange(item.id, e.target.value)}
                                    className="bg-white border border-neutral-300 rounded px-2.5 py-1 text-xs text-neutral-800 focus:outline-none focus:ring-1 focus:ring-neutral-900 w-64 font-mono"
                                  />
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default DirectoryRevisor;
