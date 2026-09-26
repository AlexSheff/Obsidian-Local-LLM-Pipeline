/**
 * Document Language Detection and Title/Tag Enforcement
 * 
 * Rules:
 * 1. If document text is in Russian -> title MUST be in Russian, tags include 'ru'
 * 2. If document text is in English -> title MUST be in English, tags include 'en'
 * 3. If document text is in Tagalog / Filipino -> tags include 'ph'
 * 4. Bilingual notes include all applicable tags (e.g. ['ru', 'en'])
 */

export interface LanguageDetectionResult {
  primary: 'ru' | 'en' | 'ph' | 'uk' | 'es' | 'de' | 'fr' | 'other';
  tags: string[]; // e.g. ['ru'], ['en'], ['ph'], ['ru', 'en']
  confidence: number;
  hasCyrillic: boolean;
  hasLatin: boolean;
}

const COMMON_TAGALOG_WORDS = new Set([
  'ang', 'mga', 'ng', 'sa', 'kay', 'para', 'dahil', 'ako', 'ikaw', 'siya',
  'kami', 'tayo', 'kayo', 'sila', 'hindi', 'oo', 'maganda', 'salamat',
  'ano', 'sino', 'saan', 'kailan', 'bakit', 'paano', 'pilipinas', 'pilipino',
  'tagalog', 'lahat', 'ngunit', 'subalit', 'dito', 'doon', 'bata', 'tao',
  'araw', 'gabi', 'buhay', 'bahay', 'walang', 'meron', 'mayroon', 'natin',
  'ninyo', 'kanila', 'amin', 'inyo', 'aking', 'iyong', 'kanyang'
]);

const COMMON_ENGLISH_WORDS = new Set([
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
  'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
  'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
  'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
  'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me',
  'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know', 'take',
  'people', 'into', 'year', 'your', 'good', 'some', 'could', 'them', 'see', 'other',
  'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also',
  'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first', 'well', 'way',
  'even', 'new', 'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us',
  'project', 'system', 'data', 'file', 'model', 'notes', 'ideas', 'guide', 'overview'
]);

const COMMON_RUSSIAN_WORDS = new Set([
  'и', 'в', 'не', 'на', 'я', 'что', 'тот', 'быть', 'с', 'он',
  'а', 'по', 'это', 'она', 'этот', 'к', 'но', 'они', 'мы', 'как',
  'из', 'у', 'который', 'то', 'за', 'свой', 'что', 'еще', 'ещё', 'от',
  'о', 'для', 'же', 'только', 'все', 'всё', 'его', 'до', 'вас', 'их',
  'если', 'уже', 'или', 'ни', 'бы', 'такой', 'день', 'год', 'когда', 'со',
  'проект', 'заметка', 'идея', 'система', 'сценарий', 'сюжет', 'работа', 'данные',
  'план', 'анализ', 'описание', 'развитие', 'концепция', 'цель', 'задача'
]);

/**
 * Detects the dominant language and language tags for note content.
 */
