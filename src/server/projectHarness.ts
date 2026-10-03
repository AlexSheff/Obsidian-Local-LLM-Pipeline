import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { parseNote, serializeNote } from './frontmatter';
import {
  ProjectTagProfile,
  TaxonomyAxisDefinition,
  inferProjectFromNoteAndTaxonomy,
  curateOrthogonalTags,
  normalizeToCanonicalTag,
  sanitizeTagList
} from './tags';
import { ProjectDefinition } from './projectsRegistry';
import { ensureLanguageTags } from './language';
import { createSnapshotSession } from './snapshot';
import { pruneEmptyParentDirs } from './directoryRevisor';
import { isPathInsideVault } from './validation';

export interface ProjectHarnessTask {
  id: string;
  text: string;
  completed: boolean;
  notePath: string;
  noteTitle: string;
  lineIndex: number;
}

export interface ProjectHarnessArtifact {
  path: string;
  filename: string;
  title: string;
  role: 'spec' | 'roadmap' | 'architecture' | 'script' | 'research' | 'note';
  currentFolder: string;
  targetFolder: string;
  needsRouting: boolean;
  tags: string[];
  modifiedTime: string;
}

export interface ProjectHarnessItem {
  id: string;
  projectTag: string;
  targetFolder: string;
  associatedTags: string[];
  aliases: string[];
  status: 'active' | 'in-progress' | 'planning' | 'completed' | 'idle';
  momentumScore: number;
  totalDocsCount: number;
  inFolderDocsCount: number;
  scatteredDocsCount: number;
  openTasksCount: number;
  completedTasksCount: number;
  openTasks: ProjectHarnessTask[];
  completedTasks: ProjectHarnessTask[];
  artifacts: ProjectHarnessArtifact[];
  lastUpdated: string | null;
}

export interface ProjectHarnessReport {
  projects: ProjectHarnessItem[];
  totalProjects: number;
  totalProjectDocs: number;
  totalScatteredDocs: number;
  totalOpenTasks: number;
  totalCompletedTasks: number;
  dashboardPath: string;
}

export interface HarnessRawNote {
  path: string;
  filename: string;
  title: string;
  body: string;
  folder: string;
  tags: string[];
  frontmatterProject?: string;
  modifiedTime: string;
}

function classifyArtifactRole(
  title: string,
  filename: string,
  body: string,
  tags: string[]
): ProjectHarnessArtifact['role'] {
  const lower = `${title} ${filename} ${tags.join(' ')} ${body.slice(0, 500)}`.toLowerCase();
  if (/roadmap|дорожн|план развит|milestone|q[1-4]|этап/i.test(lower)) return 'roadmap';
  if (/architect|архитектур|system design|протокол|protocol/i.test(lower)) return 'architecture';
  if (/spec|спек|тз|техническое задание|prd/i.test(lower)) return 'spec';
  if (/script|сценари|эпизод|episode|dialogue|диалог|world-1149|arg/i.test(lower)) return 'script';
  if (/research|исследован|анализ|benchmark|hypothesis|гипотез/i.test(lower)) return 'research';
  return 'note';
}

export function extractTasksFromMarkdown(
  body: string,
  notePath: string,
  noteTitle: string
): { openTasks: ProjectHarnessTask[]; completedTasks: ProjectHarnessTask[] } {
  const openTasks: ProjectHarnessTask[] = [];
  const completedTasks: ProjectHarnessTask[] = [];
  const lines = body.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 1. Standard Markdown checkboxes: - [ ] or * [ ] or - [x]
    const checkboxMatch = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/);
    if (checkboxMatch) {
      const isDone = checkboxMatch[1].toLowerCase() === 'x';
      const cleanText = checkboxMatch[2].trim();
      if (cleanText.length >= 2) {
        const task: ProjectHarnessTask = {
          id: `${notePath}:${i}`,
          text: cleanText,
          completed: isDone,
          notePath,
          noteTitle,
          lineIndex: i
        };
        if (isDone) completedTasks.push(task);
        else openTasks.push(task);
      }
      continue;
    }

    // 2. Explicit inline action markers: TODO:, NEXT:, ЗАДАЧА:, ДЕЙСТВИЕ:
    const todoMatch = line.match(/^\s*(?:[-*+]\s+)?(?:TODO|NEXT|ACTION|ЗАДАЧА|ДЕЙСТВИЕ)\s*:\s*(.+)$/i);
    if (todoMatch) {
      const cleanText = todoMatch[1].trim();
      if (cleanText.length >= 3) {
        openTasks.push({
          id: `${notePath}:${i}`,
          text: cleanText,
          completed: false,
          notePath,
          noteTitle,
          lineIndex: i
        });
      }
    }
  }

  return { openTasks, completedTasks };
}

