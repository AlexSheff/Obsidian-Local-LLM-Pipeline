import fs from 'fs';
const fsPromises = fs.promises;
import path from 'path';
import axios from 'axios';
import { parseNote, serializeNote, mergeTags } from './frontmatter';
import { sanitizeTagList } from './tags';
import { pruneEmptyParentDirs } from './directoryRevisor';
import { ensureLanguageTags } from './language';
import { isDecisionServerReachable } from './decisionModel';
import { chooseOne } from './llm/router';
import { createSnapshotSession } from './snapshot';
import { isPathInsideVault } from './validation';
import { safeSlice, sanitizePayloadForLlm } from './unicode';

export type AgentIntent = 'search' | 'create' | 'edit' | 'move' | 'plan' | 'chat';

export interface AgentMatchedNote {
  relativePath: string;
  filename: string;
  title: string;
  folder: string;
  tags: string[];
  snippet: string;
  score: number;
}

export interface AgentExecutedAction {
  type: 'create_note' | 'edit_note' | 'append_note' | 'move_note';
  targetPath: string;
  title?: string;
  summary: string;
  snapshotId?: string;
}

export interface KnowledgeAgentRequest {
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  activeNotePath?: string | null;
  autoExecuteActions?: boolean;
}

export interface KnowledgeAgentResponse {
  reply: string;
  intent: AgentIntent;
  jevTelemetry: {
    online: boolean;
    category?: string;
    confidence?: number;
    suggestedFolder?: string;
  };
  llmOnline: boolean;
  matchedNotes: AgentMatchedNote[];
  executedActions: AgentExecutedAction[];
  suggestedDraft?: {
    title: string;
    folder: string;
    tags: string[];
    content: string;
  };
}

/**
 * Extracts stem tokens for vault search (supports English and unicode-escaped Russian stems)
 */
function tokenizeSearchQuery(query: string): string[] {
  const stopWords = new Set([
    '\u043d\u0430\u0439\u0434\u0438',
    '\u043d\u0430\u0439\u0442\u0438',
    '\u043f\u043e\u043a\u0430\u0436\u0438',
    '\u043f\u043e\u043a\u0430\u0437\u0430\u0442\u044c',
    '\u0432\u0441\u0435',
    '\u0432\u0441\u0451',
    '\u0437\u0430\u043c\u0435\u0442\u043a\u0438',
    '\u0437\u0430\u043c\u0435\u0442\u043a\u0443',
    '\u0444\u0430\u0439\u043b\u044b',
    '\u0444\u0430\u0439\u043b',
    '\u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u044b',
    '\u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442',
    '\u043f\u0440\u043e',
    '\u0434\u043b\u044f',
    '\u0438\u043b\u0438',
    '\u043a\u0430\u043a',
    '\u0447\u0442\u043e',
    '\u0433\u0434\u0435',
    '\u043a\u0430\u043a\u0438\u0435',
    '\u0435\u0441\u0442\u044c',
    '\u043c\u043d\u0435',
    '\u0441\u043e\u0437\u0434\u0430\u0439',
    '\u0441\u043e\u0437\u0434\u0430\u0442\u044c',
    '\u0441\u0434\u0435\u043b\u0430\u0439',
    '\u0441\u0434\u0435\u043b\u0430\u0442\u044c',
    '\u043d\u0430\u043f\u0438\u0448\u0438',
    '\u043e\u0442\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u0443\u0439',
    '\u0438\u0437\u043c\u0435\u043d\u0438',
    '\u0434\u043e\u0431\u0430\u0432\u044c',
    '\u0434\u043e\u043f\u043e\u043b\u043d\u0438',
    '\u043f\u0435\u0440\u0435\u043c\u0435\u0441\u0442\u0438',
    '\u043f\u043b\u0430\u043d',
    '\u0431\u0430\u0437\u0435',
    '\u0437\u043d\u0430\u043d\u0438\u0439',
    '\u043f\u0430\u043f\u043a\u0435',
    '\u043f\u0430\u043f\u043a\u0443',
    '\u044d\u0442\u043e\u0442',
    '\u044d\u0442\u0443',
    'the', 'and', 'for', 'with', 'find', 'search', 'show', 'notes', 'note', 'file', 'files', 'about',
    'create', 'edit', 'update', 'move', 'plan', 'from', 'into', 'all'
  ]);

  const rawWords = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !stopWords.has(w));

  const cyrRangeRegex = new RegExp('[\\u0430-\\u044f\\u0451]', 'i');
  const cyrSuffixRegex = new RegExp(
    '(?:\\u043e\\u0432|\\u0435\\u0432|\\u0430\\u043c|\\u044f\\u043c|\\u0430\\u043c\\u0438|\\u044f\\u043c\\u0438|\\u0430\\u0445|\\u044f\\u0445|\\u043e\\u0433\\u043e|\\u0435\\u0433\\u043e|\\u043e\\u043c\\u0443|\\u0435\\u043c\\u0443|\\u0443\\u044e|\\u044e\\u044e|\\u044b\\u043c\\u0438|\\u0438\\u043c\\u0438|\\u0430\\u044f|\\u044f\\u044f|\\u043e\\u0435|\\u0435\\u0435|\\u044b\\u0435|\\u0438\\u0435|\\u043e\\u0439|\\u0435\\u0439|\\u043e\\u043c|\\u0435\\u043c|\\u0430|\\u044f|\\u044b|\\u0438|\\u0443|\\u044e|\\u0435)$',
    'i'
  );

  return rawWords.map(w => {
    if (w.length >= 6 && cyrRangeRegex.test(w)) {
      return w.replace(cyrSuffixRegex, '');
    }
    return w;
  });
}

