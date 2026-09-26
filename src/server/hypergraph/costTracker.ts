import path from 'path';
import fs from 'fs';
const fsPromises = fs.promises;
import { PrimitiveType, setPrimitiveCallHook } from './decisionClient';

export interface CostRecord {
  primitive: PrimitiveType;
  promptTokens: number;
  wallClockMs: number;
  ts: string;
}

export interface RunLimits {
  maxCallsPerRun: number;
  maxWallClockMsPerRun: number;
}

export interface LatencyStats {
  count: number;
  totalMs: number;
  p50Ms: number;
  p95Ms: number;
}

export class CostTracker {
  private vaultPath: string;
  private logPath: string;
  private records: CostRecord[] = [];
  private currentRunCalls = 0;
  private currentRunStartMs = Date.now();
  private limits: RunLimits;
  private limitExceededReason: string | null = null;
  private benchmarkP95: Record<PrimitiveType, number> = {
    noul: 300,
    score: 300,
    choice: 1500
  };

  constructor(vaultPath: string, limits: RunLimits = { maxCallsPerRun: 2000, maxWallClockMsPerRun: 600000 }) {
    this.vaultPath = vaultPath;
    this.logPath = path.join(vaultPath, '99_System', 'hypergraph', 'cost_log.jsonl');
    this.limits = limits;
  }

  public startRun(): void {
    this.currentRunCalls = 0;
    this.currentRunStartMs = Date.now();
    this.limitExceededReason = null;

    setPrimitiveCallHook((primitive, tokens, ms) => {
      this.recordCall(primitive, tokens, ms);
    });
  }

  public endRun(): void {
    setPrimitiveCallHook(null);
  }

  public setBenchmark(benchmarks: Partial<Record<PrimitiveType, number>>): void {
    this.benchmarkP95 = { ...this.benchmarkP95, ...benchmarks };
  }

  public recordCall(primitive: PrimitiveType, promptTokens: number, wallClockMs: number): void {
    this.currentRunCalls++;
    const record: CostRecord = {
      primitive,
      promptTokens,
      wallClockMs,
      ts: new Date().toISOString()
    };
    this.records.push(record);

    // Check limits
    if (this.currentRunCalls > this.limits.maxCallsPerRun) {
      this.limitExceededReason = `Call limit of ${this.limits.maxCallsPerRun} calls exceeded`;
    }
    const elapsed = Date.now() - this.currentRunStartMs;
    if (elapsed > this.limits.maxWallClockMsPerRun) {
      this.limitExceededReason = `Time limit of ${Math.round(this.limits.maxWallClockMsPerRun / 1000)}s exceeded`;
    }

    // Check drift against benchmark
    const bench = this.benchmarkP95[primitive];
    if (bench && wallClockMs > bench * 2) {
      console.warn(`[Hypergraph CostTracker Alert] ${primitive} latency ${wallClockMs}ms exceeds 2x benchmark (${bench}ms)`);
    }

    // Append to file asynchronously
    if (this.vaultPath) {
      const line = JSON.stringify(record) + '\n';
      fsPromises.mkdir(path.dirname(this.logPath), { recursive: true })
        .then(() => fsPromises.appendFile(this.logPath, line, 'utf-8'))
        .catch(() => {});
    }
  }

  public isLimitExceeded(): boolean {
    return this.limitExceededReason !== null;
  }

  public getLimitReason(): string | null {
    return this.limitExceededReason;
  }

  public getStats(forRecords?: CostRecord[]): Record<PrimitiveType, LatencyStats> & { totalCalls: number; totalWallClockMs: number } {
    const list = forRecords || this.records;
    const byPrim: Record<PrimitiveType, number[]> = {
      noul: [],
      score: [],
      choice: []
    };

    let totalWallClockMs = 0;
    for (const r of list) {
      byPrim[r.primitive]?.push(r.wallClockMs);
      totalWallClockMs += r.wallClockMs;
    }

    const calcStats = (latencies: number[]): LatencyStats => {
      if (latencies.length === 0) return { count: 0, totalMs: 0, p50Ms: 0, p95Ms: 0 };
      const sorted = [...latencies].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.50)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      const total = sorted.reduce((sum, v) => sum + v, 0);
      return { count: sorted.length, totalMs: total, p50Ms: p50, p95Ms: p95 };
    };

    return {
      noul: calcStats(byPrim.noul),
      score: calcStats(byPrim.score),
      choice: calcStats(byPrim.choice),
      totalCalls: list.length,
      totalWallClockMs
    };
  }

  public async loadAllRecords(): Promise<CostRecord[]> {
    if (!this.vaultPath || !fs.existsSync(this.logPath)) return [];
    try {
      const content = await fsPromises.readFile(this.logPath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim().length > 0);
      return lines.map(l => JSON.parse(l)).filter(Boolean);
    } catch {
      return [];
    }
  }
}
