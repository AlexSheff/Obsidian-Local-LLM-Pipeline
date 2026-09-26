/**
 * Unicode and String Safety Utilities
 * Prevents JSON parse errors (such as RFC 8259 lone surrogate violations in C++ JSON parsers like llama-server)
 * and safely slices text containing multi-byte UTF-16 surrogate pairs (emojis, mathematical symbols, non-BMP scripts).
 */

/**
 * Ensures a string contains only well-formed Unicode code points.
 * Unpaired high (U+D800..U+DBFF) or low (U+DC00..U+DFFF) surrogates are replaced with U+FFFD.
 */
export function sanitizeUnicode(str: string): string {
  if (!str) return '';
  if (typeof (str as any).toWellFormed === 'function') {
    return (str as any).toWellFormed();
  }
  // Fallback regex replacement for environments without native toWellFormed
  return str
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '\uFFFD')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}

/**
 * Slices a string while guaranteeing surrogate pairs are never severed.
 * If start falls on a low surrogate, it advances past it.
 * If end falls on a high surrogate, it steps back before it.
 */
export function safeSlice(str: string, start: number, end?: number): string {
  if (!str) return '';
  const len = str.length;
  let s = start < 0 ? Math.max(0, len + start) : Math.min(start, len);
  let e = end === undefined ? len : end < 0 ? Math.max(0, len + end) : Math.min(end, len);

  if (s >= e) return '';

  // If start falls on a low surrogate (second half of surrogate pair), step forward 1
  if (s > 0 && s < len) {
    const code = str.charCodeAt(s);
    if (code >= 0xdc00 && code <= 0xdfff) {
      s++;
    }
  }

  // If end falls on a high surrogate (first half of surrogate pair), step backward 1
  if (e > 0 && e < len) {
    const prevCode = str.charCodeAt(e - 1);
    if (prevCode >= 0xd800 && prevCode <= 0xdbff) {
      e--;
    }
  }

  if (s >= e) return '';

  return sanitizeUnicode(str.slice(s, e));
}

/**
 * Truncates text by keeping the beginning (head) and end (tail), separated by an omission marker,
 * strictly preserving surrogate pairs and Unicode integrity.
 */
export function safeTruncateHeadTail(
  text: string,
  maxChars: number,
  headRatio: number = 0.75,
  omissionMarker: string = '\n\n[...]\n\n'
): string {
  if (!text || text.length <= maxChars) {
    return sanitizeUnicode(text || '');
  }

  const budget = Math.max(100, maxChars - omissionMarker.length);
  const headChars = Math.floor(budget * headRatio);
  const tailChars = budget - headChars;

  const head = safeSlice(text, 0, headChars);
  const tail = safeSlice(text, -tailChars);

  return `${head}${omissionMarker}${tail}`;
}

/**
 * Recursively sanitizes all strings in an object/array/payload before sending to external JSON APIs.
 */
export function sanitizePayloadForLlm<T>(payload: T): T {
  if (payload === null || payload === undefined) {
    return payload;
  }
  if (typeof payload === 'string') {
    return sanitizeUnicode(payload) as unknown as T;
  }
  if (Array.isArray(payload)) {
    return payload.map(item => sanitizePayloadForLlm(item)) as unknown as T;
  }
  if (typeof payload === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(payload)) {
      result[key] = sanitizePayloadForLlm(value);
    }
    return result;
  }
  return payload;
}
