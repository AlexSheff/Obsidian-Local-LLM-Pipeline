import { parseDocument } from 'yaml';

/**
 * Extracts tags from note frontmatter, body, and filename.
 * Frontmatter tags are read safely using YAML parsing, handling arrays and comma-separated strings.
 * Inline #tags are scanned from filename and body.
 * All tags are returned as strings without '#'.
 */
export function extractTags(frontmatter: string, body: string, filename: string): string[] {
  const tagsSet = new Set<string>();

  const addClean = (raw: unknown) => {
    if (typeof raw !== 'string' && typeof raw !== 'number') return;
    const clean = String(raw).trim().replace(/^#+/, '');
    if (
      clean &&
      !/^[-_]+$/.test(clean) &&
      clean.toLowerCase() !== 'tags' &&
      clean.toLowerCase() !== 'true' &&
      clean.toLowerCase() !== 'false' &&
      /[\p{L}\p{N}]/u.test(clean)
    ) {
      tagsSet.add(clean);
    }
  };

  // 1. Frontmatter tags (YAML list, array, or comma-separated)
  if (frontmatter && frontmatter.trim()) {
    try {
      const doc = parseDocument(frontmatter);
      const js = doc.toJS();
      if (js && typeof js === 'object') {
        const rawTags = (js as any).tags;
        if (Array.isArray(rawTags)) {
          for (const t of rawTags) addClean(t);
        } else if (typeof rawTags === 'string') {
          for (const t of rawTags.split(',')) addClean(t);
        }
      }
    } catch {
      // ignore parse error and fallback to regex
    }

    if (tagsSet.size === 0) {
      const fmTagsMatch = frontmatter.match(/tags:\s*([\s\S]*?)(?=(?:\r?\n\w+:|$))/i);
      if (fmTagsMatch) {
        const block = fmTagsMatch[1].trim();
        const tagMatches = block.match(/[\p{L}\p{N}_-]+/gu) || [];
        for (const t of tagMatches) {
          addClean(t);
        }
      }
    }
  }

  // 2. Inline #tags in body and filename (excluding markdown headers # Heading)
  const textToScan = `${filename}\n${body}`;
  const inlineMatches = textToScan.match(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu) || [];
  for (const m of inlineMatches) {
    const clean = m.trim().replace(/^#+/, '');
    if (
      clean &&
      !/^[-_]+$/.test(clean) &&
      isNaN(Number(clean)) &&
      /[\p{L}\p{N}]/u.test(clean)
    ) {
      tagsSet.add(clean);
    }
  }

  return Array.from(tagsSet);
}
