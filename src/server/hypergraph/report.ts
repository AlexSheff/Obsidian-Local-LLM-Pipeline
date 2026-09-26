import path from 'path';
import fs from 'fs';
const fsPromises = fs.promises;
import { DnaEngine } from './dnaEngine';
import { TokensRegistry } from './tokensRegistry';
import { CostTracker } from './costTracker';
import { HypergraphTriageBridge } from './triageBridge';

export async function generateHypergraphReport(vaultPath: string): Promise<string> {
  if (!vaultPath) throw new Error('Vault path required for report generation');

  const tokensRegistry = new TokensRegistry(vaultPath);
  await tokensRegistry.load();

  const dnaEngine = new DnaEngine(vaultPath);
  await dnaEngine.load();

  const costTracker = new CostTracker(vaultPath);
  const costRecords = await costTracker.loadAllRecords();
  const stats = costTracker.getStats(costRecords);

  const triageBridge = new HypergraphTriageBridge(vaultPath, dnaEngine);
  const oracleMetrics = await triageBridge.loadMetrics();

  const activeTokens = tokensRegistry.getAll(false);
  const deprecatedTokens = tokensRegistry.getAll(true).filter(t => t.deprecated);
  const activeEdges = dnaEngine.getEdges('active');
  const pendingEdges = dnaEngine.getEdges('pending');
  const rejectedEdges = dnaEngine.getEdges('rejected');

  // Top-20 edges by weight
  const topEdges = [...activeEdges]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 20);

  const topEdgesMarkdown = topEdges.map((e, idx) => {
    return `${idx + 1}. **[${e.triple.join(' — ')}]** (weight: \`${e.weight}\`, evidence: \`${e.evidence.type}\`, count: \`${e.evidenceCount}\`)`;
  }).join('\n');

  const reportContent = `# Dynamic Semantic Hypergraph (DSH) — Status Report

*Generated at: ${new Date().toISOString()}*

---

## 1. Graph Dimensions & Topology

- **Total Active Tokens:** ${activeTokens.length} (Deprecated: ${deprecatedTokens.length})
- **Total Hyperedges:** ${activeEdges.length + pendingEdges.length + rejectedEdges.length}
  - **Active Edges:** ${activeEdges.length}
  - **Pending Oracle Predictions:** ${pendingEdges.length}
  - **Rejected Edges:** ${rejectedEdges.length}

---

## 2. Decision Model Resource & Latency Metrics

- **Total Decision Primitive Calls:** ${stats.totalCalls}
- **Total Decision Execution Time:** ${(stats.totalWallClockMs / 1000).toFixed(2)}s

| Primitive | Call Count | p50 Latency | p95 Latency | Total Time |
| :--- | :--- | :--- | :--- | :--- |
| **Noul** (Hybridization) | ${stats.noul.count} | ${stats.noul.p50Ms} ms | ${stats.noul.p95Ms} ms | ${(stats.noul.totalMs / 1000).toFixed(2)}s |
| **Score** (Selection) | ${stats.score.count} | ${stats.score.p50Ms} ms | ${stats.score.p95Ms} ms | ${(stats.score.totalMs / 1000).toFixed(2)}s |
| **Choice** (Oracle) | ${stats.choice.count} | ${stats.choice.p50Ms} ms | ${stats.choice.p95Ms} ms | ${(stats.choice.totalMs / 1000).toFixed(2)}s |

---

## 3. Oracle Quality & Calibration

- **Total Forecasts Proposed:** ${oracleMetrics.totalProposed}
- **Confirmed by User:** ${oracleMetrics.totalConfirmed}
- **Rejected by User:** ${oracleMetrics.totalRejected}
- **Confirmation Rate:** ${Math.round(oracleMetrics.confirmationRate * 100)}%
- **Oracle Status:** ${oracleMetrics.oraclePaused ? '⚠️ PAUSED (Confirmation rate < 30%)' : '✅ ACTIVE'}

---

## 4. Top-20 Semantic Hyperedges (Strongest Triples)

${topEdgesMarkdown || '*No hyperedges constructed yet. Run `npm run hypergraph:bootstrap` to initialize.*'}
`;

  const reportPath = path.join(vaultPath, '99_System', 'hypergraph', '_Report.md');
  await fsPromises.mkdir(path.dirname(reportPath), { recursive: true });
  await fsPromises.writeFile(reportPath, reportContent, 'utf-8');

  return reportPath;
}