/**
 * Deterministically detects the user's primary operational intent from natural language
 */
export function detectUserIntent(message: string, hasActiveNote: boolean): AgentIntent {
  const lower = message.toLowerCase().trim();

  const createRegex1 = new RegExp(
    '^(?:\\u0441\\u043e\\u0437\\u0434\\u0430\\u0439|\\u0441\\u043e\\u0437\\u0434\\u0430\\u0442\\u044c|\\u043d\\u0430\\u043f\\u0438\\u0448\\u0438 \\u043d\\u043e\\u0432\\u0443\\u044e \\u0437\\u0430\\u043c\\u0435\\u0442\\u043a\\u0443|\\u0441\\u043e\\u0445\\u0440\\u0430\\u043d\\u0438 \\u0432 \\u0444\\u0430\\u0439\\u043b|\\u0441\\u0434\\u0435\u043b\u0430\u0439 \\u0437\\u0430\\u043c\\u0435\\u0442\\u043a\\u0443|\\u043d\\u043e\\u0432\\u044b\\u0439 \\u0444\\u0430\\u0439\\u043b|create note|create a note|new note)',
    'i'
  );
  const createRegex2 = new RegExp(
    '(?:\\u0441\\u043e\\u0437\\u0434\\u0430\\u0439|\\u0441\\u043e\\u0445\\u0440\\u0430\\u043d\\u0438|create|save)\\s+(?:\\u043d\\u043e\\u0432\\u0443\\u044e\\s+|a\\s+|new\\s+)?(?:\\u0437\\u0430\\u043c\\u0435\\u0442\\u043a\\u0443|\\u0444\\u0430\\u0439\\u043b|\\u0434\\u043e\\u043a\\u0443\\u043c\\u0435\\u043d\\u0442|note|file|document)',
    'i'
  );
  if (createRegex1.test(lower) || createRegex2.test(lower)) {
    return 'create';
  }

  const moveRegex = new RegExp(
    '(?:\\u043f\\u0435\\u0440\\u0435\\u043c\\u0435\\u0441\\u0442\\u0438|\\u043f\\u0435\\u0440\\u0435\\u043d\\u0435\\u0441\\u0438|\\u043f\\u0435\\u0440\\u0435\\u043b\\u043e\\u0436\\u0438|move note|move file|\\u043e\\u0442\\u043f\\u0440\\u0430\\u0432\\u044c \\u0432 \\u043f\\u0430\\u043f\\u043a\\u0443)',
    'i'
  );
  if (moveRegex.test(lower)) {
    return 'move';
  }

  const editRegex = new RegExp(
    '(?:\\u043e\\u0442\\u0440\\u0435\\u0434\\u0430\\u043a\\u0442\\u0438\\u0440\\u0443\\u0439|\\u0438\\u0437\\u043c\\u0435\\u043d\\u0438|\\u0434\\u043e\\u043f\\u043e\\u043b\\u043d\\u0438|\\u0434\\u043e\\u043f\\u0438\\u0448\\u0438|\\u0434\\u043e\\u0431\\u0430\\u0432\\u044c \\u0432|\\u043f\\u0435\\u0440\\u0435\\u043f\\u0438\\u0448\\u0438|\\u043e\\u0431\\u043d\\u043e\\u0432\\u0438|\\u0438\\u0441\\u043f\\u0440\\u0430\\u0432\\u044c|edit this|update this|append to)',
    'i'
  );
  if (hasActiveNote && editRegex.test(lower)) {
    return 'edit';
  }

  const planRegex = new RegExp(
    '(?:\\u0441\\u043e\\u0441\\u0442\\u0430\\u0432\\u044c \\u043f\\u043b\\u0430\\u043d|\\u0441\\u043f\\u043b\\u0430\\u043d\\u0438\\u0440\\u0443\\u0439|\\u043f\\u043b\\u0430\\u043d \\u0437\\u0430\\u043f\\u0443\\u0441\\u043a\\u0430|\\u0434\\u043e\\u0440\\u043e\\u0436\\u043d\\w+ \\u043a\\u0430\\u0440\\u0442\\w+|roadmap|\\u0434\\u0435\\u043a\\u043e\\u043c\\u043f\\u043e\\u0437\\u0438\\u0446|\\u0441\\u043f\\u0438\\u0441\\u043e\\u043a \\u0437\\u0430\\u0434\\u0430\\u0447|\\u0442\\u0437 |\\u0442\\u0435\\u0445\\u043d\\u0438\\u0447\\u0435\\u0441\\u043a\\u043e\\u0435 \\u0437\\u0430\\u0434\\u0430\\u043d\\u0438\\u0435|action plan|launch plan)',
    'i'
  );
  if (planRegex.test(lower)) {
    return 'plan';
  }

  const searchRegex = new RegExp(
    '(?:\\u043d\\u0430\\u0439\\u0434\\u0438|\\u043d\\u0430\\u0439\\u0442\\u0438|\\u043f\\u043e\\u0438\\u0441\\u043a|\\u043f\\u043e\\u043a\\u0430\\u0436\\u0438 \\u0432\\u0441\\u0435|\\u043a\\u0430\\u043a\\u0438\\u0435 \\u0437\\u0430\\u043c\\u0435\\u0442\\u043a\\u0438|\\u0433\\u0434\\u0435 \\u043b\\u0435\\u0436\\u0430\\u0442|search|find notes|find all|list notes)',
    'i'
  );
  if (searchRegex.test(lower)) {
    return 'search';
  }

  return 'chat';
}

