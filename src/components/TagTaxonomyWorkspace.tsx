import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import {
  Upload,
  Download,
  Copy,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  FolderGit2,
  Tag,
  Play,
  Eye,
  Plus,
  X,
  Loader2,
  RefreshCw
} from 'lucide-react';

export interface TaxonomyAxis {
  id: string;
  level: string;
  label: string;
  question: string;
  prefix: string;
  tags: string[];
}

export interface ProjectTagProfileItem {
  id: string;
  projectTag: string;
  targetFolder: string;
  associatedTags: string[];
  aliases: string[];
  description?: string;
}

export interface RoutePreviewItem {
  filename: string;
  oldPath: string;
  newPath: string;
  currentFolder: string;
  targetFolder: string;
  matchedProject: string | null;
  matchedByTag: string | null;
  oldTags: string[];
  updatedTags: string[];
  moved: boolean;
}

interface TagTaxonomyWorkspaceProps {
  vaultPath: string;
  onNotify?: () => void;
  compactModal?: boolean;
  onClose?: () => void;
}

export const TagTaxonomyWorkspace: React.FC<TagTaxonomyWorkspaceProps> = ({
  vaultPath,
  onNotify,
  compactModal = false,
  onClose
}) => {
  const [axes, setAxes] = useState<TaxonomyAxis[]>([]);
  const [projectProfiles, setProjectProfiles] = useState<ProjectTagProfileItem[]>([]);
  const [tagRoutes, setTagRoutes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [activeAxisId, setActiveAxisId] = useState<string>('project');

  // Import / Export state
  const [importText, setImportText] = useState('');
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [copiedMd, setCopiedMd] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Add tag / Add project profile state
  const [newAxisTagInput, setNewAxisTagInput] = useState('');
  const [newProjId, setNewProjId] = useState('');
  const [newProjFolder, setNewProjFolder] = useState('');
  const [newProjTags, setNewProjTags] = useState('');
  const [newProjAliases, setNewProjAliases] = useState('');
  const [showAddProjectForm, setShowAddProjectForm] = useState(false);

  // Classify & Route state
  const [runningPreview, setRunningPreview] = useState(false);
  const [runningExecute, setRunningExecute] = useState(false);
  const [routeFilesToggle, setRouteFilesToggle] = useState(true);
  const [routeReport, setRouteReport] = useState<{
    dryRun: boolean;
    totalScanned: number;
    updatedCount: number;
    projectsMatchedCount: number;
    movedCount: number;
    prunedFoldersCount: number;
    snapshotId: string | null;
    items: RoutePreviewItem[];
    message: string;
  } | null>(null);

  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  useEffect(() => {
    fetchTaxonomy();
  }, [vaultPath]);

  const fetchTaxonomy = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/tags/taxonomy');
      if (Array.isArray(res.data?.axes)) setAxes(res.data.axes);
      if (Array.isArray(res.data?.projectProfiles)) setProjectProfiles(res.data.projectProfiles);
      if (res.data?.tagRoutes && typeof res.data.tagRoutes === 'object') {
        setTagRoutes(res.data.tagRoutes);
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.response?.data?.error || 'Failed to load tag taxonomy'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setImportText(text);
      setFeedback({
        type: 'info',
        message: `Loaded "${file.name}" (${(file.size / 1024).toFixed(1)} KB). Click "Import Tag List" to apply.`
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: `Could not read file: ${err.message}` });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleLoadCurrentIntoEditor = async () => {
    try {
      const res = await axios.get('/api/tags/taxonomy/export', { params: { format: 'md' } });
      if (res.data?.markdown) {
        setImportText(res.data.markdown);
        setFeedback({
          type: 'info',
          message: 'Loaded current taxonomy into the Markdown editor. You can edit tags/projects and click "Import Tag List".'
        });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: 'Failed to load Markdown template' });
    }
  };

  const handleImportSubmit = async () => {
    if (!importText.trim()) {
      setFeedback({
        type: 'error',
        message: 'Please upload a file (.md, .json, .txt) or paste your tag list first.'
      });
      return;
    }
    setImporting(true);
    setFeedback(null);
    try {
      const res = await axios.post('/api/tags/taxonomy/import', {
        content: importText,
        mode: importMode
      });
      if (Array.isArray(res.data?.axes)) setAxes(res.data.axes);
      if (Array.isArray(res.data?.projectProfiles)) setProjectProfiles(res.data.projectProfiles);
      if (res.data?.tagRoutes) setTagRoutes(res.data.tagRoutes);
      setFeedback({
        type: 'success',
        message:
          res.data?.message ||
          `Imported ${res.data?.importedTagsCount || 0} tag(s) and ${res.data?.importedProjectsCount || 0} project profile(s).`
      });
      onNotify?.();
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.response?.data?.error || 'Failed to import tag list'
      });
    } finally {
      setImporting(false);
    }
  };

  const handleExportDownload = async (format: 'md' | 'json') => {
    setExporting(true);
    try {
      const res = await axios.get('/api/tags/taxonomy/export', { params: { format } });
      const content =
        format === 'json'
          ? JSON.stringify(res.data?.taxonomy || {}, null, 2)
          : String(res.data?.markdown || '');
      const filename =
        res.data?.filename ||
        (format === 'json' ? 'tag_taxonomy.json' : 'project-hashtags-expanded.md');
      const blob = new Blob([content], {
        type: format === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8'
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setFeedback({
        type: 'success',
        message: `Exported tag taxonomy as "${filename}".`
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: 'Export failed: ' + (err.response?.data?.error || err.message)
      });
    } finally {
      setExporting(false);
    }
  };

  const handleCopyMarkdown = async () => {
    try {
      const res = await axios.get('/api/tags/taxonomy/export', { params: { format: 'md' } });
      await navigator.clipboard.writeText(String(res.data?.markdown || ''));
      setCopiedMd(true);
      setTimeout(() => setCopiedMd(false), 2500);
    } catch {}
  };

  const handleMutateAxisTag = async (action: 'add' | 'remove', axisId: string, tag: string) => {
    if (!tag.trim()) return;
    try {
      const res = await axios.post('/api/tags/taxonomy', {
        action,
        axisId,
        tag: tag.trim()
      });
      if (Array.isArray(res.data?.axes)) setAxes(res.data.axes);
      if (Array.isArray(res.data?.projectProfiles)) setProjectProfiles(res.data.projectProfiles);
      if (res.data?.tagRoutes) setTagRoutes(res.data.tagRoutes);
      if (action === 'add') setNewAxisTagInput('');
      onNotify?.();
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.response?.data?.error || 'Failed to update taxonomy tag'
      });
    }
  };

  const handleSaveNewProjectProfile = async () => {
    const cleanId = newProjId.trim().replace(/^#?(?:project|research)\//i, '').replace(/\s+/g, '-');
    if (!cleanId) return;
    const projectTag = newProjId.trim().toLowerCase().startsWith('research/')
      ? `research/${cleanId}`
      : `project/${cleanId}`;
    const targetFolder =
      newProjFolder.trim() ||
      (projectTag.startsWith('research/')
        ? `03_Knowledge/Research/${cleanId}`
        : `01_Projects/${cleanId}`);
    const associatedTags = [
      projectTag,
      ...newProjTags
        .split(/[\s,]+/)
        .map(s => s.trim().replace(/^#+/, ''))
        .filter(Boolean)
    ];
    const aliases = [
      cleanId,
      ...newProjAliases
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    ];

    try {
      const res = await axios.post('/api/tags/taxonomy', {
        action: 'upsert_project_profile',
        projectProfile: {
          id: cleanId,
          projectTag,
          targetFolder,
          associatedTags,
          aliases
        }
      });
      if (Array.isArray(res.data?.axes)) setAxes(res.data.axes);
      if (Array.isArray(res.data?.projectProfiles)) setProjectProfiles(res.data.projectProfiles);
      if (res.data?.tagRoutes) setTagRoutes(res.data.tagRoutes);
      setNewProjId('');
      setNewProjFolder('');
      setNewProjTags('');
      setNewProjAliases('');
      setShowAddProjectForm(false);
      setFeedback({
        type: 'success',
        message: `Saved project profile "#${projectTag}" -> "${targetFolder}".`
      });
      onNotify?.();
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.response?.data?.error || 'Failed to save project profile'
      });
    }
  };

  const handleRunClassifyAndRoute = async (dryRun: boolean) => {
    if (!vaultPath) {
      setFeedback({
        type: 'error',
        message: 'Please configure and save your Obsidian Vault path first.'
      });
      return;
    }
    if (dryRun) setRunningPreview(true);
    else setRunningExecute(true);
    setFeedback(null);

    try {
      const res = await axios.post('/api/vault/tags/classify-and-route', {
        dryRun,
        routeFiles: routeFilesToggle
      });
      setRouteReport(res.data);
      setFeedback({
        type: 'success',
        message: res.data?.message || 'Operation completed.'
      });
      onNotify?.();
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.response?.data?.error || 'Failed to classify and route vault files'
      });
    } finally {
      setRunningPreview(false);
      setRunningExecute(false);
    }
  };

  const currentAxis = axes.find(a => a.id === activeAxisId) || axes[0];

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-100">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-neutral-900" />
            <h3 className="text-sm font-semibold text-neutral-900">
              Tag Taxonomy Import / Export & Project Directory Router (L0–L7)
            </h3>
          </div>
          <p className="text-xs text-neutral-500">
            Import your own tag list (<code className="font-mono">project-hashtags-expanded.md</code> or JSON), automatically detect which project each <code className="font-mono">.md</code> file belongs to, update its tags, and distribute files into the right directories.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => handleExportDownload('md')}
            disabled={exporting}
            className="px-3 py-1.5 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-medium flex items-center gap-1.5 transition-colors"
            title="Export complete tag taxonomy and project profiles as Markdown (project-hashtags-expanded.md)"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export .MD</span>
          </button>

          <button
            type="button"
            onClick={() => handleExportDownload('json')}
            disabled={exporting}
            className="px-3 py-1.5 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-medium flex items-center gap-1.5 transition-colors"
            title="Export tag taxonomy and routes as JSON (tag_taxonomy.json)"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export .JSON</span>
          </button>

          <button
            type="button"
            onClick={handleCopyMarkdown}
            className="px-3 py-1.5 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-medium flex items-center gap-1.5 transition-colors"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>{copiedMd ? 'Copied!' : 'Copy MD'}</span>
          </button>

          {compactModal && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : feedback.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-900'
              : 'bg-neutral-50 border-neutral-200 text-neutral-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="text-neutral-400 hover:text-neutral-700">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Grid: Left = Import / Export Tag List, Right = Execute Project & Tag Routing */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Column 1: Import Custom Tag List (.md / .json / paste) */}
        <div className="lg:col-span-6 p-4 rounded-xl bg-neutral-50 border border-neutral-200 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-neutral-900 flex items-center gap-1.5">
              <Upload className="w-3.5 h-3.5 text-neutral-700" />
              <span>1. Import Custom Tag List (.md, .json, .txt)</span>
            </h4>

            <div className="flex items-center gap-1.5">
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.markdown,.txt,.json,.yaml,.yml"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-2.5 py-1 bg-white hover:bg-neutral-100 text-neutral-800 border border-neutral-200 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-colors"
              >
                <Upload className="w-3 h-3" />
                <span>Choose File (.md / .json)</span>
              </button>
              <button
                type="button"
                onClick={handleLoadCurrentIntoEditor}
                className="px-2.5 py-1 bg-white hover:bg-neutral-100 text-neutral-700 border border-neutral-200 rounded-lg text-[11px] font-medium transition-colors"
                title="Load current taxonomy & project profiles as editable Markdown"
              >
                Load Current MD
              </button>
            </div>
          </div>

          <textarea
            rows={7}
            value={importText}
            onChange={e => setImportText(e.target.value)}
            placeholder={`Paste your Markdown tag list (e.g. project-hashtags-expanded.md) or JSON here:\n\n### Hermes\nFolder: 01_Projects/Hermes\n#project/Hermes\n#system/agent-orchestration\n#system/multi-agent\n#system/memory`}
            className="w-full bg-white border border-neutral-200 rounded-xl p-3 text-xs font-mono text-neutral-800 focus:outline-none focus:ring-1 focus:ring-neutral-900"
          />

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-3 text-xs text-neutral-700">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="importMode"
                  checked={importMode === 'merge'}
                  onChange={() => setImportMode('merge')}
                  className="text-neutral-900 focus:ring-neutral-900"
                />
                <span>Merge with existing</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="importMode"
                  checked={importMode === 'replace'}
                  onChange={() => setImportMode('replace')}
                  className="text-neutral-900 focus:ring-neutral-900"
                />
                <span>Replace taxonomy</span>
              </label>
            </div>

            <button
              type="button"
              onClick={handleImportSubmit}
              disabled={importing}
              className="px-3.5 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              {importing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              <span>Import Tag List</span>
            </button>
          </div>
        </div>

        {/* Column 2: Classify Projects, Update Tags & Route Files by Tags */}
        <div className="lg:col-span-6 p-4 rounded-xl bg-neutral-50 border border-neutral-200 flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-neutral-900 flex items-center gap-1.5">
              <FolderGit2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>2. Detect Projects, Update Tags & Distribute .MD Files</span>
            </h4>
            <p className="text-xs text-neutral-600 leading-relaxed">
              Scans all <code className="font-mono">.md</code> files in your Vault and matches them against your imported Project Hashtag Profiles (<code className="font-mono">#project/*</code>, <code className="font-mono">#system/*</code>, <code className="font-mono">#concept/*</code>, aliases, and titles):
            </p>
            <ul className="text-[11px] text-neutral-600 space-y-1 list-disc list-inside">
              <li>
                <strong>Step 1:</strong> Identifies which project or research stream each <code className="font-mono">.md</code> file belongs to.
              </li>
              <li>
                <strong>Step 2:</strong> Updates YAML frontmatter <code className="font-mono">tags</code> (L0–L7 + project subsystem tags) and sets <code className="font-mono">project: "[[Name]]"</code>.
              </li>
              <li>
                <strong>Step 3:</strong> Moves each <code className="font-mono">.md</code> file into its proper directory according to its tags (e.g. <code className="font-mono">01_Projects/Hermes</code>, <code className="font-mono">01_Projects/Neuromicon</code>, <code className="font-mono">03_Knowledge/Research</code>) and cleans up empty folders.
              </li>
            </ul>
          </div>

          <div className="space-y-3 pt-2 border-t border-neutral-200/70">
            <label className="flex items-center gap-2 text-xs text-neutral-800 font-medium cursor-pointer select-none">
              <input
                type="checkbox"
                checked={routeFilesToggle}
                onChange={e => setRouteFilesToggle(e.target.checked)}
                className="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900"
              />
              <span>Distribute (move) .md files into target directories according to their tags</span>
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleRunClassifyAndRoute(true)}
                disabled={runningPreview || runningExecute}
                className="flex-1 py-2 px-3 bg-white hover:bg-neutral-100 text-neutral-800 border border-neutral-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
              >
                {runningPreview ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Eye className="w-3.5 h-3.5 text-neutral-600" />
                )}
                <span>Preview Tags & Folders (Dry Run)</span>
              </button>

              <button
                type="button"
                onClick={() => handleRunClassifyAndRoute(false)}
                disabled={runningPreview || runningExecute}
                className="flex-1 py-2 px-3 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
              >
                {runningExecute ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5 text-emerald-400" />
                )}
                <span>Update Tags & Route Files Now</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Preview / Execution Report Table */}
      {routeReport && (
        <div className="border border-neutral-200 rounded-xl overflow-hidden">
          <div className="bg-neutral-50 px-4 py-3 border-b border-neutral-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3 text-xs">
              <span className="font-semibold text-neutral-900">
                {routeReport.dryRun ? 'Preview Report (Dry Run)' : 'Execution Complete'}
              </span>
              <span className="px-2 py-0.5 rounded bg-neutral-200 text-neutral-800 font-mono text-[11px]">
                {routeReport.updatedCount} notes tagged
              </span>
              <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-900 font-mono text-[11px]">
                {routeReport.projectsMatchedCount} project matches
              </span>
              <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-mono text-[11px]">
                {routeReport.movedCount} {routeReport.dryRun ? 'to move' : 'moved'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setRouteReport(null)}
              className="text-xs text-neutral-500 hover:text-neutral-800"
            >
              Close Report ×
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto divide-y divide-neutral-100 text-xs">
            {routeReport.items.map((item, idx) => (
              <div key={idx} className="p-3 hover:bg-neutral-50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-neutral-900">{item.filename}</span>
                    {item.matchedProject && (
                      <span className="px-2 py-0.5 rounded bg-indigo-50 border border-indigo-200 text-indigo-800 font-mono text-[11px]">
                        Project: {item.matchedProject}
                      </span>
                    )}
                    {item.moved && (
                      <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 font-mono text-[11px]">
                        {item.currentFolder} → {item.targetFolder}
                      </span>
                    )}
                    {!item.moved && (
                      <span className="text-[11px] font-mono text-neutral-400">
                        Folder: {item.targetFolder}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {item.updatedTags.map(t => (
                      <span
                        key={t}
                        className="px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-700 font-mono text-[10px]"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Project Hashtag Profiles Section */}
      <div className="space-y-3 pt-2 border-t border-neutral-100">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h4 className="text-xs font-semibold text-neutral-900">
              Project & Research Hashtag Profiles ({projectProfiles.length})
            </h4>
            <p className="text-[11px] text-neutral-500">
              Each profile links a project (<code className="font-mono">#project/Name</code>) to its target directory and subsystem/concept hashtags.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAddProjectForm(!showAddProjectForm)}
            className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{showAddProjectForm ? 'Cancel' : 'Add Project Profile'}</span>
          </button>
        </div>

        {showAddProjectForm && (
          <div className="p-4 rounded-xl bg-neutral-50 border border-neutral-200 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                Project Name / ID (e.g. Hermes)
              </label>
              <input
                type="text"
                value={newProjId}
                onChange={e => setNewProjId(e.target.value)}
                placeholder="Hermes"
                className="w-full bg-white border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                Target Directory in Vault
              </label>
              <input
                type="text"
                value={newProjFolder}
                onChange={e => setNewProjFolder(e.target.value)}
                placeholder="01_Projects/Hermes"
                className="w-full bg-white border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                Associated Hashtags (comma or space separated)
              </label>
              <input
                type="text"
                value={newProjTags}
                onChange={e => setNewProjTags(e.target.value)}
                placeholder="#system/agent-orchestration, #system/memory, #domain/AI/agents"
                className="w-full bg-white border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                Keywords / Aliases (comma separated)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newProjAliases}
                  onChange={e => setNewProjAliases(e.target.value)}
                  placeholder="Hermes, Гермес, Hermes Agent"
                  className="flex-1 bg-white border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs font-mono"
                />
                <button
                  type="button"
                  onClick={handleSaveNewProjectProfile}
                  className="px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg text-xs font-semibold shrink-0"
                >
                  Save Profile
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-64 overflow-y-auto p-0.5">
          {projectProfiles.map(prof => (
            <div
              key={prof.projectTag}
              className="p-3 rounded-xl border border-neutral-200 bg-neutral-50/60 space-y-1.5 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold font-mono text-neutral-900">
                    #{prof.projectTag}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 truncate max-w-[150px]">
                    → {prof.targetFolder}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {prof.associatedTags
                    .filter(t => t.toLowerCase() !== prof.projectTag.toLowerCase())
                    .slice(0, 8)
                    .map(t => (
                      <span
                        key={t}
                        className="px-1.5 py-0.5 rounded bg-white border border-neutral-200 text-[10px] font-mono text-neutral-600"
                      >
                        #{t}
                      </span>
                    ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Orthogonal Taxonomy Axes Browser (L0-L7) */}
      <div className="space-y-3 pt-2 border-t border-neutral-100">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-neutral-900">
            Orthogonal Taxonomy Catalog (L0–L7)
          </h4>
          <button
            type="button"
            onClick={fetchTaxonomy}
            className="text-xs text-neutral-500 hover:text-neutral-900 flex items-center gap-1"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {axes.map(axis => (
            <button
              key={axis.id}
              type="button"
              onClick={() => setActiveAxisId(axis.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                activeAxisId === axis.id
                  ? 'bg-neutral-900 text-white font-semibold'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
              }`}
            >
              {axis.level}: {axis.id.toUpperCase()} ({axis.tags.length})
            </button>
          ))}
        </div>

        {currentAxis && (
          <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-neutral-800">{currentAxis.label}</span>
              <span className="text-neutral-500">{currentAxis.question}</span>
            </div>

            <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
              {currentAxis.tags.map(t => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-neutral-200 text-[11px] font-mono text-neutral-800"
                >
                  <span>#{t}</span>
                  {tagRoutes[t] && (
                    <span className="text-[10px] text-emerald-700">→ {tagRoutes[t]}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleMutateAxisTag('remove', currentAxis.id, t)}
                    className="text-neutral-400 hover:text-rose-600 font-sans font-bold ml-0.5"
                    title={`Remove #${t}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={newAxisTagInput}
                onChange={e => setNewAxisTagInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleMutateAxisTag('add', currentAxis.id, newAxisTagInput);
                  }
                }}
                placeholder={`Add tag to ${currentAxis.prefix || currentAxis.id + '/'}...`}
                className="flex-1 bg-white border border-neutral-200 rounded-lg px-3 py-1.5 text-xs font-mono"
              />
              <button
                type="button"
                onClick={() => handleMutateAxisTag('add', currentAxis.id, newAxisTagInput)}
                className="px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg text-xs font-semibold whitespace-nowrap"
              >
                + Add Tag
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TagTaxonomyWorkspace;
