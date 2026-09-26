import path from 'path';
import fs from 'fs';
const fsPromises = fs.promises;
import axios from 'axios';
import { parseNote, serializeNote, mergeTags } from './frontmatter';
import { SnapshotSession } from './snapshot';
import { sanitizePayloadForLlm, safeTruncateHeadTail } from './unicode';
import { detectDocumentLanguage } from './language';
import { extractDocumentInfo, isJunkFile, DocumentInfo } from './documentExtractor';
import { sanitizeTitle } from './sanitize';
import { matchProjectByHeader, DEFAULT_PROJECTS, ProjectDefinition } from './projectsRegistry';
import { isPathInsideVault } from './validation';

export type DetectedItemType =
  | 'scenario'
  | 'project_asset'
  | 'technical_code'
  | 'foreign_project'
  | 'raw_document'
  | 'junk'
  | 'media_asset'
  | 'knowledge'
  | 'general';

export interface FileRevisionItem {
  id: string;
  filename: string;
  relativePath: string;      // Relative to vault root (e.g. "01_Projects/CleanNet/drafts/note.md")
  subfolder: string;         // Relative to audited root folder (e.g. "drafts" or "" for root)
  absolutePath: string;
  title: string;
  extension: string;
  sizeBytes: number;
  existingTags: string[];
  snippet: string;
  detectedType: DetectedItemType;
  coherenceScore: number;    // 0 to 100
  isOutlier: boolean;
  contradictionReason: string;
  suggestedTargetFolder: string;
  suggestedAction: 'move' | 'convert_to_md' | 'delete_junk';
  confidence: number;
  selectedForMove?: boolean;
}

export interface DirectoryAuditReport {
  directoryPath: string;
  totalFiles: number;
  totalSubfoldersScanned: number;
  subfoldersList: string[];
  dominantTopic: string;
  summary: string;
  overallCoherence: number;
  hasContradictions: boolean;
  outliersCount: number;
  scenariosCount: number;
  rawDocsCount: number;
  junkCount: number;
  items: FileRevisionItem[];
  timestamp: string;
}

/**
 * Detects screenplay, dialogue, or narrative storyline markers in note text.
 * C5: Strictly requires sluglines, 3+ distinct dialogue speakers, or 2+ dramaturgy terms.
 * Never flags standard note headers ("ИТОГ:", "ЗАДАЧА:", "СТАТУС:") as dialogue.
 */
