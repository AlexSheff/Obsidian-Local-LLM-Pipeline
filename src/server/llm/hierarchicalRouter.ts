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

// Unicode-escaped Russian keywords for multilingual note matching without raw Cyrillic in source code
const KW_SPEC = '\u0441\u043f\u0435\u0446\u0438\u0444\u0438\u043a\u0430\u0446\u0438\u044f'; // specification
const KW_ROADMAP = '\u0440\u043e\u0430\u0434\u043c\u0430\u043f'; // roadmap
const KW_ARCH = '\u0430\u0440\u0445\u0438\u0442\u0435\u043a\u0442\u0443\u0440\u0430'; // architecture
const KW_PILOT = '\u043f\u0438\u043b\u043e\u0442'; // pilot
const KW_LAUNCH_PLAN = '\u043f\u043b\u0430\u043d \u0437\u0430\u043f\u0443\u0441\u043a\u0430'; // launch plan
const KW_TECH_SPEC = '\u0442\u0435\u0445\u043d\u0438\u0447\u0435\u0441\u043a\u043e\u0435 \u0437\u0430\u0434\u0430\u043d\u0438\u0435'; // technical specification
const KW_PROJ_STRUCT = '\u0441\u0442\u0440\u0443\u043a\u0442\u0443\u0440\u0430 \u043f\u0440\u043e\u0435\u043a\u0442\u0430'; // project structure
const KW_PROJ_LIST = '\u0441\u043f\u0438\u0441\u043e\u043a \u043f\u0440\u043e\u0435\u043a\u0442\u043e\u0432'; // project list

