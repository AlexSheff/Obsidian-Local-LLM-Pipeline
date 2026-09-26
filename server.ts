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
import { extractTags } from './src/server/tags';
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
import { auditDirectoryProject, applyRevisionPlan } from './src/server/directoryRevisor';
import {
  classifyContentType,
  routeFolderWithDecisionModel,
  decide,
  STANDARD_CONTENT_TYPES,
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
import { routeHierarchical, HierarchicalRouterConfig } from './src/server/llm/hierarchicalRouter';
import { calibrateThreshold, isCalibrated, applyCalibrationGateOnLoad } from './src/server/calibration';
import { loadProjectsRegistry, bootstrapProjectsYaml } from './src/server/projectsRegistry';

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
  modelsPath: 'D:/Obsidian/Alex/Vault/llm/models',
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
  // 2. Strip standard generated lines like `> **Связанные темы:** ...` or `**Исходный файл:** ...`
  body = body.replace(/^>\s*\*\*Связанные темы:\*\*.*$/gm, '');
  body = body.replace(/^\*\*Исходный файл:\*\*.*$/gm, '');
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
      addLog(`Vault Refinement Complete. Backups saved to: 99_System/_refine_backup/${currentRefineSession?.sessionId || ''}`, 'success');
    }
    currentRefineSession = null;
    currentRefineDryRun = false;
  }
}

async function fastFallbackRefine(filename: string, body: string): Promise<string> {
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

  const fbController = new AbortController();
  const fbTimeoutId = setTimeout(() => fbController.abort(), 90000);
  try {
    const payload = sanitizePayloadForLlm({
      messages: [{ role: 'user', content: microPrompt }],
      temperature: 0.1,
      max_tokens: 200,
      stream: false
    });
    const response = await axios.post(`${currentConfig.llamaUrl}/v1/chat/completions`, payload, {
      signal: fbController.signal
    });
    clearTimeout(fbTimeoutId);
    return response.data.choices[0].message.content;
  } catch (err: any) {
    clearTimeout(fbTimeoutId);
    throw err;
  }
}

