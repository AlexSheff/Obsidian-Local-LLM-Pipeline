import path from 'path';
import fs from 'fs';
const fsPromises = fs.promises;
import { DnaEngine, Hyperedge, computeHyperedgeId } from './dnaEngine';
import { TokensRegistry } from './tokensRegistry';
import { choice, DecisionClientOptions } from './decisionClient';
import { CostTracker } from './costTracker';

export interface TickRecord {
  tick: number;
  at: string;
  edgesAdded: number;
  edgesPending: number;
  modelCalls: number;
  wallClockMs: number;
}

export interface OracleOptions {
  oracleMin?: number; // default 0.5
  maxPairsToExplore?: number; // default 20
  model?: string;
  schemaVersion?: number;
}

export class OracleEngine {
  private vaultPath: string;
  private ticksPath: string;
  private dnaEngine: DnaEngine;
  private tokensRegistry: TokensRegistry;
  private oracleMin: number;
  private maxPairsToExplore: number;
  private model: string;
  private schemaVersion: number;
  private currentTick = 0;

  constructor(
    vaultPath: string,
    dnaEngine: DnaEngine,
    tokensRegistry: TokensRegistry,
    options: OracleOptions = {}
  ) {
    this.vaultPath = vaultPath;
    this.ticksPath = path.join(vaultPath, '99_System', 'hypergraph', 'ticks.jsonl');
    this.dnaEngine = dnaEngine;
    this.tokensRegistry = tokensRegistry;
    this.oracleMin = options.oracleMin ?? 0.5;
    this.maxPairsToExplore = options.maxPairsToExplore ?? 20;
    this.model = options.model ?? 'Jev-Style-Qwen3.5-2B-Decision-Q4_K_M';
    this.schemaVersion = options.schemaVersion ?? 1;
  }

  public async loadCurrentTick(): Promise<number> {
    if (this.vaultPath && fs.existsSync(this.ticksPath)) {
      try {
        const content = await fsPromises.readFile(this.ticksPath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim().length > 0);
        if (lines.length > 0) {
          const last = JSON.parse(lines[lines.length - 1]);
          if (typeof last.tick === 'number') {
            this.currentTick = last.tick;
          }
        }
      } catch {}
    }
    return this.currentTick;
  }

  public getCurrentTick(): number {
    return this.currentTick;
  }

