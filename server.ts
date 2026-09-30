import express from 'express';
import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import crypto from 'crypto';
import chokidar, { FSWatcher } from 'chokidar';
import axios from 'axios';
import * as pdfParseModule from 'pdf-parse';
import mammoth from 'mammoth';
import TurndownService from 'turndown';
import 'dotenv/config';
import { parseNote, serializeNote, mergeTags } from './src/server/frontmatter';
import {
  extractTags,
  sanitizeTagList,
  curateOrthogonalTags,
  loadVaultTagTaxonomy,
  saveVaultTagTaxonomy,
  loadVaultTagTaxonomyConfig,
  saveVaultTagTaxonomyConfig,
  parseTagTaxonomyImport,
  exportTagTaxonomyToMarkdown,
  inferProjectFromNoteAndTaxonomy,
  resolveDirectoryFromTags,
  normalizeToCanonicalTag,
  VaultTagTaxonomyConfig
} from './src/server/tags';
import { buildSemanticKnowledgeClusters, ClusterableNoteInput } from './src/server/semanticClustering';
import { sanitizeTitle } from './src/server/sanitize';
import { createSnapshotSession, restoreSnapshotSession, SnapshotSession } from './src/server/snapshot';
import {
  resolveHost,
  resolveIsDevMode,
  isInboxPathIgnored,
  isPathInsideVault,
  isAllowedHost,
  isAllowedOrigin,
  ConfigSchema,
  RefineVaultSchema,
  DuplicatesResolveSchema,
  ArchiveDuplicatesSchema,
  DecisionTestSchema,
  DecisionTriageResolveSchema,
  DirectoryAuditSchema,
  ApplyRevisionSchema,
  ServerControlSchema,
  GenerateScriptsSchema
} from './src/server/validation';
import { llamaManager } from './src/server/llamaManager';
import {
  auditDirectoryProject,
  applyRevisionPlan,
  pruneEmptyDirectories,
  pruneEmptyParentDirs
} from './src/server/directoryRevisor';
import {
  decide,
  isDecisionServerReachable,
  checkDecisionServerHealth
} from './src/server/decisionModel';
import {
  safeSlice,
  safeTruncateHeadTail,
  sanitizeUnicode,
  sanitizePayloadForLlm
} from './src/server/unicode';
import {
  detectDocumentLanguage,
  enforceTitleLanguage,
  ensureLanguageTags
} from './src/server/language';
import { checkGhostNote, isJunkFile } from './src/server/documentExtractor';
import { triageManager } from './src/server/triageManager';
import { z } from 'zod';
import { generateStructured, GenerationError } from './src/server/llm/generate';
import {
  routeHierarchical,
  HierarchicalRouterConfig,
  validateAndSanitizeRoute,
  preserveMeaningfulTitle
} from './src/server/llm/hierarchicalRouter';
import { runKnowledgeAgentTurn } from './src/server/knowledgeAgent';
import { calibrateThreshold, isCalibrated, applyCalibrationGateOnLoad } from './src/server/calibration';
import {
  loadProjectsRegistry,
  bootstrapProjectsYaml,
  discoverVaultStructure,
  detectProjectsRootFolder
} from './src/server/projectsRegistry';

export { resolveHost, resolveIsDevMode, isInboxPathIgnored, isCalibrated, applyCalibrationGateOnLoad };
import { chooseOne, askYesNo } from './src/server/llm/router';
import {
  TokensRegistry,
  DnaEngine,
  OracleEngine,
  HypergraphTriageBridge,
  generateHypergraphReport
} from './src/server/hypergraph';


// Handle pdf-parse default export issue
const pdfParse = (pdfParseModule as any).default || pdfParseModule;

// Init turndown for HTML to MD
const turndownService = new TurndownService({ headingStyle: 'atx' });
// Aggressively remove unwanted elements that clutter the LLM context
turndownService.remove(['style', 'script', 'noscript', 'meta', 'head', 'link']);

// Global Crash Prevention: Catch all uncaught exceptions and rejections so process never dies silently
process.on('uncaughtException', (err: any) => {
  try {
    const errorDetails = `[CRITICAL UNCAUGHT EXCEPTION] ${new Date().toISOString()}: ${err?.stack || err}\n`;
    console.error(errorDetails);
    try {
      fs.appendFileSync(path.join(process.cwd(), 'emergency_crash_log.txt'), errorDetails, 'utf-8');
    } catch {}
  } catch {}
});

process.on('unhandledRejection', (reason: any) => {
  try {
    const errorDetails = `[UNHANDLED PROMISE REJECTION] ${new Date().toISOString()}: ${reason?.stack || reason}\n`;
    console.error(errorDetails);
    try {
      fs.appendFileSync(path.join(process.cwd(), 'emergency_crash_log.txt'), errorDetails, 'utf-8');
    } catch {}
  } catch {}
});

export const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const HOST = resolveHost(process.env);

app.use(express.json());

// Host and Origin validation middleware (Protection against DNS rebinding & CSRF)
app.use((req, res, next) => {
  const host = req.headers.host;
  if (!isAllowedHost(host)) {
    return res.status(403).json({ error: 'Forbidden: Invalid Host header' });
  }

  const origin = req.headers.origin;
  if (origin && !isAllowedOrigin(origin)) {
    return res.status(403).json({ error: 'Forbidden: Invalid Origin header' });
  }

  next();
});

const CONFIG_FILE = path.join(process.cwd(), 'config.json');

// --- Thread-Safe / Concurrency Tools ---
class Mutex {
  private mutex = Promise.resolve();
  lock(): Promise<() => void> {
    let begin: (unlock: () => void) => void;
    this.mutex = this.mutex.then(() => new Promise(begin));
    return new Promise(res => { begin = res; });
  }
}
const registryMutex = new Mutex();

async function getFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// --- State & Lifecycle ---
let isWatching = false;
let watcher: FSWatcher | null = null;
let currentConfig = {
  vaultPath: '',
  llamaUrl: 'http://127.0.0.1:8080',
  timeoutSeconds: 240,
  maxContextChars: 1500,
  decisionModelUrl: 'http://127.0.0.1:1234',
  enableDecisionModel: false,
  decisionConfidenceThreshold: 0.80,
  decisionMode: 'hybrid' as 'hybrid' | 'fast_routing',
  modelsPath: './llm/models',
  llamaServerBinary: '',
  autoStartJevServer: true,
  autoStartPrimaryServer: false,
  memoryProfile: 'balanced_16gb' as 'balanced_16gb' | 'solo_7b' | 'custom',
  contextSize: 2048,
  threadCount: 4,
  primaryModelFile: 'Hermes-3-Llama-3.2-3B.Q4_K_M.gguf',
  jevModelFile: 'Jev-Style-Qwen3.5-2B-Decision-Q4_K_M.gguf',
  autoMoveEnabled: false,
  topLevelCategories: [
    'Project',
    'Essay/Knowledge',
    'Dialogue/Transcript',
    'Poem',
    'Screenplay/Script',
    'Idea',
    'Journal/Diary',
    'Technical/Code'
  ],
  typeRoutes: {
    'Essay/Knowledge': '03_Knowledge/Essays',
    'Dialogue/Transcript': '03_Knowledge/Dialogues',
    'Poem': '03_Knowledge/Poems',
    'Screenplay/Script': '03_Knowledge/Scripts',
    'Idea': '05_Ideas/Inbox',
    'Journal/Diary': '04_Journal/Daily',
    'Technical/Code': '03_Knowledge/Technical'
  } as Record<string, string>
};

export interface DecisionTriageItem {
  id: string;
  filePath: string;
  relativePath: string;
  filename: string;
  contentType: string;
  confidence: number;
  topFolder: string;
  distribution: Array<{ letter: string; option: string; probability: number }>;
  timestamp: string;
}
let decisionTriageQueue: DecisionTriageItem[] = [];


// Timeout Wrapper for Promises
const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
    let timeoutId: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Timeout: ${label} took longer than ${ms}ms`)), ms);
    });
    return Promise.race([
        promise,
        timeoutPromise
    ]).finally(() => clearTimeout(timeoutId));
};

let logs: { timestamp: string, message: string, type: 'info' | 'error' | 'success' | 'warn' }[] = [];

function addLog(message: string, type: 'info' | 'error' | 'success' | 'warn' = 'info') {
  const log = { timestamp: new Date().toISOString(), message, type };
  logs.unshift(log);
  if (logs.length > 200) logs.pop();
  console.log(`[${type.toUpperCase()}] ${message}`);
}

export function loadConfigFromFile(configFilePath: string = CONFIG_FILE, baseConfig = currentConfig) {
  let loaded = { ...baseConfig };
  try {
    if (fs.existsSync(configFilePath)) {
      const savedConfig = JSON.parse(fs.readFileSync(configFilePath, 'utf-8'));
      loaded = { ...loaded, ...savedConfig };
    }
  } catch (e) {}
  return applyCalibrationGateOnLoad(loaded, (msg) => addLog(msg, 'warn'));
}

currentConfig = loadConfigFromFile(CONFIG_FILE, currentConfig);

export async function buildRouterConfig(
  cfg: typeof currentConfig = currentConfig,
  thresholdOverride?: number
): Promise<HierarchicalRouterConfig> {
  const projects = await loadProjectsRegistry(cfg.vaultPath);
  return {
    topLevelCategories: cfg.topLevelCategories || [
      'Project',
      'Essay/Knowledge',
      'Dialogue/Transcript',
      'Poem',
      'Screenplay/Script',
      'Idea',
      'Journal/Diary',
      'Technical/Code'
    ],
    typeRoutes: cfg.typeRoutes || {
      'Essay/Knowledge': '03_Knowledge/Essays',
      'Dialogue/Transcript': '03_Knowledge/Dialogues',
      'Poem': '03_Knowledge/Poems',
      'Screenplay/Script': '03_Knowledge/Scripts',
      'Idea': '05_Ideas/Inbox',
      'Journal/Diary': '04_Journal/Daily',
      'Technical/Code': '03_Knowledge/Technical'
    },
    projects,
    decisionModelUrl: cfg.decisionModelUrl || 'http://127.0.0.1:1234',
    threshold: thresholdOverride ?? cfg.decisionConfidenceThreshold ?? 0.80
  };
}

export function setCurrentConfigForTest(partial: Partial<typeof currentConfig>) {
  currentConfig = { ...currentConfig, ...partial };
}

export function getCurrentConfigForTest() {
  return currentConfig;
}

export function setVaultStructureForTest(folders: string[]) {
  currentVaultStructure = [...folders];
}

export function getDecisionTriageQueueForTest() {
  return decisionTriageQueue;
}

// --- Queue System with Exponential Backoff ---
interface QueueItem {
  filePath: string;
  retryCount: number;
}
const MAX_RETRIES = 3;
const MAX_QUEUE_SIZE = 1000;

const refineQueue: QueueItem[] = [];
let currentVaultStructure: string[] = [];
let isProcessingRefineQueue = false;
let currentRefineDryRun = false;
let currentRefineSession: SnapshotSession | null = null;
let refineTotal = 0;
let refineCompleted = 0;

const fileQueue: QueueItem[] = [];
let isProcessingQueue = false;
let isShuttingDown = false;
let activeTasks = 0;

async function processQueue() {
  if (isProcessingQueue || isShuttingDown) return;
  isProcessingQueue = true;
  
  while (fileQueue.length > 0 && !isShuttingDown) {
    const item = fileQueue.shift();
    if (!item) continue;
    
    // Check if file still exists before processing (might be deleted/moved manually)
    try {
       await fsPromises.access(item.filePath);
    } catch {
       continue; 
    }
    
    activeTasks++;
    try {
      await processFile(item.filePath);
    } catch (err: any) {
      addLog(`Error processing ${path.basename(item.filePath)}: ${err.message}`, 'error');
      
      const isRetriable = err.isRetriable !== false;
      
      if (isRetriable && item.retryCount < MAX_RETRIES) {
        addLog(`Re-queueing ${path.basename(item.filePath)} (Retry ${item.retryCount + 1}/${MAX_RETRIES})`, 'info');
        // Exponential backoff pushing to queue asynchronously so it doesn't block the rest
        setTimeout(() => {
            fileQueue.push({ filePath: item.filePath, retryCount: item.retryCount + 1 });
            processQueue(); // trigger if idle
        }, Math.pow(2, item.retryCount) * 2000);
      } else {
        addLog(`Abandoned ${path.basename(item.filePath)}.`, 'error');
      }
    }
    activeTasks--;
  }
  
  isProcessingQueue = false;
}

// --- Duplicate Detection & Content Normalization Helpers ---

function parseBaseTitle(filename: string): { base: string; numberSuffix: number | null } {
  const withoutExt = filename.replace(/\.md$/i, '').trim();
  // Matches "Title 1", "Title 2", "Title (1)", "Title_1"
  const match = withoutExt.match(/^(.*?)(?:[\s_]+(?:(\d+)|\((\d+)\)))$/);
  if (match) {
    const num = parseInt(match[2] || match[3], 10);
    return { base: match[1].trim(), numberSuffix: isNaN(num) ? null : num };
  }
  return { base: withoutExt, numberSuffix: null };
}

function getNormalizedBody(content: string): string {
  if (!content) return '';
  // 1. Strip YAML frontmatter if present
  let body = content;
  const fmMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  if (fmMatch) {
    body = fmMatch[1];
  }
  // 2. Strip standard generated callout/source lines
  body = body.replace(/^>\s*\*\*\u0421\u0432\u044f\u0437\u0430\u043d\u043d\u044b\u0435 \u0442\u0435\u043c\u044b:\*\*.*$/gm, '');
  body = body.replace(/^\*\*\u0418\u0441\u0445\u043e\u0434\u043d\u044b\u0439 \u0444\u0430\u0439\u043b:\*\*.*$/gm, '');
  // 3. Normalize newlines, collapse spaces and multiple blank lines, and trim
  return body.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function computeWordSimilarity(textA: string, textB: string): number {
  if (textA === textB) return 100;
  if (!textA || !textB) return 0;
  // Token set Jaccard similarity (fast and memory-friendly for notes)
  const wordsA = new Set(textA.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(textB.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  return Math.round((intersection / union) * 100);
}

function mergeTagsIntoFrontmatter(originalContent: string, newTags: string[]): string {
  const note = parseNote(originalContent);
  mergeTags(note.data, newTags);
  return serializeNote(note.data, note.body);
}

async function safeArchiveDuplicate(duplicatePath: string, canonicalPath: string, customTrashSubdir?: string) {
  const dateStr = new Date().toISOString().slice(0, 10);
  const trashDir = customTrashSubdir || path.join(currentConfig.vaultPath, '99_System', '_duplicates_trash', dateStr);
  await fsPromises.mkdir(trashDir, { recursive: true });
  
  const rel = path.relative(currentConfig.vaultPath, duplicatePath);
  const targetTrashPath = path.join(trashDir, rel);
  await fsPromises.mkdir(path.dirname(targetTrashPath), { recursive: true });

  try {
    await fsPromises.copyFile(duplicatePath, targetTrashPath);
    await fsPromises.unlink(duplicatePath);
  } catch (err: any) {
    if (err.code === 'EXDEV') {
      await fsPromises.copyFile(duplicatePath, targetTrashPath);
      await fsPromises.unlink(duplicatePath);
    } else {
      throw err;
    }
  }
}

async function getExistingFolders(dir: string, currentPath: string = '', depth: number = 0, folderList: string[] = []) {
  if (depth >= 2) return folderList; // Limit depth to avoid massive lists
  try {
    const files = await fsPromises.readdir(dir);
    for (const file of files) {
      const lowerFile = file.toLowerCase();
      // Strict ignore for MOC and system folders
      if (
        file.startsWith('.') || 
        lowerFile === '00_inbox' || 
        lowerFile === 'templates' || 
        lowerFile === '99_system' || 
        lowerFile === 'moc' ||
        lowerFile.startsWith('moc_') ||
        lowerFile.startsWith('moc-') ||
        lowerFile.startsWith('moc ')
      ) continue;
      
      const filePath = path.join(dir, file);
      const stat = await fsPromises.stat(filePath);
      if (stat.isDirectory()) {
        const relPath = currentPath ? `${currentPath}/${file}` : file;
        folderList.push(relPath);
        await getExistingFolders(filePath, relPath, depth + 1, folderList);
      }
    }
  } catch (err) {
    // Ignore read errors
  }
  return folderList;
}

async function getFilesRecursively(
  dir: string,
  fileList: string[] = [],
  force: boolean = false,
  isExplicitFolder: boolean = false
) {
  const files = await fsPromises.readdir(dir);
  for (const file of files) {
    const lowerFile = file.toLowerCase();
    // In root scan: skip inbox, templates, system, MOCs
    // In explicit folder scan: don't skip the folder user picked!
    if (!isExplicitFolder) {
      if (
        file.startsWith('.') || 
        lowerFile === '00_inbox' || 
        lowerFile === 'templates' || 
        lowerFile === '99_system' || 
        lowerFile === 'moc' ||
        lowerFile.startsWith('moc_') ||
        lowerFile.startsWith('moc-') ||
        lowerFile.startsWith('moc ')
      ) continue;
    } else {
      if (file.startsWith('.') || lowerFile === '99_system') continue;
    }

    const filePath = path.join(dir, file);
    const stat = await fsPromises.stat(filePath);
    if (stat.isDirectory()) {
      await getFilesRecursively(filePath, fileList, force, false);
    } else if (file.toLowerCase().endsWith('.md')) {
      if (stat.size === 0) {
        // Skip zero-byte empty markdown files from refine queue
        continue;
      }
      if (force) {
        fileList.push(filePath);
      } else {
        try {
          // Fast read of the first 2048 bytes to check for the ai_refined flag
          const fd = await fsPromises.open(filePath, 'r');
          const buffer = Buffer.alloc(2048);
          const { bytesRead } = await fd.read(buffer, 0, 2048, 0);
          await fd.close();
          const head = buffer.subarray(0, bytesRead).toString('utf-8');
          if (!head.includes('ai_refined: true')) {
            fileList.push(filePath);
          }
        } catch (err) {
          // Fallback
          fileList.push(filePath);
        }
      }
    }
  }
  return fileList;
}

let currentRefineSmartRename = true;

app.get('/api/refine-preview', async (req, res) => {
  if (!currentConfig.vaultPath) return res.status(400).json({ error: 'Vault not set' });
  const folder = String(req.query.folder || '').trim();
  const force = req.query.force === 'true';

  try {
    const isRoot = !folder || folder === '.' || folder === 'Whole Vault' || folder === 'Entire Vault' || folder === '';
    const targetDir = isRoot ? currentConfig.vaultPath : path.join(currentConfig.vaultPath, folder);
    if (!isPathInsideVault(targetDir, currentConfig.vaultPath, true)) {
      return res.status(400).json({ error: 'Target folder must be inside vault' });
    }
    if (!isRoot && !fs.existsSync(targetDir)) {
      return res.status(400).json({ error: `Folder "${folder}" does not exist in vault` });
    }

    const files = await getFilesRecursively(targetDir, [], force, !isRoot);
    const sample = files.slice(0, 5).map(f => path.relative(currentConfig.vaultPath, f).replace(/\\/g, '/'));
    res.json({
      count: files.length,
      sample,
      folder: folder || 'Entire Vault',
      force
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/refine-vault', async (req, res) => {
  if (!currentConfig.vaultPath) return res.status(400).json({ error: 'Vault not set' });
  if (isProcessingRefineQueue) return res.status(400).json({ error: 'Refine already in progress' });
  
  const parseResult = RefineVaultSchema.safeParse(req.body || {});
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Validation error',
      details: parseResult.error.issues.map(e => ({ path: e.path.join('.'), message: e.message }))
    });
  }

  const { force, dryRun, folder, smartRename } = parseResult.data;
  
  try {
    const isRoot = !folder || folder === '.' || folder === 'Whole Vault' || folder === 'Entire Vault' || folder === '';
    const targetDir = isRoot ? currentConfig.vaultPath : path.join(currentConfig.vaultPath, folder);
    if (!isPathInsideVault(targetDir, currentConfig.vaultPath, true)) {
      return res.status(400).json({ error: 'Target folder must be inside vault' });
    }
    if (!isRoot && !fs.existsSync(targetDir)) {
      return res.status(400).json({ error: `Folder "${folder}" does not exist in vault` });
    }

    const files = await getFilesRecursively(targetDir, [], force, !isRoot);
    currentVaultStructure = await getExistingFolders(currentConfig.vaultPath);
    refineQueue.length = 0; // Clear existing
    for (const file of files) {
      refineQueue.push({ filePath: file, retryCount: 0 });
    }
    refineTotal = files.length;
    refineCompleted = 0;
    currentRefineDryRun = dryRun;
    currentRefineSmartRename = smartRename !== undefined ? smartRename : true;
    currentRefineSession = dryRun ? null : createSnapshotSession(currentConfig.vaultPath);

    const scopeLabel = folder ? `Folder: ${folder}` : 'Entire Vault';
    addLog(`Started Vault Refinement [${scopeLabel}] (${dryRun ? 'DRY-RUN' : force ? 'Force: all notes' : 'Incremental'}): queued ${files.length} files.`, 'info');
    
    processRefineQueue();
    res.json({
      message: `Started refining ${files.length} files (${scopeLabel}).`,
      total: files.length,
      folder: folder || null,
      smartRename: currentRefineSmartRename,
      force,
      dryRun
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/vault/purge-ghosts', async (req, res) => {
  if (!currentConfig.vaultPath) {
    return res.status(400).json({ error: 'Obsidian vault path is not configured' });
  }

  const { folder, dryRun } = req.body || {};
  const isRoot = !folder || folder === '.' || folder === 'Whole Vault' || folder === 'Entire Vault' || folder === '';
  const targetDir = isRoot ? currentConfig.vaultPath : path.join(currentConfig.vaultPath, folder);

  if (!isPathInsideVault(targetDir, currentConfig.vaultPath, true)) {
    return res.status(400).json({ error: 'Target directory must be inside vault' });
  }
  if (!isRoot && !fs.existsSync(targetDir)) {
    return res.status(400).json({ error: `Directory "${folder}" does not exist in vault` });
  }

  try {
    const ghostNotes: Array<{
      filePath: string;
      relativePath: string;
      filename: string;
      reason: string;
      sizeBytes: number;
    }> = [];

    async function scanDirectory(currentDir: string) {
      let entries: fs.Dirent[] = [];
      try {
        entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (
          entry.name.startsWith('.') ||
          entry.name === '99_System' ||
          entry.name === 'node_modules' ||
          entry.name.toLowerCase() === 'templates'
        ) {
          continue;
        }

        const fullPath = path.join(currentDir, entry.name);
        const relPath = path.relative(currentConfig.vaultPath, fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          await scanDirectory(fullPath);
        } else if (entry.isFile()) {
          const lower = entry.name.toLowerCase();
          try {
            const stat = await fsPromises.stat(fullPath);
            if (stat.size === 0) {
              ghostNotes.push({
                filePath: fullPath,
                relativePath: relPath,
                filename: entry.name,
                reason: 'Zero-byte empty file',
                sizeBytes: 0
              });
              continue;
            }

            if (lower.endsWith('.md')) {
              const content = await fsPromises.readFile(fullPath, 'utf-8');
              const parsed = parseNote(content);
              const ghost = checkGhostNote(parsed.body);
              if (ghost.isGhost) {
                ghostNotes.push({
                  filePath: fullPath,
                  relativePath: relPath,
                  filename: entry.name,
                  reason: ghost.reason,
                  sizeBytes: stat.size
                });
              }
            }
          } catch {}
        }
      }
    }

    await scanDirectory(targetDir);

    if (dryRun) {
      return res.json({
        totalFound: ghostNotes.length,
        dryRun: true,
        files: ghostNotes
      });
    }

    if (ghostNotes.length === 0) {
      return res.json({
        purgedCount: 0,
        files: [],
        message: 'No empty ghost notes found.'
      });
    }

    // 1-Click Rollback protection: Create snapshot session
    const session = createSnapshotSession(currentConfig.vaultPath);
    const trashBase = path.join(
      currentConfig.vaultPath,
      '99_System',
      '_trash',
      'ghost_notes',
      session.sessionId
    );
    await fsPromises.mkdir(trashBase, { recursive: true });

    for (const g of ghostNotes) {
      await session.backup(g.filePath);
      const destTrash = path.join(trashBase, `${path.basename(g.filePath)}`);
      await fsPromises.rename(g.filePath, destTrash).catch(async () => {
        await fsPromises.copyFile(g.filePath, destTrash);
        await fsPromises.unlink(g.filePath).catch(() => null);
      });
    }

    addLog(
      `[Hygiene Purge] Safely purged ${ghostNotes.length} empty ghost notes to 99_System/_trash/ghost_notes/${session.sessionId}. Undo snapshot created.`,
      'success'
    );

    res.json({
      purgedCount: ghostNotes.length,
      snapshotId: session.sessionId,
      files: ghostNotes,
      message: `Successfully purged ${ghostNotes.length} empty ghost notes to safe trash backup.`
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

async function processRefineQueue() {
  if (isProcessingRefineQueue || isShuttingDown) return;
  isProcessingRefineQueue = true;

  while (refineQueue.length > 0 && !isShuttingDown) {
    const item = refineQueue.shift();
    if (!item) break;
    
    try {
      await fsPromises.access(item.filePath);
    } catch {
      continue; // File deleted
    }

    try {
      await refineFile(item.filePath, {
        dryRun: currentRefineDryRun,
        snapshot: currentRefineSession || undefined,
        smartRename: currentRefineSmartRename
      });
      refineCompleted++;
    } catch (err: any) {
      addLog(`Error refining ${path.basename(item.filePath)}: ${err.message}`, 'error');
      // Retry logic
      if (item.retryCount < 1) {
        setTimeout(() => {
          refineQueue.push({ filePath: item.filePath, retryCount: item.retryCount + 1 });
          processRefineQueue();
        }, 5000);
      }
    }
  }

  isProcessingRefineQueue = false;
  if (refineQueue.length === 0 && refineTotal > 0) {
    if (currentRefineDryRun) {
      addLog('Vault Refinement DRY-RUN Complete (no files were modified).', 'success');
    } else {
      if (currentConfig.vaultPath && fs.existsSync(currentConfig.vaultPath)) {
        try {
          const swept = await pruneEmptyDirectories(currentConfig.vaultPath, currentConfig.vaultPath);
          if (swept.length > 0) {
            addLog(`Pruned ${swept.length} empty folder(s) left after file moves.`, 'info');
          }
        } catch {}
      }
      addLog(`Vault Refinement Complete. Backups saved to: 99_System/_refine_backup/${currentRefineSession?.sessionId || ''}`, 'success');
    }
    currentRefineSession = null;
    currentRefineDryRun = false;
  }
}

const RefineNoteOutputSchema = z.object({
  improved_title: z.string().optional(),
  improved_tags: z.preprocess(
    (val) => (typeof val === 'string' ? val.split(',').map(s => s.trim()).filter(Boolean) : Array.isArray(val) ? val : []),
    z.array(z.string()).default([])
  ),
  suggested_path: z.string().optional()
});

const ProcessInboxOutputSchema = z.object({
  title: z.string().min(1),
  summary: z.string().optional().default(''),
  category: z.string().min(1),
  tags: z.preprocess(
    (val) => (typeof val === 'string' ? val.split(',').map(s => s.trim()).filter(Boolean) : Array.isArray(val) ? val : []),
    z.array(z.string()).default([])
  ),
  related_concepts: z.preprocess(
    (val) => (typeof val === 'string' ? val.split(',').map(s => s.trim()).filter(Boolean) : Array.isArray(val) ? val : []),
    z.array(z.string()).optional().default([])
  )
});

async function fastFallbackRefine(filename: string, body: string): Promise<z.infer<typeof RefineNoteOutputSchema>> {
  const microSnippet = safeSlice(body, 0, 700);
  const lang = detectDocumentLanguage(body, filename);
  const microPrompt = `You are a taxonomy classifier. Classify this note into a PARA folder and generate 5 tags.
