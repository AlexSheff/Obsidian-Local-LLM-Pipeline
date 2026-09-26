import path from 'path';
import fs from 'fs';
const fsPromises = fs.promises;
import { parseNote } from './frontmatter';
import { routeHierarchical, HierarchicalRouterConfig } from './llm/hierarchicalRouter';
import { loadProjectsRegistry } from './projectsRegistry';

export interface CalibrationResult {
  calibrated: boolean;
  tau?: number;
  sampleSize: number;
  accuracyAtTau?: number;
  coverageAtTau?: number;
  calibratedAt?: string;
  reason?: string;
  topErrors?: Array<{ filename: string; actual: string; predicted: string; confidence: number }>;
}

export interface CalibrationOptions {
  vaultPath: string;
  sampleSize?: number;
  decisionModelUrl?: string;
  thresholdTarget?: number; // default 0.90
  customEvaluator?: (noteText: string, filename: string, title: string) => Promise<{ suggestedFolder: string; confidence: number }>;
}

/**
 * Checks whether `<vaultPath>/99_System/index/thresholds.json` exists and has `calibrated === true` (R4).
 */
export function isCalibrated(vaultPath: string): boolean {
  if (!vaultPath) return false;
  try {
    const thresholdsPath = path.join(vaultPath, '99_System', 'index', 'thresholds.json');
    if (!fs.existsSync(thresholdsPath)) return false;
    const raw = fs.readFileSync(thresholdsPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Boolean(parsed && parsed.calibrated === true);
  } catch {
    return false;
  }
}

/**
 * Enforces calibration gate when loading config on startup: if decisionMode is 'fast_routing'
 * without valid calibration, logs a warning and falls back to 'hybrid' (R4).
 */
export function applyCalibrationGateOnLoad<T extends { vaultPath: string; decisionMode?: 'hybrid' | 'fast_routing' }>(
  cfg: T,
  onWarn?: (msg: string) => void
): T {
  if (cfg.decisionMode === 'fast_routing' && !isCalibrated(cfg.vaultPath)) {
    const msg = `[Calibration Gate] decisionMode='fast_routing' requires calibrated 99_System/index/thresholds.json (calibrated: true). Reverting decisionMode to 'hybrid'.`;
    if (onWarn) onWarn(msg);
    return { ...cfg, decisionMode: 'hybrid' };
  }
  return cfg;
}

/**
 * Executes threshold calibration over organic user notes to establish an empirical confidence gate.
 * Resolves D8 and fulfills C6.
 */
export async function calibrateThreshold(options: CalibrationOptions): Promise<CalibrationResult> {
  const {
    vaultPath,
    sampleSize = 80,
    decisionModelUrl = 'http://127.0.0.1:1234',
    thresholdTarget = 0.90,
    customEvaluator
  } = options;

  if (!vaultPath || !fs.existsSync(vaultPath)) {
    throw new Error(`Vault path does not exist: ${vaultPath}`);
  }

  const projects = await loadProjectsRegistry(vaultPath);
  const routerConfig: HierarchicalRouterConfig = {
    topLevelCategories: [
      'Project',
      'Essay/Knowledge',
      'Dialogue/Transcript',
      'Poem',
      'Screenplay/Script',
      'Idea',
      'Journal/Diary',
      'Technical/Code'
    ],
    typeRoutes: {
      'Essay/Knowledge': '03_Knowledge/Essays',
      'Dialogue/Transcript': '03_Knowledge/Dialogues',
      'Poem': '03_Knowledge/Poems',
      'Screenplay/Script': '03_Knowledge/Scripts',
      'Idea': '05_Ideas/Inbox',
      'Journal/Diary': '04_Journal/Daily',
      'Technical/Code': '03_Knowledge/Technical'
    },
    projects,
    decisionModelUrl,
    threshold: 0.80
  };

  // Collect candidate notes (only notes not modified by pipeline, i.e., without ai_refined/ai_revised)
  const candidateFiles: Array<{ fullPath: string; relPath: string; folder: string; filename: string }> = [];

  async function walk(dir: string, depth = 0) {
    if (depth > 5) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const ent of entries) {
      if (ent.name.startsWith('.') || ent.name === '99_System' || ent.name === '00_Inbox' || ent.name.toLowerCase() === 'templates') {
        continue;
      }
      const full = path.join(dir, ent.name);
      const rel = path.relative(vaultPath, full).replace(/\\/g, '/');

      if (ent.isDirectory()) {
        await walk(full, depth + 1);
      } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
        const folder = path.dirname(rel) === '.' ? '' : path.dirname(rel);
        if (folder) {
          candidateFiles.push({ fullPath: full, relPath: rel, folder, filename: ent.name });
        }
      }
    }
  }

  await walk(vaultPath);

  // Filter notes that have not been revised by AI
  const cleanSampleNotes: Array<{
    filename: string;
    actualFolder: string;
    title: string;
    body: string;
  }> = [];

  for (const f of candidateFiles) {
    if (cleanSampleNotes.length >= sampleSize) break;
    try {
      const content = await fsPromises.readFile(f.fullPath, 'utf-8');
      const parsed = parseNote(content);
      if (parsed.data.ai_refined === true || parsed.data.ai_revised === true) {
        continue; // skip AI-moved files to measure ground truth
      }
      cleanSampleNotes.push({
        filename: f.filename,
        actualFolder: f.folder,
        title: (parsed.data.title as string) || f.filename.replace(/\.md$/i, ''),
        body: parsed.body
      });
    } catch {}
  }

  if (cleanSampleNotes.length === 0) {
    return {
      calibrated: false,
      sampleSize: 0,
      reason: 'No organic (non-AI-refined) markdown notes found in vault to calibrate against.'
    };
  }

  // Predict with router for each note
  const evaluationRecords: Array<{
    filename: string;
    actualFolder: string;
    predictedFolder: string;
    confidence: number;
    isMatch: boolean;
  }> = [];

  for (const sample of cleanSampleNotes) {
    try {
      let predictedFolder = '';
      let confidence = 0.5;

      if (customEvaluator) {
        const res = await customEvaluator(sample.body, sample.filename, sample.title);
        predictedFolder = res.suggestedFolder;
        confidence = res.confidence;
      } else {
        const res = await routeHierarchical(sample.body, sample.filename, sample.title, routerConfig);
        predictedFolder = res.suggestedFolder;
        confidence = res.totalConfidence;
      }

      // Check match: either exact folder match or project subfolder match
      const isMatch =
        predictedFolder.toLowerCase() === sample.actualFolder.toLowerCase() ||
        sample.actualFolder.toLowerCase().startsWith(predictedFolder.toLowerCase());

      evaluationRecords.push({
        filename: sample.filename,
        actualFolder: sample.actualFolder,
        predictedFolder,
        confidence,
        isMatch
      });
    } catch (err: any) {
      evaluationRecords.push({
        filename: sample.filename,
        actualFolder: sample.actualFolder,
        predictedFolder: 'ERROR',
        confidence: 0,
        isMatch: false
      });
    }
  }

  // Search optimal tau between 0.50 and 0.95 with step 0.02
  let bestTau: number | null = null;
  let maxCoverage = -1;
  let bestAccuracy = 0;

  for (let t = 0.50; t <= 0.95; t += 0.02) {
    const currentTau = Math.round(t * 100) / 100;
    const accepted = evaluationRecords.filter(r => r.confidence >= currentTau);
    if (accepted.length === 0) continue;

    const matches = accepted.filter(r => r.isMatch);
    const accuracy = matches.length / accepted.length;
    const coverage = accepted.length / evaluationRecords.length;

    if (accuracy >= thresholdTarget) {
      if (coverage > maxCoverage || (coverage === maxCoverage && currentTau < (bestTau || 1))) {
        maxCoverage = coverage;
        bestTau = currentTau;
        bestAccuracy = accuracy;
      }
    }
  }

  const outDir = path.join(vaultPath, '99_System', 'index');
  await fsPromises.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, 'thresholds.json');

  if (bestTau !== null) {
    const result: CalibrationResult = {
      calibrated: true,
      tau: bestTau,
      sampleSize: evaluationRecords.length,
      accuracyAtTau: Math.round(bestAccuracy * 100) / 100,
      coverageAtTau: Math.round(maxCoverage * 100) / 100,
      calibratedAt: new Date().toISOString()
    };
    await fsPromises.writeFile(outPath, JSON.stringify(result, null, 2), 'utf-8');
    return result;
  } else {
    // Record top errors
    const topErrors = evaluationRecords
      .filter(r => !r.isMatch)
      .slice(0, 5)
      .map(r => ({
        filename: r.filename,
        actual: r.actualFolder,
        predicted: r.predictedFolder,
        confidence: r.confidence
      }));

    const result: CalibrationResult = {
      calibrated: false,
      sampleSize: evaluationRecords.length,
      reason: `Target accuracy of ${Math.round(thresholdTarget * 100)}% could not be achieved at any tau threshold.`,
      topErrors
    };
    await fsPromises.writeFile(outPath, JSON.stringify(result, null, 2), 'utf-8');
    return result;
  }
}