  /**
   * Runs one cycle of Oracle predictions to forecast H_{t+1}.
   */
  public async predictNextState(
    costTracker?: CostTracker,
    opts?: DecisionClientOptions
  ): Promise<{ tick: number; edgesPending: Hyperedge[]; modelCalls: number; wallClockMs: number }> {
    await this.dnaEngine.load();
    await this.tokensRegistry.load();
    await this.loadCurrentTick();

    const startMs = Date.now();
    this.currentTick += 1;
    const tick = this.currentTick;

    const activeEdges = this.dnaEngine.getEdges('active');
    const existingTriples = new Set(this.dnaEngine.getEdges().map(e => e.id));

    // Map co-occurrence connections between tokens
    const neighbors = new Map<string, Set<string>>();
    const edgePairs = new Map<string, { a: string; b: string; weight: number }>();

    for (const edge of activeEdges) {
      const [t1, t2, t3] = edge.triple;
      const nodes = [t1, t2, t3].filter(n => n !== '\u0441\u0432\u044f\u0437\u0430\u043d\u043e-\u0441');

      for (let i = 0; i < nodes.length; i++) {
        const u = nodes[i];
        if (!neighbors.has(u)) neighbors.set(u, new Set());

        for (let j = i + 1; j < nodes.length; j++) {
          const v = nodes[j];
          if (!neighbors.has(v)) neighbors.set(v, new Set());
          neighbors.get(u)!.add(v);
          neighbors.get(v)!.add(u);

          const pairKey = [u, v].sort().join('|');
          const prev = edgePairs.get(pairKey);
          if (!prev || edge.weight > prev.weight) {
            edgePairs.set(pairKey, { a: u, b: v, weight: edge.weight });
          }
        }
      }
    }

    // Sort pairs by highest connection weight to predict extensions of strongest clusters
    const sortedPairs = Array.from(edgePairs.values())
      .sort((p1, p2) => p2.weight - p1.weight)
      .slice(0, this.maxPairsToExplore);

    const pendingEdges: Hyperedge[] = [];
    let modelCalls = 0;

    for (const pair of sortedPairs) {
      if (costTracker?.isLimitExceeded()) break;

      const { a, b } = pair;
      // Candidate tokens z: shared neighbors of a or b, not connected in existing triplet (a, b, z)
      const candidateCounts = new Map<string, number>();

      const nA = neighbors.get(a) || new Set();
      const nB = neighbors.get(b) || new Set();

      for (const z of nA) {
        if (z === a || z === b || z === '\u0441\u0432\u044f\u0437\u0430\u043d\u043e-\u0441') continue;
        candidateCounts.set(z, (candidateCounts.get(z) || 0) + 1);
      }
      for (const z of nB) {
        if (z === a || z === b || z === '\u0441\u0432\u044f\u0437\u0430\u043d\u043e-\u0441') continue;
        candidateCounts.set(z, (candidateCounts.get(z) || 0) + 1);
      }

      // Filter out candidates that already form an edge with a and b
      const filteredCandidates: string[] = [];
      for (const [cand] of candidateCounts) {
        const testId = computeHyperedgeId([a, b, cand]);
        if (!existingTriples.has(testId)) {
          filteredCandidates.push(cand);
        }
      }

      if (filteredCandidates.length === 0) continue;

      // Limit candidates to <= 26 for Choice primitive
      const candidates = filteredCandidates.slice(0, 26);

      const state = `\u041f\u0430\u0440\u0430 \u043f\u043e\u043d\u044f\u0442\u0438\u0439 \u0432 \u0433\u0438\u043f\u0435\u0440\u0433\u0440\u0430\u0444\u0435: «${a}» \u0438 «${b}». \u0418\u0437\u0432\u0435\u0441\u0442\u043d\u044b\u0435 \u0441\u0432\u044f\u0437\u0438: ${Array.from(nA).slice(0, 4).join(', ')}.`;
      const question = `\u0423\u0447\u0438\u0442\u044b\u0432\u0430\u044f \u0441\u0432\u044f\u0437\u0438 «${a}» \u0438 «${b}» \u0432 \u0433\u0440\u0430\u0444\u0435, \u043a\u0430\u043a\u043e\u0439 \u0442\u043e\u043a\u0435\u043d \u043d\u0430\u0438\u0431\u043e\u043b\u0435\u0435 \u0432\u0435\u0440\u043e\u044f\u0442\u043d\u043e \u043e\u0431\u0440\u0430\u0437\u0443\u0435\u0442 \u0441 \u043d\u0438\u043c\u0438 \u043d\u043e\u0432\u0443\u044e \u043e\u0441\u043c\u044b\u0441\u043b\u0435\u043d\u043d\u0443\u044e \u0441\u0432\u044f\u0437\u044c?`;

      try {
        modelCalls++;
        const choiceRes = await choice(state, question, candidates, opts);
        const bestCandidate = choiceRes.id;
        const confidence = choiceRes.distribution[bestCandidate] ?? choiceRes.confidence;

        if (confidence >= this.oracleMin) {
          const triple: [string, string, string] = [a, b, bestCandidate];
          const edgeId = computeHyperedgeId(triple);

          if (!existingTriples.has(edgeId)) {
            const pendingEdge: Hyperedge = {
              id: edgeId,
              triple,
              weight: Math.round(confidence * 100) / 100,
              evidence: {
                type: 'oracle'
              },
              evidenceCount: 1,
              createdAt: new Date().toISOString(),
              tick,
              model: this.model,
              schemaVersion: this.schemaVersion,
              status: 'pending'
            };

            this.dnaEngine.upsertEdge(pendingEdge);
            existingTriples.add(edgeId);
            pendingEdges.push(pendingEdge);
          }
        }
      } catch (err: any) {
        console.warn(`[Oracle Prediction Error] on pair ${a}-${b}:`, err.message);
      }
    }

    const wallClockMs = Date.now() - startMs;

    // Record tick in ticks.jsonl
    const tickRecord: TickRecord = {
      tick,
      at: new Date().toISOString(),
      edgesAdded: 0,
      edgesPending: pendingEdges.length,
      modelCalls,
      wallClockMs
    };

    if (this.vaultPath) {
      await fsPromises.mkdir(path.dirname(this.ticksPath), { recursive: true });
      await fsPromises.appendFile(this.ticksPath, JSON.stringify(tickRecord) + '\n', 'utf-8');
      await this.dnaEngine.save();
    }

    return {
      tick,
      edgesPending: pendingEdges,
      modelCalls,
      wallClockMs
    };
  }
}
