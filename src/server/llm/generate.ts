import axios from 'axios';
import { z } from 'zod';
import { sanitizePayloadForLlm } from '../unicode';

export class GenerationError extends Error {
  public reviewReason: string;
  public rawContent?: string;

  constructor(message: string, reviewReason: string, rawContent?: string) {
    super(message);
    this.name = 'GenerationError';
    this.reviewReason = reviewReason;
    this.rawContent = rawContent;
  }
}

export interface GenerateOptions<T> {
  endpointUrl: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  schema: z.ZodType<T>;
  jsonSchema?: Record<string, any>;
  schemaName?: string;
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Executes a generative LLM request with structured JSON schema enforcement and zod validation.
 * Never silently defaults or uses placeholder error tags.
 */
export async function generateStructured<T>(options: GenerateOptions<T>): Promise<T> {
  const {
    endpointUrl,
    messages,
    schema,
    jsonSchema,
    schemaName = 'response_schema',
    timeoutMs = 60000,
    temperature = 0.1,
    maxTokens = 800
  } = options;

  if (!endpointUrl) {
    throw new GenerationError(
      'Generative LLM URL not configured',
      'llm_url_missing'
    );
  }

  const cleanUrl = endpointUrl.replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Strategy 1: OpenAI strict json_schema
  const primaryPayload: any = {
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false,
    cache_prompt: true
  };

  if (jsonSchema) {
    primaryPayload.response_format = {
      type: 'json_schema',
      json_schema: {
        name: schemaName,
        strict: true,
        schema: jsonSchema
      }
    };
  } else {
    primaryPayload.response_format = { type: 'json_object' };
  }

  let rawContent = '';

  const extractAxiosErrorDetail = (err: any): string => {
    const serverMsg =
      err?.response?.data?.error?.message ||
      err?.response?.data?.message ||
      (typeof err?.response?.data === 'string' ? err.response.data.slice(0, 200) : '');
    return serverMsg ? `${err.message} (${serverMsg})` : err.message;
  };

  const compactMessagesForRetry = (
    msgs: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  ) => {
    return msgs.map(m => {
      if (m.content.length <= 1600) return m;
      const head = m.content.slice(0, 900);
      const tail = m.content.slice(-500);
      return {
        ...m,
        content: `${head}\n...[TRUNCATED FOR CONTEXT LIMIT]...\n${tail}`
      };
    });
  };

  try {
    const payload = sanitizePayloadForLlm(primaryPayload);
    const response = await axios.post(`${cleanUrl}/v1/chat/completions`, payload, {
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' }
    });
    rawContent = response.data?.choices?.[0]?.message?.content || '';
  } catch (primaryErr: any) {
    const is400 = primaryErr.response?.status === 400;
    if (is400) {
      // Retry on HTTP 400 (either strict json_schema unsupported OR prompt + max_tokens exceeded llama-server -c context slot)
      try {
        const compactedMessages = compactMessagesForRetry(messages);
        const reducedMaxTokens = Math.min(maxTokens, 200);
        const fallbackPayload = sanitizePayloadForLlm({
          messages: compactedMessages,
          temperature,
          max_tokens: reducedMaxTokens,
          stream: false,
          cache_prompt: true,
          response_format: { type: 'json_object' }
        });
        const fbRes = await axios.post(`${cleanUrl}/v1/chat/completions`, fallbackPayload, {
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' }
        });
        rawContent = fbRes.data?.choices?.[0]?.message?.content || '';
      } catch (fbErr: any) {
        clearTimeout(timer);
        const detail = extractAxiosErrorDetail(fbErr);
        throw new GenerationError(
          `Generative LLM call failed: ${detail}`,
          `llm_network_error: ${detail}`
        );
      }
    } else {
      clearTimeout(timer);
      const detail = extractAxiosErrorDetail(primaryErr);
      throw new GenerationError(
        `Generative LLM call failed: ${detail}`,
        `llm_network_error: ${detail}`
      );
    }
  } finally {
    clearTimeout(timer);
  }

  if (!rawContent || rawContent.trim().length === 0) {
    throw new GenerationError(
      'Generative LLM returned empty response',
      'empty_llm_response',
      rawContent
    );
  }

  // Parse JSON (strip <think> reasoning blocks if present)
  let parsedJson: any;
  const cleanRaw = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  try {
    parsedJson = JSON.parse(cleanRaw);
  } catch (jsonErr) {
    // Try to extract JSON object if surrounded by markdown or commentary
    const match = cleanRaw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const cleanedMatch = match[0].replace(/,\s*([\}\]])/g, '$1');
        parsedJson = JSON.parse(cleanedMatch);
      } catch {
        throw new GenerationError(
          'Failed to parse JSON from LLM output',
          'invalid_json_syntax',
          rawContent
        );
      }
    } else {
      throw new GenerationError(
        'No valid JSON object found in LLM response',
        'missing_json_object',
        rawContent
      );
    }
  }

  // Validate with Zod
  const parseResult = schema.safeParse(parsedJson);
  if (!parseResult.success) {
    const errorDetails = parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new GenerationError(
      `LLM response failed schema validation: ${errorDetails}`,
      `schema_validation_failed: ${errorDetails}`,
      rawContent
    );
  }

  return parseResult.data;
}
