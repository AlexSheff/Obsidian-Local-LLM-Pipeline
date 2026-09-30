import { decide, DecisionOutput } from '../decisionModel';

export interface RouterOptions {
  decisionModelUrl?: string;
  timeoutMs?: number;
}

/**
 * Universal discrete classification wrapper over Jev decision model.
 */
export async function chooseOne(
  state: string,
  question: string,
  options: string[],
  opts?: RouterOptions
): Promise<DecisionOutput> {
  const url = opts?.decisionModelUrl || 'http://127.0.0.1:1234';
  const timeout = opts?.timeoutMs || 15000;
  return await decide(url, state, question, options, timeout);
}

/**
 * Binary Yes/No query returning calibrated confidence for each branch.
 */
export async function askYesNo(
  state: string,
  question: string,
  opts?: RouterOptions & { lang?: string }
): Promise<{ yes: number; no: number; output: DecisionOutput }> {
  const isRu = (opts?.lang || '').toLowerCase().startsWith('ru') || /[\u0430-\u044f\u0451]/i.test(question);
  const options = isRu ? ['\u0414\u0430', '\u041d\u0435\u0442'] : ['Yes', 'No'];
  const output = await chooseOne(state, question, options, opts);

  const yesDecision = output.decisions.find(d => d.letter === 'A');
  const noDecision = output.decisions.find(d => d.letter === 'B');

  return {
    yes: yesDecision ? yesDecision.probability : (output.chosen.letter === 'A' ? 1.0 : 0.0),
    no: noDecision ? noDecision.probability : (output.chosen.letter === 'B' ? 1.0 : 0.0),
    output
  };
}
