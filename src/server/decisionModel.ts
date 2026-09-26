import axios from 'axios';
import { safeSlice, sanitizeUnicode, sanitizePayloadForLlm } from './unicode';

export interface DecisionResult {
  letter: string;
  option: string;
  probability: number;
  logprob?: number;
}

export interface DecisionOutput {
  decisions: DecisionResult[];
  chosen: DecisionResult;
  confidence: number;
  calibrated: boolean;
  question: string;
  optionsCount: number;
}

// Circuit-breaker cache to avoid freezing pipeline if Jev/LM-Studio is offline
interface HealthCacheEntry {
  online: boolean;
  lastChecked: number;
  latencyMs?: number;
  error?: string;
}
const healthCache = new Map<string, HealthCacheEntry>();
const HEALTH_CACHE_TTL_MS = 25000; // 25 seconds

/**
 * Fast ping to check if decision model server is alive.
 */
export async function checkDecisionServerHealth(
  endpointUrl: string,
  timeoutMs = 1500
): Promise<{ online: boolean; latencyMs?: number; models?: string[]; error?: string }> {
  if (!endpointUrl) return { online: false, error: 'URL not set' };
  const cleanUrl = endpointUrl.replace(/\/+$/, '');

  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Check models or root endpoint
    const resp = await axios.get(`${cleanUrl}/v1/models`, {
      signal: controller.signal,
      timeout: timeoutMs
    });
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    const rawModels = resp.data?.data || [];
    const models = Array.isArray(rawModels) ? rawModels.map((m: any) => m.id || m.name).filter(Boolean) : [];
    const entry = { online: true, lastChecked: Date.now(), latencyMs, models };
    healthCache.set(cleanUrl, { online: true, lastChecked: Date.now(), latencyMs });
    return entry;
  } catch (err: any) {
    clearTimeout(timer);
    const errorMsg = err.code === 'ECONNREFUSED'
      ? 'Connection refused (server is offline)'
      : err.message;
    const entry = { online: false, lastChecked: Date.now(), error: errorMsg };
    healthCache.set(cleanUrl, entry);
    return entry;
  }
}

/**
 * Checks whether the decision server is online with cache to prevent latency penalties.
 */
export async function isDecisionServerReachable(
  endpointUrl: string,
  timeoutMs = 1200
): Promise<boolean> {
  if (!endpointUrl) return false;
  const cleanUrl = endpointUrl.replace(/\/+$/, '');
  const cached = healthCache.get(cleanUrl);
  if (cached && Date.now() - cached.lastChecked < HEALTH_CACHE_TTL_MS) {
    return cached.online;
  }

  const res = await checkDecisionServerHealth(cleanUrl, timeoutMs);
  return res.online;
}

export const STANDARD_CONTENT_TYPES = [
  'Technical Code, API or Configuration',
  'Meeting Transcript or Interview Dialogue',
  'Creative Fiction, Screenplay or Poem',
  'Knowledge Essay, Deep Article or Research',
  'Project Roadmap, Business Plan or Tasks',
  'Personal Journal, Diary or Daily Reflection'
];

/**
 * Builds the canonical prompt for Jev-style decision models.
 */
export function buildJevPrompt(state: string, question: string, options: string[]): string {
  if (options.length === 0) {
    throw new Error('Options array must not be empty');
  }
  if (options.length > 26) {
    throw new Error('Options count must not exceed 26 (A-Z)');
  }

  const optionLines = options.map((opt, idx) => {
    const letter = String.fromCharCode(65 + idx); // 'A', 'B', 'C'...
    return `${letter}. ${sanitizeUnicode(opt).trim()}`;
  }).join('\n');

  const rawPrompt = `You are a decision function. Read the state, then answer the question by choosing exactly one option.

[State]
${sanitizeUnicode(state).trim()}

[Question]
${sanitizeUnicode(question).trim()}

[Options]
${optionLines}

Answer:`;

  return sanitizeUnicode(rawPrompt);
}

/**
 * Parses the choice letter and logprobs distribution from an OpenAI-compatible /v1/chat/completions response.
 */
