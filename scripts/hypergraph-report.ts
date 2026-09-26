import path from 'path';
import fs from 'fs';
import { generateHypergraphReport } from '../src/server/hypergraph/report';

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
    console.error('Usage: npm run hypergraph:report -- --vault <path_to_vault>');
    process.exit(1);
  }

  try {
    const reportPath = await generateHypergraphReport(vaultPath);
    console.log(`[Hypergraph Report] Successfully generated report at: ${reportPath}`);
  } catch (err: any) {
    console.error(`[Hypergraph Report Error]: ${err.message}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
