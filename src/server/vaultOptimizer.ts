import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';

export interface ObsidianVaultOptimizationReport {
  vaultPath: string;
  ignoreFiltersConfigured: boolean;
  appliedIgnoreFilters: string[];
  snapshotsPruned: number;
  backupFilesRemoved: number;
  trashFilesRemoved: number;
  mocLinesDeduplicated: number;
  bytesFreed: number;
  remainingBackupFiles: number;
  message: string;
}

const RECOMMENDED_OBSIDIAN_IGNORE_FILTERS = [
  '99_System/',
  '99_System',
  '00_Inbox/Processed/',
  '00_Inbox/Review/'
];

async function countAndMeasureDir(dirPath: string): Promise<{ files: number; bytes: number }> {
  if (!fs.existsSync(dirPath)) return { files: 0, bytes: 0 };
  let files = 0;
  let bytes = 0;
  async function walk(current: string) {
    let entries: fs.Dirent[] = [];
    try {
      entries = await fsPromises.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) {
        await walk(full);
      } else if (ent.isFile()) {
        files++;
        try {
          const st = await fsPromises.stat(full);
          bytes += st.size;
        } catch {}
      }
    }
  }
  await walk(dirPath);
  return { files, bytes };
}

/**
 * Configures <vaultPath>/.obsidian/app.json with userIgnoreFilters so Obsidian Desktop
 * never indexes 99_System backups, logs, or hypergraph JSONL files as markdown notes/links.
 */
export async function ensureObsidianIgnoreFilters(vaultPath: string): Promise<{
  configured: boolean;
  filters: string[];
}> {
  if (!vaultPath || !fs.existsSync(vaultPath)) {
    return { configured: false, filters: [] };
  }

  const obsidianDir = path.join(vaultPath, '.obsidian');
  const appJsonPath = path.join(obsidianDir, 'app.json');

  try {
    await fsPromises.mkdir(obsidianDir, { recursive: true });
    let appConfig: Record<string, any> = {};
    if (fs.existsSync(appJsonPath)) {
      try {
        const raw = await fsPromises.readFile(appJsonPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          appConfig = parsed;
        }
      } catch {
        appConfig = {};
      }
    }

    const existingFilters = Array.isArray(appConfig.userIgnoreFilters)
      ? appConfig.userIgnoreFilters.map(String)
      : [];
    const mergedSet = new Set<string>(existingFilters);
    let changed = false;
    for (const f of RECOMMENDED_OBSIDIAN_IGNORE_FILTERS) {
      if (!mergedSet.has(f)) {
        mergedSet.add(f);
        changed = true;
      }
    }

    const updatedFilters = Array.from(mergedSet);
    if (changed || !fs.existsSync(appJsonPath)) {
      appConfig.userIgnoreFilters = updatedFilters;
      await fsPromises.writeFile(appJsonPath, JSON.stringify(appConfig, null, 2), 'utf-8');
    }

    return { configured: true, filters: updatedFilters };
  } catch {
    return { configured: false, filters: [] };
  }
}

/**
 * Rotates snapshot folders in 99_System/_refine_backup so at most `keepMax` recent sessions remain.
 * Prevents thousands of duplicate .md files from accumulating and slowing down Obsidian startup.
 */
export async function pruneOldSnapshots(
  vaultPath: string,
  keepMax: number = 1,
  protectedSessionId?: string
): Promise<{ snapshotsPruned: number; filesRemoved: number; bytesFreed: number }> {
  const backupRoot = path.join(vaultPath, '99_System', '_refine_backup');
  if (!fs.existsSync(backupRoot)) {
    return { snapshotsPruned: 0, filesRemoved: 0, bytesFreed: 0 };
  }

  let snapshotsPruned = 0;
  let filesRemoved = 0;
  let bytesFreed = 0;

  try {
    const entries = await fsPromises.readdir(backupRoot, { withFileTypes: true });
    const dirs: Array<{ name: string; fullPath: string; mtimeMs: number }> = [];
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const fullPath = path.join(backupRoot, ent.name);
      try {
        const st = await fsPromises.stat(fullPath);
        dirs.push({ name: ent.name, fullPath, mtimeMs: st.mtimeMs });
      } catch {}
    }

    // Sort newest first
    dirs.sort((a, b) => b.mtimeMs - a.mtimeMs);

    let kept = 0;
    for (const dir of dirs) {
      if (protectedSessionId && dir.name === protectedSessionId) {
        kept++;
        continue;
      }
      if (kept < keepMax) {
        kept++;
        continue;
      }
      const stats = await countAndMeasureDir(dir.fullPath);
      await fsPromises.rm(dir.fullPath, { recursive: true, force: true });
      snapshotsPruned++;
      filesRemoved += stats.files;
      bytesFreed += stats.bytes;
    }
  } catch {}

  return { snapshotsPruned, filesRemoved, bytesFreed };
}

/**
 * Deduplicates and compacts 00_MOC/moc_*.md files so Obsidian's MetadataCache link resolver
 * does not stall on tens of thousands of repeated [[wikilink]] lines.
 */
