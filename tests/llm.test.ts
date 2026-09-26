import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
const fsPromises = fs.promises;
import axios from 'axios';
import { z } from 'zod';
import { generateStructured, GenerationError } from '../src/server/llm/generate';
import { parseNote } from '../src/server/frontmatter';
import { processFile, setCurrentConfigForTest } from '../server';

describe('C1 & C8: Unified Model Access and Zero processing_error', () => {
  const tempVault = path.join(process.cwd(), 'tests', '_temp_llm_vault');

  beforeEach(async () => {
    await fsPromises.rm(tempVault, { recursive: true, force: true });
    await fsPromises.mkdir(path.join(tempVault, '00_Inbox'), { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fsPromises.rm(tempVault, { recursive: true, force: true });
  });

  it('throws structured GenerationError when JSON is malformed without processing_error fallback', async () => {
    const schema = z.object({
      title: z.string(),
      tags: z.array(z.string())
    });

    await expect(
      generateStructured({
        endpointUrl: '',
        messages: [{ role: 'user', content: 'test' }],
        schema
      })
    ).rejects.toThrow(GenerationError);
  });

  it('quarantines incoming Inbox note to 00_Inbox/Review with review_reason when LLM returns malformed JSON', async () => {
    setCurrentConfigForTest({
      vaultPath: tempVault,
      llamaUrl: 'http://127.0.0.1:8080',
      enableDecisionModel: false,
      decisionMode: 'hybrid'
    });

    const incomingFile = path.join(tempVault, '00_Inbox', 'BrokenNote.md');
    await fsPromises.writeFile(
      incomingFile,
      '---\ntitle: "Тестовая заметка"\n---\nСодержание заметки, для которой модель вернет битый JSON.',
      'utf-8'
    );

    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      data: {
        choices: [
          {
            message: {
              content: 'Here is broken JSON: { "title": "Broken", unquoted_error }'
            }
          }
        ]
      }
    });

    await processFile(incomingFile);

    const reviewFile = path.join(tempVault, '00_Inbox', 'Review', 'Тестовая заметка.md');
    expect(fs.existsSync(reviewFile)).toBe(true);
    expect(fs.existsSync(incomingFile)).toBe(false);

    const reviewContent = await fsPromises.readFile(reviewFile, 'utf-8');
    const parsed = parseNote(reviewContent);
    expect(parsed.data.review_reason).toBe('invalid_json_syntax');
    expect(parsed.data.ai_processed).toBe(false);
    expect(reviewContent).not.toContain('processing_error');
    expect(reviewContent).not.toContain('Automatic fallback due to model parsing error');
  });
});