export function buildProjectTrackingHarness(params: {
  notes: HarnessRawNote[];
  projectProfiles: ProjectTagProfile[];
  discoveredProjects: ProjectDefinition[];
  axes?: TaxonomyAxisDefinition[];
  projectsRoot?: string;
}): ProjectHarnessReport {
  const {
    notes,
    projectProfiles,
    discoveredProjects,
    axes,
    projectsRoot = '01_Projects'
  } = params;

  // Build unified map of projects from both projectProfiles and discoveredProjects
  const unifiedProfiles = new Map<string, ProjectTagProfile>();
  for (const prof of projectProfiles) {
    const cleanTag = normalizeToCanonicalTag(prof.projectTag || prof.id);
    if (!cleanTag) continue;
    unifiedProfiles.set(cleanTag.toLowerCase(), {
      ...prof,
      id: cleanTag,
      projectTag: cleanTag,
      targetFolder: (prof.targetFolder || `${projectsRoot}/${cleanTag}`).replace(/\\/g, '/'),
      associatedTags: prof.associatedTags
        .map(t => normalizeToCanonicalTag(t))
        .filter(Boolean)
    });
  }

  for (const disc of discoveredProjects) {
    const cleanTag = normalizeToCanonicalTag(disc.id);
    if (!cleanTag) continue;
    const key = cleanTag.toLowerCase();
    if (!unifiedProfiles.has(key)) {
      unifiedProfiles.set(key, {
        id: cleanTag,
        projectTag: cleanTag,
        targetFolder: disc.folder.replace(/\\/g, '/'),
        associatedTags: [cleanTag],
        aliases: disc.aliases || [cleanTag]
      });
    }
  }

  // Group notes by matched project
  const projectNotesMap = new Map<string, HarnessRawNote[]>();
  for (const key of unifiedProfiles.keys()) {
    projectNotesMap.set(key, []);
  }

  for (const note of notes) {
    if (note.path.startsWith('00_MOC/') || note.filename === '_Project_Harness.md') {
      continue;
    }

    let matchedKey: string | null = null;

    // 1. Check explicit frontmatter project link: project: "[[Hermes]]"
    if (note.frontmatterProject) {
      const cleanedFmProj = normalizeToCanonicalTag(
        String(note.frontmatterProject).replace(/^\[\[|\]\]$/g, '')
      ).toLowerCase();
      if (unifiedProfiles.has(cleanedFmProj)) {
        matchedKey = cleanedFmProj;
      }
    }

    // 2. Check if note is already inside a project's targetFolder
    if (!matchedKey) {
      const normFolder = (note.folder || '').replace(/\\/g, '/').toLowerCase();
      for (const [key, prof] of unifiedProfiles.entries()) {
        const profFolder = prof.targetFolder.toLowerCase();
        if (normFolder === profFolder || normFolder.startsWith(profFolder + '/')) {
          matchedKey = key;
          break;
        }
      }
    }

    // 3. Check inferProjectFromNoteAndTaxonomy (tags, aliases, concepts)
    if (!matchedKey) {
      const inference = inferProjectFromNoteAndTaxonomy({
        filename: note.filename,
        title: note.title,
        body: note.body,
        existingTags: note.tags,
        folder: note.folder,
        discoveredProjects,
        projectProfiles: Array.from(unifiedProfiles.values()),
        projectsRoot
      });
      if (inference.matchedProfile) {
        const key = normalizeToCanonicalTag(inference.matchedProfile.projectTag).toLowerCase();
        if (unifiedProfiles.has(key)) {
          matchedKey = key;
        }
      }
    }

    if (matchedKey && projectNotesMap.has(matchedKey)) {
      projectNotesMap.get(matchedKey)!.push(note);
    }
  }

  const harnessItems: ProjectHarnessItem[] = [];
  let totalProjectDocs = 0;
  let totalScatteredDocs = 0;
  let totalOpenTasks = 0;
  let totalCompletedTasks = 0;

  for (const [key, prof] of unifiedProfiles.entries()) {
    const memberNotes = projectNotesMap.get(key) || [];
    const openTasks: ProjectHarnessTask[] = [];
    const completedTasks: ProjectHarnessTask[] = [];
    const artifacts: ProjectHarnessArtifact[] = [];
    let inFolderDocsCount = 0;
    let scatteredDocsCount = 0;
    let latestMs = 0;

    const targetFolderLower = prof.targetFolder.replace(/\\/g, '/').toLowerCase();

    for (const n of memberNotes) {
      const mtimeMs = new Date(n.modifiedTime || 0).getTime();
      if (mtimeMs > latestMs) latestMs = mtimeMs;

      const normCurrent = (n.folder || '').replace(/\\/g, '/').toLowerCase();
      const isInsideTarget =
        normCurrent === targetFolderLower || normCurrent.startsWith(targetFolderLower + '/');

      if (isInsideTarget) {
        inFolderDocsCount++;
      } else {
        scatteredDocsCount++;
      }

      const curatedTags = curateOrthogonalTags({
        rawTags: [...n.tags, prof.projectTag],
        title: n.title,
        filename: n.filename,
        body: n.body,
        folder: prof.targetFolder,
        discoveredProjects,
        projectProfiles: Array.from(unifiedProfiles.values()),
        customAxes: axes,
        replaceExisting: false,
        maxTags: 8
      });

      const tasks = extractTasksFromMarkdown(n.body, n.path, n.title);
      openTasks.push(...tasks.openTasks);
      completedTasks.push(...tasks.completedTasks);

      artifacts.push({
        path: n.path,
        filename: n.filename,
        title: n.title,
        role: classifyArtifactRole(n.title, n.filename, n.body, curatedTags),
        currentFolder: n.folder || 'Root',
        targetFolder: prof.targetFolder,
        needsRouting: !isInsideTarget,
        tags: curatedTags,
        modifiedTime: n.modifiedTime
      });
    }

    // Sort artifacts: misplaced first, then specs/roadmaps/architecture, then by modifiedTime
    artifacts.sort((a, b) => {
      if (a.needsRouting !== b.needsRouting) return a.needsRouting ? -1 : 1;
      return new Date(b.modifiedTime || 0).getTime() - new Date(a.modifiedTime || 0).getTime();
    });

    // Determine project status
    let status: ProjectHarnessItem['status'] = 'idle';
    if (memberNotes.length > 0) {
      const allTagsLower = new Set(
        artifacts.flatMap(a => a.tags.map(t => t.toLowerCase()))
      );
      if (openTasks.length > 0 || allTagsLower.has('in-progress')) {
        status = 'in-progress';
      } else if (allTagsLower.has('active') || inFolderDocsCount > 0) {
        status = 'active';
      } else if (allTagsLower.has('draft') || allTagsLower.has('backlog')) {
        status = 'planning';
      } else if (allTagsLower.has('completed') && openTasks.length === 0) {
        status = 'completed';
      } else {
        status = 'active';
      }
    }

    // Momentum score (0..100)
    const docFactor = Math.min(45, memberNotes.length * 15);
    const orgFactor =
      memberNotes.length > 0
        ? Math.round((inFolderDocsCount / memberNotes.length) * 30)
        : 0;
    const taskFactor =
      openTasks.length + completedTasks.length > 0
        ? Math.min(25, 10 + completedTasks.length * 5 + openTasks.length * 3)
        : memberNotes.length > 0
        ? 15
        : 0;
    const momentumScore = Math.min(100, docFactor + orgFactor + taskFactor);

    totalProjectDocs += memberNotes.length;
    totalScatteredDocs += scatteredDocsCount;
    totalOpenTasks += openTasks.length;
    totalCompletedTasks += completedTasks.length;

    harnessItems.push({
      id: prof.id,
      projectTag: prof.projectTag,
      targetFolder: prof.targetFolder,
      associatedTags: prof.associatedTags,
      aliases: prof.aliases,
      status,
      momentumScore,
      totalDocsCount: memberNotes.length,
      inFolderDocsCount,
      scatteredDocsCount,
      openTasksCount: openTasks.length,
      completedTasksCount: completedTasks.length,
      openTasks,
      completedTasks,
      artifacts,
      lastUpdated: latestMs > 0 ? new Date(latestMs).toISOString() : null
    });
  }

  harnessItems.sort((a, b) => {
    if (b.totalDocsCount !== a.totalDocsCount) return b.totalDocsCount - a.totalDocsCount;
    return a.projectTag.localeCompare(b.projectTag);
  });

  return {
    projects: harnessItems,
    totalProjects: harnessItems.length,
    totalProjectDocs,
    totalScatteredDocs,
    totalOpenTasks,
    totalCompletedTasks,
    dashboardPath: '00_MOC/Project_Harness_Dashboard.md'
  };
}

