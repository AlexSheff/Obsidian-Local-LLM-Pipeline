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

export const DEFAULT_PROJECTS: ProjectDefinition[] = [
  {
    id: 'cleannet',
    folder: '01_Projects/CleanNet',
    aliases: ['CleanNet', 'Клиннет', 'Чистая Сеть', 'Франшиза CleanNet'],
    coreDocTypes: ['Project Spec', 'Protocol', 'Roadmap', 'Business Plan']
  },
  {
    id: 'neuromicon',
    folder: '01_Projects/Neuromicon',
    aliases: ['Neuromicon', 'Нейромикон'],
    coreDocTypes: ['Project Spec', 'Protocol', 'Roadmap', 'Architecture']
  },
  {
    id: 'artmaze',
    folder: '01_Projects/ArtMaze',
    aliases: ['ArtMaze', 'Артмейз', 'Арт Мейз'],
    coreDocTypes: ['Project Spec', 'Game Design', 'Roadmap']
  },
  {
    id: 'agos-luna',
    folder: '01_Projects/AGOS-LUNA',
    aliases: ['AGOS-LUNA', 'AGOS', 'LUNA', 'АГОС-ЛУНА'],
    coreDocTypes: ['Project Spec', 'Protocol', 'Hardware Spec']
  },
  {
    id: 'crypto',
    folder: '01_Projects/Crypto',
    aliases: ['Crypto', 'Крипто', 'Web3'],
    coreDocTypes: ['Project Spec', 'Tokenomics', 'Roadmap']
  }
];

/**
 * Loads project registry from 99_System/projects.yaml.
 */
export async function loadProjectsRegistry(vaultPath: string): Promise<ProjectDefinition[]> {
  if (!vaultPath) return DEFAULT_PROJECTS;

  const yamlPath = path.join(vaultPath, '99_System', 'projects.yaml');
  try {
    if (fs.existsSync(yamlPath)) {
      const content = await fsPromises.readFile(yamlPath, 'utf-8');
      const parsed: ProjectsConfig = yaml.parse(content);
      if (parsed && Array.isArray(parsed.projects) && parsed.projects.length > 0) {
        return parsed.projects;
      }
    }
  } catch (err) {
    console.error('Error loading projects.yaml, falling back to defaults:', err);
  }

  return DEFAULT_PROJECTS;
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
  const normTitle = (title || '').toLowerCase();
  const normFile = (filename || '').toLowerCase();

  for (const proj of projects) {
    for (const alias of proj.aliases) {
      const a = alias.toLowerCase();
      // Match whole word or exact substring in filename or title
      const fileMatch = normFile.includes(a);
      const titleMatch = normTitle.includes(a);
      if (fileMatch || titleMatch) {
        return proj;
      }
    }
  }

  return null;
}

/**
 * Bootstraps 99_System/projects.yaml by scanning 01_Projects subfolders.
 */
export async function bootstrapProjectsYaml(vaultPath: string): Promise<string> {
  if (!vaultPath || !fs.existsSync(vaultPath)) {
    throw new Error('Vault path does not exist');
  }

  const projectsDir = path.join(vaultPath, '01_Projects');
  const discovered: ProjectDefinition[] = [...DEFAULT_PROJECTS];
  const existingFolders = new Set(discovered.map(p => p.folder.toLowerCase()));

  if (fs.existsSync(projectsDir)) {
    const entries = await fsPromises.readdir(projectsDir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
      const folderRel = `01_Projects/${ent.name}`;
      if (!existingFolders.has(folderRel.toLowerCase())) {
        const id = ent.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
        discovered.push({
          id,
          folder: folderRel,
          aliases: [ent.name],
          coreDocTypes: ['Project Spec', 'Protocol', 'Roadmap']
        });
        existingFolders.add(folderRel.toLowerCase());
      }
    }
  }

  const outDir = path.join(vaultPath, '99_System');
  await fsPromises.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, 'projects.yaml');

  const yamlContent = yaml.stringify({ projects: discovered });
  await fsPromises.writeFile(outPath, yamlContent, 'utf-8');
  return outPath;
}