Document Language: ${lang.primary}
Filename: ${filename}
Content:
${microSnippet}

Return ONLY raw JSON with these 2 fields (no explanation, no markdown):
{
  "improved_tags": ["${lang.primary}", "tag2", "tag3"],
  "suggested_path": "03_Knowledge/Topics"
}`;

  return await generateStructured({
    endpointUrl: currentConfig.llamaUrl,
    messages: [{ role: 'user', content: microPrompt }],
    schema: RefineNoteOutputSchema,
    schemaName: 'refine_fallback_schema',
    timeoutMs: 90000,
    temperature: 0.1,
    maxTokens: 200
  });
}

export async function refineFile(filePath: string, options?: { dryRun?: boolean; snapshot?: SnapshotSession; smartRename?: boolean }) {
  const originalFilename = path.basename(filePath);
  addLog(`Refining file: ${originalFilename}`);

  const content = await fsPromises.readFile(filePath, 'utf-8');
  const parsedNote = parseNote(content);
  const body = parsedNote.body;

  // Resource Safeguard: Detect ghost notes with zero actual body content before running LLM inference
  const ghostCheck = checkGhostNote(body);
  if (ghostCheck.isGhost || body.trim().length === 0) {
    addLog(`[Ghost Note Skipped] "${originalFilename}" has zero actual body text (${ghostCheck.reason}). Skipping LLM inference to conserve system resources.`, 'warn');
    return;
  }
  
  // Extract all existing tags (from frontmatter and inline), capped at 15 for prompt to prevent HTTP 400 context overflow on tag-taxonomy files
  const existingFrontmatterStr = parsedNote.hadFrontmatter ? serializeNote(parsedNote.data, '') : '';
  const existingTags = extractTags(existingFrontmatterStr, body, originalFilename);
  const promptTags = existingTags.slice(0, 15);
  const existingTagsStr =
    promptTags.length > 0
      ? promptTags.map(t => `#${t}`).join(', ') +
        (existingTags.length > 15 ? ` (+${existingTags.length - 15} more)` : '')
      : 'None';
  
  const currentRelPath = path.relative(currentConfig.vaultPath, path.dirname(filePath)).replace(/\\/g, '/');

  // Optimize prompt length to keep inference fast on local LLMs and strictly protect surrogate pairs
  const maxChars = currentConfig.maxContextChars || 1500;
  const textToProcess = safeTruncateHeadTail(body, maxChars, 0.75);

  // Jev-Style Decision Model integration (Two-Tier Hierarchical Classification & Routing, D-LIVE)
  let decisionGuidance = '';
  let hierarchicalRouteResult: Awaited<ReturnType<typeof routeHierarchical>> | null = null;
  if ((currentConfig.enableDecisionModel || currentConfig.decisionMode === 'fast_routing') && currentConfig.decisionModelUrl) {
    const isJevOnline = await isDecisionServerReachable(currentConfig.decisionModelUrl, 1000);
    if (!isJevOnline) {
      // Quietly skip without latency penalty
    } else {
      try {
        const routerConfig = await buildRouterConfig(currentConfig);
        const noteTitle = (parsedNote.data.title as string) || originalFilename.replace(/\.md$/i, '');
        const routeResult = await routeHierarchical(
          body,
          originalFilename,
          noteTitle,
          routerConfig,
          { timeoutMs: 10000 }
        );
        hierarchicalRouteResult = routeResult;

        addLog(
          `[Jev Decision] Hierarchical Route for "${originalFilename}": ${routeResult.level1Category} (${Math.round(routeResult.level1Confidence * 100)}%) -> "${routeResult.suggestedFolder}" (${Math.round(routeResult.totalConfidence * 100)}% total conf)`,
          'info'
        );

        // Check if confidence is ambiguous -> enqueue into Triage with 3 distinct candidate folders
        if (routeResult.needsReview) {
          addLog(
            `[Jev Decision] Ambiguous confidence (${Math.round(routeResult.totalConfidence * 100)}% < ${Math.round(routerConfig.threshold * 100)}%). Queued for Triage Review.`,
            'warn'
          );
          const candidateFolderSet = new Set<string>();
          const addCandidate = (folderOrOpt: string) => {
            const mapped = routerConfig.typeRoutes[folderOrOpt] || folderOrOpt;
            if (mapped && mapped.trim()) candidateFolderSet.add(mapped.trim());
          };
          addCandidate(routeResult.suggestedFolder);
          if (routeResult.level2Selection && routeResult.level2Selection !== routeResult.level1Category) {
            addCandidate(routeResult.level2Selection);
          }
          for (const fallbackRoute of Object.values(routerConfig.typeRoutes)) {
            if (candidateFolderSet.size >= 3) break;
            addCandidate(fallbackRoute);
          }
          const distinctCandidates = Array.from(candidateFolderSet).slice(0, 3);
          const distribution = distinctCandidates.map((opt, idx) => ({
            letter: String.fromCharCode(65 + idx),
            option: opt,
            probability:
              idx === 0
                ? routeResult.totalConfidence
                : Math.max(0.1, Math.round(((1 - routeResult.totalConfidence) / Math.max(1, distinctCandidates.length - 1)) * 100) / 100)
          }));

          decisionTriageQueue = decisionTriageQueue.filter(q => q.filePath !== filePath);
          decisionTriageQueue.unshift({
            id: `triage_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            filePath,
            relativePath: currentRelPath,
            filename: originalFilename,
            contentType: routeResult.level1Category,
            confidence: routeResult.totalConfidence,
            topFolder: routeResult.suggestedFolder,
            distribution,
            timestamp: new Date().toISOString()
          });
          if (decisionTriageQueue.length > 100) decisionTriageQueue.pop();
          triageManager.enqueue(
            {
              filePath,
              relativePath: currentRelPath,
              filename: originalFilename,
              contentType: routeResult.level1Category,
              confidence: routeResult.totalConfidence,
              topFolder: routeResult.suggestedFolder,
              distribution
            },
            routerConfig.typeRoutes
          );
        }

        // If in Fast-Routing mode and high confidence: route immediately without waiting for generative LLM!
        if (currentConfig.decisionMode === 'fast_routing' && routeResult.isHighConfidence) {
          const targetDir = path.join(currentConfig.vaultPath, routeResult.suggestedFolder);
          if (!isPathInsideVault(targetDir, currentConfig.vaultPath)) {
            throw new Error(`Security Error: Target folder "${routeResult.suggestedFolder}" is outside vault.`);
          }

          addLog(
            `[Jev Fast-Route] High confidence (${Math.round(routeResult.totalConfidence * 100)}%). Routing directly to "${routeResult.suggestedFolder}"${routeResult.projectLink ? ` with project=${routeResult.projectLink}` : ''} without generative latency.`,
            'success'
          );

          if (!options?.dryRun) {
            if (options?.snapshot) {
              await options.snapshot.backup(filePath);
            }
            const oldDir = path.dirname(filePath);
            parsedNote.data.ai_refined = true;
            (parsedNote.data as any).ai_content_type = routeResult.level1Category;
            if (routeResult.projectLink) {
              parsedNote.data.project = routeResult.projectLink;
            }
            const finalFileContent = serializeNote(parsedNote.data, parsedNote.body);
            await fsPromises.mkdir(targetDir, { recursive: true });
            const destPath = path.join(targetDir, originalFilename);
            if (!isPathInsideVault(destPath, currentConfig.vaultPath)) {
              throw new Error(`Security Error: Destination path "${destPath}" is outside vault.`);
            }
            await fsPromises.writeFile(filePath, finalFileContent, 'utf-8');
            if (path.resolve(filePath) !== path.resolve(destPath)) {
              await fsPromises.rename(filePath, destPath);
              triageManager.syncRefinedFile(filePath, destPath, routeResult.suggestedFolder, originalFilename);
              await pruneEmptyParentDirs(currentConfig.vaultPath, oldDir);
            }
          }
          return;
        }

        if (routeResult.isHighConfidence) {
          decisionGuidance = `\n### JEV-STYLE DECISION GUIDANCE (CALIBRATED GROUND TRUTH):\n- Detected Category: ${routeResult.level1Category} (${Math.round(routeResult.level1Confidence * 100)}% confidence)\n- Suggested Folder: ${routeResult.suggestedFolder} (${Math.round(routeResult.totalConfidence * 100)}% confidence)\n- Selection Detail: ${routeResult.level2Selection} (${Math.round(routeResult.level2Confidence * 100)}% confidence)${routeResult.projectLink ? `\n- Project Link: ${routeResult.projectLink} (Non-core project note: keep in genre folder '${routeResult.suggestedFolder}')` : ''}\nPrioritize placing this note into '${routeResult.suggestedFolder}'.`;
        } else {
          decisionGuidance = `\n### JEV-STYLE DECISION GUIDANCE (LOW-CONFIDENCE HINT — ${Math.round(routeResult.totalConfidence * 100)}%):\n- Candidate Category: ${routeResult.level1Category} (${Math.round(routeResult.level1Confidence * 100)}% confidence)\n- Candidate Folder: ${routeResult.suggestedFolder} (${Math.round(routeResult.totalConfidence * 100)}% confidence)\nConfidence is below the ${Math.round(routerConfig.threshold * 100)}% threshold; verify carefully against the note content and choose the most accurate PARA folder.`;
        }
      } catch (decisionErr: any) {
        addLog(`Decision model check skipped: ${decisionErr.message}`, 'warn');
      }
    }
  }

  const projectsList = await loadProjectsRegistry(currentConfig.vaultPath);
  const projectsRoot = await detectProjectsRootFolder(currentConfig.vaultPath);
  const discoveredProjectsHint =
    projectsList.length > 0
      ? `\n   - Discovered Projects in this Vault: ${projectsList.map(p => `'${p.folder}' (aliases: ${p.aliases.slice(0, 3).join(', ')})`).join('; ')}.\n   - NEVER assign a note to any of these project folders unless that project is explicitly mentioned in the note!`
      : `\n   - Place project notes in '${projectsRoot}/<ProjectName>' only if a specific project name is explicitly stated in the note.`;

  // Degraded fallback mode without high-confidence decision model: pass balanced folder list across all vault roots
  let existingFoldersContext = '';
  if ((!decisionGuidance || (hierarchicalRouteResult && !hierarchicalRouteResult.isHighConfidence)) && currentVaultStructure.length > 0) {
    const nonProjects = currentVaultStructure.filter(f => !f.toLowerCase().startsWith(projectsRoot.toLowerCase() + '/'));
    const projectsSample = currentVaultStructure.filter(f => f.toLowerCase().startsWith(projectsRoot.toLowerCase() + '/')).slice(0, 10);
    const sampleFolders = [...projectsSample, ...nonProjects.slice(0, 15)];
    existingFoldersContext = "\nEXISTING FOLDERS IN VAULT (Discovered dynamically from connected Vault):\n- " + sampleFolders.join("\n- ");
  }

  // Static instructions placed first so llama-server reuses the KV-cache prefix across consecutive notes
  const prompt = `You are an expert semantic taxonomist organizing an Obsidian knowledge vault using the connected vault's hierarchy.
Carefully analyze the NOTE INFORMATION, EXISTING TAGS, and CONTENT to classify it with flawless precision.

### TITLE GUIDELINES & LANGUAGE RULES (STRICT):
- Distill a concise, clean, and elegant human title (2 to 5 words).
- LANGUAGE MATCHING RULE: The language of the title MUST STRICTLY MATCH the language of the document text!
  * If the document text is in Russian -> the title MUST be in Russian. NEVER translate Russian notes to English!
  * If the document text is in English -> the title MUST be in English.
- Remove noise prefixes, timestamps, dates, raw indices, and verbose clauses.
- Preserve series numbers and uppercase project acronyms/identifiers.
- If current filename is already clean and concise, keep it.

### STRICT TAXONOMY & CLASSIFICATION RULES:
1. CONTENT-TYPE ROUTING (DEFAULT FOR GENERAL KNOWLEDGE):
   - Technical specifications, system prompts, AI agents, APIs, code, configs -> '03_Knowledge/Technical'
   - Meeting agendas, theses for meetings, transcripts, dialogues, interviews -> '03_Knowledge/Dialogues'
   - Essays, philosophical reflections, analytical articles -> '03_Knowledge/Essays'
   - Poems / Verses -> '03_Knowledge/Poems'
   - Songs / Lyrics / Music tracks -> '03_Knowledge/Songs'
   - Fiction movie scripts, screenplays, quest narratives -> '03_Knowledge/Scripts'
   - Raw ideas, product innovations, brainstorms -> '05_Ideas/Inbox'
   - Daily logs / Journal entries -> '04_Journal/Daily'
   - Personal finance / Health / Operations -> '02_Areas/<AreaName>'
2. SPECIFIC PROJECTS (ONLY WHEN EXPLICITLY MENTIONED IN TEXT OR TITLE):
   - Place in '${projectsRoot}/<ExactProjectName>' ONLY if the note is an active project plan, roadmap, or explicitly names a specific project in its title or text!${discoveredProjectsHint}
   - General project lists or roadmaps without a specific brand name -> '${projectsRoot}/Active'.
3. FOLDER REUSE & CONSOLIDATION:
   - Avoid creating new near-duplicate folders. Match existing vault folders where possible.
   - Max depth is 2-3 levels (e.g., '03_Knowledge/Essays' or '${projectsRoot}/ProjectName').
${existingFoldersContext}

### ORTHOGONAL MULTI-LEVEL TAGGING RULES (L0-L7) & MANDATORY LANGUAGE TAG:
- MANDATORY LANGUAGE TAG: Include the language code ("ru", "en", or "ph") in improved_tags.
- CLEAN ATOMIC TAGS ONLY (NO SLASHES '/'): NEVER use "/" in tags! Every tag must be a clean, flat word or hyphenated term.
- Assign 4 to 7 structured ORTHOGONAL TAXONOMY tags that answer:
  * L1 TYPE (what is it?): e.g. "project", "research", "whitepaper", "scenario", "idea", "task", "meeting", "concept", "protocol", "reference"
  * L2 DOMAIN (what field?): e.g. "AI", "agents", "LLM", "semantics", "hypergraph", "knowledge-management", "software", "philosophy", "film", "transmedia", "business", "economy"
  * L3 PROJECT / RESEARCH (if applicable): e.g. "<ProjectName>", "Hermes", "Neuromicon", "UUCPFF", "semantic-hypergraph", "JeV-response"
  * L4 SYSTEM / CONCEPT (function): e.g. "agent-orchestration", "routing", "classification", "tagging", "semantic-ingestion", "World-1149"
  * KNOWLEDGE AXIS (epistemic role): e.g. "model", "hypothesis", "specification", "decision", "fact"
  * L5 STATUS & L7 STAGE: e.g. "active", "idea", "prototype", "design", "implementation", "validation"
  * L6 PRIORITY (optional): "P0", "P1", "P2", "P3"
- NEVER generate random alphanumeric codes like "#01G23" or numbers.
${decisionGuidance}

### NOTE INFORMATION:
- Filename: ${originalFilename}
- Current Folder: ${currentRelPath || 'Root'}
- Existing Tags: ${existingTagsStr}
- Content Snippet:
${textToProcess}

Return ONLY raw JSON with these 3 fields (no markdown fences, no commentary):
{
  "improved_title": "Clean Human Title (2-5 words)",
  "improved_tags": ["ru", "research", "AI", "active"],
  "suggested_path": "03_Knowledge/Essays"
}`;

  const timeoutMs = (currentConfig.timeoutSeconds || 240) * 1000;
  let data: z.infer<typeof RefineNoteOutputSchema>;
  try {
    data = await generateStructured({
      endpointUrl: currentConfig.llamaUrl,
      messages: [{ role: 'user', content: prompt }],
      schema: RefineNoteOutputSchema,
      schemaName: 'refine_note_schema',
      timeoutMs,
      temperature: 0.1,
      maxTokens: 280
    });
  } catch (llmError: any) {
    const isRecoverableWithCompactFallback =
      llmError.message?.includes('canceled') ||
      llmError.message?.includes('aborted') ||
      llmError.message?.includes('timeout') ||
      llmError.message?.includes('status code 400') ||
      llmError.message?.includes('context');
    if (isRecoverableWithCompactFallback) {
      addLog(
        `Primary prompt failed (${llmError.message}) on ${originalFilename}. Attempting quick compact fallback...`,
        'warn'
      );
      try {
        data = await fastFallbackRefine(originalFilename, body);
      } catch (fbErr: any) {
        throw new Error(`LLM Refine Request failed and compact fallback failed: ${fbErr.message}`);
      }
    } else {
      throw llmError;
    }
  }

  const newTags = Array.isArray(data.improved_tags) ? data.improved_tags : [];
  // Strictly sanitize LLM-generated tags to reject any non-word codes like #01G23
  const parsedNewTags = sanitizeTagList(newTags, { allowSingleLetter: false });
  
  // Enforce language tags (e.g. #ru, #en, #ph)
  const tagsWithLanguage = ensureLanguageTags(parsedNewTags, body, originalFilename);
  mergeTags(parsedNote.data, tagsWithLanguage);
  parsedNote.data.ai_refined = true;
  if (hierarchicalRouteResult?.projectLink && (hierarchicalRouteResult.isHighConfidence || hierarchicalRouteResult.level1Confidence >= 0.75)) {
    parsedNote.data.project = hierarchicalRouteResult.projectLink;
  }

  // Determine refined filename (Smart Renaming with identifier & series protection)
  let targetFilename = originalFilename;
  const smartRenameEnabled = options?.smartRename !== false;
  if (smartRenameEnabled && data.improved_title) {
    let cleanTitle = sanitizeTitle(data.improved_title, originalFilename);
    // Enforce title language strictly matches document content language
    cleanTitle = enforceTitleLanguage(cleanTitle, body, originalFilename);
    // Protect series numbers and explicit project acronyms
    cleanTitle = preserveMeaningfulTitle(cleanTitle, originalFilename);
    if (cleanTitle && cleanTitle !== 'Untitled_Document') {
      targetFilename = `${cleanTitle}.md`;
      parsedNote.data.title = cleanTitle;
    }
  }

  const combinedTags = (parsedNote.data.tags as string[]) || [];
  const finalFileContent = serializeNote(parsedNote.data, parsedNote.body);

  let suggestedPath = validateAndSanitizeRoute({
    llmSuggestedPath: data.suggested_path || '03_Knowledge/Unsorted',
    originalFilename,
    noteTitle: String(parsedNote.data.title || targetFilename.replace(/\.md$/i, '')),
    noteBody: body,
    existingTags: combinedTags,
    projects: projectsList,
    jevResult: hierarchicalRouteResult,
    typeRoutes: currentConfig.typeRoutes,
    projectsRoot
  });
  
  // Clean up path separators and extensions
  suggestedPath = suggestedPath.replace(/\\/g, '/').replace(/^\/+/g, '').replace(/\/+$/g, '');
  if (suggestedPath.toLowerCase().endsWith('.md')) {
    suggestedPath = path.dirname(suggestedPath);
  }
  
  // Security: Prevent directory traversal
  if (suggestedPath.includes('..') || !suggestedPath) {
    suggestedPath = '03_Knowledge/Unsorted';
  }

  const newTagsToAdd = parsedNewTags.filter((t: string) => !existingTags.map(e => e.toLowerCase()).includes(t.toLowerCase()));
  const moveTarget = path.join(suggestedPath, targetFilename).replace(/\\/g, '/');
  const tagsStr = newTagsToAdd.length > 0 ? `+[${newTagsToAdd.join(', ')}]` : '+[]';

  if (options?.dryRun) {
    addLog(`[DRY-RUN] ${originalFilename}: tags ${tagsStr}, target → ${moveTarget}`, 'info');
    return;
  }

  // Backup original file before any write or move operations
  if (options?.snapshot) {
    await options.snapshot.backup(filePath);
  }

  const destDir = path.join(currentConfig.vaultPath, suggestedPath);
  if (!isPathInsideVault(destDir, currentConfig.vaultPath)) {
    throw new Error(`Security Error: Target folder "${suggestedPath}" is outside vault.`);
  }
  const destMdPath = path.join(destDir, targetFilename);
  const oldDir = path.dirname(filePath);

  // Write content to current file first
  await fsPromises.mkdir(destDir, { recursive: true });
  await fsPromises.writeFile(filePath, finalFileContent, 'utf-8');
  
  // --- Deduplication Check: Prevent collision duplicates (e.g. Note 1.md, Note 2.md) ---
  const baseInfo = parseBaseTitle(targetFilename);
  const normCurrent = getNormalizedBody(finalFileContent);

  // 1. If this file is a numbered copy (e.g. "Note 1.md"), check if clean base note "Note.md" exists
  if (baseInfo.numberSuffix !== null) {
    const baseFilename = `${baseInfo.base}.md`;
    const candidatePaths = [
      path.join(destDir, baseFilename),
      path.join(path.dirname(filePath), baseFilename)
    ];
    for (const baseCandidate of candidatePaths) {
      if (fs.existsSync(baseCandidate) && path.resolve(baseCandidate) !== path.resolve(filePath)) {
        try {
          const baseContent = await fsPromises.readFile(baseCandidate, 'utf-8');
          const normBase = getNormalizedBody(baseContent);
          if (normBase && (normBase === normCurrent || computeWordSimilarity(normBase, normCurrent) >= 80)) {
            if (options?.snapshot) {
              await options.snapshot.backup(baseCandidate);
            }
            const mergedContent = mergeTagsIntoFrontmatter(baseContent, combinedTags);
            await fsPromises.writeFile(baseCandidate, mergedContent, 'utf-8');
            await safeArchiveDuplicate(filePath, baseCandidate);
            triageManager.syncRefinedFile(filePath, baseCandidate, suggestedPath, baseFilename);
            await pruneEmptyParentDirs(currentConfig.vaultPath, oldDir);
            addLog(`Deduplicated: "${originalFilename}" merged into canonical "${baseFilename}". Removed duplicate copy.`, 'success');
            return;
          }
        } catch (e) {}
      }
    }
  }

  // 2. If moving to destMdPath and destination already exists
  if (path.resolve(filePath) !== path.resolve(destMdPath) && fs.existsSync(destMdPath)) {
    try {
      const destContent = await fsPromises.readFile(destMdPath, 'utf-8');
      const normDest = getNormalizedBody(destContent);
      if (normDest && (normDest === normCurrent || computeWordSimilarity(normDest, normCurrent) >= 80)) {
        if (options?.snapshot) {
          await options.snapshot.backup(destMdPath);
        }
        const mergedContent = mergeTagsIntoFrontmatter(destContent, combinedTags);
        await fsPromises.writeFile(destMdPath, mergedContent, 'utf-8');
        await safeArchiveDuplicate(filePath, destMdPath);
        triageManager.syncRefinedFile(filePath, destMdPath, suggestedPath, targetFilename);
        await pruneEmptyParentDirs(currentConfig.vaultPath, oldDir);
        addLog(`Deduplicated: Target "${suggestedPath}/${targetFilename}" already exists with identical content. Merged tags and removed duplicate.`, 'success');
        return;
      }
    } catch (e) {}
  }

  // Move or rename file if path changed
  if (path.resolve(filePath) !== path.resolve(destMdPath)) {
    // Handle collisions
    let counter = 1;
    let finalDestPath = destMdPath;
    let finalFilename = targetFilename;
    while (fs.existsSync(finalDestPath) && path.resolve(finalDestPath) !== path.resolve(filePath)) {
        const ext = path.extname(targetFilename);
        const name = path.basename(targetFilename, ext);
        finalFilename = `${name} ${counter}${ext}`;
        finalDestPath = path.join(destDir, finalFilename);
        counter++;
    }
    
    if (fs.existsSync(finalDestPath) && options?.snapshot && path.resolve(finalDestPath) !== path.resolve(filePath)) {
      await options.snapshot.backup(finalDestPath);
    }
    
    await fsPromises.rename(filePath, finalDestPath);
    triageManager.syncRefinedFile(filePath, finalDestPath, suggestedPath, finalFilename);
    await pruneEmptyParentDirs(currentConfig.vaultPath, oldDir);
    if (originalFilename !== finalFilename) {
      addLog(`Refined & Renamed: "${originalFilename}" → "${suggestedPath}/${finalFilename}" (${tagsStr})`, 'success');
    } else {
      addLog(`Refined: "${originalFilename}" → "${suggestedPath}/" (${tagsStr})`, 'success');
    }
  } else {
    addLog(`Refined in place: "${originalFilename}" (${tagsStr})`, 'success');
  }
}


// --- Graceful Shutdown ---
async function gracefulShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  addLog('Initiating graceful shutdown...', 'info');
  if (watcher) await watcher.close();
  
  const startWait = Date.now();
  while (activeTasks > 0 && Date.now() - startWait < 130000) {
    await new Promise(r => setTimeout(r, 500));
  }
  addLog('Shutdown complete.', 'success');
  process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // addLog can't easily be used directly without a mock if we're outside, but wait, addLog is a global function in server.ts
  addLog(`Uncaught Exception: ${err.message}`, 'error');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  addLog(`Unhandled Rejection: ${reason}`, 'error');
});


