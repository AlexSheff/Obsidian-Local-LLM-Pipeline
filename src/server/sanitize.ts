/**
 * Sanitizes a document title by stripping invalid characters, prefixes, extensions, and timestamps.
 */
export function sanitizeTitle(rawTitle: string, originalName: string): string {
  let title = rawTitle || originalName;
  // Remove extensions
  title = title.replace(/\.[a-z0-9]+$/i, '');
  // Remove prefixes like Re:, FW:
  title = title.replace(/^(re|fw|fwd|title|file):\s*/i, '');
  // Remove leading timestamps
  title = title.replace(/^(\d{4}[-_]?\d{2}[-_]?\d{2}[-_]?\d{0,6}|\d{10,14})\s*/, '');
  // Clean illegal chars and truncate
  title = title.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
  if (title.length > 100) title = title.substring(0, 100).trim();
  if (!title) title = 'Untitled_Document';
  return title;
}
