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
    else if (!replaceExisting) {
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
    } else if (/проект|project|дорожн\w+ карт\w+|roadmap|запуск|франшиз/i.test(combinedHeader) || folderLower.startsWith('01_projects')) {
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
 * Loads the vault's Orthogonal Tag Taxonomy (merging `99_System/tag_taxonomy.json` if present
 * and dynamically injecting `project/<Name>` for all projects discovered in the vault).
 */
export async function loadVaultTagTaxonomy(
  vaultPath?: string,
  discoveredProjects: Array<{ id: string; folder: string; aliases: string[] }> = []
): Promise<TaxonomyAxisDefinition[]> {
  const axes: TaxonomyAxisDefinition[] = DEFAULT_TAG_TAXONOMY.map(a => ({
    ...a,
    tags: [...a.tags]
  }));

  if (vaultPath && fs.existsSync(vaultPath)) {
    const customPath = path.join(vaultPath, '99_System', 'tag_taxonomy.json');
    if (fs.existsSync(customPath)) {
      try {
        const raw = JSON.parse(await fsPromises.readFile(customPath, 'utf-8'));
        if (Array.isArray(raw.axes)) {
          for (const customAxis of raw.axes) {
            const target = axes.find(a => a.id === customAxis.id);
            if (target && Array.isArray(customAxis.tags)) {
              target.tags = sanitizeTagList(customAxis.tags, { allowSingleLetter: false });
              for (const t of target.tags) {
                CANONICAL_TAG_MAP.set(t.toLowerCase(), t);
              }
            }
          }
        }
      } catch {}
    }
  }

  // Dynamically inject discovered Vault projects into L3 (project/...)
  const projectAxis = axes.find(a => a.id === 'project');
  if (projectAxis && discoveredProjects.length > 0) {
    const existingLower = new Set(projectAxis.tags.map(t => t.toLowerCase()));
    for (const proj of discoveredProjects) {
      const folderName = (proj.folder.split('/').pop() || proj.id).trim().replace(/\s+/g, '-');
      if (!folderName) continue;
      const projTag = `project/${folderName}`;
      if (!existingLower.has(projTag.toLowerCase())) {
        existingLower.add(projTag.toLowerCase());
        projectAxis.tags.push(projTag);
        CANONICAL_TAG_MAP.set(projTag.toLowerCase(), projTag);
      }
    }
  }

  return axes;
}

/**
 * Saves custom modifications (added/removed tags) to `99_System/tag_taxonomy.json` in the vault.
 */
export async function saveVaultTagTaxonomy(
  vaultPath: string,
  axes: TaxonomyAxisDefinition[]
): Promise<string> {
  const sysDir = path.join(vaultPath, '99_System');
  await fsPromises.mkdir(sysDir, { recursive: true });
  const targetFile = path.join(sysDir, 'tag_taxonomy.json');
  await fsPromises.writeFile(
    targetFile,
    JSON.stringify({ updatedAt: new Date().toISOString(), axes }, null, 2),
    'utf-8'
  );
  for (const axis of axes) {
    for (const t of axis.tags) {
      CANONICAL_TAG_MAP.set(t.toLowerCase(), t);
    }
  }
  return targetFile;
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
