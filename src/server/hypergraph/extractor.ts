import path from 'path';
import fs from 'fs';
const fsPromises = fs.promises;
import { parseNote } from '../frontmatter';
import { normalizeToken, TokensRegistry, Token } from './tokensRegistry';

export interface NoteTokenExtraction {
  notePath: string;
  tokens: Token[];
  segments: string[][]; // token keys grouped by note paragraphs/sections
}

export interface NoteTokensRecord {
  note: string;
  tokens: string[];
  tick: number;
  updatedAt: string;
}

export class NoteExtractor {
  private vaultPath: string;
  private registry: TokensRegistry;
  private noteTokensMap: Map<string, NoteTokensRecord> = new Map();
  private indexFile: string;
  private loaded = false;

  constructor(vaultPath: string, registry: TokensRegistry) {
    this.vaultPath = vaultPath;
    this.registry = registry;
    this.indexFile = path.join(vaultPath, '99_System', 'hypergraph', 'note_tokens.jsonl');
  }

  public async load(): Promise<void> {
    if (this.loaded) return;
    this.noteTokensMap.clear();

    if (this.vaultPath && fs.existsSync(this.indexFile)) {
      try {
        const content = await fsPromises.readFile(this.indexFile, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim().length > 0);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed && parsed.note && Array.isArray(parsed.tokens)) {
              this.noteTokensMap.set(parsed.note, parsed);
            }
          } catch {}
        }
      } catch (err) {
        console.warn('[NoteExtractor] Error loading note_tokens.jsonl:', err);
      }
    }
    this.loaded = true;
  }

  public async save(): Promise<void> {
    if (!this.vaultPath) return;
    const dir = path.dirname(this.indexFile);
    await fsPromises.mkdir(dir, { recursive: true });

    const lines = Array.from(this.noteTokensMap.values())
      .map(r => JSON.stringify(r))
      .join('\n') + '\n';
    await fsPromises.writeFile(this.indexFile, lines, 'utf-8');
  }

  public getTokensForNote(notePath: string): string[] | undefined {
    return this.noteTokensMap.get(notePath)?.tokens;
  }

  /**
   * Updates note path when a note is renamed or moved without rebuilding the graph.
   */
  public renameNote(oldPath: string, newPath: string): void {
    const existing = this.noteTokensMap.get(oldPath);
    if (existing) {
      this.noteTokensMap.delete(oldPath);
      existing.note = newPath;
      existing.updatedAt = new Date().toISOString();
      this.noteTokensMap.set(newPath, existing);
    }
  }

  /**
   * Extracts tokens from note text and frontmatter.
   */
  public extractFromNote(
    rawContent: string,
    relativeNotePath: string,
    tick: number = 0
  ): NoteTokenExtraction {
    const parsed = parseNote(rawContent);
    const data = parsed.data || {};
    const body = parsed.body || '';

    const extractedTokens: Token[] = [];
    const tokenKeySet = new Set<string>();

    // 1. Title token
    const filenameNoExt = path.basename(relativeNotePath).replace(/\.[^/.]+$/, '');
    const titleCandidate = (data.title as string) || (body.match(/^#\s+(.+)$/m)?.[1]?.trim()) || filenameNoExt;
    const normTitle = normalizeToken(titleCandidate);
    if (normTitle && normTitle.length >= 2) {
      const t = this.registry.registerToken({
        key: normTitle,
        kind: 'concept',
        sourceNote: relativeNotePath,
        aliases: [titleCandidate]
      });
      extractedTokens.push(t);
      tokenKeySet.add(t.key);
    }

    // 2. Aliases
    const rawAliases = Array.isArray(data.aliases)
      ? data.aliases
      : typeof data.aliases === 'string'
      ? data.aliases.split(',').map((s: string) => s.trim())
      : [];

    for (const alias of rawAliases) {
      const normAlias = normalizeToken(alias);
      if (normAlias && normAlias.length >= 2) {
        const t = this.registry.registerToken({
          key: normAlias,
          kind: 'alias',
          sourceNote: relativeNotePath,
          aliases: [alias]
        });
        extractedTokens.push(t);
        tokenKeySet.add(t.key);
      }
    }

    // 3. Project link: project: "[[id]]" or project: id
    if (data.project) {
      const rawProj = String(data.project).replace(/\[\[|\]\]/g, '').trim();
      const normProj = normalizeToken(rawProj);
      if (normProj && normProj.length >= 2) {
        const t = this.registry.registerToken({
          key: normProj,
          kind: 'project',
          sourceNote: relativeNotePath,
          aliases: [rawProj]
        });
        extractedTokens.push(t);
        tokenKeySet.add(t.key);
      }
    }

    // 4. Tags with #concept/ prefix
    const rawTags = Array.isArray(data.tags)
      ? data.tags
      : typeof data.tags === 'string'
      ? data.tags.split(',').map((s: string) => s.trim())
      : [];

    for (const tag of rawTags) {
      const cleanTag = String(tag).trim().replace(/^#/, '');
      if (cleanTag.toLowerCase().startsWith('concept/')) {
        const conceptName = cleanTag.slice(8);
        const normConcept = normalizeToken(conceptName);
        if (normConcept && normConcept.length >= 2) {
          const t = this.registry.registerToken({
            key: normConcept,
            kind: 'concept',
            sourceNote: relativeNotePath,
            aliases: [conceptName]
          });
          extractedTokens.push(t);
          tokenKeySet.add(t.key);
        }
      }
    }

    // 5. In-text wikilinks [[Concept]]
    const wikilinkMatches = body.match(/\[\[(.*?)\]\]/g) || [];
    for (const wl of wikilinkMatches) {
      const cleanTarget = wl.slice(2, -2).split('|')[0].trim();
      const normLink = normalizeToken(cleanTarget);
      if (normLink && normLink.length >= 2 && !tokenKeySet.has(normLink)) {
        const t = this.registry.registerToken({
          key: normLink,
          kind: 'concept',
          sourceNote: relativeNotePath,
          aliases: [cleanTarget]
        });
        extractedTokens.push(t);
        tokenKeySet.add(t.key);
      }
    }

    // 6. Segment-based co-occurrence extraction (by paragraphs)
    const paragraphs = body.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    const segments: string[][] = [];

    // Header segment: frontmatter + title tokens
    const headerTokens = extractedTokens.map(t => t.key);
    if (headerTokens.length > 0) {
      segments.push(headerTokens);
    }

    // Paragraph segments
    for (const para of paragraphs) {
      const paraTokens: string[] = [];
      const paraLower = para.toLowerCase();
      for (const tok of extractedTokens) {
        if (paraLower.includes(tok.key) || tok.aliases.some(a => paraLower.includes(a.toLowerCase()))) {
          paraTokens.push(tok.key);
        }
      }
      if (paraTokens.length >= 2) {
        segments.push(Array.from(new Set(paraTokens)));
      }
    }

    // Record in noteTokensMap
    const allKeys = Array.from(tokenKeySet);
    this.noteTokensMap.set(relativeNotePath, {
      note: relativeNotePath,
      tokens: allKeys,
      tick,
      updatedAt: new Date().toISOString()
    });

    return {
      notePath: relativeNotePath,
      tokens: extractedTokens,
      segments
    };
  }
}
