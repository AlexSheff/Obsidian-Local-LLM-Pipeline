import path from 'path';
import fs from 'fs';
const fsPromises = fs.promises;
import crypto from 'crypto';
import { HyperedgeSchema } from '../validation';
import { z } from 'zod';
import { noul, score, DecisionClientOptions } from './decisionClient';
import { NoteTokenExtraction } from './extractor';
import { CostTracker } from './costTracker';

export type Hyperedge = z.infer<typeof HyperedgeSchema>;

export function computeHyperedgeId(triple: [string, string, string]): string {
  const sorted = [...triple].sort();
  return crypto.createHash('sha1').update(sorted.join('|')).digest('hex');
}

export interface DnaEngineOptions {
  hybridMin?: number; // default 0.6
  maxCandidatesPerNote?: number; // default 15
  model?: string;
  schemaVersion?: number;
}

export class DnaEngine {
  private vaultPath: string;
  private edgesPath: string;
  private edges: Map<string, Hyperedge> = new Map();
  private hybridMin: number;
  private maxCandidatesPerNote: number;
  private model: string;
  private schemaVersion: number;
  private loaded = false;

  constructor(vaultPath: string, options: DnaEngineOptions = {}) {
    this.vaultPath = vaultPath;
    this.edgesPath = path.join(vaultPath, '99_System', 'hypergraph', 'edges.jsonl');
    this.hybridMin = options.hybridMin ?? 0.6;
    this.maxCandidatesPerNote = options.maxCandidatesPerNote ?? 15;
    this.model = options.model ?? 'Jev-Style-Qwen3.5-2B-Decision-Q4_K_M';
    this.schemaVersion = options.schemaVersion ?? 1;
  }

