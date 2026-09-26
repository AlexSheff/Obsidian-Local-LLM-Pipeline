import { parseDocument, Document } from 'yaml';

export const DOC_SYMBOL = Symbol.for('yaml_doc');

export interface ParsedNote {
  data: Record<string, unknown>;
  body: string;
  hadFrontmatter: boolean;
}

/**
 * Parses markdown note content, extracting frontmatter as a data object
 * and preserving the raw markdown body.
 * If frontmatter exists, the underlying yaml.Document is attached via Symbol
 * to preserve key order and comments upon serialization.
 */
export function parseNote(content: string): ParsedNote {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) {
    return {
      data: {},
      body: content,
      hadFrontmatter: false,
    };
  }

  const yamlBlock = match[1];
  const body = match[2];

  let doc: Document;
  try {
    doc = parseDocument(yamlBlock, { keepSourceTokens: true });
  } catch {
    doc = new Document();
  }

  const data = (doc.toJS() || {}) as Record<string, unknown>;
  Object.defineProperty(data, DOC_SYMBOL, {
    value: doc,
    enumerable: false,
    writable: true,
    configurable: true,
  });

  return {
    data,
    body,
    hadFrontmatter: true,
  };
}

/**
 * Merges new tags into the note's data.tags array.
 * Tags are deduplicated case-insensitively, keeping the casing of existing tags.
 * All tags are stored without leading '#'.
 */
export function mergeTags(data: Record<string, unknown>, newTags: string[]): void {
  const existingRaw = data.tags;
  const tagList: string[] = [];
  const seenLower = new Set<string>();

  const addTag = (raw: unknown) => {
    if (typeof raw !== 'string' && typeof raw !== 'number') return;
    const clean = String(raw).trim().replace(/^#+/, '');
    if (!clean) return;
    const lower = clean.toLowerCase();
    if (!seenLower.has(lower)) {
      seenLower.add(lower);
      tagList.push(clean);
    }
  };

  if (Array.isArray(existingRaw)) {
    for (const t of existingRaw) addTag(t);
  } else if (typeof existingRaw === 'string') {
    if (existingRaw.includes(',')) {
      for (const t of existingRaw.split(',')) addTag(t);
    } else {
      addTag(existingRaw);
    }
  }

  for (const t of newTags) {
    addTag(t);
  }

  data.tags = tagList;

  const doc = (data as any)[DOC_SYMBOL] as Document | undefined;
  if (doc) {
    doc.set('tags', tagList);
  }
}

/**
 * Serializes data and body back into markdown format with YAML frontmatter.
 * Preserves comments and key ordering if the data came from parseNote.
 * If data is empty and there was no frontmatter, only body is returned.
 */
export function serializeNote(data: Record<string, unknown>, body: string): string {
  let doc = (data as any)[DOC_SYMBOL] as Document | undefined;
  if (!doc) {
    doc = new Document();
    for (const [key, value] of Object.entries(data)) {
      doc.set(key, value);
    }
  } else {
    for (const [key, value] of Object.entries(data)) {
      if (doc.get(key) !== value) {
        doc.set(key, value);
      }
    }
  }

  const isCRLF = body.includes('\r\n');
  const nl = isCRLF ? '\r\n' : '\n';
  const yamlStr = doc.toString().trim();

  const trailingBody = body
    ? (body.endsWith(nl) || body.endsWith('\n') ? body : body + nl)
    : '';

  if (!yamlStr && Object.keys(data).length === 0) {
    return trailingBody;
  }

  const formattedYaml = yamlStr.replace(/\r?\n/g, nl);
  return `---${nl}${formattedYaml}${nl}---${nl}${trailingBody}`;
}