// --- Main Processing Logic ---
export async function processFile(filePath: string) {
  const originalFilename = path.basename(filePath);
  const fileExtension = path.extname(originalFilename).toLowerCase();
  let parsedIncomingNote: ReturnType<typeof parseNote> | null = null;
  
  const textExtensions = ['.md', '.txt', '.csv', '.rtf', '.html', '.json', '.xml', '.py', '.js', '.ts', '.yaml', '.yml'];
  const pdfExtensions = ['.pdf'];
  const docxExtensions = ['.docx'];
  
  const isText = textExtensions.includes(fileExtension);
  const isPdf = pdfExtensions.includes(fileExtension);
  const isDocx = docxExtensions.includes(fileExtension);
  const isBinary = !isText && !isPdf && !isDocx;
  
  addLog(`Processing file: ${filePath}`);
  
  const stats = await fsPromises.stat(filePath);
  if (stats.size === 0) {
    const err = new Error('File is empty.');
    (err as any).isRetriable = false;
    throw err;
  }

  let textToProcess = '';     
  let fullConvertedText = ''; 
  
  if (isBinary) {
     textToProcess = `[Binary file. Classify based on filename: ${originalFilename}]`;
  } else if (isPdf) {
    try {
      const dataBuffer = await fsPromises.readFile(filePath);
      const pdfData: any = await withTimeout(pdfParse(dataBuffer), 30000, 'PDF Parsing');
      const text = pdfData.text || '';
      fullConvertedText = text;
      textToProcess = text.length <= 4000 ? text : text.slice(0, 4000) + '\n\n...[CONTENT OMITTED]...';
    } catch (err: any) {
      addLog(`Failed to parse PDF: ${err.message}. Falling back to filename.`, 'error');
      textToProcess = `[Error extracting text. Please classify based on filename: ${originalFilename}]`;
    }
  } else if (isDocx) {
    try {
      const result = await withTimeout(mammoth.convertToHtml({ path: filePath }), 30000, 'DOCX Parsing');
      const html = result.value || '';
      const mdText = turndownService.turndown(html);
      fullConvertedText = mdText;
      textToProcess = mdText.length <= 4000 ? mdText : mdText.slice(0, 4000) + '\n\n...[CONTENT OMITTED]...';
    } catch (err: any) {
      addLog(`Failed to parse DOCX: ${err.message}. Falling back to filename.`, 'error');
      textToProcess = `[Error extracting text. Please classify based on filename: ${originalFilename}]`;
    }
  } else {
    // Is Text/HTML/JSON
    try {
      let originalContent = await fsPromises.readFile(filePath, 'utf-8');
      
      let text = originalContent.replace(/\uFFFD/g, ''); 
      
      if (fileExtension === '.md') {
        parsedIncomingNote = parseNote(text);
        text = parsedIncomingNote.body;
        fullConvertedText = text;
      } else if (fileExtension === '.json') {
        try {
          const parsed = JSON.parse(text);
          if (parsed.textContent) {
            text = (parsed.title ? parsed.title + '\n\n' : '') + parsed.textContent;
          } else {
            const extractStrings = (obj: any): string => {
              if (typeof obj === 'string') return obj;
              if (Array.isArray(obj)) return obj.map(extractStrings).filter(Boolean).join('\n');
              if (typeof obj === 'object' && obj !== null) return Object.values(obj).map(extractStrings).filter(Boolean).join('\n');
              return '';
            };
            text = extractStrings(parsed);
          }
          fullConvertedText = text;
        } catch (e) {
          fullConvertedText = text;
        }
      } else if (fileExtension === '.html' || fileExtension === '.xml') {
        try {
          // Pre-emptively strip styles and scripts using robust regex before Turndown processes it
          let cleanHtml = text
             .replace(/<\?xml.*?\?>/gi, '')
             .replace(/<!DOCTYPE.*?>/gi, '')
             .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
             .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
             .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
             .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, ''); // Google Keep embeds giant inline SVGs
          text = turndownService.turndown(cleanHtml);
          fullConvertedText = text;
        } catch (e) {
          addLog(`turndown failed, using basic cleanup.`, 'error');
          let basicClean = text
             .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
             .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
             .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '');
          text = basicClean.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
          fullConvertedText = text;
        }
      } else {
         fullConvertedText = text;
      }
      
      if (fullConvertedText.length <= 3000) {
        textToProcess = sanitizeUnicode(fullConvertedText);
      } else {
        textToProcess = safeTruncateHeadTail(fullConvertedText, 3000, 0.75, '\n\n...[MIDDLE CONTENT OMITTED]...\n\n');
      }
    } catch (err: any) {
      addLog(`Failed to read file text: ${err.message}. Falling back to filename classification.`, 'error');
      textToProcess = `[Error reading text file. Classify based on filename: ${originalFilename}]`;
    }
  }

  // Pre-LLM Resource Safeguard: Never spend LLM inference tokens on empty files or ghost notes
  if (!isBinary && !isPdf && !isDocx) {
    const ghostCheck = checkGhostNote(fullConvertedText);
    if (ghostCheck.isGhost || fullConvertedText.trim().length === 0) {
      addLog(`[Ghost Note Rejected] "${originalFilename}" has zero actual body content (${ghostCheck.reason || 'Empty text'}). Zero LLM tokens spent. Quarantining.`, 'warn');
      const hash = await getFileHash(filePath);
      const targetRawFolder = path.join(currentConfig.vaultPath, '99_System', '_keep_raw', 'empty_ghosts');
      await fsPromises.mkdir(targetRawFolder, { recursive: true });
      const originalMovePath = path.join(targetRawFolder, `${hash}_${originalFilename}`);
      await fsPromises.rename(filePath, originalMovePath).catch(async () => {
        await fsPromises.copyFile(filePath, originalMovePath);
        await fsPromises.unlink(filePath).catch(() => null);
      });
      addLog(`Quarantined empty file to: 99_System/_keep_raw/empty_ghosts/${hash}_${originalFilename}`, 'info');
      return;
    }
  }
  
  // Extract any inline tags from content (cap at 15 in prompt to prevent context window overflow)
  const detectedTags = extractTags('', fullConvertedText, originalFilename);
  const detectedPromptTags = detectedTags.slice(0, 15);
  const detectedTagsStr =
    detectedPromptTags.length > 0
      ? detectedPromptTags.map(t => `#${t}`).join(', ') +
        (detectedTags.length > 15 ? ` (+${detectedTags.length - 15} more)` : '')
      : 'None';

  // Jev-Style Decision Model integration for incoming Inbox files (D-LIVE)
  let decisionGuidance = '';
  let inboxRouteResult: Awaited<ReturnType<typeof routeHierarchical>> | null = null;
  if ((currentConfig.enableDecisionModel || currentConfig.decisionMode === 'fast_routing') && currentConfig.decisionModelUrl) {
    const isJevOnline = await isDecisionServerReachable(currentConfig.decisionModelUrl, 1000);
    if (isJevOnline) {
      try {
        const routerConfig = await buildRouterConfig(currentConfig);
        const initialTitle =
          (parsedIncomingNote?.data?.title as string) || originalFilename.replace(/\.[^/.]+$/, '');
        const routeResult = await routeHierarchical(
          fullConvertedText,
          originalFilename,
          initialTitle,
          routerConfig,
          { timeoutMs: 10000 }
        );
        inboxRouteResult = routeResult;

        addLog(
          `[Jev Decision] Inbox Route for "${originalFilename}": ${routeResult.level1Category} -> "${routeResult.suggestedFolder}" (${Math.round(routeResult.totalConfidence * 100)}% conf)`,
          'info'
        );

        const currentRelPath = path.relative(currentConfig.vaultPath, path.dirname(filePath)).replace(/\\/g, '/');
        if (routeResult.needsReview) {
          const candidateFolderSet = new Set<string>();
          const addCandidate = (folderOrOpt: string) => {
            const mapped = routerConfig.typeRoutes[folderOrOpt] || folderOrOpt;
            if (mapped && mapped.trim()) candidateFolderSet.add(mapped.trim());
          };
          addCandidate(routeResult.suggestedFolder);
          if (routeResult.level2Selection && routeResult.level2Selection !== routeResult.level1Category) {
            addCandidate(routeResult.level2Selection);
          }
          for (const fallbackRoute of Object.values(routerConfig.typeRoutes)) {
            if (candidateFolderSet.size >= 3) break;
            addCandidate(fallbackRoute);
          }
          const distinctCandidates = Array.from(candidateFolderSet).slice(0, 3);
          const distribution = distinctCandidates.map((opt, idx) => ({
            letter: String.fromCharCode(65 + idx),
            option: opt,
            probability:
              idx === 0
                ? routeResult.totalConfidence
                : Math.max(0.1, Math.round(((1 - routeResult.totalConfidence) / Math.max(1, distinctCandidates.length - 1)) * 100) / 100)
          }));

          decisionTriageQueue = decisionTriageQueue.filter(q => q.filePath !== filePath);
          decisionTriageQueue.unshift({
            id: `triage_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            filePath,
            relativePath: currentRelPath,
            filename: originalFilename,
            contentType: routeResult.level1Category,
            confidence: routeResult.totalConfidence,
            topFolder: routeResult.suggestedFolder,
            distribution,
            timestamp: new Date().toISOString()
          });
          if (decisionTriageQueue.length > 100) decisionTriageQueue.pop();
          triageManager.enqueue(
            {
              filePath,
              relativePath: currentRelPath,
              filename: originalFilename,
              contentType: routeResult.level1Category,
              confidence: routeResult.totalConfidence,
              topFolder: routeResult.suggestedFolder,
              distribution
            },
            routerConfig.typeRoutes
          );
        }

        if (currentConfig.decisionMode === 'fast_routing' && routeResult.isHighConfidence) {
          const targetDir = path.join(currentConfig.vaultPath, routeResult.suggestedFolder);
          if (!isPathInsideVault(targetDir, currentConfig.vaultPath)) {
            throw new Error(`Security Error: Target folder "${routeResult.suggestedFolder}" is outside vault.`);
          }

          addLog(
            `[Jev Fast-Route] High confidence (${Math.round(routeResult.totalConfidence * 100)}%). Routing "${originalFilename}" directly to "${routeResult.suggestedFolder}" without generative LLM.`,
            'success'
          );

          const fastTitle = sanitizeTitle(initialTitle, originalFilename);
          const fastMdFilename = `${fastTitle}.md`;
          const tagsWithLang = ensureLanguageTags(detectedTags, fullConvertedText, originalFilename);
          const fastData: Record<string, unknown> = {
            ...(parsedIncomingNote?.data || {}),
            title: fastTitle,
            category: routeResult.suggestedFolder,
            tags: tagsWithLang,
            ai_refined: true,
            ai_processed: true,
            ai_content_type: routeResult.level1Category
          };
          if (routeResult.projectLink) {
            fastData.project = routeResult.projectLink;
          }

          await fsPromises.mkdir(targetDir, { recursive: true });
          const destPath = path.join(targetDir, fastMdFilename);
          if (!isPathInsideVault(destPath, currentConfig.vaultPath)) {
            throw new Error(`Security Error: Destination path "${destPath}" is outside vault.`);
          }
          const finalFastContent = serializeNote(fastData, fullConvertedText);
          await fsPromises.writeFile(destPath, finalFastContent, 'utf-8');
          if (path.resolve(filePath) !== path.resolve(destPath)) {
            await fsPromises.unlink(filePath).catch(() => null);
          }
          return;
        }

        decisionGuidance = `\n### JEV-STYLE DECISION GUIDANCE (CALIBRATED GROUND TRUTH):\n- Detected Category: ${routeResult.level1Category} (${Math.round(routeResult.level1Confidence * 100)}% confidence)\n- Suggested Folder: ${routeResult.suggestedFolder} (${Math.round(routeResult.totalConfidence * 100)}% confidence)\n- Selection Detail: ${routeResult.level2Selection} (${Math.round(routeResult.level2Confidence * 100)}% confidence)${routeResult.projectLink ? `\n- Project Link: ${routeResult.projectLink} (Non-core project note: keep in genre folder '${routeResult.suggestedFolder}')` : ''}\nPrioritize placing this note into '${routeResult.suggestedFolder}'.`;
      } catch (decisionErr: any) {
        addLog(`Decision model check skipped on Inbox file: ${decisionErr.message}`, 'warn');
      }
    }
  }

  addLog(`Sending to local LLM at ${currentConfig.llamaUrl}`);

  const inboxProjectsList = await loadProjectsRegistry(currentConfig.vaultPath);
  const inboxProjectsRoot = await detectProjectsRootFolder(currentConfig.vaultPath);
  const inboxProjectsPromptLines =
    inboxProjectsList.length > 0
      ? inboxProjectsList.map(p => `     * ${p.aliases[0] || p.id} -> '${p.folder}'`).join('\n')
      : `     * Named projects -> '${inboxProjectsRoot}/<ExactProjectName>'`;

  // Degraded fallback mode without decision model: only pass folder list when decisionGuidance is empty
  const existingFoldersContext = !decisionGuidance && currentVaultStructure.length > 0 
    ? "\nEXISTING FOLDERS IN VAULT (Discovered dynamically from connected Vault):\n- " + currentVaultStructure.slice(0, 30).join("\n- ") 
    : "";

  const prompt = `You are an expert semantic taxonomist organizing an Obsidian knowledge vault using the connected vault's hierarchy.
Analyze this new incoming file from the Inbox and classify it with flawless precision.
DO NOT output any markdown, explanations, or backticks. Return ONLY raw JSON.
${decisionGuidance}

### NOTE INFORMATION:
- Filename: ${originalFilename}
- Detected Tags: ${detectedTagsStr}
- Content Snippet:
${textToProcess}

### TITLE GUIDELINES & LANGUAGE RULES (CRITICAL):
- Distill a concise, clean, and elegant human title (2 to 5 words).
- LANGUAGE MATCHING RULE: The language of the title MUST STRICTLY MATCH the language of the document content!
  * If the document text is in Russian -> the title MUST be in Russian. NEVER translate Russian notes to English!
  * If the document text is in English -> the title MUST be in English.
- Do NOT simply repeat lengthy, clumsy filenames or voice recording artifacts.
- Remove dates, timestamps, voice recorder prefixes, and excessive subtitles.

### STRICT TAXONOMY & CLASSIFICATION RULES:
1. SPECIFIC PROJECTS (ONLY WHEN EXPLICITLY MENTIONED):
   - Notes belonging to a specific project discovered in this vault MUST go to their project folder ONLY if that project is explicitly mentioned in the note:
${inboxProjectsPromptLines}
2. CODE, APIS, SCRIPTS VS. FICTION SCENARIOS (CRITICAL):
   - Programming code, APIs, IT scripts, configs -> '03_Knowledge/Technical' OR specific '${inboxProjectsRoot}/<Name>'.
   - NEVER put programming code, APIs, project plans, business roadmaps, or announcements in '${inboxProjectsRoot}/Scenarios'!
   - '${inboxProjectsRoot}/Scenarios' or '03_Knowledge/Scripts' is STRICTLY for fiction movie scripts, theater screenplays, or storytelling quest narratives.
3. CONTENT-TYPES & TOPICS:
   - Transcripts / Dialogues / Interviews -> '03_Knowledge/Dialogues'
   - Essays / Deep articles / Philosophy -> '03_Knowledge/Essays'
   - Poems / Verses -> '03_Knowledge/Poems'
   - Songs / Lyrics / Tracks -> '03_Knowledge/Songs'
   - People / Contact profiles -> '02_Areas/People'
   - Organizations / Companies -> '02_Areas/Organizations'
   - Daily logs / Journals -> '04_Journal/Daily'
   - Raw ideas / Brainstorms -> '05_Ideas/Inbox'
${existingFoldersContext}

### TAGGING RULES & MANDATORY LANGUAGE TAG:
- MANDATORY LANGUAGE TAG: You MUST include the language code tag as the FIRST tag in tags:
  * "ru" if the document is in Russian
  * "en" if the document is in English
  * "ph" if the document is in Filipino / Tagalog
  * Include both "ru" and "en" if the document is significantly bilingual
- ONLY use real human words or hyphenated word phrases for tags! NEVER generate alphanumeric codes like "#01G23", numbers, or IDs.

Extract these exactly 5 fields in valid JSON format:
{
  "title": "Concise Distilled Title (2-5 words)",
  "summary": "1-2 sentence concise summary",
  "category": "${inboxProjectsRoot}/ExactFolderName",
  "tags": ["ru", "word-tag", "topic-tag"],
  "related_concepts": ["Concept 1", "Concept 2", "Concept 3"]
}`;

  const timeoutMs = (currentConfig.timeoutSeconds || 240) * 1000;
  let data: z.infer<typeof ProcessInboxOutputSchema>;

  try {
    data = await generateStructured({
      endpointUrl: currentConfig.llamaUrl,
      messages: [{ role: 'user', content: prompt }],
      schema: ProcessInboxOutputSchema,
      schemaName: 'process_inbox_schema',
      timeoutMs,
      temperature: 0.1,
      maxTokens: 350
    });
  } catch (llmError: any) {
    // C8: If LLM returned invalid JSON, empty output, or failed schema validation, quarantine to 00_Inbox/Review with review_reason
    if (
      llmError instanceof GenerationError &&
      !llmError.reviewReason.startsWith('llm_network_error') &&
      llmError.reviewReason !== 'llm_url_missing'
    ) {
      const reviewDir = path.join(currentConfig.vaultPath, '00_Inbox', 'Review');
      await fsPromises.mkdir(reviewDir, { recursive: true });
      const reviewTitle = sanitizeTitle(
        (parsedIncomingNote?.data?.title as string) || originalFilename.replace(/\.[^/.]+$/, ''),
        originalFilename
      );
      const reviewDestPath = path.join(reviewDir, `${reviewTitle}.md`);
      const reviewData: Record<string, unknown> = {
        ...(parsedIncomingNote?.data || {}),
        title: reviewTitle,
        review_reason: llmError.reviewReason,
        ai_processed: false
      };
      const reviewContent = serializeNote(reviewData, fullConvertedText);
      await fsPromises.writeFile(reviewDestPath, reviewContent, 'utf-8');
      if (path.resolve(filePath) !== path.resolve(reviewDestPath)) {
        await fsPromises.unlink(filePath).catch(() => null);
      }
      addLog(
        `[Review Quarantine] Moved "${originalFilename}" to 00_Inbox/Review (review_reason: ${llmError.reviewReason})`,
        'warn'
      );
      return;
    }
    throw llmError;
  }
  
  // Routing
  const rawCategory = (data.category || '').trim();
  let destFolder = path.join('00_Inbox', 'Processed'); 
  
  if (rawCategory.startsWith('0') || rawCategory.includes('/')) {
    let cleaned = rawCategory.replace(/\\/g, '/').replace(/^\/+/g, '').replace(/\/+$/g, '');
    if (cleaned.toLowerCase().endsWith('.md')) cleaned = path.dirname(cleaned);
    if (!cleaned.includes('..') && cleaned) {
      destFolder = cleaned;
    }
  } else if (rawCategory === 'People') destFolder = path.join('02_Areas', 'People');
  else if (rawCategory === 'Organizations') destFolder = path.join('02_Areas', 'Organizations');
  else if (rawCategory === 'Knowledge') destFolder = path.join('03_Knowledge', 'Topics');
  else if (rawCategory === 'Projects') destFolder = path.join('01_Projects', 'Active');
  else if (rawCategory === 'Journal') destFolder = path.join('04_Journal', 'Daily');
  else if (rawCategory === 'Ideas') destFolder = path.join('05_Ideas', 'Inbox');
  
  destFolder = validateAndSanitizeRoute({
    llmSuggestedPath: destFolder,
    originalFilename,
    noteTitle: data.title || originalFilename,
    noteBody: fullConvertedText,
    existingTags: detectedTags,
    projects: inboxProjectsList,
    jevResult: inboxRouteResult,
    typeRoutes: currentConfig.typeRoutes,
    projectsRoot: inboxProjectsRoot
  });

  // Dynamically register folder
  if (!currentVaultStructure.includes(destFolder)) {
    currentVaultStructure.push(destFolder);
  }

  const category = rawCategory || destFolder;
  
  let safeTitle = sanitizeTitle(data.title, originalFilename);
  // Enforce title language strictly matches document content language
  safeTitle = enforceTitleLanguage(safeTitle, fullConvertedText, originalFilename);
  safeTitle = preserveMeaningfulTitle(safeTitle, originalFilename);
  let mdFilename = `${safeTitle}.md`;
  
  const formatArray = (arr: any) => {
    if (!arr) return [];
    if (Array.isArray(arr)) return arr;
    if (typeof arr === 'string') return arr.split(',').map(s => s.trim()).filter(Boolean);
    return [];
  };

  const rawTags = sanitizeTagList(formatArray(data.tags), { allowSingleLetter: false });
  
  // Merge detected tags + LLM tags
  const tagMap = new Map<string, string>();
  for (const t of sanitizeTagList(detectedTags, { allowSingleLetter: false })) {
    tagMap.set(t.toLowerCase(), t);
  }
  for (const t of rawTags) {
    if (!tagMap.has(t.toLowerCase())) {
      tagMap.set(t.toLowerCase(), t);
    }
  }
  const parsedTags = Array.from(tagMap.values()).map(t => t.replace(/^#+/, ''));
  // Enforce language tags (e.g. #ru, #en, #ph)
  const tagsWithLanguage = ensureLanguageTags(parsedTags, fullConvertedText, originalFilename);

  const noteData: Record<string, unknown> = {
    ...(parsedIncomingNote?.data || {}),
    title: safeTitle,
    category: category,
    tags: tagsWithLanguage,
    summary: data.summary || '',
    ai_refined: true,
    ai_processed: true,
  };
  if (inboxRouteResult?.projectLink) {
    noteData.project = inboxRouteResult.projectLink;
  }

  let destMdPath = path.join(currentConfig.vaultPath, destFolder, mdFilename);
  if (!isPathInsideVault(destMdPath, currentConfig.vaultPath)) {
    throw new Error(`Security Error: Destination path "${destMdPath}" is outside vault.`);
  }
  
  // Deduplication: Check if existing note has identical content to prevent creating "Title 1.md", "Title 2.md"
  if (fs.existsSync(destMdPath)) {
    try {
      const existingContent = await fsPromises.readFile(destMdPath, 'utf-8');
      const normExisting = getNormalizedBody(existingContent);
      const normIncoming = getNormalizedBody(fullConvertedText);
      if (normExisting && normIncoming && (normExisting === normIncoming || computeWordSimilarity(normExisting, normIncoming) >= 80)) {
        addLog(`Duplicate note detected: "${safeTitle}" already exists in "${destFolder}". Merging tags and skipping duplicate creation.`, 'info');
        if (parsedTags.length > 0) {
          const merged = mergeTagsIntoFrontmatter(existingContent, parsedTags);
          await fsPromises.writeFile(destMdPath, merged, 'utf-8');
        }
        // Archive original incoming file
        const hash = await getFileHash(filePath);
        const inboxRoot = path.join(currentConfig.vaultPath, '00_Inbox');
        let relativePath = path.relative(inboxRoot, filePath); 
        const rawFolder = path.join(currentConfig.vaultPath, '99_System', '_keep_raw', 'inbox');
        const relativeDir = path.dirname(relativePath);
        const targetRawFolder = path.join(rawFolder, relativeDir);
        await fsPromises.mkdir(targetRawFolder, { recursive: true });
        const originalMovePath = path.join(targetRawFolder, `${hash}_${originalFilename}`);
        await fsPromises.rename(filePath, originalMovePath).catch(async () => {
          await fsPromises.copyFile(filePath, originalMovePath);
          await fsPromises.unlink(filePath).catch(() => null);
        });
        addLog(`Archived original to: 99_System/_keep_raw/inbox/${hash}_${originalFilename}`);
        return;
      }
    } catch (e) {}
  }

  // Handle collisions if content is truly distinct
  let counter = 1;
  while (fs.existsSync(destMdPath)) {
      mdFilename = `${safeTitle} ${counter}.md`;
      destMdPath = path.join(currentConfig.vaultPath, destFolder, mdFilename);
      counter++;
  }
  
  await fsPromises.mkdir(path.dirname(destMdPath), { recursive: true });
  
  const rawBodyText = fullConvertedText ? fullConvertedText.trim() : '';
  if (!isBinary && !isPdf && !isDocx && rawBodyText.length === 0) {
    addLog(`Rejected creating empty ghost note for: "${originalFilename}". File has no body content.`, 'warn');
    const err = new Error(`File "${originalFilename}" has no body content. Aborting to prevent empty ghost note.`);
    (err as any).isRetriable = false;
    throw err;
  }

  let linksBlock = '';
  const concepts = formatArray(data.related_concepts);
  const alreadyHasCallout = fullConvertedText.includes('\u0421\u0432\u044f\u0437\u0430\u043d\u043d\u044b\u0435 \u0442\u0435\u043c\u044b') || fullConvertedText.includes('Related Topics');
  if (concepts.length > 0 && !alreadyHasCallout) {
    const isRu = detectDocumentLanguage(fullConvertedText, originalFilename).primary === 'ru';
    const label = isRu ? '\u0421\u0432\u044f\u0437\u0430\u043d\u043d\u044b\u0435 \u0442\u0435\u043c\u044b' : 'Related Topics';
    linksBlock = `> **${label}:** ${concepts.map((c: string) => `[[${c}]]`).join(', ')}\n\n`;
  }

  let noteBody = linksBlock;
  let destResourcePath = '';
  
  if (isBinary || isPdf || isDocx) {
    // Preserve binary/pdf/docx original file as attachment
    let resourceFilename = `${safeTitle.replace(/\s+/g, '_')}${fileExtension}`;
    destResourcePath = path.join(currentConfig.vaultPath, destFolder, resourceFilename);
    
    let resCounter = 1;
    while (fs.existsSync(destResourcePath)) {
        resourceFilename = `${safeTitle.replace(/\s+/g, '_')}_${resCounter}${fileExtension}`;
        destResourcePath = path.join(currentConfig.vaultPath, destFolder, resourceFilename);
        resCounter++;
    }
    
    const isRu = detectDocumentLanguage(fullConvertedText, originalFilename).primary === 'ru';
    const sourceLabel = isRu ? '\u0418\u0441\u0445\u043e\u0434\u043d\u044b\u0439 \u0444\u0430\u0439\u043b' : 'Source File';
    noteBody += `**${sourceLabel}:** [[${resourceFilename}]]\n\n---\n\n`;
    if (!isBinary) {
       noteBody += fullConvertedText;
    } else {
       noteBody += `*(Binary file preserved as attachment)*`;
    }
  } else {
    // Pure text -> just inject
    noteBody += fullConvertedText;
  }

  const finalContent = serializeNote(noteData, noteBody);
  
  // ATOMIC WRITES
  const tmpMdPath = destMdPath + '.tmp';
  try {
    await fsPromises.writeFile(tmpMdPath, finalContent);
    await fsPromises.rename(tmpMdPath, destMdPath);
    addLog(`Created note: ${destFolder}/${mdFilename}`, 'success');
  } catch (writeErr: any) {
    if (fs.existsSync(tmpMdPath)) await fsPromises.unlink(tmpMdPath).catch(()=>null);
    throw new Error(`Failed to write note: ${writeErr.message}`);
  }
  
  // ATOMIC ATTACHMENT COPY
  if (destResourcePath) {
    const tmpResPath = destResourcePath + '.tmp';
    try {
      await fsPromises.copyFile(filePath, tmpResPath);
      await fsPromises.rename(tmpResPath, destResourcePath);
      addLog(`Copied attachment to: ${destFolder}/${path.basename(destResourcePath)}`, 'success');
    } catch (copyErr: any) {
      if (fs.existsSync(tmpResPath)) await fsPromises.unlink(tmpResPath).catch(()=>null);
      addLog(`Failed to copy attachment: ${copyErr.message}`, 'error');
    }
  }
  
  // HASH & MOVE ORIGINAL (Guaranteed no loss since we reached here successfully)
  const hash = await getFileHash(filePath);
  const inboxRoot = path.join(currentConfig.vaultPath, '00_Inbox');
  let relativePath = path.relative(inboxRoot, filePath); 
  const rawFolder = path.join(currentConfig.vaultPath, '99_System', '_keep_raw', 'inbox');
  
  const relativeDir = path.dirname(relativePath);
  const targetRawFolder = path.join(rawFolder, relativeDir);
  await fsPromises.mkdir(targetRawFolder, { recursive: true });
  
  const originalMovePath = path.join(targetRawFolder, `${hash}_${originalFilename}`);
  
  try {
    // Retry mechanism for locked files (EBUSY/EPERM)
    let moved = false;
    let moveRetries = 0;
    while (!moved && moveRetries < 5) {
      try {
        await fsPromises.rename(filePath, originalMovePath);
        moved = true;
      } catch (err: any) {
        if (err.code === 'EXDEV') {
          await fsPromises.copyFile(filePath, originalMovePath);
          await fsPromises.unlink(filePath);
          moved = true;
        } else if (err.code === 'EPERM' || err.code === 'EBUSY') {
          moveRetries++;
          await new Promise(r => setTimeout(r, 500));
        } else {
          throw err;
        }
      }
    }
    if (!moved) throw new Error("File locked permanently");
    addLog(`Archived original to: 99_System/_keep_raw/inbox/${relativeDir !== '.' ? relativeDir + '/' : ''}${hash}_${originalFilename}`);
  } catch (renameErr: any) {
    throw new Error(`Failed to archive original file: ${renameErr.message}`);
  }
  
  // SERIALIZED REGISTRY UPDATE (Mutex + Avoiding full JSON.parse)
  const registryPath = path.join(currentConfig.vaultPath, '99_System', '_processing_registry.json');
  const unlock = await registryMutex.lock();
  try {
    const newEntry = {
      hash,
      original_path: `00_Inbox/${relativePath}`,
      destination: `${destFolder}/${mdFilename}`,
      category: category,
      processed_at: new Date().toISOString()
    };
    
    const entryStr = JSON.stringify(newEntry, null, 2);
    
    if (!fs.existsSync(registryPath)) {
      await fsPromises.writeFile(registryPath, `[\n${entryStr}\n]`);
    } else {
      // Append-like injection for standard JSON array to save memory
      const stats = await fsPromises.stat(registryPath);
      if (stats.size > 2) {
         // File has content like [ ... ]
         // We open the file, chop the last bracket ']', append the new item, and close the bracket.
         const fd = await fsPromises.open(registryPath, 'r+');
         
         // Search for the last ']' bracket
         let position = stats.size - 1;
         let found = false;
         const buffer = Buffer.alloc(1);
         while (position >= 0) {
            await fd.read(buffer, 0, 1, position);
            if (buffer.toString('utf-8') === ']') {
               found = true;
               break;
            }
            position--;
         }
         
         if (found) {
             const appendStr = `,\n${entryStr}\n]`;
             await fd.write(appendStr, position);
         } else {
             // Fallback if badly formatted
             await fsPromises.writeFile(registryPath, `[\n${entryStr}\n]`);
         }
         await fd.close();
      } else {
         await fsPromises.writeFile(registryPath, `[\n${entryStr}\n]`);
      }
    }
  } catch (err: any) {
     addLog(`Failed to update registry efficiently: ${err.message}`, 'error');
  } finally {
    unlock();
  }
  
  // Auto-update MOCs
  try {
    const mocsDir = path.join(currentConfig.vaultPath, '00_MOC');
    const link = `[[${mdFilename.replace('.md', '')}]]`;
    
    if (destFolder.includes('03_Knowledge')) {
      const p = path.join(mocsDir, 'moc_topics.md');
      if (fs.existsSync(p)) await fsPromises.appendFile(p, `\n- ${link} - ${data.summary || ''}`);
    }
    if (destFolder.includes('01_Projects')) {
      const p = path.join(mocsDir, 'moc_projects.md');
      if (fs.existsSync(p)) await fsPromises.appendFile(p, `\n- ${link} - ${data.summary || ''}`);
    }
    if (destFolder.includes('02_Areas') && category === 'People') {
      const p = path.join(mocsDir, 'moc_people.md');
      if (fs.existsSync(p)) await fsPromises.appendFile(p, `\n- ${link} - ${data.summary || ''}`);
    }
    if (parsedTags && parsedTags.length > 0) {
      const p = path.join(mocsDir, 'moc_tags.md');
      if (fs.existsSync(p)) {
        const newTags = parsedTags.map(t => `- ${t} => ${link}`).join('\n');
        await fsPromises.appendFile(p, `\n${newTags}`);
      }
    }
  } catch(mocErr) {
     addLog(`Failed to update MOCs.`, 'error');
  }
}

// --- API Routes ---
app.get('/api/config', (req, res) => {
  res.json(currentConfig);
});

app.post('/api/config', async (req, res) => {
  const merged = { ...currentConfig, ...req.body };
  const parseResult = ConfigSchema.safeParse(merged);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Validation error',
      details: parseResult.error.issues.map(e => ({ path: e.path.join('.'), message: e.message }))
    });
  }

  if (parseResult.data.decisionMode === 'fast_routing' && !isCalibrated(parseResult.data.vaultPath)) {
    return res.status(400).json({
      error: 'Cannot enable fast_routing: vault is not calibrated. Run calibration first so 99_System/index/thresholds.json exists with calibrated: true.'
    });
  }
  
  currentConfig = parseResult.data;
  try {
    await fsPromises.writeFile(CONFIG_FILE, JSON.stringify(currentConfig, null, 2));
  } catch(e) {}
  
  res.json({ success: true, config: currentConfig });
});


app.post('/api/stop-refine', (req, res) => {
  if (!isProcessingRefineQueue) return res.json({ message: 'Not refining currently.' });
  refineQueue.length = 0; // Clear the queue
  isProcessingRefineQueue = false;
  addLog('Refinement process STOPPED by user.', 'warn');
  res.json({ message: 'Refinement stopped.' });
});

app.get('/api/status', (req, res) => {
  res.json({ isWatching, vaultPath: currentConfig.vaultPath, queueLength: fileQueue.length, refineQueueLength: refineQueue.length, refineTotal, refineCompleted, isRefining: isProcessingRefineQueue });
});

app.post('/api/start', async (req, res) => {
  if (isWatching) return res.json({ success: false, message: 'Already watching' });
  if (!currentConfig.vaultPath) return res.status(400).json({ error: 'Vault path not set' });
  
  const inboxPath = path.join(currentConfig.vaultPath, '00_Inbox');
  
  try {
    await fsPromises.mkdir(inboxPath, { recursive: true });
  } catch (e) {
    return res.status(500).json({ error: 'Could not access or create 00_Inbox in vault' });
  }

  isWatching = true;
  addLog(`Started watching ${inboxPath}`, 'success');
  
  watcher = chokidar.watch(inboxPath, {
    ignored: (testPath: string) => {
      const rel = path.relative(inboxPath, testPath);
      if (rel.startsWith('..')) return false;
      const parts = rel.split(path.sep).filter(Boolean);
      return parts.some(seg => seg.startsWith('.')) || parts.includes('Review') || parts.includes('Processed');
    },
    persistent: true,
    depth: 99,
    ignoreInitial: false, // Important: Process existing files on start
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 }
  });
  
  watcher.on('add', (filePath) => {
    if (filePath.includes('/Review/') || filePath.includes('\\Review\\')) return;
    if (filePath.includes('/Processed/') || filePath.includes('\\Processed\\')) return;
    
    if (fileQueue.length >= MAX_QUEUE_SIZE) {
       addLog(`Queue is full! Dropping event for ${path.basename(filePath)}.`, 'error');
       return;
    }
    
    fileQueue.push({ filePath, retryCount: 0 });
    processQueue();
  });

  watcher.on('error', (err: any) => {
    addLog(`[Watcher Warning] File watcher encountered a non-fatal error: ${err?.message || err}`, 'warn');
  });
  
  res.json({ success: true });
});

