import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
const fsPromises = fs.promises;

import * as decisionModelModule from '../src/server/decisionModel';
import { noul, score, choice } from '../src/server/hypergraph/decisionClient';
import { RateLimiter } from '../src/server/hypergraph/rateLimiter';
import { TokensRegistry, normalizeToken } from '../src/server/hypergraph/tokensRegistry';
import { NoteExtractor } from '../src/server/hypergraph/extractor';
import { DnaEngine, computeHyperedgeId } from '../src/server/hypergraph/dnaEngine';
import { CostTracker } from '../src/server/hypergraph/costTracker';
import { OracleEngine } from '../src/server/hypergraph/oracle';
import { HypergraphTriageBridge } from '../src/server/hypergraph/triageBridge';
import { HypergraphMaintenance } from '../src/server/hypergraph/maintenance';

describe('Dynamic Semantic Hypergraph (DSH) — H0 to H7 Test Suite', () => {
  const testVault = path.join(process.cwd(), 'tests', '_temp_vault_dsh');

  beforeEach(async () => {
    await fsPromises.rm(testVault, { recursive: true, force: true });
    await fsPromises.mkdir(path.join(testVault, '99_System', 'hypergraph'), { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fsPromises.rm(testVault, { recursive: true, force: true });
  });

  describe('H0: Decision Primitives (Noul, Score, Choice) & Rate Limiter', () => {
    it('executes Noul primitive and returns probability of "Да"', async () => {
      vi.spyOn(decisionModelModule, 'decide').mockResolvedValueOnce({
        chosen: { letter: 'A', option: 'Да', probability: 0.88 },
        confidence: 0.88,
        decisions: [
          { letter: 'A', option: 'Да', probability: 0.88 },
          { letter: 'B', option: 'Нет', probability: 0.12 }
        ],
        calibrated: true,
        optionsCount: 2,
        question: 'Тестовый вопрос'
      });

      const p = await noul('Контекст заметки', 'Могут ли концепты связаться?');
      expect(p).toBe(0.88);
    });

    it('executes Score primitive and returns weighted rating in [1, 5]', async () => {
      vi.spyOn(decisionModelModule, 'decide').mockResolvedValueOnce({
        chosen: { letter: 'D', option: '4', probability: 0.70 },
        confidence: 0.70,
        decisions: [
          { letter: 'A', option: '1', probability: 0.05 },
          { letter: 'B', option: '2', probability: 0.05 },
          { letter: 'C', option: '3', probability: 0.10 },
          { letter: 'D', option: '4', probability: 0.70 },
          { letter: 'E', option: '5', probability: 0.10 }
        ],
        calibrated: true,
        optionsCount: 5,
        question: 'Оценка'
      });

      const rating = await score('Контекст', 'Оцени силу связи');
      expect(rating).toBeGreaterThanOrEqual(3.5);
      expect(rating).toBeLessThanOrEqual(4.5);
    });

    it('executes Choice primitive and returns distribution', async () => {
      vi.spyOn(decisionModelModule, 'decide').mockResolvedValueOnce({
        chosen: { letter: 'B', option: 'CleanNet', probability: 0.91 },
        confidence: 0.91,
        decisions: [
          { letter: 'A', option: 'ArtMaze', probability: 0.09 },
          { letter: 'B', option: 'CleanNet', probability: 0.91 }
        ],
        calibrated: true,
        optionsCount: 2,
        question: 'Выбор'
      });

      const res = await choice('Контекст', 'Какой проект?', ['ArtMaze', 'CleanNet']);
      expect(res.id).toBe('CleanNet');
      expect(res.distribution['CleanNet']).toBe(0.91);
    });

    it('RateLimiter enforces single concurrency', async () => {
      const limiter = new RateLimiter({ maxConcurrent: 1, minIntervalMs: 10 });
      let concurrent = 0;
      let maxConcurrentObserved = 0;

      const task = async () => {
        return limiter.execute(async () => {
          concurrent++;
          if (concurrent > maxConcurrentObserved) maxConcurrentObserved = concurrent;
          await new Promise(r => setTimeout(r, 20));
          concurrent--;
        });
      };

      await Promise.all([task(), task(), task()]);
      expect(maxConcurrentObserved).toBe(1);
    });
  });

  describe('H1: Tokens Registry', () => {
    it('normalizes tokens keeping Cyrillic intact and stripping symbols', () => {
      expect(normalizeToken('Нейромикон')).toBe('нейромикон');
      expect(normalizeToken('CleanNet: Franchise & Protocol!')).toBe('cleannet-franchise-protocol');
      expect(normalizeToken('  #concept/data-flow  ')).toBe('concept-data-flow');
    });

    it('idempotently registers tokens and merges aliases', async () => {
      const registry = new TokensRegistry(testVault);
      await registry.load();

      const t1 = registry.registerToken({
        key: 'Нейромикон',
        kind: 'concept',
        sourceNote: '01_Projects/Neuromicon/Intro.md',
        aliases: ['Neuromicon', 'Нейромикон']
      });

      expect(t1.key).toBe('нейромикон');

      // Re-registering with new alias
      const t2 = registry.registerToken({
        key: 'Нейромикон',
        kind: 'concept',
        sourceNote: '01_Projects/Neuromicon/Doc2.md',
        aliases: ['Нейро-Сетка']
      });

      expect(t2.aliases).toContain('Нейро-Сетка');
      expect(t2.aliases).toContain('Neuromicon');
      expect(registry.getAll().filter(t => t.key === 'нейромикон').length).toBe(1);

      await registry.save();

      // Reload from disk
      const reloaded = new TokensRegistry(testVault);
      await reloaded.load();
      expect(reloaded.get('нейромикон')?.aliases).toContain('Нейро-Сетка');
    });

    it('soft deletes a token with deprecateToken', async () => {
      const registry = new TokensRegistry(testVault);
      await registry.load();
      registry.registerToken({ key: 'old-concept', kind: 'concept', sourceNote: 'test.md' });

      expect(registry.deprecateToken('old-concept')).toBe(true);
      expect(registry.get('old-concept')?.deprecated).toBe(true);
      expect(registry.getAll(false).some(t => t.key === 'old-concept')).toBe(false);
      expect(registry.getAll(true).some(t => t.key === 'old-concept')).toBe(true);
    });
  });

  describe('H4: Note Extractor & Inverted Note Tokens Index', () => {
    it('extracts title, aliases, project links, and concept tags', async () => {
      const registry = new TokensRegistry(testVault);
      await registry.load();
      const extractor = new NoteExtractor(testVault, registry);
      await extractor.load();

      const raw = `---
title: "Архитектура CleanNet"
aliases: ["Протокол CleanNet", "Спецификация Сети"]
project: "[[CleanNet]]"
tags: ["#concept/сенсорная-сеть", "#note"]
---
# Архитектура CleanNet

В рамках проекта CleanNet сенсорная сеть обрабатывает входящие потоки данных.

Также упомянут [[Артмейз]] для визуализации интерфейса.
`;

      const extraction = extractor.extractFromNote(raw, '01_Projects/CleanNet/Arch.md', 1);

      expect(registry.has('архитектура-cleannet')).toBe(true);
      expect(registry.has('cleannet')).toBe(true);
      expect(registry.has('сенсорная-сеть')).toBe(true);
      expect(registry.has('артмейз')).toBe(true);
      expect(extraction.segments.length).toBeGreaterThanOrEqual(1);

      await extractor.save();

      // Verify inverted index
      expect(extractor.getTokensForNote('01_Projects/CleanNet/Arch.md')).toContain('cleannet');

      // Test rename
      extractor.renameNote('01_Projects/CleanNet/Arch.md', '01_Projects/CleanNet/Architecture.md');
      expect(extractor.getTokensForNote('01_Projects/CleanNet/Architecture.md')).toContain('cleannet');
    });
  });

  describe('H2: DNA Logic (Hybridization & Selection) & EMA Weight Update', () => {
    it('evaluates candidates and establishes 3-uniform hyperedges with EMA updates', async () => {
      const registry = new TokensRegistry(testVault);
      await registry.load();
      const extractor = new NoteExtractor(testVault, registry);
      await extractor.load();

      const raw = `---
title: "Нейронные Модели"
---
Понятия [[нейромикон]] и [[сенсорная-сеть]] тесно взаимодействуют.`;

      const extraction = extractor.extractFromNote(raw, 'test.md', 1);
      const dna = new DnaEngine(testVault, { hybridMin: 0.6, maxCandidatesPerNote: 10 });
      await dna.load();

      // Mock Noul returning p = 0.85
      vi.spyOn(decisionModelModule, 'decide').mockResolvedValue({
        chosen: { letter: 'A', option: 'Да', probability: 0.85 },
        confidence: 0.85,
        decisions: [{ letter: 'A', option: 'Да', probability: 0.85 }],
        calibrated: true,
        optionsCount: 2,
        question: '?'
      });

      const res1 = await dna.processNote(extraction, raw, 1);
      expect(res1.created).toBeGreaterThanOrEqual(1);

      const activeEdges = dna.getEdges('active');
      expect(activeEdges.length).toBeGreaterThanOrEqual(1);
      const edge = activeEdges[0];
      expect(edge.triple).toContain('связано-с');
      expect(edge.weight).toBe(0.85);
      expect(edge.evidenceCount).toBe(1);

      // Second evidence run with Noul = 0.95 -> EMA: 0.3 * 0.95 + 0.7 * 0.85 = 0.285 + 0.595 = 0.88
      vi.spyOn(decisionModelModule, 'decide').mockResolvedValue({
        chosen: { letter: 'A', option: 'Да', probability: 0.95 },
        confidence: 0.95,
        decisions: [{ letter: 'A', option: 'Да', probability: 0.95 }],
        calibrated: true,
        optionsCount: 2,
        question: '?'
      });

      const res2 = await dna.processNote(extraction, raw, 2);
      expect(res2.updated).toBeGreaterThanOrEqual(1);
      expect(edge.evidenceCount).toBe(2);
      expect(edge.weight).toBe(0.88);
    });
  });

  describe('H6: Cost Tracker & Resource Caps', () => {
    it('records call metrics and halts when limits are exceeded', () => {
      const tracker = new CostTracker(testVault, {
        maxCallsPerRun: 5,
        maxWallClockMsPerRun: 100000
      });

      tracker.startRun();
      for (let i = 0; i < 4; i++) {
        tracker.recordCall('noul', 100, 50);
        expect(tracker.isLimitExceeded()).toBe(false);
      }

      // 5th call ok, 6th call exceeds limit of 5
      tracker.recordCall('noul', 100, 50);
      tracker.recordCall('noul', 100, 50);
      expect(tracker.isLimitExceeded()).toBe(true);
      expect(tracker.getLimitReason()).toContain('Call limit of 5 calls exceeded');
      tracker.endRun();
    });
  });

  describe('H3: Oracle Engine & H_{t+1} Predictions', () => {
    it('forecasts candidate pending hyperedges using Choice primitive', async () => {
      const registry = new TokensRegistry(testVault);
      await registry.load();
      registry.registerToken({ key: 'cleannet', kind: 'project', sourceNote: 'c.md' });
      registry.registerToken({ key: 'сенсоры', kind: 'concept', sourceNote: 's.md' });
      registry.registerToken({ key: 'вода', kind: 'concept', sourceNote: 'w.md' });

      const dna = new DnaEngine(testVault);
      await dna.load();

      // Seed an active edge between cleannet and сенсоры
      const seedEdge = {
        id: computeHyperedgeId(['cleannet', 'сенсоры', 'связано-с']),
        triple: ['cleannet', 'сенсоры', 'связано-с'] as [string, string, string],
        weight: 0.85,
        evidence: { type: 'cooccurrence' as const },
        evidenceCount: 1,
        createdAt: new Date().toISOString(),
        tick: 1,
        model: 'Jev-Style-Qwen3.5-2B-Decision-Q4_K_M',
        schemaVersion: 1,
        status: 'active' as const
      };
      dna.upsertEdge(seedEdge);

      // Seed an active edge between сенсоры and вода
      const seedEdge2 = {
        id: computeHyperedgeId(['сенсоры', 'вода', 'связано-с']),
        triple: ['сенсоры', 'вода', 'связано-с'] as [string, string, string],
        weight: 0.80,
        evidence: { type: 'cooccurrence' as const },
        evidenceCount: 1,
        createdAt: new Date().toISOString(),
        tick: 1,
        model: 'Jev-Style-Qwen3.5-2B-Decision-Q4_K_M',
        schemaVersion: 1,
        status: 'active' as const
      };
      dna.upsertEdge(seedEdge2);

      const oracle = new OracleEngine(testVault, dna, registry, { oracleMin: 0.5 });

      // Mock Choice selecting 'вода' with probability 0.75
      vi.spyOn(decisionModelModule, 'decide').mockResolvedValueOnce({
        chosen: { letter: 'A', option: 'вода', probability: 0.75 },
        confidence: 0.75,
        decisions: [{ letter: 'A', option: 'вода', probability: 0.75 }],
        calibrated: true,
        optionsCount: 1,
        question: 'Оракул'
      });

      const prediction = await oracle.predictNextState();
      expect(prediction.edgesPending.length).toBe(1);
      expect(prediction.edgesPending[0].triple).toContain('вода');
      expect(prediction.edgesPending[0].status).toBe('pending');
      expect(prediction.edgesPending[0].evidence.type).toBe('oracle');
      expect(prediction.tick).toBe(1);
    });
  });

  describe('H5: Triage Bridge & Auto-Stop Guard', () => {
    it('confirms or rejects pending hyperedges and updates metrics', async () => {
      const dna = new DnaEngine(testVault);
      await dna.load();

      const edgeId = computeHyperedgeId(['a', 'b', 'c']);
      dna.upsertEdge({
        id: edgeId,
        triple: ['a', 'b', 'c'],
        weight: 0.7,
        evidence: { type: 'oracle' },
        evidenceCount: 1,
        createdAt: new Date().toISOString(),
        tick: 1,
        model: 'Jev-Style-Qwen3.5-2B-Decision-Q4_K_M',
        schemaVersion: 1,
        status: 'pending'
      });

      const bridge = new HypergraphTriageBridge(testVault, dna);
      const res = await bridge.reviewEdge(edgeId, 'yes');

      expect(res.resolved).toBe(true);
      expect(res.edge?.status).toBe('active');
      expect(res.edge?.evidence.type).toBe('confirmed');
      expect(res.metrics.totalConfirmed).toBe(1);
      expect(res.metrics.confirmationRate).toBe(1.0);
    });

    it('triggers auto-stop when confirmation rate < 30% after 10 reviews', async () => {
      const dna = new DnaEngine(testVault);
      await dna.load();
      const bridge = new HypergraphTriageBridge(testVault, dna);

      for (let i = 0; i < 10; i++) {
        const id = computeHyperedgeId([`a${i}`, `b${i}`, `c${i}`]);
        dna.upsertEdge({
          id,
          triple: [`a${i}`, `b${i}`, `c${i}`],
          weight: 0.7,
          evidence: { type: 'oracle' },
          evidenceCount: 1,
          createdAt: new Date().toISOString(),
          tick: 1,
          model: 'Jev-Style-Qwen3.5-2B-Decision-Q4_K_M',
          schemaVersion: 1,
          status: 'pending'
        });

        // 2 yes, 8 no -> 20% confirmation rate
        const answer = i < 2 ? 'yes' : 'no';
        await bridge.reviewEdge(id, answer);
      }

      const metrics = await bridge.loadMetrics();
      expect(metrics.totalConfirmed).toBe(2);
      expect(metrics.totalRejected).toBe(8);
      expect(metrics.confirmationRate).toBe(0.2);
      expect(metrics.oraclePaused).toBe(true);
    });
  });

  describe('H7: Model Manifest, TTL Decay & GC', () => {
    it('syncs model epoch and marks older model edges as stale', async () => {
      const registry = new TokensRegistry(testVault);
      const dna = new DnaEngine(testVault);
      await dna.load();

      dna.upsertEdge({
        id: computeHyperedgeId(['x', 'y', 'z']),
        triple: ['x', 'y', 'z'],
        weight: 0.9,
        evidence: { type: 'cooccurrence' },
        evidenceCount: 1,
        createdAt: new Date().toISOString(),
        tick: 1,
        model: 'Old-Model-v1',
        schemaVersion: 1,
        status: 'active',
        stale: false
      });

      const maintenance = new HypergraphMaintenance(testVault, dna, registry);
      const initial = await maintenance.syncModelEpoch('Old-Model-v1');
      expect(initial.epoch).toBe(1);

      // Model file changed
      const second = await maintenance.syncModelEpoch('Jev-Style-Qwen3.5-2B-Decision-Q4_K_M.gguf');
      expect(second.changed).toBe(true);
      expect(second.epoch).toBe(2);
      expect(second.staleEdgesMarked).toBe(1);
      expect(dna.getEdge(computeHyperedgeId(['x', 'y', 'z']))?.stale).toBe(true);
    });

    it('prunes zero-evidence edges and deprecated orphan tokens with snapshot backup', async () => {
      const registry = new TokensRegistry(testVault);
      await registry.load();
      registry.registerToken({ key: 'valid-tok', kind: 'concept', sourceNote: 'v.md' });
      const orphan = registry.registerToken({ key: 'orphan-tok', kind: 'concept', sourceNote: 'o.md' });
      registry.deprecateToken('orphan-tok');
      await registry.save();

      const dna = new DnaEngine(testVault);
      await dna.load();
      dna.upsertEdge({
        id: computeHyperedgeId(['valid-tok', 'связано-с', 'valid-tok']),
        triple: ['valid-tok', 'связано-с', 'valid-tok'],
        weight: 0.8,
        evidence: { type: 'cooccurrence' },
        evidenceCount: 1,
        createdAt: new Date().toISOString(),
        tick: 1,
        model: 'model',
        schemaVersion: 1,
        status: 'active'
      });
      dna.upsertEdge({
        id: computeHyperedgeId(['junk1', 'junk2', 'junk3']),
        triple: ['junk1', 'junk2', 'junk3'],
        weight: 0.1,
        evidence: { type: 'cooccurrence' },
        evidenceCount: 0, // zero evidence
        createdAt: new Date().toISOString(),
        tick: 1,
        model: 'model',
        schemaVersion: 1,
        status: 'active'
      });
      await dna.save();

      const maintenance = new HypergraphMaintenance(testVault, dna, registry);
      const gcRes = await maintenance.runGc();

      expect(gcRes.prunedEdges).toBe(1);
      expect(gcRes.prunedTokens).toBe(1);
      expect(fs.existsSync(gcRes.backupPath)).toBe(true);
    });
  });
});
