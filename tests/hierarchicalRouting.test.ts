import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
const fsPromises = fs.promises;
import * as routerModule from '../src/server/llm/router';
import * as decisionModelModule from '../src/server/decisionModel';
import * as generateModule from '../src/server/llm/generate';
import {
  routeHierarchical,
  HierarchicalRouterConfig,
  validateAndSanitizeRoute,
  preserveMeaningfulTitle
} from '../src/server/llm/hierarchicalRouter';
import { detectUserIntent } from '../src/server/knowledgeAgent';
import {
  DEFAULT_PROJECTS,
  loadProjectsRegistry,
  discoverVaultStructure,
  ProjectDefinition
} from '../src/server/projectsRegistry';
import {
  isValidSemanticTag,
  sanitizeTagList,
  extractTags,
  curateOrthogonalTags
} from '../src/server/tags';
import { parseNote, mergeTags } from '../src/server/frontmatter';
import { triageManager } from '../src/server/triageManager';
import { pruneEmptyDirectories, pruneEmptyParentDirs } from '../src/server/directoryRevisor';
import {
  refineFile,
  processFile,
  setCurrentConfigForTest,
  setVaultStructureForTest
} from '../server';

const TEST_FIXTURE_PROJECTS: ProjectDefinition[] = [
  {
    id: 'cleannet',
    folder: '01_Projects/CleanNet',
    aliases: ['CleanNet', 'CleanNet Franchise', 'Клиннет'],
    coreDocTypes: ['Project Spec', 'Protocol', 'Roadmap', 'Business Plan', 'Implementation']
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
    aliases: ['ArtMaze', 'Art Maze', 'Артмейз'],
    coreDocTypes: ['Project Spec', 'Game Design', 'Roadmap']
  }
];

