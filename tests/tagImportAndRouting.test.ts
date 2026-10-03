import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
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
import {
  optimizeVaultForObsidian,
  ensureObsidianIgnoreFilters,
  deduplicateMocFiles,
  pruneOldSnapshots
} from '../src/server/vaultOptimizer.js';
import {
  buildProjectTrackingHarness,
  toggleProjectTaskInVault,
  syncProjectHarnessToVault
} from '../src/server/projectHarness.js';

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

  it('configures .obsidian/app.json ignore filters and optimizes startup speed', async () => {
    const tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian_opt_test_'));
    try {
      // 1. Setup simulated bloated vault
      const obsidianDir = path.join(tmpVault, '.obsidian');
      fs.mkdirSync(obsidianDir, { recursive: true });
      fs.writeFileSync(
        path.join(obsidianDir, 'app.json'),
        JSON.stringify({ userIgnoreFilters: ['node_modules'] }),
        'utf-8'
      );

      // Create old backup folders
      const snap1 = path.join(tmpVault, '99_System', '_refine_backup', '2026-09-01T00-00-00');
      const snap2 = path.join(tmpVault, '99_System', '_refine_backup', '2026-10-01T00-00-00');
      fs.mkdirSync(snap1, { recursive: true });
      fs.mkdirSync(snap2, { recursive: true });
      fs.writeFileSync(path.join(snap1, 'OldDoc1.md'), 'old backup 1', 'utf-8');
      fs.writeFileSync(path.join(snap1, 'OldDoc2.md'), 'old backup 2', 'utf-8');
      fs.writeFileSync(path.join(snap2, 'RecentDoc.md'), 'recent backup', 'utf-8');

      // Create bloated MOC file
      const mocsDir = path.join(tmpVault, '00_MOC');
      fs.mkdirSync(mocsDir, { recursive: true });
      const mocLines = ['# MOC Topics', ''];
      for (let i = 0; i < 40; i++) {
        mocLines.push('- [[DocA]] - Summary A');
      }
      mocLines.push('- [[DocB]] - Summary B');
      fs.writeFileSync(path.join(mocsDir, 'moc_topics.md'), mocLines.join('\n'), 'utf-8');

      // Run optimization
      const report = await optimizeVaultForObsidian(tmpVault, { keepSnapshots: 1 });

      expect(report.ignoreFiltersConfigured).toBe(true);
      expect(report.appliedIgnoreFilters).toContain('99_System/');
      expect(report.snapshotsPruned).toBeGreaterThanOrEqual(1);
      expect(report.mocLinesDeduplicated).toBeGreaterThan(0);

      // Verify .obsidian/app.json has ignore filters
      const appJson = JSON.parse(fs.readFileSync(path.join(obsidianDir, 'app.json'), 'utf-8'));
      expect(appJson.userIgnoreFilters).toContain('99_System/');
      expect(appJson.userIgnoreFilters).toContain('00_Inbox/Processed/');

      // Verify deduplicated MOC has unique bullets
      const cleanedMoc = fs.readFileSync(path.join(mocsDir, 'moc_topics.md'), 'utf-8');
      const docACount = (cleanedMoc.match(/\[\[DocA\]\]/g) || []).length;
      expect(docACount).toBe(1);
    } finally {
      fs.rmSync(tmpVault, { recursive: true, force: true });
    }
  });

  it('extracts tasks, builds Project Tracking Harness, toggles tasks, and syncs to 00_MOC dashboard', async () => {
    const tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), 'harness_test_'));
    try {
      const inboxDir = path.join(tmpVault, '00_Inbox');
      const projectHermesDir = path.join(tmpVault, '01_Projects', 'Hermes');
      fs.mkdirSync(inboxDir, { recursive: true });
      fs.mkdirSync(projectHermesDir, { recursive: true });

      // Note inside project folder with tasks
      fs.writeFileSync(
        path.join(projectHermesDir, 'hermes_core.md'),
        `---\ntitle: "Hermes Core Spec"\ntags:\n  - Hermes\n---\n# Hermes Core Spec\n\n- [ ] Implement local router\n- [x] Configure LLM endpoint\n`,
        'utf-8'
      );

      // Scattered note in 00_Inbox mentioning project Hermes
      fs.writeFileSync(
        path.join(inboxDir, 'meeting_notes.md'),
        `---\ntitle: "Tuesday Architecture Meeting"\ntags:\n  - meeting\n---\n# Tuesday Architecture Meeting\n\nDiscussion about #Hermes autonomous agent memory.\n\n- [ ] Test Jev 1234 router on 50 sample notes\n`,
        'utf-8'
      );

      const rawNotes = [
        {
          path: '01_Projects/Hermes/hermes_core.md',
          filename: 'hermes_core.md',
          title: 'Hermes Core Spec',
          body: '# Hermes Core Spec\n\n- [ ] Implement local router\n- [x] Configure LLM endpoint\n',
          folder: '01_Projects/Hermes',
          tags: ['Hermes'],
          modifiedTime: new Date().toISOString()
        },
        {
          path: '00_Inbox/meeting_notes.md',
          filename: 'meeting_notes.md',
          title: 'Tuesday Architecture Meeting',
          body: '# Tuesday Architecture Meeting\n\nDiscussion about #Hermes autonomous agent memory.\n\n- [ ] Test Jev 1234 router on 50 sample notes\n',
          folder: '00_Inbox',
          tags: ['meeting', 'Hermes'],
          modifiedTime: new Date().toISOString()
        }
      ];

      const report = buildProjectTrackingHarness({
        notes: rawNotes,
        projectProfiles: DEFAULT_PROJECT_TAG_PROFILES,
        discoveredProjects: [
          {
            id: 'Hermes',
            folder: '01_Projects/Hermes',
            aliases: ['Hermes', 'Гермес'],
            coreDocTypes: ['Project Spec']
          }
        ]
      });

      const hermesHarness = report.projects.find(p => p.id === 'Hermes');
      expect(hermesHarness).toBeDefined();
      expect(hermesHarness!.totalDocsCount).toBe(2);
      expect(hermesHarness!.inFolderDocsCount).toBe(1);
      expect(hermesHarness!.scatteredDocsCount).toBe(1);
      expect(hermesHarness!.openTasksCount).toBe(2);
      expect(hermesHarness!.completedTasksCount).toBe(1);

      // Test task toggle in file on disk
      const toggleRes = await toggleProjectTaskInVault(
        tmpVault,
        '01_Projects/Hermes/hermes_core.md',
        2 // index of "- [ ] Implement local router"
      );
      expect(toggleRes.success).toBe(true);
      expect(toggleRes.completed).toBe(true);

      const modifiedContent = fs.readFileSync(
        path.join(projectHermesDir, 'hermes_core.md'),
        'utf-8'
      );
      expect(modifiedContent).toContain('- [x] Implement local router');

      // Test syncProjectHarnessToVault: routes scattered note and creates MOC dashboard
      const syncRes = await syncProjectHarnessToVault({
        vaultPath: tmpVault,
        report,
        routeScattered: true
      });

      expect(syncRes.taggedCount).toBeGreaterThanOrEqual(1);
      expect(syncRes.routedCount).toBe(1);
      expect(fs.existsSync(path.join(tmpVault, '00_MOC', 'Project_Harness_Dashboard.md'))).toBe(true);
      expect(fs.existsSync(path.join(projectHermesDir, 'meeting_notes.md'))).toBe(true);

      const mocContent = fs.readFileSync(
        path.join(tmpVault, '00_MOC', 'Project_Harness_Dashboard.md'),
        'utf-8'
      );
      expect(mocContent).toContain('# Project Tracking Harness Dashboard');
      expect(mocContent).toContain('## #Hermes');
    } finally {
      fs.rmSync(tmpVault, { recursive: true, force: true });
    }
  });
});
