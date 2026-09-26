import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import {
  Search,
  Folder,
  FolderTree,
  Tag,
  FileText,
  AlertTriangle,
  Trash2,
  Save,
  Move,
  Sparkles,
  RefreshCw,
  ExternalLink,
  Layers,
  Globe,
  Calendar,
  Hash,
  ArrowRight,
  Check,
  CheckCircle2,
  X,
  Filter,
  Loader2,
  ChevronRight,
  FileCode,
  ShieldCheck,
  FolderGit2
} from 'lucide-react';

export interface NoteSummary {
  id: string;
  filename: string;
  relativePath: string;
  title: string;
  tags: string[];
  category: string;
  language: string;
  snippet: string;
  sizeBytes: number;
  modifiedTime: string;
  isGhost: boolean;
  ghostReason?: string;
  wikilinks: string[];
}

export interface NoteDetail {
  relativePath: string;
  filename: string;
  fullPath: string;
  frontmatter: Record<string, any>;
  body: string;
  rawContent: string;
  isGhost: boolean;
  ghostReason?: string;
  language: string;
  sizeBytes: number;
  modifiedTime: string;
  wikilinks: string[];
}

interface KnowledgeExplorerProps {
  vaultPath: string;
  onNotify: () => void;
}

export const KnowledgeExplorer: React.FC<KnowledgeExplorerProps> = ({ vaultPath, onNotify }) => {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFolder, setSelectedFolder] = useState<string>('all');
  const [selectedTag, setSelectedTag] = useState<string>('');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('all');
  const [viewFilter, setViewFilter] = useState<'all' | 'clean' | 'ghosts'>('all');
  const [sortBy, setSortBy] = useState<'modified' | 'title' | 'size'>('modified');

  // Selected note details
  const [selectedNotePath, setSelectedNotePath] = useState<string | null>(null);
  const [noteDetail, setNoteDetail] = useState<NoteDetail | null>(null);
  const [loadingNote, setLoadingNote] = useState(false);
  const [editBody, setEditBody] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [moveTargetFolder, setMoveTargetFolder] = useState('');
  const [movingNote, setMovingNote] = useState(false);
  const [purgingNote, setPurgingNote] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  useEffect(() => {
    loadNotes();
    loadFolders();
  }, [selectedFolder, selectedTag, viewFilter]);

  const loadFolders = async () => {
    try {
      const res = await axios.get('/api/folders');
      if (res.data?.folders) {
        setFolders(res.data.folders);
      }
    } catch {
      setFolders([]);
    }
  };

  const loadNotes = async () => {
    setLoading(true);
    setError(null);
    try {
      const params: any = {
        folder: selectedFolder !== 'all' ? selectedFolder : '',
        tag: selectedTag || '',
        hideGhosts: viewFilter === 'clean' ? 'true' : 'false'
      };
      if (searchQuery.trim()) {
        params.q = searchQuery.trim();
      }

      const res = await axios.get('/api/vault/notes', { params });
      let loadedNotes: NoteSummary[] = res.data?.notes || [];

      if (viewFilter === 'ghosts') {
        loadedNotes = loadedNotes.filter(n => n.isGhost);
      }

      setNotes(loadedNotes);
      setAvailableTags(res.data?.tags || []);

      // Auto-select first note if none selected or if selected note was purged
      if (loadedNotes.length > 0) {
        if (!selectedNotePath || !loadedNotes.some(n => n.relativePath === selectedNotePath)) {
          handleSelectNote(loadedNotes[0].relativePath);
        }
      } else {
        setSelectedNotePath(null);
        setNoteDetail(null);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to load vault notes');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectNote = async (relativePath: string) => {
    setSelectedNotePath(relativePath);
    setLoadingNote(true);
    setActionSuccess(null);
    try {
      const res = await axios.get('/api/vault/note', { params: { path: relativePath } });
      const data: NoteDetail = res.data;
      setNoteDetail(data);
      setEditBody(data.body);
      setEditTitle(data.frontmatter?.title || data.filename.replace(/\.md$/i, ''));
      const tagsList = Array.isArray(data.frontmatter?.tags)
        ? data.frontmatter.tags.map(String)
        : [];
      setEditTags(tagsList.join(', '));
      setMoveTargetFolder(data.relativePath.includes('/') ? data.relativePath.substring(0, data.relativePath.lastIndexOf('/')) : '03_Knowledge');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to fetch note content');
    } finally {
      setLoadingNote(false);
    }
  };

  const handleSaveNote = async () => {
    if (!noteDetail) return;
    setSavingNote(true);
    setActionSuccess(null);
    try {
      const tagsArray = editTags
        .split(',')
        .map(t => t.trim().replace(/^#/, ''))
        .filter(Boolean);

      const updatedFrontmatter = {
        ...noteDetail.frontmatter,
        title: editTitle.trim(),
        tags: tagsArray
      };

      await axios.post('/api/vault/note/save', {
        path: noteDetail.relativePath,
        frontmatter: updatedFrontmatter,
        body: editBody
      });

      setActionSuccess('Note changes saved successfully.');
      onNotify();
      // Refresh note summary
      loadNotes();
      // Reload current note
      handleSelectNote(noteDetail.relativePath);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save note');
    } finally {
      setSavingNote(false);
    }
  };

  const handleMoveNote = async () => {
    if (!noteDetail || !moveTargetFolder) return;
    setMovingNote(true);
    setActionSuccess(null);
    try {
      const res = await axios.post('/api/vault/note/move', {
        sourcePath: noteDetail.relativePath,
        targetFolder: moveTargetFolder
      });

      setActionSuccess(`Note moved to "${res.data.newRelativePath}".`);
      onNotify();
      await loadFolders();
      await loadNotes();
      handleSelectNote(res.data.newRelativePath);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to move note');
    } finally {
      setMovingNote(false);
    }
  };

  const handlePurgeCurrentGhost = async () => {
    if (!noteDetail) return;
    setPurgingNote(true);
    setActionSuccess(null);
    try {
      // Move this specific note to trash or purge
      await axios.post('/api/vault/purge-ghosts', {
        folder: noteDetail.relativePath.includes('/')
          ? noteDetail.relativePath.substring(0, noteDetail.relativePath.lastIndexOf('/'))
          : ''
      });
      setActionSuccess('Empty ghost note safely purged into trash backup.');
      onNotify();
      await loadNotes();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to purge ghost note');
    } finally {
      setPurgingNote(false);
    }
  };

  // Filtered & Sorted Notes List
  const filteredNotes = useMemo(() => {
    let result = [...notes];

    if (selectedLanguage !== 'all') {
      result = result.filter(n => n.language === selectedLanguage);
    }

    if (sortBy === 'title') {
      result.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === 'size') {
      result.sort((a, b) => b.sizeBytes - a.sizeBytes);
    } else {
      // modified time
      result.sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime());
    }

    return result;
  }, [notes, selectedLanguage, sortBy]);

  const ghostCount = useMemo(() => notes.filter(n => n.isGhost).length, [notes]);

  return (
    <div className="space-y-4">
      {/* Search and Filter Top Toolbar */}
      <div className="bg-white rounded-2xl border border-neutral-200/90 p-4 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              placeholder="Search knowledge base notes by title, tag, or content..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') loadNotes();
              }}
              className="w-full bg-neutral-50 border border-neutral-200 rounded-xl pl-9 pr-8 py-2 text-xs text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 transition-all font-medium"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  loadNotes();
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* View Filter (All, Clean, Ghosts) */}
            <div className="flex items-center gap-1 bg-neutral-100 p-1 rounded-xl">
              <button
                onClick={() => setViewFilter('all')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-all ${
                  viewFilter === 'all'
                    ? 'bg-white text-neutral-900 shadow-xs font-semibold'
                    : 'text-neutral-500 hover:text-neutral-800'
                }`}
              >
                All ({notes.length})
              </button>
              <button
                onClick={() => setViewFilter('clean')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-all ${
                  viewFilter === 'clean'
                    ? 'bg-white text-neutral-900 shadow-xs font-semibold'
                    : 'text-neutral-500 hover:text-neutral-800'
                }`}
              >
                Clean Notes
              </button>
              <button
                onClick={() => setViewFilter('ghosts')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-all flex items-center gap-1 ${
                  viewFilter === 'ghosts'
                    ? 'bg-white text-rose-700 shadow-xs font-semibold'
                    : 'text-neutral-500 hover:text-rose-600'
                }`}
              >
                <span>Ghost Notes</span>
                {ghostCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-rose-100 text-rose-700 font-bold text-[10px]">
                    {ghostCount}
                  </span>
                )}
              </button>
            </div>

            {/* Language filter */}
            <select
              value={selectedLanguage}
              onChange={e => setSelectedLanguage(e.target.value)}
              className="bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs text-neutral-700 focus:outline-none focus:ring-1 focus:ring-neutral-900"
            >
              <option value="all">Any Language</option>
              <option value="ru">Russian (ru)</option>
              <option value="en">English (en)</option>
            </select>

            {/* Sort filter */}
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as any)}
              className="bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs text-neutral-700 focus:outline-none focus:ring-1 focus:ring-neutral-900"
            >
              <option value="modified">Most Recent</option>
              <option value="title">Title (A-Z)</option>
              <option value="size">Size (Large to Small)</option>
            </select>

            <button
              onClick={loadNotes}
              disabled={loading}
              className="p-1.5 border border-neutral-200 rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-50 transition-colors"
              title="Refresh Knowledge Base"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Action / Error notices */}
        {error && (
          <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-500" />
              <span>{error}</span>
            </div>
            <button onClick={() => setError(null)} className="text-rose-500 hover:text-rose-800">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {actionSuccess && (
          <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{actionSuccess}</span>
            </div>
            <button onClick={() => setActionSuccess(null)} className="text-emerald-600 hover:text-emerald-900">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Main Split Layout: Left Sidebar + Middle Note List + Right Note Reader */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
        {/* Left Column: Folders & Tags Navigator (3 cols) */}
        <div className="md:col-span-3 bg-white rounded-2xl border border-neutral-200/90 p-4 space-y-4 shadow-xs">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-neutral-900 flex items-center gap-1.5">
                <FolderTree className="w-3.5 h-3.5 text-amber-500" />
                <span>Vault Hierarchy</span>
              </h3>
              {selectedFolder !== 'all' && (
                <button
                  onClick={() => setSelectedFolder('all')}
                  className="text-[10px] text-blue-600 hover:underline"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="space-y-0.5 max-h-56 overflow-y-auto pr-1 text-xs">
              <button
                onClick={() => setSelectedFolder('all')}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition-colors ${
                  selectedFolder === 'all'
                    ? 'bg-neutral-900 text-white font-medium'
                    : 'text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                <span className="truncate">Whole Vault</span>
                <span className="text-[10px] opacity-75">{notes.length}</span>
              </button>

              {folders.map(f => (
                <button
                  key={f}
                  onClick={() => setSelectedFolder(f)}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition-colors ${
                    selectedFolder === f
                      ? 'bg-neutral-900 text-white font-medium'
                      : 'text-neutral-600 hover:bg-neutral-100'
                  }`}
                  title={f}
                >
                  <span className="truncate font-mono text-[11px]">{f}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Quick Tags Filter */}
          <div className="pt-3 border-t border-neutral-100">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-neutral-900 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-blue-500" />
                <span>Knowledge Tags</span>
              </h3>
              {selectedTag && (
                <button
                  onClick={() => setSelectedTag('')}
                  className="text-[10px] text-blue-600 hover:underline"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-1 max-h-40 overflow-y-auto">
              {availableTags.slice(0, 35).map(t => (
                <button
                  key={t}
                  onClick={() => setSelectedTag(selectedTag === t ? '' : t)}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-mono transition-all ${
                    selectedTag === t
                      ? 'bg-blue-600 text-white font-semibold'
                      : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                  }`}
                >
                  #{t}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Middle Column: Notes List (4 cols) */}
        <div className="md:col-span-4 bg-white rounded-2xl border border-neutral-200/90 overflow-hidden shadow-xs">
          <div className="p-3.5 border-b border-neutral-100 bg-neutral-50/50 flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-700">
              Notes ({filteredNotes.length})
            </span>
            <span className="text-[10px] text-neutral-400 font-mono">
              {selectedFolder === 'all' ? 'All folders' : selectedFolder}
            </span>
          </div>

          <div className="divide-y divide-neutral-100 max-h-[720px] overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center text-neutral-400 flex flex-col items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-xs">Scanning vault notes...</span>
              </div>
            ) : filteredNotes.length === 0 ? (
              <div className="p-8 text-center text-neutral-400 space-y-1">
                <p className="text-xs font-medium text-neutral-600">No notes found</p>
                <p className="text-[11px] text-neutral-400">
                  Try adjusting search query or clearing folder filters.
                </p>
              </div>
            ) : (
              filteredNotes.map(n => {
                const isSelected = selectedNotePath === n.relativePath;
                return (
                  <div
                    key={n.id}
                    onClick={() => handleSelectNote(n.relativePath)}
                    className={`p-3 cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-amber-50/70 border-l-4 border-amber-500'
                        : 'hover:bg-neutral-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-xs font-semibold text-neutral-900 line-clamp-1">
                        {n.title}
                      </h4>
                      {n.isGhost ? (
                        <span className="px-1.5 py-0.2 rounded bg-rose-100 text-rose-700 font-bold text-[9px] uppercase tracking-wide shrink-0">
                          Ghost
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.2 rounded bg-neutral-100 text-neutral-500 font-mono text-[9px] uppercase shrink-0">
                          {n.language}
                        </span>
                      )}
                    </div>

                    <p className="text-[11px] text-neutral-400 font-mono line-clamp-1 mt-0.5">
                      {n.relativePath}
                    </p>

                    <p className="text-xs text-neutral-600 line-clamp-2 mt-1.5 leading-relaxed">
                      {n.snippet}
                    </p>

                    {/* Tags preview */}
                    {n.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {n.tags.slice(0, 3).map((tag, idx) => (
                          <span
                            key={idx}
                            className="px-1.5 py-0.2 bg-neutral-100 text-neutral-500 rounded text-[10px] font-mono"
                          >
                            #{tag.replace(/^#/, '')}
                          </span>
                        ))}
                        {n.tags.length > 3 && (
                          <span className="text-[10px] text-neutral-400">
                            +{n.tags.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Note Inspector & Reader (5 cols) */}
        <div className="md:col-span-5 bg-white rounded-2xl border border-neutral-200/90 p-5 shadow-xs">
          {loadingNote ? (
            <div className="py-20 text-center text-neutral-400 flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-neutral-400" />
              <span className="text-xs">Loading note contents...</span>
            </div>
          ) : !noteDetail ? (
            <div className="py-20 text-center text-neutral-400 space-y-2">
              <FileText className="w-8 h-8 mx-auto text-neutral-300" />
              <p className="text-xs font-medium text-neutral-600">Select a note to inspect</p>
              <p className="text-[11px] text-neutral-400">
                Browse through knowledge files, edit metadata, or purge ghost notes.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Note Header & Metadata Summary */}
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md bg-neutral-100 text-neutral-700 font-mono text-[10px] font-bold uppercase">
                      {noteDetail.language}
                    </span>
                    <span className="text-[11px] text-neutral-400 font-mono truncate">
                      {noteDetail.relativePath}
                    </span>
                  </div>

                  <span className="text-[11px] text-neutral-400 shrink-0">
                    {(noteDetail.sizeBytes / 1024).toFixed(1)} KB
                  </span>
                </div>

                {/* Ghost Note Alert if empty body */}
                {noteDetail.isGhost && (
                  <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      <div>
                        <h4 className="text-xs font-semibold text-rose-900">
                          Empty Ghost Note Detected
                        </h4>
                        <p className="text-[11px] text-rose-700 mt-0.5">
                          {noteDetail.ghostReason ||
                            'This document contains frontmatter/tags, but zero substantive body content.'}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={handlePurgeCurrentGhost}
                      disabled={purgingNote}
                      className="w-full bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-colors shadow-xs"
                    >
                      {purgingNote ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Purging Ghost Note...
                        </>
                      ) : (
                        <>
                          <Trash2 className="w-3.5 h-3.5" />
                          Purge This Ghost Note (Safe Trash Backup)
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>

              {/* Title & Metadata Editor */}
              <div className="space-y-3 pt-2 border-t border-neutral-100">
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">
                    Note Title
                  </label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-1.5 text-xs text-neutral-900 font-semibold focus:outline-none focus:ring-1 focus:ring-neutral-900"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">
                    Frontmatter Tags (comma separated)
                  </label>
                  <input
                    type="text"
                    value={editTags}
                    onChange={e => setEditTags(e.target.value)}
                    placeholder="New-Team, Project, Timelines"
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-1.5 text-xs font-mono text-neutral-800 focus:outline-none focus:ring-1 focus:ring-neutral-900"
                  />
                </div>

                {/* Connected Themes / Wikilinks */}
                {noteDetail.wikilinks.length > 0 && (
                  <div className="p-2.5 bg-neutral-50 rounded-xl border border-neutral-200/80">
                    <p className="text-[11px] font-semibold text-neutral-700 mb-1.5 flex items-center gap-1">
                      <Layers className="w-3 h-3 text-amber-500" />
                      <span>Connected Themes & Wikilinks:</span>
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {noteDetail.wikilinks.map((link, idx) => (
                        <button
                          key={idx}
                          onClick={() => {
                            setSearchQuery(link);
                            loadNotes();
                          }}
                          className="px-2 py-0.5 bg-white border border-neutral-200 rounded text-[11px] text-blue-600 font-medium hover:bg-blue-50 transition-colors"
                        >
                          [[{link}]]
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Note Content Editor / Viewer */}
              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">
                  Markdown Body
                </label>
                <textarea
                  value={editBody}
                  onChange={e => setEditBody(e.target.value)}
                  rows={14}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-xl p-3 text-xs text-neutral-900 font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-neutral-900 resize-y"
                  placeholder="Enter note text..."
                />
              </div>

              {/* Action Toolbar */}
              <div className="pt-3 border-t border-neutral-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                {/* Relocate folder selector */}
                <div className="flex items-center gap-1.5 flex-1">
                  <select
                    value={moveTargetFolder}
                    onChange={e => setMoveTargetFolder(e.target.value)}
                    className="bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs text-neutral-800 font-mono flex-1 focus:outline-none focus:ring-1 focus:ring-neutral-900"
                  >
                    <option value="">Vault Root</option>
                    {folders.map(f => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={handleMoveNote}
                    disabled={movingNote}
                    className="px-2.5 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors shrink-0"
                    title="Move note to chosen folder"
                  >
                    {movingNote ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Move className="w-3.5 h-3.5" />
                    )}
                    Move
                  </button>
                </div>

                {/* Save button */}
                <button
                  onClick={handleSaveNote}
                  disabled={savingNote}
                  className="bg-neutral-900 hover:bg-neutral-800 text-white px-4 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 shadow-xs transition-colors shrink-0"
                >
                  {savingNote ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  Save Changes
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default KnowledgeExplorer;
