import path from 'path';
import fs from 'fs';
const fsPromises = fs.promises;
import { HypergraphConfigSchema } from '../validation';
import { z } from 'zod';

export type HypergraphConfig = z.infer<typeof HypergraphConfigSchema>;

export const DEFAULT_HYPERGRAPH_CONFIG: HypergraphConfig = {
  modelFile: 'Jev-Style-Qwen3.5-2B-Decision-Q4_K_M.gguf',
  ctxSize: 4096,
  gpuLayers: 0,
  maxConcurrent: 1,
  minIntervalMs: 0,
  hybridMin: 0.6,
  maxCandidatesPerNote: 15,
  oracleMin: 0.5,
  oracleRun: 'manual',
  oracleCron: '0 3 * * *',
  maxCallsPerRun: 2000,
  maxWallClockMsPerRun: 600000,
  edgeTTLDays: 180,
  schemaVersion: 1
};

export async function loadHypergraphConfig(vaultPath: string): Promise<HypergraphConfig> {
  if (!vaultPath) return { ...DEFAULT_HYPERGRAPH_CONFIG };
  const configPath = path.join(vaultPath, '99_System', 'hypergraph', 'config.json');

  try {
    if (fs.existsSync(configPath)) {
      const raw = await fsPromises.readFile(configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      const validated = HypergraphConfigSchema.safeParse(parsed);
      if (validated.success) {
        return validated.data;
      }
    }
  } catch (err) {
    console.warn('[Hypergraph Config] Failed to read config.json, using defaults:', err);
  }

  return { ...DEFAULT_HYPERGRAPH_CONFIG };
}

export async function saveHypergraphConfig(vaultPath: string, config: Partial<HypergraphConfig>): Promise<HypergraphConfig> {
  if (!vaultPath) {
    throw new Error('Vault path required to save hypergraph config');
  }

  const current = await loadHypergraphConfig(vaultPath);
  const merged = { ...current, ...config };
  const validated = HypergraphConfigSchema.parse(merged);

  const dir = path.join(vaultPath, '99_System', 'hypergraph');
  await fsPromises.mkdir(dir, { recursive: true });
  const configPath = path.join(dir, 'config.json');
  await fsPromises.writeFile(configPath, JSON.stringify(validated, null, 2), 'utf-8');

  return validated;
}
