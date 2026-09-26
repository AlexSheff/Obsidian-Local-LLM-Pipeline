import { chooseOne, RouterOptions } from './router';
import { ProjectDefinition, matchProjectByHeader } from '../projectsRegistry';
import { safeSlice } from '../unicode';

export interface HierarchicalRouteResult {
  level1Category: string;
  level1Confidence: number;
  level2Selection: string;
  level2Confidence: number;
  totalConfidence: number;
  suggestedFolder: string;
  projectLink?: string;        // e.g. "[[neuromicon]]"
  isCoreDocType: boolean;      // whether it belongs physically in 01_Projects/<id>
  needsReview: boolean;
  isHighConfidence: boolean;
}

export interface HierarchicalRouterConfig {
  topLevelCategories: string[];
  typeRoutes: Record<string, string>;
  projects: ProjectDefinition[];
  decisionModelUrl: string;
  threshold: number;
}

/**
 * Executes two-tier hierarchical routing without flat candidate truncation (resolves D1 & D2).
 * Tier 1: Category selection across explicit taxonomy + Project option.
 * Tier 2a (Project): Project selection from projects.yaml registry.
 * Tier 2b (Non-Project): Specific note type route mapping.
 */
export async function routeHierarchical(
  noteText: string,
  filename: string,
  title: string,
  config: HierarchicalRouterConfig,
  opts?: { timeoutMs?: number }
): Promise<HierarchicalRouteResult> {
  const timeoutMs = opts?.timeoutMs || 15000;
  const snippet = safeSlice(noteText, 0, 1500);
  const state = `Filename: ${filename}\nTitle: ${title || filename}\nContent Snippet:\n${snippet}`;

  // 1. Tier 1: Top-Level Category Selection
  const rawTopLevel = config.topLevelCategories || [];
  const topCategories = rawTopLevel.includes('Project')
    ? rawTopLevel
    : ['Project', ...rawTopLevel];

  const l1Question = 'К какой категории относится эта заметка?';
  const l1Result = await chooseOne(state, l1Question, topCategories, {
    decisionModelUrl: config.decisionModelUrl,
    timeoutMs
  });

  const level1Category = l1Result.chosen.option;
  const level1Confidence = l1Result.confidence;

  let level2Selection = level1Category;
  let level2Confidence = 1.0;
  let suggestedFolder = config.typeRoutes[level1Category] || '03_Knowledge';
  let projectLink: string | undefined = undefined;
  let isCoreDocType = false;

  // 2. Tier 2:
  if (level1Category === 'Project') {
    const allProjects = config.projects || [];
    let candidateProjects = allProjects;

    // If projects list > 20, prefilter by aliases in filename/title (C2.1)
    if (allProjects.length > 20) {
      const headerMatched = matchProjectByHeader(filename, title, allProjects);
      if (headerMatched) {
        candidateProjects = [
          headerMatched,
          ...allProjects.filter(p => p.id !== headerMatched.id).slice(0, 19)
        ];
      } else {
        candidateProjects = allProjects.slice(0, 20);
      }
    }

    if (candidateProjects.length > 0) {
      const projectOptions = candidateProjects.map(p => p.aliases[0] || p.id);
      const l2Question = 'К какому проекту относится эта заметка?';
      const l2Result = await chooseOne(state, l2Question, projectOptions, {
        decisionModelUrl: config.decisionModelUrl,
        timeoutMs
      });

      level2Selection = l2Result.chosen.option;
      level2Confidence = l2Result.confidence;

      const matchedProj = candidateProjects.find(
        p => (p.aliases[0] || p.id).toLowerCase() === l2Result.chosen.option.toLowerCase() ||
             p.aliases.some(a => a.toLowerCase() === l2Result.chosen.option.toLowerCase())
      ) || candidateProjects[l2Result.chosen.letter.charCodeAt(0) - 65] || candidateProjects[0];

      // Check if note is one of project core doc types (C4.3)
      const lowerSnippet = (filename + ' ' + title + ' ' + snippet).toLowerCase();
      const hasAliasInText = (matchedProj.aliases || []).some(a =>
        lowerSnippet.includes(a.toLowerCase())
      );
      const isConfidentProjectMatch = level2Confidence >= 0.60 || hasAliasInText;

      isCoreDocType = (matchedProj.coreDocTypes || []).some(coreType =>
        lowerSnippet.includes(coreType.toLowerCase()) ||
        lowerSnippet.includes('спецификация') ||
        lowerSnippet.includes('роадмап') ||
        lowerSnippet.includes('roadmap') ||
        lowerSnippet.includes('архитектура') ||
        lowerSnippet.includes('architecture') ||
        lowerSnippet.includes('launch plan') ||
        lowerSnippet.includes('launch_plan') ||
        lowerSnippet.includes('pilot') ||
        lowerSnippet.includes('пилот') ||
        lowerSnippet.includes('план запуска') ||
        lowerSnippet.includes('техническое задание')
      );

      if (isCoreDocType) {
        suggestedFolder = isConfidentProjectMatch ? matchedProj.folder : '01_Projects/Active';
      } else {
        // Non-core notes about the project remain in their genre folder and get project: [[id]] link!
        const nonProjectCategories = topCategories.filter(c => c !== 'Project');
        const genreResult = await chooseOne(state, 'Какой жанр/тип у этой заметки?', nonProjectCategories, {
          decisionModelUrl: config.decisionModelUrl,
          timeoutMs
        });
        suggestedFolder = config.typeRoutes[genreResult.chosen.option] || '03_Knowledge/Essays';
        if (isConfidentProjectMatch) {
          projectLink = `[[${matchedProj.id}]]`;
        }
      }
    } else {
      suggestedFolder = '01_Projects';
    }
  }

  const totalConfidence = Math.round(level1Confidence * level2Confidence * 100) / 100;
  const isHighConfidence = totalConfidence >= config.threshold;
  const needsReview = !isHighConfidence;

  return {
    level1Category,
    level1Confidence,
    level2Selection,
    level2Confidence,
    totalConfidence,
    suggestedFolder,
    projectLink,
    isCoreDocType,
    needsReview,
    isHighConfidence
  };
}