describe('C2 & C4: Hierarchical Routing and Dynamic Vault-Agnostic Discovery', () => {
  const sampleConfig: HierarchicalRouterConfig = {
    topLevelCategories: [
      'Project',
      'Essay/Knowledge',
      'Dialogue/Transcript',
      'Poem',
      'Screenplay/Script',
      'Idea',
      'Journal/Diary',
      'Technical/Code'
    ],
    typeRoutes: {
      'Essay/Knowledge': '03_Knowledge/Essays',
      'Dialogue/Transcript': '03_Knowledge/Dialogues',
      'Poem': '03_Knowledge/Poems',
      'Screenplay/Script': '03_Knowledge/Scripts',
      'Idea': '05_Ideas/Inbox',
      'Journal/Diary': '04_Journal/Daily',
      'Technical/Code': '03_Knowledge/Technical'
    },
    projects: [
      ...TEST_FIXTURE_PROJECTS,
      ...Array.from({ length: 25 }, (_, i) => ({
        id: `extra-proj-${i}`,
        folder: `01_Projects/ExtraProject${i}`,
        aliases: [`ExtraProject${i}`],
        coreDocTypes: ['Project Spec']
      }))
    ],
    decisionModelUrl: 'http://127.0.0.1:1234',
    threshold: 0.80
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has zero hardcoded DEFAULT_PROJECTS and discovers projects dynamically from any vault on disk', async () => {
    expect(DEFAULT_PROJECTS).toEqual([]);

    const customVault = path.join(process.cwd(), 'tests', '_temp_custom_pc_vault');
    await fsPromises.rm(customVault, { recursive: true, force: true });
    try {
      await fsPromises.mkdir(path.join(customVault, '01_Projects', 'QuantumEngine'), { recursive: true });
      await fsPromises.mkdir(path.join(customVault, '01_Projects', 'BioTechLab'), { recursive: true });
      await fsPromises.mkdir(path.join(customVault, '03_Knowledge', 'Notes'), { recursive: true });

      const discovered = await loadProjectsRegistry(customVault);
      expect(discovered.map(p => p.id).sort()).toEqual(['biotechlab', 'quantumengine']);
      expect(discovered.find(p => p.id === 'quantumengine')?.folder).toBe('01_Projects/QuantumEngine');

      const structure = await discoverVaultStructure(customVault);
      expect(structure.projectsRoot).toBe('01_Projects');
      expect(structure.folders).toContain('01_Projects/QuantumEngine');
      expect(structure.folders).toContain('03_Knowledge/Notes');
    } finally {
      await fsPromises.rm(customVault, { recursive: true, force: true });
    }
  });

  it('rejects garbage non-word tags like #01G23, hex codes, and numeric IDs while preserving real word tags', () => {
    expect(isValidSemanticTag('#01G23')).toBe(false);
    expect(isValidSemanticTag('01G23')).toBe(false);
    expect(isValidSemanticTag('#w3x06')).toBe(false);
    expect(isValidSemanticTag('#a3ps9')).toBe(false);
    expect(isValidSemanticTag('#01_Projects')).toBe(false);
    expect(isValidSemanticTag('#12345')).toBe(false);
    expect(isValidSemanticTag('#ff00aa')).toBe(false);

    expect(isValidSemanticTag('architecture')).toBe(true);
    expect(isValidSemanticTag('system-prompt')).toBe(true);
    expect(isValidSemanticTag('философия')).toBe(true);
    expect(isValidSemanticTag('нейросети')).toBe(true);
    expect(isValidSemanticTag('ru')).toBe(true);
    expect(isValidSemanticTag('web3')).toBe(true);

    const sanitized = sanitizeTagList(['#01G23', 'w3x06', '123', 'architecture', 'философия', '01_Projects']);
    expect(sanitized).toEqual(['architecture', 'философия']);

    const extracted = extractTags(
      'tags: ["01G23", "w3x06", "valid-tag"]',
      'Текст с тегом #01G23 и нормальным тегом #архитектура и #1234',
      'Note.md'
    );
    expect(extracted).toEqual(['valid-tag', 'архитектура']);

    const data: Record<string, unknown> = { tags: ['01G23', 'existing-word'] };
    mergeTags(data, ['#01G23', 'w3x06', 'new-word']);
    expect(data.tags).toEqual(['existing-word', 'new-word']);

    // Multi-level Orthogonal Taxonomy tags (L0-L7)
    expect(isValidSemanticTag('type/research')).toBe(true);
    expect(isValidSemanticTag('domain/AI/LLM')).toBe(true);
    expect(isValidSemanticTag('project/Hermes')).toBe(true);
    expect(isValidSemanticTag('priority/P1')).toBe(true);
    expect(isValidSemanticTag('concept/World-1149')).toBe(true);
    expect(isValidSemanticTag('a/b/c/d')).toBe(false); // Exceeds max depth of 3

    const curated = curateOrthogonalTags({
      rawTags: ['#01G23', 'w3x06', 'architecture', 'ai', 'p1'],
      title: 'Системный промпт и архитектура Hermes Agent',
      filename: 'Системный промпт для Hermes Agent.md',
      body: 'Исследование и спецификация мультиагентной маршрутизации локальной LLM.',
      folder: '03_Knowledge/Technical',
      replaceExisting: true
    });
    expect(curated).toContain('domain/AI/agents');
    expect(curated).toContain('project/Hermes');
    expect(curated).toContain('priority/P1');
    expect(curated.some(t => t.includes('01G23'))).toBe(false);
  });

  it('reaches 03_Knowledge/Poems without being truncated by >25 project folders', async () => {
    vi.spyOn(routerModule, 'chooseOne').mockResolvedValueOnce({
      chosen: { letter: 'D', option: 'Poem', probability: 0.95 },
      confidence: 0.95,
      decisions: [{ letter: 'D', option: 'Poem', probability: 0.95 }],
      calibrated: true,
      optionsCount: 8,
      question: 'К какой категории относится эта заметка?'
    });

    const result = await routeHierarchical(
      'Стихотворение о ночи и звездах...',
      'Ночь.md',
      'Ночь',
      sampleConfig
    );

    expect(result.suggestedFolder).toBe('03_Knowledge/Poems');
    expect(result.level1Category).toBe('Poem');
    expect(result.totalConfidence).toBe(0.95);
    expect(result.isCoreDocType).toBe(false);
  });

  it('keeps non-core project notes in type folder and attaches project link (C4.3)', async () => {
    vi.spyOn(routerModule, 'chooseOne')
      .mockResolvedValueOnce({
        chosen: { letter: 'A', option: 'Project', probability: 0.92 },
        confidence: 0.92,
        decisions: [],
        calibrated: true,
        optionsCount: 8,
        question: 'К какой категории относится эта заметка?'
      })
      .mockResolvedValueOnce({
        chosen: { letter: 'B', option: 'Neuromicon', probability: 0.96 },
        confidence: 0.96,
        decisions: [],
        calibrated: true,
        optionsCount: 20,
        question: 'К какому проекту относится эта заметка?'
      })
      .mockResolvedValueOnce({
        chosen: { letter: 'B', option: 'Essay/Knowledge', probability: 0.90 },
        confidence: 0.90,
        decisions: [],
        calibrated: true,
        optionsCount: 7,
        question: 'Какой жанр/тип у этой заметки?'
      });

    const result = await routeHierarchical(
      'Философское эссе о влиянии искусственного интеллекта на творчество в рамках концепции Neuromicon.',
      'Эссе о разуме.md',
      'Neuromicon: Философия разума',
      sampleConfig
    );

    expect(result.suggestedFolder).toBe('03_Knowledge/Essays');
    expect(result.projectLink).toBe('[[neuromicon]]');
    expect(result.isCoreDocType).toBe(false);
  });

  it('physically routes core document types into 01_Projects/<id>', async () => {
    vi.spyOn(routerModule, 'chooseOne')
      .mockResolvedValueOnce({
        chosen: { letter: 'A', option: 'Project', probability: 0.95 },
        confidence: 0.95,
        decisions: [],
        calibrated: true,
        optionsCount: 8,
        question: 'К какой категории относится эта заметка?'
      })
      .mockResolvedValueOnce({
        chosen: { letter: 'A', option: 'CleanNet', probability: 0.98 },
        confidence: 0.98,
        decisions: [],
        calibrated: true,
        optionsCount: 20,
        question: 'К какому проекту относится эта заметка?'
      });

    const result = await routeHierarchical(
      'Техническая спецификация и протокол франшизы CleanNet.',
      'CleanNet_Spec_v1.md',
      'CleanNet Technical Protocol & Roadmap',
      sampleConfig
    );

    expect(result.suggestedFolder).toBe('01_Projects/CleanNet');
    expect(result.isCoreDocType).toBe(true);
  });
});

