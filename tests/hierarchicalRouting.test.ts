import { describe, it, expect, vi } from 'vitest';
import * as routerModule from '../src/server/llm/router';
import { routeHierarchical, HierarchicalRouterConfig } from '../src/server/llm/hierarchicalRouter';
import { DEFAULT_PROJECTS } from '../src/server/projectsRegistry';

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