const L1_QUESTION = '\u041a \u043a\u0430\u043a\u043e\u0439 \u043a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u0438 \u043e\u0442\u043d\u043e\u0441\u0438\u0442\u0441\u044f \u044d\u0442\u0430 \u0437\u0430\u043c\u0435\u0442\u043a\u0430?';
const L2_PROJECT_QUESTION = '\u041a \u043a\u0430\u043a\u043e\u043c\u0443 \u043f\u0440\u043e\u0435\u043a\u0442\u0443 \u043e\u0442\u043d\u043e\u0441\u0438\u0442\u0441\u044f \u044d\u0442\u0430 \u0437\u0430\u043c\u0435\u0442\u043a\u0430?';
const L2_GENRE_QUESTION = '\u041a\u0430\u043a\u043e\u0439 \u0436\u0430\u043d\u0440/\u0442\u0438\u043f \u0443 \u044d\u0442\u043e\u0439 \u0437\u0430\u043c\u0435\u0442\u043a\u0438?';

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

  const l1Result = await chooseOne(state, L1_QUESTION, topCategories, {
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
      const l2Result = await chooseOne(state, L2_PROJECT_QUESTION, projectOptions, {
        decisionModelUrl: config.decisionModelUrl,
        timeoutMs
      });

      level2Selection = l2Result.chosen.option;
      level2Confidence = l2Result.confidence;

      const headerProject = matchProjectByHeader(filename, title, candidateProjects);
      let matchedProj =
        candidateProjects.find(
          p =>
            (p.aliases[0] || p.id).toLowerCase() === l2Result.chosen.option.toLowerCase() ||
            p.aliases.some(a => a.toLowerCase() === l2Result.chosen.option.toLowerCase())
        ) ||
        candidateProjects[l2Result.chosen.letter.charCodeAt(0) - 65] ||
        headerProject ||
        candidateProjects[0];

      // Check if note is one of project core doc types (C4.3)
      const lowerSnippet = (filename + ' ' + title + ' ' + snippet).toLowerCase().replace(/[_-]+/g, ' ');
      let hasAliasInText = (matchedProj.aliases || []).some(a =>
        lowerSnippet.includes(a.toLowerCase().replace(/[_-]+/g, ' '))
      );
      if (!hasAliasInText && headerProject) {
        matchedProj = headerProject;
        hasAliasInText = true;
      } else if (!hasAliasInText) {
        const textMatchedProj = candidateProjects.find(p =>
          (p.aliases || []).some(a => lowerSnippet.includes(a.toLowerCase().replace(/[_-]+/g, ' ')))
        );
        if (textMatchedProj) {
          matchedProj = textMatchedProj;
          hasAliasInText = true;
        }
      }

      isCoreDocType = (matchedProj.coreDocTypes || []).some(coreType =>
        lowerSnippet.includes(coreType.toLowerCase()) ||
        lowerSnippet.includes(KW_SPEC) ||
        lowerSnippet.includes(KW_ROADMAP) ||
        lowerSnippet.includes('roadmap') ||
        lowerSnippet.includes('implementation') ||
        lowerSnippet.includes(KW_ARCH) ||
        lowerSnippet.includes('architecture') ||
        lowerSnippet.includes('launch plan') ||
        lowerSnippet.includes('pilot') ||
        lowerSnippet.includes(KW_PILOT) ||
        lowerSnippet.includes(KW_LAUNCH_PLAN) ||
        lowerSnippet.includes(KW_TECH_SPEC) ||
        lowerSnippet.includes(KW_PROJ_STRUCT) ||
        lowerSnippet.includes(KW_PROJ_LIST)
      );

      if (!hasAliasInText) {
        // Note is categorized as Project, but does NOT mention any registered project in text/header
        const extractedProj = extractExplicitProjectName(filename, title);
        level2Selection = extractedProj || 'Active Projects';
        level2Confidence = 1.0;
        isCoreDocType = true;
        suggestedFolder = extractedProj ? `01_Projects/${extractedProj}` : '01_Projects/Active';
      } else if (isCoreDocType) {
        suggestedFolder = matchedProj.folder;
      } else {
        // Non-core notes about a matched project remain in their genre folder and get project: [[id]] link!
        const nonProjectCategories = topCategories.filter(c => c !== 'Project');
        const genreResult = await chooseOne(state, L2_GENRE_QUESTION, nonProjectCategories, {
          decisionModelUrl: config.decisionModelUrl,
          timeoutMs
        });
        suggestedFolder = config.typeRoutes[genreResult.chosen.option] || '03_Knowledge/Essays';
        projectLink = `[[${matchedProj.id}]]`;
      }
    } else {
      suggestedFolder = '01_Projects/Active';
    }
  }

  const totalConfidence = Math.round(level1Confidence * level2Confidence * 100) / 100;
  const isConfirmedProjectHeader =
    level1Category === 'Project' &&
    isCoreDocType &&
    suggestedFolder.startsWith('01_Projects/') &&
    suggestedFolder !== '01_Projects/Active' &&
    totalConfidence >= 0.65;
  const isHighConfidence =
    Boolean(l1Result.calibrated) &&
    l1Result.chosen.letter !== '?' &&
    (totalConfidence >= config.threshold || isConfirmedProjectHeader);
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

/**
 * Extracts an explicit project code/name from titles using general linguistic patterns
 * (works on any vault and any project name without hardcoded strings).
 */
