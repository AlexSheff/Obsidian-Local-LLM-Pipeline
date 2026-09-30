import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import {
  Search,
  FileText,
  AlertTriangle,
  Save,
  Move,
  RefreshCw,
  CheckCircle2,
  X,
  Loader2,
  FilePlus,
  Sparkles,
  Tag
} from 'lucide-react';
import { KnowledgeChatPanel } from './KnowledgeChatPanel';
import { TagTaxonomyWorkspace } from './TagTaxonomyWorkspace';

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
  externalSelectedNotePath?: string | null;
  externalSelectedTag?: string | null;
  onOpenClustersTab?: () => void;
  onNotify: () => void;
}

export const KnowledgeExplorer: React.FC<KnowledgeExplorerProps> = ({
  vaultPath,
  externalSelectedNotePath,
  externalSelectedTag,
  onOpenClustersTab,
  onNotify
}) => {
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
  const [sortBy, setSortBy] = useState<'modified' | 'title' | 'size'>('modified');
  const [rightPaneMode, setRightPaneMode] = useState<'split_chat' | 'editor_only' | 'chat_only'>('split_chat');

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
  const [refiningSingle, setRefiningSingle] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // New note modal state
  const [showNewNoteModal, setShowNewNoteModal] = useState(false);
  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [newNoteFolder, setNewNoteFolder] = useState('01_Projects/Active');
  const [newNoteBody, setNewNoteBody] = useState('');
  const [creatingNote, setCreatingNote] = useState(false);

  // Orthogonal Tag Taxonomy state
  const [taxonomyAxes, setTaxonomyAxes] = useState<
    Array<{
      id: string;
      level: string;
      label: string;
      question: string;
      prefix: string;
      tags: string[];
    }>
  >([]);
  const [activeAxisId, setActiveAxisId] = useState<string>('type');
  const [showTaxonomyPicker, setShowTaxonomyPicker] = useState<boolean>(false);
  const [showTagManagerModal, setShowTagManagerModal] = useState<boolean>(false);
  const [customAxisTagInput, setCustomAxisTagInput] = useState<string>('');
  const [mutatingTag, setMutatingTag] = useState<boolean>(false);

  useEffect(() => {
    loadNotes();
    loadFolders();
    loadTaxonomy();
  }, [selectedFolder, selectedTag]);

  useEffect(() => {
    if (externalSelectedTag !== undefined && externalSelectedTag !== null) {
      setSelectedFolder('all');
      setSelectedTag(externalSelectedTag);
    }
  }, [externalSelectedTag]);

  useEffect(() => {
    if (externalSelectedNotePath) {
      handleSelectNote(externalSelectedNotePath);
    }
  }, [externalSelectedNotePath]);

  const loadTaxonomy = async () => {
    try {
      const res = await axios.get('/api/tags/taxonomy');
      if (Array.isArray(res.data?.axes)) {
        setTaxonomyAxes(res.data.axes);
      }
    } catch {}
  };

  const handleQuickTagMutation = async (
    action: 'add' | 'remove' | 'redefine',
    tag?: string
  ) => {
    if (!noteDetail) return;
    setMutatingTag(true);
    setActionSuccess(null);
    try {
      const res = await axios.post('/api/vault/note/tags', {
        path: noteDetail.relativePath,
        action,
        tag
      });
      if (Array.isArray(res.data?.tags)) {
        const updatedList: string[] = res.data.tags;
        setEditTags(updatedList.join(', '));
        setNoteDetail(prev =>
          prev
            ? {
                ...prev,
                frontmatter: { ...(prev.frontmatter || {}), tags: updatedList }
              }
            : null
        );
        setNotes(prev =>
          prev.map(n =>
            n.relativePath === noteDetail.relativePath ? { ...n, tags: updatedList } : n
          )
        );
      }
      if (action === 'redefine') {
        setActionSuccess('Tags redefined according to Orthogonal Taxonomy (L0–L7).');
      }
      onNotify();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update tags');
    } finally {
      setMutatingTag(false);
    }
  };

  const handleAddCustomTaxonomyTag = async () => {
    if (!customAxisTagInput.trim()) return;
    try {
      const res = await axios.post('/api/tags/taxonomy', {
        action: 'add',
        axisId: activeAxisId,
        tag: customAxisTagInput.trim()
      });
      if (Array.isArray(res.data?.axes)) {
        setTaxonomyAxes(res.data.axes);
      }
      const axis = taxonomyAxes.find(a => a.id === activeAxisId);
      const rawClean = customAxisTagInput.trim().replace(/^#+/, '');
      const fullTag =
        axis?.prefix && !rawClean.includes('/') ? `${axis.prefix}${rawClean}` : rawClean;
      setCustomAxisTagInput('');
      if (noteDetail) {
        await handleQuickTagMutation('add', fullTag);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to add tag to taxonomy');
    }
  };

  const handleRemoveTaxonomyTagFromCatalog = async (axisId: string, tag: string) => {
    try {
      const res = await axios.post('/api/tags/taxonomy', {
        action: 'remove',
        axisId,
        tag
      });
      if (Array.isArray(res.data?.axes)) {
        setTaxonomyAxes(res.data.axes);
      }
    } catch {}
  };

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

  const loadNotes = async (autoSelectPath?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params: any = {
        folder: selectedFolder !== 'all' ? selectedFolder : '',
        tag: selectedTag || '',
        hideGhosts: 'false'
      };
      if (searchQuery.trim()) {
        params.q = searchQuery.trim();
      }

      const res = await axios.get('/api/vault/notes', { params });
      const loadedNotes: NoteSummary[] = res.data?.notes || [];

      setNotes(loadedNotes);
      setAvailableTags(res.data?.tags || []);

      if (autoSelectPath) {
        handleSelectNote(autoSelectPath);
      } else if (loadedNotes.length > 0) {
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
      setMoveTargetFolder(
        data.relativePath.includes('/')
          ? data.relativePath.substring(0, data.relativePath.lastIndexOf('/'))
          : '03_Knowledge/Essays'
      );
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to open note');
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

      setActionSuccess('Changes saved.');
      onNotify();
      await loadNotes(noteDetail.relativePath);
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

      setActionSuccess(`Moved to "${res.data.newRelativePath}".`);
      onNotify();
      await loadFolders();
      await loadNotes(res.data.newRelativePath);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to move note');
    } finally {
      setMovingNote(false);
    }
  };

  const handleRefineSingleNote = async () => {
    if (!noteDetail) return;
    setRefiningSingle(true);
    setActionSuccess(null);
    try {
      const res = await axios.post('/api/vault/note/refine-single', {
        path: noteDetail.relativePath,
        smartRename: true
      });
      setActionSuccess(res.data.message || 'Note classified and sorted via Jev + LLM.');
      onNotify();
      await loadFolders();
      await loadNotes(res.data?.newRelativePath || noteDetail.relativePath);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to classify note');
    } finally {
      setRefiningSingle(false);
    }
  };

  const handleCreateNewNote = async () => {
    if (!newNoteTitle.trim()) return;
    setCreatingNote(true);
    try {
      const res = await axios.post('/api/vault/note/create', {
        title: newNoteTitle.trim(),
        folder: newNoteFolder || '01_Projects/Active',
        body: newNoteBody.trim() || `# ${newNoteTitle.trim()}\n\n`
      });
      setShowNewNoteModal(false);
      setNewNoteTitle('');
      setNewNoteBody('');
      setActionSuccess(`Created note "${res.data.relativePath}".`);
      onNotify();
      await loadFolders();
      await loadNotes(res.data.relativePath);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create note');
    } finally {
      setCreatingNote(false);
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
      result.sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime());
    }

    return result;
  }, [notes, selectedLanguage, sortBy]);

  return (
    <div className="space-y-4">
      {/* Top Workspace Toolbar: Search, Filters, New Note & Layout Switcher */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              placeholder="Search documents by title, tags, or content (Enter)..."
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
            {/* Folder Quick Select */}
            <select
              value={selectedFolder}
              onChange={e => setSelectedFolder(e.target.value)}
              className="bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs text-neutral-700 font-mono max-w-[200px] truncate focus:outline-none focus:ring-1 focus:ring-neutral-900"
            >
              <option value="all">All Folders ({notes.length})</option>
              {folders.map(f => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>

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
              <option value="modified">Sort by Date</option>
              <option value="title">Sort by Title</option>
              <option value="size">Sort by Size</option>
            </select>

            {/* Workspace Mode Switcher */}
            <div className="flex items-center gap-1 bg-neutral-100 p-1 rounded-lg">
              <button
                onClick={() => setRightPaneMode('split_chat')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  rightPaneMode === 'split_chat'
                    ? 'bg-white text-neutral-900 shadow-xs font-semibold'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                Vault + AI Chat
              </button>
              <button
                onClick={() => setRightPaneMode('editor_only')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  rightPaneMode === 'editor_only'
                    ? 'bg-white text-neutral-900 shadow-xs font-semibold'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                Files & Editor
              </button>
              <button
                onClick={() => setRightPaneMode('chat_only')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  rightPaneMode === 'chat_only'
                    ? 'bg-white text-neutral-900 shadow-xs font-semibold'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                Chat Only
              </button>
            </div>

            {/* New Note Button */}
            <button
              onClick={() => setShowNewNoteModal(true)}
              className="px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <FilePlus className="w-3.5 h-3.5" />
              <span>New Note</span>
            </button>

            <button
              onClick={() => loadNotes()}
              disabled={loading}
              className="p-1.5 border border-neutral-200 rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-50 transition-colors"
              title="Refresh file list"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Tag Filter Bar (Interactive filter buttons) */}
        {availableTags.length > 0 && (
          <div className="mt-3 pt-2.5 border-t border-neutral-100 flex items-center gap-1.5 overflow-x-auto">
            <span className="text-[11px] text-neutral-400 shrink-0 mr-1">Tags:</span>
            {selectedTag && (
              <button
                onClick={() => setSelectedTag('')}
                className="px-2 py-0.5 text-[11px] font-medium bg-neutral-900 text-white rounded-md whitespace-nowrap shrink-0"
              >
                Clear #{selectedTag} ×
              </button>
            )}
            {availableTags.slice(0, 20).map(t => (
              <button
                key={t}
                onClick={() => setSelectedTag(selectedTag === t ? '' : t)}
                className={`px-2 py-0.5 rounded-md text-[11px] font-mono transition-colors whitespace-nowrap shrink-0 ${
                  selectedTag === t
                    ? 'bg-neutral-900 text-white font-semibold'
                    : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                }`}
              >
                #{t}
              </button>
            ))}
          </div>
        )}

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

      {/* Main Workspace Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left Column: Notes List (3 cols in split_chat, 4 cols in editor_only) */}
        {rightPaneMode !== 'chat_only' && (
          <div
            className={`${
              rightPaneMode === 'split_chat' ? 'lg:col-span-3' : 'lg:col-span-4'
            } bg-white rounded-2xl border border-neutral-200 overflow-hidden`}
          >
            <div className="p-3.5 border-b border-neutral-100 bg-neutral-50/50 flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral-800 tabular-nums">
                Documents ({filteredNotes.length})
              </span>
              <span className="text-[11px] text-neutral-500 font-mono truncate max-w-[140px]">
                {selectedFolder === 'all' ? 'Entire Vault' : selectedFolder}
              </span>
            </div>

            <div className="divide-y divide-neutral-100 max-h-[710px] overflow-y-auto">
              {loading ? (
                <div className="p-8 text-center text-neutral-400 flex flex-col items-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-xs">Scanning knowledge vault...</span>
                </div>
              ) : filteredNotes.length === 0 ? (
                <div className="p-8 text-center text-neutral-400 space-y-1">
                  <p className="text-xs font-medium text-neutral-600">No notes found</p>
                  <p className="text-[11px] text-neutral-400">
                    Adjust your search filter or create a new note.
                  </p>
                </div>
              ) : (
                filteredNotes.map(n => {
                  const isSelected = selectedNotePath === n.relativePath;
                  return (
                    <div
                      key={n.id}
                      onClick={() => handleSelectNote(n.relativePath)}
                      className={`p-3 cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-neutral-100 border-l-4 border-neutral-900'
                          : 'hover:bg-neutral-50'
                      }`}
                    >
                      <h4 className="text-xs font-semibold text-neutral-900 line-clamp-1">
                        {n.title}
                      </h4>

                      {/* Unboxed clean metadata with typographic separators */}
                      <div className="flex items-center gap-1.5 text-[11px] text-neutral-500 font-mono mt-0.5 truncate">
                        <span>{n.language}</span>
                        <span aria-hidden="true">·</span>
                        <span className="truncate">{n.relativePath}</span>
                      </div>

                      <p className="text-xs text-neutral-600 line-clamp-2 mt-1 leading-relaxed">
                        {n.snippet}
                      </p>

                      {n.tags.length > 0 && (
                        <div className="text-[11px] text-neutral-400 font-mono mt-1.5 truncate">
                          {n.tags
                            .slice(0, 4)
                            .map(t => `#${t.replace(/^#/, '')}`)
                            .join(' · ')}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Middle Column: Note Editor & Inspector */}
        {rightPaneMode !== 'chat_only' && (
          <div
            className={`${
              rightPaneMode === 'split_chat' ? 'lg:col-span-4' : 'lg:col-span-8'
            } bg-white rounded-2xl border border-neutral-200 p-5`}
          >
            {loadingNote ? (
              <div className="py-20 text-center text-neutral-400 flex flex-col items-center gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-neutral-400" />
                <span className="text-xs">Loading document...</span>
              </div>
            ) : !noteDetail ? (
              <div className="py-20 text-center text-neutral-400 space-y-2">
                <FileText className="w-8 h-8 mx-auto text-neutral-300" />
                <p className="text-xs font-medium text-neutral-600">Select a note to inspect or edit</p>
                <p className="text-[11px] text-neutral-400">
                  Edit Markdown content, manage tags, or collaborate via the Local AI Chat on the right.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Clean Metadata Header + 1-Click Jev+LLM Refine */}
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-neutral-100">
                  <div className="flex items-center gap-1.5 text-[11px] text-neutral-500 font-mono min-w-0">
                    <span className="uppercase font-semibold text-neutral-700">
                      {noteDetail.language}
                    </span>
                    <span>·</span>
                    <span className="truncate">{noteDetail.relativePath}</span>
                    <span>·</span>
                    <span className="tabular-nums shrink-0">
                      {(noteDetail.sizeBytes / 1024).toFixed(1)} KB
                    </span>
                  </div>

                  <button
                    onClick={handleRefineSingleNote}
                    disabled={refiningSingle}
                    className="px-2.5 py-1 text-[11px] font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1"
                    title="Auto-classify into project/PARA folder and generate tags via Jev + LLM"
                  >
                    {refiningSingle ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Sparkles className="w-3 h-3 text-amber-600" />
                    )}
                    <span>Auto-Sort (Jev+LLM)</span>
                  </button>
                </div>

                {/* Title & Tags */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-medium text-neutral-500 mb-1">
                      Document Title
                    </label>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      className="w-full bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-1.5 text-xs text-neutral-900 font-semibold focus:outline-none focus:ring-1 focus:ring-neutral-900"
                    />
                  </div>

                  <div className="space-y-2.5 pt-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="block text-[11px] font-medium text-neutral-600">
                        Clean Semantic #Tags · Click × to remove or toggle from catalog
                      </label>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleQuickTagMutation('redefine')}
                          disabled={mutatingTag}
                          className="px-2 py-1 text-[11px] font-medium bg-neutral-900 hover:bg-neutral-800 text-white rounded-md transition-colors flex items-center gap-1"
                          title="Auto-curate clean semantic #tags (e.g. #Hermes, #AI, #research, #active) from full note meaning"
                        >
                          <Sparkles className="w-3 h-3 text-emerald-400" />
                          <span>Auto-Curate Clean #Tags</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (onOpenClustersTab) {
                              onOpenClustersTab();
                            } else {
                              setShowTagManagerModal(true);
                            }
                          }}
                          className="px-2 py-1 text-[11px] font-medium bg-white hover:bg-neutral-100 text-neutral-800 border border-neutral-200 rounded-md transition-colors flex items-center gap-1"
                          title="Open Semantic Clusters, Project #Tags & File Import"
                        >
                          <Tag className="w-3 h-3 text-emerald-600" />
                          <span>Clusters & #Tag Manager</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowTaxonomyPicker(!showTaxonomyPicker)}
                          className="px-2 py-1 text-[11px] font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-md transition-colors"
                        >
                          {showTaxonomyPicker ? 'Hide Taxonomy' : '+ Taxonomy Picker'}
                        </button>
                      </div>
                    </div>

                    {/* Active Note Tags with 1-Click Quick Delete */}
                    <div className="flex flex-wrap items-center gap-1.5 p-2.5 bg-neutral-50 border border-neutral-200 rounded-xl min-h-[38px]">
                      {editTags
                        .split(',')
                        .map(t => t.trim().replace(/^#+/, ''))
                        .filter(Boolean)
                        .map(tag => (
                          <button
                            key={tag}
                            type="button"
                            disabled={mutatingTag}
                            onClick={() => handleQuickTagMutation('remove', tag)}
                            className="px-2 py-0.5 rounded-md bg-white hover:bg-rose-50 border border-neutral-200 hover:border-rose-300 text-[11px] font-mono text-neutral-800 hover:text-rose-700 flex items-center gap-1 transition-colors"
                            title={`Click to remove #${tag}`}
                          >
                            <span>#{tag}</span>
                            <span className="text-neutral-400 hover:text-rose-600 font-sans font-bold">
                              ×
                            </span>
                          </button>
                        ))}
                      {editTags.trim().length === 0 && (
                        <span className="text-[11px] text-neutral-400">
                          No tags assigned — click "Redefine Tags (L0–L7)" or open "+ Taxonomy Picker".
                        </span>
                      )}
                    </div>

                    {/* Orthogonal Multi-Level Taxonomy Picker (L0-L7) */}
                    {showTaxonomyPicker && taxonomyAxes.length > 0 && (
                      <div className="p-3 bg-neutral-50/80 border border-neutral-200 rounded-xl space-y-2.5">
                        <div className="flex items-center gap-1 overflow-x-auto pb-1">
                          {taxonomyAxes.map(axis => (
                            <button
                              key={axis.id}
                              type="button"
                              onClick={() => setActiveAxisId(axis.id)}
                              className={`px-2 py-1 rounded-md text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors ${
                                activeAxisId === axis.id
                                  ? 'bg-neutral-900 text-white font-semibold'
                                  : 'bg-white text-neutral-600 hover:bg-neutral-100 border border-neutral-200/70'
                              }`}
                            >
                              {axis.level}: {axis.id.toUpperCase()}
                            </button>
                          ))}
                        </div>

                        {(() => {
                          const currentAxis =
                            taxonomyAxes.find(a => a.id === activeAxisId) || taxonomyAxes[0];
                          if (!currentAxis) return null;
                          const activeSet = new Set(
                            editTags
                              .split(',')
                              .map(t => t.trim().replace(/^#+/, '').toLowerCase())
                              .filter(Boolean)
                          );
                          return (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-[11px] text-neutral-500">
                                <span className="font-medium text-neutral-700">
                                  {currentAxis.label}
                                </span>
                                <span>{currentAxis.question}</span>
                              </div>
                              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-0.5">
                                {currentAxis.tags.map(t => {
                                  const isAssigned = activeSet.has(t.toLowerCase());
                                  return (
                                    <div key={t} className="inline-flex items-center">
                                      <button
                                        type="button"
                                        disabled={mutatingTag}
                                        onClick={() =>
                                          handleQuickTagMutation(
                                            isAssigned ? 'remove' : 'add',
                                            t
                                          )
                                        }
                                        className={`px-2 py-0.5 rounded-l-md text-[11px] font-mono border transition-colors ${
                                          isAssigned
                                            ? 'bg-emerald-600 border-emerald-600 text-white font-semibold'
                                            : 'bg-white hover:bg-neutral-100 border-neutral-200 text-neutral-700'
                                        }`}
                                        title={
                                          isAssigned
                                            ? `Click to remove #${t} from note`
                                            : `Click to add #${t} to note`
                                        }
                                      >
                                        {isAssigned ? `✓ #${t}` : `+ #${t}`}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleRemoveTaxonomyTagFromCatalog(currentAxis.id, t)
                                        }
                                        className="px-1 py-0.5 rounded-r-md text-[10px] border border-l-0 border-neutral-200 bg-neutral-100 hover:bg-rose-100 text-neutral-400 hover:text-rose-700 transition-colors"
                                        title={`Delete #${t} from ${currentAxis.id} catalog`}
                                      >
                                        ×
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                              <div className="flex items-center gap-1.5 pt-1">
                                <input
                                  type="text"
                                  value={customAxisTagInput}
                                  onChange={e => setCustomAxisTagInput(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      handleAddCustomTaxonomyTag();
                                    }
                                  }}
                                  placeholder={`Add clean #tag to ${currentAxis.label} (e.g. Hermes, AI, research)...`}
                                  className="flex-1 bg-white border border-neutral-200 rounded-lg px-2.5 py-1 text-[11px] font-mono text-neutral-800 focus:outline-none focus:ring-1 focus:ring-neutral-900"
                                />
                                <button
                                  type="button"
                                  onClick={handleAddCustomTaxonomyTag}
                                  className="px-2.5 py-1 bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg text-[11px] font-medium whitespace-nowrap"
                                >
                                  + Add Tag
                                </button>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </div>

                {/* Markdown Body */}
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">
                    Note Content (Markdown)
                  </label>
                  <textarea
                    value={editBody}
                    onChange={e => setEditBody(e.target.value)}
                    rows={16}
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-xl p-3 text-xs text-neutral-900 font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-neutral-900 resize-y"
                    placeholder="Enter note content..."
                  />
                </div>

                {/* Action Toolbar: Move & Save */}
                <div className="pt-3 border-t border-neutral-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <select
                      value={moveTargetFolder}
                      onChange={e => setMoveTargetFolder(e.target.value)}
                      className="bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs text-neutral-800 font-mono flex-1 min-w-0 focus:outline-none focus:ring-1 focus:ring-neutral-900"
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
                      className="px-2.5 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors shrink-0 whitespace-nowrap"
                    >
                      {movingNote ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Move className="w-3.5 h-3.5" />
                      )}
                      <span>Move</span>
                    </button>
                  </div>

                  <button
                    onClick={handleSaveNote}
                    disabled={savingNote}
                    className="bg-neutral-900 hover:bg-neutral-800 text-white px-4 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors shrink-0 whitespace-nowrap"
                  >
                    {savingNote ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                    <span>Save</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Right Column: Local AI Knowledge Chat & File Manager */}
        {rightPaneMode !== 'editor_only' && (
          <div className={rightPaneMode === 'chat_only' ? 'lg:col-span-12' : 'lg:col-span-5'}>
            <KnowledgeChatPanel
              activeNotePath={selectedNotePath}
              activeNoteTitle={editTitle || noteDetail?.filename}
              onSelectNote={relPath => {
                if (rightPaneMode === 'chat_only') {
                  setRightPaneMode('split_chat');
                }
                handleSelectNote(relPath);
              }}
              onNoteMutated={async targetPath => {
                onNotify();
                await loadFolders();
                await loadNotes(targetPath || selectedNotePath || undefined);
              }}
            />
          </div>
        )}
      </div>

      {/* Modal for Tag Import/Export & Project Routing */}
      {showTagManagerModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 overflow-y-auto">
          <div className="max-w-5xl w-full my-8 max-h-[90vh] overflow-y-auto rounded-2xl shadow-xl">
            <TagTaxonomyWorkspace
              vaultPath={vaultPath}
              compactModal={true}
              onClose={() => setShowTagManagerModal(false)}
              onNotify={async () => {
                onNotify();
                await loadTaxonomy();
                await loadFolders();
                await loadNotes(selectedNotePath || undefined);
              }}
            />
          </div>
        </div>
      )}

      {/* Modal for Creating a New Note */}
      {showNewNoteModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 border border-neutral-200 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-900">Create New Vault Note</h3>
              <button
                onClick={() => setShowNewNoteModal(false)}
                className="text-neutral-400 hover:text-neutral-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">
                  Note Title
                </label>
                <input
                  type="text"
                  value={newNoteTitle}
                  onChange={e => setNewNoteTitle(e.target.value)}
                  placeholder="e.g. Project Launch Roadmap"
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">
                  PARA Folder
                </label>
                <input
                  type="text"
                  value={newNoteFolder}
                  onChange={e => setNewNoteFolder(e.target.value)}
                  list="vault-folders-list"
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 text-xs font-mono text-neutral-800 focus:outline-none focus:ring-1 focus:ring-neutral-900"
                />
                <datalist id="vault-folders-list">
                  <option value="01_Projects/Active" />
                  <option value="03_Knowledge/Technical" />
                  <option value="03_Knowledge/Essays" />
                  <option value="03_Knowledge/Dialogues" />
                  <option value="04_Journal/Daily" />
                  <option value="05_Ideas/Inbox" />
                  {folders.map(f => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">
                  Note Content (Markdown)
                </label>
                <textarea
                  rows={8}
                  value={newNoteBody}
                  onChange={e => setNewNoteBody(e.target.value)}
                  placeholder="# Heading..."
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-xl p-3 text-xs font-mono text-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowNewNoteModal(false)}
                className="px-3.5 py-1.5 text-xs font-medium text-neutral-600 bg-neutral-100 hover:bg-neutral-200 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateNewNote}
                disabled={creatingNote || !newNoteTitle.trim()}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-neutral-900 hover:bg-neutral-800 disabled:opacity-40 rounded-lg"
              >
                {creatingNote ? 'Creating...' : 'Create Note'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default KnowledgeExplorer;