export async function deduplicateMocFiles(vaultPath: string): Promise<number> {
  const mocsDir = path.join(vaultPath, '00_MOC');
  if (!fs.existsSync(mocsDir)) return 0;

  let removedLinesCount = 0;
  try {
    const entries = await fsPromises.readdir(mocsDir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isFile() || !ent.name.toLowerCase().endsWith('.md')) continue;
      const fullPath = path.join(mocsDir, ent.name);
      try {
        const content = await fsPromises.readFile(fullPath, 'utf-8');
        const lines = content.split(/\r?\n/);
        if (lines.length <= 30) continue;

        const seenBullets = new Set<string>();
        const deduplicated: string[] = [];

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            const normKey = trimmed.toLowerCase().replace(/\s+/g, ' ');
            if (seenBullets.has(normKey)) {
              removedLinesCount++;
              continue;
            }
            seenBullets.add(normKey);
          }
          deduplicated.push(line);
        }

        if (deduplicated.length !== lines.length) {
          await fsPromises.writeFile(fullPath, deduplicated.join('\n'), 'utf-8');
        }
      } catch {}
    }
  } catch {}

  return removedLinesCount;
}

/**
 * Comprehensive Vault Optimization that eliminates the root causes of slow Obsidian initialization:
 * 1. Configures .obsidian/app.json userIgnoreFilters to ignore 99_System/ and 00_Inbox/Processed/
 * 2. Rotates/prunes accumulated snapshot backups in 99_System/_refine_backup (keeps latest keepSnapshots)
 * 3. Purges accumulated trash copies in 99_System/_trash, _duplicates_trash, _revisor_backup
 * 4. Deduplicates bloated 00_MOC/moc_*.md link indexes
 */
export async function optimizeVaultForObsidian(
  vaultPath: string,
  options: { keepSnapshots?: number } = {}
): Promise<ObsidianVaultOptimizationReport> {
  const keepSnapshots = options.keepSnapshots ?? 1;
  if (!vaultPath || !fs.existsSync(vaultPath)) {
    return {
      vaultPath: vaultPath || '',
      ignoreFiltersConfigured: false,
      appliedIgnoreFilters: [],
      snapshotsPruned: 0,
      backupFilesRemoved: 0,
      trashFilesRemoved: 0,
      mocLinesDeduplicated: 0,
      bytesFreed: 0,
      remainingBackupFiles: 0,
      message: 'Vault path not configured.'
    };
  }

  // 1. Configure .obsidian/app.json userIgnoreFilters
  const ignoreResult = await ensureObsidianIgnoreFilters(vaultPath);

  // 2. Prune old snapshots in 99_System/_refine_backup
  const snapResult = await pruneOldSnapshots(vaultPath, keepSnapshots);

  // 3. Clean accumulated system trash/backup directories inside 99_System
  let trashFilesRemoved = 0;
  let trashBytesFreed = 0;
  const trashDirs = [
    path.join(vaultPath, '99_System', '_trash'),
    path.join(vaultPath, '99_System', '_duplicates_trash'),
    path.join(vaultPath, '99_System', '_trash_empty_ghosts'),
    path.join(vaultPath, '99_System', '_revisor_backup')
  ];

  for (const tDir of trashDirs) {
    if (fs.existsSync(tDir)) {
      const stats = await countAndMeasureDir(tDir);
      if (stats.files > 0) {
        await fsPromises.rm(tDir, { recursive: true, force: true }).catch(() => {});
        trashFilesRemoved += stats.files;
        trashBytesFreed += stats.bytes;
      }
    }
  }

  // 4. Deduplicate bloated MOC files
  const mocLinesDeduplicated = await deduplicateMocFiles(vaultPath);

  // 5. Measure remaining backup files in 99_System/_refine_backup
  const remainingStats = await countAndMeasureDir(
    path.join(vaultPath, '99_System', '_refine_backup')
  );

  const totalBytesFreed = snapResult.bytesFreed + trashBytesFreed;
  const mbFreed = (totalBytesFreed / (1024 * 1024)).toFixed(2);

  return {
    vaultPath,
    ignoreFiltersConfigured: ignoreResult.configured,
    appliedIgnoreFilters: ignoreResult.filters,
    snapshotsPruned: snapResult.snapshotsPruned,
    backupFilesRemoved: snapResult.filesRemoved,
    trashFilesRemoved,
    mocLinesDeduplicated,
    bytesFreed: totalBytesFreed,
    remainingBackupFiles: remainingStats.files,
    message:
      snapResult.filesRemoved + trashFilesRemoved + mocLinesDeduplicated > 0
        ? `Optimized vault for instant Obsidian startup: removed ${
            snapResult.filesRemoved + trashFilesRemoved
          } redundant backup/trash files (${mbFreed} MB freed), deduplicated ${mocLinesDeduplicated} MOC link lines, and configured .obsidian/app.json ignore filters.`
        : `Vault is optimized for fast Obsidian startup (.obsidian/app.json ignore filters active, ${remainingStats.files} backup files in latest snapshot).`
  };
}
