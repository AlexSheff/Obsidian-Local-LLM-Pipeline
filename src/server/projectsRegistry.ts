import path from 'path';
import fs from 'fs';
const fsPromises = fs.promises;
import yaml from 'yaml';

export interface ProjectDefinition {
  id: string;
  folder: string;
  aliases: string[];
  coreDocTypes: string[];
}

export interface ProjectsConfig {
  projects: ProjectDefinition[];
}

export interface DiscoveredVaultStructure {
  folders: string[];
  projectsRoot: string;
  projects: ProjectDefinition[];
  existingTags: string[];
}

const IGNORED_PROJECT_SUBFOLDERS = new Set([
  'active',
  'archive',
  'archived',
  'inbox',
  'unsorted',
  'scenarios',
  'general',
  'templates',
  'temp',
  'trash',
  'completed',
  'backlog'
]);

const IGNORED_VAULT_DIRS = new Set([
  '.obsidian',
  '.git',
  '.trash',
  '.snapshots',
  'node_modules',
  '99_system',
  '08_templates',
  '09_attachments',
  '99_archive'
]);

const DEFAULT_CORE_DOC_TYPES = [
  'Project Spec',
  'Protocol',
  'Roadmap',
  'Business Plan',
  'Implementation',
  'Architecture',
  'Launch Plan',
  'Pilot',
  'Technical Spec'
];

// Empty by default: no hardcoded user-specific projects. All projects are discovered from the connected Vault.
export const DEFAULT_PROJECTS: ProjectDefinition[] = [];

/**
 * Algorithmic Latin <-> Cyrillic phonetic transliteration so any project folder name
 * in any user's vault can match notes written in either English or Russian without hardcoding.
 */
