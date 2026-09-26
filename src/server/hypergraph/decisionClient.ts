import { decide, DecisionOutput } from '../decisionModel';
import { sharedDecisionLimiter } from './rateLimiter';

export interface DecisionClientOptions {
  endpointUrl?: string;
  timeoutMs?: number;
}

export type PrimitiveType = 'noul' | 'score' | 'choice';

export type OnPrimitiveCallHook = (
  primitive: PrimitiveType,
  promptTokens: number,
  wallClockMs: number
) => void;

let globalPrimitiveHook: OnPrimitiveCallHook | null = null;

export function setPrimitiveCallHook(hook: OnPrimitiveCallHook | null): void {
  globalPrimitiveHook = hook;
}

/**
 * Approximate token count helper for cost/latency tracking.
 */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Noul primitive: returns probability of 'Yes'/'Да' in [0, 1].
 * Used for hybridization: can tokens a and b form a logical relation?
 */
export async function noul(
  state: string,
  question: string,
  opts?: DecisionClientOptions
): Promise<number> {
  const url = opts?.endpointUrl || 'http://127.0.0.1:1234';
  const timeout = opts?.timeoutMs || 15000;
  const isRu = /[а-яё]/i.test(question + ' ' + state);
  const options = isRu ? ['Да', 'Нет'] : ['Yes', 'No'];

  const startTime = Date.now();
  const output: DecisionOutput = await sharedDecisionLimiter.execute(() =>
    decide(url, state, question, options, timeout)
  );
  const wallClockMs = Date.now() - startTime;

  if (globalPrimitiveHook) {
    const tokens = estimateTokens(state + question);
    globalPrimitiveHook('noul', tokens, wallClockMs);
  }

  const yesDecision = output.decisions.find(d => d.letter === 'A');
  if (yesDecision) {
    return Math.max(0, Math.min(1, yesDecision.probability));
  }
  return output.chosen.letter === 'A' ? output.confidence : 1 - output.confidence;
}

/**
 * Score primitive: returns rating 1..5 for semantic connection strength.
 * Used for selection: how strong is the relation among triplet a - b - c?
 */
export async function score(
  state: string,
  question: string,
  scale: [number, number] = [1, 5],
  opts?: DecisionClientOptions
): Promise<number> {
  const url = opts?.endpointUrl || 'http://127.0.0.1:1234';
  const timeout = opts?.timeoutMs || 15000;
  const options = ['1', '2', '3', '4', '5'];

  const startTime = Date.now();
  const output: DecisionOutput = await sharedDecisionLimiter.execute(() =>
    decide(url, state, question, options, timeout)
  );
  const wallClockMs = Date.now() - startTime;

  if (globalPrimitiveHook) {
    const tokens = estimateTokens(state + question);
    globalPrimitiveHook('score', tokens, wallClockMs);
  }

  // Calculate expectation if distribution is available, else parse chosen
  if (output.decisions && output.decisions.length > 0) {
    let expected = 0;
    let totalProb = 0;
    for (const d of output.decisions) {
      const val = parseInt(d.option, 10);
      if (!isNaN(val)) {
        expected += val * d.probability;
        totalProb += d.probability;
      }
    }
    if (totalProb > 0) {
      const scoreVal = expected / totalProb;
      return Math.max(scale[0], Math.min(scale[1], Math.round(scoreVal * 100) / 100));
    }
  }

  const chosenVal = parseInt(output.chosen.option, 10);
  if (!isNaN(chosenVal)) {
    return Math.max(scale[0], Math.min(scale[1], chosenVal));
  }
  return 3;
}

/**
 * Choice primitive: chooses exactly one candidate from options (up to 26).
 * Used for Oracle prediction and linker selection.
 */
export async function choice(
  state: string,
  question: string,
  options: string[],
  opts?: DecisionClientOptions
): Promise<{ id: string; distribution: Record<string, number>; confidence: number }> {
  if (options.length === 0) {
    throw new Error('Options array must not be empty');
  }
  if (options.length > 26) {
    throw new Error('Options count must not exceed 26 (A-Z)');
  }

  const url = opts?.endpointUrl || 'http://127.0.0.1:1234';
  const timeout = opts?.timeoutMs || 15000;

  const startTime = Date.now();
  const output: DecisionOutput = await sharedDecisionLimiter.execute(() =>
    decide(url, state, question, options, timeout)
  );
  const wallClockMs = Date.now() - startTime;

  if (globalPrimitiveHook) {
    const tokens = estimateTokens(state + question + options.join(' '));
    globalPrimitiveHook('choice', tokens, wallClockMs);
  }

  const distribution: Record<string, number> = {};
  for (const d of output.decisions) {
    distribution[d.option] = d.probability;
  }

  return {
    id: output.chosen.option,
    distribution,
    confidence: output.confidence
  };
}