export function detectDocumentLanguage(text: string, filename = ''): LanguageDetectionResult {
  const combined = `${filename}\n${text}`;
  
  // Clean markdown code blocks, links, and noise to inspect real prose
  const prose = combined
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/[^\p{L}\s]/gu, ' ')
    .toLowerCase();

  const words = prose.split(/\s+/).filter(w => w.length >= 2);

  let cyrillicCharCount = 0;
  let latinCharCount = 0;
  let ukrainianCharCount = 0; // specific Ukrainian letters: і, ї, є, ґ

  for (const ch of prose) {
    const code = ch.charCodeAt(0);
    if ((code >= 0x0400 && code <= 0x04FF) || (code >= 0x0500 && code <= 0x052F)) {
      cyrillicCharCount++;
      if (ch === 'і' || ch === 'ї' || ch === 'є' || ch === 'ґ') {
        ukrainianCharCount++;
      }
    } else if ((code >= 0x0061 && code <= 0x007A) || (code >= 0x0041 && code <= 0x005A)) {
      latinCharCount++;
    }
  }

  let russianWordHits = 0;
  let englishWordHits = 0;
  let tagalogWordHits = 0;

  for (const word of words) {
    if (COMMON_RUSSIAN_WORDS.has(word)) russianWordHits++;
    if (COMMON_ENGLISH_WORDS.has(word)) englishWordHits++;
    if (COMMON_TAGALOG_WORDS.has(word)) tagalogWordHits++;
  }

  const tags: string[] = [];
  const hasCyrillic = cyrillicCharCount > 8 || (cyrillicCharCount > 0 && cyrillicCharCount >= latinCharCount * 0.25);
  const hasLatin = latinCharCount > 8 || (latinCharCount > 0 && latinCharCount >= cyrillicCharCount * 0.25);

  let primary: LanguageDetectionResult['primary'] = 'en';

  if (ukrainianCharCount > 2 && cyrillicCharCount > latinCharCount) {
    primary = 'uk';
    tags.push('uk');
  } else if (cyrillicCharCount > 0 && (cyrillicCharCount >= latinCharCount * 0.8 || russianWordHits > englishWordHits)) {
    primary = 'ru';
    tags.push('ru');
  } else if (tagalogWordHits >= 3 && tagalogWordHits > englishWordHits * 0.4) {
    primary = 'ph';
    tags.push('ph');
  } else {
    primary = 'en';
    tags.push('en');
  }

  // Bilingual / Multilingual detection
  if (primary === 'ru' && hasLatin && (latinCharCount > cyrillicCharCount * 0.35 || englishWordHits >= 3)) {
    if (!tags.includes('en')) tags.push('en');
  } else if (primary === 'en' && hasCyrillic && (cyrillicCharCount > latinCharCount * 0.35 || russianWordHits >= 3)) {
    if (!tags.includes('ru')) tags.push('ru');
  }

  // If Tagalog/Filipino detected alongside English
  if (primary === 'ph' && (englishWordHits >= 2 || latinCharCount > 100)) {
    if (!tags.includes('en')) tags.push('en');
  }

  const totalChars = cyrillicCharCount + latinCharCount;
  const confidence = totalChars > 20 ? 0.95 : totalChars > 5 ? 0.80 : 0.60;

  return {
    primary,
    tags,
    confidence,
    hasCyrillic,
    hasLatin
  };
}

/**
 * Checks if a string contains any Cyrillic characters.
 */
export function hasCyrillic(str: string): boolean {
  return /[\u0400-\u04FF]/u.test(str);
}

/**
 * Checks if a string is predominantly English / Latin.
 */
export function isPredominantlyLatin(str: string): boolean {
  let latin = 0;
  let cyrillic = 0;
  for (const ch of str) {
    const code = ch.charCodeAt(0);
    if (code >= 0x0400 && code <= 0x04FF) cyrillic++;
    else if ((code >= 0x0041 && code <= 0x005A) || (code >= 0x0061 && code <= 0x007A)) latin++;
  }
  return latin > cyrillic;
}

/**
 * Extracts candidate Russian title from note heading or filename.
 */