app.post('/api/stop', async (req, res) => {
  if (!isWatching) return res.json({ success: false, message: 'Not watching' });
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
  isWatching = false;
  addLog('Stopped watching inbox');
  res.json({ success: true });
});

app.get('/api/logs', (req, res) => {
  res.json(logs);
});

app.post('/api/init-vault', async (req, res) => {
  if (!currentConfig.vaultPath) return res.status(400).json({ error: 'Vault path not set' });
  const vaultPath = currentConfig.vaultPath;
  
  try {
    const dirs = [
      '00_Inbox', '00_Inbox/Processed',
      '01_Projects/Active', '01_Projects/Incubator', '01_Projects/Archive',
      '02_Areas/People', '02_Areas/Organizations', '02_Areas/Places', '02_Areas/Entities',
      '03_Knowledge/Concepts', '03_Knowledge/Topics', '03_Knowledge/References', '03_Knowledge/Documents',
      '04_Journal/Daily', '04_Journal/Meetings', '04_Journal/Events',
      '05_Ideas/Inbox', '05_Ideas/Developing', '05_Ideas/Archive',
      '06_Archive/Projects', '06_Archive/Knowledge', '06_Archive/Other',
      '00_MOC',
      '99_System/_keep_raw/inbox', '99_System/templates', '99_System/prompts', '99_System/logs'
    ];
    
    for (const dir of dirs) {
      await fsPromises.mkdir(path.join(vaultPath, dir), { recursive: true });
    }
    
    const mocs = ['moc_projects.md', 'moc_people.md', 'moc_topics.md', 'moc_tags.md'];
    for (const moc of mocs) {
      const mocPath = path.join(vaultPath, '00_MOC', moc);
      if (!fs.existsSync(mocPath)) {
        await fsPromises.writeFile(mocPath, `# ${moc.replace('.md', '').replace('moc_', 'MOC ')}\n\nMap of Content.`);
      }
    }
    
    const sysFiles = ['_processing_registry.json', '_knowledge_index.json', '_pipeline_report.json', '_test_report.json'];
    for (const sys of sysFiles) {
      const sysPath = path.join(vaultPath, '99_System', sys);
      if (!fs.existsSync(sysPath)) {
        await fsPromises.writeFile(sysPath, sys.endsWith('.json') ? '[]' : '');
      }
    }
    
    addLog('Vault structure initialized successfully', 'success');
    res.json({ success: true, message: 'Vault initialized' });
  } catch (error: any) {
    addLog(`Error initializing vault: ${error.message}`, 'error');
    res.status(500).json({ error: 'Could not initialize vault structure' });
  }
});

app.get('/api/registry', async (req, res) => {
  if (!currentConfig.vaultPath) return res.json([]);
  const registryPath = path.join(currentConfig.vaultPath, '99_System', '_processing_registry.json');
  if (fs.existsSync(registryPath)) {
    const unlock = await registryMutex.lock();
    try {
      const regContent = await fsPromises.readFile(registryPath, 'utf-8');
      res.json(JSON.parse(regContent));
    } catch (e) {
      res.json([]);
    } finally {
      unlock();
    }
  } else {
    res.json([]);
  }
});

app.post('/api/generate-digest', async (req, res) => {
  if (!currentConfig.vaultPath) return res.status(400).json({ error: 'Vault path not set' });
  const registryPath = path.join(currentConfig.vaultPath, '99_System', '_processing_registry.json');
  
  if (!fs.existsSync(registryPath)) return res.status(400).json({ error: 'No files processed yet' });
  
  try {
    let registry: any[] = [];
    const unlock = await registryMutex.lock();
    try {
      const regContent = await fsPromises.readFile(registryPath, 'utf-8');
      registry = JSON.parse(regContent);
    } catch (e) {
      registry = [];
    } finally {
      unlock();
    }
    
    const todayStr = new Date().toLocaleDateString('sv-SE'); 
    const todayItems = registry.filter((item: any) => {
        if (!item.processed_at) return false;
        const itemDate = new Date(item.processed_at);
        return itemDate.toLocaleDateString('sv-SE') === todayStr;
    });
    
    if (todayItems.length === 0) return res.status(400).json({ error: 'No files processed today to summarize.' });
    
    addLog(`Generating daily digest for ${todayItems.length} items...`);
    
    let summaries = [];
    for (const item of todayItems) {
      try {
        const filePath = path.join(currentConfig.vaultPath, item.destination);
        const content = await fsPromises.readFile(filePath, 'utf-8');
        const summaryMatch = content.match(/summary:\s*["']?([^"'\n]+)["']?/);
        // Ensure Analytics field matches the V3 property item.category
        if (summaryMatch && summaryMatch[1]) {
           summaries.push(`- ${path.basename(item.destination)} (${item.category || 'unknown'}): ${summaryMatch[1]}`);
        } else {
           summaries.push(`- ${path.basename(item.destination)} (${item.category || 'unknown'})`);
        }
      } catch (err) {}
    }
    
    const prompt = `You are a helpful knowledge assistant. I have processed ${todayItems.length} notes today.
Here is the list of notes and their summaries:
${summaries.join('\n')}

Write a concise "Daily Digest" journal entry summarizing what I focused on today, what types of concepts or projects I worked on, and any overarching themes. Format it in Markdown. Use a professional, reflective tone.`;

    const response = await axios.post(`${currentConfig.llamaUrl}/v1/chat/completions`, {
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        stream: false
    }, { timeout: 120000 });
    
    const digestContent = response.data.choices[0].message.content;
    const digestPath = path.join(currentConfig.vaultPath, '04_Journal', 'Daily', `${todayStr}-Digest.md`);
    
    // Atomic Write
    await fsPromises.mkdir(path.dirname(digestPath), { recursive: true });
    const tmpDigestPath = digestPath + '.tmp';
    const finalFileContent = `---
type: "journal"
tags: ["daily-digest", "log"]
date: "${todayStr}"
---

# Daily Digest: ${todayStr}

${digestContent.trim()}
`;

    await fsPromises.writeFile(tmpDigestPath, finalFileContent);
    await fsPromises.rename(tmpDigestPath, digestPath);
    
    addLog(`Created daily digest: 04_Journal/Daily/${todayStr}-Digest.md`, 'success');
    res.json({ success: true, message: 'Digest created successfully' });
    
  } catch (err: any) {
    if (err.code === 'ECONNREFUSED') {
       addLog(`LLM Server is not running. Start it to generate digests.`, 'error');
       return res.status(500).json({ error: 'LLM Server not running.' });
    }
    addLog(`Digest error: ${err.message}`, 'error');
    res.status(500).json({ error: 'Failed to generate digest: ' + err.message });
  }
});

// --- Vault Duplicate Scanner & Cleaner Endpoints ---

interface ScannedNote {
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

async function scanVaultMarkdownFiles(dir: string, fileList: string[] = []): Promise<string[]> {
  try {
    const entries = await fsPromises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const lower = entry.name.toLowerCase();
      if (
        entry.name.startsWith('.') ||
        lower === '00_inbox' ||
        lower === 'templates' ||
        lower === '99_system' ||
        lower === 'node_modules' ||
        lower.startsWith('moc')
      ) continue;

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanVaultMarkdownFiles(fullPath, fileList);
      } else if (entry.isFile() && lower.endsWith('.md')) {
        fileList.push(fullPath);
      }
    }
  } catch (e) {}
  return fileList;
}

app.get('/api/duplicates', async (req, res) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.status(400).json({ error: 'Vault path not configured' });
  }

  try {
    const mdFiles = await scanVaultMarkdownFiles(currentConfig.vaultPath);
    const scannedNotes: ScannedNote[] = [];

    for (const filePath of mdFiles) {
      try {
        const stat = await fsPromises.stat(filePath);
        const content = await fsPromises.readFile(filePath, 'utf-8');
        const filename = path.basename(filePath);
        const relativePath = path.relative(currentConfig.vaultPath, filePath).replace(/\\/g, '/');
        const baseInfo = parseBaseTitle(filename);

        const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
        const fm = fmMatch ? fmMatch[1] : '';
        const rawBody = fmMatch ? fmMatch[2] : content;
        const normBody = getNormalizedBody(content);
        const bodyHash = crypto.createHash('sha256').update(normBody).digest('hex');
        const tags = extractTags(fm, rawBody, filename);
        const snippet = normBody.slice(0, 180).replace(/\n+/g, ' ');

        scannedNotes.push({
          filePath,
          relativePath,
          fileName: filename,
          size: stat.size,
          mtime: stat.mtimeMs,
          mtimeStr: stat.mtime.toLocaleString('ru-RU'),
          tags,
          snippet,
          bodyHash,
          normBody,
          baseTitle: baseInfo.base,
          numberSuffix: baseInfo.numberSuffix
        });
      } catch (e) {}
    }

    const groups: any[] = [];
    const assignedPaths = new Set<string>();

    // Helper to sort and pick canonical file
    const pickCanonical = (items: ScannedNote[]) => {
      const sorted = [...items].sort((a, b) => {
        // 1. Files WITHOUT number suffix come first (e.g. "Note.md" before "Note 1.md")
        const aNum = a.numberSuffix === null ? 0 : 1;
        const bNum = b.numberSuffix === null ? 0 : 1;
        if (aNum !== bNum) return aNum - bNum;
        if (a.numberSuffix !== null && b.numberSuffix !== null && a.numberSuffix !== b.numberSuffix) {
          return a.numberSuffix - b.numberSuffix;
        }
        // 2. Structured PARA folders preferred
        const isCuratedA = /^(01_|02_|03_|04_)/.test(a.relativePath);
        const isCuratedB = /^(01_|02_|03_|04_)/.test(b.relativePath);
        if (isCuratedA !== isCuratedB) return isCuratedA ? -1 : 1;
        // 3. More tags preferred
        if (a.tags.length !== b.tags.length) return b.tags.length - a.tags.length;
        // 4. Oldest mtime (original note created first)
        return a.mtime - b.mtime;
      });

      return {
        canonical: sorted[0],
        duplicates: sorted.slice(1)
      };
    };

    // 1. Group by Exact Hash (100% identical body)
    const hashGroups = new Map<string, ScannedNote[]>();
    for (const note of scannedNotes) {
      if (!note.normBody || note.normBody.length < 20) continue;
      if (!hashGroups.has(note.bodyHash)) hashGroups.set(note.bodyHash, []);
      hashGroups.get(note.bodyHash)!.push(note);
    }

    let groupCounter = 1;
    for (const [, notes] of hashGroups) {
      if (notes.length >= 2) {
        const { canonical, duplicates } = pickCanonical(notes);
        notes.forEach(n => assignedPaths.add(n.filePath));

        const reclaimableBytes = duplicates.reduce((sum, d) => sum + d.size, 0);
        groups.push({
          id: `grp_${groupCounter++}`,
          title: canonical.baseTitle || canonical.fileName.replace(/\.md$/, ''),
          matchType: 'exact_content',
          similarity: 100,
          canonical,
          duplicates,
          reclaimableBytes
        });
      }
    }

    // 2. Group by Base Name (e.g. "The Role of Perception 1.md" and "The Role of Perception.md")
    const titleGroups = new Map<string, ScannedNote[]>();
    for (const note of scannedNotes) {
      if (assignedPaths.has(note.filePath)) continue;
      const key = note.baseTitle.toLowerCase();
      if (!titleGroups.has(key)) titleGroups.set(key, []);
      titleGroups.get(key)!.push(note);
    }

    for (const [, notes] of titleGroups) {
      if (notes.length >= 2) {
        // Only consider if at least one is a numbered copy
        const hasNumbered = notes.some(n => n.numberSuffix !== null);
        if (!hasNumbered) continue;

        const { canonical, duplicates } = pickCanonical(notes);
        // Check similarity against canonical
        const validDuplicates: ScannedNote[] = [];
        for (const dup of duplicates) {
          const sim = computeWordSimilarity(canonical.normBody, dup.normBody);
          if (sim >= 70 || canonical.normBody.includes(dup.normBody) || dup.normBody.includes(canonical.normBody)) {
            validDuplicates.push(dup);
            assignedPaths.add(dup.filePath);
          }
        }

        if (validDuplicates.length > 0) {
          assignedPaths.add(canonical.filePath);
          const reclaimableBytes = validDuplicates.reduce((sum, d) => sum + d.size, 0);
          groups.push({
            id: `grp_${groupCounter++}`,
            title: canonical.baseTitle || canonical.fileName.replace(/\.md$/, ''),
            matchType: 'numbered_copy',
            similarity: 90,
            canonical,
            duplicates: validDuplicates,
            reclaimableBytes
          });
        }
      }
    }

    // Check if any trash backups exist for restore
    let trashExists = false;
    let latestBackupDate: string | null = null;
    const trashBase = path.join(currentConfig.vaultPath, '99_System', '_duplicates_trash');
    if (fs.existsSync(trashBase)) {
      try {
        const trashEntries = await fsPromises.readdir(trashBase);
        const validBackups = trashEntries.filter(e => !e.includes('_RESTORED'));
        trashExists = validBackups.length > 0;
        if (trashExists) {
          latestBackupDate = validBackups.sort().reverse()[0];
        }
      } catch (e) {}
    }

    const totalDuplicateFiles = groups.reduce((acc, g) => acc + g.duplicates.length, 0);
    const exactDuplicatesCount = groups.filter(g => g.matchType === 'exact_content').reduce((acc, g) => acc + g.duplicates.length, 0);
    const reclaimableBytes = groups.reduce((acc, g) => acc + g.reclaimableBytes, 0);

    res.json({
      groups,
      stats: {
        totalGroups: groups.length,
        totalDuplicateFiles,
        exactDuplicatesCount,
        reclaimableBytes
      },
      trashExists,
      latestBackupDate
    });

  } catch (err: any) {
    addLog(`Error scanning for duplicates: ${err.message}`, 'error');
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/duplicates/clean', async (req, res) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.status(400).json({ error: 'Vault path not configured' });
  }

  const { allExact, items, groupIds } = req.body;

  try {
    // Scan fresh state
    const mdFiles = await scanVaultMarkdownFiles(currentConfig.vaultPath);
    const scannedNotes: ScannedNote[] = [];

    for (const filePath of mdFiles) {
      try {
        const stat = await fsPromises.stat(filePath);
        const content = await fsPromises.readFile(filePath, 'utf-8');
        const filename = path.basename(filePath);
        const relativePath = path.relative(currentConfig.vaultPath, filePath).replace(/\\/g, '/');
        const baseInfo = parseBaseTitle(filename);

        const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
        const fm = fmMatch ? fmMatch[1] : '';
        const rawBody = fmMatch ? fmMatch[2] : content;
        const normBody = getNormalizedBody(content);
        const bodyHash = crypto.createHash('sha256').update(normBody).digest('hex');
        const tags = extractTags(fm, rawBody, filename);

        scannedNotes.push({
          filePath,
          relativePath,
          fileName: filename,
          size: stat.size,
          mtime: stat.mtimeMs,
          mtimeStr: stat.mtime.toLocaleString('ru-RU'),
          tags,
          snippet: '',
          bodyHash,
          normBody,
          baseTitle: baseInfo.base,
          numberSuffix: baseInfo.numberSuffix
        });
      } catch (e) {}
    }

    // Determine which duplicate files to remove
    const pairsToClean: Array<{ duplicatePath: string; canonicalPath: string }> = [];

    if (items && Array.isArray(items)) {
      for (const item of items) {
        if (!isPathInsideVault(item.duplicatePath, currentConfig.vaultPath) ||
            !isPathInsideVault(item.canonicalPath, currentConfig.vaultPath)) {
          return res.status(400).json({ error: 'Validation error: paths outside vault detected' });
        }
      }
      pairsToClean.push(...items);
    } else {
      // Group by exact hash
      const hashGroups = new Map<string, ScannedNote[]>();
      for (const note of scannedNotes) {
        if (!note.normBody || note.normBody.length < 20) continue;
        if (!hashGroups.has(note.bodyHash)) hashGroups.set(note.bodyHash, []);
        hashGroups.get(note.bodyHash)!.push(note);
      }

      for (const [, notes] of hashGroups) {
        if (notes.length >= 2) {
          const sorted = [...notes].sort((a, b) => {
            const aNum = a.numberSuffix === null ? 0 : 1;
            const bNum = b.numberSuffix === null ? 0 : 1;
            if (aNum !== bNum) return aNum - bNum;
            return a.mtime - b.mtime;
          });
          const canonical = sorted[0];
          for (let i = 1; i < sorted.length; i++) {
            pairsToClean.push({
              duplicatePath: sorted[i].filePath,
              canonicalPath: canonical.filePath
            });
          }
        }
      }

      // Also clean numbered copies if not strictly allExact
      if (!allExact) {
        const titleGroups = new Map<string, ScannedNote[]>();
        for (const note of scannedNotes) {
          const key = note.baseTitle.toLowerCase();
          if (!titleGroups.has(key)) titleGroups.set(key, []);
          titleGroups.get(key)!.push(note);
        }
        for (const [, notes] of titleGroups) {
          if (notes.length >= 2 && notes.some(n => n.numberSuffix !== null)) {
            const sorted = [...notes].sort((a, b) => {
              const aNum = a.numberSuffix === null ? 0 : 1;
              const bNum = b.numberSuffix === null ? 0 : 1;
              if (aNum !== bNum) return aNum - bNum;
              return a.mtime - b.mtime;
            });
            const canonical = sorted[0];
            for (let i = 1; i < sorted.length; i++) {
              if (computeWordSimilarity(canonical.normBody, sorted[i].normBody) >= 70) {
                if (!pairsToClean.some(p => p.duplicatePath === sorted[i].filePath)) {
                  pairsToClean.push({
                    duplicatePath: sorted[i].filePath,
                    canonicalPath: canonical.filePath
                  });
                }
              }
            }
          }
        }
      }
    }

    if (pairsToClean.length === 0) {
      return res.json({ success: true, removedCount: 0, message: 'No duplicates needed cleaning.' });
    }

    // Setup safe trash directory session
    const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');
    const trashSubdir = path.join(currentConfig.vaultPath, '99_System', '_duplicates_trash', timestampStr);
    await fsPromises.mkdir(trashSubdir, { recursive: true });

    const manifest: any = {
      timestamp: Date.now(),
      created_at: new Date().toISOString(),
      trashSubdir,
      items: []
    };

    let removedCount = 0;
    let reclaimedBytes = 0;

    for (const pair of pairsToClean) {
      if (!fs.existsSync(pair.duplicatePath)) continue;

      try {
        const dupStat = await fsPromises.stat(pair.duplicatePath);
        const dupContent = await fsPromises.readFile(pair.duplicatePath, 'utf-8');
        const dupTags = extractTags(dupContent, '', path.basename(pair.duplicatePath));

        // Merge tags into canonical file if canonical exists
        if (fs.existsSync(pair.canonicalPath) && dupTags.length > 0) {
          try {
            const canonContent = await fsPromises.readFile(pair.canonicalPath, 'utf-8');
            const mergedCanon = mergeTagsIntoFrontmatter(canonContent, dupTags);
            await fsPromises.writeFile(pair.canonicalPath, mergedCanon, 'utf-8');
          } catch (mErr: any) {
            addLog(`Failed to merge tags for ${path.basename(pair.duplicatePath)}: ${mErr.message}`, 'warn');
          }
        }

        // Backup and remove duplicate file
        const dupRel = path.relative(currentConfig.vaultPath, pair.duplicatePath);
        const canonRel = path.relative(currentConfig.vaultPath, pair.canonicalPath);
        const backupTarget = path.join(trashSubdir, dupRel);
        await fsPromises.mkdir(path.dirname(backupTarget), { recursive: true });
        await fsPromises.copyFile(pair.duplicatePath, backupTarget);
        await fsPromises.unlink(pair.duplicatePath);

        manifest.items.push({
          duplicateRelativePath: dupRel,
          canonicalRelativePath: canonRel,
          backupTargetPath: backupTarget,
          size: dupStat.size
        });

        removedCount++;
        reclaimedBytes += dupStat.size;
        addLog(`Cleaned duplicate: ${path.basename(pair.duplicatePath)} -> merged into ${path.basename(pair.canonicalPath)}`, 'info');
      } catch (err: any) {
        addLog(`Failed to clean duplicate ${path.basename(pair.duplicatePath)}: ${err.message}`, 'error');
      }
    }

    await fsPromises.writeFile(path.join(trashSubdir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    try {
      await pruneEmptyDirectories(currentConfig.vaultPath, currentConfig.vaultPath);
    } catch {}

    addLog(`Safely cleaned ${removedCount} duplicate notes. Reclaimed ${(reclaimedBytes / 1024).toFixed(1)} KB. Backed up to 99_System/_duplicates_trash.`, 'success');

    res.json({
      success: true,
      removedCount,
      reclaimedBytes,
      backupLocation: path.relative(currentConfig.vaultPath, trashSubdir),
      message: `Successfully cleaned ${removedCount} duplicate notes.`
    });

  } catch (err: any) {
    addLog(`Deduplication error: ${err.message}`, 'error');
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/duplicates/restore', async (req, res) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.status(400).json({ error: 'Vault path not configured' });
  }

  const trashBase = path.join(currentConfig.vaultPath, '99_System', '_duplicates_trash');
  if (!fs.existsSync(trashBase)) {
    return res.status(400).json({ error: 'No trash backups found' });
  }

  try {
    const entries = await fsPromises.readdir(trashBase);
    const validBackups = entries.filter(e => !e.includes('_RESTORED')).sort().reverse();
    if (validBackups.length === 0) {
      return res.status(400).json({ error: 'No active backups available to restore' });
    }

    const latestBackupDir = path.join(trashBase, validBackups[0]);
    const manifestPath = path.join(latestBackupDir, 'manifest.json');

    if (!fs.existsSync(manifestPath)) {
      return res.status(400).json({ error: 'Manifest not found in backup' });
    }

    const manifest = JSON.parse(await fsPromises.readFile(manifestPath, 'utf-8'));
    let restoredCount = 0;

    for (const item of manifest.items || []) {
      const origPath = path.join(currentConfig.vaultPath, item.duplicateRelativePath);
      const backupPath = item.backupTargetPath;
      if (fs.existsSync(backupPath)) {
        await fsPromises.mkdir(path.dirname(origPath), { recursive: true });
        await fsPromises.copyFile(backupPath, origPath);
        restoredCount++;
      }
    }

    // Mark backup directory as restored
    const restoredDirName = `${latestBackupDir}_RESTORED`;
    await fsPromises.rename(latestBackupDir, restoredDirName);

    addLog(`Restored ${restoredCount} duplicate notes from backup: ${validBackups[0]}`, 'success');

    res.json({
      success: true,
      restoredCount,
      message: `Restored ${restoredCount} notes successfully.`
    });

  } catch (err: any) {
    addLog(`Restore error: ${err.message}`, 'error');
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/duplicates/resolve', async (req, res) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.status(400).json({ error: 'Vault path not configured' });
  }

  const parseResult = DuplicatesResolveSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Validation error',
      details: parseResult.error.issues.map(e => ({ path: e.path.join('.'), message: e.message }))
    });
  }

  const { resolvedPaths } = parseResult.data;
  const invalidPaths = resolvedPaths.filter(p => !isPathInsideVault(p, currentConfig.vaultPath));
  if (invalidPaths.length > 0) {
    return res.status(400).json({
      error: 'Validation error: paths outside vault detected',
      details: invalidPaths.map(p => ({ path: p, message: 'Path is outside vault' }))
    });
  }

  res.json({ success: true, resolvedCount: resolvedPaths.length });
});

