import { describe, it, expect } from 'vitest';
import { sanitizeUnicode, safeSlice, safeTruncateHeadTail, sanitizePayloadForLlm } from '../src/server/unicode';

describe('Unicode & Surrogate Safety', () => {
  it('sanitizes lone surrogate code units that cause llama-server C++ parser errors', () => {
    // Exact user failure case: \udca1 without preceding high surrogate
    const brokenLow = 'Some text [...]\n\n\udca1';
    const cleanedLow = sanitizeUnicode(brokenLow);
    expect(cleanedLow).not.toContain('\udca1');
    // Ensure JSON.stringify produces valid RFC 8259 without lone surrogates
    const jsonStr = JSON.stringify({ prompt: cleanedLow });
    expect(jsonStr).not.toContain('\\udca1');

    // Lone high surrogate without following low surrogate
    const brokenHigh = 'Some text \ud83d without low surrogate';
    const cleanedHigh = sanitizeUnicode(brokenHigh);
    expect(cleanedHigh).not.toContain('\ud83d');
    const jsonHigh = JSON.stringify({ prompt: cleanedHigh });
    expect(jsonHigh).not.toContain('\\ud83d');
  });

  it('preserves valid multi-byte emojis and UTF-8 characters', () => {
    const valid = 'Межпланетный интернет 💡 🧭 и киберсознание 🚀';
    expect(sanitizeUnicode(valid)).toBe(valid);
  });

  it('safeSlice does not split surrogate pairs in half', () => {
    // "💡" is represented in UTF-16 as "\uD83D\uDCA1" (length 2)
    const textWithEmoji = 'Prefix💡Suffix';
    // index 6 is the high surrogate (\uD83D), index 7 is the low surrogate (\uDCA1)
    expect(textWithEmoji.charCodeAt(6)).toBe(0xd83d);
    expect(textWithEmoji.charCodeAt(7)).toBe(0xdca1);

    // If a normal slice slices at index 7 (start = 7):
    const badSlice = textWithEmoji.slice(7);
    expect(badSlice.charCodeAt(0)).toBe(0xdca1); // Low surrogate at start!

    // safeSlice steps forward to avoid starting with a low surrogate
    const goodSlice = safeSlice(textWithEmoji, 7);
    expect(goodSlice).toBe('Suffix');

    // If slice ends at index 7 (end = 7):
    const badEndSlice = textWithEmoji.slice(0, 7);
    expect(badEndSlice.charCodeAt(6)).toBe(0xd83d); // High surrogate at end!

    // safeSlice steps back to avoid ending with a high surrogate
    const goodEndSlice = safeSlice(textWithEmoji, 0, 7);
    expect(goodEndSlice).toBe('Prefix');
  });

  it('safeTruncateHeadTail produces clean string without splitting emojis', () => {
    const text = 'Start of text ' + '💡'.repeat(500) + ' End of text with final 🧭 emoji';
    const truncated = safeTruncateHeadTail(text, 200);

    expect(truncated).toContain('\n\n[...]\n\n');
    expect(truncated.length).toBeLessThanOrEqual(250);
    // Ensure all characters in truncated are well-formed
    expect(sanitizeUnicode(truncated)).toBe(truncated);
  });

  it('sanitizePayloadForLlm cleans nested objects and arrays', () => {
    const raw = {
      messages: [
        { role: 'user', content: 'Hello \udca1 world' }
      ],
      nested: {
        title: 'Title \ud83d'
      }
    };
    const sanitized = sanitizePayloadForLlm(raw);
    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain('\\udca1');
    expect(serialized).not.toContain('\\ud83d');
  });
});
