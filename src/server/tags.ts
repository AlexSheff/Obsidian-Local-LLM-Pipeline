import fs from 'fs';
const fsPromises = fs.promises;
import path from 'path';
import { parseDocument } from 'yaml';

export interface TaxonomyAxisDefinition {
  id: string;
  level: string;
  label: string;
  question: string;
  prefix: string;
  tags: string[];
}

export interface ProjectTagProfile {
  id: string;
  projectTag: string;
  targetFolder: string;
  associatedTags: string[];
  aliases: string[];
  description?: string;
}

export interface VaultTagTaxonomyConfig {
  updatedAt: string;
  axes: TaxonomyAxisDefinition[];
  projectProfiles: ProjectTagProfile[];
  tagRoutes: Record<string, string>;
}

export const DEFAULT_PROJECT_TAG_PROFILES: ProjectTagProfile[] = [
  {
    id: 'Hermes',
    projectTag: 'project/Hermes',
    targetFolder: '01_Projects/Hermes',
    associatedTags: [
      'project/Hermes',
      'system/agent-orchestration',
      'system/multi-agent',
      'system/memory',
      'system/routing',
      'system/local-LLM',
      'system/free-API',
      'system/protocol',
      'domain/AI/agents',
      'domain/AI/LLM',
      'domain/AI/local'
    ],
    aliases: ['Hermes', 'Гермес', 'Hermes Agent', 'agent-orchestration', 'multi-agent']
  },
  {
    id: 'Obsidian-LLM-Pipeline',
    projectTag: 'project/Obsidian-LLM-Pipeline',
    targetFolder: '01_Projects/Obsidian-LLM-Pipeline',
    associatedTags: [
      'project/Obsidian-LLM-Pipeline',
      'system/semantic-ingestion',
      'system/tagging',
      'system/classification',
      'system/file-routing',
      'system/registry',
      'system/queue',
      'system/watchdog',
      'domain/knowledge-management',
      'domain/AI/local',
      'domain/semantics'
    ],
    aliases: [
      'Obsidian-LLM-Pipeline',
      'Obsidian Local LLM Pipeline',
      'Obsidian Pipeline',
      'semantic-ingestion',
      'file-routing',
      'watchdog'
    ]
  },
  {
    id: 'Neuromicon',
    projectTag: 'project/Neuromicon',
    targetFolder: '01_Projects/Neuromicon',
    associatedTags: [
      'project/Neuromicon',
      'concept/World-1149',
      'concept/Protocol-Contact',
      'concept/24+1',
      'concept/Defragmentation',
      'concept/E=M×C²',
      'system/transmedia',
      'system/ARG',
      'domain/transmedia',
      'domain/ARG',
      'domain/storytelling',
      'domain/film'
    ],
    aliases: [
      'Neuromicon',
      'Нейромикон',
      'World-1149',
      'Мир 1149',
      'Protocol-Contact',
      'Протокол Контакт',
      'Defragmentation',
      'Дефрагментация',
      '24+1',
      'E=M×C²'
    ]
  },
  {
    id: 'UUCPFF',
    projectTag: 'project/UUCPFF',
    targetFolder: '01_Projects/UUCPFF',
    associatedTags: [
      'project/UUCPFF',
      'system/film-festival',
      'system/creator-network',
      'system/film-submission',
      'system/curation',
      'system/distribution',
      'domain/film',
      'domain/creative',
      'domain/community'
    ],
    aliases: ['UUCPFF', 'film-festival', 'creator-network', 'film-submission', 'кинофестиваль']
  },
  {
    id: 'Escape2Reality',
    projectTag: 'project/Escape2Reality',
    targetFolder: '01_Projects/Escape2Reality',
    associatedTags: [
      'project/Escape2Reality',
      'system/transmedia',
      'system/ARG',
      'domain/transmedia',
      'domain/ARG',
      'domain/creative',
      'domain/storytelling'
    ],
    aliases: ['Escape2Reality', 'Escape to Reality', 'Эскейп']
  },
  {
    id: 'Engineering-Intelligence',
    projectTag: 'project/Engineering-Intelligence',
    targetFolder: '01_Projects/Engineering-Intelligence',
    associatedTags: [
      'project/Engineering-Intelligence',
      'domain/AI',
      'domain/semantics',
      'domain/ontology',
      'domain/knowledge',
      'domain/information-theory'
    ],
    aliases: ['Engineering-Intelligence', 'Engineering Intelligence', 'Инженерный интеллект']
  },
  {
    id: 'Restore-Dumaguete',
    projectTag: 'project/Restore-Dumaguete',
    targetFolder: '01_Projects/Restore-Dumaguete',
    associatedTags: [
      'project/Restore-Dumaguete',
      'domain/community',
      'domain/society',
      'domain/operations',
      'domain/governance',
      'status/paused'
    ],
    aliases: ['Restore-Dumaguete', 'Restore Dumaguete', 'Dumaguete', 'Думагете']
  },
  {
    id: 'TOTEM',
    projectTag: 'project/TOTEM',
    targetFolder: '01_Projects/TOTEM',
    associatedTags: [
      'project/TOTEM',
      'domain/creative',
      'domain/storytelling',
      'domain/philosophy',
      'domain/transmedia'
    ],
    aliases: ['TOTEM', 'Тотем']
  },
  {
    id: 'semantic-hypergraph',
    projectTag: 'research/semantic-hypergraph',
    targetFolder: '03_Knowledge/Research/semantic-hypergraph',
    associatedTags: [
      'research/semantic-hypergraph',
      'domain/hypergraph',
      'domain/semantics',
      'domain/graph-theory',
      'domain/ontology',
      'type/research'
    ],
    aliases: ['semantic-hypergraph', 'semantic hypergraph', 'семантический гиперграф']
  },
  {
    id: 'JeV-response',
    projectTag: 'research/JeV-response',
    targetFolder: '03_Knowledge/Research/JeV-response',
    associatedTags: [
      'research/JeV-response',
      'domain/AI/local',
      'domain/AI/LLM',
      'system/classification',
      'system/routing',
      'type/research'
    ],
    aliases: ['JeV-response', 'JeV response', 'Jev Decision']
  },
  {
    id: 'semantic-quantization',
    projectTag: 'research/semantic-quantization',
    targetFolder: '03_Knowledge/Research/semantic-quantization',
    associatedTags: [
      'research/semantic-quantization',
      'domain/semantics',
      'domain/information-theory',
      'domain/AI/LLM',
      'type/research'
    ],
    aliases: ['semantic-quantization', 'semantic quantization', 'семантическое квантование']
  },
  {
    id: 'language-evolution',
    projectTag: 'research/language-evolution',
    targetFolder: '03_Knowledge/Research/language-evolution',
    associatedTags: [
      'research/language-evolution',
      'domain/language',
      'domain/semantics',
      'domain/society',
      'type/research'
    ],
    aliases: ['language-evolution', 'language evolution', 'эволюция языка']
  },
  {
    id: 'planetary-values',
    projectTag: 'research/planetary-values',
    targetFolder: '03_Knowledge/Research/planetary-values',
    associatedTags: [
      'research/planetary-values',
      'domain/society',
      'domain/philosophy',
      'domain/governance',
      'type/research'
    ],
    aliases: ['planetary-values', 'planetary values', 'планетарные ценности']
  },
  {
    id: 'future-economy',
    projectTag: 'research/future-economy',
    targetFolder: '03_Knowledge/Research/future-economy',
    associatedTags: [
      'research/future-economy',
      'domain/future-economy',
      'domain/economy',
      'domain/institutions',
      'type/research'
    ],
    aliases: ['future-economy', 'future economy', 'экономика будущего']
  }
];

export const DEFAULT_TAG_ROUTES: Record<string, string> = {
  'project/Hermes': '01_Projects/Hermes',
  'project/Obsidian-LLM-Pipeline': '01_Projects/Obsidian-LLM-Pipeline',
  'project/Neuromicon': '01_Projects/Neuromicon',
  'project/UUCPFF': '01_Projects/UUCPFF',
  'project/Escape2Reality': '01_Projects/Escape2Reality',
  'project/Engineering-Intelligence': '01_Projects/Engineering-Intelligence',
  'project/Restore-Dumaguete': '01_Projects/Restore-Dumaguete',
  'project/TOTEM': '01_Projects/TOTEM',
  'research/semantic-hypergraph': '03_Knowledge/Research/semantic-hypergraph',
  'research/JeV-response': '03_Knowledge/Research/JeV-response',
  'research/semantic-quantization': '03_Knowledge/Research/semantic-quantization',
  'research/language-evolution': '03_Knowledge/Research/language-evolution',
  'research/planetary-values': '03_Knowledge/Research/planetary-values',
  'research/future-economy': '03_Knowledge/Research/future-economy',
  'type/project': '01_Projects/Active',
  'type/research': '03_Knowledge/Research',
  'type/whitepaper': '03_Knowledge/Research',
  'type/scenario': '03_Knowledge/Scripts',
  'type/meeting': '04_Journal',
  'type/event': '04_Journal',
  'type/idea': '05_Ideas',
  'type/task': '01_Projects/Active',
  'type/protocol': '03_Knowledge/Technical',
  'type/tool': '03_Knowledge/Technical',
  'type/dataset': '03_Knowledge/Technical',
  'type/person': '02_Areas/People',
  'type/organization': '02_Areas/Organizations',
  'type/place': '02_Areas/Places',
  'type/area': '02_Areas',
  'type/entity': '03_Knowledge/Entities',
  'type/concept': '03_Knowledge/Essays',
  'type/reference': '03_Knowledge/Essays',
  'status/archived': '06_Archive'
};