app.post('/api/archive-duplicates', async (req, res) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.status(400).json({ error: 'Vault path not configured' });
  }

  const parseResult = ArchiveDuplicatesSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Validation error',
      details: parseResult.error.issues.map(e => ({ path: e.path.join('.'), message: e.message }))
    });
  }

  const { paths: targetPaths } = parseResult.data;
  const invalidPaths = targetPaths.filter(p => !isPathInsideVault(p, currentConfig.vaultPath));
  if (invalidPaths.length > 0) {
    return res.status(400).json({
      error: 'Validation error: paths outside vault detected',
      details: invalidPaths.map(p => ({ path: p, message: 'Path is outside vault' }))
    });
  }

  const archiveDir = path.join(currentConfig.vaultPath, '99_System', '_refine_archive');
  await fsPromises.mkdir(archiveDir, { recursive: true });
  const archived: string[] = [];

  for (const p of targetPaths) {
    const fullPath = path.isAbsolute(p) ? p : path.join(currentConfig.vaultPath, p);
    if (fs.existsSync(fullPath)) {
      const rel = path.relative(currentConfig.vaultPath, fullPath);
      const dest = path.join(archiveDir, rel);
      await fsPromises.mkdir(path.dirname(dest), { recursive: true });
      await fsPromises.rename(fullPath, dest);
      archived.push(rel);
    }
  }

  res.json({ success: true, archived });
});

// --- Jev-Style Decision Model Endpoints ---

app.get('/api/decision/status', async (req, res) => {
  const urlToCheck = (req.query.url as string) || currentConfig.decisionModelUrl || 'http://127.0.0.1:1234';
  const cleanUrl = urlToCheck.replace(/\/+$/, '');
  const health = await checkDecisionServerHealth(cleanUrl, 4000);
  res.json({
    online: health.online,
    url: cleanUrl,
    latencyMs: health.latencyMs,
    models: health.models || [],
    error: health.error
  });
});

app.post('/api/decision/test', async (req, res) => {
  const parseResult = DecisionTestSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Validation error',
      details: parseResult.error.issues.map(e => ({ path: e.path.join('.'), message: e.message }))
    });
  }

  const { text, question, options, decisionModelUrl } = parseResult.data;
  const targetUrl = decisionModelUrl || currentConfig.decisionModelUrl;
  const targetQuestion = question || 'What is the most appropriate category for this note?';
  const targetOptions = options && options.length >= 2
    ? options
    : (currentConfig.topLevelCategories || [
        'Project',
        'Essay/Knowledge',
        'Dialogue/Transcript',
        'Poem',
        'Screenplay/Script',
        'Idea',
        'Journal/Diary',
        'Technical/Code'
      ]);

  try {
    const start = Date.now();
    const output = await chooseOne(text, targetQuestion, targetOptions, {
      decisionModelUrl: targetUrl,
      timeoutMs: 15000
    });
    const elapsedMs = Date.now() - start;
    res.json({ success: true, output, elapsedMs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/vault/structure', async (req, res) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.json({ folders: [], projectsRoot: '01_Projects', projects: [], existingTags: [] });
  }
  try {
    const structure = await discoverVaultStructure(currentConfig.vaultPath);
    res.json(structure);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/vault/prune-empty', async (req, res) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.status(400).json({ error: 'Vault path not configured' });
  }
  try {
    const removed = await pruneEmptyDirectories(currentConfig.vaultPath, currentConfig.vaultPath);
    const relativeRemoved = removed.map(r => path.relative(currentConfig.vaultPath, r).replace(/\\/g, '/'));
    if (relativeRemoved.length > 0) {
      addLog(`[Empty Folder Cleanup] Removed ${relativeRemoved.length} empty folder(s): ${relativeRemoved.join(', ')}`, 'success');
    } else {
      addLog('[Empty Folder Cleanup] Checked vault — no empty folders found.', 'info');
    }
    res.json({ success: true, prunedCount: relativeRemoved.length, removedFolders: relativeRemoved });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Helper that re-evaluates a note and proposes a smart alternative folder from the connected Vault
 * when the user clicks "NO" on Triage suggestions (or when auto-resolving).
 */
async function rethinkTriageAlternativeForNote(
  item: { filePath: string; filename: string; relativePath: string },
  rejectedFolders: string[],
  rejectedOptions: string[]
): Promise<{ option: string; folder: string; reason?: string } | null> {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) return null;

  const rejectedLower = new Set(
    [...rejectedFolders, ...rejectedOptions].map(s => (s || '').toLowerCase().replace(/\\/g, '/').trim())
  );

  const structure = await discoverVaultStructure(currentConfig.vaultPath);
  const routerConfig = await buildRouterConfig(currentConfig);

  // Collect all candidate folders from the vault's discovered projects, typeRoutes, and actual disk folders
  const allCandidates = new Set<string>();
  for (const proj of structure.projects) {
    if (proj.folder) allCandidates.add(proj.folder);
  }
  for (const route of Object.values(routerConfig.typeRoutes)) {
    if (route) allCandidates.add(route);
  }
  for (const folder of structure.folders) {
    if (folder && !folder.startsWith('00_') && !folder.startsWith('99_')) {
      allCandidates.add(folder);
    }
  }
  allCandidates.add(`${structure.projectsRoot}/Active`);

  const availableFolders = Array.from(allCandidates).filter(
    f => !rejectedLower.has(f.toLowerCase().replace(/\\/g, '/').trim())
  );
  if (availableFolders.length === 0) return null;

  let bodyText = '';
  let noteTitle = item.filename.replace(/\.md$/i, '');
  let existingTags: string[] = [];
  if (item.filePath && fs.existsSync(item.filePath)) {
    try {
      const raw = await fsPromises.readFile(item.filePath, 'utf-8');
      const parsed = parseNote(raw);
      bodyText = parsed.body || '';
      if (parsed.data.title) noteTitle = String(parsed.data.title);
      if (Array.isArray(parsed.data.tags)) existingTags = parsed.data.tags.map(String);
    } catch {}
  }

  // 1. Check deterministic semantic route first if not already rejected
  const deterministicRoute = validateAndSanitizeRoute({
    llmSuggestedPath: '',
    originalFilename: item.filename,
    noteTitle,
    noteBody: bodyText,
    existingTags,
    projects: structure.projects,
    typeRoutes: routerConfig.typeRoutes,
    projectsRoot: structure.projectsRoot
  });
  if (
    deterministicRoute &&
    !rejectedLower.has(deterministicRoute.toLowerCase().replace(/\\/g, '/').trim())
  ) {
    return {
      option: deterministicRoute,
      folder: deterministicRoute,
      reason: `Semantic analysis of "${noteTitle}" suggests`
    };
  }

  // 2. If Jev Decision Server is online, ask it to choose among the remaining available vault folders
  if (currentConfig.decisionModelUrl && availableFolders.length >= 2) {
    try {
      const isOnline = await isDecisionServerReachable(currentConfig.decisionModelUrl, 1200);
      if (isOnline) {
        const snippet = safeSlice(bodyText, 0, 1200);
        const state = `Filename: ${item.filename}\nTitle: ${noteTitle}\nRejected folders: ${rejectedFolders.join(', ')}\nContent:\n${snippet}`;
        const choice = await chooseOne(
          state,
          'The previous folder was rejected. Which remaining vault folder best fits this document?',
          availableFolders.slice(0, 15),
          { decisionModelUrl: currentConfig.decisionModelUrl, timeoutMs: 8000 }
        );
        if (choice && choice.chosen && choice.chosen.option) {
          return {
            option: choice.chosen.option,
            folder: choice.chosen.option,
            reason: `AI re-evaluated (${Math.round(choice.confidence * 100)}% conf)`
          };
        }
      }
    } catch {}
  }

  // 3. Fallback to best keyword/project match among remaining availableFolders
  const fallbackFolder = availableFolders[0];
  return {
    option: fallbackFolder,
    folder: fallbackFolder,
    reason: 'Next best matching vault folder'
  };
}

app.get('/api/decision/triage', async (req, res) => {
  const queue = triageManager.getQueue();
  let vaultFolders: string[] = [];
  if (currentConfig.vaultPath && fs.existsSync(currentConfig.vaultPath)) {
    try {
      const struct = await discoverVaultStructure(currentConfig.vaultPath);
      const routerCfg = await buildRouterConfig(currentConfig);
      vaultFolders = Array.from(
        new Set([
          ...struct.projects.map(p => p.folder),
          ...Object.values(routerCfg.typeRoutes),
          ...struct.folders
        ])
      ).sort();
    } catch {}
  }
  res.json({
    items: queue,
    triageQueue: queue,
    count: triageManager.getPendingCount(),
    threshold: currentConfig.decisionConfidenceThreshold || 0.80,
    vaultFolders
  });
});

app.post('/api/decision/triage/answer', async (req, res) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.status(400).json({ error: 'Vault path not configured' });
  }

  const { id, questionIndex, answer } = req.body || {};
  if (!id || questionIndex === undefined || !['yes', 'no'].includes(answer)) {
    return res.status(400).json({ error: 'id, questionIndex and answer ("yes"|"no") are required' });
  }

  try {
    const outcome = await triageManager.answerQuestion(
      id,
      questionIndex,
      answer,
      currentConfig.vaultPath,
      {
        rethinkAlternative: async (item, rejectedFolders, rejectedOptions) => {
          return await rethinkTriageAlternativeForNote(item, rejectedFolders, rejectedOptions);
        }
      }
    );
    if (outcome.resolved) {
      addLog(`[Triage Answered YES] Note "${id}" moved to "${outcome.targetFolder}" with snapshot backup`, 'success');
    } else if (outcome.rethought && outcome.nextQuestion) {
      addLog(`[Triage AI Rethink] Proposed new alternative for "${id}": "${outcome.nextQuestion.targetFolder}"`, 'info');
    } else if (outcome.status === 'manual') {
      addLog(`[Triage Answered NO] All candidate questions exhausted for "${id}". Marked for manual selection.`, 'warn');
    }
    res.json(outcome);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/decision/triage/auto-resolve', async (req, res) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.status(400).json({ error: 'Vault path not configured' });
  }

  const { id } = req.body || {};
  try {
    const queue = triageManager.getQueue();
    const targets = id
      ? queue.filter(i => i.id === id && i.status !== 'resolved')
      : queue.filter(i => i.status !== 'resolved');

    let resolvedCount = 0;
    const results: Array<{ id: string; filename: string; targetFolder: string }> = [];

    for (const item of targets) {
      const rejectedFolders = item.questions.filter(q => q.answered === 'no').map(q => q.targetFolder);
      const rejectedOptions = item.questions.filter(q => q.answered === 'no').map(q => q.targetOption);

      const alt = await rethinkTriageAlternativeForNote(item, rejectedFolders, rejectedOptions);
      const bestFolder =
        alt?.folder ||
        item.questions[item.currentQuestionIndex]?.targetFolder ||
        item.questions[0]?.targetFolder ||
        '03_Knowledge/Essays';

      const resItem = await triageManager.resolveToFolder(item.id, bestFolder, currentConfig.vaultPath);
      if (resItem.resolved) {
        resolvedCount++;
        results.push({ id: item.id, filename: item.filename, targetFolder: resItem.targetFolder });
        addLog(`[Triage Auto-Resolved] "${item.filename}" → "${resItem.targetFolder}"`, 'success');
      }
    }

    await pruneEmptyDirectories(currentConfig.vaultPath, currentConfig.vaultPath);
    res.json({ success: true, resolvedCount, results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/decision/triage/resolve', async (req, res) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.status(400).json({ error: 'Vault path not configured' });
  }

  const parseResult = DecisionTriageResolveSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Validation error',
      details: parseResult.error.issues.map(e => ({ path: e.path.join('.'), message: e.message }))
    });
  }

  const { filePath, targetFolder, applyTag } = parseResult.data;
  if (!isPathInsideVault(filePath, currentConfig.vaultPath)) {
    return res.status(400).json({ error: 'File path is outside vault' });
  }

  const cleanTargetFolder = targetFolder.replace(/\\/g, '/').replace(/^\/+/g, '').replace(/\/+$/g, '');
  if (cleanTargetFolder.includes('..')) {
    return res.status(400).json({ error: 'Invalid target folder path' });
  }

  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(currentConfig.vaultPath, filePath);
  if (!fs.existsSync(fullPath)) {
    decisionTriageQueue = decisionTriageQueue.filter(q => q.filePath !== filePath);
    return res.status(404).json({ error: 'File not found on disk' });
  }

  const oldDir = path.dirname(fullPath);
  const snapshot = await createSnapshotSession(currentConfig.vaultPath, 'triage_manual_resolve');
  await snapshot.backup(fullPath);

  const filename = path.basename(fullPath);
  const targetDir = path.join(currentConfig.vaultPath, cleanTargetFolder);
  const destPath = path.join(targetDir, filename);

  const content = await fsPromises.readFile(fullPath, 'utf-8');
  const parsed = parseNote(content);
  parsed.data.ai_refined = true;
  parsed.data.category = cleanTargetFolder;
  if (applyTag) {
    mergeTags(parsed.data, [applyTag]);
  }
  const updatedContent = serializeNote(parsed.data, parsed.body);

  await fsPromises.mkdir(targetDir, { recursive: true });
  await fsPromises.writeFile(fullPath, updatedContent, 'utf-8');
  if (fullPath !== destPath) {
    await fsPromises.rename(fullPath, destPath);
    await pruneEmptyParentDirs(currentConfig.vaultPath, oldDir);
    addLog(`[Triage Resolved] Moved "${filename}" -> "${cleanTargetFolder}"`, 'success');
  }

  for (const qItem of triageManager.getQueue()) {
    if (qItem.filePath === fullPath || qItem.filePath === filePath || qItem.filename === filename) {
      qItem.status = 'resolved';
      qItem.resolvedFolder = cleanTargetFolder;
      qItem.filePath = destPath;
    }
  }
  decisionTriageQueue = decisionTriageQueue.filter(q => q.filePath !== filePath && q.filePath !== fullPath);
  res.json({ success: true, message: `Moved to ${cleanTargetFolder}` });
});

app.post(['/api/decision/batch-triage', '/api/decision/fast-route-vault'], async (req, res) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.status(400).json({ error: 'Vault path not configured' });
  }
  if (!currentConfig.decisionModelUrl) {
    return res.status(400).json({ error: 'Decision model URL not configured' });
  }

  const isJevOnline = await isDecisionServerReachable(currentConfig.decisionModelUrl, 2000);
  if (!isJevOnline) {
    addLog(`[Jev Triage Aborted] Decision server is not reachable at ${currentConfig.decisionModelUrl}.`, 'error');
    return res.status(503).json({
      error: `Jev Decision Server is offline at ${currentConfig.decisionModelUrl}. Start it before running batch triage.`
    });
  }

  const forceAll = !!req.body?.force;
  const candidateFiles = await getFilesRecursively(currentConfig.vaultPath, [], forceAll, false);
  const threshold = req.body?.threshold || currentConfig.decisionConfidenceThreshold || 0.80;
  const routerConfig = await buildRouterConfig(currentConfig, threshold);

  let processedCount = 0;
  let routedCount = 0;
  let triagedCount = 0;

  addLog(
    `Starting Hierarchical Jev Triage on ${candidateFiles.length} unrefined notes (Threshold: ${Math.round(threshold * 100)}%)...`,
    'info'
  );

  const shouldMove = !!(currentConfig.autoMoveEnabled || req.body?.forceMove);
  const batchSnapshot = shouldMove
    ? createSnapshotSession(currentConfig.vaultPath, 'hierarchical_batch_route')
    : null;

  for (let idx = 0; idx < candidateFiles.length; idx++) {
    if (isShuttingDown) {
      addLog('[Jev Triage] Interrupted due to server shutdown.', 'warn');
      break;
    }

    const filePath = candidateFiles[idx];
    try {
      const content = await fsPromises.readFile(filePath, 'utf-8');
      const parsed = parseNote(content);
      if (!forceAll && parsed.data.ai_refined) continue;

      const ghost = checkGhostNote(parsed.body);
      if (ghost.isGhost || parsed.body.trim().length === 0) continue;

      processedCount++;
      const filename = path.basename(filePath);
      const title = (parsed.data.title as string) || filename.replace(/\.md$/i, '');
      const relPath = path.relative(currentConfig.vaultPath, path.dirname(filePath)).replace(/\\/g, '/');

      const routeResult = await routeHierarchical(
        parsed.body,
        filename,
        title,
        routerConfig,
        { timeoutMs: 12000 }
      );

      if (routeResult.isHighConfidence) {
        if (shouldMove && batchSnapshot) {
          await batchSnapshot.backup(filePath);

          parsed.data.ai_refined = true;
          (parsed.data as any).ai_category = routeResult.level1Category;
          if (routeResult.projectLink) {
            (parsed.data as any).project = routeResult.projectLink;
          }
          const serialized = serializeNote(parsed.data, parsed.body);
          const destDir = path.join(currentConfig.vaultPath, routeResult.suggestedFolder);
          await fsPromises.mkdir(destDir, { recursive: true });
          const destPath = path.join(destDir, filename);
          const oldDir = path.dirname(filePath);
          await fsPromises.writeFile(filePath, serialized, 'utf-8');
          if (path.resolve(filePath) !== path.resolve(destPath)) {
            await fsPromises.rename(filePath, destPath);
            triageManager.syncRefinedFile(filePath, destPath, routeResult.suggestedFolder, filename);
            await pruneEmptyParentDirs(currentConfig.vaultPath, oldDir);
          }
        }
        routedCount++;
      } else {
        triagedCount++;
        const candidateFolderSet = new Set<string>();
        const addCandidate = (folderOrOpt: string) => {
          const mapped = routerConfig.typeRoutes[folderOrOpt] || folderOrOpt;
          if (mapped && mapped.trim()) candidateFolderSet.add(mapped.trim());
        };
        addCandidate(routeResult.suggestedFolder);
        if (routeResult.level2Selection && routeResult.level2Selection !== routeResult.level1Category) {
          addCandidate(routeResult.level2Selection);
        }
        for (const fallbackRoute of Object.values(routerConfig.typeRoutes)) {
          if (candidateFolderSet.size >= 3) break;
          addCandidate(fallbackRoute);
        }
        const distinctCandidates = Array.from(candidateFolderSet).slice(0, 3);
        const distribution = distinctCandidates.map((opt, idx) => ({
          letter: String.fromCharCode(65 + idx),
          option: opt,
          probability:
            idx === 0
              ? routeResult.totalConfidence
              : Math.max(0.1, Math.round(((1 - routeResult.totalConfidence) / Math.max(1, distinctCandidates.length - 1)) * 100) / 100)
        }));
        triageManager.enqueue({
          filePath,
          relativePath: relPath,
          filename,
          contentType: routeResult.level1Category,
          confidence: routeResult.totalConfidence,
          topFolder: routeResult.suggestedFolder,
          distribution
        }, routerConfig.typeRoutes);
      }

      if (processedCount % 20 === 0) {
        addLog(
          `[Jev Triage Progress] ${processedCount}/${candidateFiles.length} notes evaluated (${routedCount} high-conf, ${triagedCount} queued for review)...`,
          'info'
        );
        // Yield to event loop so HTTP status/logs requests remain responsive
        await new Promise(r => setImmediate(r));
      }
    } catch (err: any) {
      addLog(`Hierarchical triage failed on ${path.basename(filePath)}: ${err.message}`, 'warn');
    }
  }

  if (shouldMove) {
    try {
      await pruneEmptyDirectories(currentConfig.vaultPath, currentConfig.vaultPath);
    } catch {}
  }

  addLog(`Hierarchical Jev Triage finished: ${processedCount} evaluated, ${routedCount} auto-routed (${Math.round(threshold * 100)}%+ conf), ${triagedCount} queued for review.`, 'success');

  res.json({
    success: true,
    totalEvaluated: processedCount,
    autoRouted: routedCount,
    needsTriage: triagedCount,
    processed: processedCount,
    routed: routedCount,
    triaged: triagedCount,
    message: `Hierarchical triage finished: ${routedCount} notes auto-routed, ${triagedCount} queued for review.`
  });
});

