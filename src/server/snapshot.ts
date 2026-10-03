import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { ensureObsidianIgnoreFilters, pruneOldSnapshots } from './vaultOptimizer';

export interface SnapshotSession {
  sessionId: string;
  backupDir: string;
  backup(filePath: string): Promise<string | null>;
  recordMove?(fromFilePath: string, toFilePath: string): Promise<void>;
  backedUpCount(): number;
}

/**
 * Creates a snapshot session for backing up files before modifications.
 * Backups are stored in 99_System/_refine_backup/<ISO-timestamp>/<relative-path>.
 * Automatically configures .obsidian/app.json ignore filters and rotates older snapshots
 * so Obsidian Desktop never slows down indexing accumulated backup files.
 */
export function createSnapshotSession(vaultPath: string, customSessionId?: string): SnapshotSession {
  // Use ISO timestamp with safe characters (replacing colons with hyphens)
  const sessionId = customSessionId || new Date().toISOString().replace(/:/g, '-');
  const backupDir = path.join(vaultPath, '99_System', '_refine_backup', sessionId);
  const backedUpFiles = new Set<string>();
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

      const relPath = path.relative(resolvedVault, resolvedFile);
      if (relPath.startsWith('..') || path.isAbsolute(relPath)) {
        throw new Error(`Security error: ${filePath} is outside the vault`);
      }

      const destBackupPath = path.join(backupDir, relPath);
      await fsPromises.mkdir(path.dirname(destBackupPath), { recursive: true });
      await fsPromises.copyFile(resolvedFile, destBackupPath);
      backedUpFiles.add(resolvedFile);
      return destBackupPath;
    },
    async recordMove(fromFilePath: string, toFilePath: string): Promise<void> {
      const resolvedVault = path.resolve(vaultPath);
      const fromRel = path.relative(resolvedVault, path.resolve(fromFilePath)).replace(/\\/g, '/');
      const toRel = path.relative(resolvedVault, path.resolve(toFilePath)).replace(/\\/g, '/');
      if (fromRel !== toRel && !fromRel.startsWith('..') && !toRel.startsWith('..')) {
        movedFiles.push({ fromRel, toRel });
        try {
          await fsPromises.mkdir(backupDir, { recursive: true });
          await fsPromises.writeFile(
            path.join(backupDir, '_moved_manifest.json'),
            JSON.stringify(movedFiles, null, 2),
            'utf-8'
          );
        } catch {}
      }
    },
    backedUpCount() {
      return backedUpFiles.size;
    }
  };
}

/**
 * Restores all files from a backup snapshot session back to the vault.
 */
export async function restoreSnapshotSession(
  vaultPath: string,
  sessionId: string
): Promise<{ restoredCount: number; errors: string[] }> {
  const backupDir = path.join(vaultPath, '99_System', '_refine_backup', sessionId);
  if (!fs.existsSync(backupDir)) {
    throw new Error(`Backup snapshot "${sessionId}" not found.`);
  }

  const errors: string[] = [];
  let restoredCount = 0;

  async function walkAndRestore(currentDir: string) {
    const entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '_moved_manifest.json') continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walkAndRestore(fullPath);
      } else if (entry.isFile()) {
        try {
          const relPath = path.relative(backupDir, fullPath);
          const targetPath = path.join(vaultPath, relPath);
          await fsPromises.mkdir(path.dirname(targetPath), { recursive: true });
          await fsPromises.copyFile(fullPath, targetPath);
          restoredCount++;
        } catch (e: any) {
          errors.push(`Failed restoring ${entry.name}: ${e.message}`);
        }
      }
    }
  }

  await walkAndRestore(backupDir);

  // If files were moved to a different folder during the session, remove the moved copies
  const manifestPath = path.join(backupDir, '_moved_manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const moves = JSON.parse(await fsPromises.readFile(manifestPath, 'utf-8'));
      if (Array.isArray(moves)) {
        for (const m of moves) {
          if (m?.toRel && m?.fromRel && m.toRel !== m.fromRel) {
            const movedAbs = path.join(vaultPath, m.toRel);
            const origAbs = path.join(vaultPath, m.fromRel);
            if (fs.existsSync(movedAbs) && fs.existsSync(origAbs)) {
              await fsPromises.unlink(movedAbs).catch(() => {});
            }
          }
        }
      }
    } catch {}
  }

  return { restoredCount, errors };
}