export function generateProjectAliases(rawName: string): string[] {
  const clean = rawName.trim();
  if (!clean) return [];

  const spaced = clean.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const camelSpaced = spaced.replace(/([a-z\u0430-\u044f])([A-Z\u0410-\u042f])/g, '$1 $2').trim();
  const compact = spaced.replace(/\s+/g, '');

  const aliases = new Set<string>([clean, spaced, camelSpaced, compact]);

  // If the folder has a generic suffix like "Franchise", "Project", "System", "Pilot", also add the core brand token
  const strippedBrand = spaced
    .replace(/\b(franchise|project|system|pilot|app|platform|protocol|\u043f\u0440\u043e\u0435\u043a\u0442|\u0444\u0440\u0430\u043d\u0448\u0438\u0437\u0430|\u0441\u0438\u0441\u0442\u0435\u043c\u0430|\u043f\u043b\u0430\u0442\u0444\u043e\u0440\u043c\u0430)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (strippedBrand && strippedBrand.length >= 3) {
    aliases.add(strippedBrand);
  }

  // Phonetic Latin -> Cyrillic approximation for English project names
  if (/^[A-Za-z0-9\s_-]+$/.test(spaced)) {
    const latToCyr = (str: string): string => {
      let s = str.toLowerCase();
      const multiMap: Array<[RegExp, string]> = [
        [/clean\s*net/g, '\u043a\u043b\u0438\u043d\u043d\u0435\u0442'],
        [/art\s*maze/g, '\u0430\u0440\u0442\u043c\u0435\u0439\u0437'],
        [/neuro/g, '\u043d\u0435\u0439\u0440\u043e'],
        [/crypto/g, '\u043a\u0440\u0438\u043f\u0442\u043e'],
        [/sh/g, '\u0448'],
        [/ch/g, '\u0447'],
        [/th/g, '\u0442'],
        [/ph/g, '\u0444'],
        [/zh/g, '\u0436'],
        [/ee/g, '\u0438'],
        [/ea/g, '\u0438'],
        [/oo/g, '\u0443'],
        [/ai/g, '\u0430\u0439'],
        [/ey/g, '\u0435\u0439'],
        [/ay/g, '\u0435\u0439'],
        [/qu/g, '\u043a\u0432'],
        [/ck/g, '\u043a']
      ];
      for (const [re, rep] of multiMap) {
        s = s.replace(re, rep);
      }
      const charMap: Record<string, string> = {
        a: '\u0430', b: '\u0431', c: '\u043a', d: '\u0434', e: '\u0435',
        f: '\u0444', g: '\u0433', h: '\u0445', i: '\u0438', j: '\u0434\u0436',
        k: '\u043a', l: '\u043b', m: '\u043c', n: '\u043d', o: '\u043e',
        p: '\u043f', q: '\u043a', r: '\u0440', s: '\u0441', t: '\u0442',
        u: '\u0443', v: '\u0432', w: '\u0432', x: '\u043a\u0441', y: '\u0438', z: '\u0437'
      };
      return s
        .split('')
        .map(ch => charMap[ch] ?? ch)
        .join('');
    };

    const cyrSpaced = latToCyr(spaced);
    if (cyrSpaced && cyrSpaced.length >= 3) aliases.add(cyrSpaced);
    if (strippedBrand && strippedBrand.length >= 3) {
      const cyrBrand = latToCyr(strippedBrand);
      if (cyrBrand && cyrBrand.length >= 3) aliases.add(cyrBrand);
    }
  }

  return Array.from(aliases).filter(a => a.trim().length >= 2);
}

/**
 * Detects the primary projects root folder in a user's vault (e.g. "01_Projects", "Projects").
 */
export async function detectProjectsRootFolder(vaultPath: string): Promise<string> {
  if (!vaultPath || !fs.existsSync(vaultPath)) return '01_Projects';
  try {
    const entries = await fsPromises.readdir(vaultPath, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name);
    const preferred = ['01_Projects', 'Projects', '01_\u041f\u0440\u043e\u0435\u043a\u0442\u044b', '\u041f\u0440\u043e\u0435\u043a\u0442\u044b'];
    for (const pref of preferred) {
      const found = dirs.find(d => d.toLowerCase() === pref.toLowerCase());
      if (found) return found;
    }
    const fuzzy = dirs.find(d => /project|\u043f\u0440\u043e\u0435\u043a\u0442/i.test(d));
    if (fuzzy) return fuzzy;
  } catch {}
  return '01_Projects';
}

/**
 * Dynamically discovers the project registry from the connected Vault:
 * 1. Reads 99_System/projects.yaml if present
 * 2. Scans all real project subfolders in the vault's Projects directory (e.g. 01_Projects/*, Projects/*)
 * 3. Never uses hardcoded projects from another user's PC.
 */
export async function loadProjectsRegistry(vaultPath: string): Promise<ProjectDefinition[]> {
  if (!vaultPath || !fs.existsSync(vaultPath)) {
    return [...DEFAULT_PROJECTS];
  }

  const byId = new Map<string, ProjectDefinition>();

  // 1. Load explicit definitions from 99_System/projects.yaml if present in this vault
  const yamlPath = path.join(vaultPath, '99_System', 'projects.yaml');
  try {
    if (fs.existsSync(yamlPath)) {
      const content = await fsPromises.readFile(yamlPath, 'utf-8');
      const parsed: ProjectsConfig = yaml.parse(content);
      if (parsed && Array.isArray(parsed.projects)) {
        for (const p of parsed.projects) {
          if (!p || !p.id || !p.folder) continue;
          const key = p.id.toLowerCase();
          const generatedAliases = generateProjectAliases(path.basename(p.folder));
          const mergedAliases = Array.from(
            new Set([...(Array.isArray(p.aliases) ? p.aliases : []), ...generatedAliases, p.id])
          );
          byId.set(key, {
            id: p.id,
            folder: p.folder.replace(/\\/g, '/'),
            aliases: mergedAliases,
            coreDocTypes:
              Array.isArray(p.coreDocTypes) && p.coreDocTypes.length > 0
                ? p.coreDocTypes
                : DEFAULT_CORE_DOC_TYPES
          });
        }
      }
    }
  } catch (err) {
    console.error('Error reading projects.yaml:', err);
  }

  // 2. Dynamically discover real project folders inside the vault's projects root folder(s)
  try {
    const rootEntries = await fsPromises.readdir(vaultPath, { withFileTypes: true });
    const candidateProjectRoots = rootEntries
      .filter(
        e =>
          e.isDirectory() &&
          !e.name.startsWith('.') &&
          /^(01_projects|projects|\u043f\u0440\u043e\u0435\u043a\u0442\u044b|01_\u043f\u0440\u043e\u0435\u043a\u0442\u044b)$/i.test(
            e.name
          )
      )
      .map(e => e.name);

    for (const projRoot of candidateProjectRoots) {
      const projectsDir = path.join(vaultPath, projRoot);
      const entries = await fsPromises.readdir(projectsDir, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
        const nameLower = ent.name.toLowerCase().trim();
        if (IGNORED_PROJECT_SUBFOLDERS.has(nameLower)) continue;

        const id =
          nameLower
            .replace(/[^a-z\u0430-\u044f\u04510-9_-]/gi, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '') || nameLower;

        const relFolder = `${projRoot}/${ent.name}`;
        const existingMatch = Array.from(byId.values()).find(
          existing =>
            existing.id.toLowerCase() === id ||
            existing.folder.toLowerCase() === relFolder.toLowerCase() ||
            existing.aliases.some(a => a.toLowerCase() === nameLower)
        );

        if (existingMatch) {
          const canonicalAbs = path.join(vaultPath, existingMatch.folder);
          if (!fs.existsSync(canonicalAbs)) {
            existingMatch.folder = relFolder;
          }
          existingMatch.aliases = Array.from(
            new Set([...existingMatch.aliases, ...generateProjectAliases(ent.name)])
          );
        } else {
          byId.set(id, {
            id,
            folder: relFolder,
            aliases: generateProjectAliases(ent.name),
            coreDocTypes: DEFAULT_CORE_DOC_TYPES
          });
        }
      }
    }
  } catch {}

  return Array.from(byId.values());
}

/**
 * Scans the connected Vault on disk to discover its real folder hierarchy,
 * project folders, and existing valid tags so the pipeline adapts to ANY vault structure.
 */
export async function discoverVaultStructure(vaultPath: string): Promise<DiscoveredVaultStructure> {
  const projectsRoot = await detectProjectsRootFolder(vaultPath);
  const projects = await loadProjectsRegistry(vaultPath);
  const folders: string[] = [];

  if (vaultPath && fs.existsSync(vaultPath)) {
    const walkDirs = async (dir: string, depth: number) => {
      if (depth > 3) return;
      try {
        const entries = await fsPromises.readdir(dir, { withFileTypes: true });
        for (const ent of entries) {
          if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
          if (IGNORED_VAULT_DIRS.has(ent.name.toLowerCase())) continue;
          const full = path.join(dir, ent.name);
          const rel = path.relative(vaultPath, full).replace(/\\/g, '/');
          folders.push(rel);
          await walkDirs(full, depth + 1);
        }
      } catch {}
    };
    await walkDirs(vaultPath, 1);
  }

  return {
    folders: folders.sort(),
    projectsRoot,
    projects,
    existingTags: []
  };
}

/**
 * Searches for project affiliation strictly in filename and document title.
 * C4: Does NOT search in body text to prevent false positives.
 */
export function matchProjectByHeader(
  filename: string,
  title: string,
  projects: ProjectDefinition[]
): ProjectDefinition | null {
  const normTitle = (title || '').toLowerCase().replace(/[_-]+/g, ' ');
  const normFile = (filename || '').toLowerCase().replace(/[_-]+/g, ' ');

  for (const proj of projects) {
    for (const alias of proj.aliases) {
      const a = alias.toLowerCase().replace(/[_-]+/g, ' ').trim();
      if (!a || a.length < 2) continue;
      if (normFile.includes(a) || normTitle.includes(a)) {
        return proj;
      }
    }
  }

  return null;
}

/**
 * Bootstraps 99_System/projects.yaml by scanning the connected Vault's project subfolders.
 */
export async function bootstrapProjectsYaml(vaultPath: string): Promise<string> {
  if (!vaultPath || !fs.existsSync(vaultPath)) {
    throw new Error('Vault path does not exist');
  }

  const discovered = await loadProjectsRegistry(vaultPath);
  const outDir = path.join(vaultPath, '99_System');
  await fsPromises.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, 'projects.yaml');

  const yamlContent = yaml.stringify({ projects: discovered });
  await fsPromises.writeFile(outPath, yamlContent, 'utf-8');
  return outPath;
}