/**
 * Toggles a Markdown checkbox (- [ ] <-> - [x]) inside a vault note on disk.
 */
export async function toggleProjectTaskInVault(
  vaultPath: string,
  notePath: string,
  lineIndex: number
): Promise<{ success: boolean; completed: boolean }> {
  const fullPath = path.join(vaultPath, notePath);
  if (!isPathInsideVault(fullPath, vaultPath, false) || !fs.existsSync(fullPath)) {
    throw new Error('Target note not found inside vault');
  }

  const raw = await fsPromises.readFile(fullPath, 'utf-8');
  const parsed = parseNote(raw);
  const lines = parsed.body.split(/\r?\n/);

  if (lineIndex < 0 || lineIndex >= lines.length) {
    throw new Error('Task line index out of range');
  }

  const line = lines[lineIndex];
  const checkboxMatch = line.match(/^(\s*[-*+]\s+\[)([ xX])(\]\s+.+)$/);
  if (checkboxMatch) {
    const currentlyDone = checkboxMatch[2].toLowerCase() === 'x';
    const nextChar = currentlyDone ? ' ' : 'x';
    lines[lineIndex] = `${checkboxMatch[1]}${nextChar}${checkboxMatch[3]}`;
    await fsPromises.writeFile(fullPath, serializeNote(parsed.data, lines.join('\n')), 'utf-8');
    return { success: true, completed: !currentlyDone };
  }

  // If it was a TODO: line, convert it into a completed checkbox - [x]
  const todoMatch = line.match(/^(\s*)(?:[-*+]\s+)?(?:TODO|NEXT|ACTION|ЗАДАЧА|ДЕЙСТВИЕ)\s*:\s*(.+)$/i);
  if (todoMatch) {
    lines[lineIndex] = `${todoMatch[1]}- [x] ${todoMatch[2]}`;
    await fsPromises.writeFile(fullPath, serializeNote(parsed.data, lines.join('\n')), 'utf-8');
    return { success: true, completed: true };
  }

  throw new Error('Line is not a toggleable task');
}

