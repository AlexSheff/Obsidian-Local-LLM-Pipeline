import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import crypto from 'crypto';
import { ensureObsidianIgnoreFilters, pruneOldSnapshots } from './vaultOptimizer';
import { isPathInsideVault } from './validation';

export interface SnapshotFileEntry {
  relPath: string;
  mtimeMs: number;
  size: number;
  sha256?: string;
}

export interface SnapshotSession {
  sessionId: string;
  backupDir: string;
  backup(filePath: string): Promise<string | null>;
  recordMove?(fromFilePath: string, toFilePath: string): Promise<void>;
  backedUpCount(): number;
  getManifest(): Record<string, SnapshotFileEntry>;
}

export interface RestoreResult {
  restoredCount: number;
  conflicts: Array<{ targetPath: string; conflictBackupPath: string }>;
  errors: string[];
}

async function computeSha256(filePath: string): Promise<string> {
  const content = await fsPromises.readFile(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Creates a snapshot session for backing up files before modifications.
 * Backups are stored in 99_System/_refine_backup/<ISO-timestamp>/<relative-path>.
 * Automatically configures .obsidian/app.json ignore filters and rotates older snapshots
 * so Obsidian Desktop never slows down indexing accumulated backup files.
 */
export function createSnapshotSession(vaultPath: string, customSessionId?: string): SnapshotSession {
  const sessionId = customSessionId || new Date().toISOString().replace(/:/g, '-');
  const backupDir = path.join(vaultPath, '99_System', '_refine_backup', sessionId);
  const backedUpFiles = new Set<string>();
  const fileManifest: Record<string, SnapshotFileEntry> = {};
  const movedFiles: Array<{ fromRel: string; toRel: string }> = [];
  let maintenanceTriggered = false;

  const triggerMaintenanceOnce = () => {
    if (maintenanceTriggered) return;
    maintenanceTriggered = true;
    ensureObsidianIgnoreFilters(vaultPath).catch(() => {});
    pruneOldSnapshots(vaultPath, 2, sessionId).catch(() => {});
  };

  return {
    sessionId,
    backupDir,
    async backup(filePath: string): Promise<string | null> {
      triggerMaintenanceOnce();
      const resolvedFile = path.resolve(filePath);
      const resolvedVault = path.resolve(vaultPath);

      if (backedUpFiles.has(resolvedFile)) {
        return null;
      }

      if (!fs.existsSync(resolvedFile)) {
        return null;
      }

      if (!isPathInsideVault(resolvedFile, resolvedVault)) {
        throw new Error(`Security error: ${filePath} is outside the vault`);
      }

      const relPath = path.relative(resolvedVault, resolvedFile).replace(/\\/g, '/');
      const destBackupPath = path.join(backupDir, relPath);
      await fsPromises.mkdir(path.dirname(destBackupPath), { recursive: true });

      // Atomic copy
      const tmpBackup = `${destBackupPath}.tmp.${Date.now()}`;
      await fsPromises.copyFile(resolvedFile, tmpBackup);
      await fsPromises.rename(tmpBackup, destBackupPath);

      let stat: fs.Stats;
      let sha256 = '';
      try {
        stat = await fsPromises.stat(resolvedFile);
        sha256 = await computeSha256(resolvedFile);
      } catch {
        stat = { mtimeMs: Date.now(), size: 0 } as any;
      }

      fileManifest[relPath] = {
        relPath,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        sha256
      };

      backedUpFiles.add(resolvedFile);

      // Persist manifest atomically
      const manifestPath = path.join(backupDir, '_manifest.json');
      const tmpManifest = `${manifestPath}.tmp.${Date.now()}`;
      await fsPromises.writeFile(
        tmpManifest,
        JSON.stringify(fileManifest, null, 2),
        'utf-8'
      );
      await fsPromises.rename(tmpManifest, manifestPath);

      return destBackupPath;
    },
    async recordMove(fromFilePath: string, toFilePath: string): Promise<void> {
      const resolvedVault = path.resolve(vaultPath);
      const fromRel = path.relative(resolvedVault, path.resolve(fromFilePath)).replace(/\\/g, '/');
      const toRel = path.relative(resolvedVault, path.resolve(toFilePath)).replace(/\\/g, '/');
      if (fromRel !== toRel && !fromRel.startsWith('..') && !toRel.startsWith('..')) {
        movedFiles.push({ fromRel, toRel });
        const movedManifestPath = path.join(backupDir, '_moved_manifest.json');
        const tmpMoved = `${movedManifestPath}.tmp.${Date.now()}`;
        await fsPromises.mkdir(backupDir, { recursive: true });
        await fsPromises.writeFile(
          tmpMoved,
          JSON.stringify(movedFiles, null, 2),
          'utf-8'
        );
        await fsPromises.rename(tmpMoved, movedManifestPath);
      }
    },
    backedUpCount() {
      return backedUpFiles.size;
    },
    getManifest() {
      return { ...fileManifest };
    }
  };
}

/**
 * Restores all files from a backup snapshot session back to the vault.
 * Includes conflict detection: if a destination file was modified after the snapshot,
 * creates a conflict backup (.conflict.<timestamp>.bak) before restoring so newer edits are never destroyed.
 */
export async function restoreSnapshotSession(
  vaultPath: string,
  sessionId: string
): Promise<RestoreResult> {
  const backupDir = path.join(vaultPath, '99_System', '_refine_backup', sessionId);
  if (!fs.existsSync(backupDir)) {
    throw new Error(`Backup snapshot "${sessionId}" not found.`);
  }

  const errors: string[] = [];
  const conflicts: Array<{ targetPath: string; conflictBackupPath: string }> = [];
  let restoredCount = 0;

  // Load manifest if available
  let manifest: Record<string, SnapshotFileEntry> = {};
  const manifestPath = path.join(backupDir, '_manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const rawManifest = await fsPromises.readFile(manifestPath, 'utf-8');
      manifest = JSON.parse(rawManifest);
    } catch (err: any) {
      errors.push(`Manifest corrupted in snapshot "${sessionId}": ${err.message}`);
    }
  } else {
    errors.push(`Manifest _manifest.json missing in snapshot "${sessionId}"`);
  }

  async function walkAndRestore(currentDir: string) {
    const entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '_moved_manifest.json' || entry.name === '_manifest.json') continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walkAndRestore(fullPath);
      } else if (entry.isFile()) {
        try {
          const relPath = path.relative(backupDir, fullPath).replace(/\\/g, '/');
          const targetPath = path.join(vaultPath, relPath);

          if (!isPathInsideVault(targetPath, vaultPath)) {
            errors.push(`Security error: Target path "${targetPath}" is outside vault`);
            continue;
          }

          // Conflict detection: If target file exists and content differs from snapshot
          if (fs.existsSync(targetPath)) {
            const currentHash = await computeSha256(targetPath).catch(() => '');
            const backupHash = await computeSha256(fullPath).catch(() => '');
            
            // If contents differ, protect the existing file
            if (currentHash && backupHash && currentHash !== backupHash) {
              const currentStat = await fsPromises.stat(targetPath).catch(() => ({ mtimeMs: Date.now() }));
              const recordedEntry = manifest[relPath];
              const isDifferentFromSnapshot = recordedEntry?.sha256 ? currentHash !== recordedEntry.sha256 : true;

              if (isDifferentFromSnapshot) {
                const ts = new Date().toISOString().replace(/[:.]/g, '-');
                const conflictBackupPath = `${targetPath}.conflict.${ts}.bak`;
                await fsPromises.copyFile(targetPath, conflictBackupPath);
                conflicts.push({ targetPath, conflictBackupPath });
              }
            }
          }

          await fsPromises.mkdir(path.dirname(targetPath), { recursive: true });
          const tmpRestorePath = `${targetPath}.tmp.${Date.now()}`;
          await fsPromises.copyFile(fullPath, tmpRestorePath);
          await fsPromises.rename(tmpRestorePath, targetPath);
          restoredCount++;
        } catch (e: any) {
          errors.push(`Failed restoring ${entry.name}: ${e.message}`);
        }
      }
    }
  }

  await walkAndRestore(backupDir);

  // If files were moved to a different folder during the session, handle moved copies
  const movedManifestPath = path.join(backupDir, '_moved_manifest.json');
  if (fs.existsSync(movedManifestPath)) {
    try {
      const rawMoves = await fsPromises.readFile(movedManifestPath, 'utf-8');
      const moves = JSON.parse(rawMoves);
      if (Array.isArray(moves)) {
        for (const m of moves) {
          if (m?.toRel && m?.fromRel && m.toRel !== m.fromRel) {
            const movedAbs = path.join(vaultPath, m.toRel);
            const origAbs = path.join(vaultPath, m.fromRel);
            if (fs.existsSync(movedAbs)) {
              if (fs.existsSync(origAbs)) {
                const origHash = await computeSha256(origAbs).catch(() => '');
                const movedHash = await computeSha256(movedAbs).catch(() => '');
                // If moved file was modified after move (different from restored original), save conflict backup before unlinking!
                if (origHash && movedHash && origHash !== movedHash) {
                  const ts = new Date().toISOString().replace(/[:.]/g, '-');
                  const conflictBackupPath = `${movedAbs}.conflict.${ts}.bak`;
                  await fsPromises.copyFile(movedAbs, conflictBackupPath);
                  conflicts.push({ targetPath: movedAbs, conflictBackupPath });
                }
                await fsPromises.unlink(movedAbs);
              } else {
                errors.push(`Preserving moved file "${m.toRel}" because original "${m.fromRel}" could not be confirmed.`);
              }
            }
          }
        }
      }
    } catch (moveErr: any) {
      errors.push(`Failed processing moved manifest: ${moveErr.message}`);
    }
  }

  return { restoredCount, conflicts, errors };
}
