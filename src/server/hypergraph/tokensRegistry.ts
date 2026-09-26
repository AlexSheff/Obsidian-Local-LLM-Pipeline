import path from 'path';
import fs from 'fs';
const fsPromises = fs.promises;
import { TokenSchema } from '../validation';
import { z } from 'zod';

export type Token = z.infer<typeof TokenSchema>;

/**
 * Normalizes a raw string to a canonical token key.
 * Preserves Cyrillic and Latin alphabets, lowercases, removes non-alphanumeric punctuation.
 * Key length is strictly 2 to 64 chars.
 */
export function normalizeToken(raw: string): string {
  if (!raw) return '';
  const cleaned = raw
    .toLowerCase()
    .replace(/[\[\]\(\)\{\}\*\#\_\`\~\:\;\,\.\?\!\\\/\"\'\&\@\+\%\=\|\^\$]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (cleaned.length < 2) return '';
  return cleaned.slice(0, 64);
}

export class TokensRegistry {
  private tokens: Map<string, Token> = new Map();
  private vaultPath: string;
  private filePath: string;
  private loaded = false;

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
    this.filePath = path.join(vaultPath, '99_System', 'hypergraph', 'tokens.jsonl');
  }

  public async load(): Promise<void> {
    if (this.loaded) return;
    this.tokens.clear();

    if (this.vaultPath && fs.existsSync(this.filePath)) {
      try {
        const content = await fsPromises.readFile(this.filePath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim().length > 0);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            const validated = TokenSchema.safeParse(parsed);
            if (validated.success) {
              const existing = this.tokens.get(validated.data.key);
              if (existing) {
                // Merge aliases
                const aliasSet = new Set([...existing.aliases, ...validated.data.aliases]);
                existing.aliases = Array.from(aliasSet);
                if (validated.data.deprecated) existing.deprecated = true;
              } else {
                this.tokens.set(validated.data.key, validated.data);
              }
            }
          } catch {
            // skip malformed line
          }
        }
      } catch (err) {
        console.warn('[TokensRegistry] Error loading tokens.jsonl:', err);
      }
    }

    // Ensure service linker token is registered
    if (!this.tokens.has('связано-с')) {
      this.tokens.set('связано-с', {
        key: 'связано-с',
        kind: 'linker',
        sourceNote: 'system',
        firstSeenAt: new Date().toISOString(),
        aliases: ['связано-с', 'related-to'],
        deprecated: false,
        schemaVersion: 1
      });
    }

    this.loaded = true;
  }

  public async save(): Promise<void> {
    if (!this.vaultPath) return;
    const dir = path.dirname(this.filePath);
    await fsPromises.mkdir(dir, { recursive: true });

    const lines = Array.from(this.tokens.values())
      .map(t => JSON.stringify(t))
      .join('\n') + '\n';
    await fsPromises.writeFile(this.filePath, lines, 'utf-8');
  }

  public get(key: string): Token | undefined {
    return this.tokens.get(key);
  }

  public getAll(includeDeprecated = false): Token[] {
    const all = Array.from(this.tokens.values());
    if (includeDeprecated) return all;
    return all.filter(t => !t.deprecated);
  }

  public has(key: string): boolean {
    return this.tokens.has(key);
  }

  /**
   * Registers or updates a token idempotently.
   */
  public registerToken(entry: {
    key: string;
    kind: 'concept' | 'project' | 'alias' | 'linker';
    sourceNote: string;
    aliases?: string[];
  }): Token {
    const normKey = normalizeToken(entry.key);
    if (!normKey || normKey.length < 2) {
      throw new Error(`Invalid token key "${entry.key}"`);
    }

    const cleanAliases = (entry.aliases || [])
      .map(a => a.trim())
      .filter(a => a.length > 0 && normalizeToken(a) !== normKey);

    const existing = this.tokens.get(normKey);
    if (existing) {
      const aliasSet = new Set([...existing.aliases, ...cleanAliases]);
      existing.aliases = Array.from(aliasSet);
      return existing;
    }

    const token: Token = {
      key: normKey,
      kind: entry.kind,
      sourceNote: entry.sourceNote,
      firstSeenAt: new Date().toISOString(),
      aliases: cleanAliases,
      deprecated: false,
      schemaVersion: 1
    };

    this.tokens.set(normKey, token);
    return token;
  }

  /**
   * Soft deletes a token.
   */
  public deprecateToken(key: string): boolean {
    const token = this.tokens.get(key);
    if (!token) return false;
    token.deprecated = true;
    return true;
  }

  /**
   * Merges sourceToken into targetToken.
   */
  public mergeTokens(sourceKey: string, targetKey: string): Token {
    const source = this.tokens.get(sourceKey);
    const target = this.tokens.get(targetKey);
    if (!source || !target) {
      throw new Error(`Both source "${sourceKey}" and target "${targetKey}" must exist to merge`);
    }

    const combinedAliases = new Set([
      ...target.aliases,
      source.key,
      ...source.aliases
    ]);
    combinedAliases.delete(target.key);
    target.aliases = Array.from(combinedAliases);
    source.deprecated = true;

    return target;
  }
}