/**
 * Synchronizes the Project Tracking Harness with the Obsidian Vault:
 * 1. Optionally routes scattered project notes into their target project folders and applies clean #tags
 * 2. Generates 00_MOC/Project_Harness_Dashboard.md with live project statuses, tasks, and [[wikilinks]]
 */
export async function syncProjectHarnessToVault(params: {
  vaultPath: string;
  report: ProjectHarnessReport;
  projectId?: string;
  routeScattered?: boolean;
}): Promise<{
  routedCount: number;
  taggedCount: number;
  dashboardPath: string;
  snapshotId: string | null;
}> {
  const { vaultPath, report, projectId, routeScattered = true } = params;
  const targetProjects = projectId
    ? report.projects.filter(p => p.id.toLowerCase() === projectId.toLowerCase())
    : report.projects;

  const snapshot = createSnapshotSession(
    vaultPath,
    `project_harness_${new Date().toISOString().replace(/[:.]/g, '-')}`
  );

  let routedCount = 0;
  let taggedCount = 0;
  const affectedDirs = new Set<string>();

  for (const proj of targetProjects) {
    for (const art of proj.artifacts) {
      const fullPath = path.join(vaultPath, art.path);
      if (!isPathInsideVault(fullPath, vaultPath, false) || !fs.existsSync(fullPath)) continue;

      try {
        const raw = await fsPromises.readFile(fullPath, 'utf-8');
        const parsed = parseNote(raw);
        await snapshot.backup(fullPath);

        const finalTags = ensureLanguageTags(
          sanitizeTagList([...art.tags, proj.projectTag], { allowSingleLetter: false }),
          parsed.body,
          art.filename
        );
        parsed.data.tags = finalTags;
        parsed.data.project = `[[${proj.projectTag}]]`;
        parsed.data.category = proj.targetFolder;
        parsed.data.ai_refined = true;

        await fsPromises.writeFile(fullPath, serializeNote(parsed.data, parsed.body), 'utf-8');
        taggedCount++;

        if (routeScattered && art.needsRouting) {
          const destDir = path.join(vaultPath, proj.targetFolder);
          if (isPathInsideVault(destDir, vaultPath)) {
            await fsPromises.mkdir(destDir, { recursive: true });
            let destPath = path.join(destDir, art.filename);
            let counter = 1;
            while (fs.existsSync(destPath) && path.resolve(destPath) !== path.resolve(fullPath)) {
              const ext = path.extname(art.filename);
              const base = path.basename(art.filename, ext);
              destPath = path.join(destDir, `${base} ${counter}${ext}`);
              counter++;
            }
            if (path.resolve(fullPath) !== path.resolve(destPath)) {
              affectedDirs.add(path.dirname(fullPath));
              await snapshot.recordMove?.(fullPath, destPath);
              await fsPromises.rename(fullPath, destPath);
              routedCount++;
            }
          }
        }
      } catch {}
    }
  }

  for (const dir of affectedDirs) {
    try {
      await pruneEmptyParentDirs(vaultPath, dir);
    } catch {}
  }

  // Write clean Obsidian-native Project Harness Dashboard in 00_MOC/Project_Harness_Dashboard.md
  const mocsDir = path.join(vaultPath, '00_MOC');
  await fsPromises.mkdir(mocsDir, { recursive: true });
  const dashboardRel = '00_MOC/Project_Harness_Dashboard.md';
  const dashboardAbs = path.join(vaultPath, dashboardRel);

  const mdLines: string[] = [
    '---',
    'title: Project Tracking Harness Dashboard',
    'tags:',
    '  - MOC',
    '  - active',
    '  - strategy',
    `updated_at: "${new Date().toISOString().slice(0, 10)}"`,
    'ai_refined: true',
    '---',
    '',
    '# Project Tracking Harness Dashboard',
    '',
    `> **Active Projects:** ${report.totalProjects} · **Tracked Documents:** ${report.totalProjectDocs} · **Open Tasks:** ${report.totalOpenTasks} · **Completed:** ${report.totalCompletedTasks}`,
    ''
  ];

  for (const proj of report.projects) {
    const tagLine = proj.associatedTags
      .slice(0, 8)
      .map(t => `#${t.replace(/^#+/, '')}`)
      .join(' ');
    mdLines.push(`## #${proj.projectTag} (${proj.status.toUpperCase()} · ${proj.momentumScore}% Momentum)`);
    mdLines.push(`- **Target Folder:** \`${proj.targetFolder}\``);
    mdLines.push(`- **Clean #Tags:** ${tagLine}`);
    mdLines.push(
      `- **Documents:** ${proj.totalDocsCount} total (${proj.inFolderDocsCount} in project folder, ${proj.scatteredDocsCount} cross-linked)`
    );
    mdLines.push('');

    if (proj.openTasks.length > 0) {
      mdLines.push('### Open Action Items');
      for (const task of proj.openTasks.slice(0, 15)) {
        const linkName = task.notePath.replace(/\.md$/i, '');
        mdLines.push(`- [ ] ${task.text} — [[${linkName}|${task.noteTitle}]]`);
      }
      mdLines.push('');
    }

    if (proj.artifacts.length > 0) {
      mdLines.push('### Project Documents & Artifacts');
      for (const art of proj.artifacts.slice(0, 20)) {
        const linkName = art.path.replace(/\.md$/i, '');
        mdLines.push(`- **[${art.role.toUpperCase()}]** [[${linkName}|${art.title}]]`);
      }
      mdLines.push('');
    }
  }

  await fsPromises.writeFile(dashboardAbs, mdLines.join('\n'), 'utf-8');

  return {
    routedCount,
    taggedCount,
    dashboardPath: dashboardRel,
    snapshotId: snapshot.backedUpCount() > 0 ? snapshot.sessionId : null
  };
}