export function detectScenarioMarkers(text: string, filename: string): { isScenario: boolean; markers: string[]; confidence: number } {
  const lowerText = text.toLowerCase();
  const lowerName = filename.toLowerCase();
  const markers: string[] = [];

  // Filename markers
  let hasFilenameMarker = false;
  if (
    lowerName.includes('сценарий') ||
    lowerName.includes('scenario') ||
    lowerName.includes('script') ||
    lowerName.includes('сюжет') ||
    lowerName.includes('синопсис') ||
    lowerName.includes('эпизод') ||
    lowerName.includes('диалог') ||
    lowerName.includes('серия') ||
    lowerName.includes('глава')
  ) {
    hasFilenameMarker = true;
    markers.push('Screenplay indicator in filename');
  }

  // Classical screenplay headings (INT./EXT. or ИНТ./НАТ.)
  const sluglineRegex = /(?:^|\n)\s*(?:ИНТ|НАТ|ИНТ\/НАТ|EXT|INT|EXT\/INT)[\.\s\-]+[^\n]{3,60}/i;
  const hasSlugline = sluglineRegex.test(text);
  if (hasSlugline) {
    markers.push('Scene sluglines (INT./EXT. / ИНТ./НАТ.)');
  }

  // Character dialogue lines: requires 3 or more distinct speaker names
  const dialogueLineRegex = /(?:^|\n)\s*(?:([А-ЯЁA-Z]{3,20})(?:\s*\([^\)]+\))?|\*\*([А-ЯЁA-Z\s]{3,20})\*\*)\s*:\s*[^\n]{3,}/g;
  const commonSectionHeaders = new Set([
    'ИТОГ', 'ЗАДАЧА', 'СТАТУС', 'ВАЖНО', 'ПРИМЕЧАНИЕ', 'ЦЕЛЬ', 'ПЛАН', 'ВНИМАНИЕ',
    'NOTE', 'TODO', 'STATUS', 'SUMMARY', 'GOAL', 'IMPORTANT', 'INFO', 'RESULT'
  ]);
  const distinctSpeakerNames = new Set<string>();
  let dMatch: RegExpExecArray | null;
  while ((dMatch = dialogueLineRegex.exec(text)) !== null) {
    const rawName = (dMatch[1] || dMatch[2] || '').trim().toUpperCase();
    if (rawName && !commonSectionHeaders.has(rawName)) {
      distinctSpeakerNames.add(rawName);
    }
  }

  const hasMultipleSpeakers = distinctSpeakerNames.size >= 3;
  if (hasMultipleSpeakers) {
    markers.push(`Dialogue cues across ${distinctSpeakerNames.size} distinct speakers (${Array.from(distinctSpeakerNames).slice(0, 3).join(', ')})`);
  }

  // Narrative / dramaturgy keywords (requires >= 2 keywords)
  const narrativeKeywords = [
    'сюжетная линия', 'арка героя', 'протагонист', 'антагонист', 'кульминация',
    'завязка', 'развязка', 'реплика', 'ремарка', 'сцена 1', 'сцена 2', 'акт 1',
    'синопсис', 'персонажи:', 'раскадровка', 'сценарный план', 'plotline', 'screenplay'
  ];

  let dramaturgyCount = 0;
  for (const kw of narrativeKeywords) {
    if (lowerText.includes(kw)) {
      dramaturgyCount++;
      markers.push(`Dramaturgical term: "${kw}"`);
    }
  }
  const hasDramaturgyKeywords = dramaturgyCount >= 2;

  const isScenario = hasSlugline || hasMultipleSpeakers || hasDramaturgyKeywords || hasFilenameMarker;
  const confidence = (hasSlugline && hasMultipleSpeakers) ? 0.98 : (hasSlugline || hasMultipleSpeakers) ? 0.90 : isScenario ? 0.80 : 0.15;

  return { isScenario, markers, confidence };
}

/**
 * Detects project affiliation strictly by searching aliases in filename and document header/title.
 * C4: Never searches in note body to avoid false positives on passing references.
 */
