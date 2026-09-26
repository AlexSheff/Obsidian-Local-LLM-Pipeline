import path from 'path';
import fs from 'fs';
const fsPromises = fs.promises;
import * as pdfParseModule from 'pdf-parse';
const pdfParse = (pdfParseModule as any).default || pdfParseModule;
import mammoth from 'mammoth';
import TurndownService from 'turndown';
import { safeTruncateHeadTail } from './unicode';
import { parseNote } from './frontmatter';

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced'
});

export type ExtractedCategory =
  | 'note'
  | 'raw_document'
  | 'technical_code'
  | 'junk'
  | 'media_asset'
  | 'binary';

export interface DocumentInfo {
  filename: string;
  extension: string;
  sizeBytes: number;
  category: ExtractedCategory;
  isJunk: boolean;
  title: string;
  existingTags: string[];
  snippet: string;
  fullText: string;
}

const JUNK_EXTENSIONS = new Set([
  '.tmp', '.temp', '.bak', '.swp', '.swo', '.log', '.crdownload', '.part'
]);

const JUNK_FILENAMES = new Set([
  'thumbs.db', 'desktop.ini', '.ds_store', 'ehthumbs.db', 'icon\r'
]);

const CODE_EXTENSIONS = new Set([
  '.py', '.js', '.jsx', '.ts', '.tsx', '.sh', '.bat', '.cmd', '.ps1',
  '.sql', '.css', '.scss', '.c', '.cpp', '.h', '.java', '.go', '.rs'
]);

const RAW_DOC_EXTENSIONS = new Set([
  '.docx', '.pdf', '.txt', '.rtf', '.html', '.htm', '.csv', '.tsv',
  '.json', '.xml', '.yaml', '.yml', '.epub'
]);

const MEDIA_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico',
  '.mp3', '.wav', '.m4a', '.ogg', '.flac', '.mp4', '.mov', '.avi', '.mkv',
  '.zip', '.rar', '.7z', '.tar', '.gz'
]);

/**
 * Detects if a Markdown note is a "ghost note" (has frontmatter/links/headers but zero actual note body).
 */
export function checkGhostNote(parsedBody: string): { isGhost: boolean; reason: string } {
  if (!parsedBody || parsedBody.trim().length === 0) {
    return {
      isGhost: true,
      reason: 'Empty file: zero characters in note body.'
    };
  }

  // Strip frontmatter if full file content was passed
  let cleaned = parsedBody.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/, '');

  // Strip callouts and blockquotes (e.g. > **Связанные темы:** ..., > [!info] ...)
  cleaned = cleaned
    .replace(/^>.*?$/gm, '')
    .replace(/\[\[.*?\]\]/g, '') // Wiki links
    .replace(/\[.*?\]\(.*?\)/g, '') // Markdown links
    .replace(/^#{1,6}\s+.*?$/gm, '') // Headings
    .replace(/^[-*_]{3,}\s*$/gm, '') // Horizontal rules
    .replace(/^[-*+]\s*$/gm, '') // Empty bullet points
    .replace(/[*#_`\-\s\r\n\t]/g, '') // Formatting & whitespace
    .trim();

  if (cleaned.length < 5) {
    return {
      isGhost: true,
      reason: 'Empty ghost note: has frontmatter and callout links, but zero actual document body text.'
    };
  }
  return { isGhost: false, reason: '' };
}

/**
 * Checks if a file is considered junk/temporary or cache garbage.
 */
export function isJunkFile(filename: string, sizeBytes: number): { isJunk: boolean; reason: string } {
  const lower = filename.toLowerCase();
  const ext = path.extname(lower);

  if (JUNK_FILENAMES.has(lower)) {
    return { isJunk: true, reason: `System cache artifact (${filename})` };
  }
  if (lower.startsWith('~$') || lower.startsWith('.~')) {
    return { isJunk: true, reason: `Temporary Office lockfile (${filename})` };
  }
  if (JUNK_EXTENSIONS.has(ext)) {
    return { isJunk: true, reason: `Temporary backup/cache file (${ext})` };
  }
  if (sizeBytes === 0) {
    return { isJunk: true, reason: 'Zero-byte empty file' };
  }
  return { isJunk: false, reason: '' };
}

/**
 * Safely reads up to maxBytes from a file as UTF-8 string to prevent OOM on huge text/JSON/CSV files.
 */
async function safeReadTextFile(filePath: string, sizeBytes: number, maxBytes = 2 * 1024 * 1024): Promise<string> {
  if (sizeBytes <= maxBytes) {
    return await fsPromises.readFile(filePath, 'utf-8');
  }
  const handle = await fsPromises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(Math.min(maxBytes, 65536));
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead).toString('utf-8');
  } finally {
    await handle.close();
  }
}

