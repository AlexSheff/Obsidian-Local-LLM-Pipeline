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
    stream: false
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

  try {
    const payload = sanitizePayloadForLlm(primaryPayload);
    const response = await axios.post(`${cleanUrl}/v1/chat/completions`, payload, {
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' }
    });
    rawContent = response.data?.choices?.[0]?.message?.content || '';
  } catch (primaryErr: any) {
    // If strict json_schema rejected with 400, retry once with json_object
    const is400 = primaryErr.response?.status === 400;
    if (is400 && primaryPayload.response_format?.type === 'json_schema') {
      try {
        const fallbackPayload = sanitizePayloadForLlm({
          messages,
          temperature,
          max_tokens: maxTokens,
          stream: false,
          response_format: { type: 'json_object' }
        });
        const fbRes = await axios.post(`${cleanUrl}/v1/chat/completions`, fallbackPayload, {
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' }
        });
        rawContent = fbRes.data?.choices?.[0]?.message?.content || '';
      } catch (fbErr: any) {
        clearTimeout(timer);
        throw new GenerationError(
          `Generative LLM call failed: ${fbErr.message}`,
          `llm_network_error: ${fbErr.message}`
        );
      }
    } else {
      clearTimeout(timer);
      throw new GenerationError(
        `Generative LLM call failed: ${primaryErr.message}`,
        `llm_network_error: ${primaryErr.message}`
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

  // Parse JSON
  let parsedJson: any;
  try {
    parsedJson = JSON.parse(rawContent.trim());
  } catch (jsonErr) {
    // Try to extract JSON object if surrounded by markdown or commentary
    const match = rawContent.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsedJson = JSON.parse(match[0]);
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
