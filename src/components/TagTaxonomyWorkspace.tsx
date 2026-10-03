import React, { useState, useEffect, useRef, useMemo } from 'react';
import axios from 'axios';
import {
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
  Eye,
  Play,
  RotateCcw,
  Network,
  Search,
  Link2,
  ExternalLink,
  Zap,
  CheckSquare,
  Square
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

export interface ProjectHarnessTask {
  id: string;
  text: string;
  completed: boolean;
  notePath: string;
  noteTitle: string;
  lineIndex: number;
}

export interface ProjectHarnessArtifact {
  path: string;
  filename: string;
  title: string;
  role: 'spec' | 'roadmap' | 'architecture' | 'script' | 'research' | 'note';
  currentFolder: string;
  targetFolder: string;
  needsRouting: boolean;
  tags: string[];
  modifiedTime: string;
}

export interface ProjectHarnessItem {
  id: string;
  projectTag: string;
  targetFolder: string;
  associatedTags: string[];
  aliases: string[];
  status: 'active' | 'in-progress' | 'planning' | 'completed' | 'idle';
  momentumScore: number;
  totalDocsCount: number;
  inFolderDocsCount: number;
  scatteredDocsCount: number;
  openTasksCount: number;
  completedTasksCount: number;
  openTasks: ProjectHarnessTask[];
  completedTasks: ProjectHarnessTask[];
  artifacts: ProjectHarnessArtifact[];
  lastUpdated: string | null;
}

export interface ProjectHarnessReport {
  projects: ProjectHarnessItem[];
  totalProjects: number;
  totalProjectDocs: number;
  totalScatteredDocs: number;
  totalOpenTasks: number;
  totalCompletedTasks: number;
  dashboardPath: string;
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

  // Project Tracking Harness state
  const [harnessReport, setHarnessReport] = useState<ProjectHarnessReport>({
    projects: [],
    totalProjects: 0,
    totalProjectDocs: 0,
    totalScatteredDocs: 0,
    totalOpenTasks: 0,
    totalCompletedTasks: 0,
    dashboardPath: '00_MOC/Project_Harness_Dashboard.md'
  });
  const [loadingHarness, setLoadingHarness] = useState(false);
  const [syncingHarnessId, setSyncingHarnessId] = useState<string | null>(null);
  const [togglingTaskId, setTogglingTaskId] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<'all' | 'active' | 'scattered'>('all');

  // Obsidian Fast-Init Optimizer state
  const [optimizingObsidian, setOptimizingObsidian] = useState(false);

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

  const fetchProjectHarness = async () => {
    setLoadingHarness(true);
    try {
      const res = await axios.get('/api/projects/harness');
      if (res.data && Array.isArray(res.data.projects)) {
        setHarnessReport(res.data);
      }
    } catch {
      // ignore if vault not yet connected
    } finally {
      setLoadingHarness(false);
    }
  };

  const refreshAllData = async () => {
    await Promise.all([fetchTaxonomy(), fetchSemanticClusters(), fetchProjectHarness()]);
  };

  useEffect(() => {
    refreshAllData();
  }, [vaultPath]);

  const handleOptimizeObsidianStartup = async () => {
    setOptimizingObsidian(true);
    setStatusBanner(null);
    try {
      const res = await axios.post('/api/vault/optimize-obsidian', { keepSnapshots: 1 });
      setStatusBanner({
        type: 'success',
        text:
          res.data?.message ||
          'Vault optimized for instant Obsidian startup (.obsidian/app.json ignore filters configured & redundant snapshots pruned).'
      });
      if (onNotify) onNotify();
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err.response?.data?.error || 'Failed to optimize vault for Obsidian startup'
      });
    } finally {
      setOptimizingObsidian(false);
    }
  };

  const handleSyncProjectHarness = async (projectId?: string) => {
    setSyncingHarnessId(projectId || 'all');
    setStatusBanner(null);
    try {
      const res = await axios.post('/api/projects/harness/sync', {
        projectId,
        routeScattered: true
      });
      if (res.data?.snapshotId) {
        setLastSnapshotId(res.data.snapshotId);
      }
      setStatusBanner({
        type: 'success',
        text:
          res.data?.message ||
          'Synced Project Tracking Harness, routed scattered notes, and updated 00_MOC/Project_Harness_Dashboard.md.'
      });
      await Promise.all([fetchProjectHarness(), fetchSemanticClusters()]);
      if (onNotify) onNotify();
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err.response?.data?.error || 'Failed to sync Project Tracking Harness'
      });
    } finally {
      setSyncingHarnessId(null);
    }
  };

  const handleToggleProjectTask = async (task: ProjectHarnessTask) => {
    setTogglingTaskId(task.id);
    try {
      await axios.post('/api/projects/harness/toggle-task', {
        notePath: task.notePath,
        lineIndex: task.lineIndex
      });
      await fetchProjectHarness();
      if (onNotify) onNotify();
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err.response?.data?.error || 'Failed to toggle task in Markdown note'
      });
    } finally {
      setTogglingTaskId(null);
    }
  };

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
      await Promise.all([fetchSemanticClusters(), fetchProjectHarness()]);
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
      await Promise.all([fetchSemanticClusters(), fetchProjectHarness()]);
      if (onNotify) onNotify();
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err.response?.data?.error || 'Failed to add project tag'
      });
    }
  };

  const handleRemoveTagFromProjectProfile = async (prof: ProjectTagProfile, tagToRemove: string) => {
    const updatedAssoc = prof.associatedTags.filter(t => t !== tagToRemove);
    try {
      const res = await axios.post('/api/tags/taxonomy', {
        action: 'upsert_project_profile',
        projectProfile: {
          ...prof,
          associatedTags: updatedAssoc
        }
      });
      applyTaxonomyResponse(res.data);
      await Promise.all([fetchSemanticClusters(), fetchProjectHarness()]);
      if (onNotify) onNotify();
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err.response?.data?.error || 'Failed to remove project tag'
      });
    }
  };

  const handleUpsertProjectProfile = async () => {
    const id = newProjectId.trim().replace(/^#+/, '').replace(/^.*\/+/, '');
    if (!id) return;
    const targetFolder = newProjectFolder.trim() || `01_Projects/${id}`;
    const associatedTags = newProjectTags
      .split(/[,;\n]+/)
      .map(s => s.trim().replace(/^#+/, '').replace(/^.*\/+/, ''))
      .filter(Boolean);

    try {
      const res = await axios.post('/api/tags/taxonomy', {
        action: 'upsert_project_profile',
        projectProfile: {
          id,
          projectTag: id,
          targetFolder,
          associatedTags,
          aliases: [id]
        }
      });
      applyTaxonomyResponse(res.data);
      setNewProjectId('');
      setNewProjectFolder('');
      setNewProjectTags('');
      setShowNewProjectForm(false);
      setStatusBanner({
        type: 'success',
        text: `Saved project "#${id}" → "${targetFolder}".`
      });
      await Promise.all([fetchSemanticClusters(), fetchProjectHarness()]);
      if (onNotify) onNotify();
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err.response?.data?.error || 'Failed to save project profile'
      });
    }
  };

  const handleRemoveProjectProfile = async (id: string) => {
    try {
      const res = await axios.post('/api/tags/taxonomy', {
        action: 'remove_project_profile',
        tag: id
      });
      applyTaxonomyResponse(res.data);
      await Promise.all([fetchSemanticClusters(), fetchProjectHarness()]);
      if (onNotify) onNotify();
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err.response?.data?.error || 'Failed to remove project profile'
      });
    }
  };

  const handleAddRoute = async () => {
    const tag = newRouteTag.trim().replace(/^#+/, '').replace(/^.*\/+/, '');
    const targetFolder = newRouteFolder.trim();
    if (!tag || !targetFolder) return;
    try {
      const res = await axios.post('/api/tags/taxonomy', {
        action: 'set_route',
        tag,
        targetFolder
      });
      applyTaxonomyResponse(res.data);
      setNewRouteTag('');
      setNewRouteFolder('');
      await fetchSemanticClusters();
      if (onNotify) onNotify();
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err.response?.data?.error || 'Failed to save tag route'
      });
    }
  };

  const handleRemoveRoute = async (tag: string) => {
    try {
      const res = await axios.post('/api/tags/taxonomy', {
        action: 'remove_route',
        tag
      });
      applyTaxonomyResponse(res.data);
      await fetchSemanticClusters();
      if (onNotify) onNotify();
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err.response?.data?.error || 'Failed to remove tag route'
      });
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = String(ev.target?.result || '');
      setImportText(text);
      setStatusBanner({
        type: 'info',
        text: `Loaded "${file.name}" (${text.length} chars). Click "Import Clean #Tags" to apply.`
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
      await Promise.all([fetchSemanticClusters(), fetchProjectHarness()]);
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
      await Promise.all([fetchSemanticClusters(), fetchProjectHarness()]);
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
      await Promise.all([fetchSemanticClusters(), fetchProjectHarness()]);
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

  // Merge harness items with projectProfiles so even projects with 0 notes in vault are editable
  const mergedHarnessProjects = useMemo(() => {
    const byId = new Map<string, ProjectHarnessItem>();
    for (const item of harnessReport.projects) {
      byId.set(item.projectTag.toLowerCase(), item);
    }
    for (const prof of projectProfiles) {
      const key = prof.projectTag.toLowerCase();
      if (!byId.has(key)) {
        byId.set(key, {
          id: prof.id,
          projectTag: prof.projectTag,
          targetFolder: prof.targetFolder,
          associatedTags: prof.associatedTags,
          aliases: prof.aliases,
          status: 'idle',
          momentumScore: 0,
          totalDocsCount: 0,
          inFolderDocsCount: 0,
          scatteredDocsCount: 0,
          openTasksCount: 0,
          completedTasksCount: 0,
          openTasks: [],
          completedTasks: [],
          artifacts: [],
          lastUpdated: null
        });
      } else {
        const existing = byId.get(key)!;
        existing.associatedTags = prof.associatedTags;
        existing.targetFolder = prof.targetFolder;
      }
    }
    const list = Array.from(byId.values());
    return list.filter(p => {
      if (projectFilter === 'active') return p.totalDocsCount > 0 || p.openTasksCount > 0;
      if (projectFilter === 'scattered') return p.scatteredDocsCount > 0;
      return true;
    });
  }, [harnessReport.projects, projectProfiles, projectFilter]);

  return (
    <div className="space-y-5">
      {/* Clean Header & Sub-Navigation Bar */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-neutral-900">
              Semantic Knowledge Clusters, Project Tracking Harness & Clean #Tags
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
            Full-meaning document clustering · Live Project Tracking Harness (<code className="text-neutral-800 font-mono">00_MOC/Project_Harness_Dashboard.md</code>) · 100% clean atomic <code className="text-neutral-800 font-mono">#tags</code>.
          </p>
        </div>

        {/* 3 Focused Mode Tabs + Obsidian Fast-Init Button */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleOptimizeObsidianStartup}
            disabled={optimizingObsidian}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 rounded-xl text-xs font-medium transition-colors"
            title="Fix slow Obsidian vault initialization: configure .obsidian/app.json ignore filters, prune old backup snapshots, and deduplicate MOC links"
          >
            {optimizingObsidian ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-700" />
            ) : (
              <Zap className="w-3.5 h-3.5 text-amber-600" />
            )}
            <span>Fast-Init Obsidian</span>
          </button>

          <div className="flex flex-wrap items-center gap-1 bg-neutral-100 p-1 rounded-xl">
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
              <span className="tabular-nums">
                2. Project Harness & #Tags ({projectProfiles.length})
              </span>
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
      {/* VIEW 2: PROJECT TRACKING HARNESS & CLEAN #TAG ROUTER                  */}
      {/* ===================================================================== */}
      {subView === 'projects' && (
        <div className="space-y-5">
          {/* Top Project Harness Action & Telemetry Bar */}
          <div className="bg-white rounded-2xl border border-neutral-200 p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <h3 className="text-sm font-semibold text-neutral-900">
                Project Tracking Harness & Automatic #Tag Router
              </h3>
              {/* Unboxed Zero-Pill Metrics */}
              <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 tabular-nums">
                <span>
                  <strong className="text-neutral-900">{mergedHarnessProjects.length}</strong> projects
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  <strong className="text-neutral-900">{harnessReport.totalProjectDocs}</strong> tracked docs
                </span>
                {harnessReport.totalScatteredDocs > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-amber-700 font-medium">
                      {harnessReport.totalScatteredDocs} scattered notes ready to route
                    </span>
                  </>
                )}
                <span aria-hidden="true">·</span>
                <span>
                  <strong className="text-indigo-700">{harnessReport.totalOpenTasks}</strong> open tasks
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  <strong className="text-emerald-700">{harnessReport.totalCompletedTasks}</strong> completed
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {/* Filter toggle */}
              <div className="flex items-center gap-1 bg-neutral-100 p-1 rounded-lg text-xs">
                <button
                  type="button"
                  onClick={() => setProjectFilter('all')}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    projectFilter === 'all'
                      ? 'bg-white text-neutral-900 font-semibold shadow-xs'
                      : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  All ({projectProfiles.length})
                </button>
                <button
                  type="button"
                  onClick={() => setProjectFilter('active')}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    projectFilter === 'active'
                      ? 'bg-white text-neutral-900 font-semibold shadow-xs'
                      : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  With Docs/Tasks
                </button>
                {harnessReport.totalScatteredDocs > 0 && (
                  <button
                    type="button"
                    onClick={() => setProjectFilter('scattered')}
                    className={`px-2.5 py-1 rounded-md transition-colors ${
                      projectFilter === 'scattered'
                        ? 'bg-white text-amber-800 font-semibold shadow-xs'
                        : 'text-amber-700 hover:text-amber-900'
                    }`}
                  >
                    Needs Routing
                  </button>
                )}
              </div>

              <button
                onClick={() => setShowNewProjectForm(!showNewProjectForm)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-lg text-xs font-medium transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                {showNewProjectForm ? 'Cancel' : 'New Project'}
              </button>

              {onOpenNote && (
                <button
                  type="button"
                  onClick={() => onOpenNote(harnessReport.dashboardPath || '00_MOC/Project_Harness_Dashboard.md')}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-neutral-50 text-neutral-700 border border-neutral-200 rounded-lg text-xs font-medium transition-colors"
                  title="Open generated 00_MOC/Project_Harness_Dashboard.md in Vault & Notes"
                >
                  <FileText className="w-3.5 h-3.5 text-neutral-500" />
                  <span>Open MOC Dashboard</span>
                </button>
              )}

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
                Preview
              </button>

              <button
                onClick={() => handleSyncProjectHarness(undefined)}
                disabled={syncingHarnessId !== null}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-neutral-900 hover:bg-neutral-800 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors"
                title="Tag all project documents, route scattered project files into their 01_Projects/* folders, and write 00_MOC/Project_Harness_Dashboard.md"
              >
                {syncingHarnessId === 'all' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5 text-emerald-400" />
                )}
                Sync Harness & Update MOC
              </button>
            </div>
          </div>

          {/* New Project Inline Form */}
          {showNewProjectForm && (
            <div className="bg-white rounded-2xl border border-neutral-200 p-5 space-y-3">
              <h4 className="text-xs font-semibold text-neutral-900">
                Create or Update Project in Tracking Harness
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

          {/* Project Tracking Harness Cards */}
          {loadingHarness ? (
            <div className="bg-white rounded-2xl border border-neutral-200 p-10 flex items-center justify-center gap-2 text-xs text-neutral-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Scanning project folders, tasks, and semantic tags...
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {mergedHarnessProjects.map(proj => {
                const profileObj: ProjectTagProfile = {
                  id: proj.id,
                  projectTag: proj.projectTag,
                  targetFolder: proj.targetFolder,
                  associatedTags: proj.associatedTags,
                  aliases: proj.aliases
                };

                return (
                  <div
                    key={proj.id}
                    className="bg-white rounded-2xl border border-neutral-200 p-5 flex flex-col justify-between gap-4 hover:border-neutral-300 transition-colors"
                  >
                    <div className="space-y-3.5">
                      {/* Project Header: Clickable #ProjectTag + Unboxed Status/Momentum + Sync CTA */}
                      <div className="flex items-start justify-between gap-3 pb-3 border-b border-neutral-100">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => onSelectTagFilter && onSelectTagFilter(proj.projectTag)}
                              className="text-sm font-semibold font-mono text-neutral-900 hover:underline truncate"
                              title={`Filter Vault notes by #${proj.projectTag}`}
                            >
                              #{proj.projectTag}
                            </button>
                          </div>

                          {/* Unboxed Zero-Pill Project Status & Telemetry Line */}
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500 tabular-nums">
                            <span
                              className={`font-semibold uppercase ${
                                proj.status === 'in-progress'
                                  ? 'text-indigo-700'
                                  : proj.status === 'active'
                                  ? 'text-emerald-700'
                                  : 'text-neutral-500'
                              }`}
                            >
                              {proj.status}
                            </span>
                            {proj.totalDocsCount > 0 && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-emerald-700 font-medium">
                                  {proj.momentumScore}% momentum
                                </span>
                              </>
                            )}
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-neutral-700">{proj.targetFolder}</span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {proj.totalDocsCount} doc{proj.totalDocsCount === 1 ? '' : 's'}
                            </span>
                            {proj.scatteredDocsCount > 0 && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-amber-700 font-medium">
                                  {proj.scatteredDocsCount} to route
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {proj.totalDocsCount > 0 && (
                            <button
                              type="button"
                              onClick={() => handleSyncProjectHarness(proj.id)}
                              disabled={syncingHarnessId !== null}
                              className="px-3 py-1 bg-neutral-900 hover:bg-neutral-800 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1"
                              title={`Tag & route all #${proj.projectTag} notes to ${proj.targetFolder}`}
                            >
                              {syncingHarnessId === proj.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                              )}
                              <span>Sync</span>
                            </button>
                          )}
                          <button
                            onClick={() => handleRemoveProjectProfile(proj.projectTag)}
                            className="text-neutral-400 hover:text-rose-600 p-1"
                            title="Delete project profile"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Clean Associated #Tags */}
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                          {proj.associatedTags.map(t => {
                            const clean = t.replace(/^#+/, '').replace(/^.*\/+/, '');
                            return (
                              <span
                                key={t}
                                className="inline-flex items-center bg-neutral-100 rounded-md text-[11px] font-mono text-neutral-800 overflow-hidden"
                              >
                                <button
                                  type="button"
                                  onClick={() => onSelectTagFilter && onSelectTagFilter(clean)}
                                  className="px-2 py-0.5 hover:bg-neutral-900 hover:text-white transition-colors"
                                  title={`Filter Vault notes by #${clean}`}
                                >
                                  #{clean}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveTagFromProjectProfile(profileObj, clean)}
                                  className="px-1.5 py-0.5 text-neutral-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                  title={`Remove #${clean} from ${proj.projectTag}`}
                                >
                                  ×
                                </button>
                              </span>
                            );
                          })}
                        </div>
                      </div>

                      {/* Live Project Tasks / Action Items (Interactive Checkboxes!) */}
                      {(proj.openTasks.length > 0 || proj.completedTasks.length > 0) && (
                        <div className="border-t border-neutral-100 pt-3 space-y-1.5">
                          <div className="flex items-center justify-between text-[11px] text-neutral-500">
                            <span className="font-semibold text-neutral-800">
                              Project Action Items & Tasks
                            </span>
                            <span className="tabular-nums">
                              {proj.openTasks.length} open · {proj.completedTasks.length} done
                            </span>
                          </div>

                          <div className="divide-y divide-neutral-100">
                            {[...proj.openTasks, ...proj.completedTasks.slice(0, 2)]
                              .slice(0, 5)
                              .map(task => (
                                <div
                                  key={task.id}
                                  className="py-1.5 flex items-start justify-between gap-2 text-xs"
                                >
                                  <button
                                    type="button"
                                    onClick={() => handleToggleProjectTask(task)}
                                    disabled={togglingTaskId === task.id}
                                    className="flex items-start gap-2 text-left group min-w-0 flex-1"
                                    title="Click to toggle task completion directly inside the Markdown note"
                                  >
                                    {togglingTaskId === task.id ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin text-neutral-400 mt-0.5 shrink-0" />
                                    ) : task.completed ? (
                                      <CheckSquare className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                                    ) : (
                                      <Square className="w-3.5 h-3.5 text-neutral-400 group-hover:text-neutral-900 mt-0.5 shrink-0" />
                                    )}
                                    <span
                                      className={`leading-snug ${
                                        task.completed
                                          ? 'line-through text-neutral-400'
                                          : 'text-neutral-800 group-hover:text-neutral-900'
                                      }`}
                                    >
                                      {task.text}
                                    </span>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => onOpenNote && onOpenNote(task.notePath)}
                                    className="text-[11px] font-mono text-neutral-400 hover:text-neutral-800 hover:underline shrink-0 truncate max-w-[140px]"
                                    title={`Open "${task.noteTitle}"`}
                                  >
                                    {task.noteTitle}
                                  </button>
                                </div>
                              ))}
                          </div>
                        </div>
                      )}

                      {/* Tracked Project Documents & Artifacts (Hairline-divided rows) */}
                      {proj.artifacts.length > 0 && (
                        <div className="border-t border-neutral-100 pt-3 space-y-1.5">
                          <div className="text-[11px] font-semibold text-neutral-800">
                            Tracked Project Documents ({proj.artifacts.length})
                          </div>
                          <div className="divide-y divide-neutral-100">
                            {proj.artifacts.slice(0, 5).map(art => (
                              <div
                                key={art.path}
                                className="py-1.5 flex items-center justify-between gap-2 text-xs"
                              >
                                <button
                                  type="button"
                                  onClick={() => onOpenNote && onOpenNote(art.path)}
                                  className="flex items-center gap-1.5 text-left group min-w-0"
                                  title="Click to open document in Vault & Notes"
                                >
                                  <FileText className="w-3.5 h-3.5 text-neutral-400 group-hover:text-neutral-900 shrink-0" />
                                  <span className="font-medium text-neutral-900 group-hover:underline truncate">
                                    {art.title}
                                  </span>
                                </button>

                                <div className="flex items-center gap-1.5 text-[11px] font-mono text-neutral-500 shrink-0 tabular-nums">
                                  <span className="uppercase text-neutral-400">{art.role}</span>
                                  <span aria-hidden="true">·</span>
                                  {art.needsRouting ? (
                                    <span className="text-amber-700">
                                      {art.currentFolder} → {art.targetFolder}
                                    </span>
                                  ) : (
                                    <span className="text-emerald-700">in folder</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Add Tag to Project Input */}
                    <div className="flex gap-1.5 pt-2 border-t border-neutral-100">
                      <input
                        type="text"
                        value={projectTagInputs[proj.id] || ''}
                        onChange={e =>
                          setProjectTagInputs(prev => ({ ...prev, [proj.id]: e.target.value }))
                        }
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddTagToProjectProfile(profileObj);
                          }
                        }}
                        placeholder={`+ #tag to #${proj.projectTag}...`}
                        className="flex-1 bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-neutral-900"
                      />
                      <button
                        onClick={() => handleAddTagToProjectProfile(profileObj)}
                        className="px-2.5 py-1 bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg text-xs font-medium transition-colors"
                      >
                        + Add
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

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