/**
 * Safely extracts text, title, tags, and category from any file.
 * When options.lightweight is true (e.g. during full-vault audit), skips heavy PDF/DOCX binary parsing
 * and truncates retained fullText in memory to prevent OOM crashes.
 */
export async function extractDocumentInfo(
  filePath: string,
  options?: { lightweight?: boolean }
): Promise<DocumentInfo> {
  const filename = path.basename(filePath);
  const ext = path.extname(filename).toLowerCase();
  const lightweight = options?.lightweight ?? false;
  let sizeBytes = 0;

  try {
    const stat = await fsPromises.stat(filePath);
    sizeBytes = stat.size;
  } catch {
    return {
      filename,
      extension: ext,
      sizeBytes: 0,
      category: ext === '.md' ? 'note' : 'binary',
      isJunk: false,
      title: filename.replace(/\.[^.]+$/, ''),
      existingTags: [],
      snippet: `[Unaccessible file: ${filename}]`,
      fullText: ''
    };
  }

  try {
    const junkCheck = isJunkFile(filename, sizeBytes);
    if (junkCheck.isJunk) {
      return {
        filename,
        extension: ext,
        sizeBytes,
        category: 'junk',
        isJunk: true,
        title: filename,
        existingTags: ['junk', 'temp'],
        snippet: `[${junkCheck.reason}]`,
        fullText: ''
      };
    }

    // 1. Markdown Note (.md)
    if (ext === '.md') {
      try {
        const content = await safeReadTextFile(filePath, sizeBytes);
        const parsed = parseNote(content);
        const title = (parsed.data.title as string) || filename.replace(/\.md$/i, '');
        const tags = Array.isArray(parsed.data.tags) ? parsed.data.tags.map(String) : [];

        const ghost = checkGhostNote(parsed.body);
        if (ghost.isGhost) {
          return {
            filename,
            extension: ext,
            sizeBytes,
            category: 'junk',
            isJunk: true,
            title,
            existingTags: ['ghost-note', 'empty-body', ...tags],
            snippet: `[${ghost.reason}]`,
            fullText: lightweight ? '' : parsed.body
          };
        }

        const cleanSnippet = safeTruncateHeadTail(parsed.body.replace(/[#*`_]/g, ' '), 500, 0.8).trim();

        return {
          filename,
          extension: ext,
          sizeBytes,
          category: 'note',
          isJunk: false,
          title,
          existingTags: tags,
          snippet: cleanSnippet || title,
          fullText: lightweight ? parsed.body.slice(0, 2000) : parsed.body
        };
      } catch {
        return {
          filename,
          extension: ext,
          sizeBytes,
          category: 'note',
          isJunk: false,
          title: filename.replace(/\.md$/i, ''),
          existingTags: [],
          snippet: `[Unreadable Markdown: ${filename}]`,
          fullText: ''
        };
      }
    }

    // 2. Code and Scripts (.py, .ts, etc.)
    if (CODE_EXTENSIONS.has(ext)) {
      try {
        const content = await safeReadTextFile(filePath, sizeBytes, 256 * 1024);
        const snippet = content.slice(0, 500).trim();
        return {
          filename,
          extension: ext,
          sizeBytes,
          category: 'technical_code',
          isJunk: false,
          title: filename,
          existingTags: ['code', ext.replace(/^\./, '')],
          snippet: snippet || `[Code file: ${filename}]`,
          fullText: lightweight ? content.slice(0, 2000) : content
        };
      } catch {
        return {
          filename,
          extension: ext,
          sizeBytes,
          category: 'technical_code',
          isJunk: false,
          title: filename,
          existingTags: ['code'],
          snippet: `[Code file: ${filename}]`,
          fullText: ''
        };
      }
    }

    // 3. Raw Documents (.docx, .pdf, .txt, .html, etc.)
    if (RAW_DOC_EXTENSIONS.has(ext)) {
      const titleCandidate = filename.replace(/\.[^.]+$/, '');

      // In lightweight mode (e.g. directory/vault audit), skip heavy binary parsing of PDFs and DOCX
      if (lightweight && (ext === '.pdf' || ext === '.docx' || ext === '.epub')) {
        return {
          filename,
          extension: ext,
          sizeBytes,
          category: 'raw_document',
          isJunk: false,
          title: titleCandidate,
          existingTags: ['raw-document', ext.replace(/^\./, '')],
          snippet: `[Raw ${ext.toUpperCase()} document: ${filename} (${(sizeBytes / 1024).toFixed(1)} KB)]`,
          fullText: ''
        };
      }

      let extractedText = '';

      if (sizeBytes > 10 * 1024 * 1024) {
        // Protect against out-of-memory crashes on large files (>10MB)
        extractedText = `[Large raw document: ${filename} (${(sizeBytes / (1024 * 1024)).toFixed(1)} MB) - preview omitted to preserve memory]`;
      } else if (ext === '.docx') {
        try {
          const result = await mammoth.convertToHtml({ path: filePath });
          const html = result.value || '';
          extractedText = turndownService.turndown(html);
        } catch (err: any) {
          extractedText = `[DOCX extraction fallback: ${err.message}]`;
        }
      } else if (ext === '.pdf') {
        try {
          const dataBuffer = await fsPromises.readFile(filePath);
          // Limit to first 5 pages to prevent infinite loops or OOM on large scanned PDFs
          const pdfData: any = await Promise.race([
            pdfParse(dataBuffer, { max: 5 }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('PDF parse timeout')), 8000))
          ]);
          extractedText = pdfData?.text || '';
        } catch (err: any) {
          extractedText = `[PDF extraction fallback: ${err.message}]`;
        }
      } else if (ext === '.html' || ext === '.htm') {
        try {
          const raw = await safeReadTextFile(filePath, sizeBytes, 512 * 1024);
          extractedText = turndownService.turndown(raw);
        } catch {
          extractedText = `[HTML reading fallback]`;
        }
      } else {
        // Plain text, CSV, JSON, RTF
        try {
          extractedText = await safeReadTextFile(filePath, sizeBytes, 512 * 1024);
        } catch {
          extractedText = `[Text reading error]`;
        }
      }

      const cleanSnippet = safeTruncateHeadTail(
        extractedText.replace(/[\r\n\t]+/g, ' ').replace(/[#*`_]/g, ' '),
        500,
        0.8
      ).trim();

      return {
        filename,
        extension: ext,
        sizeBytes,
        category: 'raw_document',
        isJunk: false,
        title: titleCandidate,
        existingTags: ['raw-document', ext.replace(/^\./, '')],
        snippet: cleanSnippet || `[Document: ${filename}]`,
        fullText: lightweight ? extractedText.slice(0, 2000) : extractedText
      };
    }

    // 4. Media & Assets (.png, .mp3, .zip, etc.)
    if (MEDIA_EXTENSIONS.has(ext)) {
      return {
        filename,
        extension: ext,
        sizeBytes,
        category: 'media_asset',
        isJunk: false,
        title: filename,
        existingTags: ['asset', ext.replace(/^\./, '')],
        snippet: `[Media/Binary asset (${(sizeBytes / 1024).toFixed(1)} KB)]`,
        fullText: ''
      };
    }

    // 5. General Binary
    return {
      filename,
      extension: ext,
      sizeBytes,
      category: 'binary',
      isJunk: false,
      title: filename,
      existingTags: ['binary'],
      snippet: `[Binary file (${(sizeBytes / 1024).toFixed(1)} KB)]`,
      fullText: ''
    };
  } catch {
    return {
      filename,
      extension: ext,
      sizeBytes,
      category: 'binary',
      isJunk: false,
      title: filename,
      existingTags: ['binary'],
      snippet: `[File: ${filename}]`,
      fullText: ''
    };
  }
}
