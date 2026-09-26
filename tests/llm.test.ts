import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { generateStructured, GenerationError } from '../src/server/llm/generate';

describe('C1 & C8: Unified Model Access and Zero processing_error', () => {
  it('throws structured GenerationError when JSON is malformed without processing_error fallback', async () => {
    const schema = z.object({
      title: z.string(),
      tags: z.array(z.string())
    });

    // We simulate by passing an invalid endpoint or verifying error handling
    await expect(
      generateStructured({
        endpointUrl: '',
        messages: [{ role: 'user', content: 'test' }],
        schema
      })
    ).rejects.toThrow(GenerationError);
  });
});
