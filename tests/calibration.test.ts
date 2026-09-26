import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
const fsPromises = fs.promises;
import { calibrateThreshold } from '../src/server/calibration';

describe('C6: Calibration Engine & Confidence Gate', () => {
  const testVault = path.join(process.cwd(), 'tests', '_temp_vault_calib');

  beforeEach(async () => {
    await fsPromises.rm(testVault, { recursive: true, force: true });
    await fsPromises.mkdir(path.join(testVault, '03_Knowledge', 'Essays'), { recursive: true });
    await fsPromises.mkdir(path.join(testVault, '03_Knowledge', 'Poems'), { recursive: true });
    await fsPromises.mkdir(path.join(testVault, '01_Projects', 'CleanNet'), { recursive: true });

    // Seed 10 essays
    for (let i = 0; i < 10; i++) {
      await fsPromises.writeFile(
        path.join(testVault, '03_Knowledge', 'Essays', `Essay_${i}.md`),
        `# Философское эссе ${i}\nСодержание глубоких размышлений о мире и технологиях.`
      );
    }
    // Seed 10 poems
    for (let i = 0; i < 10; i++) {
      await fsPromises.writeFile(
        path.join(testVault, '03_Knowledge', 'Poems', `Poem_${i}.md`),
        `# Стихотворение ${i}\nВечерний звон, как много дум наводит он.`
      );
    }
    // Seed 10 clean net project notes
    for (let i = 0; i < 10; i++) {
      await fsPromises.writeFile(
        path.join(testVault, '01_Projects', 'CleanNet', `CleanNet_Doc_${i}.md`),
        `# CleanNet Спецификация ${i}\nДокументация протокола CleanNet.`
      );
    }
  });

  afterEach(async () => {
    await fsPromises.rm(testVault, { recursive: true, force: true });
  });

  it('computes optimal tau >= 90% accuracy on consistent synthetic data', async () => {
    // Custom evaluator returning accurate predictions with varying confidence
    const evaluator = async (_text: string, filename: string) => {
      if (filename.startsWith('Essay')) {
        return { suggestedFolder: '03_Knowledge/Essays', confidence: 0.92 };
      }
      if (filename.startsWith('Poem')) {
        return { suggestedFolder: '03_Knowledge/Poems', confidence: 0.88 };
      }
      return { suggestedFolder: '01_Projects/CleanNet', confidence: 0.94 };
    };

    const res = await calibrateThreshold({
      vaultPath: testVault,
      sampleSize: 30,
      customEvaluator: evaluator
    });

    expect(res.calibrated).toBe(true);
    expect(res.tau).toBeDefined();
    expect(res.tau).toBeLessThanOrEqual(0.92);
    expect(res.accuracyAtTau).toBeGreaterThanOrEqual(0.90);
    expect(res.sampleSize).toBe(30);

    const thresholdsFile = path.join(testVault, '99_System', 'index', 'thresholds.json');
    expect(fs.existsSync(thresholdsFile)).toBe(true);
    const content = JSON.parse(await fsPromises.readFile(thresholdsFile, 'utf-8'));
    expect(content.calibrated).toBe(true);
  });

  it('returns calibrated: false when predictions are noisy/incorrect (< 90%)', async () => {
    // Custom evaluator returning noisy incorrect predictions
    const noisyEvaluator = async () => {
      return { suggestedFolder: '04_Journal/Daily', confidence: 0.95 }; // all wrong
    };

    const res = await calibrateThreshold({
      vaultPath: testVault,
      sampleSize: 30,
      customEvaluator: noisyEvaluator
    });

    expect(res.calibrated).toBe(false);
    expect(res.reason).toContain('Target accuracy');

    const thresholdsFile = path.join(testVault, '99_System', 'index', 'thresholds.json');
    expect(fs.existsSync(thresholdsFile)).toBe(true);
    const content = JSON.parse(await fsPromises.readFile(thresholdsFile, 'utf-8'));
    expect(content.calibrated).toBe(false);
  });
});
