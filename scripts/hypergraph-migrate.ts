import path from 'path';
import fs from 'fs';
import { DnaEngine } from '../src/server/hypergraph/dnaEngine';
import { TokensRegistry } from '../src/server/hypergraph/tokensRegistry';
import { HypergraphMaintenance } from '../src/server/hypergraph/maintenance';
import { loadHypergraphConfig } from '../src/server/hypergraph/config';

async function main() {
  const args = process.argv.slice(2);
  let vaultPath = process.env.VAULT_PATH || '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--vault' && args[i + 1]) {
      vaultPath = args[i + 1];
      i++;
    }
  }

  if (!vaultPath) {
    console.error('Usage: npm run hypergraph:migrate -- --vault <path_to_vault>');
    process.exit(1);
  }

  const config = await loadHypergraphConfig(vaultPath);
  console.log(`[Hypergraph Migrate] Checking schema and model epochs for vault: ${vaultPath}`);

  const tokens = new TokensRegistry(vaultPath);
  await tokens.load();

  const dna = new DnaEngine(vaultPath);
  await dna.load();

  const maintenance = new HypergraphMaintenance(vaultPath, dna, tokens);

  // Sync model epoch
  const syncRes = await maintenance.syncModelEpoch(config.modelFile);
  console.log(`[Hypergraph Migrate] Model Epoch: ${syncRes.epoch}. Changed: ${syncRes.changed}. Stale edges marked: ${syncRes.staleEdgesMarked}`);

  // Apply TTL decay
  const ttlRes = await maintenance.applyTtlDecay(config.edgeTTLDays);
  console.log(`[Hypergraph Migrate] TTL Decay applied to ${ttlRes.decayedCount} edges.`);

  console.log('[Hypergraph Migrate] Migration complete. All schemas at v1.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
