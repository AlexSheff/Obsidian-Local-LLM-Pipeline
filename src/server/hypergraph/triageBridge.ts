import path from 'path';
import fs from 'fs';
const fsPromises = fs.promises;
import { DnaEngine, Hyperedge } from './dnaEngine';

export interface OracleMetrics {
  totalProposed: number;
  totalConfirmed: number;
  totalRejected: number;
  confirmationRate: number;
  oraclePaused: boolean;
  lastUpdated: string;
}

export class HypergraphTriageBridge {
  private vaultPath: string;
  private dnaEngine: DnaEngine;
  private metricsPath: string;
  private feedbackPath: string;

  constructor(vaultPath: string, dnaEngine: DnaEngine) {
    this.vaultPath = vaultPath;
    this.dnaEngine = dnaEngine;
    this.metricsPath = path.join(vaultPath, '99_System', 'hypergraph', 'oracle_metrics.json');
    this.feedbackPath = path.join(vaultPath, '99_System', 'index', 'feedback.jsonl');
  }

  public async getPendingEdges(): Promise<Hyperedge[]> {
    await this.dnaEngine.load();
    return this.dnaEngine.getEdges('pending');
  }

  public async loadMetrics(): Promise<OracleMetrics> {
    const defaults: OracleMetrics = {
      totalProposed: 0,
      totalConfirmed: 0,
      totalRejected: 0,
      confirmationRate: 1.0,
      oraclePaused: false,
      lastUpdated: new Date().toISOString()
    };

    if (this.vaultPath && fs.existsSync(this.metricsPath)) {
      try {
        const raw = await fsPromises.readFile(this.metricsPath, 'utf-8');
        return { ...defaults, ...JSON.parse(raw) };
      } catch {}
    }
    return defaults;
  }

  public async saveMetrics(metrics: OracleMetrics): Promise<void> {
    if (!this.vaultPath) return;
    await fsPromises.mkdir(path.dirname(this.metricsPath), { recursive: true });
    await fsPromises.writeFile(this.metricsPath, JSON.stringify(metrics, null, 2), 'utf-8');
  }

  /**
   * Confirms or rejects a pending hyperedge.
   */
  public async reviewEdge(
    edgeId: string,
    answer: 'yes' | 'no'
  ): Promise<{ resolved: boolean; edge?: Hyperedge; metrics: OracleMetrics }> {
    await this.dnaEngine.load();
    const edge = this.dnaEngine.getEdge(edgeId);
    if (!edge) {
      throw new Error(`Hyperedge with id "${edgeId}" not found`);
    }

    const metrics = await this.loadMetrics();
    metrics.totalProposed++;

    if (answer === 'yes') {
      edge.status = 'active';
      edge.evidence.type = 'confirmed';
      edge.weight = Math.max(edge.weight, 0.6);
      edge.lastEvidenceAt = new Date().toISOString();
      metrics.totalConfirmed++;
    } else {
      edge.status = 'rejected';
      metrics.totalRejected++;
    }

    const totalDecided = metrics.totalConfirmed + metrics.totalRejected;
    if (totalDecided > 0) {
      metrics.confirmationRate = Math.round((metrics.totalConfirmed / totalDecided) * 100) / 100;
    }

    // Auto-stop guard (H5.4): If confirmation rate falls below 30% after at least 10 reviews
    if (totalDecided >= 10 && metrics.confirmationRate < 0.30) {
      metrics.oraclePaused = true;
      console.warn(`[Hypergraph Auto-Stop Alert] Oracle confirmation rate ${metrics.confirmationRate} < 30%. Oracle auto-paused.`);
    }

    metrics.lastUpdated = new Date().toISOString();

    // Log feedback to feedback.jsonl
    if (this.vaultPath) {
      await fsPromises.mkdir(path.dirname(this.feedbackPath), { recursive: true });
      const feedbackLine = JSON.stringify({
        kind: 'hyperedge',
        edgeId: edge.id,
        triple: edge.triple,
        answer,
        pOracle: edge.weight,
        ts: new Date().toISOString()
      }) + '\n';
      await fsPromises.appendFile(this.feedbackPath, feedbackLine, 'utf-8');

      await this.saveMetrics(metrics);
      await this.dnaEngine.save();
    }

    return {
      resolved: true,
      edge,
      metrics
    };
  }
}
