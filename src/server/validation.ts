import { z } from 'zod';
import path from 'path';
import fs from 'fs';

/**
 * Checks if a target path is strictly inside the vault path (no path traversal).
 * When allowRoot is true, the vault root itself is considered a valid target directory.
 */
export function isPathInsideVault(targetPath: string, vaultPath: string, allowRoot: boolean = false): boolean {
  if (!vaultPath || !targetPath) return false;
  try {
    const resolvedVault = path.resolve(vaultPath);
    const resolvedTarget = path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(vaultPath, targetPath);
    const rel = path.relative(resolvedVault, resolvedTarget);
    // Must not start with '..' and must not be absolute
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return false;
    }
    if (rel === '') {
      return allowRoot;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates Host header against allowed hostnames.
 */
export function isAllowedHost(host: string | undefined): boolean {
  if (!host) return false;
  const hostname = host.split(':')[0].toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
    return true;
  }
  // Allow Google/Cloud Run preview proxies
  if (
    hostname.endsWith('.google.com') ||
    hostname.endsWith('.googleusercontent.com') ||
    hostname.endsWith('.run.app') ||
    hostname.endsWith('.aistudio.build')
  ) {
    return true;
  }
  return false;
}

/**
 * Validates Origin header against allowed origins.
 */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // Direct same-origin or tool requests often omit Origin
  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
      return true;
    }
    if (
      hostname.endsWith('.google.com') ||
      hostname.endsWith('.googleusercontent.com') ||
      hostname.endsWith('.run.app') ||
      hostname.endsWith('.aistudio.build')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export const ConfigSchema = z.object({
  vaultPath: z.string().refine((val) => {
    if (!path.isAbsolute(val)) return false;
    try {
      return fs.existsSync(val) && fs.statSync(val).isDirectory();
    } catch {
      return false;
    }
  }, { message: 'vaultPath must be an existing absolute directory' }),
  llamaUrl: z.string().url().refine((val) => {
    try {
      const u = new URL(val);
      return (u.protocol === 'http:' || u.protocol === 'https:') && !u.pathname.includes('..');
    } catch {
      return false;
    }
  }, { message: 'llamaUrl must be a valid http or https URL without path traversal' }),
  timeoutSeconds: z.number().int().min(1).max(3600),
  maxContextChars: z.number().int().min(500).max(32000),
  decisionModelUrl: z.string().url().optional().default('http://127.0.0.1:1234'),
  enableDecisionModel: z.boolean().optional().default(false),
  decisionConfidenceThreshold: z.number().min(0.1).max(1.0).optional().default(0.80),
  decisionMode: z.enum(['hybrid', 'fast_routing']).optional().default('hybrid'),
  autoMoveEnabled: z.boolean().optional().default(false),
  topLevelCategories: z.array(z.string()).optional().default([
    "Project",
    "Essay/Knowledge",
    "Dialogue/Transcript",
    "Poem",
    "Screenplay/Script",
    "Idea",
    "Journal/Diary",
    "Technical/Code"
  ]),
  typeRoutes: z.record(z.string(), z.string()).optional().default({
    "Essay/Knowledge": "03_Knowledge/Essays",
    "Dialogue/Transcript": "03_Knowledge/Dialogues",
    "Poem": "03_Knowledge/Poems",
    "Screenplay/Script": "03_Knowledge/Scripts",
    "Idea": "05_Ideas/Inbox",
    "Journal/Diary": "04_Journal/Daily",
    "Technical/Code": "03_Knowledge/Technical"
  }),
  modelsPath: z.string().optional().default(''),
  llamaServerBinary: z.string().optional().default(''),
  autoStartJevServer: z.boolean().optional().default(true),
  autoStartPrimaryServer: z.boolean().optional().default(false),
  memoryProfile: z.enum(['balanced_16gb', 'solo_7b', 'custom']).optional().default('balanced_16gb'),
  contextSize: z.number().int().min(512).max(16384).optional().default(2048),
  threadCount: z.number().int().min(1).max(32).optional().default(4),
  primaryModelFile: z.string().optional().default('Hermes-3-Llama-3.2-3B.Q4_K_M.gguf'),
  jevModelFile: z.string().optional().default('Jev-Style-Qwen3.5-2B-Decision-Q4_K_M.gguf'),
});

export const DirectoryAuditSchema = z.object({
  relativeDir: z.string().default(''),
  recursive: z.boolean().optional().default(true),
  maxDepth: z.number().int().min(1).max(20).optional().default(10),
  includeNonMarkdown: z.boolean().optional().default(true),
});

export const ApplyRevisionSchema = z.object({
  itemsToMove: z.array(z.object({
    filePath: z.string().min(1),
    targetFolder: z.string().min(1),
    detectedType: z.string().default('general'),
    action: z.enum(['move', 'convert_to_md', 'delete_junk']).optional().default('move'),
  })).min(1),
  cleanupEmptyFolders: z.boolean().optional().default(true),
  confirm: z.boolean().optional().default(false),
});

export const ServerControlSchema = z.object({
  type: z.enum(['primary', 'jev', 'all']),
  action: z.enum(['start', 'stop', 'restart']),
  modelFilename: z.string().optional(),
});

export const GenerateScriptsSchema = z.object({
  modelsDir: z.string().optional(),
  targetDir: z.string().optional(),
});

export const RefineVaultSchema = z.object({
  force: z.boolean().optional().default(false),
  dryRun: z.boolean().optional().default(false),
  folder: z.string().optional().default(''),
  smartRename: z.boolean().optional().default(true),
  useDecisionModel: z.boolean().optional(),
});

export const DuplicatesResolveSchema = z.object({
  resolvedPaths: z.array(z.string().min(1)).min(1),
});

export const ArchiveDuplicatesSchema = z.object({
  paths: z.array(z.string().min(1)).min(1),
});

export const DecisionTestSchema = z.object({
  text: z.string().min(1).max(20000),
  filename: z.string().optional().default('Note.md'),
  question: z.string().optional(),
  options: z.array(z.string().min(1)).min(2).max(26).optional(),
  decisionModelUrl: z.string().url().optional(),
});

export const DecisionTriageResolveSchema = z.object({
  filePath: z.string().min(1),
  targetFolder: z.string().min(1),
  applyTag: z.string().optional(),
});

// --- Dynamic Semantic Hypergraph (DSH) Schemas ---

export const TokenKeySchema = z.string().min(2).max(64);
export const TokenKindSchema = z.enum(['concept', 'project', 'alias', 'linker']);

export const TokenSchema = z.object({
  key: TokenKeySchema,
  kind: TokenKindSchema,
  sourceNote: z.string(),
  firstSeenAt: z.string(),
  aliases: z.array(z.string()).default([]),
  deprecated: z.boolean().optional().default(false),
  schemaVersion: z.number().int().default(1)
});

export const HyperedgeEvidenceSchema = z.object({
  type: z.enum(['cooccurrence', 'oracle', 'confirmed']),
  note: z.string().optional()
});

export const HyperedgeSchema = z.object({
  id: z.string(),
  triple: z.tuple([z.string(), z.string(), z.string()]),
  weight: z.number().min(0).max(1),
  evidence: HyperedgeEvidenceSchema,
  evidenceCount: z.number().int().default(1),
  createdAt: z.string(),
  tick: z.number().int().default(0),
  model: z.string().default('Jev-Style-Qwen3.5-2B-Decision-Q4_K_M'),
  schemaVersion: z.number().int().default(1),
  status: z.enum(['active', 'pending', 'rejected']).default('active'),
  lastEvidenceAt: z.string().optional(),
  stale: z.boolean().optional()
});

export const HypergraphConfigSchema = z.object({
  modelFile: z.string().default('Jev-Style-Qwen3.5-2B-Decision-Q4_K_M.gguf'),
  ctxSize: z.number().int().default(4096),
  gpuLayers: z.number().int().default(0),
  maxConcurrent: z.number().int().default(1),
  minIntervalMs: z.number().int().default(0),
  hybridMin: z.number().min(0).max(1).default(0.6),
  maxCandidatesPerNote: z.number().int().default(15),
  oracleMin: z.number().min(0).max(1).default(0.5),
  oracleRun: z.enum(['manual', 'on_index', 'scheduled']).default('manual'),
  oracleCron: z.string().optional().default('0 3 * * *'),
  maxCallsPerRun: z.number().int().default(2000),
  maxWallClockMsPerRun: z.number().int().default(600000),
  edgeTTLDays: z.number().int().default(180),
  schemaVersion: z.number().int().default(1)
});


