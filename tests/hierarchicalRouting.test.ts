import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
const fsPromises = fs.promises;
import * as routerModule from '../src/server/llm/router';
import * as decisionModelModule from '../src/server/decisionModel';
import * as generateModule from '../src/server/llm/generate';
import { routeHierarchical, HierarchicalRouterConfig } from '../src/server/llm/hierarchicalRouter';
import { DEFAULT_PROJECTS } from '../src/server/projectsRegistry';
import { parseNote } from '../src/server/frontmatter';
import { triageManager } from '../src/server/triageManager';
import {
  refineFile,
  processFile,
  setCurrentConfigForTest,
  setVaultStructureForTest
} from '../server';

describe('C2 & C4: Hierarchical Routing and Project as Link', () => {
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
      ...DEFAULT_PROJECTS,
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
    // 1. Level 1 chooses Project
    // 2. Level 2 chooses Neuromicon
    // 3. Genre sub-check chooses Essay/Knowledge
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

    // It remains in 03_Knowledge/Essays, but receives projectLink [[neuromicon]]
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

  it('refineFile routes a poem to 03_Knowledge/Poems via routeHierarchical even when vault has 30+ project folders', async () => {
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
        improved_tags: ['ru', 'поэзия', 'лирика'],
        suggested_path: '01_Projects/Project_00' // Generative LLM hallucination overridden by high-confidence router
      };
    });

    await refineFile(notePath);

    // Decision guidance is injected and raw 30-folder list is suppressed
    expect(capturedPrompt).toContain('JEV-STYLE DECISION GUIDANCE');
    expect(capturedPrompt).toContain('03_Knowledge/Poems');
    expect(capturedPrompt).not.toContain('EXISTING FOLDERS IN VAULT');

    const expectedDest = path.join(tempVault, '03_Knowledge', 'Poems', 'Звездная ночь.md');
    expect(fs.existsSync(expectedDest)).toBe(true);
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

    // Should be placed in 03_Knowledge/Essays (genre folder), NOT 01_Projects/Neuromicon
    const expectedEssayPath = path.join(tempVault, '03_Knowledge', 'Essays', 'Философия сознания Neuromicon.md');
    expect(fs.existsSync(expectedEssayPath)).toBe(true);

    const savedContent = await fsPromises.readFile(expectedEssayPath, 'utf-8');
    const parsed = parseNote(savedContent);
    expect(parsed.data.project).toBe('[[neuromicon]]');
    expect(parsed.data.custom_field).toBe('preserved_value');
  });

  it('enqueues ambiguous notes into triageManager when confidence is below threshold', async () => {
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
  });
});