export function parseDecisionResponse(
  responseData: any,
  options: string[]
): DecisionOutput {
  const choices = responseData?.choices;
  if (!choices || !Array.isArray(choices) || choices.length === 0) {
    throw new Error('Invalid response from decision server: no choices returned');
  }

  const firstChoice = choices[0];
  const rawContent = (firstChoice?.message?.content || firstChoice?.text || '').trim();
  const optionLetters = options.map((_, idx) => String.fromCharCode(65 + idx));

  // Check for logprobs
  const contentLogprobs = firstChoice?.logprobs?.content;
  const topLogprobs = contentLogprobs && Array.isArray(contentLogprobs) && contentLogprobs.length > 0
    ? contentLogprobs[0]?.top_logprobs
    : null;

  if (topLogprobs && Array.isArray(topLogprobs) && topLogprobs.length > 0) {
    // Calibrated top_logprobs extraction
    const rawProbs: { [letter: string]: number } = {};
    for (const item of topLogprobs) {
      const tokenLetter = (item.token || '').trim().toUpperCase();
      if (optionLetters.includes(tokenLetter)) {
        const prob = item.logprob !== undefined ? Math.exp(item.logprob) : (item.prob || 0);
        rawProbs[tokenLetter] = (rawProbs[tokenLetter] || 0) + prob;
      }
    }

    // Renormalize over declared options
    let sumProbs = 0;
    for (const letter of optionLetters) {
      sumProbs += rawProbs[letter] || 1e-6;
    }

    const decisions: DecisionResult[] = optionLetters.map((letter, idx) => {
      const p = (rawProbs[letter] || 1e-6) / sumProbs;
      return {
        letter,
        option: options[idx],
        probability: Math.round(p * 1000) / 1000
      };
    });

    // Sort by probability descending
    decisions.sort((a, b) => b.probability - a.probability);
    const chosen = decisions[0];

    return {
      decisions,
      chosen,
      confidence: chosen.probability,
      calibrated: true,
      question: '',
      optionsCount: options.length
    };
  }

  // Fallback if logprobs were not requested or server doesn't support them
  // Detect single letter from output
  const matchedLetter = rawContent.charAt(0).toUpperCase();
  const validLetter = optionLetters.includes(matchedLetter) ? matchedLetter : optionLetters[0];
  const chosenIndex = validLetter.charCodeAt(0) - 65;

  const decisions: DecisionResult[] = optionLetters.map((letter, idx) => ({
    letter,
    option: options[idx],
    probability: letter === validLetter ? 1.0 : 0.0
  }));

  return {
    decisions,
    chosen: decisions[chosenIndex],
    confidence: 1.0,
    calibrated: false,
    question: '',
    optionsCount: options.length
  };
}

/**
 * Execute a decision call to an OpenAI-compatible decision model server (LM Studio / llama.cpp).
 */
export async function decide(
  endpointUrl: string,
  state: string,
  question: string,
  options: string[],
  timeoutMs = 15000
): Promise<DecisionOutput> {
  if (!endpointUrl) {
    throw new Error('Decision model URL is not configured');
  }

  const prompt = buildJevPrompt(state, question, options);
  const cleanUrl = endpointUrl.replace(/\/+$/, '');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const payload = sanitizePayloadForLlm({
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1,
      temperature: 0.0,
      logprobs: true,
      top_logprobs: Math.min(20, Math.max(5, options.length))
    });

    const response = await axios.post(`${cleanUrl}/v1/chat/completions`, payload, {
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' }
    });
    clearTimeout(timer);

    const result = parseDecisionResponse(response.data, options);
    result.question = question;
    return result;
  } catch (err: any) {
    clearTimeout(timer);
    if (axios.isAxiosError(err)) {
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
        throw new Error(`Decision server connection failed at ${cleanUrl}. Ensure LM Studio or llama-server is running.`);
      }
      if (err.name === 'CanceledError' || controller.signal.aborted) {
        throw new Error(`Decision server timed out after ${Math.round(timeoutMs / 1000)}s.`);
      }
      throw new Error(`Decision server error: ${err.response?.data?.error?.message || err.message}`);
    }
    throw err;
  }
}

