import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';

export interface SnapshotSession {
  sessionId: string;
  backupDir: string;
  backup(filePath: string): Promise<string | null>;
  backedUpCount(): number;
}

/**
 * Creates a snapshot session for backing up files before modifications.
 * Backups are stored in 99_System/_refine_backup/<ISO-timestamp>/<relative-path>.
 */
export function createSnapshotSession(vaultPath: string, customSessionId?: string): SnapshotSession {
  // Use ISO timestamp with safe characters (replacing colons with hyphens)
  const sessionId = customSessionId || new Date().toISOString().replace(/:/g, '-');
  const backupDir = path.join(vaultPath, '99_System', '_refine_backup', sessionId);
  const backedUpFiles = new Set<string>();

  return {
    sessionId,
    backupDir,
    async backup(filePath: string): Promise<string | null> {
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
  return { restoredCount, errors };
}