  public async load(): Promise<void> {
    if (this.loaded) return;
    this.edges.clear();

    if (this.vaultPath && fs.existsSync(this.edgesPath)) {
      try {
        const content = await fsPromises.readFile(this.edgesPath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim().length > 0);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            const validated = HyperedgeSchema.safeParse(parsed);
            if (validated.success) {
              this.edges.set(validated.data.id, validated.data);
            }
          } catch {}
        }
      } catch (err) {
        console.warn('[DnaEngine] Error loading edges.jsonl:', err);
      }
    }
    this.loaded = true;
  }

  public async save(): Promise<void> {
    if (!this.vaultPath) return;
    const dir = path.dirname(this.edgesPath);
    await fsPromises.mkdir(dir, { recursive: true });

    const lines = Array.from(this.edges.values())
      .map(e => JSON.stringify(e))
      .join('\n') + '\n';
    await fsPromises.writeFile(this.edgesPath, lines, 'utf-8');
  }

  public getEdges(status?: 'active' | 'pending' | 'rejected'): Hyperedge[] {
    const all = Array.from(this.edges.values());
    if (!status) return all;
    return all.filter(e => e.status === status);
  }

  public getEdge(id: string): Hyperedge | undefined {
    return this.edges.get(id);
  }

  public upsertEdge(edge: Hyperedge): void {
    this.edges.set(edge.id, edge);
  }

  /**
   * Applies DNA Hybridization & Selection to candidate tokens extracted from a note.
   */
  public async processNote(
    extraction: NoteTokenExtraction,
    noteText: string,
    tick: number = 0,
    costTracker?: CostTracker,
    opts?: DecisionClientOptions
  ): Promise<{ evaluated: number; created: number; updated: number }> {
    await this.load();

    let evaluated = 0;
    let created = 0;
    let updated = 0;

    // Build candidate pairs and triplets from note segments
    const candidatePairs = new Map<string, [string, string]>();
    const candidateTriplets = new Map<string, [string, string, string]>();

    for (const segment of extraction.segments) {
      if (segment.length < 2) continue;

      for (let i = 0; i < segment.length; i++) {
        for (let j = i + 1; j < segment.length; j++) {
          const a = segment[i];
          const b = segment[j];
          if (a === b) continue;
          const pairKey = [a, b].sort().join('|');
          if (!candidatePairs.has(pairKey)) {
            candidatePairs.set(pairKey, [a, b]);
          }

          // Triplet
          for (let k = j + 1; k < segment.length; k++) {
            const c = segment[k];
            if (c === a || c === b) continue;
            const tripKey = [a, b, c].sort().join('|');
            if (!candidateTriplets.has(tripKey)) {
              candidateTriplets.set(tripKey, [a, b, c]);
            }
          }
        }
      }
    }

    // Limit candidates per note to prevent combinatorial explosion (H2.5)
    const pairsToEvaluate = Array.from(candidatePairs.values()).slice(0, this.maxCandidatesPerNote);
    const tripletsToEvaluate = Array.from(candidateTriplets.values()).slice(0, Math.floor(this.maxCandidatesPerNote / 2));

    const stateSnippet = noteText.slice(0, 1000);

    // 1. Hybridization (Noul) on pairs with linker 'связано-с'
    for (const [a, b] of pairsToEvaluate) {
      if (costTracker?.isLimitExceeded()) break;

      evaluated++;
      const triple: [string, string, string] = [a, b, 'связано-с'];
      const edgeId = computeHyperedgeId(triple);
      const existing = this.edges.get(edgeId);

      const question = `Могут ли понятия «${a}» и «${b}» образовать осмысленную логическую связь?`;
      const p = await noul(stateSnippet, question, opts);

      if (p >= this.hybridMin) {
        if (existing) {
          // EMA update (alpha = 0.3)
          existing.weight = Math.round((0.3 * p + 0.7 * existing.weight) * 100) / 100;
          existing.evidenceCount += 1;
          existing.lastEvidenceAt = new Date().toISOString();
          existing.tick = tick;
          updated++;
        } else {
          const newEdge: Hyperedge = {
            id: edgeId,
            triple,
            weight: Math.round(p * 100) / 100,
            evidence: {
              type: 'cooccurrence',
              note: extraction.notePath
            },
            evidenceCount: 1,
            createdAt: new Date().toISOString(),
            lastEvidenceAt: new Date().toISOString(),
            tick,
            model: this.model,
            schemaVersion: this.schemaVersion,
            status: 'active'
          };
          this.edges.set(edgeId, newEdge);
          created++;
        }
      }
    }

    // 2. Selection (Score) on triplets (a, b, c)
    for (const [a, b, c] of tripletsToEvaluate) {
      if (costTracker?.isLimitExceeded()) break;

      evaluated++;
      const triple: [string, string, string] = [a, b, c];
      const edgeId = computeHyperedgeId(triple);
      const existing = this.edges.get(edgeId);

      const question = `Оцени семантическую силу связи «${a} — ${b} — ${c}» по шкале 1–5`;
      const scoreRating = await score(stateSnippet, question, [1, 5], opts);
      const weight = Math.round((scoreRating / 5) * 100) / 100;

      if (weight >= this.hybridMin) {
        if (existing) {
          existing.weight = Math.round((0.3 * weight + 0.7 * existing.weight) * 100) / 100;
          existing.evidenceCount += 1;
          existing.lastEvidenceAt = new Date().toISOString();
          existing.tick = tick;
          updated++;
        } else {
          const newEdge: Hyperedge = {
            id: edgeId,
            triple,
            weight,
            evidence: {
              type: 'cooccurrence',
              note: extraction.notePath
            },
            evidenceCount: 1,
            createdAt: new Date().toISOString(),
            lastEvidenceAt: new Date().toISOString(),
            tick,
            model: this.model,
            schemaVersion: this.schemaVersion,
            status: 'active'
          };
          this.edges.set(edgeId, newEdge);
          created++;
        }
      }
    }

    return { evaluated, created, updated };
  }
}
