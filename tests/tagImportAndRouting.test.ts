import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TAG_TAXONOMY,
  DEFAULT_PROJECT_TAG_PROFILES,
  DEFAULT_TAG_ROUTES,
  parseTagTaxonomyImport,
  exportTagTaxonomyToMarkdown,
  inferProjectFromNoteAndTaxonomy,
  resolveDirectoryFromTags,
  curateOrthogonalTags
} from '../src/server/tags.js';
import { buildSemanticKnowledgeClusters } from '../src/server/semanticClustering.js';

describe('Tag Import/Export, Project Detection & Tag-Based Directory Routing', () => {
  it('parses Markdown tag lists (project-hashtags-expanded.md format) with axes and project clusters', () => {
    const markdownSpec = `
# Multi-Level Tag Taxonomy

## L0 — системный уровень
\`\`\`text
#system
#meta
#knowledge
#protocol
\`\`\`

## L1 — тип объекта
\`\`\`text
#type/project
#type/research
#type/whitepaper
\`\`\`

## L2 — домен
\`\`\`text
#domain/AI
#domain/semantics
#domain/hypergraph
#domain/film
\`\`\`

## L3 — конкретные системы / проекты
\`\`\`text
#project/Hermes
#project/Neuromicon
#project/Nova-Lab
#research/semantic-hypergraph
\`\`\`

## L4 — функция / подсистема

Например Hermes:
\`\`\`text
#project/Hermes
#system/agent-orchestration
#system/multi-agent
#system/local-LLM
\`\`\`

Nova-Lab:
\`\`\`text
#project/Nova-Lab
#system/quantum-sim
#concept/Photonic-Mesh
#domain/quantum-computing
\`\`\`
`;

    const parsed = parseTagTaxonomyImport(markdownSpec, { mode: 'merge' });

    expect(parsed.importedTagsCount).toBeGreaterThan(10);
    const novaProfile = parsed.projectProfiles.find(
      p => p.id.toLowerCase() === 'nova-lab'
    );
    expect(novaProfile).toBeDefined();
    expect(novaProfile?.projectTag).toBe('Nova-Lab');
    expect(novaProfile?.targetFolder).toBe('01_Projects/Nova-Lab');
    expect(novaProfile?.associatedTags).toEqual(
      expect.arrayContaining(['quantum-sim', 'Photonic-Mesh', 'quantum-computing'])
    );
  });

  it('exports taxonomy and project profiles to clean Markdown and re-imports losslessly', () => {
    const md = exportTagTaxonomyToMarkdown({
      axes: DEFAULT_TAG_TAXONOMY,
      projectProfiles: DEFAULT_PROJECT_TAG_PROFILES,
      tagRoutes: DEFAULT_TAG_ROUTES
    });
    expect(md).toContain('# Orthogonal Tag Taxonomy & Project Hashtags (L0–L7)');
    expect(md).toContain('#Hermes');
    expect(md).toContain('#Neuromicon');
    expect(md).toContain('#World-1149');

    const reimported = parseTagTaxonomyImport(md, { mode: 'merge' });
    expect(reimported.projectProfiles.some(p => p.id === 'Hermes')).toBe(true);
    expect(reimported.projectProfiles.some(p => p.id === 'Neuromicon')).toBe(true);
  });

  it('infers project affiliation from associated concept/system tags and note content', () => {
    const inference = inferProjectFromNoteAndTaxonomy({
      filename: 'world_1149_episode_draft.md',
      title: 'Протокол Контакт и дефрагментация в Мире 1149',
      body: 'Сценарий трансмедийного ARG проекта. Здесь рассматривается #concept/World-1149 и #concept/Defragmentation в рамках E=M×C².',
      existingTags: ['concept/World-1149'],
      projectProfiles: DEFAULT_PROJECT_TAG_PROFILES
    });

    expect(inference.matchedProfile?.id).toBe('Neuromicon');
    expect(inference.matchedProjectTag).toBe('Neuromicon');
    expect(inference.targetFolder).toBe('01_Projects/Neuromicon');
    expect(inference.matchedAssociatedTags).toEqual(
      expect.arrayContaining(['World-1149', 'Defragmentation'])
    );
  });

  it('updates note tags using project profiles and routes file to the project directory', () => {
    const tags = curateOrthogonalTags({
      title: 'Multi-Agent Routing and Memory Protocol for Hermes',
      body: 'Architecture of local LLM agent orchestration and free API routing in Hermes.',
      rawTags: ['system/agent-orchestration', 'system/local-LLM', 'en'],
      projectProfiles: DEFAULT_PROJECT_TAG_PROFILES
    });

    expect(tags).toContain('Hermes');
    expect(tags).toContain('agent-orchestration');
    expect(tags).toContain('active');

    const resolved = resolveDirectoryFromTags({
      tags,
      projectProfiles: DEFAULT_PROJECT_TAG_PROFILES
    });

    expect(resolved.targetFolder).toBe('01_Projects/Hermes');
    expect(resolved.matchedByTag).toBe('Hermes');
  });

  it('routes research, idea, meeting, and archived notes to appropriate directories according to tags', () => {
    const researchRoute = resolveDirectoryFromTags({
      tags: ['type/research', 'research/semantic-hypergraph', 'domain/hypergraph', 'status/active'],
      projectProfiles: DEFAULT_PROJECT_TAG_PROFILES
    });
    expect(researchRoute.targetFolder).toBe('03_Knowledge/Research/semantic-hypergraph');

    const archiveRoute = resolveDirectoryFromTags({
      tags: ['type/project', 'project/Restore-Dumaguete', 'status/archived'],
      projectProfiles: DEFAULT_PROJECT_TAG_PROFILES
    });
    expect(archiveRoute.targetFolder).toBe('06_Archive');

    const ideaRoute = resolveDirectoryFromTags({
      tags: ['type/idea', 'status/idea', 'domain/AI'],
      projectProfiles: DEFAULT_PROJECT_TAG_PROFILES
    });
    expect(ideaRoute.targetFolder).toBe('05_Ideas');

    const meetingRoute = resolveDirectoryFromTags({
      tags: ['type/meeting', 'status/active'],
      projectProfiles: DEFAULT_PROJECT_TAG_PROFILES
    });
    expect(meetingRoute.targetFolder).toBe('04_Journal');
  });

  it('clusters documents by full semantic body meaning even when titles have zero overlap', () => {
    const result = buildSemanticKnowledgeClusters({
      notes: [
        {
          path: '00_Inbox/tuesday_call_notes.md',
          filename: 'tuesday_call_notes.md',
          title: 'Заметки со вторничного созвона',
          body: 'Обсуждали архитектуру автономных мультиагентов в системе Гермес, долговременную память агентов и локальный роутинг через бесплатные API.',
          folder: '00_Inbox',
          tags: ['meeting']
        },
        {
          path: '00_Inbox/spec_v2.md',
          filename: 'spec_v2.md',
          title: 'Architecture Spec Draft',
          body: 'Technical specification for Hermes multi-agent orchestration, episodic memory persistence, and local-LLM routing.',
          folder: '00_Inbox',
          tags: ['system/agent-orchestration']
        },
        {
          path: '00_Inbox/fragment_04.md',
          filename: 'fragment_04.md',
          title: 'Черновик четвёртого эпизода',
          body: 'Развитие трансмедиа сюжета в мире 1149: активация Протокола Контакт и дефрагментация сознания героев.',
          folder: '00_Inbox',
          tags: []
        },
        {
          path: '00_Inbox/arg_outline.md',
          filename: 'arg_outline.md',
          title: 'Narrative Outline',
          body: 'Neuromicon transmedia ARG design for World-1149 exploring Protocol-Contact and Defragmentation.',
          folder: '00_Inbox',
          tags: ['#project/Neuromicon']
        }
      ]
    });

    expect(result.totalNotes).toBe(4);
    const hermesCluster = result.clusters.find(c => c.dominantProject === 'Hermes');
    expect(hermesCluster).toBeDefined();
    expect(hermesCluster!.notes.map(n => n.filename).sort()).toEqual([
      'spec_v2.md',
      'tuesday_call_notes.md'
    ]);
    expect(hermesCluster!.recommendedFolder).toBe('01_Projects/Hermes');
    // Every suggested tag must be 100% clean (no '/')
    for (const c of result.clusters) {
      for (const t of c.coreTags) {
        expect(t.includes('/')).toBe(false);
      }
      for (const n of c.notes) {
        for (const st of n.suggestedTags) {
          expect(st.includes('/')).toBe(false);
        }
      }
    }

    const neuroCluster = result.clusters.find(c => c.dominantProject === 'Neuromicon');
    expect(neuroCluster).toBeDefined();
    expect(neuroCluster!.notes.map(n => n.filename).sort()).toEqual([
      'arg_outline.md',
      'fragment_04.md'
    ]);
    expect(neuroCluster!.recommendedFolder).toBe('01_Projects/Neuromicon');
  });
});
