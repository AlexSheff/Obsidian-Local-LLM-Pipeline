import React, { useState, useEffect, useRef, useMemo } from 'react';
import axios from 'axios';
import {
  Tag,
  Plus,
  X,
  FolderGit2,
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Upload,
  Download,
  FileText,
  ArrowRight,
  Folder,
  Eye,
  Play,
  RotateCcw,
  Network,
  Search,
  Link2,
  ExternalLink
} from 'lucide-react';

export interface TaxonomyAxis {
  id: string;
  level: string;
  label: string;
  question: string;
  prefix: string;
  tags: string[];
}

export interface ProjectTagProfile {
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

export interface ClusteredNoteMember {
  path: string;
  filename: string;
  title: string;
  currentFolder: string;
  recommendedFolder: string;
  snippet: string;
  currentTags: string[];
  suggestedTags: string[];
  matchedConcepts: string[];
  similarityToCluster: number;
  needsRouting: boolean;
  needsTagUpdate: boolean;
}

export interface SemanticNoteLink {
  sourcePath: string;
  sourceTitle: string;
  targetPath: string;
  targetTitle: string;
  similarity: number;
  sharedConcepts: string[];
}

export interface SemanticKnowledgeCluster {
  id: string;
  label: string;
  summary: string;
  dominantProject: string | null;
  dominantDomain: string | null;
  recommendedFolder: string;
  coreTags: string[];
  keyConcepts: string[];
  cohesionScore: number;
  misplacedCount: number;
  notes: ClusteredNoteMember[];
}

interface TagTaxonomyWorkspaceProps {
  vaultPath?: string;
  compactModal?: boolean;
  onClose?: () => void;
  onSelectTagFilter?: (tag: string) => void;
  onOpenNote?: (relativePath: string) => void;
  onNotify?: () => void;
}

const SAMPLE_IMPORT_MARKDOWN = `# My Clean Project & Knowledge Tags

### Hermes
Folder: 01_Projects/Hermes
Aliases: Hermes, Гермес, Hermes Agent
\`\`\`text
#Hermes
#agent-orchestration
#multi-agent
#memory
#routing
#local-LLM
#free-API
\`\`\`

### Neuromicon
Folder: 01_Projects/Neuromicon
Aliases: Neuromicon, Нейромикон, World-1149, Мир 1149
\`\`\`text
#Neuromicon
#World-1149
#Protocol-Contact
#24+1
#Defragmentation
#E=M×C²
#transmedia
#ARG
\`\`\`

### UUCPFF
Folder: 01_Projects/UUCPFF
Aliases: UUCPFF, кинофестиваль
\`\`\`text
#UUCPFF
#film-festival
#creator-network
#film-submission
#curation
#distribution
\`\`\``;

export const TagTaxonomyWorkspace: React.FC<TagTaxonomyWorkspaceProps> = ({
  vaultPath,
  compactModal = false,
  onClose,
  onSelectTagFilter,
  onOpenNote,
  onNotify
}) => {
  const [subView, setSubView] = useState<'clusters' | 'projects' | 'catalog'>('clusters');

  const [axes, setAxes] = useState<TaxonomyAxis[]>([]);
  const [projectProfiles, setProjectProfiles] = useState<ProjectTagProfile[]>([]);
  const [tagRoutes, setTagRoutes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [newTagInputs, setNewTagInputs] = useState<Record<string, string>>({});
  const [projectTagInputs, setProjectTagInputs] = useState<Record<string, string>>({});
  const [catalogSearch, setCatalogSearch] = useState('');
  const [selectedAxisFilter, setSelectedAxisFilter] = useState<string>('all');

  // Semantic Clustering state
  const [clusters, setClusters] = useState<SemanticKnowledgeCluster[]>([]);
  const [semanticBridges, setSemanticBridges] = useState<SemanticNoteLink[]>([]);
  const [clusteringStats, setClusteringStats] = useState({
    totalNotes: 0,
    totalClusters: 0,
    misplacedNotesCount: 0
  });
  const [loadingClusters, setLoadingClusters] = useState(false);
  const [applyingClusterId, setApplyingClusterId] = useState<string | null>(null);
  const [clusterSearch, setClusterSearch] = useState('');
  const [onlyMisplacedClusters, setOnlyMisplacedClusters] = useState(false);
  const [clusterCustomTags, setClusterCustomTags] = useState<Record<string, string[]>>({});
  const [clusterTagInputs, setClusterTagInputs] = useState<Record<string, string>>({});

  // Import state
  const [importText, setImportText] = useState('');
  const [vaultImportPath, setVaultImportPath] = useState('project-hashtags-expanded.md');
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // New Project Profile & Route inputs
  const [showNewProjectForm, setShowNewProjectForm] = useState(false);
  const [newProjectId, setNewProjectId] = useState('');
  const [newProjectFolder, setNewProjectFolder] = useState('');
  const [newProjectTags, setNewProjectTags] = useState('');
  const [newRouteTag, setNewRouteTag] = useState('');
  const [newRouteFolder, setNewRouteFolder] = useState('');

  // Classification, Routing & Rollback state
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [previewItems, setPreviewItems] = useState<RoutePreviewItem[] | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [lastSnapshotId, setLastSnapshotId] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState(false);

  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  const applyTaxonomyResponse = (data: any) => {
    if (Array.isArray(data?.axes)) setAxes(data.axes);
    if (Array.isArray(data?.projectProfiles)) setProjectProfiles(data.projectProfiles);
    if (data?.tagRoutes && typeof data.tagRoutes === 'object') setTagRoutes(data.tagRoutes);
  };

  const fetchTaxonomy = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/tags/taxonomy');
      applyTaxonomyResponse(res.data);
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err.response?.data?.error || 'Failed to load tag taxonomy'
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchSemanticClusters = async () => {
    setLoadingClusters(true);
    try {
      const res = await axios.get('/api/vault/clusters');
      setClusters(Array.isArray(res.data?.clusters) ? res.data.clusters : []);
      setSemanticBridges(Array.isArray(res.data?.semanticBridges) ? res.data.semanticBridges : []);
      setClusteringStats({
        totalNotes: res.data?.totalNotes || 0,
        totalClusters: res.data?.totalClusters || 0,
        misplacedNotesCount: res.data?.misplacedNotesCount || 0
      });
    } catch {
      // ignore if vault not yet connected
    } finally {
      setLoadingClusters(false);
    }
  };

  useEffect(() => {
    fetchTaxonomy();
    fetchSemanticClusters();
  }, [vaultPath]);

  const handleAddCustomTagToCluster = (clusterId: string) => {
    const raw = (clusterTagInputs[clusterId] || '')
      .trim()
      .replace(/^#+/, '')
      .replace(/^.*\/+/, '');
    if (!raw) return;
    setClusterCustomTags(prev => ({
      ...prev,
      [clusterId]: Array.from(new Set([...(prev[clusterId] || []), raw]))
    }));
    setClusterTagInputs(prev => ({ ...prev, [clusterId]: '' }));
  };

  const handleRemoveCustomTagFromCluster = (clusterId: string, tag: string) => {
    setClusterCustomTags(prev => ({
      ...prev,
      [clusterId]: (prev[clusterId] || []).filter(t => t !== tag)
    }));
  };

  const handleApplyCluster = async (clusterId?: string) => {
    setApplyingClusterId(clusterId || 'all');
    setStatusBanner(null);
    try {
      const extraTags = clusterId ? clusterCustomTags[clusterId] || [] : [];
      const res = await axios.post('/api/vault/clusters/apply', {
        clusterId,
        routeFiles: true,
        extraTags
      });
      if (res.data?.snapshotId) {
        setLastSnapshotId(res.data.snapshotId);
      }
      setStatusBanner({
        type: 'success',
        text: res.data?.message || 'Applied clean #tags and organized semantic cluster files.'
      });
      await fetchSemanticClusters();
      if (onNotify) onNotify();
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err.response?.data?.error || 'Failed to apply semantic cluster changes'
      });
    } finally {
      setApplyingClusterId(null);
    }
  };

  const handleAddTag = async (axisId: string) => {
    const raw = (newTagInputs[axisId] || '').trim().replace(/^#+/, '').replace(/^.*\/+/, '');
    if (!raw) return;
    try {
      const res = await axios.post('/api/tags/taxonomy', {
        action: 'add',
        axisId,
        tag: raw
      });
      applyTaxonomyResponse(res.data);
      setNewTagInputs(prev => ({ ...prev, [axisId]: '' }));
      if (onNotify) onNotify();
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err.response?.data?.error || 'Failed to add tag'
      });
    }
  };