/**
 * Scans the vault and retrieves the top N most relevant notes for RAG & search
 */
export async function searchVaultNotesForAgent(
  vaultPath: string,
  query: string,
  limit = 8
): Promise<{ matchedNotes: AgentMatchedNote[]; totalVaultNotes: number; folders: string[] }> {
  if (!vaultPath || !fs.existsSync(vaultPath)) {
    return { matchedNotes: [], totalVaultNotes: 0, folders: [] };
  }

  const stems = tokenizeSearchQuery(query);
  const rawLower = query.toLowerCase();
  const candidates: AgentMatchedNote[] = [];
  const folderSet = new Set<string>();
  let totalVaultNotes = 0;

  async function walk(dir: string) {
    let entries: fs.Dirent[] = [];
    try {
      entries = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const lowerName = entry.name.toLowerCase();
      if (lowerName === '99_system' || lowerName === 'node_modules' || lowerName === '_trash') continue;

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const relDir = path.relative(vaultPath, fullPath).replace(/\\/g, '/');
        folderSet.add(relDir);
        await walk(fullPath);
      } else if (lowerName.endsWith('.md')) {
        totalVaultNotes++;
        try {
          const stat = await fsPromises.stat(fullPath);
          if (stat.size === 0 || stat.size > 512 * 1024) continue;

          const rawContent = await fsPromises.readFile(fullPath, 'utf-8');
          const parsed = parseNote(rawContent);
          const body = parsed.body.trim();
          if (!body) continue;

          const relPath = path.relative(vaultPath, fullPath).replace(/\\/g, '/');
          const folder = path.dirname(relPath).replace(/\\/g, '/');
          const title = String(parsed.data?.title || entry.name.replace(/\.md$/i, '')).trim();
          const tags = Array.isArray(parsed.data?.tags)
            ? parsed.data.tags.map((t: any) => String(t).replace(/^#+/, ''))
            : [];

          const titleLower = title.toLowerCase();
          const fileLower = entry.name.toLowerCase();
          const bodyLower = body.slice(0, 3000).toLowerCase();
          const tagsLower = tags.join(' ').toLowerCase();
          const folderLower = folder.toLowerCase();

          let score = 0;
          if (stems.length === 0) {
            score = 1 + Math.min(5, Math.floor(stat.mtimeMs / 1e11));
          } else {
            for (const stem of stems) {
              if (titleLower.includes(stem) || fileLower.includes(stem)) score += 12;
              if (tagsLower.includes(stem)) score += 9;
              if (folderLower.includes(stem)) score += 6;
              if (bodyLower.includes(stem)) score += 4;
            }
            if (stems.length >= 2 && (titleLower.includes(rawLower) || bodyLower.includes(rawLower))) {
              score += 15;
            }
          }

          if (score > 0) {
            candidates.push({
              relativePath: relPath,
              filename: entry.name,
              title,
              folder: folder === '.' ? 'Root' : folder,
              tags: tags.slice(0, 8),
              snippet: safeSlice(body.replace(/\s+/g, ' '), 0, 320),
              score
            });
          }
        } catch {
          // ignore unreadable file
        }
      }
    }
  }

  await walk(vaultPath);
  candidates.sort((a, b) => b.score - a.score);

  return {
    matchedNotes: candidates.slice(0, limit),
    totalVaultNotes,
    folders: Array.from(folderSet).sort().slice(0, 30)
  };
}

/**
 * Parses and executes ```action ... ``` blocks emitted by the LLM or direct user commands
 */
async function parseAndExecuteActions(params: {
  rawReply: string;
  vaultPath: string;
  activeNotePath?: string | null;
  autoExecute: boolean;
  onLog: (msg: string, type?: 'info' | 'success' | 'warn' | 'error') => void;
}): Promise<{ cleanReply: string; executedActions: AgentExecutedAction[]; suggestedDraft?: KnowledgeAgentResponse['suggestedDraft'] }> {
  const executedActions: AgentExecutedAction[] = [];
  let suggestedDraft: KnowledgeAgentResponse['suggestedDraft'] | undefined;

  const actionRegex = /```(?:action|vault_action)\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  const blocks: any[] = [];

  while ((match = actionRegex.exec(params.rawReply)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed && typeof parsed === 'object' && parsed.action) {
        blocks.push(parsed);
      }
    } catch {
      // Ignore malformed JSON block
    }
  }

  const cleanReply = params.rawReply.replace(actionRegex, '').trim();

  if (!params.vaultPath || !fs.existsSync(params.vaultPath) || blocks.length === 0) {
    return { cleanReply, executedActions, suggestedDraft };
  }

  const snapshot = createSnapshotSession(params.vaultPath);

  for (const block of blocks) {
    const actionType = String(block.action || '').trim();
    try {
      if (actionType === 'create_note') {
        const folder = String(block.folder || '01_Projects/Active')
          .replace(/\\/g, '/')
          .replace(/^\/+|\/+$/g, '');
        const rawTitle = String(block.title || 'New Note')
          .replace(/[\\/:*?"<>|]/g, '')
          .trim();
        const bodyContent = String(block.content || block.body || '').trim();
        const rawTags = sanitizeTagList(Array.isArray(block.tags) ? block.tags : [], { allowSingleLetter: false });

        if (!params.autoExecute) {
          suggestedDraft = { title: rawTitle, folder, tags: rawTags, content: bodyContent };
          continue;
        }

        const targetDir = path.join(params.vaultPath, folder);
        if (!isPathInsideVault(targetDir, params.vaultPath)) continue;
        await fsPromises.mkdir(targetDir, { recursive: true });

        const destPath = path.join(targetDir, `${rawTitle}.md`);
        if (!isPathInsideVault(destPath, params.vaultPath)) continue;
        if (fs.existsSync(destPath)) {
          await snapshot.backup(destPath);
        }

        const tagsWithLang = ensureLanguageTags(rawTags, bodyContent, `${rawTitle}.md`);
        const fm = {
          title: rawTitle,
          category: folder,
          tags: tagsWithLang,
          created_by: 'local_ai_chat',
          created_at: new Date().toISOString().slice(0, 10),
          ai_refined: true
        };
        const fileData = serializeNote(fm, bodyContent);
        await fsPromises.writeFile(destPath, fileData, 'utf-8');

        const relCreated = path.relative(params.vaultPath, destPath).replace(/\\/g, '/');
        executedActions.push({
          type: 'create_note',
          targetPath: relCreated,
          title: rawTitle,
          summary: `Created file "${relCreated}"`,
          snapshotId: snapshot.sessionId
        });
        params.onLog(`[AI Chat Agent] Created note: "${relCreated}"`, 'success');
      } else if (actionType === 'edit_note' || actionType === 'append_note') {
        const targetRel = String(block.path || params.activeNotePath || '').trim();
        if (!targetRel) continue;
        const fullPath = path.join(params.vaultPath, targetRel);
        if (!isPathInsideVault(fullPath, params.vaultPath, false) || !fs.existsSync(fullPath)) continue;

        await snapshot.backup(fullPath);
        const existingRaw = await fsPromises.readFile(fullPath, 'utf-8');
        const parsed = parseNote(existingRaw);

        const incomingText = String(block.content || block.body || '').trim();
        if (actionType === 'append_note') {
          parsed.body = `${parsed.body.trim()}\n\n${incomingText}\n`;
        } else if (incomingText) {
          parsed.body = incomingText;
        }

        if (Array.isArray(block.tags) && block.tags.length > 0) {
          mergeTags(parsed.data, block.tags.map(String));
        }
        if (block.title) {
          parsed.data.title = String(block.title).trim();
        }

        const updatedRaw = serializeNote(parsed.data, parsed.body);
        await fsPromises.writeFile(fullPath, updatedRaw, 'utf-8');

        executedActions.push({
          type: actionType as 'edit_note' | 'append_note',
          targetPath: targetRel,
          summary: `${actionType === 'append_note' ? 'Appended to' : 'Updated'} file "${targetRel}"`,
          snapshotId: snapshot.sessionId
        });
        params.onLog(`[AI Chat Agent] Updated note: "${targetRel}"`, 'success');
      } else if (actionType === 'move_note') {
        const sourceRel = String(block.sourcePath || params.activeNotePath || '').trim();
        const targetFolder = String(block.targetFolder || block.folder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        if (!sourceRel || !targetFolder) continue;

        const sourceAbs = path.join(params.vaultPath, sourceRel);
        const targetDirAbs = path.join(params.vaultPath, targetFolder);
        const destAbs = path.join(targetDirAbs, path.basename(sourceAbs));

        if (
          !isPathInsideVault(sourceAbs, params.vaultPath, false) ||
          !isPathInsideVault(destAbs, params.vaultPath) ||
          !fs.existsSync(sourceAbs)
        ) {
          continue;
        }

        const oldDir = path.dirname(sourceAbs);
        await snapshot.backup(sourceAbs);
        await fsPromises.mkdir(targetDirAbs, { recursive: true });
        await fsPromises.rename(sourceAbs, destAbs);
        await pruneEmptyParentDirs(params.vaultPath, oldDir);
        const newRel = path.relative(params.vaultPath, destAbs).replace(/\\/g, '/');

        executedActions.push({
          type: 'move_note',
          targetPath: newRel,
          summary: `Moved "${sourceRel}" -> "${newRel}"`,
          snapshotId: snapshot.sessionId
        });
        params.onLog(`[AI Chat Agent] Moved note: "${sourceRel}" -> "${newRel}"`, 'success');
      }
    } catch (err: any) {
      params.onLog(`[AI Chat Agent] Action error (${actionType}): ${err.message}`, 'warn');
    }
  }

  return { cleanReply: cleanReply || params.rawReply, executedActions, suggestedDraft };
}

/**
 * Executes a full turn of the Local Knowledge Chat Agent (Jev + Primary LLM + Vault RAG + File Actions)
 */
export async function runKnowledgeAgentTurn(
  req: KnowledgeAgentRequest,
  config: {
    vaultPath: string;
    llamaUrl: string;
    decisionModelUrl: string;
    enableDecisionModel: boolean;
    typeRoutes: Record<string, string>;
  },
  onLog: (msg: string, type?: 'info' | 'success' | 'warn' | 'error') => void
): Promise<KnowledgeAgentResponse> {
  const userMessage = (req.message || '').trim();
  const hasActiveNote = Boolean(req.activeNotePath);
  const intent = detectUserIntent(userMessage, hasActiveNote);

  // 1. Query Jev Decision Server (if reachable) to classify the topic/category of the user's request
  const jevTelemetry: KnowledgeAgentResponse['jevTelemetry'] = { online: false };
  if (config.decisionModelUrl) {
    const jevOnline = await isDecisionServerReachable(config.decisionModelUrl, 900);
    if (jevOnline) {
      jevTelemetry.online = true;
      try {
        const categories = [
          'Project',
          'Technical/Code',
          'Essay/Knowledge',
          'Dialogue/Transcript',
          'Idea',
          'Journal/Diary'
        ];
        const jevRes = await chooseOne(
          `User Request: ${userMessage}`,
          'Which knowledge base category does this request belong to?',
          categories,
          { decisionModelUrl: config.decisionModelUrl, timeoutMs: 4000 }
        );
        jevTelemetry.category = jevRes.chosen.option;
        jevTelemetry.confidence = jevRes.confidence;
        jevTelemetry.suggestedFolder =
          jevRes.chosen.option === 'Project'
            ? '01_Projects/Active'
            : config.typeRoutes[jevRes.chosen.option] || '03_Knowledge/Essays';
      } catch {
        // non-fatal
      }
    }
  }

  // 2. Search Vault for relevant notes (RAG)
  const { matchedNotes, totalVaultNotes, folders } = await searchVaultNotesForAgent(
    config.vaultPath,
    userMessage,
    6
  );

  // Load active note if selected in UI
  let activeNoteContext = '';
  if (req.activeNotePath && config.vaultPath) {
    const activeAbs = path.join(config.vaultPath, req.activeNotePath);
    if (isPathInsideVault(activeAbs, config.vaultPath, false) && fs.existsSync(activeAbs)) {
      try {
        const raw = await fsPromises.readFile(activeAbs, 'utf-8');
        const parsed = parseNote(raw);
        activeNoteContext = `\n### CURRENTLY OPEN NOTE (${req.activeNotePath}):\nTitle: ${parsed.data?.title || path.basename(req.activeNotePath)}\nTags: ${Array.isArray(parsed.data?.tags) ? parsed.data.tags.join(', ') : 'none'}\nContent Snippet:\n${safeSlice(parsed.body, 0, 1400)}\n`;
      } catch {}
    }
  }

  const ragContext =
    matchedNotes.length > 0
      ? matchedNotes
          .map(
            (n, i) =>
              `[${i + 1}] "${n.title}" (Path: ${n.relativePath} | Tags: ${n.tags.join(', ') || 'none'})\nSnippet: ${n.snippet}`
          )
          .join('\n\n')
      : 'No direct text search matches found.';

  // 3. Build compact system prompt for the Local LLM (fits comfortably inside 4096 context window)
  const systemPrompt = `You are a Local AI Knowledge Base Assistant and Obsidian Vault Architect (running on the Jev Router + Primary Local LLM tandem).
Your job is to help the user explore their knowledge base, find documents, plan projects, and create or edit Markdown notes.
Always reply in the same language as the user's message, clearly, concisely, and grounded in the matched vault notes.

VAULT STATISTICS:
- Total Notes: ${totalVaultNotes}
- Core PARA Folders: ${folders.slice(0, 15).join(', ') || '01_Projects, 02_Areas, 03_Knowledge, 04_Journal, 05_Ideas'}
${jevTelemetry.online ? `- Jev Classifier Recommendation: category "${jevTelemetry.category}" -> folder "${jevTelemetry.suggestedFolder}" (${Math.round((jevTelemetry.confidence || 0) * 100)}%)` : ''}
${activeNoteContext}
### MATCHED VAULT NOTES FOR THIS QUERY:
${ragContext}

### FILE MANAGEMENT VIA CHAT (IMPORTANT):
If the user asks to CREATE a new note/plan/document, EDIT/APPEND to the currently open note, or MOVE a file, append a valid \`\`\`action JSON block at the end of your response:

1) To create a new note:
\`\`\`action
{"action": "create_note", "title": "Clean Note Title", "folder": "${jevTelemetry.suggestedFolder || '01_Projects/Active'}", "tags": ["en", "tag1", "tag2"], "content": "# Heading\\n\\nFull Markdown content..."}
\`\`\`

2) To append to or edit the open note (${req.activeNotePath || 'path/to/note.md'}):
\`\`\`action
{"action": "append_note", "path": "${req.activeNotePath || ''}", "content": "## New Section\\n\\nAppended Markdown text..."}
\`\`\`
(or \`"action": "edit_note"\` to replace the full body).

3) To move a note to another folder:
\`\`\`action
{"action": "move_note", "sourcePath": "${req.activeNotePath || ''}", "targetFolder": "03_Knowledge/Technical"}
\`\`\`

If the user is simply asking a question, searching for information, or brainstorming without requesting a file creation/modification, DO NOT emit an \`\`\`action block — just provide a helpful structured answer referencing vault notes as [[Title]].`;

  const recentHistory = (req.history || []).slice(-4).map(m => ({
    role: m.role,
    content: safeSlice(m.content, 0, 600)
  }));

  const messages = [
    { role: 'system', content: systemPrompt },
    ...recentHistory,
    { role: 'user', content: userMessage }
  ];

  // 4. Call Primary Local LLM (port 8080)
  const cleanLlamaUrl = (config.llamaUrl || 'http://127.0.0.1:8080').replace(/\/+$/, '');
  let llmOnline = false;
  let rawReply = '';

  try {
    const payload = sanitizePayloadForLlm({
      messages,
      temperature: 0.3,
      max_tokens: 900,
      stream: false,
      cache_prompt: true
    });

    const resp = await axios.post(`${cleanLlamaUrl}/v1/chat/completions`, payload, {
      timeout: 120000,
      headers: { 'Content-Type': 'application/json' }
    });

    llmOnline = true;
    rawReply = resp.data?.choices?.[0]?.message?.content?.trim() || '';
  } catch (err: any) {
    llmOnline = false;
    if (matchedNotes.length > 0) {
      const listStr = matchedNotes
        .map((n, i) => `${i + 1}. **[[${n.title}]]** (\`${n.relativePath}\`) — ${n.snippet.slice(0, 140)}...`)
        .join('\n');
      rawReply = `Found **${matchedNotes.length}** matching documents in your vault:\n\n${listStr}\n\n*(Note: Primary generative LLM server at \`${cleanLlamaUrl}\` is currently unreachable: ${err.message}. Local vault search succeeded. Start your model in the "Dual-Model Engine" tab or via \`start.bat\` for generative chat).*`;
    } else {
      rawReply = `Primary generative LLM server (\`${cleanLlamaUrl}\`) is currently unreachable (${err.message}). Start the model in the "Dual-Model Engine" tab or via \`start.bat\`.`;
    }
  }

  // 5. Parse and execute any file actions
  const { cleanReply, executedActions, suggestedDraft } = await parseAndExecuteActions({
    rawReply,
    vaultPath: config.vaultPath,
    activeNotePath: req.activeNotePath,
    autoExecute: req.autoExecuteActions !== false,
    onLog
  });

  // Fallback: If user explicitly asked to CREATE a note and LLM was online
  // but didn't emit an ```action``` JSON block, execute creation from the LLM's Markdown reply!
  if (
    llmOnline &&
    intent === 'create' &&
    executedActions.length === 0 &&
    cleanReply.length > 20 &&
    config.vaultPath &&
    fs.existsSync(config.vaultPath)
  ) {
    const headingMatch = cleanReply.match(/^#\s+([^\r\n]+)/m);
    const prefixRegex = new RegExp(
      '^(?:\\u0441\\u043e\\u0437\\u0434\\u0430\\u0439|\\u0441\\u043e\\u0437\\u0434\\u0430\\u0442\\u044c|\\u043d\\u0430\\u043f\\u0438\\u0448\\u0438|\\u0441\\u043e\\u0445\\u0440\\u0430\\u043d\\u0438|create|write|save)\\s+(?:\\u043d\\u043e\\u0432\\u0443\\u044e\\s+|a\\s+|new\\s+)?(?:\\u0437\\u0430\\u043c\\u0435\\u0442\\u043a\\u0443|\\u0444\\u0430\\u0439\\u043b|\\u0434\\u043e\\u043a\\u0443\\u043c\\u0435\\u043d\\u0442|note|file|document)\\s*(?:\\u043f\\u0440\\u043e|\\u043e|\\u043e\\u0431|about|for|:)?\\s*',
      'i'
    );
    const derivedTitle = (
      headingMatch?.[1] ||
      userMessage.replace(prefixRegex, '').slice(0, 50) ||
      'Chat Note'
    )
      .replace(/[\\/:*?"<>|]/g, '')
      .trim();

    const targetFolder = jevTelemetry.suggestedFolder || '01_Projects/Active';
    if (req.autoExecuteActions !== false) {
      try {
        const targetDir = path.join(config.vaultPath, targetFolder);
        if (isPathInsideVault(targetDir, config.vaultPath)) {
          await fsPromises.mkdir(targetDir, { recursive: true });
          const destPath = path.join(targetDir, `${derivedTitle}.md`);
          const tags = ensureLanguageTags(['ai-chat'], cleanReply, `${derivedTitle}.md`);
          const contentToSave = serializeNote(
            {
              title: derivedTitle,
              category: targetFolder,
              tags,
              created_by: 'local_ai_chat',
              ai_refined: true
            },
            cleanReply
          );
          await fsPromises.writeFile(destPath, contentToSave, 'utf-8');
          const relCreated = path.relative(config.vaultPath, destPath).replace(/\\/g, '/');
          executedActions.push({
            type: 'create_note',
            targetPath: relCreated,
            title: derivedTitle,
            summary: `Created file "${relCreated}"`
          });
          onLog(`[AI Chat Agent] Auto-created requested note: "${relCreated}"`, 'success');
        }
      } catch {}
    }
  }

  return {
    reply: cleanReply,
    intent,
    jevTelemetry,
    llmOnline,
    matchedNotes,
    executedActions,
    suggestedDraft
  };
}
