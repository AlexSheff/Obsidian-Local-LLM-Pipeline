import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Copy, 
  Trash2, 
  RefreshCw, 
  RotateCcw, 
  CheckCircle2, 
  AlertTriangle, 
  FileText, 
  ShieldCheck, 
  Search, 
  ArrowRight,
  Eye,
  Check,
  X,
  ExternalLink,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

interface NoteItem {
  filePath: string;
  relativePath: string;
  fileName: string;
  size: number;
  mtime: number;
  mtimeStr: string;
  tags: string[];
  snippet: string;
  bodyHash: string;
  normBody: string;
  baseTitle: string;
  numberSuffix: number | null;
}

interface DuplicateGroup {
  id: string;
  title: string;
  matchType: 'exact_content' | 'numbered_copy';
  similarity: number;
  canonical: NoteItem;
  duplicates: NoteItem[];
  reclaimableBytes: number;
}

interface DuplicateStats {
  totalGroups: number;
  totalDuplicateFiles: number;
  exactDuplicatesCount: number;
  reclaimableBytes: number;
}

interface DuplicateCleanerProps {
  onNotify?: () => void;
}

export default function DuplicateCleaner({ onNotify }: DuplicateCleanerProps) {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [stats, setStats] = useState<DuplicateStats>({
    totalGroups: 0,
    totalDuplicateFiles: 0,
    exactDuplicatesCount: 0,
    reclaimableBytes: 0
  });
  const [trashExists, setTrashExists] = useState(false);
  const [latestBackupDate, setLatestBackupDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'exact' | 'numbered'>('all');
  const [expandedSnippets, setExpandedSnippets] = useState<Record<string, boolean>>({});
  const [compareModal, setCompareModal] = useState<{
    group: DuplicateGroup;
    duplicate: NoteItem;
  } | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  useEffect(() => {
    fetchDuplicates();
  }, []);

  const fetchDuplicates = async () => {
    setLoading(true);
    setStatusMessage(null);
    try {
      const res = await axios.get('/api/duplicates');
      setGroups(res.data.groups || []);
      setStats(res.data.stats || {
        totalGroups: 0,
        totalDuplicateFiles: 0,
        exactDuplicatesCount: 0,
        reclaimableBytes: 0
      });
      setTrashExists(res.data.trashExists || false);
      setLatestBackupDate(res.data.latestBackupDate || null);
    } catch (err: any) {
      setStatusMessage({
        text: err.response?.data?.error || 'Failed to scan for duplicates. Ensure vault path is configured.',
        type: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCleanAllExact = async () => {
    if (!confirm(`Clean all ${stats.exactDuplicatesCount} exact duplicate notes? Any unique tags will be safely merged into original notes, and backups will be stored in 99_System/_duplicates_trash.`)) {
      return;
    }

    setActionLoading(true);
    try {
      const res = await axios.post('/api/duplicates/clean', { allExact: true });
      setStatusMessage({
        text: res.data.message || `Cleaned ${res.data.removedCount} exact duplicates.`,
        type: 'success'
      });
      await fetchDuplicates();
      if (onNotify) onNotify();
    } catch (err: any) {
      setStatusMessage({
        text: err.response?.data?.error || 'Failed to clean duplicates',
        type: 'error'
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleCleanSpecific = async (duplicatePath: string, canonicalPath: string) => {
    setActionLoading(true);
    try {
      const res = await axios.post('/api/duplicates/clean', {
        items: [{ duplicatePath, canonicalPath }]
      });
      setStatusMessage({
        text: res.data.message || 'Duplicate removed and merged safely.',
        type: 'success'
      });
      if (compareModal) setCompareModal(null);
      await fetchDuplicates();
      if (onNotify) onNotify();
    } catch (err: any) {
      setStatusMessage({
        text: err.response?.data?.error || 'Failed to clean duplicate',
        type: 'error'
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleCleanGroup = async (group: DuplicateGroup) => {
    const items = group.duplicates.map(d => ({
      duplicatePath: d.filePath,
      canonicalPath: group.canonical.filePath
    }));

    setActionLoading(true);
    try {
      const res = await axios.post('/api/duplicates/clean', { items });
      setStatusMessage({
        text: res.data.message || `Cleaned ${items.length} duplicates in "${group.title}".`,
        type: 'success'
      });
      await fetchDuplicates();
      if (onNotify) onNotify();
    } catch (err: any) {
      setStatusMessage({
        text: err.response?.data?.error || 'Failed to clean group',
        type: 'error'
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestore = async () => {
    if (!confirm('Restore notes from the most recent cleanup backup in 99_System/_duplicates_trash?')) {
      return;
    }

    setActionLoading(true);
    try {
      const res = await axios.post('/api/duplicates/restore');
      setStatusMessage({
        text: res.data.message || `Restored notes from backup.`,
        type: 'success'
      });
      await fetchDuplicates();
      if (onNotify) onNotify();
    } catch (err: any) {
      setStatusMessage({
        text: err.response?.data?.error || 'Failed to restore backup',
        type: 'error'
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleSetAsPrimary = (group: DuplicateGroup, newPrimary: NoteItem) => {
    // Swap canonical and duplicate locally in state
    setGroups(prev => prev.map(g => {
      if (g.id !== group.id) return g;
      const allNotes = [g.canonical, ...g.duplicates];
      const newCanonical = newPrimary;
      const newDuplicates = allNotes.filter(n => n.filePath !== newPrimary.filePath);
      return {
        ...g,
        canonical: newCanonical,
        duplicates: newDuplicates
      };
    }));
  };

  const toggleSnippet = (path: string) => {
    setExpandedSnippets(prev => ({ ...prev, [path]: !prev[path] }));
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  // Filter groups
  const filteredGroups = groups.filter(g => {
    if (activeFilter === 'exact' && g.matchType !== 'exact_content') return false;
    if (activeFilter === 'numbered' && g.matchType !== 'numbered_copy') return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      g.title.toLowerCase().includes(q) ||
      g.canonical.relativePath.toLowerCase().includes(q) ||
      g.duplicates.some(d => d.relativePath.toLowerCase().includes(q) || d.tags.some(t => t.toLowerCase().includes(q)))
    );
  });

  return (
    <div className="space-y-6">
      {/* Top Banner / Safety Note */}
      <div className="bg-neutral-50 rounded-2xl border border-neutral-200 p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-9 h-9 rounded-xl bg-neutral-900 text-white flex items-center justify-center shrink-0 mt-0.5">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-neutral-900">Safe Vault Deduplication</h3>
            <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">
              Finds duplicate notes (e.g. <span className="font-mono text-neutral-700">"Note 1.md"</span>, <span className="font-mono text-neutral-700">"Note 2.md"</span>) and identical content. 
              Before removal, <strong>unique tags are merged</strong> into the primary note, and copies are safely archived to <span className="font-mono text-neutral-700">99_System/_duplicates_trash/</span>.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {trashExists && (
            <button
              onClick={handleRestore}
              disabled={actionLoading}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white hover:bg-neutral-100 text-neutral-700 border border-neutral-200 rounded-lg transition-colors shadow-sm disabled:opacity-50"
              title="Undo the last cleanup session and restore notes"
            >
              <RotateCcw className="w-3.5 h-3.5 text-neutral-500" />
              Restore Last Clean
            </button>
          )}

          <button
            onClick={fetchDuplicates}
            disabled={loading || actionLoading}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white hover:bg-neutral-100 text-neutral-700 border border-neutral-200 rounded-lg transition-colors shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Rescan
          </button>

          {stats.exactDuplicatesCount > 0 && (
            <button
              onClick={handleCleanAllExact}
              disabled={actionLoading}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg transition-colors shadow-sm disabled:opacity-50"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              Clean All Exact ({stats.exactDuplicatesCount})
            </button>
          )}
        </div>
      </div>

      {/* Status Message */}
      {statusMessage && (
        <div className={`p-4 rounded-xl text-sm border flex items-center justify-between ${
          statusMessage.type === 'success' 
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
            : statusMessage.type === 'error'
            ? 'bg-red-50 border-red-200 text-red-800'
            : 'bg-neutral-100 border-neutral-200 text-neutral-800'
        }`}>
          <span>{statusMessage.text}</span>
          <button onClick={() => setStatusMessage(null)} className="p-1 hover:opacity-75">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-neutral-200 p-4">
          <span className="text-xs text-neutral-500 font-medium block mb-1">Duplicate Groups</span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-neutral-900">{stats.totalGroups}</span>
            <span className="text-xs text-neutral-400">clusters</span>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-neutral-200 p-4">
          <span className="text-xs text-neutral-500 font-medium block mb-1">Redundant Files</span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-amber-600">{stats.totalDuplicateFiles}</span>
            <span className="text-xs text-neutral-400">notes</span>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-neutral-200 p-4">
          <span className="text-xs text-neutral-500 font-medium block mb-1">100% Exact Matches</span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-emerald-600">{stats.exactDuplicatesCount}</span>
            <span className="text-xs text-neutral-400">safe to clean</span>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-neutral-200 p-4">
          <span className="text-xs text-neutral-500 font-medium block mb-1">Reclaimable Space</span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-neutral-900">{formatBytes(stats.reclaimableBytes)}</span>
            <span className="text-xs text-neutral-400">in vault</span>
          </div>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 p-1 bg-neutral-100 rounded-lg w-full sm:w-auto">
          <button
            onClick={() => setActiveFilter('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeFilter === 'all' 
                ? 'bg-white text-neutral-900 shadow-sm font-semibold' 
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            All Duplicates ({stats.totalDuplicateFiles})
          </button>
          <button
            onClick={() => setActiveFilter('exact')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeFilter === 'exact' 
                ? 'bg-white text-neutral-900 shadow-sm font-semibold' 
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            Exact Matches ({stats.exactDuplicatesCount})
          </button>
          <button
            onClick={() => setActiveFilter('numbered')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeFilter === 'numbered' 
                ? 'bg-white text-neutral-900 shadow-sm font-semibold' 
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            Numbered Copies ({stats.totalDuplicateFiles - stats.exactDuplicatesCount})
          </button>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search note name, folder, tag..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-neutral-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-neutral-900"
          />
        </div>
      </div>

      {/* Main Groups List */}
      {loading ? (
        <div className="py-16 text-center text-neutral-500 bg-white rounded-2xl border border-neutral-200 flex flex-col items-center justify-center gap-2">
          <RefreshCw className="w-6 h-6 animate-spin text-neutral-400" />
          <span className="text-sm">Scanning vault markdown notes for duplicate content...</span>
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="py-16 text-center bg-white rounded-2xl border border-neutral-200 p-8">
          <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-semibold text-neutral-900">No Duplicates Found!</h3>
          <p className="text-xs text-neutral-500 max-w-md mx-auto mt-1">
            {searchQuery 
              ? 'No duplicates matched your search query.' 
              : 'Your Obsidian vault is clean! All notes have unique titles and content.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredGroups.map((group) => (
            <div 
              key={group.id} 
              className="bg-white rounded-2xl border border-neutral-200 overflow-hidden shadow-xs"
            >
              {/* Group Header */}
              <div className="px-5 py-3.5 bg-neutral-50 border-b border-neutral-200 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="text-sm font-semibold text-neutral-900">{group.title}</span>
                  {group.matchType === 'exact_content' ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-800 border border-emerald-200">
                      100% Exact Content
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-800 border border-amber-200">
                      Numbered Copy (~{group.similarity}% match)
                    </span>
                  )}
                  <span className="text-xs text-neutral-400">
                    {group.duplicates.length} duplicate {group.duplicates.length === 1 ? 'copy' : 'copies'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-500">
                    Reclaim: <strong className="text-neutral-700">{formatBytes(group.reclaimableBytes)}</strong>
                  </span>
                  <button
                    onClick={() => handleCleanGroup(group)}
                    disabled={actionLoading}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-neutral-700 bg-white hover:bg-neutral-100 border border-neutral-200 rounded-md transition-colors shadow-xs"
                  >
                    <Trash2 className="w-3 h-3 text-red-500" />
                    Clean All Copies
                  </button>
                </div>
              </div>

              {/* Group Body: Canonical + Duplicates */}
              <div className="p-4 space-y-3">
                {/* Canonical File */}
                <div className="p-3.5 rounded-xl bg-neutral-50/70 border border-neutral-200/80 flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-neutral-900 text-white">
                        Original (Keep)
                      </span>
                      <span className="text-xs font-mono font-medium text-neutral-900 truncate">
                        {group.canonical.relativePath}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-[11px] text-neutral-500">
                      <span>Size: {formatBytes(group.canonical.size)}</span>
                      <span>Modified: {group.canonical.mtimeStr}</span>
                      {group.canonical.tags.length > 0 && (
                        <span>Tags: {group.canonical.tags.slice(0, 4).join(', ')}{group.canonical.tags.length > 4 ? ` +${group.canonical.tags.length - 4}` : ''}</span>
                      )}
                    </div>

                    {expandedSnippets[group.canonical.filePath] && (
                      <p className="text-xs text-neutral-600 bg-white p-2.5 rounded border border-neutral-200 font-mono mt-2 leading-relaxed">
                        {group.canonical.snippet || '*(Empty note body)*'}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => toggleSnippet(group.canonical.filePath)}
                      className="p-1.5 text-neutral-500 hover:text-neutral-700 text-xs rounded hover:bg-neutral-200/50 flex items-center gap-1"
                      title="Preview snippet"
                    >
                      {expandedSnippets[group.canonical.filePath] ? (
                        <>
                          <ChevronUp className="w-3.5 h-3.5" />
                          <span className="text-[11px]">Hide</span>
                        </>
                      ) : (
                        <>
                          <ChevronDown className="w-3.5 h-3.5" />
                          <span className="text-[11px]">Preview</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Duplicates list */}
                <div className="space-y-2 pl-2 sm:pl-4 border-l-2 border-neutral-200 ml-2">
                  {group.duplicates.map((dup) => (
                    <div 
                      key={dup.filePath}
                      className="p-3 rounded-xl bg-white border border-neutral-200 hover:border-neutral-300 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3"
                    >
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
                            Duplicate
                          </span>
                          <span className="text-xs font-mono font-medium text-neutral-800 truncate">
                            {dup.relativePath}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 text-[11px] text-neutral-500">
                          <span>Size: {formatBytes(dup.size)}</span>
                          <span>Modified: {dup.mtimeStr}</span>
                          {dup.tags.length > 0 && (
                            <span>Tags: {dup.tags.slice(0, 4).join(', ')}{dup.tags.length > 4 ? ` +${dup.tags.length - 4}` : ''}</span>
                          )}
                        </div>

                        {expandedSnippets[dup.filePath] && (
                          <p className="text-xs text-neutral-600 bg-neutral-50 p-2.5 rounded border border-neutral-200 font-mono mt-2 leading-relaxed">
                            {dup.snippet || '*(Empty note body)*'}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => setCompareModal({ group, duplicate: dup })}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs text-neutral-600 bg-neutral-100 hover:bg-neutral-200 rounded-md transition-colors"
                          title="View side-by-side comparison"
                        >
                          <Eye className="w-3 h-3" />
                          Compare
                        </button>

                        <button
                          onClick={() => handleSetAsPrimary(group, dup)}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs text-neutral-600 hover:text-neutral-900 rounded-md hover:bg-neutral-100 transition-colors"
                          title="Keep this copy as the main note instead"
                        >
                          <Check className="w-3 h-3 text-neutral-400" />
                          Set as Primary
                        </button>

                        <button
                          onClick={() => handleCleanSpecific(dup.filePath, group.canonical.filePath)}
                          disabled={actionLoading}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md transition-colors"
                          title="Safely remove this duplicate and merge its tags"
                        >
                          <Trash2 className="w-3 h-3" />
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Side-by-Side Compare Modal */}
      {compareModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-neutral-200 w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-neutral-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900">Compare Notes</h3>
                <p className="text-xs text-neutral-500">
                  {compareModal.group.matchType === 'exact_content' ? '100% Exact Content Match' : `Numbered Collision Copy (~${compareModal.group.similarity}% match)`}
                </p>
              </div>
              <button 
                onClick={() => setCompareModal(null)}
                className="p-1 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content - Side by Side */}
            <div className="p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">
              {/* Left: Canonical */}
              <div className="space-y-2 flex flex-col">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold px-2 py-0.5 bg-neutral-900 text-white rounded">
                    Original Note (Keep)
                  </span>
                  <span className="text-xs text-neutral-400">{formatBytes(compareModal.group.canonical.size)}</span>
                </div>
                <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-200 text-xs font-mono break-all">
                  {compareModal.group.canonical.relativePath}
                </div>
                <div className="text-xs text-neutral-500">
                  <strong>Tags:</strong> {compareModal.group.canonical.tags.join(', ') || 'None'}
                </div>
                <div className="flex-1 min-h-[160px] p-3 bg-neutral-50 rounded-xl border border-neutral-200 text-xs font-mono whitespace-pre-wrap overflow-y-auto leading-relaxed text-neutral-700">
                  {compareModal.group.canonical.snippet || '*(Empty body)*'}
                </div>
              </div>

              {/* Right: Duplicate */}
              <div className="space-y-2 flex flex-col">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold px-2 py-0.5 bg-amber-100 text-amber-800 border border-amber-200 rounded">
                    Duplicate Copy
                  </span>
                  <span className="text-xs text-neutral-400">{formatBytes(compareModal.duplicate.size)}</span>
                </div>
                <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-200 text-xs font-mono break-all">
                  {compareModal.duplicate.relativePath}
                </div>
                <div className="text-xs text-neutral-500">
                  <strong>Tags:</strong> {compareModal.duplicate.tags.join(', ') || 'None'}
                </div>
                <div className="flex-1 min-h-[160px] p-3 bg-neutral-50 rounded-xl border border-neutral-200 text-xs font-mono whitespace-pre-wrap overflow-y-auto leading-relaxed text-neutral-700">
                  {compareModal.duplicate.snippet || '*(Empty body)*'}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-neutral-200 bg-neutral-50 flex items-center justify-between">
              <div className="text-xs text-neutral-500">
                Any unique tags in the duplicate will be preserved in the original note.
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCompareModal(null)}
                  className="px-3 py-1.5 text-xs text-neutral-600 hover:text-neutral-900 rounded-lg hover:bg-neutral-200/60"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleCleanSpecific(compareModal.duplicate.filePath, compareModal.group.canonical.filePath)}
                  disabled={actionLoading}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg transition-colors shadow-sm"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  Keep Original & Clean Duplicate
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
