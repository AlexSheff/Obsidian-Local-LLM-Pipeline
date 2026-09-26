import { describe, it, expect } from 'vitest';
import {
  detectScenarioMarkers,
  detectProjectAffiliation
} from '../src/server/directoryRevisor';
import { llamaManager } from '../src/server/llamaManager';
import { checkGhostNote, isJunkFile } from '../src/server/documentExtractor';

describe('Directory Revisor & Contradiction Analyzer', () => {
  describe('detectScenarioMarkers', () => {
    it('detects scenario from filename keyword', () => {
      const res = detectScenarioMarkers('Обычный текст заметки о делах.', 'Сценарий_Серия_1.md');
      expect(res.isScenario).toBe(true);
      expect(res.markers.some(m => m.includes('filename') || m.includes('Screenplay'))).toBe(true);
    });

    it('detects scenario from screenplay scene headings (INT/EXT or ИНТ/НАТ)', () => {
      const screenplayText = `
# Встреча в бункере

ИНТ. БУНКЕР - НОЧЬ
Свет тускло мигает. За столом сидит Майор.
      `;
      const res = detectScenarioMarkers(screenplayText, 'Заметка 42.md');
      expect(res.isScenario).toBe(true);
      expect(res.markers.some(m => m.includes('INT./EXT.') || m.includes('ИНТ./НАТ.'))).toBe(true);
      expect(res.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('detects scenario from character dialogue speech patterns across 3+ distinct speakers', () => {
      const dialogueText = `
ДЖОН: Мы должны двигаться немедленно.
САРА (шепотом): Охрана на периметре.
МАЙК: Я прикрою выход.
      `;
      const res = detectScenarioMarkers(dialogueText, 'draft.md');
      expect(res.isScenario).toBe(true);
      expect(res.markers.some(m => m.includes('Dialogue') || m.includes('speakers'))).toBe(true);
    });

    it('rejects common structured section headers like ИТОГ:, ЗАДАЧА:, СТАТУС: (Negative test C5)', () => {
      const normalNote = `
ИТОГ: Проект завершен успешно.
ЗАДАЧА: Подготовить документацию к понедельнику.
СТАТУС: В процессе выполнения.
ВАЖНО: Проверить сетевые доступы.
      `;
      const res = detectScenarioMarkers(normalNote, 'MeetingMinutes.md');
      expect(res.isScenario).toBe(false);
      expect(res.markers.length).toBe(0);
    });

    it('detects scenario from dramaturgy keywords', () => {
      const narrativeText = 'В этом эпизоде сюжетная линия строится вокруг предательства, а кульминация наступает на крыше.';
      const res = detectScenarioMarkers(narrativeText, 'Idea.md');
      expect(res.isScenario).toBe(true);
      expect(res.markers.some(m => m.includes('Dramaturgical') || m.includes('сюжетная линия'))).toBe(true);
    });

    it('returns false for regular non-fiction notes', () => {
      const nonFictionText = 'Список покупок: хлеб, молоко, фильтры для воды. Не забыть позвонить бухгалтеру в 14:00.';
      const res = detectScenarioMarkers(nonFictionText, 'Задачи.md');
      expect(res.isScenario).toBe(false);
      expect(res.markers.length).toBe(0);
    });
  });

  describe('detectProjectAffiliation', () => {
    it('detects CleanNet project affiliation', () => {
      const res = detectProjectAffiliation('План развития франшизы cleannet на второй квартал', 'Report.md');
      expect(res).toBe('01_Projects/CleanNet');
    });

    it('detects ArtMaze project affiliation', () => {
      const res = detectProjectAffiliation('Концепция локаций для игры Артмейз', 'Locations.md');
      expect(res).toBe('01_Projects/ArtMaze');
    });

    it('returns null when no known project markers found', () => {
      const res = detectProjectAffiliation('Рецепт приготовления яблочного пирога', 'Pie.md');
      expect(res).toBeNull();
    });
  });

  describe('Ghost Note and Junk File Identification', () => {
    it('detects ghost notes that have frontmatter/links but no real body text (User exact example)', () => {
      const userExampleBody = `
> **Связанные темы:** [[ArtMaze]], [[CleanNet]], [[Neuromicon]], [[AGOS-LUNA]], [[Crypto]]

> **Связанные темы:** [[New Team]], [[Project]], [[Timeline]], [[Expectations]], [[Communication]]
`;
      const check = checkGhostNote(userExampleBody);
      expect(check.isGhost).toBe(true);
      expect(check.reason).toContain('Empty ghost note');
    });

    it('detects ghost notes even when passed full file content with frontmatter (User exact document 5.md)', () => {
      const fullDoc = `---
title: "Transcript of the Meeting with the New Team"
category: 03_Knowledge/Dialogues
tags:
  - "New-Team"
  - "Project"
  - "Timelines"
  - "Goals"
  - "Communication"
  - "meeting-notes"
  - "team-update"
  - "project-status"
summary: "Meeting notes discussing timelines, goals, and communication for the new team."
ai_refined: true
---
> **Связанные темы:** [[ArtMaze]], [[CleanNet]], [[Neuromicon]], [[AGOS-LUNA]], [[Crypto]]

> **Связанные темы:** [[New Team]], [[Project]], [[Timelines]], [[Goals]], [[Communication]]
`;
      const check = checkGhostNote(fullDoc);
      expect(check.isGhost).toBe(true);
      expect(check.reason).toContain('Empty ghost note');
    });

    it('detects empty strings and whitespace as empty files', () => {
      expect(checkGhostNote('').isGhost).toBe(true);
      expect(checkGhostNote('   \n\n\t  ').isGhost).toBe(true);
    });

    it('returns false for notes that actually contain document text', () => {
      const validBody = `
> **Related topics:** [[Architecture]], [[Design]]

## Meeting Minutes
We discussed the release timeline and approved the sprint budget.
`;
      const check = checkGhostNote(validBody);
      expect(check.isGhost).toBe(false);
    });

    it('identifies junk files by extension and filename', () => {
      expect(isJunkFile('.DS_Store', 6148).isJunk).toBe(true);
      expect(isJunkFile('Thumbs.db', 12000).isJunk).toBe(true);
      expect(isJunkFile('~$MeetingNotes.docx', 162).isJunk).toBe(true);
      expect(isJunkFile('notes.bak', 500).isJunk).toBe(true);
      expect(isJunkFile('empty.txt', 0).isJunk).toBe(true);
      expect(isJunkFile('RealDocument.docx', 50000).isJunk).toBe(false);
    });
  });
});

describe('Llama Manager & 16GB RAM Safeguards', () => {
  it('provides balanced profile configured strictly for 16GB RAM safety', () => {
    const profiles = llamaManager.getMemoryProfiles();
    const balanced = profiles.find(p => p.id === 'balanced_16gb');

    expect(balanced).toBeDefined();
    expect(balanced?.contextSize).toBe(2048);
    expect(balanced?.threads).toBeLessThanOrEqual(4);
    expect(balanced?.totalEstimatedRamGb).toBeLessThan(5.0);
    expect(balanced?.fits16GbRamSafely).toBe(true);
  });

  it('generates Windows .bat startup scripts with exact ports 1234 and 8080 and memory flags', () => {
    const scripts = llamaManager.generateBatScripts({
      modelsDir: 'D:/Obsidian/Alex/Vault/llm/models'
    });

    expect(scripts.tandemBat).toContain('--port 1234');
    expect(scripts.tandemBat).toContain('--port 8080');
    expect(scripts.tandemBat).toContain('-c 2048');
    expect(scripts.tandemBat).toContain('-t 4');
    expect(scripts.tandemBat).toContain('Hermes-3-Llama-3.2-3B.Q4_K_M.gguf');
    expect(scripts.tandemBat).toContain('Jev-Style-Qwen3.5-2B-Decision-Q4_K_M.gguf');

    expect(scripts.jevOnlyBat).toContain('--port 1234');
    expect(scripts.solo7bBat).toContain('Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf');
  });
});