export const DEFAULT_TAG_TAXONOMY: TaxonomyAxisDefinition[] = [
  {
    id: 'root',
    level: 'L0',
    label: 'L0 — Системный уровень (Infrastructure)',
    question: 'Инфраструктура, методология или стандарт?',
    prefix: '',
    tags: [
      'system',
      'meta',
      'knowledge',
      'method',
      'protocol',
      'architecture',
      'reference'
    ]
  },
  {
    id: 'type',
    level: 'L1',
    label: 'L1 — Тип объекта (TYPE)',
    question: 'Что это за объект?',
    prefix: 'type/',
    tags: [
      'type/project',
      'type/area',
      'type/person',
      'type/organization',
      'type/place',
      'type/entity',
      'type/concept',
      'type/research',
      'type/whitepaper',
      'type/scenario',
      'type/idea',
      'type/task',
      'type/meeting',
      'type/event',
      'type/reference',
      'type/protocol',
      'type/dataset',
      'type/tool'
    ]
  },
  {
    id: 'domain',
    level: 'L2',
    label: 'L2 — Домен (DOMAIN)',
    question: 'К какой предметной области относится?',
    prefix: 'domain/',
    tags: [
      // AI / Computing
      'domain/AI',
      'domain/AI/agents',
      'domain/AI/LLM',
      'domain/AI/local',
      'domain/AI/multimodal',
      'domain/machine-learning',
      'domain/quantum-computing',
      'domain/cryptography',
      'domain/cybersecurity',
      'domain/software',
      // Knowledge
      'domain/knowledge',
      'domain/knowledge-management',
      'domain/semantics',
      'domain/language',
      'domain/ontology',
      'domain/graph-theory',
      'domain/hypergraph',
      'domain/information-theory',
      // Society / Economy
      'domain/society',
      'domain/economy',
      'domain/future-economy',
      'domain/institutions',
      'domain/governance',
      'domain/education',
      'domain/community',
      // Creative
      'domain/creative',
      'domain/film',
      'domain/music',
      'domain/transmedia',
      'domain/storytelling',
      'domain/ARG',
      'domain/philosophy',
      // Personal / Operations
      'domain/personal',
      'domain/business',
      'domain/funding',
      'domain/network',
      'domain/strategy',
      'domain/operations'
    ]
  },
  {
    id: 'project',
    level: 'L3',
    label: 'L3 — Проекты и Исследования (PROJECT / RESEARCH)',
    question: 'К какому проекту или исследованию относится?',
    prefix: 'project/',
    tags: [
      'project/Hermes',
      'project/Obsidian-LLM-Pipeline',
      'project/Neuromicon',
      'project/Escape2Reality',
      'project/UUCPFF',
      'project/Engineering-Intelligence',
      'project/Restore-Dumaguete',
      'project/TOTEM',
      'research/semantic-hypergraph',
      'research/JeV-response',
      'research/semantic-quantization',
      'research/language-evolution',
      'research/planetary-values',
      'research/future-economy'
    ]
  },
  {
    id: 'system',
    level: 'L4',
    label: 'L4 — Функция / Подсистема / Концепт (SYSTEM / CONCEPT)',
    question: 'Какую функцию выполняет или какой концепт раскрывает?',
    prefix: 'system/',
    tags: [
      'system/agent-orchestration',
      'system/multi-agent',
      'system/memory',
      'system/routing',
      'system/local-LLM',
      'system/free-API',
      'system/protocol',
      'system/semantic-ingestion',
      'system/tagging',
      'system/classification',
      'system/file-routing',
      'system/registry',
      'system/queue',
      'system/watchdog',
      'system/transmedia',
      'system/ARG',
      'system/film-festival',
      'system/creator-network',
      'system/film-submission',
      'system/curation',
      'system/distribution',
      'concept/World-1149',
      'concept/Protocol-Contact',
      'concept/24+1',
      'concept/Defragmentation',
      'concept/E=M×C²'
    ]
  },
  {
    id: 'status',
    level: 'L5',
    label: 'L5 — Состояние (STATUS)',
    question: 'В каком состоянии находится объект?',
    prefix: 'status/',
    tags: [
      'status/idea',
      'status/research',
      'status/design',
      'status/prototype',
      'status/active',
      'status/testing',
      'status/paused',
      'status/blocked',
      'status/completed',
      'status/archived'
    ]
  },
  {
    id: 'priority',
    level: 'L6',
    label: 'L6 — Приоритет (PRIORITY)',
    question: 'Насколько это критично (P0–P3)?',
    prefix: 'priority/',
    tags: [
      'priority/P0',
      'priority/P1',
      'priority/P2',
      'priority/P3'
    ]
  },
  {
    id: 'stage',
    level: 'L7',
    label: 'L7 — Стадия работы (STAGE)',
    question: 'На какой стадии находится работа над материалом?',
    prefix: 'stage/',
    tags: [
      'stage/question',
      'stage/discovery',
      'stage/research',
      'stage/model',
      'stage/design',
      'stage/implementation',
      'stage/validation',
      'stage/deployment',
      'stage/measurement'
    ]
  },
  {
    id: 'knowledge',
    level: 'Axis',
    label: 'Характер знания (KNOWLEDGE)',
    question: 'Какова эпистемологическая роль материала?',
    prefix: 'knowledge/',
    tags: [
      'knowledge/fact',
      'knowledge/observation',
      'knowledge/hypothesis',
      'knowledge/model',
      'knowledge/theory',
      'knowledge/assumption',
      'knowledge/question',
      'knowledge/decision',
      'knowledge/evidence',
      'knowledge/specification'
    ]
  },
  {
    id: 'relation',
    level: 'Axis',
    label: 'Тип связи (RELATION)',
    question: 'Какую связь выражает документ?',
    prefix: 'relation/',
    tags: [
      'relation/dependency',
      'relation/component',
      'relation/alternative',
      'relation/extension',
      'relation/integration',
      'relation/inspiration',
      'relation/evidence',
      'relation/conflict'
    ]
  }
];

const CANONICAL_TAG_MAP = new Map<string, string>();
for (const axis of DEFAULT_TAG_TAXONOMY) {
  for (const t of axis.tags) {
    CANONICAL_TAG_MAP.set(t.toLowerCase(), t);
  }
}

const VALID_HIERARCHICAL_PREFIXES = new Set([
  'type',
  'domain',
  'project',
  'research',
  'system',
  'concept',
  'status',
  'priority',
  'stage',
  'knowledge',
  'relation'
]);

const ALLOWED_ALPHANUMERIC_TERMS = new Set([
  'web3',
  'b2b',
  'b2c',
  '2d',
  '3d',
  'p2p',
  'i18n',
  'l10n',
  'k8s',
  'oauth2',
  'p0',
  'p1',
  'p2',
  'p3',
  'escape2reality',
  'world-1149',
  '24+1',
  'e=m×c²'
]);

const BANNED_TAG_WORDS = new Set([
  'tags',
  'tag',
  'true',
  'false',
  'null',
  'undefined',
  'none',
  'nan',
  'todo',
  'include',
  'define',
  'pragma',
  'region',
  'endregion',
  'endif',
  'ifdef'
]);

/**
 * Normalizes a raw tag string to canonical casing if it matches the orthogonal taxonomy.
 */