async function refineFile(filePath: string, options?: { dryRun?: boolean; snapshot?: SnapshotSession; smartRename?: boolean }) {
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
  
  // Extract all existing tags (from frontmatter and inline)
  const existingFrontmatterStr = parsedNote.hadFrontmatter ? serializeNote(parsedNote.data, '') : '';
  const existingTags = extractTags(existingFrontmatterStr, body, originalFilename);
  const existingTagsStr = existingTags.length > 0 ? existingTags.map(t => `#${t}`).join(', ') : 'None';
  
  const currentRelPath = path.relative(currentConfig.vaultPath, path.dirname(filePath)).replace(/\\/g, '/');

  // Optimize prompt length to keep inference fast on local LLMs and strictly protect surrogate pairs
  const maxChars = currentConfig.maxContextChars || 1500;
  const textToProcess = safeTruncateHeadTail(body, maxChars, 0.75);

  // Cap existing folder list to avoid huge context prefill delays
  let existingFoldersContext = '';
  if (currentVaultStructure.length > 0) {
    const sampleFolders = currentVaultStructure.slice(0, 30);
    existingFoldersContext = "\nEXISTING FOLDERS IN VAULT (Prioritize placing notes in these if relevant):\n- " + sampleFolders.join("\n- ");
    if (currentVaultStructure.length > 30) {
      existingFoldersContext += `\n- ... (${currentVaultStructure.length - 30} other folders)`;
    }
  }

  // Jev-Style Decision Model integration (Tier-1 Classification & Routing)
  let decisionGuidance = '';
  if (currentConfig.enableDecisionModel && currentConfig.decisionModelUrl) {
    const isJevOnline = await isDecisionServerReachable(currentConfig.decisionModelUrl, 1000);
    if (!isJevOnline) {
      // Quietly skip without latency penalty
    } else {
      try {
        const jevTypeResult = await classifyContentType(
          currentConfig.decisionModelUrl,
          body,
          originalFilename,
          STANDARD_CONTENT_TYPES,
          10000
        );
        addLog(`[Jev Decision] Content Type for "${originalFilename}": ${jevTypeResult.type} (${Math.round(jevTypeResult.confidence * 100)}%)`, 'info');

        if (currentVaultStructure.length > 0) {
          const candidateFolders = currentVaultStructure.slice(0, 20);
          const jevRouteResult = await routeFolderWithDecisionModel(
            currentConfig.decisionModelUrl,
            body,
            originalFilename,
            candidateFolders,
            currentConfig.decisionConfidenceThreshold || 0.80,
            10000
          );

          addLog(`[Jev Decision] Target Folder for "${originalFilename}": ${jevRouteResult.suggestedFolder} (${Math.round(jevRouteResult.confidence * 100)}% conf)`, 'info');

          // Check if confidence is ambiguous -> enqueue into Triage
          if (jevRouteResult.needsReview) {
            addLog(`[Jev Decision] Ambiguous confidence (${Math.round(jevRouteResult.confidence * 100)}% < ${Math.round((currentConfig.decisionConfidenceThreshold || 0.8) * 100)}%). Queued for Triage Review.`, 'warn');
            decisionTriageQueue = decisionTriageQueue.filter(q => q.filePath !== filePath);
            decisionTriageQueue.unshift({
              id: `triage_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              filePath,
              relativePath: currentRelPath,
              filename: originalFilename,
              contentType: jevTypeResult.type,
              confidence: jevRouteResult.confidence,
              topFolder: jevRouteResult.suggestedFolder,
              distribution: jevRouteResult.distribution.slice(0, 5),
              timestamp: new Date().toISOString()
            });
            if (decisionTriageQueue.length > 100) decisionTriageQueue.pop();
          }

          // If in Fast-Routing mode and high confidence: route immediately without waiting for generative LLM!
          if (currentConfig.decisionMode === 'fast_routing' && jevRouteResult.isHighConfidence) {
            addLog(`[Jev Fast-Route] High confidence (${Math.round(jevRouteResult.confidence * 100)}%). Routing directly to "${jevRouteResult.suggestedFolder}" without generative latency.`, 'success');

            if (!options?.dryRun) {
              if (options?.snapshot) {
                await options.snapshot.backup(filePath);
              }
              parsedNote.data.ai_refined = true;
              (parsedNote.data as any).ai_content_type = jevTypeResult.type;
              const finalFileContent = serializeNote(parsedNote.data, parsedNote.body);
              const targetDir = path.join(currentConfig.vaultPath, jevRouteResult.suggestedFolder);
              await fsPromises.mkdir(targetDir, { recursive: true });
              const destPath = path.join(targetDir, originalFilename);
              await fsPromises.writeFile(filePath, finalFileContent, 'utf-8');
              if (filePath !== destPath) {
                await fsPromises.rename(filePath, destPath);
              }
            }
            return;
          }

          decisionGuidance = `\n### JEV-STYLE DECISION GUIDANCE (CALIBRATED GROUND TRUTH):\n- Detected Type: ${jevTypeResult.type} (${Math.round(jevTypeResult.confidence * 100)}% confidence)\n- Suggested Folder: ${jevRouteResult.suggestedFolder} (${Math.round(jevRouteResult.confidence * 100)}% confidence)\n- Alternatives: ${jevRouteResult.distribution.slice(1, 3).map((d: any) => `${d.option} (${Math.round(d.probability * 100)}%)`).join(', ')}\nPrioritize placing this note into '${jevRouteResult.suggestedFolder}'.`;
        }
      } catch (decisionErr: any) {
        addLog(`Decision model check skipped: ${decisionErr.message}`, 'warn');
      }
    }
  }

  const prompt = `You are an expert semantic taxonomist organizing an Obsidian knowledge vault using PARA (Projects, Areas, Resources/Knowledge, Archives).
Carefully analyze the NOTE INFORMATION, EXISTING TAGS, and CONTENT to classify it with flawless precision.
${decisionGuidance}


### NOTE INFORMATION:
- Filename: ${originalFilename}
- Current Folder: ${currentRelPath || 'Root'}
- Existing Tags: ${existingTagsStr}
- Content Snippet:
${textToProcess}

### TITLE GUIDELINES & LANGUAGE RULES (STRICT):
- Distill a concise, clean, and elegant human title (2 to 5 words).
- LANGUAGE MATCHING RULE: The language of the title MUST STRICTLY MATCH the language of the document text!
  * If the document text is in Russian -> the title MUST be in Russian. NEVER translate Russian notes to English!
  * If the document text is in English -> the title MUST be in English.
- Remove noise prefixes, timestamps, dates, raw indices, and verbose clauses.
- If current filename is already clean and concise, keep it.
- Example: "Межпланетный интернет 7 первых запросов в бесконечном интернете.md" -> "Межпланетный интернет"

### STRICT TAXONOMY & CLASSIFICATION RULES:
1. SPECIFIC PROJECTS (HIGHEST PRIORITY):
   - If the note belongs to a specific project (indicated by tags, title, or content: ArtMaze, CleanNet, Neuromicon, AGOS-LUNA, Crypto, 1149, Reality Game, CityTournament, etc.), it MUST go into its project folder:
     * CleanNet -> '01_Projects/CleanNet Franchise'
     * Neuromicon -> '01_Projects/Neuromicon' (or '01_Projects/Neuromicon/Songs', '01_Projects/Neuromicon/Poems')
     * ArtMaze -> '01_Projects/ArtMaze'
     * AGOS-LUNA -> '01_Projects/AGOS-LUNA'
     * Specific named project -> '01_Projects/<ExactProjectName>'
2. CODE, APIS, SCRIPTS VS. FICTION SCENARIOS (CRITICAL):
   - "API for Projects", "Access Script ArtMaze", Python/JS code, tokens, configs, technical scripts -> place in '03_Knowledge/Programming' OR their specific project folder (e.g., '01_Projects/ArtMaze').
   - NEVER put programming code, APIs, project plans, business roadmaps, or announcements into '01_Projects/Scenarios'!
   - '01_Projects/Scenarios' is STRICTLY for fiction movie scripts, theater screenplays, or storytelling quest narratives.
3. CONTENT-TYPE ROUTING (When not part of a specific project):
   - Transcripts / Dialogues / Interviews -> '03_Knowledge/Dialogues'
   - Essays / Deep articles / Philosophy -> '03_Knowledge/Essays'
   - Poems / Verses -> '03_Knowledge/Poems'
   - Songs / Lyrics / Music tracks -> '03_Knowledge/Songs'
   - Crypto / Blockchain general -> '03_Knowledge/Crypto'
   - Daily logs / Journal entries -> '04_Journal/Daily'
   - Personal finance / Health -> '02_Areas/<AreaName>'
4. FOLDER REUSE & CONSOLIDATION:
   - Avoid creating new near-duplicate folders. Match existing vault folders where possible.
   - Max depth is 2-3 levels (e.g., '01_Projects/ProjectName' or '03_Knowledge/SubTopic').
${existingFoldersContext}

### TAGGING RULES & MANDATORY LANGUAGE TAG:
- MANDATORY LANGUAGE TAG: You MUST include the language code tag as the FIRST tag in improved_tags:
  * "ru" if the document text is in Russian
  * "en" if the document text is in English
  * "ph" if the document text is in Filipino / Tagalog
  * Include both "ru" and "en" if the document is significantly bilingual
- KEEP all valuable existing tags.
- Generate 5 to 10 HIGHLY SPECIFIC topic tags based on the core semantic meaning (lowercase, without '#' in array).
- Support English and Russian tags matching the language of the note.

Return ONLY raw JSON with these 3 fields (no markdown fences, no commentary):
{
  "improved_title": "Clean Human Title (2-5 words)",
  "improved_tags": ["ru", "tag1", "tag2", "tag3", "tag4", "tag5"],
  "suggested_path": "01_Projects/ExactFolderName"
}`;

  const timeoutMs = (currentConfig.timeoutSeconds || 240) * 1000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let responseContent = '';
  try {
    const payload = sanitizePayloadForLlm({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 350,
      stream: false
    });
    const response = await axios.post(`${currentConfig.llamaUrl}/v1/chat/completions`, payload, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    responseContent = response.data.choices[0].message.content;
  } catch (llmError: any) {
    clearTimeout(timeoutId);
    if (llmError.name === 'CanceledError' || llmError.code === 'ECONNABORTED' || controller.signal.aborted) {
      addLog(`Primary prompt timed out after ${currentConfig.timeoutSeconds || 240}s on ${originalFilename}. Attempting quick compact fallback...`, 'warn');
      try {
        responseContent = await fastFallbackRefine(originalFilename, body);
      } catch (fbErr: any) {
        throw new Error(`LLM Refine Request timed out (${currentConfig.timeoutSeconds || 240}s) and fallback failed: ${fbErr.message}`);
      }
    } else {
      throw new Error(`LLM Refine Request failed: ${llmError.message}`);
    }
  }

  // Strip <think> tags if reasoning model is used
  let cleanContent = responseContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // Parse JSON
  let jsonStr = cleanContent;
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (jsonMatch) jsonStr = jsonMatch[0];
  
  let data: any = {};
  try {
    let cleanedJsonStr = jsonStr.replace(/,\s*([\}\]])/g, '$1').replace(/\n/g, ' ');
    data = JSON.parse(cleanedJsonStr);
  } catch (parseError: any) {
    throw new Error(`Failed to parse LLM JSON: ${parseError.message}`);
  }

  const newTags = Array.isArray(data.improved_tags) ? data.improved_tags : [];
  const parsedNewTags = newTags.map((t: string) => String(t).trim().replace(/^#+/, '').replace(/\s+/g, '-')).filter(Boolean);
  
  // Enforce language tags (e.g. #ru, #en, #ph)
  const tagsWithLanguage = ensureLanguageTags(parsedNewTags, body, originalFilename);
  mergeTags(parsedNote.data, tagsWithLanguage);
  parsedNote.data.ai_refined = true;

  // Determine refined filename (Smart Renaming)
  let targetFilename = originalFilename;
  const smartRenameEnabled = options?.smartRename !== false;
  if (smartRenameEnabled && data.improved_title) {
    let cleanTitle = sanitizeTitle(data.improved_title, originalFilename);
    // Enforce title language strictly matches document content language
    cleanTitle = enforceTitleLanguage(cleanTitle, body, originalFilename);
    if (cleanTitle && cleanTitle !== 'Untitled_Document') {
      targetFilename = `${cleanTitle}.md`;
      parsedNote.data.title = cleanTitle;
    }
  }

  const combinedTags = (parsedNote.data.tags as string[]) || [];
  const finalFileContent = serializeNote(parsedNote.data, parsedNote.body);

  let suggestedPath = (data.suggested_path || '03_Knowledge/Unsorted').trim();
  
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
  const destMdPath = path.join(destDir, targetFilename);

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
            // Backup base candidate before modifying
            if (options?.snapshot) {
              await options.snapshot.backup(baseCandidate);
            }
            // Merge any extra tags into canonical base note
            const mergedContent = mergeTagsIntoFrontmatter(baseContent, combinedTags);
            await fsPromises.writeFile(baseCandidate, mergedContent, 'utf-8');
            await safeArchiveDuplicate(filePath, baseCandidate);
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
        // Backup dest before modifying
        if (options?.snapshot) {
          await options.snapshot.backup(destMdPath);
        }
        const mergedContent = mergeTagsIntoFrontmatter(destContent, combinedTags);
        await fsPromises.writeFile(destMdPath, mergedContent, 'utf-8');
        await safeArchiveDuplicate(filePath, destMdPath);
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
async function processFile(filePath: string) {
  const originalFilename = path.basename(filePath);
  const fileExtension = path.extname(originalFilename).toLowerCase();
  
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
        text = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/, '');
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
  
  addLog(`Sending to local LLM at ${currentConfig.llamaUrl}`);
  
  // Extract any inline tags from content
  const detectedTags = extractTags('', fullConvertedText, originalFilename);
  const detectedTagsStr = detectedTags.length > 0 ? detectedTags.map(t => `#${t}`).join(', ') : 'None';

  const existingFoldersContext = currentVaultStructure.length > 0 
    ? "\nEXISTING FOLDERS IN VAULT (Prefer matching these if relevant):\n- " + currentVaultStructure.join("\n- ") 
    : "";

  const prompt = `You are an expert semantic taxonomist organizing an Obsidian knowledge vault using PARA (Projects, Areas, Resources/Knowledge, Archives).
Analyze this new incoming file from the Inbox and classify it with flawless precision.
DO NOT output any markdown, explanations, or backticks. Return ONLY raw JSON.

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
  * Example: "Межпланетный интернет 7 первых запросов в бесконечном интернете.md" -> "Межпланетный интернет" (Keep Russian!)
  * Example: "Заметка 2024-03-01 о настройке NGINX и SSL" -> "Настройка NGINX и SSL"
  * Example: "voice_note_14_clean_net_franchise_ideas" -> "CleanNet Франшиза Идеи"

### STRICT TAXONOMY & CLASSIFICATION RULES:
1. SPECIFIC PROJECTS (HIGHEST PRIORITY):
   - Notes belonging to a specific project (by title, tags, or content: ArtMaze, CleanNet, Neuromicon, AGOS-LUNA, Crypto, 1149, Reality Game, CityTournament, etc.) MUST go to their project folder:
     * CleanNet -> '01_Projects/CleanNet Franchise'
     * Neuromicon -> '01_Projects/Neuromicon' (or '01_Projects/Neuromicon/Songs', '01_Projects/Neuromicon/Poems')
     * ArtMaze -> '01_Projects/ArtMaze'
     * AGOS-LUNA -> '01_Projects/AGOS-LUNA'
     * Other named projects -> '01_Projects/<ExactProjectName>'
2. CODE, APIS, SCRIPTS VS. FICTION SCENARIOS (CRITICAL):
   - Programming code, APIs, IT scripts, configs -> '03_Knowledge/Programming' OR specific '01_Projects/<Name>'.
   - NEVER put programming code, APIs, project plans, business roadmaps, or announcements in '01_Projects/Scenarios'!
   - '01_Projects/Scenarios' is STRICTLY for fiction movie scripts, theater screenplays, or storytelling quest narratives.
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

Extract these exactly 5 fields in valid JSON format:
{
  "title": "Concise Distilled Title (2-5 words)",
  "summary": "1-2 sentence concise summary",
  "category": "01_Projects/ExactFolderName",
  "tags": ["ru", "tag1", "tag2", "tag3", "tag4"],
  "related_concepts": ["Concept 1", "Concept 2", "Concept 3"]
}`;

  let responseContent = '';
  const timeoutMs = (currentConfig.timeoutSeconds || 240) * 1000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const payload = sanitizePayloadForLlm({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 350,
      stream: false
    });
    
    const response = await axios.post(`${currentConfig.llamaUrl}/v1/chat/completions`, payload, { 
      signal: controller.signal 
    });
    
    clearTimeout(timeoutId);
    responseContent = response.data.choices[0].message.content;
  } catch (llmError: any) {
    clearTimeout(timeoutId);
    if (llmError.name === 'CanceledError' || llmError.code === 'ECONNABORTED' || controller.signal.aborted) {
       throw new Error(`LLM Error: Request timed out after ${currentConfig.timeoutSeconds || 240} seconds.`);
    }
    if (llmError.response && llmError.response.status === 400) {
        throw new Error(`LLM Error 400: Context length exceeded or invalid format.`);
    }
    if (llmError.code === 'ECONNREFUSED') {
      throw new Error(`LLM Server is not running at ${currentConfig.llamaUrl}.`);
    }
    throw new Error(`LLM request failed: ${llmError.message}`);
  }
  
  // Strip <think> tags if reasoning model is used
  let cleanContent = responseContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // Robust JSON Extraction
  let jsonStr = cleanContent;
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonStr = jsonMatch[0];
  }
  
  let data: any = {};
  try {
    let cleanedJsonStr = jsonStr
       .replace(/,\s*([\}\]])/g, '$1')
       .replace(/\n/g, ' '); 
    data = JSON.parse(cleanedJsonStr);
  } catch (parseError: any) {
    addLog(`JSON Parse failed for ${originalFilename}: ${parseError.message}. Using aggressive fallback string extraction.`, 'error');
    const extractField = (key: string) => {
       const regex = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`, 'i');
       const match = jsonStr.match(regex);
       return match ? match[1].trim() : null;
    };
    
    data = {
      title: extractField("title") || originalFilename.replace(/\.[^/.]+$/, ""),
      category: extractField("category") || '00_Inbox/Processed',
      summary: extractField("summary") || 'Automatic fallback due to model parsing error.',
      tags: [],
      related_concepts: []
    };
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
  
  // Dynamically register folder
  if (!currentVaultStructure.includes(destFolder)) {
    currentVaultStructure.push(destFolder);
  }

  const category = rawCategory || destFolder;
  
  let safeTitle = sanitizeTitle(data.title, originalFilename);
  // Enforce title language strictly matches document content language
  safeTitle = enforceTitleLanguage(safeTitle, fullConvertedText, originalFilename);
  let mdFilename = `${safeTitle}.md`;
  
  const formatArray = (arr: any) => {
    if (!arr) return [];
    if (Array.isArray(arr)) return arr;
    if (typeof arr === 'string') return arr.split(',').map(s => s.trim()).filter(Boolean);
    return [];
  };

  const rawTags = formatArray(data.tags).map((t: string) => String(t).trim().replace(/^#/, '').replace(/\s+/g, '-')).filter(Boolean);
  
  // Merge detected tags + LLM tags
  const tagMap = new Map<string, string>();
  for (const t of detectedTags) {
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
    title: safeTitle,
    category: category,
    tags: tagsWithLanguage,
    summary: data.summary || '',
    ai_refined: true,
    ai_processed: true,
  };

  let destMdPath = path.join(currentConfig.vaultPath, destFolder, mdFilename);
  
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
  const alreadyHasCallout = fullConvertedText.includes('Связанные темы') || fullConvertedText.includes('Related Topics');
  if (concepts.length > 0 && !alreadyHasCallout) {
    const isRu = detectDocumentLanguage(fullConvertedText, originalFilename).primary === 'ru';
    const label = isRu ? 'Связанные темы' : 'Related Topics';
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
    const sourceLabel = isRu ? 'Исходный файл' : 'Source File';
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
  const targetOptions = options && options.length >= 2 ? options : STANDARD_CONTENT_TYPES;

  try {
    const start = Date.now();
    const output = await decide(targetUrl, text, targetQuestion, targetOptions, 15000);
    const elapsedMs = Date.now() - start;
    res.json({ success: true, output, elapsedMs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/decision/triage', (req, res) => {
  const queue = triageManager.getQueue();
  res.json({
    items: queue,
    triageQueue: queue,
    count: triageManager.getPendingCount(),
    threshold: currentConfig.decisionConfidenceThreshold || 0.80
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
    const outcome = await triageManager.answerQuestion(id, questionIndex, answer, currentConfig.vaultPath);
    if (outcome.resolved) {
      addLog(`[Triage Answered YES] Note "${id}" moved to "${outcome.targetFolder}" with snapshot backup`, 'success');
    } else if (outcome.status === 'manual') {
      addLog(`[Triage Answered NO] All candidate questions exhausted for "${id}". Marked for manual review.`, 'warn');
    }
    res.json(outcome);
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

  const snapshot = await createSnapshotSession(currentConfig.vaultPath, 'triage_manual_resolve');
  await snapshot.backup(fullPath);

  const filename = path.basename(fullPath);
  const targetDir = path.join(currentConfig.vaultPath, cleanTargetFolder);
  const destPath = path.join(targetDir, filename);

  const content = await fsPromises.readFile(fullPath, 'utf-8');
  const parsed = parseNote(content);
  parsed.data.ai_refined = true;
  if (applyTag) {
    mergeTags(parsed.data, [applyTag]);
  }
  const updatedContent = serializeNote(parsed.data, parsed.body);

  await fsPromises.mkdir(targetDir, { recursive: true });
  await fsPromises.writeFile(fullPath, updatedContent, 'utf-8');
  if (fullPath !== destPath) {
    await fsPromises.rename(fullPath, destPath);
    addLog(`[Triage Resolved] Moved "${filename}" -> "${cleanTargetFolder}"`, 'success');
  }

  decisionTriageQueue = decisionTriageQueue.filter(q => q.filePath !== filePath);
  res.json({ success: true, message: `Moved to ${cleanTargetFolder}` });
});

app.post(['/api/decision/batch-triage', '/api/decision/fast-route-vault'], async (req, res) => {
  if (!currentConfig.vaultPath || !fs.existsSync(currentConfig.vaultPath)) {
    return res.status(400).json({ error: 'Vault path not configured' });
  }
  if (!currentConfig.decisionModelUrl) {
    return res.status(400).json({ error: 'Decision model URL not configured' });
  }

  const allMdFiles: string[] = [];
  async function scan(dir: string) {
    const entries = await fsPromises.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name.startsWith('.') || ent.name.startsWith('99_System')) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await scan(full);
      } else if (ent.isFile() && ent.name.endsWith('.md')) {
        allMdFiles.push(full);
      }
    }
  }

  await scan(currentConfig.vaultPath);
  const projects = await loadProjectsRegistry(currentConfig.vaultPath);
  const threshold = req.body?.threshold || currentConfig.decisionConfidenceThreshold || 0.80;

  const routerConfig: HierarchicalRouterConfig = {
    topLevelCategories: currentConfig.topLevelCategories || [
      'Project',
      'Essay/Knowledge',
      'Dialogue/Transcript',
      'Poem',
      'Screenplay/Script',
      'Idea',
      'Journal/Diary',
      'Technical/Code'
    ],
    typeRoutes: currentConfig.typeRoutes || {
      'Essay/Knowledge': '03_Knowledge/Essays',
      'Dialogue/Transcript': '03_Knowledge/Dialogues',
      'Poem': '03_Knowledge/Poems',
      'Screenplay/Script': '03_Knowledge/Scripts',
      'Idea': '05_Ideas/Inbox',
      'Journal/Diary': '04_Journal/Daily',
      'Technical/Code': '03_Knowledge/Technical'
    },
    projects,
    decisionModelUrl: currentConfig.decisionModelUrl,
    threshold
  };

  let processedCount = 0;
  let routedCount = 0;
  let triagedCount = 0;

  addLog(`Starting Hierarchical Jev Triage on ${allMdFiles.length} notes (Threshold: ${Math.round(threshold * 100)}%)...`, 'info');

  for (const filePath of allMdFiles) {
    try {
      const content = await fsPromises.readFile(filePath, 'utf-8');
      const parsed = parseNote(content);
      if (parsed.data.ai_refined) continue;

      processedCount++;
      const filename = path.basename(filePath);
      const title = (parsed.data.title as string) || filename.replace(/\.md$/i, '');
      const relPath = path.relative(currentConfig.vaultPath, path.dirname(filePath)).replace(/\\/g, '/');

      const routeResult = await routeHierarchical(
        parsed.body,
        filename,
        title,
        routerConfig,
        { timeoutMs: 15000 }
      );

      if (routeResult.isHighConfidence) {
        if (currentConfig.autoMoveEnabled || req.body?.forceMove) {
          const snapshot = await createSnapshotSession(currentConfig.vaultPath, 'hierarchical_batch_route');
          await snapshot.backup(filePath);

          parsed.data.ai_refined = true;
          (parsed.data as any).ai_category = routeResult.level1Category;
          if (routeResult.projectLink) {
            (parsed.data as any).project = routeResult.projectLink;
          }
          const serialized = serializeNote(parsed.data, parsed.body);
          const destDir = path.join(currentConfig.vaultPath, routeResult.suggestedFolder);
          await fsPromises.mkdir(destDir, { recursive: true });
          const destPath = path.join(destDir, filename);
          await fsPromises.writeFile(filePath, serialized, 'utf-8');
          if (filePath !== destPath) {
            await fsPromises.rename(filePath, destPath);
          }
        }
        routedCount++;
      } else {
        triagedCount++;
        triageManager.enqueue({
          filePath,
          relativePath: relPath,
          filename,
          contentType: routeResult.level1Category,
          confidence: routeResult.totalConfidence,
          topFolder: routeResult.suggestedFolder,
          distribution: [
            { letter: 'A', option: routeResult.suggestedFolder, probability: routeResult.totalConfidence },
            { letter: 'B', option: routeResult.level2Selection, probability: routeResult.level2Confidence }
          ]
        }, routerConfig.typeRoutes);
      }
    } catch (err: any) {
      addLog(`Hierarchical triage failed on ${path.basename(filePath)}: ${err.message}`, 'warn');
    }
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
            const rawTags = Array.isArray(parsed.data.tags) ? parsed.data.tags.map(String) : [];
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
    const updatedContent = serializeNote(frontmatter || {}, body || '');
    await fsPromises.writeFile(fullPath, updatedContent, 'utf-8');
    addLog(`[Note Saved] Updated "${relPath}"`, 'success');
    res.json({ success: true, relativePath: relPath });
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
    await fsPromises.mkdir(targetFolderAbs, { recursive: true });
    await fsPromises.rename(sourceAbs, targetAbs);
    const newRel = path.relative(currentConfig.vaultPath, targetAbs).replace(/\\/g, '/');
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
  const modelsDir = currentConfig.modelsPath || 'D:/Obsidian/Alex/Vault/llm/models';
  const models = llamaManager.scanModelsDirectory(modelsDir);
  const profiles = llamaManager.getMemoryProfiles();
  const detectedBinary = llamaManager.findLlamaServerBinary(currentConfig.llamaServerBinary, modelsDir);
  const serverStatus = await llamaManager.getStatus();

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

app.post('/api/models/control', async (req, res) => {
  const parseResult = ServerControlSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Invalid server control payload' });
  }

  const { type, action, modelFilename } = parseResult.data;
  const modelsDir = currentConfig.modelsPath || 'D:/Obsidian/Alex/Vault/llm/models';
  const binary = llamaManager.findLlamaServerBinary(currentConfig.llamaServerBinary, modelsDir);

  if (action === 'stop') {
    llamaManager.stopServer(type);
    addLog(`[Llama Manager] Server (${type}) stopped.`, 'info');
    const status = await llamaManager.getStatus();
    return res.json({ success: true, status });
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

    const status = await llamaManager.getStatus();
    addLog(`[Llama Manager] Server status updated (Jev: ${status.jev.status}, Primary: ${status.primary.status})`, 'success');
    res.json({ success: true, status });
  } catch (err: any) {
    addLog(`[Llama Manager] Control action failed: ${err.message}`, 'error');
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/models/generate-scripts', async (req, res) => {
  const modelsDir = req.body.modelsDir || currentConfig.modelsPath || 'D:/Obsidian/Alex/Vault/llm/models';
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
          const binary = llamaManager.findLlamaServerBinary(currentConfig.llamaServerBinary, currentConfig.modelsPath);
          if (binary && fs.existsSync(currentConfig.modelsPath)) {
            addLog('[Auto-Start] Launching Jev Decision Server on port 1234 (16GB RAM safe mode)...', 'info');
            await llamaManager.startJevServer({
              binaryPath: binary,
              modelsDir: currentConfig.modelsPath,
              modelFilename: currentConfig.jevModelFile,
              port: 1234,
              contextSize: currentConfig.contextSize || 2048,
              threads: currentConfig.threadCount || 4
            });
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
