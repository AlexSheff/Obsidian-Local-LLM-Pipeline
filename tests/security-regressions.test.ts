import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
const fsPromises = fs.promises;
import {
  resolveHost,
  resolveIsDevMode,
  isInboxPathIgnored,
  isCalibrated,
  applyCalibrationGateOnLoad,
  loadConfigFromFile,
  app,
  recoverQueueState,
  setCurrentConfigForTest
} from '../server';
import { auditDirectoryProject, applyRevisionPlan } from '../src/server/directoryRevisor';
import { isPathInsideVault, isLocalEndpoint } from '../src/server/validation';
import { parseDecisionResponse } from '../src/server/decisionModel';
import { createSnapshotSession, restoreSnapshotSession } from '../src/server/snapshot';

describe('Security & P0 Regression Suite (R1 - R14)', () => {
  const tempRoot = path.join(process.cwd(), 'tests', '_temp_security_regressions');
  const testVault = path.join(tempRoot, 'vault');
  const outsideDir = path.join(tempRoot, 'outside');

  beforeEach(async () => {
    await fsPromises.rm(tempRoot, { recursive: true, force: true });
    await fsPromises.mkdir(testVault, { recursive: true });
    await fsPromises.mkdir(outsideDir, { recursive: true });
  });

  afterEach(async () => {
    await fsPromises.rm(tempRoot, { recursive: true, force: true });
  });

  it('R1: resolveHost defaults to 127.0.0.1 instead of 0.0.0.0', () => {
    expect(resolveHost({})).toBe('127.0.0.1');
    expect(resolveHost({ HOST: '192.168.1.10' })).toBe('192.168.1.10');
  });

  it('R2: resolveIsDevMode requires explicit NODE_ENV === "development"', () => {
    expect(resolveIsDevMode({})).toBe(false);
    expect(resolveIsDevMode({ NODE_ENV: undefined })).toBe(false);
    expect(resolveIsDevMode({ NODE_ENV: 'production' })).toBe(false);
    expect(resolveIsDevMode({ NODE_ENV: 'test' })).toBe(false);
    expect(resolveIsDevMode({ NODE_ENV: 'development' })).toBe(true);
  });

  it('R3: .env.example binds HOST=127.0.0.1 and does not set NODE_ENV=development', async () => {
    const envExample = await fsPromises.readFile(path.join(process.cwd(), '.env.example'), 'utf-8');
    expect(envExample).toContain('HOST=127.0.0.1');
    const activeLines = envExample
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('#'));
    expect(activeLines).not.toContain('NODE_ENV=development');
  });

  it('R4: blocks fast_routing without calibrated thresholds.json on both config load and POST /api/config', async () => {
    expect(isCalibrated(testVault)).toBe(false);

    // 1. Config load gate reverts fast_routing -> hybrid with warning
    const warnings: string[] = [];
    const tempConfigFile = path.join(tempRoot, 'config.json');
    await fsPromises.writeFile(
      tempConfigFile,
      JSON.stringify({
        vaultPath: testVault,
        llamaUrl: 'http://127.0.0.1:8080',
        timeoutSeconds: 60,
        maxContextChars: 1500,
        decisionMode: 'fast_routing'
      }),
      'utf-8'
    );

    const gated = applyCalibrationGateOnLoad(
      { vaultPath: testVault, decisionMode: 'fast_routing' as const },
      msg => warnings.push(msg)
    );
    expect(gated.decisionMode).toBe('hybrid');
    expect(warnings.length).toBe(1);

    const loadedFromFile = loadConfigFromFile(tempConfigFile);
    expect(loadedFromFile.decisionMode).toBe('hybrid');

    // 2. POST /api/config rejects fast_routing with HTTP 400 when uncalibrated
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', () => resolve()));
    try {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;

      const resUncalibrated = await fetch(`http://127.0.0.1:${port}/api/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Host: `127.0.0.1:${port}`
        },
        body: JSON.stringify({
          vaultPath: testVault,
          llamaUrl: 'http://127.0.0.1:8080',
          timeoutSeconds: 60,
          maxContextChars: 1500,
          decisionMode: 'fast_routing'
        })
      });
      expect(resUncalibrated.status).toBe(400);
      const bodyUncalibrated: any = await resUncalibrated.json();
      expect(bodyUncalibrated.error).toMatch(/not calibrated/i);

      // Now write calibrated thresholds.json and verify fast_routing is accepted
      const indexDir = path.join(testVault, '99_System', 'index');
      await fsPromises.mkdir(indexDir, { recursive: true });
      await fsPromises.writeFile(
        path.join(indexDir, 'thresholds.json'),
        JSON.stringify({ calibrated: true, tau: 0.82, sampleSize: 50 }),
        'utf-8'
      );
      expect(isCalibrated(testVault)).toBe(true);

      const resCalibrated = await fetch(`http://127.0.0.1:${port}/api/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Host: `127.0.0.1:${port}`
        },
        body: JSON.stringify({
          vaultPath: testVault,
          llamaUrl: 'http://127.0.0.1:8080',
          timeoutSeconds: 60,
          maxContextChars: 1500,
          decisionMode: 'fast_routing'
        })
      });
      expect(resCalibrated.status).toBe(200);
    } finally {
      server.close();
    }
  });

  it('R5: applyRevisionPlan rejects source paths outside vault and targetFolder with ../ traversal', async () => {
    const outsideFile = path.join(outsideDir, 'secret.md');
    await fsPromises.writeFile(outsideFile, 'Top secret content outside vault', 'utf-8');

    const insideDir = path.join(testVault, '01_Projects', 'CleanNet');
    await fsPromises.mkdir(insideDir, { recursive: true });
    const insideFile = path.join(insideDir, 'note.md');
    await fsPromises.writeFile(insideFile, 'Inside vault content', 'utf-8');

    // Attempt 1: Move or delete_junk on a file outside the vault
    const resOutside = await applyRevisionPlan({
      vaultPath: testVault,
      itemsToMove: [
        {
          filePath: outsideFile,
          targetFolder: '06_Archive',
          detectedType: 'junk',
          action: 'delete_junk'
        },
        {
          filePath: outsideFile,
          targetFolder: '03_Knowledge',
          detectedType: 'general',
          action: 'move'
        }
      ]
    });

    expect(resOutside.movedCount).toBe(0);
    expect(resOutside.deletedJunkCount).toBe(0);
    expect(resOutside.errors.length).toBe(2);
    expect(fs.existsSync(outsideFile)).toBe(true);

    // Attempt 2: Move a valid inside file to a targetFolder that traverses outside the vault (../outside)
    const resTraversal = await applyRevisionPlan({
      vaultPath: testVault,
      itemsToMove: [
        {
          filePath: insideFile,
          targetFolder: '../../outside_escape',
          detectedType: 'general',
          action: 'move'
        }
      ]
    });

    expect(resTraversal.movedCount).toBe(0);
    expect(resTraversal.errors.length).toBe(1);
    expect(fs.existsSync(insideFile)).toBe(true);
    expect(fs.existsSync(path.join(testVault, '../../outside_escape/note.md'))).toBe(false);
  });

  it('R6: auditDirectoryProject initializes selectedForMove === false for all items (outliers, junk, raw docs)', async () => {
    const projDir = path.join(testVault, '01_Projects', 'CleanNet');
    await fsPromises.mkdir(projDir, { recursive: true });

    // 1. Outlier (Scenario in CleanNet project)
    await fsPromises.writeFile(
      path.join(projDir, 'Сценарий_Фильма.md'),
      'ИНТ. КОМНАТА - НОЧЬ\nИВАН: Привет.\nМАРИЯ: Кто здесь?\nПЕТР: Это мы.',
      'utf-8'
    );
    // 2. Junk / Ghost note
    await fsPromises.writeFile(path.join(projDir, '~$temp.docx'), '', 'utf-8');
    // 3. Raw document
    await fsPromises.writeFile(path.join(projDir, 'RawNotes.txt'), 'Plain text raw document content for conversion.', 'utf-8');
    // 4. Normal coherent project note
    await fsPromises.writeFile(
      path.join(projDir, 'CleanNet_Architecture.md'),
      'Техническое описание платформы CleanNet.',
      'utf-8'
    );

    const report = await auditDirectoryProject({
      vaultPath: testVault,
      relativeDir: '01_Projects/CleanNet',
      recursive: true,
      includeNonMarkdown: true
    });

    expect(report.items.length).toBe(4);
    for (const item of report.items) {
      expect(item.selectedForMove).toBe(false);
    }
  });

  it('R7: isInboxPathIgnored checks path segments relative to inboxPath so hidden parent directories work', () => {
    const hiddenVaultInbox = path.join('/home/user/.vaults/ObsidianVault', '00_Inbox');
    const normalNote = path.join(hiddenVaultInbox, 'NewIdea.md');
    const dotFileInInbox = path.join(hiddenVaultInbox, '.DS_Store');
    const nestedHiddenInInbox = path.join(hiddenVaultInbox, '.obsidian_temp', 'cache.md');
    const reviewFile = path.join(hiddenVaultInbox, 'Review', 'Pending.md');
    const processedFile = path.join(hiddenVaultInbox, 'Processed', 'Done.md');

    expect(isInboxPathIgnored(hiddenVaultInbox, hiddenVaultInbox)).toBe(false);
    expect(isInboxPathIgnored(hiddenVaultInbox, normalNote)).toBe(false);
    expect(isInboxPathIgnored(hiddenVaultInbox, dotFileInInbox)).toBe(true);
    expect(isInboxPathIgnored(hiddenVaultInbox, nestedHiddenInInbox)).toBe(true);
    expect(isInboxPathIgnored(hiddenVaultInbox, reviewFile)).toBe(true);
    expect(isInboxPathIgnored(hiddenVaultInbox, processedFile)).toBe(true);
  });

  it('R8: package.json does not include unused html-to-text or motion packages', async () => {
    const pkgRaw = await fsPromises.readFile(path.join(process.cwd(), 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgRaw);
    const allDeps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {})
    };
    expect(allDeps['html-to-text']).toBeUndefined();
    expect(allDeps['@types/html-to-text']).toBeUndefined();
    expect(allDeps['motion']).toBeUndefined();
    expect(pkg.scripts?.dev).toContain('NODE_ENV=development');
  });

  it('R9: isPathInsideVault rejects symbolic links escaping outside vault via canonical realpath', async () => {
    const outsideFile = path.join(outsideDir, 'secret_passwords.txt');
    await fsPromises.writeFile(outsideFile, 'confidential', 'utf-8');

    // Create a symlink inside testVault pointing to outsideDir
    const symlinkInsideVault = path.join(testVault, 'escape_link');
    try {
      await fsPromises.symlink(outsideDir, symlinkInsideVault, 'dir');
    } catch {
      // If symlink creation is not permitted by environment, skip symlink creation check
      return;
    }

    // 1. Direct path through symlink to existing outside file
    const targetThroughSymlink = path.join(symlinkInsideVault, 'secret_passwords.txt');
    expect(isPathInsideVault(targetThroughSymlink, testVault)).toBe(false);

    // 2. Path through symlink to non-existing file (traversal creation attempt)
    const nonExistingThroughSymlink = path.join(symlinkInsideVault, 'new_escape.md');
    expect(isPathInsideVault(nonExistingThroughSymlink, testVault)).toBe(false);

    // 3. Normal file inside vault is allowed
    const validInside = path.join(testVault, '01_Projects', 'note.md');
    expect(isPathInsideVault(validInside, testVault)).toBe(true);
  });

  it('R10: isLocalEndpoint strictly enforces local offline endpoints and rejects remote URLs', () => {
    expect(isLocalEndpoint('http://127.0.0.1:8080')).toBe(true);
    expect(isLocalEndpoint('http://localhost:1234/v1')).toBe(true);
    expect(isLocalEndpoint('http://0.0.0.0:8000')).toBe(true);
    expect(isLocalEndpoint('http://[::1]:8080')).toBe(true);

    expect(isLocalEndpoint('https://api.openai.com/v1')).toBe(false);
    expect(isLocalEndpoint('https://generativelanguage.googleapis.com')).toBe(false);
    expect(isLocalEndpoint('http://remote-server.com:8080')).toBe(false);
    expect(isLocalEndpoint('ftp://127.0.0.1:8080')).toBe(false);
    expect(isLocalEndpoint('')).toBe(false);
    expect(isLocalEndpoint(undefined)).toBe(false);
  });

  it('R11: parseDecisionResponse never assigns artificial 100% confidence to uncalibrated or invalid model responses', () => {
    const options = ['Projects', 'Knowledge', 'Journal'];

    // 1. Completely invalid or ambiguous response -> confidence 0.0, letter '?'
    const invalidRes = parseDecisionResponse({ choices: [{ message: { content: 'I am not sure what to choose' } }] }, options);
    expect(invalidRes.confidence).toBe(0.0);
    expect(invalidRes.chosen.letter).toBe('?');
    expect(invalidRes.calibrated).toBe(false);

    // 2. Uncalibrated single-letter fallback without logprobs -> confidence capped at conservative 0.5, NEVER 1.0
    const fallbackRes = parseDecisionResponse({ choices: [{ message: { content: 'Option B' } }] }, options);
    expect(fallbackRes.chosen.letter).toBe('B');
    expect(fallbackRes.confidence).toBe(0.5);
    expect(fallbackRes.calibrated).toBe(false);
    expect(fallbackRes.confidence).toBeLessThan(1.0);

    // 3. Calibrated logprobs response with high confidence
    const calibratedRes = parseDecisionResponse({
      choices: [{
        message: { content: 'A' },
        logprobs: {
          content: [{
            top_logprobs: [
              { token: 'A', logprob: Math.log(0.92) },
              { token: 'B', logprob: Math.log(0.08) }
            ]
          }]
        }
      }]
    }, options);
    expect(calibratedRes.calibrated).toBe(true);
    expect(calibratedRes.confidence).toBeGreaterThan(0.9);
  });

  it('R12: Snapshot rollback detects conflicts and preserves newer modified files as conflict backups', async () => {
    const notePath = path.join(testVault, '01_Projects', 'roadmap.md');
    await fsPromises.mkdir(path.dirname(notePath), { recursive: true });
    await fsPromises.writeFile(notePath, '# Original Version\nCreated before session.', 'utf-8');

    // 1. Create snapshot session and back up note
    const session = createSnapshotSession(testVault, 'test_conflict_session');
    await session.backup(notePath);
    expect(session.backedUpCount()).toBe(1);

    // 2. Simulate user or process modifying the note with new edits after the snapshot
    await new Promise(r => setTimeout(r, 100));
    await fsPromises.writeFile(notePath, '# Newer User Edits\nImportant new data that must not be lost!', 'utf-8');

    // 3. Rollback the session
    const result = await restoreSnapshotSession(testVault, 'test_conflict_session');
    expect(result.restoredCount).toBe(1);
    expect(result.conflicts.length).toBe(1);

    // Verify conflict backup file was created and contains the newer edits
    const conflictBackup = result.conflicts[0].conflictBackupPath;
    expect(fs.existsSync(conflictBackup)).toBe(true);
    const savedNewerContent = await fsPromises.readFile(conflictBackup, 'utf-8');
    expect(savedNewerContent).toContain('Important new data that must not be lost!');

    // Verify restored file has the original content
    const restoredContent = await fsPromises.readFile(notePath, 'utf-8');
    expect(restoredContent).toContain('# Original Version');
  });

  it('R13: recoverQueueState restores persisted file queue tasks and retry counts after crash/restart', async () => {
    setCurrentConfigForTest({ vaultPath: testVault });
    const sysDir = path.join(testVault, '99_System');
    await fsPromises.mkdir(sysDir, { recursive: true });

    const dummyFile1 = path.join(testVault, '00_Inbox', 'doc1.md');
    const dummyFile2 = path.join(testVault, '00_Inbox', 'doc2.md');
    await fsPromises.mkdir(path.dirname(dummyFile1), { recursive: true });
    await fsPromises.writeFile(dummyFile1, 'Doc 1 content', 'utf-8');
    await fsPromises.writeFile(dummyFile2, 'Doc 2 content', 'utf-8');

    // Write persistent queue state as if saved before unexpected shutdown
    const statePath = path.join(sysDir, '_queue_state.json');
    await fsPromises.writeFile(
      statePath,
      JSON.stringify([
        { filePath: dummyFile1, retryCount: 2, addedAt: new Date().toISOString(), nextRetryAt: Date.now() + 5000 },
        { filePath: dummyFile2, retryCount: 0, addedAt: new Date().toISOString() }
      ], null, 2),
      'utf-8'
    );

    const recoveredCount = await recoverQueueState();
    expect(recoveredCount).toBe(2);
  });

  it('R14: package.json version matches documentation (v5.3)', async () => {
    const pkgRaw = await fsPromises.readFile(path.join(process.cwd(), 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgRaw);
    expect(pkg.version).toBe('5.3.0');

    const readmeRaw = await fsPromises.readFile(path.join(process.cwd(), 'README.md'), 'utf-8');
    expect(readmeRaw).toContain('v5.3');
  });
});
