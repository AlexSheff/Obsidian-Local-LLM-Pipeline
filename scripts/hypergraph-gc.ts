import path from 'path';
import fs from 'fs';
import { DnaEngine } from '../src/server/hypergraph/dnaEngine';
import { TokensRegistry } from '../src/server/hypergraph/tokensRegistry';
import { HypergraphMaintenance } from '../src/server/hypergraph/maintenance';

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
    console.error('Usage: npm run hypergraph:gc -- --vault <path_to_vault>');
    process.exit(1);
  }

  console.log(`[Hypergraph GC] Running garbage collection on: ${vaultPath}`);

  const tokens = new TokensRegistry(vaultPath);
  await tokens.load();

  const dna = new DnaEngine(vaultPath);
  await dna.load();

  const maintenance = new HypergraphMaintenance(vaultPath, dna, tokens);
  const result = await maintenance.runGc();

  console.log('\n================ HYPERGRAPH GC SUCCESS ================');
  console.log(`Pruned Zero-Evidence Edges: ${result.prunedEdges}`);
  console.log(`Pruned Orphan Tokens:       ${result.prunedTokens}`);
  console.log(`Backup Snapshot Saved To:   ${result.backupPath}`);
  console.log('=======================================================\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
