import path from 'path';
import fs from 'fs';
const fsPromises = fs.promises;
import crypto from 'crypto';
import { DnaEngine } from './dnaEngine';
import { TokensRegistry } from './tokensRegistry';
import { createSnapshotSession } from '../snapshot';

export interface ModelManifest {
  modelFile: string;
  fileHash?: string;
  modelEpoch: number;
  registeredAt: string;
}

export class HypergraphMaintenance {
  private vaultPath: string;
  private dnaEngine: DnaEngine;
  private tokensRegistry: TokensRegistry;
  private manifestPath: string;

  constructor(vaultPath: string, dnaEngine: DnaEngine, tokensRegistry: TokensRegistry) {
    this.vaultPath = vaultPath;
    this.dnaEngine = dnaEngine;
    this.tokensRegistry = tokensRegistry;
    this.manifestPath = path.join(vaultPath, '99_System', 'hypergraph', 'model_manifest.json');
  }

  public async getModelManifest(): Promise<ModelManifest | null> {
    if (this.vaultPath && fs.existsSync(this.manifestPath)) {
      try {
        const raw = await fsPromises.readFile(this.manifestPath, 'utf-8');
        return JSON.parse(raw);
      } catch {}
    }
    return null;
  }

  /**
   * Syncs model manifest and marks edges from previous model epochs as stale (H7.2).
   */
  public async syncModelEpoch(currentModelFile: string, modelPath?: string): Promise<{ epoch: number; changed: boolean; staleEdgesMarked: number }> {
    await this.dnaEngine.load();

    let fileHash: string | undefined = undefined;
    if (modelPath && fs.existsSync(modelPath)) {
      try {
        const buf = await fsPromises.readFile(modelPath);
        fileHash = crypto.createHash('sha256').update(buf.slice(0, 1024 * 1024)).digest('hex');
      } catch {}
    }

    const prev = await this.getModelManifest();
    let epoch = prev?.modelEpoch ?? 1;
    let changed = false;
    let staleEdgesMarked = 0;

    if (!prev) {
      // First registration
      const manifest: ModelManifest = {
        modelFile: currentModelFile,
        fileHash,
        modelEpoch: 1,
        registeredAt: new Date().toISOString()
      };
      await fsPromises.mkdir(path.dirname(this.manifestPath), { recursive: true });
      await fsPromises.writeFile(this.manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
      return { epoch: 1, changed: false, staleEdgesMarked: 0 };
    }

    if (prev.modelFile !== currentModelFile || (fileHash && prev.fileHash && prev.fileHash !== fileHash)) {
      changed = true;
      epoch = prev.modelEpoch + 1;

      // Mark edges from older epoch as stale
      for (const edge of this.dnaEngine.getEdges()) {
        if (edge.model !== currentModelFile) {
          edge.stale = true;
          staleEdgesMarked++;
        }
      }

      const updatedManifest: ModelManifest = {
        modelFile: currentModelFile,
        fileHash,
        modelEpoch: epoch,
        registeredAt: new Date().toISOString()
      };
      await fsPromises.writeFile(this.manifestPath, JSON.stringify(updatedManifest, null, 2), 'utf-8');
      await this.dnaEngine.save();
    }

    return { epoch, changed, staleEdgesMarked };
  }

  /**
   * Applies edge TTL decay (H7.4):
   * If edge has no new evidence for edgeTTLDays and is not confirmed -> weight *= 0.95.
   */
  public async applyTtlDecay(edgeTTLDays = 180): Promise<{ decayedCount: number }> {
    await this.dnaEngine.load();

    const now = Date.now();
    const ttlMs = edgeTTLDays * 24 * 60 * 60 * 1000;
    let decayedCount = 0;

    for (const edge of this.dnaEngine.getEdges('active')) {
      if (edge.evidence.type === 'confirmed') continue;

      const lastDate = edge.lastEvidenceAt ? new Date(edge.lastEvidenceAt).getTime() : new Date(edge.createdAt).getTime();
      if (now - lastDate > ttlMs) {
        edge.weight = Math.round(edge.weight * 0.95 * 100) / 100;
        decayedCount++;
      }
    }

    if (decayedCount > 0) {
      await this.dnaEngine.save();
    }
    return { decayedCount };
  }

  /**
   * Garbage collection (H7.3):
   * Deletes edges with evidenceCount === 0 and deprecated orphan tokens.
   * Creates a snapshot backup in 99_System/hypergraph/_gc_backup/ before deletion.
   */
  public async runGc(): Promise<{ prunedEdges: number; prunedTokens: number; backupPath: string }> {
    await this.dnaEngine.load();
    await this.tokensRegistry.load();

    // 1. Snapshot backup
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(this.vaultPath, '99_System', 'hypergraph', '_gc_backup', dateStr);
    await fsPromises.mkdir(backupDir, { recursive: true });

    const edgesFile = path.join(this.vaultPath, '99_System', 'hypergraph', 'edges.jsonl');
    const tokensFile = path.join(this.vaultPath, '99_System', 'hypergraph', 'tokens.jsonl');

    if (fs.existsSync(edgesFile)) {
      await fsPromises.copyFile(edgesFile, path.join(backupDir, 'edges.jsonl'));
    }
    if (fs.existsSync(tokensFile)) {
      await fsPromises.copyFile(tokensFile, path.join(backupDir, 'tokens.jsonl'));
    }

    // 2. Prune edges with evidenceCount === 0
    let prunedEdges = 0;
    const remainingEdges = this.dnaEngine.getEdges().filter(e => {
      if (e.evidenceCount <= 0) {
        prunedEdges++;
        return false;
      }
      return true;
    });

    // 3. Find active tokens in remaining edges
    const activeTokenKeys = new Set<string>();
    for (const edge of remainingEdges) {
      activeTokenKeys.add(edge.triple[0]);
      activeTokenKeys.add(edge.triple[1]);
      activeTokenKeys.add(edge.triple[2]);
    }

    // Prune deprecated tokens that do not appear in any edge
    let prunedTokens = 0;
    const allTokens = this.tokensRegistry.getAll(true);
    for (const tok of allTokens) {
      if (tok.deprecated && !activeTokenKeys.has(tok.key) && tok.kind !== 'linker') {
        prunedTokens++;
        // Remove from memory
      }
    }

    // Save pruned files
    const edgesLines = remainingEdges.map(e => JSON.stringify(e)).join('\n') + '\n';
    await fsPromises.writeFile(edgesFile, edgesLines, 'utf-8');

    const cleanTokens = allTokens.filter(t => !(t.deprecated && !activeTokenKeys.has(t.key) && t.kind !== 'linker'));
    const tokensLines = cleanTokens.map(t => JSON.stringify(t)).join('\n') + '\n';
    await fsPromises.writeFile(tokensFile, tokensLines, 'utf-8');

    return {
      prunedEdges,
      prunedTokens,
      backupPath: backupDir
    };
  }
}