export function detectProjectAffiliation(
  headerOrTitle: string,
  filename: string,
  projects: ProjectDefinition[] = DEFAULT_PROJECTS
): string | null {
  const headerMatch = headerOrTitle.match(/^#\s+(.+)$/m);
  const title = headerMatch ? headerMatch[1].trim() : headerOrTitle.slice(0, 200);

  const matched = matchProjectByHeader(filename, title, projects);
  return matched ? matched.folder : null;
}

/**
 * Recursively scans a folder and all its nested subfolders for files.
 */
export async function collectFolderFileSignatures(options: {
  vaultPath: string;
  relativeDir: string;
  recursive?: boolean;
  maxDepth?: number;
  includeNonMarkdown?: boolean;
}): Promise<{
  files: Array<{
    docInfo: DocumentInfo;
    relativePath: string;
    subfolder: string;
    absolutePath: string;
  }>;
  subfolders: string[];
}> {
  const {
    vaultPath,
    relativeDir,
    recursive = true,
    maxDepth = 10,
    includeNonMarkdown = true
  } = options;

  const targetRoot = path.join(vaultPath, relativeDir);
  if (!fs.existsSync(targetRoot)) {
    return { files: [], subfolders: [] };
  }

  const results: Array<{
    docInfo: DocumentInfo;
    relativePath: string;
    subfolder: string;
    absolutePath: string;
  }> = [];

  const foundSubfolders = new Set<string>();

  async function walk(currentAbsDir: string, currentDepth: number) {
    if (currentDepth > maxDepth) return;

    let entries: fs.Dirent[];
    try {
      entries = await fsPromises.readdir(currentAbsDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const lowerName = entry.name.toLowerCase();
      // Ignore system / internal / model / binary folders so LLM servers & models inside vault are never touched
      if (
        entry.name.startsWith('.') ||
        entry.name === '99_System' ||
        lowerName === 'node_modules' ||
        lowerName === 'templates' ||
        lowerName === 'llm' ||
        lowerName === 'models' ||
        lowerName === 'bin' ||
        lowerName === 'dist' ||
        lowerName === 'build' ||
        lowerName === 'venv' ||
        lowerName === '__pycache__'
      ) {
        continue;
      }

      const entryAbsPath = path.join(currentAbsDir, entry.name);
      const relToTargetRoot = path.relative(targetRoot, entryAbsPath).replace(/\\/g, '/');
      const relToVault = path.relative(vaultPath, entryAbsPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        foundSubfolders.add(relToTargetRoot);
        if (recursive) {
          await walk(entryAbsPath, currentDepth + 1);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();

        // Never touch LLM weights, executables, or shared libraries
        if (ext === '.gguf' || ext === '.exe' || ext === '.dll' || ext === '.so' || ext === '.dylib' || ext === '.bin') {
          continue;
        }
        
        // Skip MOC notes if desired, but keep normal files
        if (lowerName.startsWith('moc_') || lowerName === 'moc.md') {
          continue;
        }

        // Check if non-markdown is excluded (default is included)
        if (!includeNonMarkdown && ext !== '.md') {
          continue;
        }

        const subfolder = path.dirname(relToTargetRoot) === '.' ? '' : path.dirname(relToTargetRoot);
        
        try {
          const docInfo = await extractDocumentInfo(entryAbsPath, { lightweight: true });
          results.push({
            docInfo,
            relativePath: relToVault,
            subfolder,
            absolutePath: entryAbsPath
          });
        } catch {
          // If extraction fails, record basic info
          const junk = isJunkFile(entry.name, 0);
          results.push({
            docInfo: {
              filename: entry.name,
              extension: ext,
              sizeBytes: 0,
              category: junk.isJunk ? 'junk' : ext === '.md' ? 'note' : 'binary',
              isJunk: junk.isJunk,
              title: entry.name,
              existingTags: [],
              snippet: `[File: ${entry.name}]`,
              fullText: ''
            },
            relativePath: relToVault,
            subfolder,
            absolutePath: entryAbsPath
          });
        }
      }
    }
  }

  await walk(targetRoot, 0);

  return {
    files: results,
    subfolders: Array.from(foundSubfolders).sort()
  };
}

/**
 * Performs deep revision, subfolder clustering, and contradiction analysis on a directory.
 */
export async function auditDirectoryProject(options: {
  vaultPath: string;
  relativeDir: string;
  recursive?: boolean;
  maxDepth?: number;
  includeNonMarkdown?: boolean;
  llamaUrl?: string;
  decisionModelUrl?: string;
  timeoutSeconds?: number;
}): Promise<DirectoryAuditReport> {
  const {
    vaultPath,
    relativeDir,
    recursive = true,
    maxDepth = 10,
    includeNonMarkdown = true,
    llamaUrl
  } = options;

  const { files: fileEntries, subfolders } = await collectFolderFileSignatures({
    vaultPath,
    relativeDir,
    recursive,
    maxDepth,
    includeNonMarkdown
  });

  if (fileEntries.length === 0) {
    return {
      directoryPath: relativeDir,
      totalFiles: 0,
      totalSubfoldersScanned: subfolders.length,
      subfoldersList: subfolders,
      dominantTopic: 'Empty directory',
      summary: `No files found in "${relativeDir}" or its subfolders.`,
      overallCoherence: 100,
      hasContradictions: false,
      outliersCount: 0,
      scenariosCount: 0,
      rawDocsCount: 0,
      junkCount: 0,
      items: [],
      timestamp: new Date().toISOString()
    };
  }

  const isWholeVault = !relativeDir || relativeDir === '.' || relativeDir === 'Whole Vault' || relativeDir === 'Entire Vault';
  const normalizedDirName = path.basename(relativeDir);
  let dominantTopic = isWholeVault ? 'Entire Vault' : normalizedDirName;
  let dirSummary = isWholeVault
    ? `Entire vault contains ${fileEntries.length} files across ${subfolders.length} subfolders.`
    : `Directory "${relativeDir}" contains ${fileEntries.length} files across ${subfolders.length} subfolders.`;

  // Step 1: Pre-classify each file with deterministic heuristic & scenario markers
  const analyzedItems: FileRevisionItem[] = [];

  for (const entry of fileEntries) {
    const { docInfo, relativePath, subfolder, absolutePath } = entry;
    const scenarioCheck = detectScenarioMarkers(docInfo.snippet || docInfo.fullText, docInfo.filename);
    const foreignProject = detectProjectAffiliation(docInfo.snippet || docInfo.fullText, docInfo.filename);

    let detectedType: DetectedItemType = 'project_asset';
    let isOutlier = false;
    let contradictionReason = '';
    const currentFolder = path.dirname(relativePath) === '.' ? '' : path.dirname(relativePath);
    let suggestedFolder = relativeDir || currentFolder || '03_Knowledge';
    let suggestedAction: 'move' | 'convert_to_md' | 'delete_junk' = 'move';
    let coherenceScore = 90;
    let confidence = 0.85;

    // 1. Check for Junk / Ghost Notes (Zero actual document body text)
    if (docInfo.isJunk) {
      detectedType = 'junk';
      isOutlier = true;
      coherenceScore = 0;
      confidence = 1.0;
      const snippetReason = docInfo.snippet?.startsWith('[') ? docInfo.snippet.slice(1, -1) : '';
      contradictionReason = snippetReason || `Ghost note with zero actual body text or temporary cache artifact. Suggested for instant purge.`;
      suggestedFolder = '06_Archive/Trash';
      suggestedAction = 'delete_junk';
    }
    // 2. Check for Scenario / Screenplay / Storyline
    else if (scenarioCheck.isScenario) {
      detectedType = 'scenario';
      isOutlier = true;
      coherenceScore = 15;
      confidence = scenarioCheck.confidence;
      contradictionReason = `Detected narrative / screenplay elements: ${scenarioCheck.markers.join(', ')}. Not project documentation.`;
      suggestedFolder = '01_Projects/Scenarios';
      suggestedAction = docInfo.category === 'raw_document' ? 'convert_to_md' : 'move';
    }
    // 3. Check for Foreign Project affiliation
    else if (foreignProject && (!relativeDir || !relativeDir.toLowerCase().includes(path.basename(foreignProject).toLowerCase()))) {
      detectedType = 'foreign_project';
      isOutlier = true;
      coherenceScore = 20;
      confidence = 0.90;
      contradictionReason = `File belongs to project "${path.basename(foreignProject)}", but is located in "${relativePath}".`;
      suggestedFolder = foreignProject;
      suggestedAction = docInfo.category === 'raw_document' ? 'convert_to_md' : 'move';
    }
    // 4. Check for Raw Documents (.docx, .pdf, .txt, etc.) that need conversion
    else if (docInfo.category === 'raw_document') {
      detectedType = 'raw_document';
      isOutlier = true;
      coherenceScore = 40;
      confidence = 0.85;
      contradictionReason = `Unconverted raw document (${docInfo.extension}). Should be transformed into structured Markdown note.`;
      suggestedFolder = currentFolder || '03_Knowledge/Documents';
      suggestedAction = 'convert_to_md';
    }
    // 5. Check for Technical Code / Scripts
    else if (
      docInfo.category === 'technical_code' ||
      docInfo.filename.endsWith('.py.md') ||
      docInfo.filename.endsWith('.ts.md') ||
      docInfo.snippet.includes('```python') ||
      docInfo.snippet.includes('```typescript')
    ) {
      if (!currentFolder.toLowerCase().includes('programming') && !currentFolder.toLowerCase().includes('technical')) {
        detectedType = 'technical_code';
        isOutlier = true;
        coherenceScore = 35;
        confidence = 0.80;
        contradictionReason = 'Standalone code snippet / script not aligned with project notes.';
        suggestedFolder = '03_Knowledge/Programming';
        suggestedAction = 'move';
      }
    }
    // 6. Check for files dumped directly in Vault Root
    else if (!currentFolder) {
      isOutlier = true;
      coherenceScore = 50;
      contradictionReason = 'Unsorted file located in vault root directory. Recommend organizing into PARA knowledge base.';
      suggestedFolder = '03_Knowledge';
      suggestedAction = 'move';
    }
    // 6. Check for media assets
    else if (docInfo.category === 'media_asset') {
      detectedType = 'media_asset';
      coherenceScore = 70;
      suggestedAction = 'move';
    }
    // 7. Check if file is in a messy subfolder (e.g. "old", "trash", "temp", "drafts")
    else if (subfolder) {
      const subLower = subfolder.toLowerCase();
      if (subLower.includes('trash') || subLower.includes('junk') || subLower.includes('archive')) {
        isOutlier = true;
        coherenceScore = 40;
        contradictionReason = `Located in archive/trash subfolder "${subfolder}". Recommend consolidating.`;
        suggestedFolder = '06_Archive';
      }
    }

    analyzedItems.push({
      id: `rev_${Math.random().toString(36).slice(2, 9)}`,
      filename: docInfo.filename,
      relativePath,
      subfolder,
      absolutePath,
      title: docInfo.title,
      extension: docInfo.extension,
      sizeBytes: docInfo.sizeBytes,
      existingTags: docInfo.existingTags,
      snippet: docInfo.snippet,
      detectedType,
      coherenceScore,
      isOutlier,
      contradictionReason,
      suggestedTargetFolder: suggestedFolder,
      suggestedAction,
      confidence,
      selectedForMove: false
    });
  }

  // Step 2: If LLM is accessible and we are auditing a specific folder (not the entire multi-topic vault), perform high-level holistic Directory Synthesis
  if (llamaUrl && analyzedItems.length > 0 && !isWholeVault) {
    try {
      const fileListPrompt = analyzedItems
        .filter(f => f.detectedType !== 'junk')
        .slice(0, 30)
        .map((f, i) => `${i + 1}. [${f.subfolder ? `${f.subfolder}/` : ''}${f.filename}]: ${f.snippet.slice(0, 140)}`)
        .join('\n');

      const synthesisPrompt = `You are an expert Obsidian Vault Architect.
Analyze the following files from directory: "${relativeDir}" (including subfolders).

FILES IN DIRECTORY:
${fileListPrompt}

TASK:
1. Determine the dominant thematic core of this directory (in English, 1 short sentence).
2. Summarize the general scope of this directory.
3. Identify if any files contradict the project topic (e.g. scenarios/screenplays with dialogue, foreign project notes, or unrelated topics).

Return ONLY raw JSON with this exact structure:
{
  "dominant_topic": "Main directory theme",
  "summary": "Concise summary of directory scope",
  "contradictions_found": true,
  "outliers": [
    {
      "filename": "ExactFileName.md",
      "reason": "Why this file does not fit into the directory",
      "suggested_folder": "01_Projects/Scenarios"
    }
  ]
}`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), (options.timeoutSeconds || 25) * 1000);

      try {
        const payload = sanitizePayloadForLlm({
          messages: [{ role: 'user', content: synthesisPrompt }],
          temperature: 0.1,
          max_tokens: 500,
          stream: false
        });

        const resp = await axios.post(`${llamaUrl.replace(/\/+$/, '')}/v1/chat/completions`, payload, {
          signal: controller.signal
        });

        const raw = resp.data?.choices?.[0]?.message?.content || '';
        const clean = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        const match = clean.match(/\{[\s\S]*\}/);

        if (match) {
          const parsed = JSON.parse(match[0]);
          if (parsed.dominant_topic) dominantTopic = parsed.dominant_topic;
          if (parsed.summary) dirSummary = parsed.summary;

          if (Array.isArray(parsed.outliers)) {
            for (const out of parsed.outliers) {
              const item = analyzedItems.find(
                i => i.filename.toLowerCase() === String(out.filename).toLowerCase()
              );
              if (item && item.detectedType !== 'junk') {
                item.isOutlier = true;
                item.selectedForMove = false;
                item.coherenceScore = Math.min(item.coherenceScore, 25);
                if (out.reason) item.contradictionReason = out.reason;
                if (out.suggested_folder) item.suggestedTargetFolder = out.suggested_folder.replace(/\\/g, '/');
              }
            }
          }
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // Gracefully retain heuristic result
    }
  }

  const outliers = analyzedItems.filter(i => i.isOutlier);
  const scenarios = analyzedItems.filter(i => i.detectedType === 'scenario');
  const rawDocs = analyzedItems.filter(i => i.detectedType === 'raw_document');
  const junkFiles = analyzedItems.filter(i => i.detectedType === 'junk');
  const avgCoherence = Math.round(
    analyzedItems.reduce((acc, i) => acc + i.coherenceScore, 0) / analyzedItems.length
  );

  return {
    directoryPath: relativeDir,
    totalFiles: analyzedItems.length,
    totalSubfoldersScanned: subfolders.length,
    subfoldersList: subfolders,
    dominantTopic,
    summary: dirSummary,
    overallCoherence: avgCoherence,
    hasContradictions: outliers.length > 0,
    outliersCount: outliers.length,
    scenariosCount: scenarios.length,
    rawDocsCount: rawDocs.length,
    junkCount: junkFiles.length,
    items: analyzedItems,
    timestamp: new Date().toISOString()
  };
}

/**
 * Removes empty directories recursively under rootDir, while preserving core PARA and system directories.
 */
const PROTECTED_DIR_NAMES = new Set([
  '00_inbox', '00_moc', '01_projects', '02_areas', '03_knowledge',
  '04_journal', '05_ideas', '05_resources', '06_archive', '99_system',
  'llm', 'models', 'bin', 'processed', 'review'
]);

export async function pruneEmptyDirectories(rootDir: string): Promise<string[]> {
  const removed: string[] = [];

  async function clean(dir: string): Promise<boolean> {
    if (!fs.existsSync(dir)) return true;

    let entries: fs.Dirent[];
    try {
      entries = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch {
      return false;
    }

    let allChildrenEmpty = true;
    for (const ent of entries) {
      const fullPath = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        const isChildEmpty = await clean(fullPath);
        if (!isChildEmpty) {
          allChildrenEmpty = false;
        }
      } else {
        allChildrenEmpty = false;
      }
    }

    const baseLower = path.basename(dir).toLowerCase();
    if (allChildrenEmpty && dir !== rootDir && !PROTECTED_DIR_NAMES.has(baseLower)) {
      try {
        await fsPromises.rmdir(dir);
        removed.push(dir);
        return true;
      } catch {
        return false;
      }
    }

    return allChildrenEmpty && !PROTECTED_DIR_NAMES.has(baseLower);
  }

  await clean(rootDir);
  return removed;
}

/**
 * Executes relocation, markdown conversion, or junk purge for audited files.
 */
export async function applyRevisionPlan(options: {
  vaultPath: string;
  itemsToMove: Array<{
    filePath: string;
    targetFolder: string;
    detectedType: string;
    action?: 'move' | 'convert_to_md' | 'delete_junk';
  }>;
  cleanupEmptyFolders?: boolean;
  snapshot?: SnapshotSession;
}): Promise<{
  success: boolean;
  movedCount: number;
  convertedCount: number;
  deletedJunkCount: number;
  prunedFoldersCount: number;
  errors: string[];
}> {
  const { vaultPath, itemsToMove, cleanupEmptyFolders = true, snapshot } = options;
  let movedCount = 0;
  let convertedCount = 0;
  let deletedJunkCount = 0;
  const errors: string[] = [];
  const affectedDirs = new Set<string>();

  for (const item of itemsToMove) {
    try {
      if (!isPathInsideVault(item.filePath, vaultPath)) {
        errors.push(`Security Error: Source file path is outside vault: ${item.filePath}`);
        continue;
      }

      const action = item.action || (item.detectedType === 'junk' ? 'delete_junk' : 'move');
      const cleanTargetDir = (item.targetFolder || '').replace(/\\/g, '/').replace(/^\/+/, '');
      const destDir = path.join(vaultPath, cleanTargetDir);

      if (action !== 'delete_junk') {
        if (!cleanTargetDir || !isPathInsideVault(destDir, vaultPath)) {
          errors.push(`Security Error: Target folder is outside vault: ${item.targetFolder}`);
          continue;
        }
      }

      if (!fs.existsSync(item.filePath)) {
        errors.push(`File not found: ${path.basename(item.filePath)}`);
        continue;
      }

      affectedDirs.add(path.dirname(item.filePath));

      const filename = path.basename(item.filePath);
      const ext = path.extname(filename).toLowerCase();

      // Safety guard: never move, convert, or delete LLM binaries, models, or system files
      const normPath = item.filePath.replace(/\\/g, '/').toLowerCase();
      if (
        ext === '.gguf' ||
        ext === '.exe' ||
        ext === '.dll' ||
        normPath.includes('/99_system/') ||
        normPath.includes('/llm/') ||
        normPath.includes('/models/')
      ) {
        continue;
      }

      // Always snapshot before moving, converting, or deleting (non-blocking if backup path is too long or locked)
      if (snapshot) {
        try {
          await snapshot.backup(item.filePath);
        } catch (backupErr: any) {
          errors.push(`Snapshot warning for ${filename}: ${backupErr.message}`);
        }
      }

      // --- ACTION 1: DELETE JUNK ---
      if (action === 'delete_junk') {
        await fsPromises.unlink(item.filePath);
        deletedJunkCount++;
        continue;
      }

      await fsPromises.mkdir(destDir, { recursive: true });

      // --- ACTION 2: CONVERT RAW DOC TO MARKDOWN ---
      if (action === 'convert_to_md' && ext !== '.md') {
        const docInfo = await extractDocumentInfo(item.filePath);
        const safeName = sanitizeTitle(docInfo.title, filename);
        let destMdPath = path.join(destDir, `${safeName}.md`);

        // Avoid collision
        let counter = 1;
        while (fs.existsSync(destMdPath)) {
          destMdPath = path.join(destDir, `${safeName} ${counter}.md`);
          counter++;
        }

        const langInfo = detectDocumentLanguage(docInfo.fullText, filename);
        const frontmatterData: Record<string, unknown> = {
          title: safeName,
          category: cleanTargetDir,
          tags: ['converted', ...docInfo.existingTags, ...langInfo.tags],
          source_file: filename,
          ai_converted: true,
          date: new Date().toISOString()
        };

        const mdContent = serializeNote(frontmatterData, docInfo.fullText || `*Extracted content from ${filename}*`);
        await fsPromises.writeFile(destMdPath, mdContent, 'utf-8');

        // Archive original raw file into 99_System/_keep_raw/ if available, or remove
        const rawArchiveDir = path.join(vaultPath, '99_System', '_keep_raw', 'revisor');
        await fsPromises.mkdir(rawArchiveDir, { recursive: true });
        const rawArchivePath = path.join(rawArchiveDir, filename);
        try {
          await fsPromises.rename(item.filePath, rawArchivePath);
        } catch {
          await fsPromises.unlink(item.filePath);
        }

        convertedCount++;
        continue;
      }

      // --- ACTION 3: MOVE FILE (MARKDOWN OR OTHER) ---
      let destPath = path.join(destDir, filename);

      if (ext === '.md') {
        const content = await fsPromises.readFile(item.filePath, 'utf-8');
        const parsed = parseNote(content);

        const langInfo = detectDocumentLanguage(content, filename);
        const extraTags: string[] = ['revision', ...langInfo.tags];
        if (item.detectedType === 'scenario') {
          extraTags.push('scenario', 'plotline');
        }

        mergeTags(parsed.data, extraTags);
        parsed.data.ai_revised = true;
        parsed.data.target_project = cleanTargetDir;

        const serialized = serializeNote(parsed.data, parsed.body);
        await fsPromises.writeFile(item.filePath, serialized, 'utf-8');
      }

      // Collision avoidance
      let counter = 1;
      while (fs.existsSync(destPath) && path.resolve(destPath) !== path.resolve(item.filePath)) {
        const fileExt = path.extname(filename);
        const name = path.basename(filename, fileExt);
        destPath = path.join(destDir, `${name} ${counter}${fileExt}`);
        counter++;
      }

      if (path.resolve(item.filePath) !== path.resolve(destPath)) {
        await fsPromises.rename(item.filePath, destPath);
      }

      movedCount++;
    } catch (err: any) {
      errors.push(`Failed to process ${path.basename(item.filePath)}: ${err.message}`);
    }
  }

  // --- Prune Empty Subdirectories ---
  let prunedFoldersCount = 0;
  if (cleanupEmptyFolders) {
    for (const dir of affectedDirs) {
      if (dir.startsWith(vaultPath) && dir !== vaultPath) {
        try {
          const removed = await pruneEmptyDirectories(dir);
          prunedFoldersCount += removed.length;
        } catch {}
      }
    }
  }

  return {
    success: errors.length === 0,
    movedCount,
    convertedCount,
    deletedJunkCount,
    prunedFoldersCount,
    errors
  };
}
