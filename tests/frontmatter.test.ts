import { describe, it, expect } from 'vitest';
import { parseNote, serializeNote, mergeTags } from '../src/server/frontmatter';

describe('A1: Frontmatter Management', () => {
  it('preserves all keys (including dashes, cyrillic, lists) when adding tags', () => {
    const input = `---
# Top level comment
date-created: 2024-05-01
related-notes: [a, b]
tags: [project]
# Cyrillic key
дата: 2024-05-01
---
Body text line 1
Body text line 2
`;
    const note = parseNote(input);
    expect(note.hadFrontmatter).toBe(true);
    expect(note.data['date-created']).toBe('2024-05-01');
    expect(note.data['дата']).toBe('2024-05-01');

    mergeTags(note.data, ['ai']);
    const serialized = serializeNote(note.data, note.body);

    const reParsed = parseNote(serialized);
    expect(reParsed.data['date-created']).toBe('2024-05-01');
    expect(reParsed.data['related-notes']).toEqual(['a', 'b']);
    expect(reParsed.data['дата']).toBe('2024-05-01');
    expect(reParsed.data.tags).toEqual(['project', 'ai']);
    expect(reParsed.body).toBe(note.body);
  });

  it('preserves hashtags: [x] unchanged when modifying tags:', () => {
    const input = `---
hashtags: [x]
tags: [old-tag]
---
Body content`;
    const note = parseNote(input);
    mergeTags(note.data, ['new-tag']);
    const serialized = serializeNote(note.data, note.body);

    const reParsed = parseNote(serialized);
    expect(reParsed.data.hashtags).toEqual(['x']);
    expect(reParsed.data.tags).toEqual(['old-tag', 'new-tag']);
  });

  it('handles category with colon/quotes and summary ending in backslash losslessly', () => {
    const data = {
      title: 'Complex Title',
      category: '03_Knowledge/Topics: draft #1',
      summary: 'Summary with special symbols and ending with backslash \\',
      tags: ['test'],
    };
    const body = 'Body content paragraph.\n';
    const serialized = serializeNote(data, body);

    const parsed = parseNote(serialized);
    expect(parsed.data.category).toBe('03_Knowledge/Topics: draft #1');
    expect(parsed.data.summary).toBe('Summary with special symbols and ending with backslash \\');
    expect(parsed.data.tags).toEqual(['test']);
    expect(parsed.body).toBe(body);
  });

  it('preserves note body byte-for-byte', () => {
    const body = 'Exact markdown body\n- Item 1\n- Item 2\n\nFinal paragraph.\n';
    const input = `---
title: Test
tags: [sample]
---
${body}`;
    const note = parseNote(input);
    mergeTags(note.data, ['extra']);
    const serialized = serializeNote(note.data, note.body);

    const reParsed = parseNote(serialized);
    expect(reParsed.body).toBe(body);
  });

  it('supports CRLF line endings', () => {
    const input = '---\r\ntitle: CRLF Note\r\ntags: [a]\r\n---\r\nLine 1\r\nLine 2\r\n';
    const note = parseNote(input);
    mergeTags(note.data, ['b']);
    const serialized = serializeNote(note.data, note.body);

    expect(serialized).toContain('\r\n');
    expect(serialized.replace(/\r\n/g, '')).not.toContain('\n');
    const reParsed = parseNote(serialized);
    expect(reParsed.data.tags).toEqual(['a', 'b']);
    expect(reParsed.body).toBe('Line 1\r\nLine 2\r\n');
  });

  it('handles frontmatter where closing --- has no trailing newline', () => {
    const input = '---\ntitle: No Trailing\ntags: [x]\n---';
    const note = parseNote(input);
    expect(note.hadFrontmatter).toBe(true);
    expect(note.data.title).toBe('No Trailing');
    expect(note.body).toBe('');

    mergeTags(note.data, ['y']);
    const serialized = serializeNote(note.data, note.body);
    const reParsed = parseNote(serialized);
    expect(reParsed.data.tags).toEqual(['x', 'y']);
  });
});