export function normalizeToCanonicalTag(raw: string): string {
  const clean = raw.trim().replace(/^#+/, '').trim();
  const canonical = CANONICAL_TAG_MAP.get(clean.toLowerCase());
  if (canonical) return canonical;
  return clean;
}

/**
 * Validates that a tag is either:
 * 1) A known canonical tag from the Orthogonal Taxonomy (L0-L7),
 * 2) A valid hierarchical tag (e.g., `project/MyProject`, `domain/AI/agents`) with max depth 3, or
 * 3) A meaningful human word/phrase,
 * while strictly rejecting random alphanumeric IDs like "#01G23", "#w3x06", "#01_Projects", hex codes, or numeric IDs.
 */
export function isValidSemanticTag(
  raw: unknown,
  options?: { allowSingleLetter?: boolean }
): boolean {
  if (typeof raw !== 'string' && typeof raw !== 'number') return false;
  const clean = String(raw).trim().replace(/^#+/, '').trim();
  if (!clean) return false;

  const minLen = options?.allowSingleLetter ? 1 : 2;
  if (clean.length < minLen || clean.length > 65) return false;

  const lower = clean.toLowerCase();
  if (BANNED_TAG_WORDS.has(lower)) return false;

  // 1. Exact match in canonical taxonomy or allowed terms
  if (CANONICAL_TAG_MAP.has(lower) || ALLOWED_ALPHANUMERIC_TERMS.has(lower)) {
    return true;
  }

  // Enforce bounded depth: maximum 3 hierarchical levels (e.g. domain/AI/agents)
  const slashParts = clean.split('/');
  if (slashParts.length > 3) return false;
  if (slashParts.some(p => !p || p.trim().length === 0)) return false;

  // If hierarchical (contains '/'), check prefix validity and subsegments
  if (slashParts.length > 1) {
    const prefix = slashParts[0].toLowerCase();
    // Block folder-like prefixes such as "01_Projects/..." or "03_Knowledge/..."
    if (/^\d/.test(prefix)) return false;

    for (let i = 0; i < slashParts.length; i++) {
      const part = slashParts[i];
      const partLower = part.toLowerCase();
      if (ALLOWED_ALPHANUMERIC_TERMS.has(partLower)) continue;

      // In `project/...` or `concept/...`, allow named entities like Escape2Reality or World-1149,
      // but block random hex/hash codes like 01G23 or w3x06
      if ((prefix === 'project' || prefix === 'concept') && i > 0) {
        if (/^[0-9a-f]{4,}$/i.test(part) || /^\d+[a-z]+\d+$/i.test(part) || /^[a-z]\d+[a-z]\d+$/i.test(part)) {
          return false;
        }
        if (!/[\p{L}]/u.test(part)) return false;
        continue;
      }

      if (/\d/.test(part)) return false;
      if (!/^[\p{L}](?:[\p{L}_-]*[\p{L}])?$/u.test(part)) return false;
    }
    return true;
  }

  // 2. Flat tag validation: must start with a Unicode letter (blocks #01G23, #01_Projects, #1234, #2026)
  if (!/^[\p{L}]/u.test(clean)) {
    return false;
  }

  // Must NOT contain any digits unless it is in ALLOWED_ALPHANUMERIC_TERMS
  // This completely prevents #01G23, #w3x06, #a3ps9, #ff00aa, #v1, #item1, etc.
  if (/\d/.test(clean)) {
    return false;
  }

  // Must consist strictly of Unicode letters separated optionally by single hyphens or underscores
  if (!/^[\p{L}](?:[\p{L}_-]*[\p{L}])?$/u.test(clean)) {
    return false;
  }

  const segments = clean.split(/[-_]+/).filter(Boolean);
  if (segments.length === 0) return false;
  if (!options?.allowSingleLetter && segments.length > 1) {
    if (segments.some(seg => seg.length < 2)) {
      return false;
    }
  }

  return true;
}

/**
 * Sanitizes, canonicalizes, and deduplicates an array of tags, stripping out non-word garbage tags.
 */
export function sanitizeTagList(
  tags: unknown[],
  options?: { allowSingleLetter?: boolean; maxTags?: number }
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    if (typeof raw !== 'string' && typeof raw !== 'number') continue;
    const clean = normalizeToCanonicalTag(
      String(raw)
        .trim()
        .replace(/^#+/, '')
        .replace(/\s+/g, '-')
        .trim()
    );
    if (!isValidSemanticTag(clean, options)) continue;
    const lower = clean.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push(clean);
    }
  }
  if (options?.maxTags && options.maxTags > 0 && result.length > options.maxTags) {
    return result.slice(0, options.maxTags);
  }
  return result;
}

/**
 * Maps legacy flat tags or keywords into the user's Orthogonal Multi-Level Taxonomy (L0-L7).
 */
const LEGACY_TO_TAXONOMY_MAP: Record<string, string> = {
  // L0
  system: 'system',
  meta: 'meta',
  knowledge: 'knowledge',
  method: 'method',
  protocol: 'protocol',
  architecture: 'architecture',
  reference: 'reference',
  архитектура: 'architecture',
  протокол: 'protocol',
  методология: 'method',
  справочник: 'reference',

  // L1 - type/
  project: 'type/project',
  проект: 'type/project',
  area: 'type/area',
  person: 'type/person',
  organization: 'type/organization',
  place: 'type/place',
  entity: 'type/entity',
  concept: 'type/concept',
  концепт: 'type/concept',
  концепция: 'type/concept',
  research: 'type/research',
  исследование: 'type/research',
  whitepaper: 'type/whitepaper',
  вайтпейпер: 'type/whitepaper',
  scenario: 'type/scenario',
  script: 'type/scenario',
  screenplay: 'type/scenario',
  сценарий: 'type/scenario',
  idea: 'type/idea',
  идея: 'type/idea',
  task: 'type/task',
  задача: 'type/task',
  action: 'type/task',
  'action-items': 'type/task',
  meeting: 'type/meeting',
  agenda: 'type/meeting',
  встреча: 'type/meeting',
  совещание: 'type/meeting',
  event: 'type/event',
  событие: 'type/event',
  dataset: 'type/dataset',
  tool: 'type/tool',
  инструмент: 'type/tool',

  // L2 - domain/
  ai: 'domain/AI',
  ии: 'domain/AI',
  нейросети: 'domain/AI',
  agents: 'domain/AI/agents',
  agent: 'domain/AI/agents',
  агент: 'domain/AI/agents',
  агенты: 'domain/AI/agents',
  llm: 'domain/AI/LLM',
  'local-llm': 'system/local-LLM',
  multimodal: 'domain/AI/multimodal',
  'machine-learning': 'domain/machine-learning',
  ml: 'domain/machine-learning',
  quantum: 'domain/quantum-computing',
  'quantum-computing': 'domain/quantum-computing',
  crypto: 'domain/cryptography',
  cryptography: 'domain/cryptography',
  криптография: 'domain/cryptography',
  cybersecurity: 'domain/cybersecurity',
  security: 'domain/cybersecurity',
  безопасность: 'domain/cybersecurity',
  software: 'domain/software',
  code: 'domain/software',
  разработка: 'domain/software',
  semantics: 'domain/semantics',
  семантика: 'domain/semantics',
  ontology: 'domain/ontology',
  онтология: 'domain/ontology',
  hypergraph: 'domain/hypergraph',
  гиперграф: 'domain/hypergraph',
  'graph-theory': 'domain/graph-theory',
  'information-theory': 'domain/information-theory',
  'knowledge-management': 'domain/knowledge-management',
  society: 'domain/society',
  общество: 'domain/society',
  economy: 'domain/economy',
  экономика: 'domain/economy',
  'future-economy': 'domain/future-economy',
  governance: 'domain/governance',
  education: 'domain/education',
  образование: 'domain/education',
  community: 'domain/community',
  сообщество: 'domain/community',
  creative: 'domain/creative',
  творчество: 'domain/creative',
  film: 'domain/film',
  кино: 'domain/film',
  music: 'domain/music',
  музыка: 'domain/music',
  transmedia: 'domain/transmedia',
  трансмедиа: 'domain/transmedia',
  storytelling: 'domain/storytelling',
  сторителлинг: 'domain/storytelling',
  arg: 'domain/ARG',
  philosophy: 'domain/philosophy',
  философия: 'domain/philosophy',
  business: 'domain/business',
  бизнес: 'domain/business',
  funding: 'domain/funding',
  инвестиции: 'domain/funding',
  strategy: 'domain/strategy',
  стратегия: 'domain/strategy',
  operations: 'domain/operations',
  операционка: 'domain/operations',

  // L3 - project/ & research/
  hermes: 'project/Hermes',
  'hermes-agent': 'project/Hermes',
  neuromicon: 'project/Neuromicon',
  нейромикон: 'project/Neuromicon',
  escape2reality: 'project/Escape2Reality',
  uucpff: 'project/UUCPFF',
  totem: 'project/TOTEM',
  тотем: 'project/TOTEM',
  'semantic-hypergraph': 'research/semantic-hypergraph',
  'jev-response': 'research/JeV-response',
  'semantic-quantization': 'research/semantic-quantization',

  // L4 - system/ & concept/
  'system-prompt': 'system/agent-orchestration',
  'agent-orchestration': 'system/agent-orchestration',
  'multi-agent': 'system/multi-agent',
  memory: 'system/memory',
  routing: 'system/routing',
  'file-routing': 'system/file-routing',
  classification: 'system/classification',
  tagging: 'system/tagging',
  'semantic-ingestion': 'system/semantic-ingestion',
  registry: 'system/registry',
  queue: 'system/queue',
  watchdog: 'system/watchdog',
  'film-festival': 'system/film-festival',
  'world-1149': 'concept/World-1149',
  '1149': 'concept/World-1149',
  'protocol-contact': 'concept/Protocol-Contact',
  defragmentation: 'concept/Defragmentation',

  // L5 - status/
  active: 'status/active',
  prototype: 'status/prototype',
  прототип: 'status/prototype',
  testing: 'status/testing',
  тестирование: 'status/testing',
  paused: 'status/paused',
  blocked: 'status/blocked',
  completed: 'status/completed',
  archived: 'status/archived',

  // L6 - priority/
  p0: 'priority/P0',
  p1: 'priority/P1',
  p2: 'priority/P2',
  p3: 'priority/P3',

  // L7 - stage/
  discovery: 'stage/discovery',
  design: 'stage/design',
  implementation: 'stage/implementation',
  roadmap: 'stage/design',
  'launch-plan': 'stage/deployment',
  validation: 'stage/validation',
  deployment: 'stage/deployment',
  measurement: 'stage/measurement',

  // Knowledge axis
  fact: 'knowledge/fact',
  observation: 'knowledge/observation',
  hypothesis: 'knowledge/hypothesis',
  гипотеза: 'knowledge/hypothesis',
  model: 'knowledge/model',
  модель: 'knowledge/model',
  theory: 'knowledge/theory',
  теория: 'knowledge/theory',
  assumption: 'knowledge/assumption',
  decision: 'knowledge/decision',
  решение: 'knowledge/decision',
  evidence: 'knowledge/evidence',
  specification: 'knowledge/specification',
  тз: 'knowledge/specification',
  спецификация: 'knowledge/specification'
};

/**
 * Infers which project (or research direction) a note belongs to by scoring:
 * 1) Explicit `project/<Name>` or `research/<Name>` tags in existingTags/body
 * 2) Project aliases in filename or title
 * 3) Project-specific associated tags & concepts (e.g. `#concept/World-1149` -> `project/Neuromicon`,
 *    `#system/film-festival` -> `project/UUCPFF`, or any custom hashtags imported by the user).
 */
export function inferProjectFromNoteAndTaxonomy(params: {
  filename?: string;
  title?: string;
  body?: string;
  existingTags?: string[];
  folder?: string;
  discoveredProjects?: Array<{ id: string; folder: string; aliases: string[] }>;
  projectProfiles?: ProjectTagProfile[];
  projectsRoot?: string;
}): {
  matchedProfile: ProjectTagProfile | null;
  matchedProjectTag: string | null;
  targetFolder: string | null;
  matchedAssociatedTags: string[];
  confidenceScore: number;
} {
  const {
    filename = '',
    title = '',
    body = '',
    existingTags = [],
    folder = '',
    discoveredProjects = [],
    projectProfiles = DEFAULT_PROJECT_TAG_PROFILES,
    projectsRoot = '01_Projects'
  } = params;

  // Build unified profiles list (merging user/default profiles + discovered vault projects)
  const profilesByKey = new Map<string, ProjectTagProfile>();
  for (const prof of projectProfiles) {
    profilesByKey.set(prof.projectTag.toLowerCase(), {
      ...prof,
      associatedTags: [...prof.associatedTags],
      aliases: [...prof.aliases]
    });
  }

  for (const dp of discoveredProjects) {
    const folderName = (dp.folder.split('/').pop() || dp.id).trim().replace(/\s+/g, '-');
    if (!folderName) continue;
    const pTag = `project/${folderName}`;
    const existing = profilesByKey.get(pTag.toLowerCase());
    if (existing) {
      existing.targetFolder = dp.folder || existing.targetFolder;
      existing.aliases = Array.from(new Set([...existing.aliases, ...(dp.aliases || []), folderName]));
    } else {
      profilesByKey.set(pTag.toLowerCase(), {
        id: folderName,
        projectTag: pTag,
        targetFolder: dp.folder || `${projectsRoot}/${folderName}`,
        associatedTags: [pTag],
        aliases: Array.from(new Set([...(dp.aliases || []), folderName, dp.id]))
      });
    }
  }

  const allProfiles = Array.from(profilesByKey.values());
  if (allProfiles.length === 0) {
    return {
      matchedProfile: null,
      matchedProjectTag: null,
      targetFolder: null,
      matchedAssociatedTags: [],
      confidenceScore: 0
    };
  }

  // Count how many profiles share each associatedTag so unique tags carry higher weight
  const tagFrequency = new Map<string, number>();
  for (const prof of allProfiles) {
    for (const t of prof.associatedTags) {
      const low = t.toLowerCase();
      tagFrequency.set(low, (tagFrequency.get(low) || 0) + 1);
    }
  }

  const normHeader = `${filename} ${title}`.toLowerCase().replace(/[_-]+/g, ' ');
  const normBody = body.slice(0, 4000).toLowerCase().replace(/[_-]+/g, ' ');
  const rawCombined = `${filename}\n${title}\n${body.slice(0, 4000)}`.toLowerCase();
  const folderLower = folder.toLowerCase().replace(/\\/g, '/');
  const normExistingTags = new Set(
    existingTags.map(t => String(t).trim().replace(/^#+/, '').toLowerCase()).filter(Boolean)
  );

  let bestProfile: ProjectTagProfile | null = null;
  let bestScore = 0;
  let bestAssociated: string[] = [];

  for (const prof of allProfiles) {
    let score = 0;
    const matchedAssoc = new Set<string>();
    const pTagLower = prof.projectTag.toLowerCase();

    // 1. Direct project tag in existingTags or inline #project/... in text
    if (normExistingTags.has(pTagLower) || rawCombined.includes(`#${pTagLower}`)) {
      score += 12;
      matchedAssoc.add(prof.projectTag);
    }

    // 2. Currently located inside this project's folder
    if (
      prof.targetFolder &&
      (folderLower === prof.targetFolder.toLowerCase() ||
        folderLower.startsWith(prof.targetFolder.toLowerCase() + '/'))
    ) {
      score += 6;
    }

    // 3. Project name / aliases in header or body
    for (const alias of prof.aliases) {
      const cleanAlias = alias.trim().toLowerCase().replace(/[_-]+/g, ' ');
      if (!cleanAlias || cleanAlias.length < 2) continue;
      if (normHeader.includes(cleanAlias) || rawCombined.includes(alias.toLowerCase())) {
        if (normHeader.includes(cleanAlias)) {
          score += 10;
        } else if (cleanAlias.length >= 4 || /\b/.test(cleanAlias)) {
          score += 5;
        }
        break;
      }
    }

    // 4. Associated tags (subsystems, concepts, domains) in existingTags or text
    for (const assoc of prof.associatedTags) {
      const assocLower = assoc.toLowerCase();
      if (assocLower === pTagLower) continue;

      const leaf = assoc.includes('/') ? assoc.split('/').slice(1).join('/') : assoc;
      const leafLower = leaf.toLowerCase();
      const leafSpaced = leafLower.replace(/[_-]+/g, ' ');
      const freq = tagFrequency.get(assocLower) || 1;
      const isUniqueToProject = freq === 1 && !assocLower.startsWith('domain/') && !assocLower.startsWith('type/');

      const hasExactTag = normExistingTags.has(assocLower) || normExistingTags.has(leafLower) || rawCombined.includes(`#${assocLower}`);
      const hasLeafInText =
        leafLower.length >= 4 &&
        (rawCombined.includes(leafLower) || (leafSpaced.length >= 5 && normBody.includes(leafSpaced)) || normHeader.includes(leafSpaced));

      if (hasExactTag) {
        score += isUniqueToProject ? 4.5 : 2;
        matchedAssoc.add(assoc);
      } else if (hasLeafInText) {
        score += isUniqueToProject ? 3 : 1;
        matchedAssoc.add(assoc);
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestProfile = prof;
      bestAssociated = Array.from(matchedAssoc);
    }
  }

  // Require a meaningful threshold (score >= 4: e.g. explicit project name, or >=1 unique project tag + context, or >=2 project tags)
  if (!bestProfile || bestScore < 4) {
    return {
      matchedProfile: null,
      matchedProjectTag: null,
      targetFolder: null,
      matchedAssociatedTags: [],
      confidenceScore: 0
    };
  }

  return {
    matchedProfile: bestProfile,
    matchedProjectTag: bestProfile.projectTag,
    targetFolder: bestProfile.targetFolder,
    matchedAssociatedTags: bestAssociated,
    confidenceScore: Math.min(1, Math.round((bestScore / 12) * 100) / 100)
  };
}

/**
 * Determines the target vault directory for a Markdown file based on its assigned Orthogonal Taxonomy tags
 * and user-configured tagRoutes / projectProfiles.
 */
export function resolveDirectoryFromTags(params: {
  tags: string[];
  projectProfiles?: ProjectTagProfile[];
  discoveredProjects?: Array<{ id: string; folder: string; aliases: string[] }>;
  tagRoutes?: Record<string, string>;
  projectsRoot?: string;
  fallbackFolder?: string;
}): {
  targetFolder: string;
  matchedByTag: string | null;
  matchedProjectId: string | null;
} {
  const {
    tags = [],
    projectProfiles = DEFAULT_PROJECT_TAG_PROFILES,
    discoveredProjects = [],
    tagRoutes = DEFAULT_TAG_ROUTES,
    projectsRoot = '01_Projects',
    fallbackFolder = '03_Knowledge/Essays'
  } = params;

  const cleanTags = tags.map(t => String(t).trim().replace(/^#+/, '').trim()).filter(Boolean);

  // Build case-insensitive route lookup
  const routeMap = new Map<string, string>();
  for (const [k, v] of Object.entries(DEFAULT_TAG_ROUTES)) {
    routeMap.set(k.toLowerCase(), v);
  }
  for (const [k, v] of Object.entries(tagRoutes || {})) {
    if (k && v) routeMap.set(k.trim().replace(/^#+/, '').toLowerCase(), v.trim());
  }
  for (const prof of projectProfiles) {
    if (prof.projectTag && prof.targetFolder) {
      routeMap.set(prof.projectTag.toLowerCase(), prof.targetFolder);
    }
  }
  for (const dp of discoveredProjects) {
    const folderName = (dp.folder.split('/').pop() || dp.id).trim().replace(/\s+/g, '-');
    if (folderName && dp.folder) {
      routeMap.set(`project/${folderName.toLowerCase()}`, dp.folder);
      routeMap.set(`project/${dp.id.toLowerCase()}`, dp.folder);
    }
  }

  // 0. If explicitly marked `status/archived` (and not `status/active`), route to Archive
  if (
    cleanTags.some(t => t.toLowerCase() === 'status/archived') &&
    !cleanTags.some(t => t.toLowerCase() === 'status/active')
  ) {
    return {
      targetFolder: routeMap.get('status/archived') || '06_Archive',
      matchedByTag: 'status/archived',
      matchedProjectId: null
    };
  }

  // 1. Highest priority: `project/<Name>` tag -> routes directly to that project's directory
  for (const tag of cleanTags) {
    const lower = tag.toLowerCase();
    if (lower.startsWith('project/')) {
      const projName = tag.slice('project/'.length).trim();
      const explicitRoute = routeMap.get(lower);
      if (explicitRoute) {
        return {
          targetFolder: explicitRoute,
          matchedByTag: tag,
          matchedProjectId: projName
        };
      }
      if (projName) {
        return {
          targetFolder: `${projectsRoot}/${projName}`,
          matchedByTag: tag,
          matchedProjectId: projName
        };
      }
    }
  }

  // 2. Second priority: `research/<Topic>` tag -> routes to research directory
  for (const tag of cleanTags) {
    const lower = tag.toLowerCase();
    if (lower.startsWith('research/')) {
      const topic = tag.slice('research/'.length).trim();
      const explicitRoute = routeMap.get(lower);
      if (explicitRoute) {
        return {
          targetFolder: explicitRoute,
          matchedByTag: tag,
          matchedProjectId: topic
        };
      }
      if (topic) {
        return {
          targetFolder: `03_Knowledge/Research/${topic}`,
          matchedByTag: tag,
          matchedProjectId: topic
        };
      }
    }
  }

  // 3. Third priority: Check if any tag in `cleanTags` belongs exclusively to a known ProjectTagProfile
  for (const prof of projectProfiles) {
    if (
      cleanTags.some(
        t =>
          t.toLowerCase() === prof.projectTag.toLowerCase()
      )
    ) {
      return {
        targetFolder: prof.targetFolder,
        matchedByTag: prof.projectTag,
        matchedProjectId: prof.id
      };
    }
  }

  // 4. Fourth priority: `status/archived` (if not in an active project)
  if (cleanTags.some(t => t.toLowerCase() === 'status/archived') && !cleanTags.some(t => t.toLowerCase() === 'status/active')) {
    return {
      targetFolder: routeMap.get('status/archived') || '06_Archive',
      matchedByTag: 'status/archived',
      matchedProjectId: null
    };
  }

  // 5. Fifth priority: `type/<Type>` tag ( preferring specific types over generic `type/reference` or `type/concept`)
  const typeTags = cleanTags.filter(t => t.toLowerCase().startsWith('type/'));
  const specificTypeOrder = [
    'type/scenario',
    'type/meeting',
    'type/event',
    'type/whitepaper',
    'type/research',
    'type/protocol',
    'type/tool',
    'type/dataset',
    'type/idea',
    'type/task',
    'type/person',
    'type/organization',
    'type/place',
    'type/area',
    'type/entity',
    'type/project',
    'type/concept',
    'type/reference'
  ];
  for (const prefType of specificTypeOrder) {
    const found = typeTags.find(t => t.toLowerCase() === prefType);
    if (found) {
      // If it's generic `type/reference` or `type/concept`, check if a `domain/...` tag provides a more specific folder first
      if (prefType === 'type/reference' || prefType === 'type/concept') {
        break;
      }
      const mapped = routeMap.get(prefType);
      if (mapped) {
        return {
          targetFolder: mapped,
          matchedByTag: found,
          matchedProjectId: null
        };
      }
    }
  }

  // 6. Sixth priority: `domain/<Domain>` or `system/<System>` tags
  for (const tag of cleanTags) {
    const lower = tag.toLowerCase();
    if (routeMap.has(lower)) {
      return {
        targetFolder: routeMap.get(lower)!,
        matchedByTag: tag,
        matchedProjectId: null
      };
    }
    if (
      lower.startsWith('domain/ai') ||
      lower === 'domain/machine-learning' ||
      lower === 'domain/quantum-computing' ||
      lower === 'domain/cryptography' ||
      lower === 'domain/cybersecurity' ||
      lower === 'domain/software' ||
      lower.startsWith('system/')
    ) {
      return {
        targetFolder: '03_Knowledge/Technical',
        matchedByTag: tag,
        matchedProjectId: null
      };
    }
    if (
      lower === 'domain/film' ||
      lower === 'domain/transmedia' ||
      lower === 'domain/storytelling' ||
      lower === 'domain/arg'
    ) {
      return {
        targetFolder: '03_Knowledge/Scripts',
        matchedByTag: tag,
        matchedProjectId: null
      };
    }
    if (lower === 'domain/music') {
      return {
        targetFolder: '03_Knowledge/Songs',
        matchedByTag: tag,
        matchedProjectId: null
      };
    }
    if (
      lower === 'domain/business' ||
      lower === 'domain/funding' ||
      lower === 'domain/strategy' ||
      lower === 'domain/operations' ||
      lower === 'domain/personal' ||
      lower === 'domain/network'
    ) {
      return {
        targetFolder: '02_Areas/Business',
        matchedByTag: tag,
        matchedProjectId: null
      };
    }
  }

  // 7. Fallback to any remaining `type/...` tag or default folder
  if (typeTags.length > 0) {
    const firstType = typeTags[0];
    const mapped = routeMap.get(firstType.toLowerCase());
    if (mapped) {
      return {
        targetFolder: mapped,
        matchedByTag: firstType,
        matchedProjectId: null
      };
    }
  }

  return {
    targetFolder: fallbackFolder,
    matchedByTag: null,
    matchedProjectId: null
  };
}

/**
 * Qualitatively determines the structured Orthogonal Taxonomy tag set for a note.
 * Ensures the number of tags is bounded (not a word-salad) and answers the core orthogonal questions:
 * TYPE -> DOMAIN -> PROJECT/RESEARCH -> SYSTEM/CONCEPT -> KNOWLEDGE -> STATUS -> STAGE -> PRIORITY.
 */
export function curateOrthogonalTags(params: {
  rawTags?: unknown[];
  title?: string;
  filename?: string;
  body?: string;
  folder?: string;
  discoveredProjects?: Array<{ id: string; folder: string; aliases: string[] }>;
  projectProfiles?: ProjectTagProfile[];
  customAxes?: TaxonomyAxisDefinition[];
  replaceExisting?: boolean;
  maxTags?: number;
}): string[] {
  const {
    rawTags = [],
    title = '',
    filename = '',
    body = '',
    folder = '',
    discoveredProjects = [],
    projectProfiles = DEFAULT_PROJECT_TAG_PROFILES,
    customAxes = [],
    replaceExisting = false,
    maxTags = 9
  } = params;

  const selectedByAxis: Record<string, Set<string>> = {
    lang: new Set(),
    root: new Set(),
    type: new Set(),
    domain: new Set(),
    project: new Set(),
    system: new Set(),
    knowledge: new Set(),
    status: new Set(),
    stage: new Set(),
    priority: new Set(),
    relation: new Set(),
    custom: new Set()
  };

  const assignTag = (tag: string) => {
    const clean = normalizeToCanonicalTag(tag.replace(/^#+/, '').trim());
    if (!isValidSemanticTag(clean, { allowSingleLetter: false })) return;
    const lower = clean.toLowerCase();

    if (lower === 'ru' || lower === 'en') {
      selectedByAxis.lang.add(lower);
      return;
    }

    // Check if it maps from a legacy flat word to a structured taxonomy tag
    const mapped = LEGACY_TO_TAXONOMY_MAP[lower] || clean;
    const mappedLower = mapped.toLowerCase();

    if (mappedLower.startsWith('type/')) selectedByAxis.type.add(mapped);
    else if (mappedLower.startsWith('domain/')) selectedByAxis.domain.add(mapped);
    else if (mappedLower.startsWith('project/') || mappedLower.startsWith('research/')) selectedByAxis.project.add(mapped);
    else if (mappedLower.startsWith('system/') || mappedLower.startsWith('concept/')) selectedByAxis.system.add(mapped);
    else if (mappedLower.startsWith('knowledge/')) selectedByAxis.knowledge.add(mapped);
    else if (mappedLower.startsWith('status/')) selectedByAxis.status.add(mapped);
    else if (mappedLower.startsWith('stage/')) selectedByAxis.stage.add(mapped);
    else if (mappedLower.startsWith('priority/')) selectedByAxis.priority.add(mapped);
    else if (mappedLower.startsWith('relation/')) selectedByAxis.relation.add(mapped);
    else if (DEFAULT_TAG_TAXONOMY[0].tags.includes(mappedLower)) selectedByAxis.root.add(mappedLower);
    else if (mapped.includes('/')) {
      selectedByAxis.custom.add(mapped);
    } else if (!replaceExisting) {
      // Only keep unmapped flat tags if not in strict taxonomy replacement mode
      selectedByAxis.custom.add(mapped);
    }
  };

  // 1. Process raw/existing tags through the taxonomy mapper
  for (const t of rawTags) {
    if (typeof t === 'string' || typeof t === 'number') {
      assignTag(String(t));
    }
  }

  // 2. Analyze title, filename, folder, and body to infer missing orthogonal axes
  const combinedHeader = `${filename} ${title}`.toLowerCase();
  const combinedText = `${filename}\n${title}\n${body.slice(0, 2500)}`.toLowerCase();
  const folderLower = folder.toLowerCase().replace(/\\/g, '/');

  // 2a. Infer Project & Associated Project Tags using ProjectTagProfiles
  const projectInference = inferProjectFromNoteAndTaxonomy({
    filename,
    title,
    body,
    existingTags: rawTags.map(String),
    folder,
    discoveredProjects,
    projectProfiles
  });
  if (projectInference.matchedProjectTag) {
    selectedByAxis.project.add(projectInference.matchedProjectTag);
    for (const assoc of projectInference.matchedAssociatedTags) {
      assignTag(assoc);
    }
  }

  // Also check custom user-imported axes for any tag whose leaf keyword explicitly appears in the note header/text
  if (customAxes.length > 0) {
    for (const axis of customAxes) {
      for (const axisTag of axis.tags) {
        const leaf = axisTag.includes('/') ? axisTag.split('/').pop()! : axisTag;
        if (leaf.length >= 4 && combinedHeader.includes(leaf.toLowerCase().replace(/[_-]+/g, ' '))) {
          assignTag(axisTag);
        }
      }
    }
  }

  // Infer L1: TYPE (at least 1 primary object type)
  if (selectedByAxis.type.size === 0) {
    if (/whitepaper|вайтпейпер/i.test(combinedText)) {
      selectedByAxis.type.add('type/whitepaper');
    } else if (/сценарий|screenplay|инт\.|нат\.|эпизод|перфоманс/i.test(combinedText) || folderLower.includes('scripts')) {
      selectedByAxis.type.add('type/scenario');
    } else if (/встреч|совещан|agenda|meeting|action item|повестк/i.test(combinedHeader) || folderLower.includes('dialogues')) {
      selectedByAxis.type.add('type/meeting');
    } else if (/протокол|protocol/i.test(combinedHeader)) {
      selectedByAxis.type.add('type/protocol');
    } else if (/исследован|research|гипотез|квантовани|hypergraph|гиперграф/i.test(combinedHeader)) {
      selectedByAxis.type.add('type/research');
    } else if (/идея|инновационн|брейншторм|idea/i.test(combinedHeader) || folderLower.includes('05_ideas')) {
      selectedByAxis.type.add('type/idea');
    } else if (/задач|чек-лист|todo|task/i.test(combinedHeader)) {
      selectedByAxis.type.add('type/task');
    } else if (
      /проект|project|дорожн\w+ карт\w+|roadmap|запуск|франшиз/i.test(combinedHeader) ||
      folderLower.startsWith('01_projects') ||
      Array.from(selectedByAxis.project).some(p => p.toLowerCase().startsWith('project/'))
    ) {
      selectedByAxis.type.add('type/project');
    } else if (/концепт|concept|философи|смыслии/i.test(combinedHeader)) {
      selectedByAxis.type.add('type/concept');
    } else {
      selectedByAxis.type.add('type/reference');
    }
  }

  // Infer L2: DOMAIN (up to 2 most relevant domains)
  if (/hermes|агент|agent|multi-agent|мультиагент/i.test(combinedText)) {
    selectedByAxis.domain.add('domain/AI/agents');
  }
  if (/llm|llama|qwen|gguf|промпт|prompt|языков\w+ модел/i.test(combinedText)) {
    selectedByAxis.domain.add('domain/AI/LLM');
  } else if (/ии|искусственн\w+ интеллект|нейросет|\bai\b/i.test(combinedText)) {
    selectedByAxis.domain.add('domain/AI');
  }
  if (/гиперграф|hypergraph/i.test(combinedText)) {
    selectedByAxis.domain.add('domain/hypergraph');
  }
  if (/семантик|semantic|таксономи|taxonomy|онтологи|ontology/i.test(combinedText)) {
    selectedByAxis.domain.add('domain/semantics');
  }
  if (/баз\w+ знаний|obsidian|vault|knowledge management/i.test(combinedText)) {
    selectedByAxis.domain.add('domain/knowledge-management');
  }
  if (/философ|свобод\w+ выбор|сознани|этик|смысл/i.test(combinedText)) {
    selectedByAxis.domain.add('domain/philosophy');
  }
  if (/фильм|кино|фестивал|сценари|драматург|film/i.test(combinedText)) {
    selectedByAxis.domain.add('domain/film');
  }
  if (/трансмедиа|transmedia|arg\b|перфоманс/i.test(combinedText)) {
    selectedByAxis.domain.add('domain/transmedia');
  }
  if (/бизнес|франшиз|производств|монетизац|рынок|маркетинг/i.test(combinedText)) {
    selectedByAxis.domain.add('domain/business');
  }
  if (/экономик|economy/i.test(combinedText)) {
    selectedByAxis.domain.add('domain/economy');
  }
  if (/код|сервер|api|typescript|python|node|архитектур\w+ по|software/i.test(combinedText)) {
    selectedByAxis.domain.add('domain/software');
  }

  // Infer L3: PROJECT / RESEARCH (from dynamic vault projects + canonical research)
  for (const proj of discoveredProjects) {
    const folderName = proj.folder.split('/').pop() || proj.id;
    const matched = proj.aliases.some(alias => {
      if (!alias || alias.length < 2) return false;
      return combinedText.includes(alias.toLowerCase());
    });
    if (matched || folderLower === proj.folder.toLowerCase()) {
      selectedByAxis.project.add(`project/${folderName.replace(/\s+/g, '-')}`);
    }
  }
  if (/hermes/i.test(combinedText)) selectedByAxis.project.add('project/Hermes');
  if (/obsidian.*pipeline|local llm pipeline|jev.*router/i.test(combinedText)) {
    selectedByAxis.project.add('project/Obsidian-LLM-Pipeline');
  }
  if (/neuromicon|нейромикон|1149/i.test(combinedText)) {
    selectedByAxis.project.add('project/Neuromicon');
  }
  if (/escape2reality/i.test(combinedText)) selectedByAxis.project.add('project/Escape2Reality');
  if (/uucpff/i.test(combinedText)) selectedByAxis.project.add('project/UUCPFF');
  if (/totem|тотем/i.test(combinedText)) selectedByAxis.project.add('project/TOTEM');
  if (/restore[\s-]*dumaguete/i.test(combinedText)) selectedByAxis.project.add('project/Restore-Dumaguete');
  if (/semantic[\s-]*hypergraph|семантическ\w+ гиперграф/i.test(combinedText)) {
    selectedByAxis.project.add('research/semantic-hypergraph');
  }
  if (/jev[\s-]*response|jev[\s-]*decision/i.test(combinedText)) {
    selectedByAxis.project.add('research/JeV-response');
  }

  // Infer L4: SYSTEM / CONCEPT
  if (/системн\w+ промпт|system prompt|оркестрац|orchestration/i.test(combinedText)) {
    selectedByAxis.system.add('system/agent-orchestration');
  }
  if (/маршрутизац|routing|router/i.test(combinedText)) {
    selectedByAxis.system.add('system/routing');
  }
  if (/классификац|classification|triage|триаж/i.test(combinedText)) {
    selectedByAxis.system.add('system/classification');
  }
  if (/тегирован|таксономи\w+ тег|tagging/i.test(combinedText)) {
    selectedByAxis.system.add('system/tagging');
  }
  if (/1149|world-1149/i.test(combinedText)) {
    selectedByAxis.system.add('concept/World-1149');
  }

  // Infer Knowledge Axis
  if (/техническ\w+ задани|\bтз\b|спецификац|specification|требовани/i.test(combinedHeader)) {
    selectedByAxis.knowledge.add('knowledge/specification');
  } else if (/гипотез|предположен|hypothesis/i.test(combinedText)) {
    selectedByAxis.knowledge.add('knowledge/hypothesis');
  } else if (/модел\w+|структур\w+|архитектур\w+|таксономи/i.test(combinedHeader)) {
    selectedByAxis.knowledge.add('knowledge/model');
  } else if (/решени\w+|decision|итог/i.test(combinedHeader)) {
    selectedByAxis.knowledge.add('knowledge/decision');
  }

  // Infer L5: STATUS & L7: STAGE (when relevant)
  if (selectedByAxis.status.size === 0) {
    if (selectedByAxis.type.has('type/idea')) {
      selectedByAxis.status.add('status/idea');
    } else if (selectedByAxis.type.has('type/research')) {
      selectedByAxis.status.add('status/research');
    } else if (selectedByAxis.type.has('type/project') || selectedByAxis.project.size > 0) {
      selectedByAxis.status.add('status/active');
    }
  }

  if (selectedByAxis.stage.size === 0) {
    if (/дорожн\w+ карт\w+|roadmap|план запуск|концепц|архитектур|структур/i.test(combinedHeader)) {
      selectedByAxis.stage.add('stage/design');
    } else if (/реализац|внедрен|implementation|разработк/i.test(combinedHeader)) {
      selectedByAxis.stage.add('stage/implementation');
    } else if (/проверк|тестирован|валидац|validation/i.test(combinedHeader)) {
      selectedByAxis.stage.add('stage/validation');
    } else if (selectedByAxis.type.has('type/research')) {
      selectedByAxis.stage.add('stage/research');
    }
  }

  // Assemble bounded, high-quality orthogonal tag set in canonical order:
  // [type (max 1-2), domain (max 2), project/research (max 2), system/concept (max 2), knowledge (max 1), status (max 1), stage (max 1), priority (max 1), root (max 1), lang]
  const ordered: string[] = [
    ...Array.from(selectedByAxis.type).slice(0, 2),
    ...Array.from(selectedByAxis.domain).slice(0, 2),
    ...Array.from(selectedByAxis.project).slice(0, 2),
    ...Array.from(selectedByAxis.system).slice(0, 2),
    ...Array.from(selectedByAxis.knowledge).slice(0, 1),
    ...Array.from(selectedByAxis.status).slice(0, 1),
    ...Array.from(selectedByAxis.stage).slice(0, 1),
    ...Array.from(selectedByAxis.priority).slice(0, 1),
    ...Array.from(selectedByAxis.relation).slice(0, 1),
    ...Array.from(selectedByAxis.root).slice(0, 1),
    ...Array.from(selectedByAxis.custom).slice(0, 2),
    ...Array.from(selectedByAxis.lang).slice(0, 2)
  ];

  return sanitizeTagList(ordered, { allowSingleLetter: false, maxTags });
}

/**
 * Loads the full VaultTagTaxonomyConfig (`axes`, `projectProfiles`, `tagRoutes`) from `99_System/tag_taxonomy.json`
 * and merges discovered projects from the vault.
 */
export async function loadVaultTagTaxonomyConfig(
  vaultPath?: string,
  discoveredProjects: Array<{ id: string; folder: string; aliases: string[] }> = [],
  projectsRoot: string = '01_Projects'
): Promise<VaultTagTaxonomyConfig> {
  const axes: TaxonomyAxisDefinition[] = DEFAULT_TAG_TAXONOMY.map(a => ({
    ...a,
    tags: [...a.tags]
  }));

  const profilesMap = new Map<string, ProjectTagProfile>();
  for (const p of DEFAULT_PROJECT_TAG_PROFILES) {
    profilesMap.set(p.projectTag.toLowerCase(), {
      ...p,
      associatedTags: [...p.associatedTags],
      aliases: [...p.aliases]
    });
  }

  const tagRoutes: Record<string, string> = { ...DEFAULT_TAG_ROUTES };
  let updatedAt = new Date().toISOString();

  if (vaultPath && fs.existsSync(vaultPath)) {
    const customPath = path.join(vaultPath, '99_System', 'tag_taxonomy.json');
    if (fs.existsSync(customPath)) {
      try {
        const raw = JSON.parse(await fsPromises.readFile(customPath, 'utf-8'));
        if (raw.updatedAt) updatedAt = String(raw.updatedAt);
        if (Array.isArray(raw.axes)) {
          for (const customAxis of raw.axes) {
            if (!customAxis || !customAxis.id || !Array.isArray(customAxis.tags)) continue;
            for (const t of customAxis.tags) {
              const cleanT = String(t).trim().replace(/^#+/, '').trim();
              if (cleanT) CANONICAL_TAG_MAP.set(cleanT.toLowerCase(), cleanT);
            }
            const target = axes.find(a => a.id === customAxis.id);
            if (target) {
              target.tags = sanitizeTagList(customAxis.tags, { allowSingleLetter: false });
            } else {
              axes.push({
                id: String(customAxis.id),
                level: String(customAxis.level || 'Custom'),
                label: String(customAxis.label || customAxis.id),
                question: String(customAxis.question || ''),
                prefix: String(customAxis.prefix || `${customAxis.id}/`),
                tags: sanitizeTagList(customAxis.tags, { allowSingleLetter: false })
              });
            }
          }
        }
        if (Array.isArray(raw.projectProfiles)) {
          for (const prof of raw.projectProfiles) {
            if (!prof || !prof.id || !prof.projectTag) continue;
            const pTag = String(prof.projectTag).trim().replace(/^#+/, '');
            CANONICAL_TAG_MAP.set(pTag.toLowerCase(), pTag);
            const assoc = Array.isArray(prof.associatedTags)
              ? prof.associatedTags.map((t: unknown) => String(t).trim().replace(/^#+/, '')).filter(Boolean)
              : [pTag];
            for (const at of assoc) {
              CANONICAL_TAG_MAP.set(at.toLowerCase(), at);
            }
            profilesMap.set(pTag.toLowerCase(), {
              id: String(prof.id),
              projectTag: pTag,
              targetFolder: String(prof.targetFolder || `${projectsRoot}/${prof.id}`),
              associatedTags: assoc,
              aliases: Array.isArray(prof.aliases) ? prof.aliases.map(String) : [String(prof.id)],
              description: prof.description ? String(prof.description) : undefined
            });
          }
        }
        if (raw.tagRoutes && typeof raw.tagRoutes === 'object') {
          for (const [k, v] of Object.entries(raw.tagRoutes)) {
            if (typeof k === 'string' && typeof v === 'string' && k.trim() && v.trim()) {
              tagRoutes[k.trim().replace(/^#+/, '')] = v.trim();
            }
          }
        }
      } catch {}
    }
  }

  // Dynamically inject discovered Vault projects into L3 (`project/...`), `projectProfiles`, and `tagRoutes`
  const projectAxis = axes.find(a => a.id === 'project');
  if (discoveredProjects.length > 0) {
    const existingLower = new Set((projectAxis?.tags || []).map(t => t.toLowerCase()));
    for (const proj of discoveredProjects) {
      const folderName = (proj.folder.split('/').pop() || proj.id).trim().replace(/\s+/g, '-');
      if (!folderName) continue;
      const projTag = `project/${folderName}`;
      CANONICAL_TAG_MAP.set(projTag.toLowerCase(), projTag);
      if (projectAxis && !existingLower.has(projTag.toLowerCase())) {
        existingLower.add(projTag.toLowerCase());
        projectAxis.tags.push(projTag);
      }
      if (!profilesMap.has(projTag.toLowerCase())) {
        profilesMap.set(projTag.toLowerCase(), {
          id: folderName,
          projectTag: projTag,
          targetFolder: proj.folder || `${projectsRoot}/${folderName}`,
          associatedTags: [projTag],
          aliases: Array.from(new Set([...(proj.aliases || []), folderName, proj.id]))
        });
      } else {
        const existingProf = profilesMap.get(projTag.toLowerCase())!;
        if (proj.folder) existingProf.targetFolder = proj.folder;
        existingProf.aliases = Array.from(new Set([...existingProf.aliases, ...(proj.aliases || []), folderName]));
      }
      if (!tagRoutes[projTag]) {
        tagRoutes[projTag] = proj.folder || `${projectsRoot}/${folderName}`;
      }
    }
  }

  // Also ensure every `project/<Name>` or `research/<Name>` in `projectAxis` has a profile and route
  if (projectAxis) {
    for (const pTag of projectAxis.tags) {
      const lower = pTag.toLowerCase();
      if (!profilesMap.has(lower)) {
        const isRes = lower.startsWith('research/');
        const name = pTag.includes('/') ? pTag.split('/').slice(1).join('/') : pTag;
        const defaultFolder = isRes ? `03_Knowledge/Research/${name}` : `${projectsRoot}/${name}`;
        profilesMap.set(lower, {
          id: name,
          projectTag: pTag,
          targetFolder: tagRoutes[pTag] || defaultFolder,
          associatedTags: [pTag],
          aliases: [name, name.replace(/[-_]+/g, ' ')]
        });
      }
      const prof = profilesMap.get(lower)!;
      if (!tagRoutes[prof.projectTag]) {
        tagRoutes[prof.projectTag] = prof.targetFolder;
      }
    }
  }

  return {
    updatedAt,
    axes,
    projectProfiles: Array.from(profilesMap.values()),
    tagRoutes
  };
}

/**
 * Loads the vault's Orthogonal Tag Taxonomy axes (backward-compatible helper).
 */
export async function loadVaultTagTaxonomy(
  vaultPath?: string,
  discoveredProjects: Array<{ id: string; folder: string; aliases: string[] }> = []
): Promise<TaxonomyAxisDefinition[]> {
  const cfg = await loadVaultTagTaxonomyConfig(vaultPath, discoveredProjects);
  return cfg.axes;
}

/**
 * Saves the full VaultTagTaxonomyConfig (`axes`, `projectProfiles`, `tagRoutes`) to `99_System/tag_taxonomy.json`.
 */
export async function saveVaultTagTaxonomyConfig(
  vaultPath: string,
  config: Partial<VaultTagTaxonomyConfig> & { axes: TaxonomyAxisDefinition[] }
): Promise<string> {
  const sysDir = path.join(vaultPath, '99_System');
  await fsPromises.mkdir(sysDir, { recursive: true });
  const targetFile = path.join(sysDir, 'tag_taxonomy.json');

  // Preserve existing profiles/routes if not passed
  let existingProfiles = DEFAULT_PROJECT_TAG_PROFILES;
  let existingRoutes = { ...DEFAULT_TAG_ROUTES };
  if (fs.existsSync(targetFile)) {
    try {
      const prev = JSON.parse(await fsPromises.readFile(targetFile, 'utf-8'));
      if (Array.isArray(prev.projectProfiles)) existingProfiles = prev.projectProfiles;
      if (prev.tagRoutes && typeof prev.tagRoutes === 'object') existingRoutes = { ...existingRoutes, ...prev.tagRoutes };
    } catch {}
  }

  const payload: VaultTagTaxonomyConfig = {
    updatedAt: new Date().toISOString(),
    axes: config.axes,
    projectProfiles: config.projectProfiles || existingProfiles,
    tagRoutes: config.tagRoutes || existingRoutes
  };

  await fsPromises.writeFile(targetFile, JSON.stringify(payload, null, 2), 'utf-8');

  for (const axis of payload.axes) {
    for (const t of axis.tags) {
      CANONICAL_TAG_MAP.set(t.toLowerCase(), t);
    }
  }
  for (const prof of payload.projectProfiles) {
    CANONICAL_TAG_MAP.set(prof.projectTag.toLowerCase(), prof.projectTag);
    for (const t of prof.associatedTags) {
      CANONICAL_TAG_MAP.set(t.toLowerCase(), t);
    }
  }

  return targetFile;
}

/**
 * Saves custom modifications (added/removed tags) to `99_System/tag_taxonomy.json` in the vault.
 */
export async function saveVaultTagTaxonomy(
  vaultPath: string,
  axes: TaxonomyAxisDefinition[]
): Promise<string> {
  return saveVaultTagTaxonomyConfig(vaultPath, { axes });
}

/**
 * Universal parser for user-supplied tag lists and project-hashtag files (e.g. `project-hashtags-expanded.md`, JSON, YAML, or plain text).
 * Extracts:
 * - Multi-level taxonomy axes (`L0`..`L7`, `knowledge`, `relation`, plus any custom prefixes)
 * - Project Hashtag Profiles (`#project/<Name>` + associated `#system/...`, `#concept/...`, `#domain/...` tags & aliases)
 * - Tag-to-Directory routing rules (`tagRoutes`)
 */
export function parseTagTaxonomyImport(
  rawContent: string,
  options?: {
    existingConfig?: VaultTagTaxonomyConfig;
    mode?: 'merge' | 'replace';
    projectsRoot?: string;
  }
): {
  axes: TaxonomyAxisDefinition[];
  projectProfiles: ProjectTagProfile[];
  tagRoutes: Record<string, string>;
  importedTagsCount: number;
  importedProjectsCount: number;
} {
  const mode = options?.mode || 'merge';
  const projectsRoot = options?.projectsRoot || '01_Projects';
  const baseConfig = options?.existingConfig;

  // Initialize axes
  const axes: TaxonomyAxisDefinition[] = DEFAULT_TAG_TAXONOMY.map(a => ({
    ...a,
    tags: mode === 'replace' ? [] : [...(baseConfig?.axes.find(x => x.id === a.id)?.tags || a.tags)]
  }));

  const profilesMap = new Map<string, ProjectTagProfile>();
  if (mode === 'merge') {
    for (const prof of baseConfig?.projectProfiles || DEFAULT_PROJECT_TAG_PROFILES) {
      profilesMap.set(prof.projectTag.toLowerCase(), {
        ...prof,
        associatedTags: [...prof.associatedTags],
        aliases: [...prof.aliases]
      });
    }
  }

  const tagRoutes: Record<string, string> =
    mode === 'replace' ? {} : { ...DEFAULT_TAG_ROUTES, ...(baseConfig?.tagRoutes || {}) };

  const parsedTagsSet = new Set<string>();
  const touchedProjects = new Set<string>();

  const registerTagInAxes = (rawTag: string): string | null => {
    const clean = rawTag
      .trim()
      .replace(/^#+/, '')
      .replace(/[,:;.)\]}`]+$/, '')
      .replace(/^['"`(\[{]+/, '')
      .replace(/\/+$/, '')
      .trim();
    if (!clean || clean.length < 2 || clean.length > 65) return null;
    if (/^\d+$/.test(clean) || /^[0-9a-f]{3,6}$/i.test(clean)) return null;
    if (BANNED_TAG_WORDS.has(clean.toLowerCase())) return null;

    // Register in CANONICAL_TAG_MAP so isValidSemanticTag accepts user-imported tags
    const canonical = CANONICAL_TAG_MAP.get(clean.toLowerCase()) || clean;
    CANONICAL_TAG_MAP.set(clean.toLowerCase(), canonical);

    const lower = canonical.toLowerCase();
    parsedTagsSet.add(lower);
    let targetAxis: TaxonomyAxisDefinition | undefined;

    if (lower.startsWith('type/')) targetAxis = axes.find(a => a.id === 'type');
    else if (lower.startsWith('domain/')) targetAxis = axes.find(a => a.id === 'domain');
    else if (lower.startsWith('project/') || lower.startsWith('research/')) targetAxis = axes.find(a => a.id === 'project');
    else if (lower.startsWith('system/') || lower.startsWith('concept/')) targetAxis = axes.find(a => a.id === 'system');
    else if (lower.startsWith('status/')) targetAxis = axes.find(a => a.id === 'status');
    else if (lower.startsWith('priority/')) targetAxis = axes.find(a => a.id === 'priority');
    else if (lower.startsWith('stage/')) targetAxis = axes.find(a => a.id === 'stage');
    else if (lower.startsWith('knowledge/')) targetAxis = axes.find(a => a.id === 'knowledge');
    else if (lower.startsWith('relation/')) targetAxis = axes.find(a => a.id === 'relation');
    else if (!canonical.includes('/')) {
      targetAxis = axes.find(a => a.id === 'root');
    } else {
      const prefix = canonical.split('/')[0].toLowerCase();
      targetAxis = axes.find(a => a.id.toLowerCase() === prefix);
      if (!targetAxis) {
        targetAxis = {
          id: prefix,
          level: 'Custom',
          label: `Custom — ${prefix.toUpperCase()}`,
          question: `Категория ${prefix}?`,
          prefix: `${prefix}/`,
          tags: []
        };
        axes.push(targetAxis);
      }
    }

    if (targetAxis && !targetAxis.tags.some(t => t.toLowerCase() === lower)) {
      targetAxis.tags.push(canonical);
    }

    // If this is a `project/<Name>` or `research/<Name>` tag, ensure a ProjectTagProfile exists
    if (lower.startsWith('project/') || lower.startsWith('research/')) {
      const isRes = lower.startsWith('research/');
      const name = canonical.split('/').slice(1).join('/');
      if (name) {
        const defaultFolder = isRes ? `03_Knowledge/Research/${name}` : `${projectsRoot}/${name}`;
        if (!profilesMap.has(lower)) {
          profilesMap.set(lower, {
            id: name,
            projectTag: canonical,
            targetFolder: tagRoutes[canonical] || defaultFolder,
            associatedTags: [canonical],
            aliases: Array.from(new Set([name, name.replace(/[-_]+/g, ' ')]))
          });
        }
        if (!tagRoutes[canonical]) {
          tagRoutes[canonical] = profilesMap.get(lower)!.targetFolder;
        }
        touchedProjects.add(lower);
      }
    }

    return canonical;
  };

  const trimmed = (rawContent || '').trim();
  if (!trimmed) {
    return {
      axes,
      projectProfiles: Array.from(profilesMap.values()),
      tagRoutes,
      importedTagsCount: 0,
      importedProjectsCount: 0
    };
  }

  // 1. Check if JSON format
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === 'string') registerTagInAxes(item);
        }
      } else if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.axes)) {
          for (const ax of parsed.axes) {
            if (Array.isArray(ax?.tags)) {
              for (const t of ax.tags) registerTagInAxes(String(t));
            }
          }
        }
        if (Array.isArray(parsed.projectProfiles)) {
          for (const prof of parsed.projectProfiles) {
            if (!prof || !prof.projectTag) continue;
            const pTag = registerTagInAxes(String(prof.projectTag)) || String(prof.projectTag).replace(/^#+/, '');
            const assoc: string[] = [pTag];
            if (Array.isArray(prof.associatedTags)) {
              for (const at of prof.associatedTags) {
                const reg = registerTagInAxes(String(at));
                if (reg && !assoc.some(x => x.toLowerCase() === reg.toLowerCase())) assoc.push(reg);
              }
            }
            const id = String(prof.id || pTag.split('/').pop() || pTag);
            const targetFolder = String(prof.targetFolder || `${projectsRoot}/${id}`);
            profilesMap.set(pTag.toLowerCase(), {
              id,
              projectTag: pTag,
              targetFolder,
              associatedTags: assoc,
              aliases: Array.isArray(prof.aliases) ? prof.aliases.map(String) : [id, id.replace(/[-_]+/g, ' ')],
              description: prof.description ? String(prof.description) : undefined
            });
            tagRoutes[pTag] = targetFolder;
            touchedProjects.add(pTag.toLowerCase());
          }
        }
        if (parsed.tagRoutes && typeof parsed.tagRoutes === 'object') {
          for (const [k, v] of Object.entries(parsed.tagRoutes)) {
            if (typeof k === 'string' && typeof v === 'string') {
              const reg = registerTagInAxes(k) || k.replace(/^#+/, '');
              tagRoutes[reg] = v.trim();
            }
          }
        }
        // Also support simple project dictionary: { "Hermes": ["#project/Hermes", "#system/memory"] }
        if (!parsed.axes && !parsed.projectProfiles) {
          for (const [key, val] of Object.entries(parsed)) {
            if (Array.isArray(val)) {
              const pTag = key.includes('/') ? key.replace(/^#+/, '') : `project/${key.trim().replace(/\s+/g, '-')}`;
              const regPTag = registerTagInAxes(pTag) || pTag;
              const assoc: string[] = [regPTag];
              for (const item of val) {
                const reg = registerTagInAxes(String(item));
                if (reg && !assoc.some(x => x.toLowerCase() === reg.toLowerCase())) assoc.push(reg);
              }
              const id = regPTag.split('/').pop() || key;
              profilesMap.set(regPTag.toLowerCase(), {
                id,
                projectTag: regPTag,
                targetFolder: tagRoutes[regPTag] || `${projectsRoot}/${id}`,
                associatedTags: assoc,
                aliases: [id, key, id.replace(/[-_]+/g, ' ')]
              });
              touchedProjects.add(regPTag.toLowerCase());
            }
          }
        }
      }
      return {
        axes,
        projectProfiles: Array.from(profilesMap.values()),
        tagRoutes,
        importedTagsCount: parsedTagsSet.size,
        importedProjectsCount: touchedProjects.size
      };
    } catch {
      // Fall through to Markdown / text parser
    }
  }

  // 2. Markdown / Text / YAML Parser (handles `project-hashtags-expanded.md`, prefix trees, code blocks, and project sections)
  // Step 2a: Pre-expand prefix-tree blocks like:
  // #type/
  //     project
  //     research
  const lines = trimmed.split(/\r?\n/);
  const expandedLines: string[] = [];
  let activeTreePrefix: string | null = null;

  for (const line of lines) {
    const prefixOnlyMatch = line.match(/^\s*#([a-zA-Z\u0400-\u04FF0-9_-]+)\/\s*$/);
    if (prefixOnlyMatch) {
      activeTreePrefix = prefixOnlyMatch[1];
      continue;
    }
    if (activeTreePrefix) {
      const indentedChildMatch = line.match(/^(?:\s{2,}|\t+|\s*[-*]\s+)([a-zA-Z\u0400-\u04FF0-9_+×²=-]+)\s*$/);
      if (indentedChildMatch) {
        expandedLines.push(`#${activeTreePrefix}/${indentedChildMatch[1].trim()}`);
        continue;
      } else if (line.trim().length > 0 && !line.match(/^\s*```/)) {
        activeTreePrefix = null;
      }
    }
    expandedLines.push(line);
  }

  const normalizedMarkdown = expandedLines.join('\n');

  // Step 2b: Parse explicit route lines like `#project/Hermes -> 01_Projects/Hermes` or `- project/Hermes: 01_Projects/Hermes`
  for (const line of expandedLines) {
    const routeMatch = line.match(
      /^\s*(?:[-*]\s*)?#?((?:type|domain|project|research|system|concept|status|priority|stage|knowledge|relation)\/[\p{L}\p{N}_/×²+-]+)\s*(?:->|=>|→)\s*([0-9A-Za-z\u0400-\u04FF_/-]+)\s*$/u
    );
    if (routeMatch) {
      const tag = registerTagInAxes(routeMatch[1]) || routeMatch[1];
      const folder = routeMatch[2].trim().replace(/^\/+|\/+$/g, '');
      if (folder) {
        tagRoutes[tag] = folder;
        const prof = profilesMap.get(tag.toLowerCase());
        if (prof) prof.targetFolder = folder;
      }
    }
  }

  // Step 2c: Helper to extract all tags from a text block
  const extractTagsFromBlock = (blockText: string): string[] => {
    const found: string[] = [];
    const seen = new Set<string>();

    // Match `#tag` (not followed by space, i.e. not Markdown headings)
    const hashMatches = blockText.match(/(?:^|[\s,([`])#([\p{L}\p{N}_/×²+-]+)/gu) || [];
    for (const m of hashMatches) {
      const raw = m.replace(/^[^#]*#+/, '').replace(/\/+$/, '');
      const reg = registerTagInAxes(raw);
      if (reg && !seen.has(reg.toLowerCase())) {
        seen.add(reg.toLowerCase());
        found.push(reg);
      }
    }

    // Also match un-hashed YAML/list tags with canonical prefixes (e.g. `- type/research` or `domain/AI/LLM`)
    const prefixMatches =
      blockText.match(
        /(?:^|[\s,([`-])((?:type|domain|project|research|system|concept|status|priority|stage|knowledge|relation)\/[\p{L}\p{N}_/×²+-]+)/gu
      ) || [];
    for (const pm of prefixMatches) {
      const raw = pm.trim().replace(/^[-*,\s([`]+/, '').replace(/\/+$/, '');
      const reg = registerTagInAxes(raw);
      if (reg && !seen.has(reg.toLowerCase())) {
        seen.add(reg.toLowerCase());
        found.push(reg);
      }
    }

    return found;
  };

  // Extract all tags globally first
  extractTagsFromBlock(normalizedMarkdown);

  // Step 2d: Associate tags with Project Profiles across logical blocks (fenced code blocks & heading sections)
  const associateBlockWithProject = (
    blockTags: string[],
    headingHint?: string,
    folderHint?: string,
    aliasesHint?: string[]
  ) => {
    if (blockTags.length === 0) return;
    const projectTagsInBlock = blockTags.filter(t => t.toLowerCase().startsWith('project/'));
    const researchTagsInBlock = blockTags.filter(t => t.toLowerCase().startsWith('research/'));

    let targetPrimaryTag: string | null = null;
    if (projectTagsInBlock.length === 1) {
      targetPrimaryTag = projectTagsInBlock[0];
    } else if (projectTagsInBlock.length === 0 && researchTagsInBlock.length === 1 && blockTags.length > 1) {
      targetPrimaryTag = researchTagsInBlock[0];
    } else if (projectTagsInBlock.length === 0 && headingHint) {
      // Check if headingHint matches a known project name or looks like a specific project heading
      const cleanHeading = headingHint
        .replace(/^[0-9.)\s#-]+/, '')
        .replace(/\b(project|проект|система|system|направление|direction)\b[:\s-]*/gi, '')
        .split(/[—–:(]/)[0]
        .trim();
      const genericHeadingRegex =
        /^(?:l[0-7]|axis|type|domain|project|projects|research|system|status|priority|stage|knowledge|relation|ai|computing|society|economy|creative|personal|operations|итоговая|модель|отдельная|ось|примеров?|примеры|tags|hashtags|теги)/i;
      if (cleanHeading && cleanHeading.length >= 2 && cleanHeading.length <= 35 && !genericHeadingRegex.test(cleanHeading)) {
        const slug = cleanHeading.replace(/\s+/g, '-');
        const candidateKey = `project/${slug.toLowerCase()}`;
        const existingProf =
          profilesMap.get(candidateKey) ||
          Array.from(profilesMap.values()).find(
            p =>
              p.id.toLowerCase() === cleanHeading.toLowerCase() ||
              p.aliases.some(a => a.toLowerCase() === cleanHeading.toLowerCase())
          );
        if (existingProf) {
          targetPrimaryTag = existingProf.projectTag;
        }
      }
    }

    if (!targetPrimaryTag) return;

    const key = targetPrimaryTag.toLowerCase();
    const existing = profilesMap.get(key);
    const id = targetPrimaryTag.split('/').slice(1).join('/') || targetPrimaryTag;
    const isRes = key.startsWith('research/');
    const defaultFolder = isRes ? `03_Knowledge/Research/${id}` : `${projectsRoot}/${id}`;

    const mergedAssoc = new Set<string>(existing ? existing.associatedTags : [targetPrimaryTag]);
    for (const bt of blockTags) {
      // Do not attach other projects' `project/...` tags
      if (bt.toLowerCase().startsWith('project/') && bt.toLowerCase() !== key) continue;
      mergedAssoc.add(bt);
    }

    const mergedAliases = new Set<string>(existing ? existing.aliases : [id, id.replace(/[-_]+/g, ' ')]);
    if (aliasesHint) {
      for (const a of aliasesHint) {
        if (a && a.trim().length >= 2) mergedAliases.add(a.trim());
      }
    }

    const finalFolder = folderHint || existing?.targetFolder || tagRoutes[targetPrimaryTag] || defaultFolder;
    profilesMap.set(key, {
      id: existing?.id || id,
      projectTag: existing?.projectTag || targetPrimaryTag,
      targetFolder: finalFolder,
      associatedTags: Array.from(mergedAssoc),
      aliases: Array.from(mergedAliases),
      description: existing?.description
    });
    tagRoutes[existing?.projectTag || targetPrimaryTag] = finalFolder;
    touchedProjects.add(key);
  };

  // 1) Inspect fenced code blocks (```...```) — in files like Request 1, each project's subsystem tags are in their own code block!
  const codeBlockRegex = /(?:([^\n`]{2,80})\n+)?```[^\n]*\n([\s\S]*?)```/g;
  let cbMatch: RegExpExecArray | null;
  while ((cbMatch = codeBlockRegex.exec(normalizedMarkdown)) !== null) {
    const precedingLine = (cbMatch[1] || '').trim().replace(/^#+\s*/, '').replace(/:$/, '');
    const blockContent = cbMatch[2] || '';
    const blockTags = extractTagsFromBlock(blockContent);
    associateBlockWithProject(blockTags, precedingLine);
  }

  // 2) Inspect Markdown heading sections (`# ...`, `## ...`, `### ...`)
  const headingSections = normalizedMarkdown.split(/(?=^#{1,4}\s+[^\n]+)/m);
  for (const section of headingSections) {
    const headerMatch = section.match(/^#{1,4}\s+([^\n]+)/);
    if (!headerMatch) continue;
    const headingText = headerMatch[1].trim();
    const folderMatch = section.match(/(?:folder|directory|path|папка|директория)\s*:\s*`?([0-9A-Za-z\u0400-\u04FF_/-]+)`?/i);
    const aliasesMatch = section.match(/(?:aliases|алиасы|ключевые слова|keywords)\s*:\s*([^\n]+)/i);
    const aliasesList = aliasesMatch
      ? aliasesMatch[1]
          .split(/[,;]/)
          .map(s => s.replace(/[`"']/g, '').trim())
          .filter(Boolean)
      : undefined;

    const sectionTags = extractTagsFromBlock(section);
    associateBlockWithProject(
      sectionTags,
      headingText,
      folderMatch ? folderMatch[1].trim() : undefined,
      aliasesList
    );
  }

  return {
    axes,
    projectProfiles: Array.from(profilesMap.values()),
    tagRoutes,
    importedTagsCount: parsedTagsSet.size,
    importedProjectsCount: touchedProjects.size
  };
}

/**
 * Exports the current VaultTagTaxonomyConfig (`axes`, `projectProfiles`, `tagRoutes`) as a structured Markdown file
 * compatible with `project-hashtags-expanded.md` and lossless re-import.
 */
export function exportTagTaxonomyToMarkdown(config?: Partial<VaultTagTaxonomyConfig>): string {
  const axes = config?.axes || DEFAULT_TAG_TAXONOMY;
  const projectProfiles = config?.projectProfiles || DEFAULT_PROJECT_TAG_PROFILES;
  const tagRoutes = config?.tagRoutes || DEFAULT_TAG_ROUTES;
  const lines: string[] = [
    '# Orthogonal Tag Taxonomy & Project Hashtags (L0–L7)',
    '',
    `> Updated: ${config?.updatedAt || new Date().toISOString()}`,
    '> Import/Export compatible with Obsidian Local LLM Pipeline.',
    ''
  ];

  // 1. Axes L0-L7
  lines.push('## 1. Orthogonal Taxonomy Axes (L0–L7)');
  lines.push('');
  for (const axis of axes) {
    lines.push(`### ${axis.label}`);
    if (axis.question) {
      lines.push(`*${axis.question}*`);
    }
    lines.push('');
    lines.push('```text');
    for (const t of axis.tags) {
      lines.push(`#${t.replace(/^#+/, '')}`);
    }
    lines.push('```');
    lines.push('');
  }

  // 2. Project Hashtag Profiles
  lines.push('---');
  lines.push('');
  lines.push('## 2. Project & Research Hashtag Profiles (L3 + L4)');
  lines.push('');
  for (const prof of projectProfiles) {
    lines.push(`### ${prof.id}`);
    lines.push(`Folder: ${prof.targetFolder}`);
    if (prof.aliases && prof.aliases.length > 0) {
      lines.push(`Aliases: ${prof.aliases.join(', ')}`);
    }
    lines.push('');
    lines.push('```text');
    const uniqueTags = Array.from(new Set([prof.projectTag, ...prof.associatedTags]));
    for (const t of uniqueTags) {
      lines.push(`#${t.replace(/^#+/, '')}`);
    }
    lines.push('```');
    lines.push('');
  }

  // 3. Tag-to-Directory Routing Rules
  lines.push('---');
  lines.push('');
  lines.push('## 3. Tag-to-Directory Routing Rules');
  lines.push('');
  lines.push('```text');
  for (const [tag, folder] of Object.entries(tagRoutes)) {
    lines.push(`#${tag.replace(/^#+/, '')} -> ${folder}`);
  }
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

/**
 * Extracts tags from note frontmatter, body, and filename.
 * Supports hierarchical tags (`type/research`, `domain/AI/LLM`, `priority/P1`)
 * and strips out non-word garbage codes (`#01G23`).
 */
export function extractTags(frontmatter: string, body: string, filename: string): string[] {
  const tagsSet = new Set<string>();
  const seenLower = new Set<string>();

  const addClean = (raw: unknown) => {
    if (typeof raw !== 'string' && typeof raw !== 'number') return;
    const clean = normalizeToCanonicalTag(String(raw).trim().replace(/^#+/, '').trim());
    if (isValidSemanticTag(clean, { allowSingleLetter: false })) {
      const lower = clean.toLowerCase();
      if (!seenLower.has(lower)) {
        seenLower.add(lower);
        tagsSet.add(clean);
      }
    }
  };

  // 1. Frontmatter tags (YAML list, array, or comma-separated)
  if (frontmatter && frontmatter.trim()) {
    try {
      const doc = parseDocument(frontmatter);
      const js = doc.toJS();
      if (js && typeof js === 'object') {
        const rawTags = (js as any).tags;
        if (Array.isArray(rawTags)) {
          for (const t of rawTags) addClean(t);
        } else if (typeof rawTags === 'string') {
          for (const t of rawTags.split(',')) addClean(t);
        }
      }
    } catch {
      // ignore parse error and fallback to regex
    }

    if (tagsSet.size === 0) {
      const fmTagsMatch = frontmatter.match(/tags:\s*([\s\S]*?)(?=(?:\r?\n\w+:|$))/i);
      if (fmTagsMatch) {
        const block = fmTagsMatch[1].trim();
        const tagMatches = block.match(/[\p{L}\p{N}_/×²+-]+/gu) || [];
        for (const t of tagMatches) {
          addClean(t);
        }
      }
    }
  }

  // 2. Inline #tags in body and filename (supports hierarchical #type/research, #priority/P1, etc.)
  const bodyWithoutCode = (body || '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
  const textToScan = `${filename}\n${bodyWithoutCode}`;
  const inlineMatches = textToScan.match(/(?:^|\s)#([\p{L}\p{N}_/×²+-]+)/gu) || [];
  for (const m of inlineMatches) {
    const clean = m.trim().replace(/^#+/, '').replace(/\/+$/, '');
    addClean(clean);
  }

  return Array.from(tagsSet);
}