app.post('/api/calibrate', async (req, res) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.status(400).json({ error: 'Vault path not configured' });
  }

  const sampleSize = parseInt(req.body?.sampleSize, 10) || 80;
  const thresholdTarget = req.body?.thresholdTarget || 0.90;

  try {
    addLog(`[Calibration Engine] Running threshold calibration on vault: ${currentConfig.vaultPath} (Target: ${Math.round(thresholdTarget * 100)}% accuracy)...`, 'info');
    const result = await calibrateThreshold({
      vaultPath: currentConfig.vaultPath,
      sampleSize,
      decisionModelUrl: currentConfig.decisionModelUrl,
      thresholdTarget
    });

    if (result.calibrated) {
      addLog(`[Calibration Success] Optimal Tau = ${result.tau} (Accuracy: ${Math.round((result.accuracyAtTau || 0) * 100)}%, Coverage: ${Math.round((result.coverageAtTau || 0) * 100)}%)`, 'success');
      currentConfig.decisionConfidenceThreshold = result.tau;
    } else {
      addLog(`[Calibration Inconclusive] ${result.reason}`, 'warn');
    }

    res.json(result);
  } catch (err: any) {
    addLog(`[Calibration Error] ${err.message}`, 'error');
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects', async (req, res) => {
  try {
    const projects = await loadProjectsRegistry(currentConfig.vaultPath);
    res.json({ projects });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/bootstrap', async (req, res) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.status(400).json({ error: 'Vault path not configured' });
  }

  try {
    const yamlPath = await bootstrapProjectsYaml(currentConfig.vaultPath);
    addLog(`[Projects Registry] Bootstrapped projects.yaml at: 99_System/projects.yaml`, 'success');
    const projects = await loadProjectsRegistry(currentConfig.vaultPath);
    res.json({ success: true, yamlPath, projects });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Directory Revisor & Folder Navigation Endpoints ---

const getVaultFoldersHandler = async (req: express.Request, res: express.Response) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.json({ folders: [] });
  }

  try {
    const folders: string[] = [];
    async function scanFolders(dir: string, depth = 0) {
      if (depth > 5) return;
      let entries: fs.Dirent[] = [];
      try {
        entries = await fsPromises.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        const name = ent.name;
        const lower = name.toLowerCase();
        if (
          name.startsWith('.') ||
          name.startsWith('99_System') ||
          lower === 'node_modules' ||
          lower === 'templates' ||
          lower === 'llm' ||
          lower === 'models' ||
          lower === 'bin' ||
          lower === 'dist' ||
          lower === 'build' ||
          lower === 'venv' ||
          lower === '__pycache__'
        ) {
          continue;
        }
        
        const full = path.join(dir, name);
        const rel = path.relative(currentConfig.vaultPath, full).replace(/\\/g, '/');
        folders.push(rel);
        await scanFolders(full, depth + 1);
      }
    }

    await scanFolders(currentConfig.vaultPath);

    // Ensure core PARA folders exist in list if they exist on disk
    const standardPara = ['01_Projects', '02_Areas', '03_Knowledge', '04_Journal', '05_Resources', '06_Archive'];
    for (const para of standardPara) {
      const pPath = path.join(currentConfig.vaultPath, para);
      if (fs.existsSync(pPath) && !folders.includes(para)) {
        folders.push(para);
      }
    }

    res.json({ folders: folders.sort() });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to scan folders: ${err.message}` });
  }
};

app.get('/api/folders', getVaultFoldersHandler);
app.get('/api/revisor/folders', getVaultFoldersHandler);

app.post('/api/revisor/audit', async (req, res) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.status(400).json({ error: 'Vault path not configured' });
  }

  const parseResult = DirectoryAuditSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Invalid directory path' });
  }

  const { relativeDir, recursive, maxDepth, includeNonMarkdown } = parseResult.data;
  const isRoot = !relativeDir || relativeDir === '.' || relativeDir === 'Whole Vault' || relativeDir === 'Entire Vault' || relativeDir === '';
  const targetDir = isRoot ? currentConfig.vaultPath : path.join(currentConfig.vaultPath, relativeDir);

  if (!isPathInsideVault(targetDir, currentConfig.vaultPath, true)) {
    return res.status(400).json({ error: 'Target directory must be inside vault' });
  }
  if (!isRoot && !fs.existsSync(targetDir)) {
    return res.status(400).json({ error: `Directory "${relativeDir}" does not exist in vault` });
  }

  const displayDir = isRoot ? 'Whole Vault (Root & all folders)' : relativeDir;
  addLog(`[Directory Revisor] Auditing "${displayDir}" (recursive: ${recursive ?? true}, depth: ${maxDepth ?? 10}) for project clustering, subfolders & junk...`, 'info');

  try {
    const report = await auditDirectoryProject({
      vaultPath: currentConfig.vaultPath,
      relativeDir: isRoot ? '' : relativeDir,
      recursive,
      maxDepth,
      includeNonMarkdown,
      llamaUrl: currentConfig.llamaUrl,
      decisionModelUrl: currentConfig.decisionModelUrl,
      timeoutSeconds: 30
    });

    addLog(`[Directory Revisor] "${displayDir}": ${report.totalFiles} files across ${report.totalSubfoldersScanned} subfolders. ${report.outliersCount} outliers, ${report.rawDocsCount} raw docs, ${report.junkCount} junk items.`, 'success');
    res.json(report);
  } catch (err: any) {
    addLog(`[Directory Revisor] Audit failed on "${displayDir}": ${err.message}`, 'error');
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/revisor/apply', async (req, res) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.status(400).json({ error: 'Vault path not configured' });
  }

  const parseResult = ApplyRevisionSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Invalid revision payload', details: parseResult.error.issues });
  }

  if (!currentConfig.autoMoveEnabled && !parseResult.data.confirm) {
    return res.status(403).json({
      error: 'Safety Gate C0: autoMoveEnabled is disabled in settings. Explicit confirmation required to move files.',
      requireConfirmation: true
    });
  }

  const { itemsToMove, cleanupEmptyFolders } = parseResult.data;
  const snapshotId = `directory_revision_${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const snapshot = createSnapshotSession(currentConfig.vaultPath, snapshotId);

  try {
    const result = await applyRevisionPlan({
      vaultPath: currentConfig.vaultPath,
      itemsToMove,
      cleanupEmptyFolders,
      snapshot
    });

    addLog(`[Directory Revisor] Reorganization done: ${result.movedCount} moved, ${result.convertedCount} converted to MD, ${result.deletedJunkCount} junk removed, ${result.prunedFoldersCount} empty folders pruned. (Snapshot: ${snapshot.sessionId})`, 'success');
    res.json({
      success: result.success,
      movedCount: result.movedCount,
      convertedCount: result.convertedCount,
      deletedJunkCount: result.deletedJunkCount,
      prunedFoldersCount: result.prunedFoldersCount,
      errors: result.errors,
      snapshotId: snapshot.sessionId
    });
  } catch (err: any) {
    addLog(`[Directory Revisor] Failed applying revision plan: ${err.message}`, 'error');
    res.status(500).json({ error: err.message });
  }
});

// --- Knowledge Base Explorer & Search Endpoints ---

app.get('/api/vault/notes', async (req, res) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.json({ notes: [], total: 0, allTags: [], allFolders: [], notConfigured: true });
  }

  try {
    const q = ((req.query.q as string) || '').toLowerCase().trim();
    const folderFilter = (req.query.folder as string) || '';
    const tagFilter = ((req.query.tag as string) || '').toLowerCase().replace(/^#/, '');
    const hideGhosts = req.query.hideGhosts === 'true';

    const notes: Array<{
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
    }> = [];

    const allTags = new Set<string>();

    async function walk(currentDir: string, depth = 0) {
      if (depth > 6) return;
      let entries: fs.Dirent[] = [];
      try {
        entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const ent of entries) {
        const lower = ent.name.toLowerCase();
        if (
          ent.name.startsWith('.') ||
          ent.name === '99_System' ||
          lower === 'node_modules' ||
          lower === 'templates' ||
          lower === 'llm' ||
          lower === 'models' ||
          lower === 'bin' ||
          lower === 'dist' ||
          lower === 'build' ||
          lower === 'venv' ||
          lower === '__pycache__'
        ) {
          continue;
        }
        const full = path.join(currentDir, ent.name);
        const rel = path.relative(currentConfig.vaultPath, full).replace(/\\/g, '/');

        if (ent.isDirectory()) {
          await walk(full, depth + 1);
        } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
          try {
            const stat = await fsPromises.stat(full);
            const content = await fsPromises.readFile(full, 'utf-8');
            const parsed = parseNote(content);
            const title = (parsed.data.title as string) || ent.name.replace(/\.md$/i, '');
            const rawTags = sanitizeTagList(
              Array.isArray(parsed.data.tags) ? parsed.data.tags.map(String) : [],
              { allowSingleLetter: true }
            );
            const category = (parsed.data.category as string) || (path.dirname(rel) === '.' ? 'Root' : path.dirname(rel));
            const lang = detectDocumentLanguage(parsed.body, ent.name);
            const ghost = checkGhostNote(parsed.body);

            const wikilinkMatches = content.match(/\[\[(.*?)\]\]/g) || [];
            const wikilinks = Array.from(new Set(wikilinkMatches.map(w => w.slice(2, -2).split('|')[0].trim())));

            for (const t of rawTags) {
              const cleanedTag = t.replace(/^#/, '');
              if (cleanedTag) allTags.add(cleanedTag);
            }

            if (hideGhosts && ghost.isGhost) {
              continue;
            }

            if (folderFilter && folderFilter !== 'all' && folderFilter !== 'Whole Vault') {
              if (!rel.startsWith(folderFilter)) continue;
            }

            if (tagFilter) {
              const hasTag = rawTags.some(t => t.toLowerCase().replace(/^#/, '') === tagFilter);
              if (!hasTag) continue;
            }

            if (q) {
              const matchTitle = title.toLowerCase().includes(q);
              const matchFilename = ent.name.toLowerCase().includes(q);
              const matchContent = parsed.body.toLowerCase().includes(q);
              const matchTags = rawTags.some(t => t.toLowerCase().includes(q));
              if (!matchTitle && !matchFilename && !matchContent && !matchTags) {
                continue;
              }
            }

            const cleanSnippet = safeTruncateHeadTail(parsed.body.replace(/[#*`_]/g, ' '), 280, 0.8).trim();

            notes.push({
              id: rel,
              filename: ent.name,
              relativePath: rel,
              title,
              tags: rawTags,
              category,
              language: lang.primary,
              snippet: cleanSnippet || title,
              sizeBytes: stat.size,
              modifiedTime: stat.mtime.toISOString(),
              isGhost: ghost.isGhost,
              ghostReason: ghost.reason,
              wikilinks
            });
          } catch {}
        }
      }
    }

    await walk(currentConfig.vaultPath);

    notes.sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime());

    res.json({
      total: notes.length,
      tags: Array.from(allTags).sort(),
      notes: notes.slice(0, 300)
    });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to load notes: ${err.message}` });
  }
});

app.get('/api/vault/note', async (req, res) => {
  if (!currentConfig.vaultPath) return res.status(400).json({ error: 'Vault path not configured' });
  const relPath = req.query.path as string;
  if (!relPath) return res.status(400).json({ error: 'Path parameter is required' });

  const fullPath = path.join(currentConfig.vaultPath, relPath);
  if (!isPathInsideVault(fullPath, currentConfig.vaultPath, false)) {
    return res.status(400).json({ error: 'File path is outside vault' });
  }
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'Note not found on disk' });
  }

  try {
    const stat = await fsPromises.stat(fullPath);
    const content = await fsPromises.readFile(fullPath, 'utf-8');
    const parsed = parseNote(content);
    const ghost = checkGhostNote(parsed.body);
    const lang = detectDocumentLanguage(parsed.body, path.basename(fullPath));

    const wikilinkMatches = content.match(/\[\[(.*?)\]\]/g) || [];
    const wikilinks = Array.from(new Set(wikilinkMatches.map(w => w.slice(2, -2).split('|')[0].trim())));

    res.json({
      relativePath: relPath,
      filename: path.basename(fullPath),
      fullPath,
      frontmatter: parsed.data,
      body: parsed.body,
      rawContent: content,
      isGhost: ghost.isGhost,
      ghostReason: ghost.reason,
      language: lang.primary,
      sizeBytes: stat.size,
      modifiedTime: stat.mtime.toISOString(),
      wikilinks
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/vault/note/save', async (req, res) => {
  if (!currentConfig.vaultPath) return res.status(400).json({ error: 'Vault path not configured' });
  const { path: relPath, frontmatter, body } = req.body || {};
  if (!relPath) return res.status(400).json({ error: 'Note path required' });

  const fullPath = path.join(currentConfig.vaultPath, relPath);
  if (!isPathInsideVault(fullPath, currentConfig.vaultPath, false)) {
    return res.status(400).json({ error: 'File path outside vault' });
  }

  try {
    const cleanFm = { ...(frontmatter || {}) };
    if (Array.isArray(cleanFm.tags)) {
      cleanFm.tags = sanitizeTagList(cleanFm.tags.map(String), { allowSingleLetter: true });
    }
    const updatedContent = serializeNote(cleanFm, body || '');
    await fsPromises.writeFile(fullPath, updatedContent, 'utf-8');
    addLog(`[Note Saved] Updated "${relPath}"`, 'success');
    res.json({ success: true, relativePath: relPath });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/vault/note/create', async (req, res) => {
  if (!currentConfig.vaultPath) return res.status(400).json({ error: 'Vault path not configured' });
  const { title, folder, tags, body } = req.body || {};
  const cleanTitle = String(title || 'Untitled Note')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim();
  const targetFolder = String(folder || '01_Projects/Active')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');

  const targetDir = targetFolder
    ? path.join(currentConfig.vaultPath, targetFolder)
    : currentConfig.vaultPath;
  const fullPath = path.join(targetDir, `${cleanTitle}.md`);

  if (!isPathInsideVault(fullPath, currentConfig.vaultPath)) {
    return res.status(400).json({ error: 'File path outside vault' });
  }

  try {
    await fsPromises.mkdir(targetDir, { recursive: true });
    const rawTags = sanitizeTagList(
      Array.isArray(tags)
        ? tags.map(String)
        : typeof tags === 'string'
        ? tags.split(',').map(s => s.trim().replace(/^#+/, '')).filter(Boolean)
        : [],
      { allowSingleLetter: false }
    );
    const bodyText = String(body || `# ${cleanTitle}\n\n`);
    const tagsWithLang = ensureLanguageTags(rawTags, bodyText, `${cleanTitle}.md`);

    const content = serializeNote(
      {
        title: cleanTitle,
        category: targetFolder || 'Root',
        tags: tagsWithLang,
        created_at: new Date().toISOString().slice(0, 10),
        ai_refined: true
      },
      bodyText
    );
    await fsPromises.writeFile(fullPath, content, 'utf-8');
    const relCreated = path.relative(currentConfig.vaultPath, fullPath).replace(/\\/g, '/');
    addLog(`[Note Created] Created "${relCreated}"`, 'success');
    res.json({ success: true, relativePath: relCreated, title: cleanTitle });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

let inMemoryTaxonomyOverride: VaultTagTaxonomyConfig | null = null;

async function getActiveVaultTaxonomyConfig(): Promise<VaultTagTaxonomyConfig> {
  const hasVault = Boolean(currentConfig.vaultPath && fs.existsSync(currentConfig.vaultPath));
  if (hasVault) {
    const projects = await loadProjectsRegistry(currentConfig.vaultPath);
    const projectsRoot = await detectProjectsRootFolder(currentConfig.vaultPath);
    return loadVaultTagTaxonomyConfig(currentConfig.vaultPath, projects, projectsRoot);
  }
  if (inMemoryTaxonomyOverride) {
    return inMemoryTaxonomyOverride;
  }
  return loadVaultTagTaxonomyConfig(undefined, []);
}

app.get('/api/tags/taxonomy', async (req, res) => {
  try {
    const cfg = await getActiveVaultTaxonomyConfig();
    res.json(cfg);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tags/taxonomy', async (req, res) => {
  const { action, axisId, tag, projectProfile, routeTag, targetFolder } = req.body || {};
  if (!action) {
    return res.status(400).json({ error: 'action is required' });
  }

  try {
    const cfg = await getActiveVaultTaxonomyConfig();

    if (action === 'add' || action === 'remove') {
      if (!axisId || !tag) {
        return res.status(400).json({ error: 'axisId and tag are required' });
      }
      const targetAxis = cfg.axes.find(a => a.id === axisId);
      if (!targetAxis) {
        return res.status(404).json({ error: `Taxonomy axis "${axisId}" not found` });
      }
      const cleanTag = normalizeToCanonicalTag(String(tag).trim().replace(/^#+/, '').trim());
      if (!cleanTag) {
        return res.status(400).json({ error: 'Valid tag is required' });
      }
      if (action === 'add') {
        const formatted = cleanTag;
        if (!targetAxis.tags.some(t => t.toLowerCase() === formatted.toLowerCase())) {
          targetAxis.tags.push(formatted);
        }
        if (targetAxis.id === 'project') {
          const pName = formatted;
          const pRoot = currentConfig.vaultPath ? await detectProjectsRootFolder(currentConfig.vaultPath) : '01_Projects';
          if (!cfg.projectProfiles.some(p => p.projectTag.toLowerCase() === formatted.toLowerCase())) {
            cfg.projectProfiles.push({
              id: pName,
              projectTag: formatted,
              targetFolder: `${pRoot}/${pName}`,
              associatedTags: [formatted],
              aliases: [pName, pName.replace(/[-_]+/g, ' ')]
            });
          }
          if (!cfg.tagRoutes[formatted]) {
            cfg.tagRoutes[formatted] = `${pRoot}/${pName}`;
          }
        }
        addLog(`[Tag Taxonomy] Added clean tag "#${formatted}" to ${targetAxis.label}`, 'success');
      } else {
        targetAxis.tags = targetAxis.tags.filter(t => t.toLowerCase() !== cleanTag.toLowerCase());
        addLog(`[Tag Taxonomy] Removed tag "#${cleanTag}" from ${targetAxis.label}`, 'info');
      }
    } else if (action === 'upsert_project_profile' && projectProfile) {
      const id = String(projectProfile.id || '').trim();
      const projectTag = normalizeToCanonicalTag(String(projectProfile.projectTag || id).trim().replace(/^#+/, '')) || id;
      const pRoot = currentConfig.vaultPath ? await detectProjectsRootFolder(currentConfig.vaultPath) : '01_Projects';
      const folder = String(projectProfile.targetFolder || `${pRoot}/${id}`).trim();
      const associatedTags = Array.isArray(projectProfile.associatedTags)
        ? projectProfile.associatedTags
            .map((t: unknown) => normalizeToCanonicalTag(String(t).trim().replace(/^#+/, '')))
            .filter(Boolean)
        : [projectTag];
      if (!associatedTags.some((t: string) => t.toLowerCase() === projectTag.toLowerCase())) {
        associatedTags.unshift(projectTag);
      }
      const aliases = Array.isArray(projectProfile.aliases)
        ? projectProfile.aliases.map((a: unknown) => String(a).trim()).filter(Boolean)
        : [id, id.replace(/[-_]+/g, ' ')];

      const idx = cfg.projectProfiles.findIndex(p => p.projectTag.toLowerCase() === projectTag.toLowerCase());
      const updatedProf = { id, projectTag, targetFolder: folder, associatedTags, aliases };
      if (idx >= 0) {
        cfg.projectProfiles[idx] = updatedProf;
      } else {
        cfg.projectProfiles.push(updatedProf);
      }
      cfg.tagRoutes[projectTag] = folder;
      const projAxis = cfg.axes.find(a => a.id === 'project');
      if (projAxis && !projAxis.tags.some(t => t.toLowerCase() === projectTag.toLowerCase())) {
        projAxis.tags.push(projectTag);
      }
      addLog(`[Tag Taxonomy] Saved project profile "#${projectTag}" -> "${folder}" (${associatedTags.length} tags)`, 'success');
    } else if (action === 'remove_project_profile' && tag) {
      const clean = normalizeToCanonicalTag(String(tag).trim().replace(/^#+/, '')).toLowerCase();
      cfg.projectProfiles = cfg.projectProfiles.filter(p => p.projectTag.toLowerCase() !== clean && p.id.toLowerCase() !== clean);
      addLog(`[Tag Taxonomy] Removed project profile "${tag}"`, 'info');
    } else if (action === 'set_route' && routeTag && targetFolder) {
      const cleanTag = normalizeToCanonicalTag(String(routeTag).trim().replace(/^#+/, ''));
      const cleanFolder = String(targetFolder).trim().replace(/^\/+|\/+$/g, '');
      cfg.tagRoutes[cleanTag] = cleanFolder;
      const prof = cfg.projectProfiles.find(p => p.projectTag.toLowerCase() === cleanTag.toLowerCase());
      if (prof) prof.targetFolder = cleanFolder;
      addLog(`[Tag Taxonomy] Mapped tag "#${cleanTag}" -> directory "${cleanFolder}"`, 'success');
    } else if (action === 'remove_route' && routeTag) {
      const cleanTag = normalizeToCanonicalTag(String(routeTag).trim().replace(/^#+/, ''));
      delete cfg.tagRoutes[cleanTag];
      addLog(`[Tag Taxonomy] Removed custom directory route for "#${cleanTag}"`, 'info');
    } else {
      return res.status(400).json({ error: `Unsupported taxonomy action "${action}"` });
    }

    if (currentConfig.vaultPath && fs.existsSync(currentConfig.vaultPath)) {
      await saveVaultTagTaxonomyConfig(currentConfig.vaultPath, cfg);
    } else {
      inMemoryTaxonomyOverride = { ...cfg, updatedAt: new Date().toISOString() };
    }
    res.json({ success: true, ...cfg });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tags/taxonomy/import', async (req, res) => {
  const { content, vaultFilePath, mode = 'merge' } = req.body || {};
  try {
    let rawText = typeof content === 'string' ? content : '';
    if (!rawText && vaultFilePath && currentConfig.vaultPath) {
      const candidatePath = path.isAbsolute(vaultFilePath)
        ? vaultFilePath
        : path.join(currentConfig.vaultPath, vaultFilePath);
      if (!isPathInsideVault(candidatePath, currentConfig.vaultPath, false) || !fs.existsSync(candidatePath)) {
        return res.status(404).json({ error: `File "${vaultFilePath}" not found inside vault` });
      }
      rawText = await fsPromises.readFile(candidatePath, 'utf-8');
    }

    if (!rawText || !rawText.trim()) {
      return res.status(400).json({ error: 'Tag list content or valid vaultFilePath is required for import' });
    }

    const existingConfig = await getActiveVaultTaxonomyConfig();
    const projectsRoot = currentConfig.vaultPath
      ? await detectProjectsRootFolder(currentConfig.vaultPath)
      : '01_Projects';

    const parsed = parseTagTaxonomyImport(rawText, {
      existingConfig,
      mode: mode === 'replace' ? 'replace' : 'merge',
      projectsRoot
    });

    const newConfig: VaultTagTaxonomyConfig = {
      updatedAt: new Date().toISOString(),
      axes: parsed.axes,
      projectProfiles: parsed.projectProfiles,
      tagRoutes: parsed.tagRoutes
    };

    if (currentConfig.vaultPath && fs.existsSync(currentConfig.vaultPath)) {
      await saveVaultTagTaxonomyConfig(currentConfig.vaultPath, newConfig);
    } else {
      inMemoryTaxonomyOverride = newConfig;
    }

    addLog(
      `[Tag Taxonomy Import] Imported ${parsed.importedTagsCount} new tag(s) and updated ${parsed.importedProjectsCount} project profile(s) (mode: ${mode}).`,
      'success'
    );

    res.json({
      success: true,
      importedTagsCount: parsed.importedTagsCount,
      importedProjectsCount: parsed.importedProjectsCount,
      ...newConfig,
      message: `Imported ${parsed.importedTagsCount} new tag(s) and ${parsed.importedProjectsCount} project profile(s).`
    });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to import tag taxonomy: ${err.message}` });
  }
});

app.get('/api/tags/taxonomy/export', async (req, res) => {
  try {
    const cfg = await getActiveVaultTaxonomyConfig();
    const format = String(req.query.format || 'md').toLowerCase();
    const markdown = exportTagTaxonomyToMarkdown(cfg);
    res.json({
      format,
      filename: format === 'json' ? 'tag_taxonomy.json' : 'project-hashtags-expanded.md',
      markdown,
      taxonomy: cfg
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/vault/note/tags', async (req, res) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.status(400).json({ error: 'Vault path not configured' });
  }
  const { path: relPath, action, tag, tags, routeByTags } = req.body || {};
  if (!relPath || !['add', 'remove', 'redefine', 'redefine_and_route', 'set'].includes(action)) {
    return res.status(400).json({
      error: 'path and valid action ("add"|"remove"|"redefine"|"redefine_and_route"|"set") required'
    });
  }

  const fullPath = path.join(currentConfig.vaultPath, relPath);
  if (!isPathInsideVault(fullPath, currentConfig.vaultPath, false) || !fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'Note not found inside vault' });
  }

  try {
    const rawContent = await fsPromises.readFile(fullPath, 'utf-8');
    const parsed = parseNote(rawContent);
    const currentTags = sanitizeTagList(
      Array.isArray(parsed.data.tags) ? parsed.data.tags.map(String) : [],
      { allowSingleLetter: false }
    );

    const projects = await loadProjectsRegistry(currentConfig.vaultPath);
    const projectsRoot = await detectProjectsRootFolder(currentConfig.vaultPath);
    const taxonomyCfg = await loadVaultTagTaxonomyConfig(currentConfig.vaultPath, projects, projectsRoot);
    const folderRel = path.dirname(relPath).replace(/\\/g, '/');
    const noteTitle = String(parsed.data.title || path.basename(fullPath, '.md'));

    let updatedTags: string[] = [...currentTags];
    let matchedProject: string | null = null;

    if (action === 'add' && tag) {
      const clean = String(tag).trim().replace(/^#+/, '').trim();
      updatedTags = sanitizeTagList([...currentTags, clean], { allowSingleLetter: false });
    } else if (action === 'remove' && tag) {
      const cleanLower = String(tag).trim().replace(/^#+/, '').trim().toLowerCase();
      updatedTags = currentTags.filter(t => t.toLowerCase() !== cleanLower);
    } else if (action === 'set' && Array.isArray(tags)) {
      updatedTags = sanitizeTagList(tags.map(String), { allowSingleLetter: false });
    } else if (action === 'redefine' || action === 'redefine_and_route') {
      const inlineAndFmTags = extractTags(
        parsed.hadFrontmatter ? serializeNote(parsed.data, '') : '',
        parsed.body,
        path.basename(fullPath)
      );
      const mergedRawTags = Array.from(new Set([...currentTags, ...inlineAndFmTags]));
      const projInf = inferProjectFromNoteAndTaxonomy({
        filename: path.basename(fullPath),
        title: noteTitle,
        body: parsed.body,
        existingTags: mergedRawTags,
        folder: folderRel === '.' ? '' : folderRel,
        discoveredProjects: projects,
        projectProfiles: taxonomyCfg.projectProfiles,
        projectsRoot
      });
      if (projInf.matchedProfile) {
        matchedProject = projInf.matchedProfile.id;
        parsed.data.project = `[[${projInf.matchedProfile.id}]]`;
      }

      updatedTags = curateOrthogonalTags({
        rawTags: mergedRawTags,
        title: noteTitle,
        filename: path.basename(fullPath),
        body: parsed.body,
        folder: folderRel === '.' ? '' : folderRel,
        discoveredProjects: projects,
        projectProfiles: taxonomyCfg.projectProfiles,
        customAxes: taxonomyCfg.axes,
        replaceExisting: true,
        maxTags: 9
      });
      updatedTags = ensureLanguageTags(updatedTags, parsed.body, path.basename(fullPath));
    }

    parsed.data.tags = updatedTags;

    let finalRelPath = relPath.replace(/\\/g, '/');
    let movedToFolder: string | null = null;

    if (action === 'redefine_and_route' || routeByTags) {
      const routeDecision = resolveDirectoryFromTags({
        tags: updatedTags,
        projectProfiles: taxonomyCfg.projectProfiles,
        discoveredProjects: projects,
        tagRoutes: taxonomyCfg.tagRoutes,
        projectsRoot
      });
      const cleanTarget = routeDecision.targetFolder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      if (routeDecision.matchedProjectId && !matchedProject) {
        matchedProject = routeDecision.matchedProjectId;
        parsed.data.project = `[[${routeDecision.matchedProjectId}]]`;
      }
      parsed.data.category = cleanTarget;
      parsed.data.ai_refined = true;

      const serialized = serializeNote(parsed.data, parsed.body);
      await fsPromises.writeFile(fullPath, serialized, 'utf-8');

      const currentDirNorm = (folderRel === '.' ? '' : folderRel).toLowerCase();
      if (cleanTarget && cleanTarget.toLowerCase() !== currentDirNorm) {
        const destDir = path.join(currentConfig.vaultPath, cleanTarget);
        if (isPathInsideVault(destDir, currentConfig.vaultPath)) {
          await fsPromises.mkdir(destDir, { recursive: true });
          const filename = path.basename(fullPath);
          let destPath = path.join(destDir, filename);
          let counter = 1;
          while (fs.existsSync(destPath) && path.resolve(destPath) !== path.resolve(fullPath)) {
            const ext = path.extname(filename);
            const base = path.basename(filename, ext);
            destPath = path.join(destDir, `${base} ${counter}${ext}`);
            counter++;
          }
          if (path.resolve(fullPath) !== path.resolve(destPath)) {
            const oldDir = path.dirname(fullPath);
            await fsPromises.rename(fullPath, destPath);
            await pruneEmptyParentDirs(currentConfig.vaultPath, oldDir);
            finalRelPath = path.relative(currentConfig.vaultPath, destPath).replace(/\\/g, '/');
            movedToFolder = cleanTarget;
            triageManager.syncRefinedFile(fullPath, destPath, cleanTarget, path.basename(destPath));
          }
        }
      }
      addLog(
        `[Tag Project Router] "${path.basename(fullPath)}" -> project=${matchedProject || 'general'}, folder="${cleanTarget}", tags=[${updatedTags.join(', ')}]`,
        'success'
      );
    } else {
      const serialized = serializeNote(parsed.data, parsed.body);
      await fsPromises.writeFile(fullPath, serialized, 'utf-8');
      addLog(`[Note Tags] (${action}) on "${relPath}" -> [${updatedTags.join(', ')}]`, 'success');
    }

    res.json({
      success: true,
      path: finalRelPath,
      newRelativePath: finalRelPath,
      movedToFolder,
      matchedProject,
      tags: updatedTags
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const handleClassifyTagsAndRouteVault = async (req: express.Request, res: express.Response) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.status(400).json({ error: 'Vault path not configured' });
  }

  const dryRun = Boolean(req.body?.dryRun);
  const routeFiles =
    req.body?.routeFiles !== undefined
      ? Boolean(req.body.routeFiles)
      : req.path.includes('classify-and-route');
  const folderFilter = typeof req.body?.folder === 'string' ? req.body.folder.trim() : '';

  try {
    const projects = await loadProjectsRegistry(currentConfig.vaultPath);
    const projectsRoot = await detectProjectsRootFolder(currentConfig.vaultPath);
    const taxonomyCfg = await loadVaultTagTaxonomyConfig(currentConfig.vaultPath, projects, projectsRoot);

    const scanRoot =
      folderFilter && folderFilter !== 'all' && folderFilter !== 'Whole Vault'
        ? path.join(currentConfig.vaultPath, folderFilter)
        : currentConfig.vaultPath;

    if (!isPathInsideVault(scanRoot, currentConfig.vaultPath, true) || !fs.existsSync(scanRoot)) {
      return res.status(400).json({ error: 'Invalid target scan folder' });
    }

    const allFiles = await getFilesRecursively(scanRoot, [], true, true);
    const snapshot = !dryRun
      ? createSnapshotSession(
          currentConfig.vaultPath,
          `taxonomy_route_${new Date().toISOString().replace(/[:.]/g, '-')}`
        )
      : null;

    let updatedCount = 0;
    let movedCount = 0;
    let projectsMatchedCount = 0;
    const affectedDirs = new Set<string>();
    const items: Array<{
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
    }> = [];

    for (const filePath of allFiles) {
      try {
        const content = await fsPromises.readFile(filePath, 'utf-8');
        const parsed = parseNote(content);
        if (!parsed.body.trim()) continue;

        const ghost = checkGhostNote(parsed.body);
        if (ghost.isGhost) continue;

        const rel = path.relative(currentConfig.vaultPath, filePath).replace(/\\/g, '/');
        const folderRel = path.dirname(rel).replace(/\\/g, '/');
        const currentFolder = folderRel === '.' ? '' : folderRel;
        const filename = path.basename(filePath);
        const noteTitle = String(parsed.data.title || path.basename(filePath, '.md'));

        const fmTags = Array.isArray(parsed.data.tags) ? parsed.data.tags.map(String) : [];
        const inlineTags = extractTags(
          parsed.hadFrontmatter ? serializeNote(parsed.data, '') : '',
          parsed.body,
          filename
        );
        const combinedRawTags = Array.from(new Set([...fmTags, ...inlineTags]));

        // 1. Determine Project Affiliation from Tags, Aliases, and Content
        const projInference = inferProjectFromNoteAndTaxonomy({
          filename,
          title: noteTitle,
          body: parsed.body,
          existingTags: combinedRawTags,
          folder: currentFolder,
          discoveredProjects: projects,
          projectProfiles: taxonomyCfg.projectProfiles,
          projectsRoot
        });

        // 2. Curate Orthogonal Taxonomy Tags (L0-L7) + Project Tags
        const curated = curateOrthogonalTags({
          rawTags: combinedRawTags,
          title: noteTitle,
          filename,
          body: parsed.body,
          folder: currentFolder,
          discoveredProjects: projects,
          projectProfiles: taxonomyCfg.projectProfiles,
          customAxes: taxonomyCfg.axes,
          replaceExisting: true,
          maxTags: 9
        });
        const finalTags = ensureLanguageTags(curated, parsed.body, filename);

        // 3. Determine Target Directory from Updated Tags
        const routeDecision = resolveDirectoryFromTags({
          tags: finalTags,
          projectProfiles: taxonomyCfg.projectProfiles,
          discoveredProjects: projects,
          tagRoutes: taxonomyCfg.tagRoutes,
          projectsRoot,
          fallbackFolder: currentFolder || '03_Knowledge/Essays'
        });

        const matchedProject =
          projInference.matchedProfile?.id || routeDecision.matchedProjectId || null;
        if (matchedProject) {
          projectsMatchedCount++;
        }

        const cleanTargetFolder = routeDecision.targetFolder
          .replace(/\\/g, '/')
          .replace(/^\/+|\/+$/g, '');
        const shouldMoveFile =
          routeFiles &&
          Boolean(cleanTargetFolder) &&
          cleanTargetFolder.toLowerCase() !== currentFolder.toLowerCase();

        let finalNewRelPath = shouldMoveFile ? `${cleanTargetFolder}/${filename}` : rel;
        let didMove = false;

        if (!dryRun && snapshot) {
          await snapshot.backup(filePath);
          parsed.data.tags = finalTags;
          if (matchedProject) {
            parsed.data.project = `[[${matchedProject}]]`;
          }
          if (routeFiles && cleanTargetFolder) {
            parsed.data.category = cleanTargetFolder;
            parsed.data.ai_refined = true;
          }
          const serialized = serializeNote(parsed.data, parsed.body);
          await fsPromises.writeFile(filePath, serialized, 'utf-8');
          updatedCount++;

          if (shouldMoveFile) {
            const destDir = path.join(currentConfig.vaultPath, cleanTargetFolder);
            if (isPathInsideVault(destDir, currentConfig.vaultPath)) {
              await fsPromises.mkdir(destDir, { recursive: true });
              let destPath = path.join(destDir, filename);
              let counter = 1;
              while (fs.existsSync(destPath) && path.resolve(destPath) !== path.resolve(filePath)) {
                const ext = path.extname(filename);
                const base = path.basename(filename, ext);
                destPath = path.join(destDir, `${base} ${counter}${ext}`);
                counter++;
              }
              if (path.resolve(filePath) !== path.resolve(destPath)) {
                affectedDirs.add(path.dirname(filePath));
                await snapshot.recordMove?.(filePath, destPath);
                await fsPromises.rename(filePath, destPath);
                triageManager.syncRefinedFile(filePath, destPath, cleanTargetFolder, path.basename(destPath));
                finalNewRelPath = path.relative(currentConfig.vaultPath, destPath).replace(/\\/g, '/');
                movedCount++;
                didMove = true;
              }
            }
          }
        } else {
          updatedCount++;
          if (shouldMoveFile) {
            movedCount++;
            didMove = true;
          }
        }

        items.push({
          filename,
          oldPath: rel,
          newPath: finalNewRelPath,
          currentFolder: currentFolder || 'Root',
          targetFolder: cleanTargetFolder || currentFolder || 'Root',
          matchedProject,
          matchedByTag: routeDecision.matchedByTag,
          oldTags: fmTags,
          updatedTags: finalTags,
          moved: didMove
        });
      } catch {}
    }

    let prunedFoldersCount = 0;
    if (!dryRun && routeFiles) {
      for (const dir of affectedDirs) {
        try {
          const removed = await pruneEmptyParentDirs(currentConfig.vaultPath, dir);
          prunedFoldersCount += removed.length;
        } catch {}
      }
      try {
        const swept = await pruneEmptyDirectories(currentConfig.vaultPath, currentConfig.vaultPath);
        prunedFoldersCount += swept.length;
      } catch {}
    }

    addLog(
      `[Tag Project Router${dryRun ? ' DRY-RUN' : ''}] Evaluated ${updatedCount} notes: ${projectsMatchedCount} matched to projects, ${movedCount} ${dryRun ? 'to move' : 'moved to target directories'}${prunedFoldersCount > 0 ? `, ${prunedFoldersCount} empty folders pruned` : ''}.`,
      'success'
    );

    res.json({
      success: true,
      dryRun,
      totalScanned: items.length,
      updatedCount,
      projectsMatchedCount,
      movedCount,
      prunedFoldersCount,
      snapshotId: snapshot?.sessionId || null,
      items: items.slice(0, 250),
      message: dryRun
        ? `Preview complete: ${updatedCount} notes analyzed, ${projectsMatchedCount} matched to projects, ${movedCount} will be moved to directories by tags.`
        : `Updated tags on ${updatedCount} notes (${projectsMatchedCount} matched to projects) and routed ${movedCount} files to their target directories.`
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

app.post('/api/vault/tags/reclassify-all', handleClassifyTagsAndRouteVault);
app.post('/api/vault/tags/classify-and-route', handleClassifyTagsAndRouteVault);

app.post('/api/snapshots/rollback', async (req, res) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.status(400).json({ error: 'Vault path not configured' });
  }
  const sessionId = String(req.body?.snapshotId || req.body?.sessionId || '').trim();
  if (!sessionId || sessionId.includes('..') || sessionId.includes('/') || sessionId.includes('\\')) {
    return res.status(400).json({ error: 'Valid snapshotId is required' });
  }

  try {
    const result = await restoreSnapshotSession(currentConfig.vaultPath, sessionId);
    let prunedCount = 0;
    try {
      const swept = await pruneEmptyDirectories(currentConfig.vaultPath, currentConfig.vaultPath);
      prunedCount = swept.length;
    } catch {}

    addLog(
      `[Snapshot Rollback] Restored ${result.restoredCount} file(s) from snapshot "${sessionId}"${prunedCount > 0 ? ` and pruned ${prunedCount} empty folder(s)` : ''}.`,
      'success'
    );
    res.json({
      success: true,
      snapshotId: sessionId,
      restoredCount: result.restoredCount,
      prunedCount,
      errors: result.errors,
      message: `Rolled back snapshot "${sessionId}": restored ${result.restoredCount} file(s) to their original paths and tags.`
    });
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

app.get('/api/vault/clusters', async (_req, res) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.json({
      clusters: [],
      semanticBridges: [],
      totalNotes: 0,
      totalClusters: 0,
      misplacedNotesCount: 0
    });
  }
  try {
    const projects = await loadProjectsRegistry(currentConfig.vaultPath);
    const projectsRoot = await detectProjectsRootFolder(currentConfig.vaultPath);
    const taxonomyCfg = await loadVaultTagTaxonomyConfig(currentConfig.vaultPath, projects, projectsRoot);
    const allFiles = await getFilesRecursively(currentConfig.vaultPath, [], true, true);

    const clusterableNotes: ClusterableNoteInput[] = [];
    for (const filePath of allFiles) {
      try {
        const content = await fsPromises.readFile(filePath, 'utf-8');
        const parsed = parseNote(content);
        if (!parsed.body.trim()) continue;
        const ghost = checkGhostNote(parsed.body);
        if (ghost.isGhost) continue;

        const rel = path.relative(currentConfig.vaultPath, filePath).replace(/\\/g, '/');
        const folderRel = path.dirname(rel).replace(/\\/g, '/');
        const currentFolder = folderRel === '.' ? '' : folderRel;
        const filename = path.basename(filePath);
        const title = String(parsed.data.title || path.basename(filePath, '.md'));
        const fmTags = Array.isArray(parsed.data.tags) ? parsed.data.tags.map(String) : [];
        const inlineTags = extractTags(
          parsed.hadFrontmatter ? serializeNote(parsed.data, '') : '',
          parsed.body,
          filename
        );
        const mergedTags = Array.from(new Set([...fmTags, ...inlineTags]));

        clusterableNotes.push({
          path: rel,
          filename,
          title,
          body: parsed.body,
          folder: currentFolder,
          tags: mergedTags
        });
      } catch {}
    }

    const result = buildSemanticKnowledgeClusters({
      notes: clusterableNotes,
      projectProfiles: taxonomyCfg.projectProfiles,
      discoveredProjects: projects,
      axes: taxonomyCfg.axes,
      tagRoutes: taxonomyCfg.tagRoutes,
      projectsRoot
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/vault/clusters/apply', async (req, res) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.status(400).json({ error: 'Vault path not configured' });
  }
  const { clusterId, routeFiles = true, extraTags = [], overrideFolder } = req.body || {};

  try {
    const projects = await loadProjectsRegistry(currentConfig.vaultPath);
    const projectsRoot = await detectProjectsRootFolder(currentConfig.vaultPath);
    const taxonomyCfg = await loadVaultTagTaxonomyConfig(currentConfig.vaultPath, projects, projectsRoot);
    const allFiles = await getFilesRecursively(currentConfig.vaultPath, [], true, true);

    const clusterableNotes: ClusterableNoteInput[] = [];
    for (const filePath of allFiles) {
      try {
        const content = await fsPromises.readFile(filePath, 'utf-8');
        const parsed = parseNote(content);
        if (!parsed.body.trim()) continue;
        const ghost = checkGhostNote(parsed.body);
        if (ghost.isGhost) continue;

        const rel = path.relative(currentConfig.vaultPath, filePath).replace(/\\/g, '/');
        const folderRel = path.dirname(rel).replace(/\\/g, '/');
        const currentFolder = folderRel === '.' ? '' : folderRel;
        const filename = path.basename(filePath);
        const title = String(parsed.data.title || path.basename(filePath, '.md'));
        const fmTags = Array.isArray(parsed.data.tags) ? parsed.data.tags.map(String) : [];
        const inlineTags = extractTags(
          parsed.hadFrontmatter ? serializeNote(parsed.data, '') : '',
          parsed.body,
          filename
        );
        clusterableNotes.push({
          path: rel,
          filename,
          title,
          body: parsed.body,
          folder: currentFolder,
          tags: Array.from(new Set([...fmTags, ...inlineTags]))
        });
      } catch {}
    }

    const clusterResult = buildSemanticKnowledgeClusters({
      notes: clusterableNotes,
      projectProfiles: taxonomyCfg.projectProfiles,
      discoveredProjects: projects,
      axes: taxonomyCfg.axes,
      tagRoutes: taxonomyCfg.tagRoutes,
      projectsRoot
    });

    const targetClusters = clusterId
      ? clusterResult.clusters.filter(c => c.id === clusterId)
      : clusterResult.clusters;

    if (targetClusters.length === 0) {
      return res.status(404).json({ error: 'Target semantic cluster not found' });
    }

    const snapshot = createSnapshotSession(
      currentConfig.vaultPath,
      `semantic_clusters_${new Date().toISOString().replace(/[:.]/g, '-')}`
    );

    const customCleanTags = Array.isArray(extraTags)
      ? extraTags.map((t: any) => normalizeToCanonicalTag(String(t))).filter(Boolean)
      : [];

    let updatedCount = 0;
    let movedCount = 0;
    const affectedDirs = new Set<string>();

    for (const cluster of targetClusters) {
      for (const member of cluster.notes) {
        const fullPath = path.join(currentConfig.vaultPath, member.path);
        if (!isPathInsideVault(fullPath, currentConfig.vaultPath, false) || !fs.existsSync(fullPath)) continue;

        try {
          const rawContent = await fsPromises.readFile(fullPath, 'utf-8');
          const parsed = parseNote(rawContent);
          await snapshot.backup(fullPath);

          const finalTags = ensureLanguageTags(
            sanitizeTagList([...member.suggestedTags, ...customCleanTags], { allowSingleLetter: false }),
            parsed.body,
            member.filename
          );
          parsed.data.tags = finalTags;
          if (cluster.dominantProject) {
            parsed.data.project = `[[${cluster.dominantProject}]]`;
          }

          const cleanTarget = String(overrideFolder || cluster.recommendedFolder || member.recommendedFolder || '')
            .replace(/\\/g, '/')
            .replace(/^\/+|\/+$/g, '');
          if (cleanTarget) {
            parsed.data.category = cleanTarget;
          }
          parsed.data.ai_refined = true;

          await fsPromises.writeFile(fullPath, serializeNote(parsed.data, parsed.body), 'utf-8');
          updatedCount++;

          const currentFolderNorm = (member.currentFolder === 'Root' ? '' : member.currentFolder)
            .replace(/\\/g, '/')
            .replace(/^\/+|\/+$/g, '')
            .toLowerCase();

          if (routeFiles && cleanTarget && cleanTarget.toLowerCase() !== currentFolderNorm) {
            const destDir = path.join(currentConfig.vaultPath, cleanTarget);
            if (isPathInsideVault(destDir, currentConfig.vaultPath)) {
              await fsPromises.mkdir(destDir, { recursive: true });
              let destPath = path.join(destDir, member.filename);
              let counter = 1;
              while (fs.existsSync(destPath) && path.resolve(destPath) !== path.resolve(fullPath)) {
                const ext = path.extname(member.filename);
                const base = path.basename(member.filename, ext);
                destPath = path.join(destDir, `${base} ${counter}${ext}`);
                counter++;
              }
              if (path.resolve(fullPath) !== path.resolve(destPath)) {
                affectedDirs.add(path.dirname(fullPath));
                await snapshot.recordMove?.(fullPath, destPath);
                await fsPromises.rename(fullPath, destPath);
                triageManager.syncRefinedFile(fullPath, destPath, cleanTarget, path.basename(destPath));
                movedCount++;
              }
            }
          }
        } catch {}
      }
    }

    for (const dir of affectedDirs) {
      try {
        await pruneEmptyParentDirs(currentConfig.vaultPath, dir);
      } catch {}
    }

    addLog(
      `[Semantic Clusters Applied] Updated #tags on ${updatedCount} note(s) and routed ${movedCount} note(s) across ${targetClusters.length} semantic cluster(s).`,
      'success'
    );

    res.json({
      success: true,
      updatedCount,
      movedCount,
      clustersApplied: targetClusters.length,
      snapshotId: snapshot.sessionId,
      message: `Applied clean #tags to ${updatedCount} document(s) and organized ${movedCount} file(s) into their semantic cluster folders.`
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/vault/create-demo', async (_req, res) => {
  try {
    const demoVaultPath = path.join(process.cwd(), 'demo_obsidian_vault');
    const paraFolders = [
      '00_Inbox',
      '00_MOC',
      '01_Projects/Hermes',
      '01_Projects/Neuromicon',
      '01_Projects/UUCPFF',
      '01_Projects/Obsidian-LLM-Pipeline',
      '02_Areas/Business',
      '03_Knowledge/Research',
      '03_Knowledge/Technical',
      '03_Knowledge/Essays',
      '03_Knowledge/Scripts',
      '04_Journal',
      '05_Ideas',
      '06_Archive',
      '99_System'
    ];

    for (const folder of paraFolders) {
      await fsPromises.mkdir(path.join(demoVaultPath, folder), { recursive: true });
    }

    const sampleNotes: Array<{ relPath: string; content: string }> = [
      {
        relPath: '00_Inbox/hermes_multi_agent_memory_routing.md',
        content: `---\ntitle: "Hermes Multi-Agent Memory and Free API Routing"\ntags:\n  - Hermes\n  - agent-orchestration\n  - multi-agent\n---\n# Hermes Multi-Agent Memory and Free API Routing\n\nArchitecture specification for #Hermes covering #memory, #routing, and #local-LLM execution across autonomous agents.\n`
      },
      {
        relPath: '00_Inbox/tuesday_architecture_sync_notes.md',
        content: `---\ntitle: "Заметки со вторничного созвона по архитектуре"\ntags:\n  - meeting\n---\n# Заметки со вторничного созвона по архитектуре\n\nОбсудили оркестрацию автономных мультиагентов в системе Гермес, долговременную эпизодическую память агентов, локальный роутинг запросов через бесплатные API и управление контекстным окном LLM.\n`
      },
      {
        relPath: '00_Inbox/world_1149_protocol_contact_arg.md',
        content: `---\ntitle: "World 1149: Protocol Contact & Defragmentation Scenario"\ntags:\n  - Neuromicon\n  - World-1149\n  - Protocol-Contact\n---\n# World 1149: Protocol Contact & Defragmentation Scenario\n\nTransmedia narrative design for #Neuromicon exploring #Defragmentation, #24+1, and #E=M×C².\n`
      },
      {
        relPath: '00_Inbox/episode_draft_fragment_04.md',
        content: `---\ntitle: "Черновик драматургии четвёртого эпизода"\ntags:\n  - scenario\n---\n# Черновик драматургии четвёртого эпизода\n\nРазвитие трансмедиа сюжета в мире 1149: активация Протокола Контакт и дефрагментация сознания героев через квест в реальности.\n`
      },
      {
        relPath: '00_Inbox/uucpff_festival_curation_network.md',
        content: `---\ntitle: "UUCPFF Film Submission & Creator Distribution Pipeline"\ntags:\n  - UUCPFF\n  - film-festival\n  - curation\n---\n# UUCPFF Film Submission & Creator Distribution Pipeline\n\nOperational workflow for #UUCPFF covering #creator-network, #film-submission, and #distribution.\n`
      },
      {
        relPath: '00_Inbox/semantic_hypergraph_quantization_hypothesis.md',
        content: `---\ntitle: "3-Uniform Semantic Hypergraph & Logprob Quantization"\ntags:\n  - research\n  - semantic-hypergraph\n  - hypothesis\n---\n# 3-Uniform Semantic Hypergraph & Logprob Quantization\n\nResearch model on #semantic-hypergraph and #hypergraph using local Jev logprob primitives (#validation, #P1).\n`
      },
      {
        relPath: '00_Inbox/obsidian_tag_taxonomy_pipeline_spec.md',
        content: `---\ntitle: "Clean Atomic Tag Taxonomy & Semantic Document Clustering"\ntags:\n  - Obsidian-LLM-Pipeline\n  - tagging\n  - file-routing\n---\n# Clean Atomic Tag Taxonomy & Semantic Document Clustering\n\nTechnical specification for #Obsidian-LLM-Pipeline implementing #classification, #tagging, #semantic-ingestion, and #file-routing.\n`
      }
    ];

    for (const note of sampleNotes) {
      const targetFile = path.join(demoVaultPath, note.relPath);
      await fsPromises.writeFile(targetFile, note.content, 'utf-8');
    }

    currentConfig.vaultPath = demoVaultPath;
    await fsPromises.writeFile(CONFIG_FILE, JSON.stringify(currentConfig, null, 2), 'utf-8');
    await bootstrapProjectsYaml(demoVaultPath);

    addLog(`[Demo Vault Ready] Initialized sample Obsidian Vault at "${demoVaultPath}" with 7 sample notes in 00_Inbox.`, 'success');
    res.json({
      success: true,
      vaultPath: demoVaultPath,
      config: currentConfig,
      message: `Sample Obsidian Vault connected at "${demoVaultPath}" with 7 notes ready for Semantic Clustering & Tag Routing.`
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/vault/note/refine-single', async (req, res) => {
  if (!currentConfig.vaultPath) return res.status(400).json({ error: 'Vault path not configured' });
  const { path: relPath, smartRename } = req.body || {};
  if (!relPath) return res.status(400).json({ error: 'Note path required' });

  const fullPath = path.join(currentConfig.vaultPath, relPath);
  if (!isPathInsideVault(fullPath, currentConfig.vaultPath, false) || !fs.existsSync(fullPath)) {
    return res.status(400).json({ error: 'Valid note inside vault required' });
  }

  try {
    const snapshot = createSnapshotSession(
      currentConfig.vaultPath,
      `single_sort_${new Date().toISOString().replace(/[:.]/g, '-')}`
    );

    // Check if Primary LLM is reachable; if online, run full refineFile; if offline or file remains unmoved, also apply deterministic L0-L7 Tag & Project Router
    let llmReachable = false;
    try {
      const status = await llamaManager.getStatus({
        primaryUrl: currentConfig.llamaUrl,
        jevUrl: currentConfig.decisionModelUrl,
        configuredPrimaryModel: currentConfig.primaryModelFile,
        configuredJevModel: currentConfig.jevModelFile
      });
      llmReachable = status.primary.status === 'running';
    } catch {}

    if (llmReachable && fs.existsSync(fullPath)) {
      await refineFile(fullPath, {
        dryRun: false,
        snapshot,
        smartRename: smartRename !== false
      });
    }

    // If the file still exists at fullPath (e.g. LLM was offline or kept it in place), run deterministic Tag & Project Classification + Directory Routing
    let finalRelPath = relPath.replace(/\\/g, '/');
    let movedToFolder: string | null = null;
    let matchedProject: string | null = null;

    if (fs.existsSync(fullPath)) {
      await snapshot.backup(fullPath);
      const rawContent = await fsPromises.readFile(fullPath, 'utf-8');
      const parsed = parseNote(rawContent);
      const projects = await loadProjectsRegistry(currentConfig.vaultPath);
      const projectsRoot = await detectProjectsRootFolder(currentConfig.vaultPath);
      const taxonomyCfg = await loadVaultTagTaxonomyConfig(currentConfig.vaultPath, projects, projectsRoot);

      const folderRel = path.dirname(relPath).replace(/\\/g, '/');
      const currentFolder = folderRel === '.' ? '' : folderRel;
      const filename = path.basename(fullPath);
      const noteTitle = String(parsed.data.title || path.basename(fullPath, '.md'));
      const existingTags = Array.isArray(parsed.data.tags) ? parsed.data.tags.map(String) : [];

      const projInf = inferProjectFromNoteAndTaxonomy({
        filename,
        title: noteTitle,
        body: parsed.body,
        existingTags,
        folder: currentFolder,
        discoveredProjects: projects,
        projectProfiles: taxonomyCfg.projectProfiles,
        projectsRoot
      });

      const curatedTags = ensureLanguageTags(
        curateOrthogonalTags({
          rawTags: existingTags,
          title: noteTitle,
          filename,
          body: parsed.body,
          folder: currentFolder,
          discoveredProjects: projects,
          projectProfiles: taxonomyCfg.projectProfiles,
          customAxes: taxonomyCfg.axes,
          replaceExisting: true,
          maxTags: 9
        }),
        parsed.body,
        filename
      );

      const routeDec = resolveDirectoryFromTags({
        tags: curatedTags,
        projectProfiles: taxonomyCfg.projectProfiles,
        discoveredProjects: projects,
        tagRoutes: taxonomyCfg.tagRoutes,
        projectsRoot,
        fallbackFolder: currentFolder || '03_Knowledge/Essays'
      });

      matchedProject = projInf.matchedProfile?.id || routeDec.matchedProjectId || null;
      parsed.data.tags = curatedTags;
      if (matchedProject) {
        parsed.data.project = `[[${matchedProject}]]`;
      }

      const cleanTarget = routeDec.targetFolder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      if (cleanTarget) {
        parsed.data.category = cleanTarget;
      }
      parsed.data.ai_refined = true;

      await fsPromises.writeFile(fullPath, serializeNote(parsed.data, parsed.body), 'utf-8');

      if (cleanTarget && cleanTarget.toLowerCase() !== currentFolder.toLowerCase()) {
        const destDir = path.join(currentConfig.vaultPath, cleanTarget);
        if (isPathInsideVault(destDir, currentConfig.vaultPath)) {
          await fsPromises.mkdir(destDir, { recursive: true });
          let destPath = path.join(destDir, filename);
          let counter = 1;
          while (fs.existsSync(destPath) && path.resolve(destPath) !== path.resolve(fullPath)) {
            const ext = path.extname(filename);
            const base = path.basename(filename, ext);
            destPath = path.join(destDir, `${base} ${counter}${ext}`);
            counter++;
          }
          if (path.resolve(fullPath) !== path.resolve(destPath)) {
            const oldDir = path.dirname(fullPath);
            await snapshot.recordMove?.(fullPath, destPath);
            await fsPromises.rename(fullPath, destPath);
            await pruneEmptyParentDirs(currentConfig.vaultPath, oldDir);
            finalRelPath = path.relative(currentConfig.vaultPath, destPath).replace(/\\/g, '/');
            movedToFolder = cleanTarget;
            triageManager.syncRefinedFile(fullPath, destPath, cleanTarget, path.basename(destPath));
          }
        }
      }
    }

    res.json({
      success: true,
      snapshotId: snapshot.sessionId,
      newRelativePath: finalRelPath,
      movedToFolder,
      matchedProject,
      message: movedToFolder
        ? `Sorted "${path.basename(relPath)}" -> "${movedToFolder}"${matchedProject ? ` (Project: ${matchedProject})` : ''}.`
        : `Updated L0–L7 tags and classification for "${finalRelPath}".`
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chat/agent', async (req, res) => {
  const { message, history, activeNotePath, autoExecuteActions } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    const result = await runKnowledgeAgentTurn(
      {
        message,
        history: Array.isArray(history) ? history : [],
        activeNotePath: activeNotePath || null,
        autoExecuteActions: autoExecuteActions !== false
      },
      {
        vaultPath: currentConfig.vaultPath,
        llamaUrl: currentConfig.llamaUrl,
        decisionModelUrl: currentConfig.decisionModelUrl,
        enableDecisionModel: currentConfig.enableDecisionModel,
        typeRoutes: currentConfig.typeRoutes
      },
      addLog
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/models/test-tandem', async (req, res) => {
  try {
    const serverStatus = await llamaManager.getStatus({
      primaryUrl: currentConfig.llamaUrl,
      jevUrl: currentConfig.decisionModelUrl,
      configuredPrimaryModel: currentConfig.primaryModelFile,
      configuredJevModel: currentConfig.jevModelFile
    });

    const sampleText = 'Technical specification and system architecture of the local AI assistant for knowledge base management.';
    let jevCheck: any = { online: serverStatus.jev.status === 'running', model: serverStatus.jev.modelFilename };
    if (jevCheck.online) {
      try {
        const routerConfig = await buildRouterConfig(currentConfig);
        const routeRes = await routeHierarchical(
          sampleText,
          'Tech_Spec_Local_Assistant.md',
          'Tech Spec Local Assistant',
          routerConfig,
          { timeoutMs: 6000 }
        );
        jevCheck = {
          ...jevCheck,
          category: routeRes.level1Category,
          confidence: routeRes.totalConfidence,
          suggestedFolder: routeRes.suggestedFolder
        };
      } catch (e: any) {
        jevCheck.error = e.message;
      }
    }

    let llmCheck: any = { online: serverStatus.primary.status === 'running', model: serverStatus.primary.modelFilename };
    if (llmCheck.online) {
      try {
        const start = Date.now();
        const resp = await axios.post(
          `${currentConfig.llamaUrl.replace(/\/+$/, '')}/v1/chat/completions`,
          {
            messages: [{ role: 'user', content: 'Reply with one word: Ready' }],
            max_tokens: 10,
            temperature: 0.1
          },
          { timeout: 15000 }
        );
        llmCheck.latencyMs = Date.now() - start;
        llmCheck.reply = resp.data?.choices?.[0]?.message?.content?.trim() || 'OK';
      } catch (e: any) {
        llmCheck.error = e.message;
      }
    }

    res.json({
      tandemReady: Boolean(jevCheck.online && llmCheck.online),
      jev: jevCheck,
      primaryLlm: llmCheck
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/vault/note/move', async (req, res) => {
  if (!currentConfig.vaultPath) return res.status(400).json({ error: 'Vault path not configured' });
  const { sourcePath, targetFolder } = req.body || {};
  if (!sourcePath || targetFolder === undefined) {
    return res.status(400).json({ error: 'sourcePath and targetFolder are required' });
  }

  const sourceAbs = path.join(currentConfig.vaultPath, sourcePath);
  const targetFolderAbs = targetFolder ? path.join(currentConfig.vaultPath, targetFolder) : currentConfig.vaultPath;
  const filename = path.basename(sourceAbs);
  const targetAbs = path.join(targetFolderAbs, filename);

  if (!isPathInsideVault(sourceAbs, currentConfig.vaultPath, false) || !isPathInsideVault(targetAbs, currentConfig.vaultPath, false)) {
    return res.status(400).json({ error: 'Invalid file paths outside vault' });
  }

  try {
    const oldDir = path.dirname(sourceAbs);
    await fsPromises.mkdir(targetFolderAbs, { recursive: true });
    await fsPromises.rename(sourceAbs, targetAbs);
    await pruneEmptyParentDirs(currentConfig.vaultPath, oldDir);
    const newRel = path.relative(currentConfig.vaultPath, targetAbs).replace(/\\/g, '/');
    triageManager.syncRefinedFile(sourceAbs, targetAbs, targetFolder, filename);
    addLog(`[Note Moved] "${sourcePath}" -> "${newRel}"`, 'success');
    res.json({ success: true, newRelativePath: newRel });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/vault/reorganize-all', async (req, res) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.status(400).json({ error: 'Vault path not configured' });
  }

  if (!currentConfig.autoMoveEnabled && !req.body?.confirm) {
    return res.status(403).json({
      error: 'Safety Gate C0: autoMoveEnabled is disabled in settings. Explicit confirmation required to reorganize files.',
      requireConfirmation: true
    });
  }

  addLog('[Vault Master Reorganizer] Initiating comprehensive full-vault scan & cleanup...', 'info');

  try {
    // 1. Audit entire vault
    const report = await auditDirectoryProject({
      vaultPath: currentConfig.vaultPath,
      relativeDir: '',
      recursive: true,
      maxDepth: 10,
      includeNonMarkdown: true,
      llamaUrl: currentConfig.llamaUrl,
      decisionModelUrl: currentConfig.decisionModelUrl,
      timeoutSeconds: 30
    });

    const itemsToProcess = report.items.filter(
      i => i.isOutlier || i.detectedType === 'junk' || i.detectedType === 'raw_document'
    );
    if (itemsToProcess.length === 0) {
      addLog('[Vault Master Reorganizer] Entire vault is already clean and organized! Zero issues found.', 'success');
      return res.json({
        success: true,
        message: 'Vault is already completely clean and organized!',
        movedCount: 0,
        convertedCount: 0,
        deletedJunkCount: 0,
        prunedFoldersCount: 0,
        snapshotId: null
      });
    }

    // 2. Create unique timestamped snapshot session
    const snapshotId = `vault_master_reorganize_${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const snapshot = createSnapshotSession(currentConfig.vaultPath, snapshotId);

    // 3. Execute revision plan
    const result = await applyRevisionPlan({
      vaultPath: currentConfig.vaultPath,
      itemsToMove: itemsToProcess.map(item => ({
        filePath: item.absolutePath,
        targetFolder: item.suggestedTargetFolder,
        detectedType: item.detectedType,
        action: item.suggestedAction || (item.detectedType === 'junk' ? 'delete_junk' : item.detectedType === 'raw_document' ? 'convert_to_md' : 'move')
      })),
      cleanupEmptyFolders: true,
      snapshot
    });

    addLog(
      `[Vault Master Reorganizer] Complete! ${result.movedCount} moved to PARA, ${result.convertedCount} raw docs converted, ${result.deletedJunkCount} ghost notes/junk purged. Snapshot: ${snapshot.sessionId}`,
      'success'
    );

    res.json({
      success: true,
      movedCount: result.movedCount,
      convertedCount: result.convertedCount,
      deletedJunkCount: result.deletedJunkCount,
      prunedFoldersCount: result.prunedFoldersCount,
      errors: result.errors,
      snapshotId: snapshot.sessionId,
      message: `Successfully reorganized vault: ${result.movedCount} notes moved to proper folders, ${result.convertedCount} raw docs converted, ${result.deletedJunkCount} empty ghost notes purged.`
    });
  } catch (err: any) {
    addLog(`[Vault Master Reorganizer] Reorganization failed: ${err.message}`, 'error');
    res.status(500).json({ error: err.message });
  }
});

// --- Local Llama & Jev Model Server Management Endpoints ---

app.get('/api/models/status', async (req, res) => {
  const serverStatus = await llamaManager.getStatus({
    primaryUrl: currentConfig.llamaUrl,
    jevUrl: currentConfig.decisionModelUrl,
    configuredPrimaryModel: currentConfig.primaryModelFile,
    configuredJevModel: currentConfig.jevModelFile
  });
  const modelsDir = llamaManager.resolveModelsDirectory(
    currentConfig.modelsPath,
    currentConfig.vaultPath,
    [serverStatus.primary.loadedModelPath, serverStatus.jev.loadedModelPath]
  );
  const models = llamaManager.scanModelsDirectory(modelsDir);
  const profiles = llamaManager.getMemoryProfiles();
  const detectedBinary = llamaManager.findLlamaServerBinary(currentConfig.llamaServerBinary, modelsDir);

  res.json({
    modelsDir,
    modelsDirExists: fs.existsSync(modelsDir),
    models,
    profiles,
    detectedBinary,
    primaryServer: serverStatus.primary,
    jevServer: serverStatus.jev,
    memorySafe: serverStatus.memorySafe,
    currentConfig: {
      memoryProfile: currentConfig.memoryProfile,
      contextSize: currentConfig.contextSize,
      threadCount: currentConfig.threadCount,
      autoStartJevServer: currentConfig.autoStartJevServer
    }
  });
});

app.post('/api/models/list', async (req, res) => {
  const rawDir = typeof req.body?.dirPath === 'string' ? req.body.dirPath.trim() : '';
  const modelsDir = llamaManager.resolveModelsDirectory(rawDir || currentConfig.modelsPath, currentConfig.vaultPath);
  const models = llamaManager.scanModelsDirectory(modelsDir);
  res.json({
    modelsDir,
    modelsDirExists: fs.existsSync(modelsDir),
    models
  });
});

app.post('/api/models/control', async (req, res) => {
  const parseResult = ServerControlSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Invalid server control payload' });
  }

  const { type, action, modelFilename } = parseResult.data;
  const modelsDir = llamaManager.resolveModelsDirectory(currentConfig.modelsPath, currentConfig.vaultPath);
  const binary = llamaManager.findLlamaServerBinary(currentConfig.llamaServerBinary, modelsDir);

  if (action === 'stop') {
    llamaManager.stopServer(type);
    addLog(`[Llama Manager] Server (${type}) stopped.`, 'info');
    const status = await llamaManager.getStatus({
      primaryUrl: currentConfig.llamaUrl,
      jevUrl: currentConfig.decisionModelUrl,
      configuredPrimaryModel: currentConfig.primaryModelFile,
      configuredJevModel: currentConfig.jevModelFile
    });
    return res.json({ success: true, status, message: `Server (${type}) stopped.` });
  }

  if (!binary) {
    return res.status(400).json({
      error: 'llama-server executable not found. Please specify path in settings or generate startup batch scripts.'
    });
  }

  try {
    if (type === 'jev' || type === 'all') {
      addLog(`[Llama Manager] Starting Jev Decision Server on port 1234 (-c 2048 -t 4)...`, 'info');
      await llamaManager.startJevServer({
        binaryPath: binary,
        modelsDir,
        modelFilename: modelFilename || currentConfig.jevModelFile,
        port: 1234,
        contextSize: currentConfig.contextSize || 2048,
        threads: currentConfig.threadCount || 4
      });
    }

    if (type === 'primary' || type === 'all') {
      addLog(`[Llama Manager] Starting Primary LLM Server on port 8080 (-c 2048 -t 4)...`, 'info');
      await llamaManager.startPrimaryServer({
        binaryPath: binary,
        modelsDir,
        modelFilename: modelFilename || currentConfig.primaryModelFile,
        port: 8080,
        contextSize: currentConfig.contextSize || 2048,
        threads: currentConfig.threadCount || 4
      });
    }

    const status = await llamaManager.getStatus({
      primaryUrl: currentConfig.llamaUrl,
      jevUrl: currentConfig.decisionModelUrl,
      configuredPrimaryModel: currentConfig.primaryModelFile,
      configuredJevModel: currentConfig.jevModelFile
    });
    addLog(`[Llama Manager] Server status updated (Jev: ${status.jev.status}, Primary: ${status.primary.status})`, 'success');
    res.json({ success: true, status, message: `Server (${type}) started.` });
  } catch (err: any) {
    addLog(`[Llama Manager] Control action failed: ${err.message}`, 'error');
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/models/generate-scripts', async (req, res) => {
  const modelsDir = llamaManager.resolveModelsDirectory(req.body.modelsDir || currentConfig.modelsPath, currentConfig.vaultPath);
  const targetDir = req.body.targetDir || currentConfig.vaultPath || process.cwd();

  try {
    const scripts = llamaManager.generateBatScripts({ modelsDir });
    const outDir = fs.existsSync(modelsDir) ? modelsDir : targetDir;

    await fsPromises.writeFile(path.join(outDir, 'start_16gb_balanced_tandem.bat'), scripts.tandemBat, 'utf-8');
    await fsPromises.writeFile(path.join(outDir, 'start_jev_decision_server.bat'), scripts.jevOnlyBat, 'utf-8');
    await fsPromises.writeFile(path.join(outDir, 'start_qwen_7b_solo.bat'), scripts.solo7bBat, 'utf-8');
    await fsPromises.writeFile(path.join(outDir, 'MEMORY_OPTIMIZATION_README.md'), scripts.readmeText, 'utf-8');

    addLog(`[Llama Manager] Generated 16GB-optimized .bat scripts in "${outDir}"`, 'success');
    res.json({
      success: true,
      directory: outDir,
      scriptsDir: outDir,
      files: [
        'start_16gb_balanced_tandem.bat',
        'start_jev_decision_server.bat',
        'start_qwen_7b_solo.bat',
        'MEMORY_OPTIMIZATION_README.md'
      ]
    });
  } catch (err: any) {
    res.status(500).json({ error: `Failed writing scripts: ${err.message}` });
  }
});

// --- Dynamic Semantic Hypergraph (DSH) Endpoints ---

app.get('/api/hypergraph/tokens', async (req, res) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.json({ tokens: [] });
  }
  try {
    const tokens = new TokensRegistry(currentConfig.vaultPath);
    await tokens.load();
    const includeDeprecated = req.query.includeDeprecated === 'true';
    res.json({ tokens: tokens.getAll(includeDeprecated) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/hypergraph/tokens', async (req, res) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.status(400).json({ error: 'Vault path not configured' });
  }
  const { key, kind, sourceNote, aliases, mergeWith } = req.body || {};
  if (!key || !kind) {
    return res.status(400).json({ error: 'key and kind required' });
  }
  try {
    const tokens = new TokensRegistry(currentConfig.vaultPath);
    await tokens.load();
    if (mergeWith) {
      const merged = tokens.mergeTokens(key, mergeWith);
      await tokens.save();
      return res.json({ success: true, token: merged });
    }
    const registered = tokens.registerToken({
      key,
      kind,
      sourceNote: sourceNote || 'manual',
      aliases: aliases || []
    });
    await tokens.save();
    res.json({ success: true, token: registered });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/hypergraph/tokens/:key', async (req, res) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.status(400).json({ error: 'Vault path not configured' });
  }
  try {
    const tokens = new TokensRegistry(currentConfig.vaultPath);
    await tokens.load();
    const success = tokens.deprecateToken(req.params.key);
    await tokens.save();
    res.json({ success });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/hypergraph/edges', async (req, res) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.json({ edges: [], count: 0 });
  }
  try {
    const dna = new DnaEngine(currentConfig.vaultPath);
    await dna.load();
    const status = req.query.status as ('active' | 'pending' | 'rejected') | undefined;
    const edges = dna.getEdges(status);
    res.json({ edges, count: edges.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/hypergraph/oracle/predict', async (req, res) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.status(400).json({ error: 'Vault path not configured' });
  }
  try {
    const dna = new DnaEngine(currentConfig.vaultPath);
    const tokens = new TokensRegistry(currentConfig.vaultPath);
    const oracle = new OracleEngine(currentConfig.vaultPath, dna, tokens);
    const result = await oracle.predictNextState();
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/hypergraph/triage/review', async (req, res) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.status(400).json({ error: 'Vault path not configured' });
  }
  const { edgeId, answer } = req.body || {};
  if (!edgeId || !['yes', 'no'].includes(answer)) {
    return res.status(400).json({ error: 'edgeId and answer ("yes" | "no") required' });
  }
  try {
    const dna = new DnaEngine(currentConfig.vaultPath);
    const bridge = new HypergraphTriageBridge(currentConfig.vaultPath, dna);
    const outcome = await bridge.reviewEdge(edgeId, answer);
    res.json(outcome);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/hypergraph/metrics', async (req, res) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.json({
      totalProposed: 0,
      totalConfirmed: 0,
      totalRejected: 0,
      confirmationRate: 1.0,
      oraclePaused: false,
      lastUpdated: new Date().toISOString()
    });
  }
  try {
    const dna = new DnaEngine(currentConfig.vaultPath);
    const bridge = new HypergraphTriageBridge(currentConfig.vaultPath, dna);
    const metrics = await bridge.loadMetrics();
    res.json(metrics);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/hypergraph/report', async (req, res) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.json({ path: '', markdown: '# Dynamic Semantic Hypergraph Report\n\nVault path is not configured yet.' });
  }
  try {
    const reportPath = await generateHypergraphReport(currentConfig.vaultPath);
    const markdown = await fsPromises.readFile(reportPath, 'utf-8');
    res.json({ path: reportPath, markdown });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Global Express error handler to prevent unhandled route errors from crashing the server
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const msg = err?.message || 'Internal Server Error';
  addLog(`[Server Error] ${req.method} ${req.url}: ${msg}`, 'error');
  if (!res.headersSent) {
    res.status(500).json({ error: msg });
  }
});

// Vite middleware for dev or static serving for prod
async function startServer() {
  // Auto-probe / auto-start Jev server if configured
  if (currentConfig.autoStartJevServer) {
    setTimeout(async () => {
      try {
        const probe = await llamaManager.probeServer(currentConfig.decisionModelUrl || 'http://127.0.0.1:1234', 1000);
        if (!probe.online) {
          const resolvedModelsDir = llamaManager.resolveModelsDirectory(currentConfig.modelsPath, currentConfig.vaultPath);
          const binary = llamaManager.findLlamaServerBinary(currentConfig.llamaServerBinary, resolvedModelsDir);
          if (binary && fs.existsSync(resolvedModelsDir)) {
            addLog('[Auto-Start] Launching Jev Decision Server on port 1234 (16GB RAM safe mode)...', 'info');
            const state = await llamaManager.startJevServer({
              binaryPath: binary,
              modelsDir: resolvedModelsDir,
              modelFilename: currentConfig.jevModelFile,
              port: 1234,
              contextSize: currentConfig.contextSize || 2048,
              threads: currentConfig.threadCount || 4
            });
            if (state.status === 'running') {
              addLog(`[Auto-Start] Jev Decision Server is online on port 1234 (${state.modelFilename}).`, 'success');
            } else if (state.lastError) {
              addLog(`[Auto-Start] Jev Decision Server could not start: ${state.lastError}`, 'warn');
            }
          }
        }
      } catch {}
    }, 1500);
  }
  if (resolveIsDevMode(process.env)) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const httpServer = app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
  });
  // Allow up to 5 minutes for large full-vault operations without dropping connection
  httpServer.setTimeout(300000);
  httpServer.keepAliveTimeout = 120000;
  httpServer.headersTimeout = 125000;
}

if (!process.env.VITEST) {
  startServer().catch((err) => {
    console.error('[Fatal Server Startup Error]:', err);
  });
}