export function extractRussianTitleFallback(noteContent: string, originalFilename: string): string {
  // Check first markdown heading # ... in note
  const headingMatch = noteContent.match(/^#\s+([^\r\n]+)/m);
  if (headingMatch && hasCyrillic(headingMatch[1])) {
    const clean = headingMatch[1].replace(/[\\/:*?"<>|]/g, '').trim();
    if (clean.length >= 3 && clean.length <= 80) return clean;
  }

  // Check if original filename has Russian
  if (hasCyrillic(originalFilename)) {
    const nameWithoutExt = originalFilename.replace(/\.[^/.]+$/, '');
    // Clean timestamps and prefixes
    const clean = nameWithoutExt
      .replace(/^(\d{4}[-_]?\d{2}[-_]?\d{2}[-_]?\d{0,6}|\d{10,14})\s*/, '')
      .replace(/[\\/:*?"<>|]/g, '')
      .trim();
    if (clean.length >= 3) return clean;
  }

  // Look for first Russian sentence or phrase in text
  const russianSentence = noteContent.match(/(?:^|\n)\s*([А-ЯЁ][А-Яа-яЁё\s,–—]{3,60})/);
  if (russianSentence && russianSentence[1]) {
    const clean = russianSentence[1].trim();
    if (clean.length >= 3) return clean;
  }

  return 'Заметка';
}

/**
 * Extracts candidate English title from note heading or filename.
 */
export function extractEnglishTitleFallback(noteContent: string, originalFilename: string): string {
  const headingMatch = noteContent.match(/^#\s+([^\r\n]+)/m);
  if (headingMatch && !hasCyrillic(headingMatch[1])) {
    const clean = headingMatch[1].replace(/[\\/:*?"<>|]/g, '').trim();
    if (clean.length >= 3 && clean.length <= 80) return clean;
  }

  if (!hasCyrillic(originalFilename)) {
    const nameWithoutExt = originalFilename.replace(/\.[^/.]+$/, '');
    const clean = nameWithoutExt
      .replace(/^(\d{4}[-_]?\d{2}[-_]?\d{2}[-_]?\d{0,6}|\d{10,14})\s*/, '')
      .replace(/[\\/:*?"<>|]/g, '')
      .trim();
    if (clean.length >= 3) return clean;
  }

  return 'Document';
}

/**
 * Enforces the language rule:
 * - If document text is in Russian, title MUST be in Russian.
 * - If document text is in English, title MUST be in English.
 * 
 * If LLM violated this rule (e.g. produced an English title for a Russian document),
 * this function corrects the title using heading/filename fallbacks.
 */
export function enforceTitleLanguage(
  title: string,
  docContent: string,
  originalFilename: string,
  detectedLang?: LanguageDetectionResult
): string {
  const lang = detectedLang || detectDocumentLanguage(docContent, originalFilename);
  const titleHasCyrillic = hasCyrillic(title);

  // Rule 1: Document is Russian, but title has NO Russian letters (e.g. LLM translated to English)
  if (lang.primary === 'ru' && !titleHasCyrillic) {
    // If the original filename has Russian or content has a Russian heading, use that
    const russianFallback = extractRussianTitleFallback(docContent, originalFilename);
    if (russianFallback && russianFallback !== 'Заметка') {
      return russianFallback;
    }
    // If originalFilename itself has Russian, keep cleaned original
    if (hasCyrillic(originalFilename)) {
      return originalFilename.replace(/\.[^/.]+$/, '').trim();
    }
  }

  // Rule 2: Document is English, but title has Cyrillic letters
  if (lang.primary === 'en' && titleHasCyrillic) {
    const englishFallback = extractEnglishTitleFallback(docContent, originalFilename);
    if (englishFallback && englishFallback !== 'Document') {
      return englishFallback;
    }
    if (!hasCyrillic(originalFilename)) {
      return originalFilename.replace(/\.[^/.]+$/, '').trim();
    }
  }

  return title;
}

/**
 * Merges mandatory language tags (e.g. 'ru', 'en', 'ph') into tags array without duplicates.
 */
export function ensureLanguageTags(
  tags: string[],
  docContent: string,
  originalFilename = ''
): string[] {
  const lang = detectDocumentLanguage(docContent, originalFilename);
  const normalizedExisting = new Set(tags.map(t => t.toLowerCase().replace(/^#+/, '')));

  const result = [...tags];

  for (const tag of lang.tags) {
    if (!normalizedExisting.has(tag.toLowerCase())) {
      // Put language tag at the beginning
      result.unshift(tag);
      normalizedExisting.add(tag.toLowerCase());
    }
  }

  return result;
}