export function extractExplicitProjectName(filename: string, title: string): string | null {
  const cleanFile = filename.replace(/\.[^/.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+\d+$/, '').trim();
  const cleanTitle = (title || '').replace(/[_]+/g, ' ').trim();
  const combined = `${cleanFile} ${cleanTitle}`;

  // 1. Match explicit patterns like "Project <Name>", "Assistant <Name>", "Platform <Name>"
  const explicitMatch = new RegExp(
    '(?:\\u043f\\u0440\\u043e\\u0435\\u043a\\u0442[\\u0430\\u0443\\u0435\\u043e\\u043c]?|project|\\u0430\\u0441\\u0441\\u0438\\u0441\\u0442\\u0435\\u043d\\u0442[\\u0430\\u0443]?|\\u043f\\u043b\\u0430\\u0442\\u0444\\u043e\\u0440\\u043c[\\u0430\\u044b]|\\u0441\\u0438\\u0441\\u0442\\u0435\\u043c[\\u0430\\u044b]|\\u043f\\u0440\\u043e\\u0434\\u0443\\u043a\\u0442[\\u0430\\u0443]?)\\s+([A-Z\\u0410-\\u042f\\u0401][A-Za-z\\u0410-\\u042f\\u0430-\\u044f\\u0401\\u04510-9_-]{2,20})'
  ).exec(combined);

  if (explicitMatch && explicitMatch[1]) {
    const candidate = explicitMatch[1].trim();
    const stopWords = new Set([
      '\u0438\u043b\u0438',
      '\u0434\u043b\u044f',
      '\u043a\u0430\u043a',
      '\u0432\u0441\u0435',
      '\u043c\u043e\u0438',
      '\u043d\u0430\u0448',
      'the',
      'and',
      'for',
      'system',
      'implementation',
      'roadmap',
      'update',
      'plan',
      'launch'
    ]);
    // Any all-uppercase acronym (2..12 chars) after "Project / Assistant" is a valid project code
    if (/^[A-Z\u0410-\u042f\u04010-9_-]{2,12}$/.test(candidate) && !stopWords.has(candidate.toLowerCase())) {
      return candidate;
    }
    if (!stopWords.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  // 2. General pattern for "<Core Subject> ... Pilot" in English or Russian titles
  const integratedPilotMatch = /(?:Integrated\s+)?([A-Z][a-z]+\s+[A-Z][a-z]+)(?:,|\s+and\s+|\s+)[^.]*?\bPilot\b/.exec(
    cleanFile
  );
  if (integratedPilotMatch && integratedPilotMatch[1]) {
    return `${integratedPilotMatch[1].trim()} Pilot`;
  }

  return null;
}

/**
 * Post-LLM Semantic Guardrail & 2-Model Tandem Consensus Engine:
 * Coordinates Jev Decision Model (Port 1234) + Primary Generative LLM (Port 8080)
 * to accurately sort project documents into their exact discovered vault project folders
 * while preventing models from hallucinating foreign project names on unrelated notes.
 */
export function validateAndSanitizeRoute(params: {
  llmSuggestedPath: string;
  originalFilename: string;
  noteTitle: string;
  noteBody: string;
  existingTags: string[];
  projects: ProjectDefinition[];
  jevResult?: HierarchicalRouteResult | null;
  typeRoutes?: Record<string, string>;
  projectsRoot?: string;
}): string {
  const routes = params.typeRoutes || {};
  const projRoot = params.projectsRoot || '01_Projects';
  const technicalFolder = routes['Technical/Code'] || '03_Knowledge/Technical';
  const dialoguesFolder = routes['Dialogue/Transcript'] || '03_Knowledge/Dialogues';
  const essaysFolder = routes['Essay/Knowledge'] || '03_Knowledge/Essays';
  const ideasFolder = routes['Idea'] || '05_Ideas/Inbox';

  let pathCandidate = (params.llmSuggestedPath || essaysFolder)
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/g, '')
    .replace(/\/+$/g, '');

  const normHeader = `${params.originalFilename} ${params.noteTitle}`
    .toLowerCase()
    .replace(/[_-]+/g, ' ');
  const fullTextLower = `${params.originalFilename} ${params.noteTitle} ${params.existingTags.join(' ')} ${params.noteBody}`
    .toLowerCase()
    .replace(/[_-]+/g, ' ');

  // 1. Direct Discovered Project Match in Filename or Title (Highest Priority for Project Sorting!)
  const headerMatchedProject = matchProjectByHeader(
    params.originalFilename,
    params.noteTitle,
    params.projects
  );
  if (headerMatchedProject) {
    // Only keep in genre folder if Jev explicitly determined it is a non-core genre note with high confidence
    if (
      params.jevResult &&
      params.jevResult.projectLink &&
      !params.jevResult.isCoreDocType &&
      params.jevResult.level1Confidence >= 0.80
    ) {
      return params.jevResult.suggestedFolder;
    }
    return headerMatchedProject.folder;
  }

  // 2. High-Confidence Jev Non-Project or Verified Jev Route
  if (
    params.jevResult &&
    (params.jevResult.isHighConfidence ||
      (params.jevResult.projectLink && params.jevResult.level1Confidence >= 0.75))
  ) {
    return params.jevResult.suggestedFolder;
  }

  // 3. 2-Model Tandem Project Match via Body/Tags + Project Document Indicators
  const isProjectDocByModelsOrKeywords =
    params.jevResult?.level1Category === 'Project' ||
    pathCandidate.toLowerCase().startsWith(projRoot.toLowerCase() + '/') ||
    pathCandidate.toLowerCase().startsWith('01_projects/') ||
    new RegExp(
      'roadmap|launch plan|implementation|project spec|business plan|' +
        KW_ROADMAP +
        '|' +
        KW_LAUNCH_PLAN +
        '|' +
        KW_TECH_SPEC +
        '|' +
        KW_PROJ_STRUCT,
      'i'
    ).test(normHeader);

  if (isProjectDocByModelsOrKeywords) {
    for (const proj of params.projects) {
      const hasAliasInBodyOrTags = proj.aliases.some(alias => {
        const a = alias.toLowerCase().replace(/[_-]+/g, ' ').trim();
        return a.length >= 3 && fullTextLower.includes(a);
      });
      if (hasAliasInBodyOrTags) {
        if (params.jevResult?.suggestedFolder === proj.folder || isProjectDocByModelsOrKeywords) {
          return proj.folder;
        }
      }
    }
  }

  // 4. Check if LLM suggested a specific project folder WITHOUT any mention of that project in the note!
  if (
    pathCandidate.toLowerCase().startsWith(projRoot.toLowerCase() + '/') ||
    pathCandidate.toLowerCase().startsWith('01_projects/')
  ) {
    const parts = pathCandidate.split('/');
    const subFolder = (parts[1] || '').toLowerCase().replace(/[_-]+/g, ' ').trim();
    const matchedKnownProject = params.projects.find(
      p =>
        p.id.toLowerCase().replace(/[_-]+/g, ' ') === subFolder ||
        p.folder.toLowerCase().replace(/[_-]+/g, ' ') === pathCandidate.toLowerCase().replace(/[_-]+/g, ' ') ||
        (subFolder.length >= 3 && subFolder.includes(p.id.toLowerCase().replace(/[_-]+/g, ' ')))
    );

    if (matchedKnownProject) {
      const hasProjectMention = matchedKnownProject.aliases.some(alias =>
        fullTextLower.includes(alias.toLowerCase().replace(/[_-]+/g, ' '))
      );
      if (!hasProjectMention) {
        pathCandidate = '';
      } else {
        return matchedKnownProject.folder;
      }
    } else if (subFolder && subFolder !== 'active' && subFolder !== 'unsorted') {
      // If LLM invented a random project subfolder whose words do NOT appear in the note at all, reject it!
      const subWords = subFolder.split(/[\s_-]+/).filter(w => w.length >= 3);
      const anyWordInNote = subWords.some(w => fullTextLower.includes(w));
      if (!anyWordInNote) {
        pathCandidate = '';
      }
    }
  }

  // 5. General Semantic Rules by Title / Header Keywords + Jev Tandem Harmony
  // 5a. System prompts, AI agents, code, APIs, technical specs (unless tied to an explicit named project spec)
  const techRegex = new RegExp(
    '\\u0441\\u0438\\u0441\\u0442\\u0435\\u043c\\u043d\\u044b\\u0439 \\u043f\\u0440\\u043e\\u043c\\u043f\\u0442|system prompt|\\u043f\\u0440\\u043e\\u043c\\u043f\\u0442 \\u0434\\u043b\\u044f|\\bagent\\b|ai-\\u0430\\u0441\\u0441\\u0438\\u0441\\u0442\\u0435\\u043d\\u0442|api |\\u0441\\u043a\\u0440\\u0438\\u043f\\u0442|\\u043a\\u043e\\u0434 |\\u043f\\u0440\\u043e\\u0433\\u0440\\u0430\\u043c\\u043c\\u0438\\u0440|\\u0442\\u0435\\u0445\\u043d\\u0438\\u0447\\u0435\\u0441\\u043a',
    'i'
  );
  if (techRegex.test(normHeader)) {
    const explicitProj = extractExplicitProjectName(params.originalFilename, params.noteTitle);
    const specRegex = new RegExp(
      '\\u0442\\u0435\\u0445\\u043d\\u0438\\u0447\\u0435\\u0441\\u043a\\u043e\\u0435 \\u0437\\u0430\\u0434\\u0430\\u043d\\u0438\\u0435|\\u0442\\u0437 |\\u043f\\u0440\\u043e\\u0435\\u043a\\u0442|\\u0441\\u043f\\u0435\\u0446\\u0438\\u0444\\u0438\\u043a\\u0430\\u0446',
      'i'
    );
    if (explicitProj && specRegex.test(normHeader)) {
      return `${projRoot}/${explicitProj}`;
    }
    return technicalFolder;
  }

  // 5b. Meeting agendas, theses for meetings, dialogues, interviews
  const dialogueRegex = new RegExp(
    '\\u0432\\u0441\\u0442\\u0440\\u0435\\u0447[\\u0438\\u0430\\u0435]|\\u0441\\u043e\\u0432\\u0435\\u0449\\u0430\\u043d|\\u043c\\u0438\\u0442\\u0438\\u043d\\u0433|meeting|agenda|\\u043f\\u043e\\u0432\\u0435\\u0441\\u0442\\u043a|\\u0438\\u043d\\u0442\\u0435\\u0440\\u0432\\u044c\\u044e|\\u0434\\u0438\\u0430\\u043b\\u043e\\u0433|\\u0442\\u0440\\u0430\\u043d\\u0441\\u043a\\u0440\\u0438\\u043f\\u0442',
    'i'
  );
  if (dialogueRegex.test(normHeader)) {
    return dialoguesFolder;
  }

  // 5c. Explicit project structures / lists / roadmaps / pilots
  const projectStructRegex = new RegExp(
    '\\u0441\\u043f\\u0438\\u0441\\u043e\\u043a \\u043f\\u0440\\u043e\\u0435\\u043a\\u0442\\u043e\\u0432|\\u0441\\u0442\\u0440\\u0443\\u043a\\u0442\\u0443\\u0440\\u0430 \\u043f\\u0440\\u043e\\u0435\\u043a\\u0442\\u0430|\\u0440\\u043e\\u0430\\u0434\\u043c\\u0430\\u043f|roadmap|\\u043f\\u043b\\u0430\\u043d \\u0437\\u0430\\u043f\\u0443\\u0441\\u043a\\u0430|launch plan|pilot',
    'i'
  );
  if (projectStructRegex.test(normHeader)) {
    const explicitProj = extractExplicitProjectName(params.originalFilename, params.noteTitle);
    if (explicitProj) {
      return `${projRoot}/${explicitProj}`;
    }
    if (
      pathCandidate.toLowerCase().startsWith(projRoot.toLowerCase() + '/') ||
      pathCandidate.toLowerCase().startsWith('01_projects/')
    ) {
      const sub = pathCandidate.split('/')[1]?.trim();
      if (sub && sub.toLowerCase() !== 'active' && sub.toLowerCase() !== 'unsorted') {
        const subWords = sub.toLowerCase().split(/[\s_-]+/).filter(w => w.length >= 3);
        if (subWords.some(w => fullTextLower.includes(w))) {
          return `${projRoot}/${sub}`;
        }
      }
    }
    return `${projRoot}/Active`;
  }

  // 5d. Numbered philosophical/essay series or general essays
  const essaySeriesRegex = new RegExp(
    '\\u0441\\u043c\\u044b\\u0441\\u043b|\\u044d\\u0441\\u0441\\u0435|\\u0444\\u0438\\u043b\\u043e\\u0441\\u043e\\u0444|\\u0440\\u0430\\u0437\\u043c\\u044b\\u0448\\u043b\\u0435\\u043d',
    'i'
  );
  if (essaySeriesRegex.test(normHeader)) {
    return essaysFolder;
  }

  // 5e. Innovation problems/solutions, brainstorms, product ideas without an existing project folder
  const ideaRegex = new RegExp(
    '\\u043f\\u0440\\u043e\\u0431\\u043b\\u0435\\u043c[\\u0430\\u044b] \\u0438 .*\\u0440\\u0435\\u0448\\u0435\\u043d\\u0438|\\u0438\\u043d\\u043d\\u043e\\u0432\\u0430\\u0446\\u0438\\u043e\\u043d\\u043d|\\u0438\\u0434\\u0435\\u044f|\\u043a\\u043e\\u043d\\u0446\\u0435\\u043f\\u0446\\u0438',
    'i'
  );
  if (ideaRegex.test(normHeader) && !pathCandidate) {
    return ideasFolder;
  }

  // 6. If pathCandidate was cleared (due to hallucinated project) or is generic '01_Projects/Active'
  // when the note is NOT actually a project: use Jev's Level 1 genre if Jev had reasonable confidence
  const isProjectHeaderRegex = new RegExp(
    '\\u043f\\u0440\\u043e\\u0435\\u043a\\u0442|project|\\u0437\\u0430\\u043f\\u0443\\u0441\\u043a|\\u043f\\u043b\\u0430\\u043d|\\u0442\\u0437|\\u0437\\u0430\\u0434\\u0430\\u0447|roadmap|pilot',
    'i'
  );
  if (
    !pathCandidate ||
    ((pathCandidate.toLowerCase() === '01_projects/active' ||
      pathCandidate.toLowerCase() === `${projRoot.toLowerCase()}/active`) &&
      !isProjectHeaderRegex.test(normHeader))
  ) {
    if (
      params.jevResult &&
      params.jevResult.level1Category !== 'Project' &&
      params.jevResult.level1Confidence >= 0.30
    ) {
      return params.jevResult.suggestedFolder;
    }
    if (!pathCandidate) {
      return essaysFolder;
    }
  }

  return pathCandidate;
}

/**
 * Protects clean, meaningful original filenames (such as numbered series or named specs/acronyms)
 * from destructive LLM renaming across any vault.
 */
export function preserveMeaningfulTitle(
  llmTitle: string,
  originalFilename: string
): string {
  const origBase = originalFilename.replace(/\.[^/.]+$/, '').trim();
  const cleanOrig = origBase.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

  // Check if original filename is noisy (e.g. raw dates, voice_note, copy numbers, > 75 chars)
  const noisyRegex = new RegExp(
    '^(?:\\d{4}[-_]\\d{2}[-_]\\d{2}|\\d{8,14}|voice|audio|untitled|\\u0431\\u0435\\u0437 \\u043d\\u0430\\u0437\\u0432\\u0430\\u043d\\u0438\\u044f|copy|\\u043a\\u043e\\u043f\\u0438\\u044f)',
    'i'
  );
  const isNoisyOriginal =
    noisyRegex.test(origBase) ||
    cleanOrig.length > 75 ||
    cleanOrig.length < 3;

  // If original filename ends with a series number (e.g. "Part 8", "Issue 8") that the LLM stripped out, preserve it
  const seriesMatch = cleanOrig.match(/\b(\d{1,3})\b$/);
  if (seriesMatch && !llmTitle.includes(seriesMatch[1]) && !isNoisyOriginal) {
    return cleanOrig;
  }

  // If original filename contains an uppercase project/entity acronym (2-12 uppercase letters) or "<Name> Agent"
  const acronymRegex = new RegExp('\\b([A-Z\\u0410-\\u042f\\u0401]{2,12}|[A-Z][a-z]+\\s+Agent)\\b', 'g');
  const acronyms = cleanOrig.match(acronymRegex);
  if (acronyms && !isNoisyOriginal) {
    for (const acr of acronyms) {
      if (acr !== 'MD' && !llmTitle.toLowerCase().includes(acr.toLowerCase())) {
        return cleanOrig;
      }
    }
  }

  return llmTitle;
}
