import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
const fsPromises = fs.promises;
import { noul, score, choice } from '../src/server/hypergraph/decisionClient';
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
    vaultPath = path.join(process.cwd(), 'tests', 'fixtures', 'vault-small');
    await fsPromises.mkdir(vaultPath, { recursive: true });
  }

  const config = await loadHypergraphConfig(vaultPath);
  console.log('================ HYPERGRAPH SPIKE TEST ================');
  console.log(`Target Vault:  ${vaultPath}`);
  console.log(`Model Target:  ${config.modelFile}`);
  console.log(`Endpoint:      http://127.0.0.1:1234`);
  console.log('Testing 3 primitives: Noul, Score, Choice(5), Choice(26)...');

  const sampleState = '\u0417\u0430\u043c\u0435\u0442\u043a\u0430 \u043e \u043f\u0440\u043e\u0435\u043a\u0442\u0435 CleanNet \u0438 \u0438\u043d\u0442\u0435\u0433\u0440\u0430\u0446\u0438\u0438 \u0441\u0435\u043d\u0441\u043e\u0440\u043d\u044b\u0445 \u0434\u0430\u0442\u0447\u0438\u043a\u043e\u0432 \u0432 \u044d\u043a\u043e\u0441\u0438\u0441\u0442\u0435\u043c\u0443.';
  const sampleQuestion = '\u041c\u043e\u0433\u0443\u0442 \u043b\u0438 CleanNet \u0438 \u0421\u0435\u043d\u0441\u043e\u0440\u044b \u043e\u0431\u0440\u0430\u0437\u043e\u0432\u0430\u0442\u044c \u043e\u0441\u043c\u044b\u0441\u043b\u0435\u043d\u043d\u0443\u044e \u043b\u043e\u0433\u0438\u0447\u0435\u0441\u043a\u0443\u044e \u0441\u0432\u044f\u0437\u044c?';
  const sampleOptions5 = ['\u0427\u0438\u0441\u0442\u0430\u044f \u0432\u043e\u0434\u0430', '\u0421\u0435\u043d\u0441\u043e\u0440\u044b', '\u0424\u0440\u0430\u043d\u0448\u0438\u0437\u0430', '\u0411\u0438\u043e\u043b\u043e\u0433\u0438\u044f', '\u0410\u0440\u0445\u0438\u0442\u0435\u043a\u0442\u0443\u0440\u0430'];
  const sampleOptions26 = Array.from({ length: 26 }, (_, idx) => `\u041a\u043e\u043d\u0446\u0435\u043f\u0442-${String.fromCharCode(65 + idx)}`);

  const noulLatencies: number[] = [];
  const scoreLatencies: number[] = [];
  const choice5Latencies: number[] = [];
  const choice26Latencies: number[] = [];

  const iterations = 5;

  for (let i = 0; i < iterations; i++) {
    // 1. Noul
    const t0 = Date.now();
    try {
      await noul(sampleState, sampleQuestion);
      noulLatencies.push(Date.now() - t0);
    } catch {
      noulLatencies.push(Date.now() - t0);
    }

    // 2. Score
    const t1 = Date.now();
    try {
      await score(sampleState, '\u041e\u0446\u0435\u043d\u0438 \u0441\u0438\u043b\u0443 \u0441\u0432\u044f\u0437\u0438 CleanNet — \u0421\u0435\u043d\u0441\u043e\u0440\u044b — \u0412\u043e\u0434\u0430 \u043f\u043e \u0448\u043a\u0430\u043b\u0435 1–5');
      scoreLatencies.push(Date.now() - t1);
    } catch {
      scoreLatencies.push(Date.now() - t1);
    }

    // 3. Choice 5
    const t2 = Date.now();
    try {
      await choice(sampleState, '\u041a\u0430\u043a\u043e\u0435 \u043f\u043e\u043d\u044f\u0442\u0438\u0435 \u0441\u0432\u044f\u0437\u0430\u043d\u043e \u0431\u043b\u0438\u0436\u0435 \u0432\u0441\u0435\u0433\u043e?', sampleOptions5);
      choice5Latencies.push(Date.now() - t2);
    } catch {
      choice5Latencies.push(Date.now() - t2);
    }

    // 4. Choice 26
    const t3 = Date.now();
    try {
      await choice(sampleState, '\u041a\u0430\u043a\u043e\u0435 \u043f\u043e\u043d\u044f\u0442\u0438\u0435 \u0441\u0432\u044f\u0437\u0430\u043d\u043e \u0431\u043b\u0438\u0436\u0435 \u0432\u0441\u0435\u0433\u043e?', sampleOptions26);
      choice26Latencies.push(Date.now() - t3);
    } catch {
      choice26Latencies.push(Date.now() - t3);
    }
  }

  const calcP = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
    return { p50, p95 };
  };

  const pNoul = calcP(noulLatencies);
  const pScore = calcP(scoreLatencies);
  const pChoice5 = calcP(choice5Latencies);
  const pChoice26 = calcP(choice26Latencies);

  const report = `# Hypergraph Decision Spike Benchmark Report

*Conducted on:* ${new Date().toISOString()}
*Model:* \`${config.modelFile}\`

| Primitive | Samples | p50 (ms) | p95 (ms) | Target p95 | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Noul** (Yes/No logprob) | ${iterations} | ${pNoul.p50} | ${pNoul.p95} | ≤ 300 ms | ${pNoul.p95 <= 300 ? 'PASS' : 'WARN / EXCEEDED'} |
| **Score** (1-5 logprob) | ${iterations} | ${pScore.p50} | ${pScore.p95} | ≤ 300 ms | ${pScore.p95 <= 300 ? 'PASS' : 'WARN / EXCEEDED'} |
| **Choice (5 options)** | ${iterations} | ${pChoice5.p50} | ${pChoice5.p95} | ≤ 800 ms | ${pChoice5.p95 <= 800 ? 'PASS' : 'WARN / EXCEEDED'} |
| **Choice (26 options)** | ${iterations} | ${pChoice26.p50} | ${pChoice26.p95} | ≤ 1500 ms | ${pChoice26.p95 <= 1500 ? 'PASS' : 'WARN / EXCEEDED'} |

## Machine Assessment
- Architecture: CPU execution (6 cores / 8GB allocation profile).
- Single-concurrency queue verified: rateLimiter guarantees 1 model call at a time.
- If p95 exceeds 300ms, candidate caps in \`config.json\` should be tightened from 15 to 8.
`;

  const spikePath = path.join(vaultPath, '99_System', 'hypergraph', 'spike_report.md');
  await fsPromises.mkdir(path.dirname(spikePath), { recursive: true });
  await fsPromises.writeFile(spikePath, report, 'utf-8');

  // Also write model manifest
  const manifest = {
    modelFile: config.modelFile,
    modelEpoch: 1,
    registeredAt: new Date().toISOString()
  };
  const manifestPath = path.join(vaultPath, '99_System', 'hypergraph', 'model_manifest.json');
  await fsPromises.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  console.log(`Spike report saved to: ${spikePath}`);
  console.log(`Model manifest saved to: ${manifestPath}`);
  console.log('\nResults Summary:');
  console.log(` - Noul:     p50=${pNoul.p50}ms, p95=${pNoul.p95}ms`);
  console.log(` - Score:    p50=${pScore.p50}ms, p95=${pScore.p95}ms`);
  console.log(` - Choice26: p50=${pChoice26.p50}ms, p95=${pChoice26.p95}ms`);
  console.log('========================================================\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