describe('D-LIVE: Hierarchical Router Connected to Real Pipeline (refineFile & processFile)', () => {
  const tempVault = path.join(process.cwd(), 'tests', '_temp_dlive_vault');

  beforeEach(async () => {
    await fsPromises.rm(tempVault, { recursive: true, force: true });
    await fsPromises.mkdir(path.join(tempVault, '00_Inbox'), { recursive: true });
    await fsPromises.mkdir(path.join(tempVault, '03_Knowledge', 'Unsorted'), { recursive: true });
    await fsPromises.mkdir(path.join(tempVault, '01_Projects', 'Neuromicon'), { recursive: true });
    await fsPromises.mkdir(path.join(tempVault, '01_Projects', 'CleanNet'), { recursive: true });

    const manyProjectFolders = Array.from({ length: 30 }, (_, i) => `01_Projects/Project_${String(i).padStart(2, '0')}`);
    for (const f of manyProjectFolders) {
      await fsPromises.mkdir(path.join(tempVault, f), { recursive: true });
    }
    await fsPromises.mkdir(path.join(tempVault, '03_Knowledge', 'Poems'), { recursive: true });
    await fsPromises.mkdir(path.join(tempVault, '03_Knowledge', 'Essays'), { recursive: true });

    setVaultStructureForTest([...manyProjectFolders, '03_Knowledge/Poems', '03_Knowledge/Essays']);
    setCurrentConfigForTest({
      vaultPath: tempVault,
      llamaUrl: 'http://127.0.0.1:8080',
      decisionModelUrl: 'http://127.0.0.1:1234',
      enableDecisionModel: true,
      decisionMode: 'hybrid',
      decisionConfidenceThreshold: 0.80
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fsPromises.rm(tempVault, { recursive: true, force: true });
  });

  it('refineFile routes a poem to 03_Knowledge/Poems, strips garbage tags, and prunes empty parent folder', async () => {
    const notePath = path.join(tempVault, '03_Knowledge', 'Unsorted', 'Звездная_ночь.md');
    await fsPromises.writeFile(
      notePath,
      '---\ntitle: "Звездная ночь"\n---\nТихо светит луна над безмолвной рекой,\nЗвезды шепчут стихи в вышине.',
      'utf-8'
    );

    vi.spyOn(decisionModelModule, 'isDecisionServerReachable').mockResolvedValue(true);
    vi.spyOn(routerModule, 'chooseOne').mockResolvedValueOnce({
      chosen: { letter: 'D', option: 'Poem', probability: 0.94 },
      confidence: 0.94,
      decisions: [{ letter: 'D', option: 'Poem', probability: 0.94 }],
      calibrated: true,
      optionsCount: 8,
      question: 'К какой категории относится эта заметка?'
    });

    let capturedPrompt = '';
    vi.spyOn(generateModule, 'generateStructured').mockImplementationOnce(async (opts) => {
      capturedPrompt = opts.messages[0]?.content || '';
      return {
        improved_title: 'Звездная ночь',
        improved_tags: ['ru', 'поэзия', 'лирика', '#01G23', 'w3x06'],
        suggested_path: '01_Projects/Project_00'
      };
    });

    await refineFile(notePath);

    expect(capturedPrompt).toContain('JEV-STYLE DECISION GUIDANCE');
    expect(capturedPrompt).toContain('03_Knowledge/Poems');
    expect(capturedPrompt).not.toContain('EXISTING FOLDERS IN VAULT');

    const expectedDest = path.join(tempVault, '03_Knowledge', 'Poems', 'Звездная ночь.md');
    expect(fs.existsSync(expectedDest)).toBe(true);

    // Verify garbage tags (#01G23, w3x06) were stripped and empty source folder 03_Knowledge/Unsorted was automatically pruned!
    const saved = parseNote(await fsPromises.readFile(expectedDest, 'utf-8'));
    expect(saved.data.tags).toEqual(['ru', 'поэзия', 'лирика']);
    expect(fs.existsSync(path.join(tempVault, '03_Knowledge', 'Unsorted'))).toBe(false);
  });

  it('refineFile and processFile keep non-core project notes in genre folder and set frontmatter project: "[[id]]"', async () => {
    const inboxNotePath = path.join(tempVault, '00_Inbox', 'Neuromicon_Philosophy.md');
    await fsPromises.writeFile(
      inboxNotePath,
      '---\ncustom_field: "preserved_value"\n---\nФилософское размышление о природе сознания во вселенной Neuromicon.',
      'utf-8'
    );

    vi.spyOn(decisionModelModule, 'isDecisionServerReachable').mockResolvedValue(true);
    vi.spyOn(routerModule, 'chooseOne')
      .mockResolvedValueOnce({
        chosen: { letter: 'A', option: 'Project', probability: 0.92 },
        confidence: 0.92,
        decisions: [],
        calibrated: true,
        optionsCount: 8,
        question: 'К какой категории относится эта заметка?'
      })
      .mockResolvedValueOnce({
        chosen: { letter: 'B', option: 'Neuromicon', probability: 0.95 },
        confidence: 0.95,
        decisions: [],
        calibrated: true,
        optionsCount: 20,
        question: 'К какому проекту относится эта заметка?'
      })
      .mockResolvedValueOnce({
        chosen: { letter: 'B', option: 'Essay/Knowledge', probability: 0.91 },
        confidence: 0.91,
        decisions: [],
        calibrated: true,
        optionsCount: 7,
        question: 'Какой жанр/тип у этой заметки?'
      });

    vi.spyOn(generateModule, 'generateStructured').mockResolvedValueOnce({
      title: 'Философия сознания Neuromicon',
      summary: 'Эссе о природе сознания.',
      category: '01_Projects/Neuromicon',
      tags: ['ru', 'философия', 'сознание'],
      related_concepts: ['Сознание']
    });

    await processFile(inboxNotePath);

    const expectedEssayPath = path.join(tempVault, '03_Knowledge', 'Essays', 'Философия сознания Neuromicon.md');
    expect(fs.existsSync(expectedEssayPath)).toBe(true);

    const savedContent = await fsPromises.readFile(expectedEssayPath, 'utf-8');
    const parsed = parseNote(savedContent);
    expect(parsed.data.project).toBe('[[neuromicon]]');
    expect(parsed.data.custom_field).toBe('preserved_value');
  });

  it('enqueues ambiguous notes into triageManager and proposes new alternatives via rethinkAlternative when user clicks NO', async () => {
    const notePath = path.join(tempVault, '03_Knowledge', 'Unsorted', 'Ambiguous_Note.md');
    await fsPromises.writeFile(
      notePath,
      'Заметка со смешанным содержанием о разработке и дневниковых записях.',
      'utf-8'
    );

    vi.spyOn(decisionModelModule, 'isDecisionServerReachable').mockResolvedValue(true);
    vi.spyOn(routerModule, 'chooseOne').mockResolvedValueOnce({
      chosen: { letter: 'B', option: 'Essay/Knowledge', probability: 0.55 },
      confidence: 0.55,
      decisions: [
        { letter: 'B', option: 'Essay/Knowledge', probability: 0.55 },
        { letter: 'G', option: 'Journal/Diary', probability: 0.45 }
      ],
      calibrated: true,
      optionsCount: 8,
      question: 'К какой категории относится эта заметка?'
    });

    vi.spyOn(generateModule, 'generateStructured').mockResolvedValueOnce({
      improved_title: 'Смешанная заметка',
      improved_tags: ['ru', 'заметка'],
      suggested_path: '03_Knowledge/Essays'
    });

    await refineFile(notePath);

    const queue = triageManager.getQueue();
    const queuedItem = queue.find(q => q.filename === 'Ambiguous_Note.md');
    expect(queuedItem).toBeDefined();
    expect(queuedItem?.confidence).toBe(0.55);
    expect(queuedItem!.questions.length).toBeGreaterThanOrEqual(2);

    // Exhaust initial questions with "no" and verify rethinkAlternative generates a new alternative proposal
    const initialLen = queuedItem!.questions.length;
    for (let i = 0; i < initialLen; i++) {
      const isLast = i === initialLen - 1;
      const res = await triageManager.answerQuestion(
        queuedItem!.id,
        i,
        'no',
        tempVault,
        isLast
          ? {
              rethinkAlternative: async (_item, rejectedFolders) => {
                expect(rejectedFolders.length).toBeGreaterThanOrEqual(2);
                return {
                  option: '03_Knowledge/Technical',
                  folder: '03_Knowledge/Technical',
                  reason: 'AI re-evaluated note content'
                };
              }
            }
          : undefined
      );
      if (isLast) {
        expect(res.rethought).toBe(true);
        expect(res.status).toBe('pending');
        expect(res.nextQuestion?.targetFolder).toBe('03_Knowledge/Technical');
      }
    }
  });

  it('prevents 7B LLM from routing unrelated notes into foreign projects and preserves series/project titles', () => {
    const routeHermes = validateAndSanitizeRoute({
      llmSuggestedPath: '01_Projects/ArtMaze',
      originalFilename: 'Системный промпт для Hermes Agent.md',
      noteTitle: 'Системный промпт для Hermes Agent',
      noteBody: 'Ты — автономный агент Hermes. Инструкции по вызову инструментов...',
      existingTags: ['system-prompt', 'architecture'],
      projects: TEST_FIXTURE_PROJECTS
    });
    expect(routeHermes).toBe('03_Knowledge/Technical');

    const routeUna = validateAndSanitizeRoute({
      llmSuggestedPath: '01_Projects/CleanNet',
      originalFilename: 'Техническое Задание Персональный AI-ассистент UNA.md',
      noteTitle: 'Техническое Задание Персональный AI-ассистент UNA',
      noteBody: 'Спецификация функций персонального ассистента UNA.',
      existingTags: ['ru'],
      projects: TEST_FIXTURE_PROJECTS
    });
    expect(routeUna).toBe('01_Projects/UNA');

    const routeToothpaste = validateAndSanitizeRoute({
      llmSuggestedPath: '01_Projects/CleanNet',
      originalFilename: 'Серьезная проблема и инновационное решение в производстве зубной пасты.md',
      noteTitle: 'Проблема с производством зубной пасты и инновационное решение',
      noteBody: 'Инновационная технология дозирования пасты без отходов.',
      existingTags: ['ru'],
      projects: TEST_FIXTURE_PROJECTS
    });
    expect(routeToothpaste).toBe('05_Ideas/Inbox');

    const routeMeeting = validateAndSanitizeRoute({
      llmSuggestedPath: '01_Projects/Active',
      originalFilename: 'Тезисы для целей встречи.md',
      noteTitle: 'Тезисы для встречи',
      noteBody: 'Повестка обсуждения с командой.',
      existingTags: ['agenda'],
      projects: TEST_FIXTURE_PROJECTS
    });
    expect(routeMeeting).toBe('03_Knowledge/Dialogues');

    expect(preserveMeaningfulTitle('Свобода выбора', 'СмыслИИ 8.md')).toBe('СмыслИИ 8');
    expect(preserveMeaningfulTitle('Структура проекта', 'Структура проекта MAIN.md')).toBe('Структура проекта MAIN');
  });

  it('prunes empty directories recursively including folders containing OS junk files (.DS_Store)', async () => {
    const emptyNested = path.join(tempVault, '01_Projects', 'OldEmptyProject', 'Subfolder');
    await fsPromises.mkdir(emptyNested, { recursive: true });
    await fsPromises.writeFile(path.join(emptyNested, '.DS_Store'), 'junk', 'utf-8');

    const removed = await pruneEmptyParentDirs(tempVault, emptyNested);
    expect(removed.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(tempVault, '01_Projects', 'OldEmptyProject'))).toBe(false);
  });

  it('detects Knowledge Chat Agent intents for search, plan, create, edit, and move', () => {
    expect(detectUserIntent('Найди все заметки про AI-ассистентов и промпты', false)).toBe('search');
    expect(detectUserIntent('Составь план запуска проекта', false)).toBe('plan');
    expect(detectUserIntent('Создай новую заметку с архитектурой системы', false)).toBe('create');
    expect(detectUserIntent('Дополни эту заметку списком задач', true)).toBe('edit');
    expect(detectUserIntent('Перемести этот файл в папку 03_Knowledge/Technical', true)).toBe('move');
  });
});
