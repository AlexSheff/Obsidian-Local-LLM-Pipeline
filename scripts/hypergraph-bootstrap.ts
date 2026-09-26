import path from 'path';
import fs from 'fs';
const fsPromises = fs.promises;
import { TokensRegistry } from '../src/server/hypergraph/tokensRegistry';
import { NoteExtractor } from '../src/server/hypergraph/extractor';
import { DnaEngine } from '../src/server/hypergraph/dnaEngine';
import { CostTracker } from '../src/server/hypergraph/costTracker';
import { generateHypergraphReport } from '../src/server/hypergraph/report';
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
    console.error('Usage: npm run hypergraph:bootstrap -- --vault <path_to_vault>');
    process.exit(1);
  }

  if (!fs.existsSync(vaultPath)) {
    console.error(`Vault directory does not exist: ${vaultPath}`);
    process.exit(1);
  }

  const config = await loadHypergraphConfig(vaultPath);
  console.log(`[Hypergraph Bootstrap] Starting full vault indexing on: ${vaultPath}`);

  const tokensRegistry = new TokensRegistry(vaultPath);
  await tokensRegistry.load();

  const extractor = new NoteExtractor(vaultPath, tokensRegistry);
  await extractor.load();

  const dnaEngine = new DnaEngine(vaultPath, {
    hybridMin: config.hybridMin,
    maxCandidatesPerNote: config.maxCandidatesPerNote,
    model: config.modelFile,
    schemaVersion: config.schemaVersion
  });
  await dnaEngine.load();

  const costTracker = new CostTracker(vaultPath, {
    maxCallsPerRun: config.maxCallsPerRun,
    maxWallClockMsPerRun: config.maxWallClockMsPerRun
  });
  costTracker.startRun();

  // 1. Scan all markdown files
  const mdFiles: string[] = [];
  async function walk(dir: string) {
    const entries = await fsPromises.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name.startsWith('.') || ent.name === '99_System') continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(full);
      } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
        mdFiles.push(full);
      }
    }
  }

  await walk(vaultPath);
  console.log(`[Hypergraph Bootstrap] Found ${mdFiles.length} markdown notes to index.`);

  let totalExtractedTokens = 0;
  let totalEvaluatedTriples = 0;
  let totalEdgesCreated = 0;

  for (let idx = 0; idx < mdFiles.length; idx++) {
    if (costTracker.isLimitExceeded()) {
      console.warn(`[Hypergraph Bootstrap] Resource limit reached: ${costTracker.getLimitReason()}. Stopping bootstrap cleanly.`);
      break;
    }

    const file = mdFiles[idx];
    const rel = path.relative(vaultPath, file).replace(/\\/g, '/');

    try {
      const content = await fsPromises.readFile(file, 'utf-8');
      const extraction = extractor.extractFromNote(content, rel, 0);
      totalExtractedTokens += extraction.tokens.length;

      const dnaRes = await dnaEngine.processNote(extraction, content, 0, costTracker);
      totalEvaluatedTriples += dnaRes.evaluated;
      totalEdgesCreated += dnaRes.created;

      if ((idx + 1) % 10 === 0 || idx === mdFiles.length - 1) {
        console.log(`[Hypergraph Bootstrap] Processed ${idx + 1}/${mdFiles.length} notes... (${totalEdgesCreated} edges established)`);
      }
    } catch (err: any) {
      console.warn(`[Hypergraph Bootstrap] Skipping note ${rel}: ${err.message}`);
    }
  }

  costTracker.endRun();

  // Save all indices
  await tokensRegistry.save();
  await extractor.save();
  await dnaEngine.save();

  // Generate report
  const reportPath = await generateHypergraphReport(vaultPath);
  console.log('\n================ HYPERGRAPH BOOTSTRAP COMPLETE ================');
  console.log(`Total Notes Scanned:    ${mdFiles.length}`);
  console.log(`Total Tokens Indexed:   ${tokensRegistry.getAll(false).length}`);
  console.log(`Total Hyperedges Formed: ${dnaEngine.getEdges('active').length}`);
  console.log(`Report Generated at:    ${reportPath}`);
  console.log('================================================================\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