  const handleRemoveTag = async (axisId: string, tag: string) => {
    try {
      const res = await axios.post('/api/tags/taxonomy', {
        action: 'remove',
        axisId,
        tag
      });
      applyTaxonomyResponse(res.data);
      if (onNotify) onNotify();
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err.response?.data?.error || 'Failed to remove tag'
      });
    }
  };

  const handleAddTagToProjectProfile = async (prof: ProjectTagProfile) => {
    const raw = (projectTagInputs[prof.id] || '')
      .trim()
      .replace(/^#+/, '')
      .replace(/^.*\/+/, '');
    if (!raw) return;
    const updatedAssoc = Array.from(new Set([...prof.associatedTags, raw]));
    try {
      const res = await axios.post('/api/tags/taxonomy', {
        action: 'upsert_project_profile',
        projectProfile: {
          ...prof,
          associatedTags: updatedAssoc
        }
      });
      applyTaxonomyResponse(res.data);
      setProjectTagInputs(prev => ({ ...prev, [prof.id]: '' }));
      setStatusBanner({
        type: 'success',
        text: `Added #${raw} to project ${prof.id}`
      });
      await fetchSemanticClusters();
      if (onNotify) onNotify();
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err.response?.data?.error || 'Failed to update project tags'
      });
    }
  };

  const handleRemoveTagFromProjectProfile = async (prof: ProjectTagProfile, tagToRemove: string) => {
    const updatedAssoc = prof.associatedTags.filter(
      t => t.toLowerCase() !== tagToRemove.toLowerCase()
    );
    try {
      const res = await axios.post('/api/tags/taxonomy', {
        action: 'upsert_project_profile',
        projectProfile: {
          ...prof,
          associatedTags: updatedAssoc.length > 0 ? updatedAssoc : [prof.projectTag]
        }
      });
      applyTaxonomyResponse(res.data);
      await fetchSemanticClusters();
      if (onNotify) onNotify();
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err.response?.data?.error || 'Failed to remove tag from project'
      });
    }
  };

  const handleUpsertProjectProfile = async () => {
    const id = newProjectId.trim().replace(/^#+/, '').replace(/^.*\/+/, '');
    if (!id) return;
    const folder = newProjectFolder.trim() || `01_Projects/${id}`;
    const assoc = newProjectTags
      .split(/[\s,]+/)
      .map(s => s.trim().replace(/^#+/, '').replace(/^.*\/+/, ''))
      .filter(Boolean);

    try {
      const res = await axios.post('/api/tags/taxonomy', {
        action: 'upsert_project_profile',
        projectProfile: {
          id,
          projectTag: id,
          targetFolder: folder,
          associatedTags: [id, ...assoc],
          aliases: [id, id.replace(/[-_]+/g, ' ')]
        }
      });
      applyTaxonomyResponse(res.data);
      setNewProjectId('');
      setNewProjectFolder('');
      setNewProjectTags('');
      setShowNewProjectForm(false);
      setStatusBanner({
        type: 'success',
        text: `Saved project profile "#${id}" → "${folder}".`
      });
      await fetchSemanticClusters();
      if (onNotify) onNotify();
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err.response?.data?.error || 'Failed to save project profile'
      });
    }
  };

  const handleRemoveProjectProfile = async (projectTag: string) => {
    try {
      const res = await axios.post('/api/tags/taxonomy', {
        action: 'remove_project_profile',
        tag: projectTag
      });
      applyTaxonomyResponse(res.data);
      await fetchSemanticClusters();
      if (onNotify) onNotify();
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err.response?.data?.error || 'Failed to remove project profile'
      });
    }
  };

  const handleAddRoute = async () => {
    const cleanTag = newRouteTag.trim().replace(/^#+/, '').replace(/^.*\/+/, '');
    const cleanFolder = newRouteFolder.trim();
    if (!cleanTag || !cleanFolder) return;
    try {
      const res = await axios.post('/api/tags/taxonomy', {
        action: 'set_route',
        routeTag: cleanTag,
        targetFolder: cleanFolder
      });
      applyTaxonomyResponse(res.data);
      setNewRouteTag('');
      setNewRouteFolder('');
      setStatusBanner({
        type: 'success',
        text: `Mapped #${cleanTag} → "${cleanFolder}"`
      });
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err.response?.data?.error || 'Failed to save route'
      });
    }
  };

  const handleRemoveRoute = async (routeTag: string) => {
    try {
      const res = await axios.post('/api/tags/taxonomy', {
        action: 'remove_route',
        routeTag
      });
      applyTaxonomyResponse(res.data);
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err.response?.data?.error || 'Failed to remove route'
      });
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const content = String(ev.target?.result || '');
      setImportText(content);
      setSubView('catalog');
      setStatusBanner({
        type: 'info',
        text: `Loaded "${file.name}" (${content.length.toLocaleString()} chars). Click "Import Clean #Tags" below to apply.`
      });
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  const handleImportTaxonomy = async (useVaultFile = false) => {
    setImporting(true);
    setStatusBanner(null);
    try {
      const payload = useVaultFile
        ? { vaultFilePath: vaultImportPath.trim(), mode: importMode }
        : { content: importText, mode: importMode };
      const res = await axios.post('/api/tags/taxonomy/import', payload);
      applyTaxonomyResponse(res.data);
      setStatusBanner({
        type: 'success',
        text:
          res.data?.message ||
          `Imported ${res.data?.importedTagsCount || 0} clean #tags and ${res.data?.importedProjectsCount || 0} project profiles.`
      });
      await fetchSemanticClusters();
      if (onNotify) onNotify();
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err.response?.data?.error || 'Failed to import tag list'
      });
    } finally {
      setImporting(false);
    }
  };

  const handleExportTaxonomy = async (format: 'md' | 'json') => {
    setExporting(true);
    try {
      const res = await axios.get(`/api/tags/taxonomy/export?format=${format}`);
      const content =
        format === 'json'
          ? JSON.stringify(res.data?.taxonomy || {}, null, 2)
          : String(res.data?.markdown || '');
      const filename =
        res.data?.filename || (format === 'json' ? 'tag_taxonomy.json' : 'project-hashtags-expanded.md');
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatusBanner({
        type: 'success',
        text: `Exported clean #tags to "${filename}".`
      });
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err.response?.data?.error || 'Failed to export taxonomy'
      });
    } finally {
      setExporting(false);
    }
  };

  const handleClassifyAndRoute = async (options: { dryRun: boolean; routeFiles: boolean }) => {
    const actionKey = options.dryRun
      ? 'dry_run'
      : options.routeFiles
      ? 'classify_and_route'
      : 'tags_only';
    setRunningAction(actionKey);
    setStatusBanner(null);
    try {
      const res = await axios.post('/api/vault/tags/classify-and-route', {
        dryRun: options.dryRun,
        routeFiles: options.routeFiles
      });
      if (Array.isArray(res.data?.items)) {
        setPreviewItems(res.data.items);
        if (options.dryRun) {
          setShowPreviewModal(true);
        }
      }
      if (!options.dryRun && res.data?.snapshotId) {
        setLastSnapshotId(res.data.snapshotId);
      }
      setStatusBanner({
        type: 'success',
        text:
          res.data?.message ||
          `Processed ${res.data?.updatedCount || 0} notes (${res.data?.projectsMatchedCount || 0} matched to projects, ${res.data?.movedCount || 0} routed).`
      });
      await fetchSemanticClusters();
      if (onNotify) onNotify();
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err.response?.data?.error || 'Failed to classify and route vault notes'
      });
    } finally {
      setRunningAction(null);
    }
  };

  const handleRollbackSnapshot = async () => {
    if (!lastSnapshotId) return;
    setRollingBack(true);
    setStatusBanner(null);
    try {
      const res = await axios.post('/api/snapshots/rollback', {
        snapshotId: lastSnapshotId
      });
      setStatusBanner({
        type: 'success',
        text: res.data?.message || `Rolled back snapshot "${lastSnapshotId}".`
      });
      setLastSnapshotId(null);
      setPreviewItems(null);
      await fetchSemanticClusters();
      if (onNotify) onNotify();
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err.response?.data?.error || 'Failed to rollback snapshot'
      });
    } finally {
      setRollingBack(false);
    }
  };

  const totalTagsCount = axes.reduce((acc, a) => acc + a.tags.length, 0);

  const filteredClusters = useMemo(() => {
    return clusters.filter(c => {
      if (onlyMisplacedClusters && c.misplacedCount === 0) return false;
      if (!clusterSearch.trim()) return true;
      const q = clusterSearch.trim().toLowerCase();
      if (c.label.toLowerCase().includes(q)) return true;
      if (c.summary.toLowerCase().includes(q)) return true;
      if (c.coreTags.some(t => t.toLowerCase().includes(q))) return true;
      if (c.keyConcepts.some(k => k.toLowerCase().includes(q))) return true;
      if (c.notes.some(n => n.title.toLowerCase().includes(q) || n.snippet.toLowerCase().includes(q))) {
        return true;
      }
      return false;
    });
  }, [clusters, clusterSearch, onlyMisplacedClusters]);

  return (
    <div className="space-y-5">
      {/* Clean Header & Sub-Navigation Bar */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-neutral-900">
              Semantic Knowledge Clusters & Clean #Tag System
            </h2>
            {compactModal && onClose && (
              <button
                onClick={onClose}
                className="text-xs text-neutral-500 hover:text-neutral-900 flex items-center gap-1"
              >
                <X className="w-4 h-4" /> Close
              </button>
            )}
          </div>
          <p className="text-xs text-neutral-500">
            Documents are grouped by full semantic meaning (TF-IDF + bilingual RU/EN concept vectors) · 100% clean atomic <code className="text-neutral-800 font-mono">#tags</code> with zero slash prefixes.
          </p>
        </div>

        {/* 3 Focused Mode Tabs */}
        <div className="flex flex-wrap items-center gap-1 bg-neutral-100 p-1 rounded-xl shrink-0">
          <button
            onClick={() => setSubView('clusters')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              subView === 'clusters'
                ? 'bg-white text-neutral-900 shadow-xs font-semibold'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <Network className="w-3.5 h-3.5 text-emerald-600" />
            <span className="tabular-nums">1. Semantic Clusters ({clusteringStats.totalClusters})</span>
          </button>

          <button
            onClick={() => setSubView('projects')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              subView === 'projects'
                ? 'bg-white text-neutral-900 shadow-xs font-semibold'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <FolderGit2 className="w-3.5 h-3.5 text-indigo-600" />
            <span className="tabular-nums">2. Project #Tags ({projectProfiles.length})</span>
          </button>

          <button
            onClick={() => setSubView('catalog')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              subView === 'catalog'
                ? 'bg-white text-neutral-900 shadow-xs font-semibold'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <Upload className="w-3.5 h-3.5 text-amber-600" />
            <span className="tabular-nums">3. Import & #Tag Catalog ({totalTagsCount})</span>
          </button>
        </div>
      </div>

      {/* Status Notification & Undo Banner */}
      {(statusBanner || lastSnapshotId) && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-3 ${
            statusBanner?.type === 'error'
              ? 'bg-rose-50 text-rose-800 border-rose-200'
              : statusBanner?.type === 'info'
              ? 'bg-sky-50 text-sky-900 border-sky-200'
              : 'bg-emerald-50 text-emerald-900 border-emerald-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusBanner?.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            )}
            <span>{statusBanner?.text || 'Snapshot backup ready for undo.'}</span>
          </div>
          <div className="flex items-center gap-2">
            {lastSnapshotId && (
              <button
                onClick={handleRollbackSnapshot}
                disabled={rollingBack}
                className="flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-neutral-100 text-neutral-900 border border-neutral-200 rounded-lg font-semibold transition-colors"
              >
                {rollingBack ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="w-3.5 h-3.5" />
                )}
                Undo Last Action
              </button>
            )}
            {statusBanner && (
              <button onClick={() => setStatusBanner(null)} className="opacity-60 hover:opacity-100">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* VIEW 1: SEMANTIC CLUSTERS (BY FULL DOCUMENT MEANING)                  */}
      {/* ===================================================================== */}
      {subView === 'clusters' && (
        <div className="space-y-5">
          {/* Action & Filter Bar */}
          <div className="bg-white rounded-2xl border border-neutral-200 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3 flex-1">
              <div className="relative w-full sm:w-72">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type="text"
                  value={clusterSearch}
                  onChange={e => setClusterSearch(e.target.value)}
                  placeholder="Filter clusters by concept, #tag, or note..."
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-lg pl-8 pr-7 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-neutral-900"
                />
                {clusterSearch && (
                  <button
                    onClick={() => setClusterSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 text-xs text-neutral-500 tabular-nums">
                <span>
                  <strong className="text-neutral-900">{clusteringStats.totalNotes}</strong> documents analyzed
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  <strong className="text-neutral-900">{clusteringStats.totalClusters}</strong> semantic clusters
                </span>
                {clusteringStats.misplacedNotesCount > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <button
                      onClick={() => setOnlyMisplacedClusters(!onlyMisplacedClusters)}
                      className={`underline decoration-dotted transition-colors ${
                        onlyMisplacedClusters ? 'text-amber-800 font-semibold' : 'text-amber-700 hover:text-amber-900'
                      }`}
                    >
                      {clusteringStats.misplacedNotesCount} notes ready to route
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                onClick={fetchSemanticClusters}
                disabled={loadingClusters}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-lg text-xs font-medium transition-colors"
              >
                {loadingClusters ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5 text-neutral-600" />
                )}
                Re-Analyze Meaning
              </button>

              {clusters.length > 0 && (
                <button
                  onClick={() => handleApplyCluster(undefined)}
                  disabled={applyingClusterId !== null}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-neutral-900 hover:bg-neutral-800 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors"
                >
                  {applyingClusterId === 'all' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5 text-emerald-400" />
                  )}
                  Apply All Cluster #Tags & Organize Vault
                </button>
              )}
            </div>
          </div>

          {loadingClusters ? (
            <div className="bg-white rounded-2xl border border-neutral-200 p-12 flex flex-col items-center justify-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-neutral-400" />
              <p className="text-xs text-neutral-500">
                Analyzing full document text, bilingual RU/EN concepts, and TF-IDF semantic vectors...
              </p>
            </div>
          ) : filteredClusters.length === 0 ? (
            <div className="bg-white rounded-2xl border border-neutral-200 p-10 text-center space-y-2">
              <Network className="w-8 h-8 text-neutral-400 mx-auto" />
              <h3 className="text-sm font-semibold text-neutral-900">
                {clusters.length === 0 ? 'No Vault Documents Found Yet' : 'No Matching Semantic Clusters'}
              </h3>
              <p className="text-xs text-neutral-500 max-w-md mx-auto">
                {clusters.length === 0
                  ? 'Connect your Obsidian Vault or click 1-Click Sample Vault in the top banner to test full-meaning document clustering.'
                  : 'Try clearing your search query or filter.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {filteredClusters.map(cluster => {
                const customTagsForCluster = clusterCustomTags[cluster.id] || [];
                return (
                  <div
                    key={cluster.id}
                    className="bg-white rounded-2xl border border-neutral-200 p-5 flex flex-col justify-between gap-4 hover:border-neutral-300 transition-colors"
                  >
                    <div className="space-y-3">
                      {/* Cluster Header: Title + Unboxed Metadata + Single Action CTA */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <h3 className="text-sm font-semibold text-neutral-900 truncate">
                            {cluster.label}
                          </h3>
                          {/* Zero-Pill Unboxed Metadata Line */}
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500 tabular-nums">
                            <span className="text-emerald-700 font-medium">
                              {cluster.cohesionScore}% semantic cohesion
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-neutral-700">
                              {cluster.recommendedFolder}
                            </span>
                            {cluster.dominantProject && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono text-indigo-700 font-medium">
                                  Project #{cluster.dominantProject}
                                </span>
                              </>
                            )}
                          </div>
                          <p className="text-xs text-neutral-500">{cluster.summary}</p>
                        </div>

                        <button
                          onClick={() => handleApplyCluster(cluster.id)}
                          disabled={applyingClusterId !== null}
                          className="px-3.5 py-1.5 bg-neutral-900 hover:bg-neutral-800 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors shrink-0 flex items-center gap-1.5"
                          title="Apply clean cluster #tags to all notes in this cluster and move them to the target folder"
                        >
                          {applyingClusterId === cluster.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          )}
                          <span className="tabular-nums">Apply & Route ({cluster.notes.length})</span>
                        </button>
                      </div>

                      {/* Interactive Cluster #Tag Controls + Inline Custom Tag Input */}
                      <div className="pt-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {cluster.coreTags.map(tag => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => onSelectTagFilter && onSelectTagFilter(tag)}
                              className="px-2 py-0.5 bg-neutral-100 hover:bg-neutral-900 text-neutral-800 hover:text-white rounded-md text-[11px] font-mono transition-colors"
                              title={`Filter Vault notes by #${tag}`}
                            >
                              #{tag}
                            </button>
                          ))}
                          {customTagsForCluster.map(tag => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => handleRemoveCustomTagFromCluster(cluster.id, tag)}
                              className="px-2 py-0.5 bg-emerald-50 hover:bg-rose-50 text-emerald-800 hover:text-rose-700 border border-emerald-200 rounded-md text-[11px] font-mono transition-colors flex items-center gap-1"
                              title="Click to remove custom cluster tag"
                            >
                              <span>+#{tag}</span>
                              <span>×</span>
                            </button>
                          ))}

                          <div className="inline-flex items-center gap-1 ml-auto">
                            <input
                              type="text"
                              value={clusterTagInputs[cluster.id] || ''}
                              onChange={e =>
                                setClusterTagInputs(prev => ({
                                  ...prev,
                                  [cluster.id]: e.target.value
                                }))
                              }
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleAddCustomTagToCluster(cluster.id);
                                }
                              }}
                              placeholder="+ #tag to cluster"
                              className="w-28 bg-neutral-50 border border-neutral-200 rounded-md px-2 py-0.5 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-neutral-900"
                            />
                            <button
                              type="button"
                              onClick={() => handleAddCustomTagToCluster(cluster.id)}
                              className="px-1.5 py-0.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-md text-[11px] font-medium"
                              title="Add custom #tag to all notes in this cluster"
                            >
                              +
                            </button>
                          </div>
                        </div>

                        {cluster.keyConcepts.length > 0 && (
                          <div className="text-[11px] text-neutral-400">
                            <span>Key concepts: </span>
                            <span className="text-neutral-600">
                              {cluster.keyConcepts.slice(0, 5).join(' · ')}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Member Documents: Hairline-divided rows (No nested bordered cards!) */}
                      <div className="divide-y divide-neutral-100 border-t border-neutral-100 pt-1">
                        {cluster.notes.map(note => {
                          const newSuggested = note.suggestedTags.filter(
                            t =>
                              !note.currentTags.some(
                                ct => ct.toLowerCase() === t.toLowerCase()
                              )
                          );
                          return (
                            <div key={note.path} className="py-2.5 space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => onOpenNote && onOpenNote(note.path)}
                                  className="text-left group flex items-center gap-1.5 min-w-0"
                                  title="Click to open this note in Vault & Notes editor"
                                >
                                  <FileText className="w-3.5 h-3.5 text-neutral-400 group-hover:text-neutral-900 shrink-0" />
                                  <span className="text-xs font-semibold text-neutral-900 group-hover:underline truncate">
                                    {note.title}
                                  </span>
                                  <ExternalLink className="w-3 h-3 text-neutral-300 group-hover:text-neutral-600 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                                </button>

                                {/* Unboxed note metadata with typographic separators */}
                                <div className="flex items-center gap-1.5 text-[11px] text-neutral-500 font-mono shrink-0 tabular-nums">
                                  <span>{note.similarityToCluster}%</span>
                                  <span aria-hidden="true">·</span>
                                  {note.needsRouting ? (
                                    <span className="text-amber-700">
                                      {note.currentFolder} → {note.recommendedFolder}
                                    </span>
                                  ) : (
                                    <span>{note.currentFolder}</span>
                                  )}
                                </div>
                              </div>

                              <p className="text-xs text-neutral-500 line-clamp-1 leading-relaxed">
                                {note.snippet}
                              </p>

                              {/* Quiet unboxed inline tag summary */}
                              <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono text-neutral-400">
                                <span>
                                  {note.suggestedTags
                                    .slice(0, 6)
                                    .map(t => `#${t}`)
                                    .join(' · ')}
                                </span>
                                {newSuggested.length > 0 && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="text-emerald-700 font-sans">
                                      +{newSuggested.length} new tag{newSuggested.length > 1 ? 's' : ''}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Cross-Note Semantic Bridges (Hairline-divided list inside a single clean container) */}
          {semanticBridges.length > 0 && (
            <div className="bg-white rounded-2xl border border-neutral-200 p-5 space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900 flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-indigo-600" />
                  <span>Discovered Semantic Bridges (Cross-Note Connections by Full Meaning)</span>
                </h3>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Pairs of documents with strong conceptual overlap even when titles, folders, or languages differ. Click any document to open it.
                </p>
              </div>

              <div className="divide-y divide-neutral-100 border-t border-neutral-100">
                {semanticBridges.slice(0, 6).map((bridge, idx) => (
                  <div
                    key={`${bridge.sourcePath}-${bridge.targetPath}-${idx}`}
                    className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <button
                        type="button"
                        onClick={() => onOpenNote && onOpenNote(bridge.sourcePath)}
                        className="font-semibold text-neutral-900 hover:underline truncate"
                      >
                        {bridge.sourceTitle}
                      </button>
                      <span className="text-neutral-400">↔</span>
                      <button
                        type="button"
                        onClick={() => onOpenNote && onOpenNote(bridge.targetPath)}
                        className="font-semibold text-neutral-900 hover:underline truncate"
                      >
                        {bridge.targetTitle}
                      </button>
                    </div>

                    <div className="flex items-center gap-2 text-[11px] text-neutral-500 shrink-0 tabular-nums">
                      <span className="text-indigo-700 font-medium">
                        {bridge.similarity}% meaning match
                      </span>
                      {bridge.sharedConcepts.length > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-neutral-600">
                            {bridge.sharedConcepts.slice(0, 4).join(' · ')}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* VIEW 2: PROJECT #TAGS & DIRECTORY ROUTING                             */}
      {/* ===================================================================== */}
      {subView === 'projects' && (
        <div className="space-y-5">
          {/* Top Action Bar */}
          <div className="bg-white rounded-2xl border border-neutral-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-0.5">
              <h3 className="text-sm font-semibold text-neutral-900">
                Project #Tag Profiles & Automatic Folder Routing
              </h3>
              <p className="text-xs text-neutral-500">
                Assign clean <code className="text-neutral-800 font-mono">#tags</code> to each project. Notes matching these tags or concepts automatically receive the project tag and route to its folder.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                onClick={() => setShowNewProjectForm(!showNewProjectForm)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-lg text-xs font-medium transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                {showNewProjectForm ? 'Cancel' : 'New Project'}
              </button>

              <button
                onClick={() => handleClassifyAndRoute({ dryRun: true, routeFiles: true })}
                disabled={runningAction !== null}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-neutral-50 text-neutral-700 border border-neutral-200 rounded-lg text-xs font-medium transition-colors"
              >
                {runningAction === 'dry_run' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Eye className="w-3.5 h-3.5 text-neutral-500" />
                )}
                Preview Routing
              </button>

              <button
                onClick={() => handleClassifyAndRoute({ dryRun: false, routeFiles: true })}
                disabled={runningAction !== null}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg text-xs font-semibold transition-colors"
              >
                {runningAction === 'classify_and_route' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5 text-emerald-400" />
                )}
                Apply #Tags & Route Vault
              </button>
            </div>
          </div>

          {/* New Project Inline Form */}
          {showNewProjectForm && (
            <div className="bg-white rounded-2xl border border-neutral-200 p-5 space-y-3">
              <h4 className="text-xs font-semibold text-neutral-900">
                Create or Update Project #Tag Profile
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input
                  type="text"
                  value={newProjectId}
                  onChange={e => setNewProjectId(e.target.value)}
                  placeholder="Project Name / #Tag (e.g. Hermes)"
                  className="bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-neutral-900"
                />
                <input
                  type="text"
                  value={newProjectFolder}
                  onChange={e => setNewProjectFolder(e.target.value)}
                  placeholder="Target Folder (e.g. 01_Projects/Hermes)"
                  className="bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-neutral-900"
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newProjectTags}
                    onChange={e => setNewProjectTags(e.target.value)}
                    placeholder="Associated #tags (comma-separated)"
                    className="flex-1 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-neutral-900"
                  />
                  <button
                    onClick={handleUpsertProjectProfile}
                    className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg text-xs font-semibold transition-colors shrink-0"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Project Profiles Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projectProfiles.map(prof => (
              <div
                key={prof.id}
                className="bg-white rounded-2xl border border-neutral-200 p-5 flex flex-col justify-between gap-4"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-neutral-100">
                    <div className="space-y-0.5 min-w-0">
                      <button
                        type="button"
                        onClick={() => onSelectTagFilter && onSelectTagFilter(prof.projectTag)}
                        className="text-sm font-semibold font-mono text-neutral-900 hover:underline"
                        title={`Filter Vault notes by #${prof.projectTag}`}
                      >
                        #{prof.projectTag}
                      </button>
                      <div className="text-[11px] font-mono text-neutral-500 truncate">
                        → {prof.targetFolder}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveProjectProfile(prof.projectTag)}
                      className="text-neutral-400 hover:text-rose-600 p-1"
                      title="Delete project profile"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Interactive Project Tags */}
                  <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                    {prof.associatedTags.map(t => {
                      const clean = t.replace(/^#+/, '').replace(/^.*\/+/, '');
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => handleRemoveTagFromProjectProfile(prof, clean)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 bg-neutral-100 hover:bg-rose-50 text-neutral-800 hover:text-rose-700 rounded-md text-[11px] font-mono transition-colors"
                          title={`Click to remove #${clean} from ${prof.id}`}
                        >
                          <span>#{clean}</span>
                          <span className="text-neutral-400 hover:text-rose-600">×</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Add Tag to Project Input */}
                <div className="flex gap-1.5 pt-2 border-t border-neutral-100">
                  <input
                    type="text"
                    value={projectTagInputs[prof.id] || ''}
                    onChange={e =>
                      setProjectTagInputs(prev => ({ ...prev, [prof.id]: e.target.value }))
                    }
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddTagToProjectProfile(prof);
                      }
                    }}
                    placeholder={`Add #tag to ${prof.id}...`}
                    className="flex-1 bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-neutral-900"
                  />
                  <button
                    onClick={() => handleAddTagToProjectProfile(prof)}
                    className="px-2.5 py-1 bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg text-xs font-medium transition-colors"
                  >
                    + Add
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Progressive Disclosure for Custom Non-Project #Tag -> Folder Rules */}
          <details className="bg-white rounded-2xl border border-neutral-200 p-5 group">
            <summary className="text-xs font-semibold text-neutral-800 cursor-pointer list-none flex items-center justify-between">
              <span>
                Advanced: General #Tag → Folder Routing Rules ({Object.keys(tagRoutes).length} active rules)
              </span>
              <span className="text-[11px] font-normal text-neutral-500 group-open:hidden">
                Click to expand
              </span>
            </summary>

            <div className="mt-4 pt-4 border-t border-neutral-100 space-y-3">
              <p className="text-xs text-neutral-500">
                When a note does not belong to a specific project, these clean <code className="text-neutral-800 font-mono">#tags</code> route it to the appropriate knowledge or area folder.
              </p>

              <div className="flex flex-wrap gap-1.5">
                {Object.entries(tagRoutes).map(([tag, folder]) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => handleRemoveRoute(tag)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-neutral-100 hover:bg-rose-50 rounded-lg text-[11px] font-mono text-neutral-800 hover:text-rose-700 transition-colors"
                    title="Click to remove routing rule"
                  >
                    <span className="font-semibold">#{tag.replace(/^#+/, '')}</span>
                    <span className="text-neutral-400">→</span>
                    <span className="text-emerald-700">{folder}</span>
                    <span className="text-neutral-400 ml-0.5">×</span>
                  </button>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row gap-2 pt-1">
                <input
                  type="text"
                  value={newRouteTag}
                  onChange={e => setNewRouteTag(e.target.value)}
                  placeholder="Clean #tag (e.g. research)"
                  className="sm:w-56 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-neutral-900"
                />
                <input
                  type="text"
                  value={newRouteFolder}
                  onChange={e => setNewRouteFolder(e.target.value)}
                  placeholder="Target Folder (e.g. 03_Knowledge/Research)"
                  className="flex-1 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-neutral-900"
                />
                <button
                  onClick={handleAddRoute}
                  className="px-4 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg text-xs font-semibold transition-colors shrink-0"
                >
                  + Add Rule
                </button>
              </div>
            </div>
          </details>
        </div>
      )}

      {/* ===================================================================== */}
      {/* VIEW 3: IMPORT FROM FILE & CLEAN #TAG CATALOG                         */}
      {/* ===================================================================== */}
      {subView === 'catalog' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left 5 Cols: Import / Export Clean #Tags from File */}
          <div className="lg:col-span-5 bg-white rounded-2xl border border-neutral-200 p-5 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900">
                  Import Clean #Tags from File
                </h3>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Upload any <code className="font-mono text-neutral-700">.md</code>, <code className="font-mono text-neutral-700">.txt</code>, or <code className="font-mono text-neutral-700">.json</code> file. All tags are normalized to clean atomic <code className="font-mono text-neutral-800">#tags</code>.
                </p>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => handleExportTaxonomy('md')}
                  disabled={exporting}
                  className="flex items-center gap-1 px-2.5 py-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-lg text-[11px] font-medium transition-colors"
                >
                  <Download className="w-3 h-3" />
                  .MD
                </button>
                <button
                  onClick={() => handleExportTaxonomy('json')}
                  disabled={exporting}
                  className="flex items-center gap-1 px-2.5 py-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-lg text-[11px] font-medium transition-colors"
                >
                  <Download className="w-3 h-3" />
                  .JSON
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.txt,.json"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg text-xs font-semibold transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                Choose File (.md / .txt / .json)
              </button>

              <button
                onClick={() => setImportText(SAMPLE_IMPORT_MARKDOWN)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-lg text-xs font-medium transition-colors"
              >
                <FileText className="w-3.5 h-3.5" />
                Load Sample #Tags
              </button>

              <select
                value={importMode}
                onChange={e => setImportMode(e.target.value as 'merge' | 'replace')}
                className="bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs text-neutral-700 focus:outline-none ml-auto"
              >
                <option value="merge">Merge with current</option>
                <option value="replace">Replace current</option>
              </select>
            </div>

            <textarea
              value={importText}
              onChange={e => setImportText(e.target.value)}
              rows={10}
              placeholder={`Paste your clean #tags here or upload a file...\n\nExample:\n### Hermes\n#Hermes\n#agent-orchestration\n#multi-agent\n#local-LLM`}
              className="w-full bg-neutral-50 border border-neutral-200 rounded-xl p-3 text-xs font-mono text-neutral-800 focus:outline-none focus:ring-1 focus:ring-neutral-900"
            />

            <div className="flex items-center justify-between gap-2">
              <button
                onClick={() => handleImportTaxonomy(false)}
                disabled={importing || !importText.trim()}
                className="w-full flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl text-xs font-semibold transition-colors"
              >
                {importing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                Import Clean #Tags into System
              </button>
            </div>

            <div className="pt-3 border-t border-neutral-100 space-y-1.5">
              <label className="block text-[11px] font-medium text-neutral-500">
                Or Import Directly from File Inside Connected Vault:
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={vaultImportPath}
                  onChange={e => setVaultImportPath(e.target.value)}
                  placeholder="e.g. project-hashtags-expanded.md"
                  className="flex-1 bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-neutral-900"
                />
                <button
                  onClick={() => handleImportTaxonomy(true)}
                  disabled={importing || !vaultImportPath.trim()}
                  className="px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 disabled:opacity-40 text-white rounded-lg text-xs font-medium transition-colors shrink-0"
                >
                  Import Vault File
                </button>
              </div>
            </div>
          </div>

          {/* Right 7 Cols: Single Unified L0–L7 Catalog Card with Hairline Dividers */}
          <div className="lg:col-span-7 bg-white rounded-2xl border border-neutral-200 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900">
                  Clean #Tag Catalog ({totalTagsCount} tags)
                </h3>
                <p className="text-xs text-neutral-500">
                  Click any <code className="font-mono text-neutral-800">#tag</code> to filter notes in Vault & Notes, or click <code className="font-mono">×</code> to remove it.
                </p>
              </div>

              <div className="relative w-full sm:w-56">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type="text"
                  value={catalogSearch}
                  onChange={e => setCatalogSearch(e.target.value)}
                  placeholder="Filter #tags..."
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-lg pl-8 pr-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-neutral-900"
                />
              </div>
            </div>

            {/* Interactive Category Filter Tabs */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => setSelectedAxisFilter('all')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  selectedAxisFilter === 'all'
                    ? 'bg-neutral-900 text-white font-semibold'
                    : 'bg-neutral-100 text-neutral-600 hover:text-neutral-900'
                }`}
              >
                All Categories
              </button>
              {axes.map(axis => (
                <button
                  key={axis.id}
                  type="button"
                  onClick={() => setSelectedAxisFilter(axis.id)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    selectedAxisFilter === axis.id
                      ? 'bg-neutral-900 text-white font-semibold'
                      : 'bg-neutral-100 text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  {axis.level} {axis.id}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="p-8 flex items-center justify-center gap-2 text-xs text-neutral-500">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading clean #tags...
              </div>
            ) : (
              <div className="divide-y divide-neutral-100 border-t border-neutral-100">
                {axes
                  .filter(axis => selectedAxisFilter === 'all' || axis.id === selectedAxisFilter)
                  .map(axis => {
                    const filteredTags = catalogSearch.trim()
                      ? axis.tags.filter(t =>
                          t.toLowerCase().includes(catalogSearch.trim().toLowerCase())
                        )
                      : axis.tags;

                    return (
                      <div key={axis.id} className="py-3.5 space-y-2.5">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="font-mono font-semibold text-neutral-900">
                              {axis.level}
                            </span>
                            <span className="font-semibold text-neutral-900">{axis.label}</span>
                            <span className="text-neutral-300" aria-hidden="true">
                              ·
                            </span>
                            <span className="text-neutral-500">{axis.question}</span>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <input
                              type="text"
                              value={newTagInputs[axis.id] || ''}
                              onChange={e =>
                                setNewTagInputs(prev => ({ ...prev, [axis.id]: e.target.value }))
                              }
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleAddTag(axis.id);
                                }
                              }}
                              placeholder={`+ #tag to ${axis.id}...`}
                              className="w-36 bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-neutral-900"
                            />
                            <button
                              onClick={() => handleAddTag(axis.id)}
                              className="px-2.5 py-1 bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg text-xs font-medium transition-colors"
                            >
                              Add
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          {filteredTags.map(tag => {
                            const clean = tag.replace(/^#+/, '').replace(/^.*\/+/, '');
                            return (
                              <span
                                key={tag}
                                className="inline-flex items-center bg-neutral-100 rounded-md text-[11px] font-mono text-neutral-800 overflow-hidden"
                              >
                                <button
                                  type="button"
                                  onClick={() => onSelectTagFilter && onSelectTagFilter(clean)}
                                  className="px-2 py-0.5 hover:bg-neutral-900 hover:text-white transition-colors"
                                  title={`Filter notes by #${clean}`}
                                >
                                  #{clean}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveTag(axis.id, tag)}
                                  className="px-1.5 py-0.5 text-neutral-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                  title={`Remove #${clean}`}
                                >
                                  ×
                                </button>
                              </span>
                            );
                          })}
                          {filteredTags.length === 0 && (
                            <span className="text-[11px] text-neutral-400 italic">
                              No matching tags
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Dry-Run Preview Modal */}
      {showPreviewModal && previewItems && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[85vh] flex flex-col border border-neutral-200 shadow-xl overflow-hidden">
            <div className="p-4 border-b border-neutral-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900">
                  Routing & Clean #Tag Assignment Preview ({previewItems.length} files)
                </h3>
                <p className="text-xs text-neutral-500">
                  Review how notes will be tagged and routed before applying changes to disk.
                </p>
              </div>
              <button
                onClick={() => setShowPreviewModal(false)}
                className="p-1 text-neutral-400 hover:text-neutral-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto divide-y divide-neutral-100 flex-1">
              {previewItems.map(item => (
                <div key={item.oldPath} className="py-3 space-y-1.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-neutral-900 font-mono">
                      {item.filename}
                    </span>
                    <div className="flex items-center gap-2 text-[11px] font-mono text-neutral-600">
                      <span>{item.currentFolder || 'Root'}</span>
                      <ArrowRight className="w-3 h-3 text-neutral-400" />
                      <span className="text-emerald-700 font-semibold">{item.targetFolder}</span>
                      {item.matchedProject && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-indigo-700 font-semibold">
                            #{item.matchedProject}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-[11px] font-mono text-neutral-500">
                    {item.updatedTags.map(t => `#${t.replace(/^#+/, '')}`).join(' · ')}
                  </div>
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-neutral-200 bg-neutral-50 flex items-center justify-end gap-2">
              <button
                onClick={() => setShowPreviewModal(false)}
                className="px-3.5 py-1.5 bg-white border border-neutral-200 hover:bg-neutral-100 text-neutral-700 rounded-lg text-xs font-medium"
              >
                Close Preview
              </button>
              <button
                onClick={() => {
                  setShowPreviewModal(false);
                  handleClassifyAndRoute({ dryRun: false, routeFiles: true });
                }}
                className="px-4 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5 text-emerald-400" />
                Apply Changes Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default TagTaxonomyWorkspace;
