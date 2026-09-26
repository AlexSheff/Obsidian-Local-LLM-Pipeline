import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { createSnapshotSession } from '../src/server/snapshot';

describe('A2: Snapshot & Backup Manager', () => {
  const testVaultDir = path.join(process.cwd(), 'tests', '_temp_vault_snapshot');

  beforeEach(async () => {
    await fsPromises.rm(testVaultDir, { recursive: true, force: true });
    await fsPromises.mkdir(testVaultDir, { recursive: true });
  });

  afterEach(async () => {
    await fsPromises.rm(testVaultDir, { recursive: true, force: true });
  });

  it('creates backup in 99_System/_refine_backup/<timestamp>/<relativePath>', async () => {
    const noteSubdir = path.join(testVaultDir, '01_Projects', 'Alpha');
    await fsPromises.mkdir(noteSubdir, { recursive: true });
    const noteFile = path.join(noteSubdir, 'Note.md');
    const noteContent = '---\ntitle: Original\ntags: [test]\n---\nOriginal body';
    await fsPromises.writeFile(noteFile, noteContent, 'utf-8');

    const session = createSnapshotSession(testVaultDir, '2026-09-21T12-00-00-000Z');
    const backupPath = await session.backup(noteFile);

    expect(backupPath).toBeTruthy();
    expect(fs.existsSync(backupPath!)).toBe(true);

    const relativeToBackup = path.relative(session.backupDir, backupPath!).replace(/\\/g, '/');
    expect(relativeToBackup).toBe('01_Projects/Alpha/Note.md');

    const backedUpContent = await fsPromises.readFile(backupPath!, 'utf-8');
    expect(backedUpContent).toBe(noteContent);
    expect(session.backedUpCount()).toBe(1);

    // Second call on the same file should return null and not re-copy
    const secondCall = await session.backup(noteFile);
    expect(secondCall).toBeNull();
    expect(session.backedUpCount()).toBe(1);
  });

  it('rejects path traversal attempts outside vault', async () => {
    const outsideFile = path.join(process.cwd(), 'package.json');
    const session = createSnapshotSession(testVaultDir, 'test-session');

    await expect(session.backup(outsideFile)).rejects.toThrow(/outside the vault/);
  });

  it('returns null for non-existent files', async () => {
    const session = createSnapshotSession(testVaultDir, 'test-session');
    const nonExistent = path.join(testVaultDir, 'NonExistent.md');
    const result = await session.backup(nonExistent);
    expect(result).toBeNull();
  });
});
