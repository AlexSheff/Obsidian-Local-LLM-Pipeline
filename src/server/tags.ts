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
    projectTag: 'Hermes',
    targetFolder: '01_Projects/Hermes',
    associatedTags: [
      'Hermes',
      'agent-orchestration',
      'multi-agent',
      'memory',
      'routing',
      'local-LLM',
      'free-API',
      'protocol',
      'agents',
      'LLM',
      'local-AI'
    ],
    aliases: ['Hermes', '\u0413\u0435\u0440\u043c\u0435\u0441', 'Hermes Agent', 'agent-orchestration', 'multi-agent']
  },
  {
    id: 'Obsidian-LLM-Pipeline',
    projectTag: 'Obsidian-LLM-Pipeline',
    targetFolder: '01_Projects/Obsidian-LLM-Pipeline',
    associatedTags: [
      'Obsidian-LLM-Pipeline',
      'semantic-ingestion',
      'tagging',
      'classification',
      'file-routing',
      'registry',
      'queue',
      'watchdog',
      'knowledge-management',
      'local-AI',
      'semantics'
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
    projectTag: 'Neuromicon',
    targetFolder: '01_Projects/Neuromicon',
    associatedTags: [
      'Neuromicon',
      'World-1149',
      'Protocol-Contact',
      '24+1',
      'Defragmentation',
      'E=M×C²',
      'transmedia',
      'ARG',
      'storytelling',
      'film'
    ],
    aliases: [
      'Neuromicon',
      '\u041d\u0435\u0439\u0440\u043e\u043c\u0438\u043a\u043e\u043d',
      'World-1149',
      '\u041c\u0438\u0440 1149',
      'Protocol-Contact',
      '\u041f\u0440\u043e\u0442\u043e\u043a\u043e\u043b \u041a\u043e\u043d\u0442\u0430\u043a\u0442',
      'Defragmentation',
      '\u0414\u0435\u0444\u0440\u0430\u0433\u043c\u0435\u043d\u0442\u0430\u0446\u0438\u044f',
      '24+1',
      'E=M×C²'
    ]
  },
  {
    id: 'UUCPFF',
    projectTag: 'UUCPFF',
    targetFolder: '01_Projects/UUCPFF',
    associatedTags: [
      'UUCPFF',
      'film-festival',
      'creator-network',
      'film-submission',
      'curation',
      'distribution',
      'film',
      'creative',
      'community'
    ],
    aliases: ['UUCPFF', 'film-festival', 'creator-network', 'film-submission', '\u043a\u0438\u043d\u043e\u0444\u0435\u0441\u0442\u0438\u0432\u0430\u043b\u044c']
  },
  {
    id: 'Escape2Reality',
    projectTag: 'Escape2Reality',
    targetFolder: '01_Projects/Escape2Reality',
    associatedTags: [
      'Escape2Reality',
      'transmedia',
      'ARG',
      'creative',
      'storytelling'
    ],
    aliases: ['Escape2Reality', 'Escape to Reality', '\u042d\u0441\u043a\u0435\u0439\u043f']
  },
  {
    id: 'Engineering-Intelligence',
    projectTag: 'Engineering-Intelligence',
    targetFolder: '01_Projects/Engineering-Intelligence',
    associatedTags: [
      'Engineering-Intelligence',
      'AI',
      'semantics',
      'ontology',
      'knowledge',
      'information-theory'
    ],
    aliases: ['Engineering-Intelligence', 'Engineering Intelligence', '\u0418\u043d\u0436\u0435\u043d\u0435\u0440\u043d\u044b\u0439 \u0438\u043d\u0442\u0435\u043b\u043b\u0435\u043a\u0442']
  },
  {
    id: 'Restore-Dumaguete',
    projectTag: 'Restore-Dumaguete',
    targetFolder: '01_Projects/Restore-Dumaguete',
    associatedTags: [
      'Restore-Dumaguete',
      'community',
      'society',
      'operations',
      'governance',
      'paused'
    ],
    aliases: ['Restore-Dumaguete', 'Restore Dumaguete', 'Dumaguete', '\u0414\u0443\u043c\u0430\u0433\u0435\u0442\u0435']
  },
  {
    id: 'TOTEM',
    projectTag: 'TOTEM',
    targetFolder: '01_Projects/TOTEM',
    associatedTags: [
      'TOTEM',
      'creative',
      'storytelling',
      'philosophy',
      'transmedia'
    ],
    aliases: ['TOTEM', '\u0422\u043e\u0442\u0435\u043c']
  },
  {
    id: 'semantic-hypergraph',
    projectTag: 'semantic-hypergraph',
    targetFolder: '03_Knowledge/Research/semantic-hypergraph',
    associatedTags: [
      'semantic-hypergraph',
      'hypergraph',
      'semantics',
      'graph-theory',
      'ontology',
      'research'
    ],
    aliases: ['semantic-hypergraph', 'semantic hypergraph', '\u0441\u0435\u043c\u0430\u043d\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u0439 \u0433\u0438\u043f\u0435\u0440\u0433\u0440\u0430\u0444']
  },
  {
    id: 'JeV-response',
    projectTag: 'JeV-response',
    targetFolder: '03_Knowledge/Research/JeV-response',
    associatedTags: [
      'JeV-response',
      'local-AI',
      'LLM',
      'classification',
      'routing',
      'research'
    ],
    aliases: ['JeV-response', 'JeV response', 'Jev Decision']
  },
  {
    id: 'semantic-quantization',
    projectTag: 'semantic-quantization',
    targetFolder: '03_Knowledge/Research/semantic-quantization',
    associatedTags: [
      'semantic-quantization',
      'semantics',
      'information-theory',
      'LLM',
      'research'
    ],
    aliases: ['semantic-quantization', 'semantic quantization', '\u0441\u0435\u043c\u0430\u043d\u0442\u0438\u0447\u0435\u0441\u043a\u043e\u0435 \u043a\u0432\u0430\u043d\u0442\u043e\u0432\u0430\u043d\u0438\u0435']
  },
  {
    id: 'language-evolution',
    projectTag: 'language-evolution',
    targetFolder: '03_Knowledge/Research/language-evolution',
    associatedTags: [
      'language-evolution',
      'language',
      'semantics',
      'society',
      'research'
    ],
    aliases: ['language-evolution', 'language evolution', '\u044d\u0432\u043e\u043b\u044e\u0446\u0438\u044f \u044f\u0437\u044b\u043a\u0430']
  },
  {
    id: 'planetary-values',
    projectTag: 'planetary-values',
    targetFolder: '03_Knowledge/Research/planetary-values',
    associatedTags: [
      'planetary-values',
      'society',
      'philosophy',
      'governance',
      'research'
    ],
    aliases: ['planetary-values', 'planetary values', '\u043f\u043b\u0430\u043d\u0435\u0442\u0430\u0440\u043d\u044b\u0435 \u0446\u0435\u043d\u043d\u043e\u0441\u0442\u0438']
  },
  {
    id: 'future-economy',
    projectTag: 'future-economy',
    targetFolder: '03_Knowledge/Research/future-economy',
    associatedTags: [
      'future-economy',
      'economy',
      'institutions',
      'research'
    ],
    aliases: ['future-economy', 'future economy', '\u044d\u043a\u043e\u043d\u043e\u043c\u0438\u043a\u0430 \u0431\u0443\u0434\u0443\u0449\u0435\u0433\u043e']
  }
];

export const DEFAULT_TAG_ROUTES: Record<string, string> = {
  Hermes: '01_Projects/Hermes',
  'Obsidian-LLM-Pipeline': '01_Projects/Obsidian-LLM-Pipeline',
  Neuromicon: '01_Projects/Neuromicon',
  UUCPFF: '01_Projects/UUCPFF',
  Escape2Reality: '01_Projects/Escape2Reality',
  'Engineering-Intelligence': '01_Projects/Engineering-Intelligence',
  'Restore-Dumaguete': '01_Projects/Restore-Dumaguete',
  TOTEM: '01_Projects/TOTEM',
  'semantic-hypergraph': '03_Knowledge/Research/semantic-hypergraph',
  'JeV-response': '03_Knowledge/Research/JeV-response',
  'semantic-quantization': '03_Knowledge/Research/semantic-quantization',
  'language-evolution': '03_Knowledge/Research/language-evolution',
  'planetary-values': '03_Knowledge/Research/planetary-values',
  'future-economy': '03_Knowledge/Research/future-economy',
  project: '01_Projects/Active',
  research: '03_Knowledge/Research',
  whitepaper: '03_Knowledge/Research',
  scenario: '03_Knowledge/Scripts',
  meeting: '04_Journal',
  event: '04_Journal',
  idea: '05_Ideas',
  task: '01_Projects/Active',
  protocol: '03_Knowledge/Technical',
  tool: '03_Knowledge/Technical',
  dataset: '03_Knowledge/Technical',
  person: '02_Areas/People',
  organization: '02_Areas/Organizations',
  place: '02_Areas/Places',
  area: '02_Areas',
  entity: '03_Knowledge/Entities',
  concept: '03_Knowledge/Essays',
  reference: '03_Knowledge/Essays',
  archived: '06_Archive'
};

export const DEFAULT_TAG_TAXONOMY: TaxonomyAxisDefinition[] = [
  {
    id: 'root',
    level: 'L0',
    label: 'L0 — System & Infrastructure',
    question: 'What infrastructure, methodology, or standard does this define?',
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
    label: 'L1 — Object Type',
    question: 'What kind of object is this document?',
    prefix: '',
    tags: [
      'project',
      'area',
      'person',
      'organization',
      'place',
      'entity',
      'concept',
      'research',
      'whitepaper',
      'scenario',
      'idea',
      'task',
      'meeting',
      'event',
      'reference',
      'protocol',
      'dataset',
      'tool'
    ]
  },
  {
    id: 'domain',
    level: 'L2',
    label: 'L2 — Subject Domain',
    question: 'Which subject domain does this belong to?',
    prefix: '',
    tags: [
      'AI',
      'agents',
      'LLM',
      'local-AI',
      'multimodal',
      'machine-learning',
      'quantum-computing',
      'cryptography',
      'cybersecurity',
      'software',
      'knowledge',
      'knowledge-management',
      'semantics',
      'language',
      'ontology',
      'graph-theory',
      'hypergraph',
      'information-theory',
      'society',
      'economy',
      'future-economy',
      'institutions',
      'governance',
      'education',
      'community',
      'creative',
      'film',
      'music',
      'transmedia',
      'storytelling',
      'ARG',
      'philosophy',
      'personal',
      'business',
      'funding',
      'network',
      'strategy',
      'operations'
    ]
  },
  {
    id: 'project',
    level: 'L3',
    label: 'L3 — Projects & Research',
    question: 'Which project or research stream does it belong to?',
    prefix: '',
    tags: [
      'Hermes',
      'Obsidian-LLM-Pipeline',
      'Neuromicon',
      'Escape2Reality',
      'UUCPFF',
      'Engineering-Intelligence',
      'Restore-Dumaguete',
      'TOTEM',
      'semantic-hypergraph',
      'JeV-response',
      'semantic-quantization',
      'language-evolution',
      'planetary-values',
      'future-economy'
    ]
  },
  {
    id: 'system',
    level: 'L4',
    label: 'L4 — Subsystem & Concept',
    question: 'What function does it perform or what concept does it develop?',
    prefix: '',
    tags: [
      'agent-orchestration',
      'multi-agent',
      'memory',
      'routing',
      'local-LLM',
      'free-API',
      'protocol',
      'semantic-ingestion',
      'tagging',
      'classification',
      'file-routing',
      'registry',
      'queue',
      'watchdog',
      'transmedia',
      'ARG',
      'film-festival',
      'creator-network',
      'film-submission',
      'curation',
      'distribution',
      'World-1149',
      'Protocol-Contact',
      '24+1',
      'Defragmentation',
      'E=M×C²'
    ]
  },
  {
    id: 'status',
    level: 'L5',
    label: 'L5 — Lifecycle Status',
    question: 'What state is this object currently in?',
    prefix: '',
    tags: [
      'idea',
      'prototype',
      'active',
      'testing',
      'paused',
      'blocked',
      'completed',
      'archived'
    ]
  },
  {
    id: 'priority',
    level: 'L6',
    label: 'L6 — Priority Level',
    question: 'How critical is this item (P0–P3)?',
    prefix: '',
    tags: [
      'P0',
      'P1',
      'P2',
      'P3'
    ]
  },
  {
    id: 'stage',
    level: 'L7',
    label: 'L7 — Work Stage',
    question: 'What stage of execution is this material in?',
    prefix: '',
    tags: [
      'question',
      'discovery',
      'model',
      'design',
      'implementation',
      'validation',
      'deployment',
      'measurement'
    ]
  },
  {
    id: 'knowledge',
    level: 'Axis',
    label: 'Epistemic Nature',
    question: 'What is the epistemic role of this knowledge?',
    prefix: '',
    tags: [
      'fact',
      'observation',
      'hypothesis',
      'model',
      'theory',
      'assumption',
      'question',
      'decision',
      'evidence',
      'specification'
    ]
  },
  {
    id: 'relation',
    level: 'Axis',
    label: 'Entity Relation',
    question: 'What relationship does this document express?',
    prefix: '',
    tags: [
      'dependency',
      'component',
      'alternative',
      'extension',
      'integration',
      'inspiration',
      'evidence',
      'conflict'
    ]
  }
];

const CANONICAL_TAG_MAP = new Map<string, string>();
for (const axis of DEFAULT_TAG_TAXONOMY) {
  for (const t of axis.tags) {
    CANONICAL_TAG_MAP.set(t.toLowerCase(), t);
  }
}

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

const KNOWN_RESEARCH_IDS = new Set([
  'semantic-hypergraph',
  'jev-response',
  'semantic-quantization',
  'language-evolution',
  'planetary-values',
  'future-economy'
]);

/**
 * Strips any `#` prefix and any legacy hierarchical `/` prefixes (e.g. `#system/semantic-ingestion` -> `semantic-ingestion`,
 * `#domain/AI/agents` -> `agents`, `#project/Hermes` -> `Hermes`) so tags are always 100% clean, flat, and slash-free.
 */
export function stripTagPrefix(raw: string): string {
  const withoutHash = String(raw || '')
    .trim()
    .replace(/^#+/, '')
    .replace(/\/+$/, '')
    .trim();
  if (!withoutHash) return '';
  if (withoutHash.includes('/')) {
    const parts = withoutHash
      .split('/')
      .map(p => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return '';
    // Reject folder-like prefixes such as "01_Projects/..."
    if (/^\d/.test(parts[0])) return '';
    const last = parts[parts.length - 1];
    if (last.toLowerCase() === 'local' && parts.some(p => p.toLowerCase() === 'ai')) {
      return 'local-AI';
    }
    return last;
  }
  return withoutHash;
}

/**
 * Normalizes a raw tag string to a clean, slash-free canonical tag.
 */
export function normalizeToCanonicalTag(raw: string): string {
  const stripped = stripTagPrefix(raw);
  if (!stripped) return '';
  const lower = stripped.toLowerCase();
  const canonical = CANONICAL_TAG_MAP.get(lower);
  if (canonical) return canonical;
  return stripped;
}

/**
 * Validates that a tag is a clean, atomic, slash-free tag:
 * 1) Never contains `/` (no ugly path-like `#system/semantic-ingestion` tags),
 * 2) Matches a known canonical tag or allowed term, OR is a valid Unicode word/hyphenated phrase,
 * 3) Strictly rejects random alphanumeric IDs like "#01G23", "#w3x06", "#01_Projects", hex codes, or numeric IDs.
 */
export function isValidSemanticTag(
  raw: unknown,
  options?: { allowSingleLetter?: boolean }
): boolean {
  if (typeof raw !== 'string' && typeof raw !== 'number') return false;
  const clean = String(raw).trim().replace(/^#+/, '').trim();
  if (!clean) return false;

  // Clean tags must NEVER contain slashes '/'
  if (clean.includes('/')) return false;

  const minLen = options?.allowSingleLetter ? 1 : 2;
  if (clean.length < minLen || clean.length > 65) return false;

  const lower = clean.toLowerCase();
  if (BANNED_TAG_WORDS.has(lower)) return false;

  // 1. Exact match in canonical taxonomy or allowed terms
  if (CANONICAL_TAG_MAP.has(lower) || ALLOWED_ALPHANUMERIC_TERMS.has(lower)) {
    return true;
  }

  // 2. Flat tag validation: must start with a Unicode letter (blocks #01G23, #01_Projects, #1234, #2026)
  if (!/^[\p{L}]/u.test(clean)) {
    return false;
  }

  // Must NOT contain any digits unless it is in ALLOWED_ALPHANUMERIC_TERMS or CANONICAL_TAG_MAP
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
 * Maps synonyms, Russian terms, and legacy keywords into clean canonical tags (zero '/' slashes).
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
  '\u0430\u0440\u0445\u0438\u0442\u0435\u043a\u0442\u0443\u0440\u0430': 'architecture',
  '\u043f\u0440\u043e\u0442\u043e\u043a\u043e\u043b': 'protocol',
  '\u043c\u0435\u0442\u043e\u0434\u043e\u043b\u043e\u0433\u0438\u044f': 'method',
  '\u0441\u043f\u0440\u0430\u0432\u043e\u0447\u043d\u0438\u043a': 'reference',

  // L1 - Object Type
  project: 'project',
  '\u043f\u0440\u043e\u0435\u043a\u0442': 'project',
  area: 'area',
  person: 'person',
  organization: 'organization',
  place: 'place',
  entity: 'entity',
  concept: 'concept',
  '\u043a\u043e\u043d\u0446\u0435\u043f\u0442': 'concept',
  '\u043a\u043e\u043d\u0446\u0435\u043f\u0446\u0438\u044f': 'concept',
  research: 'research',
  '\u0438\u0441\u0441\u043b\u0435\u0434\u043e\u0432\u0430\u043d\u0438\u0435': 'research',
  whitepaper: 'whitepaper',
  '\u0432\u0430\u0439\u0442\u043f\u0435\u0439\u043f\u0435\u0440': 'whitepaper',
  scenario: 'scenario',
  script: 'scenario',
  screenplay: 'scenario',
  '\u0441\u0446\u0435\u043d\u0430\u0440\u0438\u0439': 'scenario',
  idea: 'idea',
  '\u0438\u0434\u0435\u044f': 'idea',
  task: 'task',
  '\u0437\u0430\u0434\u0430\u0447\u0430': 'task',
  action: 'task',
  'action-items': 'task',
  meeting: 'meeting',
  agenda: 'meeting',
  '\u0432\u0441\u0442\u0440\u0435\u0447\u0430': 'meeting',
  '\u0441\u043e\u0432\u0435\u0449\u0430\u043d\u0438\u0435': 'meeting',
  event: 'event',
  '\u0441\u043e\u0431\u044b\u0442\u0438\u0435': 'event',
  dataset: 'dataset',
  tool: 'tool',
  '\u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442': 'tool',

  // L2 - Subject Domain
  ai: 'AI',
  '\u0438\u0438': 'AI',
  '\u043d\u0435\u0439\u0440\u043e\u0441\u0435\u0442\u0438': 'AI',
  agents: 'agents',
  agent: 'agents',
  '\u0430\u0433\u0435\u043d\u0442': 'agents',
  '\u0430\u0433\u0435\u043d\u0442\u044b': 'agents',
  llm: 'LLM',
  'local-llm': 'local-LLM',
  'local-ai': 'local-AI',
  multimodal: 'multimodal',
  'machine-learning': 'machine-learning',
  ml: 'machine-learning',
  quantum: 'quantum-computing',
  'quantum-computing': 'quantum-computing',
  crypto: 'cryptography',
  cryptography: 'cryptography',
  '\u043a\u0440\u0438\u043f\u0442\u043e\u0433\u0440\u0430\u0444\u0438\u044f': 'cryptography',
  cybersecurity: 'cybersecurity',
  security: 'cybersecurity',
  '\u0431\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u043e\u0441\u0442\u044c': 'cybersecurity',
  software: 'software',
  code: 'software',
  '\u0440\u0430\u0437\u0440\u0430\u0431\u043e\u0442\u043a\u0430': 'software',
  semantics: 'semantics',
  '\u0441\u0435\u043c\u0430\u043d\u0442\u0438\u043a\u0430': 'semantics',
  ontology: 'ontology',
  '\u043e\u043d\u0442\u043e\u043b\u043e\u0433\u0438\u044f': 'ontology',
  hypergraph: 'hypergraph',
  '\u0433\u0438\u043f\u0435\u0440\u0433\u0440\u0430\u0444': 'hypergraph',
  'graph-theory': 'graph-theory',
  'information-theory': 'information-theory',
  'knowledge-management': 'knowledge-management',
  society: 'society',
  '\u043e\u0431\u0449\u0435\u0441\u0442\u0432\u043e': 'society',
  economy: 'economy',
  '\u044d\u043a\u043e\u043d\u043e\u043c\u0438\u043a\u0430': 'economy',
  'future-economy': 'future-economy',
  governance: 'governance',
  education: 'education',
  '\u043e\u0431\u0440\u0430\u0437\u043e\u0432\u0430\u043d\u0438\u0435': 'education',
  community: 'community',
  '\u0441\u043e\u043e\u0431\u0449\u0435\u0441\u0442\u0432\u043e': 'community',
  creative: 'creative',
  '\u0442\u0432\u043e\u0440\u0447\u0435\u0441\u0442\u0432\u043e': 'creative',
  film: 'film',
  '\u043a\u0438\u043d\u043e': 'film',
  music: 'music',
  '\u043c\u0443\u0437\u044b\u043a\u0430': 'music',
  transmedia: 'transmedia',
  '\u0442\u0440\u0430\u043d\u0441\u043c\u0435\u0434\u0438\u0430': 'transmedia',
  storytelling: 'storytelling',
  '\u0441\u0442\u043e\u0440\u0438\u0442\u0435\u043b\u043b\u0438\u043d\u0433': 'storytelling',
  arg: 'ARG',
  philosophy: 'philosophy',
  '\u0444\u0438\u043b\u043e\u0441\u043e\u0444\u0438\u044f': 'philosophy',
  business: 'business',
  '\u0431\u0438\u0437\u043d\u0435\u0441': 'business',
  funding: 'funding',
  '\u0438\u043d\u0432\u0435\u0441\u0442\u0438\u0446\u0438\u0438': 'funding',
  strategy: 'strategy',
  '\u0441\u0442\u0440\u0430\u0442\u0435\u0433\u0438\u044f': 'strategy',
  operations: 'operations',
  '\u043e\u043f\u0435\u0440\u0430\u0446\u0438\u043e\u043d\u043a\u0430': 'operations',

  // L3 - Projects & Research
  hermes: 'Hermes',
  'hermes-agent': 'Hermes',
  neuromicon: 'Neuromicon',
  '\u043d\u0435\u0439\u0440\u043e\u043c\u0438\u043a\u043e\u043d': 'Neuromicon',
  escape2reality: 'Escape2Reality',
  uucpff: 'UUCPFF',
  totem: 'TOTEM',
  '\u0442\u043e\u0442\u0435\u043c': 'TOTEM',
  'semantic-hypergraph': 'semantic-hypergraph',
  'jev-response': 'JeV-response',
  'semantic-quantization': 'semantic-quantization',

  // L4 - Subsystem & Concept
  'system-prompt': 'agent-orchestration',
  'agent-orchestration': 'agent-orchestration',
  'multi-agent': 'multi-agent',
  memory: 'memory',
  routing: 'routing',
  'file-routing': 'file-routing',
  classification: 'classification',
  tagging: 'tagging',
  'semantic-ingestion': 'semantic-ingestion',
  registry: 'registry',
  queue: 'queue',
  watchdog: 'watchdog',
  'film-festival': 'film-festival',
  'world-1149': 'World-1149',
  '1149': 'World-1149',
  'protocol-contact': 'Protocol-Contact',
  defragmentation: 'Defragmentation',

  // L5 - Status
  active: 'active',
  prototype: 'prototype',
  '\u043f\u0440\u043e\u0442\u043e\u0442\u0438\u043f': 'prototype',
  testing: 'testing',
  '\u0442\u0435\u0441\u0442\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435': 'testing',
  paused: 'paused',
  blocked: 'blocked',
  completed: 'completed',
  archived: 'archived',

  // L6 - Priority
  p0: 'P0',
  p1: 'P1',
  p2: 'P2',
  p3: 'P3',

  // L7 - Stage
  discovery: 'discovery',
  design: 'design',
  implementation: 'implementation',
  roadmap: 'design',
  'launch-plan': 'deployment',
  validation: 'validation',
  deployment: 'deployment',
  measurement: 'measurement',

  // Knowledge axis
  fact: 'fact',
  observation: 'observation',
  hypothesis: 'hypothesis',
  '\u0433\u0438\u043f\u043e\u0442\u0435\u0437\u0430': 'hypothesis',
  model: 'model',
  '\u043c\u043e\u0434\u0435\u043b\u044c': 'model',
  theory: 'theory',
  '\u0442\u0435\u043e\u0440\u0438\u044f': 'theory',
  assumption: 'assumption',
  decision: 'decision',
  '\u0440\u0435\u0448\u0435\u043d\u0438\u0435': 'decision',
  evidence: 'evidence',
  specification: 'specification',
  '\u0442\u0437': 'specification',
  '\u0441\u043f\u0435\u0446\u0438\u0444\u0438\u043a\u0430\u0446\u0438\u044f': 'specification'
};

/**
 * Infers which project (or research direction) a note belongs to by scoring:
 * 1) Explicit project/research tags (`#Hermes`, `#Neuromicon`, `#semantic-hypergraph`) in existingTags/body
 * 2) Project aliases in filename or title
 * 3) Project-specific associated tags & concepts (e.g. `#World-1149` -> `Neuromicon`,
 *    `#film-festival` -> `UUCPFF`, or any custom hashtags imported by the user).
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
    const cleanPTag = stripTagPrefix(prof.projectTag) || prof.id;
    CANONICAL_TAG_MAP.set(cleanPTag.toLowerCase(), cleanPTag);
    const cleanAssoc = prof.associatedTags.map(t => stripTagPrefix(t)).filter(Boolean);
    for (const ca of cleanAssoc) {
      CANONICAL_TAG_MAP.set(ca.toLowerCase(), ca);
    }
    profilesByKey.set(cleanPTag.toLowerCase(), {
      ...prof,
      projectTag: cleanPTag,
      associatedTags: cleanAssoc,
      aliases: [...prof.aliases]
    });
  }

  for (const dp of discoveredProjects) {
    const folderName = (dp.folder.split('/').pop() || dp.id).trim().replace(/\s+/g, '-');
    if (!folderName) continue;
    const pTag = stripTagPrefix(folderName);
    if (!pTag) continue;
    CANONICAL_TAG_MAP.set(pTag.toLowerCase(), pTag);
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

  const domainAndTypeLower = new Set<string>();
  for (const ax of DEFAULT_TAG_TAXONOMY) {
    if (ax.id === 'domain' || ax.id === 'type' || ax.id === 'root' || ax.id === 'status') {
      for (const t of ax.tags) domainAndTypeLower.add(t.toLowerCase());
    }
  }

  // Count how many profiles share each associatedTag so unique tags carry higher weight
  const tagFrequency = new Map<string, number>();
  for (const prof of allProfiles) {
    for (const t of prof.associatedTags) {
      const low = stripTagPrefix(t).toLowerCase();
      if (low) tagFrequency.set(low, (tagFrequency.get(low) || 0) + 1);
    }
  }

  const normHeader = `${filename} ${title}`.toLowerCase().replace(/[_-]+/g, ' ');
  const normBody = body.slice(0, 4000).toLowerCase().replace(/[_-]+/g, ' ');
  const rawCombined = `${filename}\n${title}\n${body.slice(0, 4000)}`.toLowerCase();
  const folderLower = folder.toLowerCase().replace(/\\/g, '/');
  const normExistingTags = new Set(
    existingTags.map(t => stripTagPrefix(String(t)).toLowerCase()).filter(Boolean)
  );

  let bestProfile: ProjectTagProfile | null = null;
  let bestScore = 0;
  let bestAssociated: string[] = [];

  for (const prof of allProfiles) {
    let score = 0;
    const matchedAssoc = new Set<string>();
    const pTagLower = prof.projectTag.toLowerCase();

    // 1. Direct project tag in existingTags or inline #ProjectName in text
    if (
      normExistingTags.has(pTagLower) ||
      rawCombined.includes(`#${pTagLower}`) ||
      rawCombined.includes(`#project/${pTagLower}`) ||
      rawCombined.includes(`#research/${pTagLower}`)
    ) {
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
    for (const assocRaw of prof.associatedTags) {
      const assoc = stripTagPrefix(assocRaw);
      const assocLower = assoc.toLowerCase();
      if (!assocLower || assocLower === pTagLower) continue;

      const leafSpaced = assocLower.replace(/[_-]+/g, ' ');
      const freq = tagFrequency.get(assocLower) || 1;
      const isUniqueToProject = freq === 1 && !domainAndTypeLower.has(assocLower);

      const hasExactTag =
        normExistingTags.has(assocLower) ||
        rawCombined.includes(`#${assocLower}`) ||
        rawCombined.includes(`/${assocLower}`);
      const hasLeafInText =
        assocLower.length >= 4 &&
        (rawCombined.includes(assocLower) ||
          (leafSpaced.length >= 5 && normBody.includes(leafSpaced)) ||
          normHeader.includes(leafSpaced));

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

  // Require a meaningful threshold (score >= 4)
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
 * Determines the target vault directory for a Markdown file based on its clean tags
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

  const cleanTags = tags.map(t => stripTagPrefix(String(t))).filter(Boolean);

  // Build case-insensitive route lookup and project lookup
  const routeMap = new Map<string, string>();
  const projectLookup = new Map<string, { id: string; tag: string; folder: string }>();

  for (const [k, v] of Object.entries(DEFAULT_TAG_ROUTES)) {
    const cleanKey = stripTagPrefix(k);
    if (cleanKey) routeMap.set(cleanKey.toLowerCase(), v);
  }
  for (const [k, v] of Object.entries(tagRoutes || {})) {
    const cleanKey = stripTagPrefix(k);
    if (cleanKey && v) routeMap.set(cleanKey.toLowerCase(), v.trim());
  }
  for (const prof of projectProfiles) {
    const cleanPTag = stripTagPrefix(prof.projectTag) || prof.id;
    if (cleanPTag && prof.targetFolder) {
      routeMap.set(cleanPTag.toLowerCase(), prof.targetFolder);
      projectLookup.set(cleanPTag.toLowerCase(), {
        id: prof.id,
        tag: cleanPTag,
        folder: prof.targetFolder
      });
    }
  }
  for (const dp of discoveredProjects) {
    const folderName = (dp.folder.split('/').pop() || dp.id).trim().replace(/\s+/g, '-');
    const cleanKey = stripTagPrefix(folderName);
    if (cleanKey && dp.folder) {
      routeMap.set(cleanKey.toLowerCase(), dp.folder);
      routeMap.set(dp.id.toLowerCase(), dp.folder);
      projectLookup.set(cleanKey.toLowerCase(), {
        id: folderName,
        tag: cleanKey,
        folder: dp.folder
      });
    }
  }

  // 0. If explicitly marked `archived` (and not `active`), route to Archive
  if (
    cleanTags.some(t => t.toLowerCase() === 'archived') &&
    !cleanTags.some(t => t.toLowerCase() === 'active')
  ) {
    return {
      targetFolder: routeMap.get('archived') || '06_Archive',
      matchedByTag: 'archived',
      matchedProjectId: null
    };
  }

  // 1. Highest priority: Known project or research tag -> routes directly to that project/research directory
  for (const tag of cleanTags) {
    const lower = tag.toLowerCase();
    const projMatch = projectLookup.get(lower);
    if (projMatch) {
      return {
        targetFolder: projMatch.folder,
        matchedByTag: projMatch.tag,
        matchedProjectId: projMatch.id
      };
    }
  }

  // 2. Specific Object Type tags (preferring specific types over generic `reference` or `concept`)
  const specificTypeOrder = [
    'scenario',
    'meeting',
    'event',
    'whitepaper',
    'research',
    'protocol',
    'tool',
    'dataset',
    'idea',
    'task',
    'person',
    'organization',
    'place',
    'area',
    'entity',
    'project',
    'concept',
    'reference'
  ];
  for (const prefType of specificTypeOrder) {
    const found = cleanTags.find(t => t.toLowerCase() === prefType);
    if (found) {
      if (prefType === 'reference' || prefType === 'concept') {
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

  // 3. Domain or System tags
  const techSet = new Set([
    'ai',
    'agents',
    'llm',
    'local-ai',
    'local-llm',
    'multimodal',
    'machine-learning',
    'quantum-computing',
    'cryptography',
    'cybersecurity',
    'software',
    'agent-orchestration',
    'multi-agent',
    'memory',
    'routing',
    'free-api',
    'semantic-ingestion',
    'tagging',
    'classification',
    'file-routing',
    'registry',
    'queue',
    'watchdog'
  ]);
  const scriptSet = new Set(['film', 'transmedia', 'storytelling', 'arg']);
  const bizSet = new Set(['business', 'funding', 'strategy', 'operations', 'personal', 'network']);

  for (const tag of cleanTags) {
    const lower = tag.toLowerCase();
    if (routeMap.has(lower) && lower !== 'reference' && lower !== 'concept') {
      return {
        targetFolder: routeMap.get(lower)!,
        matchedByTag: tag,
        matchedProjectId: null
      };
    }
    if (techSet.has(lower)) {
      return {
        targetFolder: '03_Knowledge/Technical',
        matchedByTag: tag,
        matchedProjectId: null
      };
    }
    if (scriptSet.has(lower)) {
      return {
        targetFolder: '03_Knowledge/Scripts',
        matchedByTag: tag,
        matchedProjectId: null
      };
    }
    if (lower === 'music') {
      return {
        targetFolder: '03_Knowledge/Songs',
        matchedByTag: tag,
        matchedProjectId: null
      };
    }
    if (bizSet.has(lower)) {
      return {
        targetFolder: '02_Areas/Business',
        matchedByTag: tag,
        matchedProjectId: null
      };
    }
  }

  // 4. Fallback to any remaining mapped tag or default folder
  for (const tag of cleanTags) {
    const mapped = routeMap.get(tag.toLowerCase());
    if (mapped) {
      return {
        targetFolder: mapped,
        matchedByTag: tag,
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
 * Qualitatively determines the structured Orthogonal Taxonomy tag set for a note using 100% clean, slash-free tags.
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

  // Build axis membership map from DEFAULT_TAG_TAXONOMY + customAxes + projectProfiles
  const axisByTagLower = new Map<string, string>();
  for (const ax of [...DEFAULT_TAG_TAXONOMY, ...customAxes]) {
    const axId = selectedByAxis[ax.id] ? ax.id : 'custom';
    for (const t of ax.tags) {
      const clean = stripTagPrefix(t);
      if (clean && !axisByTagLower.has(clean.toLowerCase())) {
        axisByTagLower.set(clean.toLowerCase(), axId);
        CANONICAL_TAG_MAP.set(clean.toLowerCase(), clean);
      }
    }
  }
  for (const prof of projectProfiles) {
    const pTag = stripTagPrefix(prof.projectTag) || prof.id;
    if (pTag) {
      axisByTagLower.set(pTag.toLowerCase(), 'project');
      CANONICAL_TAG_MAP.set(pTag.toLowerCase(), pTag);
    }
  }

  const assignTag = (tag: string) => {
    const stripped = stripTagPrefix(tag);
    if (!stripped) return;
    const mapped = LEGACY_TO_TAXONOMY_MAP[stripped.toLowerCase()] || normalizeToCanonicalTag(stripped);
    if (!isValidSemanticTag(mapped, { allowSingleLetter: false })) return;
    const lower = mapped.toLowerCase();

    if (lower === 'ru' || lower === 'en' || lower === 'ph') {
      selectedByAxis.lang.add(lower);
      return;
    }

    const targetAxisId = axisByTagLower.get(lower);
    if (targetAxisId && selectedByAxis[targetAxisId]) {
      selectedByAxis[targetAxisId].add(mapped);
    } else if (!replaceExisting) {
      selectedByAxis.custom.add(mapped);
    }
  };

  // 1. Process raw/existing tags through the clean taxonomy mapper
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
    const cleanPTag = stripTagPrefix(projectInference.matchedProjectTag);
    if (cleanPTag) selectedByAxis.project.add(cleanPTag);
    for (const assoc of projectInference.matchedAssociatedTags) {
      assignTag(assoc);
    }
  }

  // Also check custom user-imported axes for any tag whose keyword explicitly appears in the note header
  if (customAxes.length > 0) {
    for (const axis of customAxes) {
      for (const axisTag of axis.tags) {
        const cleanTag = stripTagPrefix(axisTag);
        if (cleanTag.length >= 4 && combinedHeader.includes(cleanTag.toLowerCase().replace(/[_-]+/g, ' '))) {
          assignTag(cleanTag);
        }
      }
    }
  }

  // Infer L1: TYPE (at least 1 primary object type)
  if (selectedByAxis.type.size === 0) {
    if (/whitepaper|\u0432\u0430\u0439\u0442\u043f\u0435\u0439\u043f\u0435\u0440/i.test(combinedText)) {
      selectedByAxis.type.add('whitepaper');
    } else if (/\u0441\u0446\u0435\u043d\u0430\u0440\u0438\u0439|screenplay|\u0438\u043d\u0442\.|\u043d\u0430\u0442\.|\u044d\u043f\u0438\u0437\u043e\u0434|\u043f\u0435\u0440\u0444\u043e\u043c\u0430\u043d\u0441/i.test(combinedText) || folderLower.includes('scripts')) {
      selectedByAxis.type.add('scenario');
    } else if (/\u0432\u0441\u0442\u0440\u0435\u0447|\u0441\u043e\u0432\u0435\u0449\u0430\u043d|agenda|meeting|action item|\u043f\u043e\u0432\u0435\u0441\u0442\u043a/i.test(combinedHeader) || folderLower.includes('dialogues')) {
      selectedByAxis.type.add('meeting');
    } else if (/\u043f\u0440\u043e\u0442\u043e\u043a\u043e\u043b|protocol/i.test(combinedHeader)) {
      selectedByAxis.type.add('protocol');
    } else if (/\u0438\u0441\u0441\u043b\u0435\u0434\u043e\u0432\u0430\u043d|research|\u0433\u0438\u043f\u043e\u0442\u0435\u0437|\u043a\u0432\u0430\u043d\u0442\u043e\u0432\u0430\u043d\u0438|hypergraph|\u0433\u0438\u043f\u0435\u0440\u0433\u0440\u0430\u0444/i.test(combinedHeader)) {
      selectedByAxis.type.add('research');
    } else if (/\u0438\u0434\u0435\u044f|\u0438\u043d\u043d\u043e\u0432\u0430\u0446\u0438\u043e\u043d\u043d|\u0431\u0440\u0435\u0439\u043d\u0448\u0442\u043e\u0440\u043c|idea/i.test(combinedHeader) || folderLower.includes('05_ideas')) {
      selectedByAxis.type.add('idea');
    } else if (/\u0437\u0430\u0434\u0430\u0447|\u0447\u0435\u043a-\u043b\u0438\u0441\u0442|todo|task/i.test(combinedHeader)) {
      selectedByAxis.type.add('task');
    } else if (
      /\u043f\u0440\u043e\u0435\u043a\u0442|project|\u0434\u043e\u0440\u043e\u0436\u043d\w+ \u043a\u0430\u0440\u0442\w+|roadmap|\u0437\u0430\u043f\u0443\u0441\u043a|\u0444\u0440\u0430\u043d\u0448\u0438\u0437/i.test(combinedHeader) ||
      folderLower.startsWith('01_projects') ||
      selectedByAxis.project.size > 0
    ) {
      selectedByAxis.type.add('project');
    } else if (/\u043a\u043e\u043d\u0446\u0435\u043f\u0442|concept|\u0444\u0438\u043b\u043e\u0441\u043e\u0444\u0438|\u0441\u043c\u044b\u0441\u043b\u0438\u0438/i.test(combinedHeader)) {
      selectedByAxis.type.add('concept');
    } else {
      selectedByAxis.type.add('reference');
    }
  }

  // Infer L2: DOMAIN (up to 2 most relevant domains)
  if (/hermes|\u0430\u0433\u0435\u043d\u0442|agent|multi-agent|\u043c\u0443\u043b\u044c\u0442\u0438\u0430\u0433\u0435\u043d\u0442/i.test(combinedText)) {
    selectedByAxis.domain.add('agents');
  }
  if (/llm|llama|qwen|gguf|\u043f\u0440\u043e\u043c\u043f\u0442|prompt|\u044f\u0437\u044b\u043a\u043e\u0432\w+ \u043c\u043e\u0434\u0435\u043b/i.test(combinedText)) {
    selectedByAxis.domain.add('LLM');
  } else if (/\u0438\u0438|\u0438\u0441\u043a\u0443\u0441\u0441\u0442\u0432\u0435\u043d\u043d\w+ \u0438\u043d\u0442\u0435\u043b\u043b\u0435\u043a\u0442|\u043d\u0435\u0439\u0440\u043e\u0441\u0435\u0442|\bai\b/i.test(combinedText)) {
    selectedByAxis.domain.add('AI');
  }
  if (/\u0433\u0438\u043f\u0435\u0440\u0433\u0440\u0430\u0444|hypergraph/i.test(combinedText)) {
    selectedByAxis.domain.add('hypergraph');
  }
  if (/\u0441\u0435\u043c\u0430\u043d\u0442\u0438\u043a|semantic|\u0442\u0430\u043a\u0441\u043e\u043d\u043e\u043c\u0438|taxonomy|\u043e\u043d\u0442\u043e\u043b\u043e\u0433\u0438|ontology/i.test(combinedText)) {
    selectedByAxis.domain.add('semantics');
  }
  if (/\u0431\u0430\u0437\w+ \u0437\u043d\u0430\u043d\u0438\u0439|obsidian|vault|knowledge management/i.test(combinedText)) {
    selectedByAxis.domain.add('knowledge-management');
  }
  if (/\u0444\u0438\u043b\u043e\u0441\u043e\u0444|\u0441\u0432\u043e\u0431\u043e\u0434\w+ \u0432\u044b\u0431\u043e\u0440|\u0441\u043e\u0437\u043d\u0430\u043d\u0438|\u044d\u0442\u0438\u043a|\u0441\u043c\u044b\u0441\u043b/i.test(combinedText)) {
    selectedByAxis.domain.add('philosophy');
  }
  if (/\u0444\u0438\u043b\u044c\u043c|\u043a\u0438\u043d\u043e|\u0444\u0435\u0441\u0442\u0438\u0432\u0430\u043b|\u0441\u0446\u0435\u043d\u0430\u0440\u0438|\u0434\u0440\u0430\u043c\u0430\u0442\u0443\u0440\u0433|film/i.test(combinedText)) {
    selectedByAxis.domain.add('film');
  }
  if (/\u0442\u0440\u0430\u043d\u0441\u043c\u0435\u0434\u0438\u0430|transmedia|arg\b|\u043f\u0435\u0440\u0444\u043e\u043c\u0430\u043d\u0441/i.test(combinedText)) {
    selectedByAxis.domain.add('transmedia');
  }
  if (/\u0431\u0438\u0437\u043d\u0435\u0441|\u0444\u0440\u0430\u043d\u0448\u0438\u0437|\u043f\u0440\u043e\u0438\u0437\u0432\u043e\u0434\u0441\u0442\u0432|\u043c\u043e\u043d\u0435\u0442\u0438\u0437\u0430\u0446|\u0440\u044b\u043d\u043e\u043a|\u043c\u0430\u0440\u043a\u0435\u0442\u0438\u043d\u0433/i.test(combinedText)) {
    selectedByAxis.domain.add('business');
  }
  if (/\u044d\u043a\u043e\u043d\u043e\u043c\u0438\u043a|economy/i.test(combinedText)) {
    selectedByAxis.domain.add('economy');
  }
  if (/\u043a\u043e\u0434|\u0441\u0435\u0440\u0432\u0435\u0440|api|typescript|python|node|\u0430\u0440\u0445\u0438\u0442\u0435\u043a\u0442\u0443\u0440\w+ \u043f\u043e|software/i.test(combinedText)) {
    selectedByAxis.domain.add('software');
  }

  // Infer L3: PROJECT / RESEARCH (from dynamic vault projects + canonical research)
  for (const proj of discoveredProjects) {
    const folderName = proj.folder.split('/').pop() || proj.id;
    const matched = proj.aliases.some(alias => {
      if (!alias || alias.length < 2) return false;
      return combinedText.includes(alias.toLowerCase());
    });
    if (matched || folderLower === proj.folder.toLowerCase()) {
      const cleanProj = stripTagPrefix(folderName.replace(/\s+/g, '-'));
      if (cleanProj) {
        CANONICAL_TAG_MAP.set(cleanProj.toLowerCase(), cleanProj);
        selectedByAxis.project.add(cleanProj);
      }
    }
  }
  if (/hermes/i.test(combinedText)) selectedByAxis.project.add('Hermes');
  if (/obsidian.*pipeline|local llm pipeline|jev.*router/i.test(combinedText)) {
    selectedByAxis.project.add('Obsidian-LLM-Pipeline');
  }
  if (/neuromicon|\u043d\u0435\u0439\u0440\u043e\u043c\u0438\u043a\u043e\u043d|1149/i.test(combinedText)) {
    selectedByAxis.project.add('Neuromicon');
  }
  if (/escape2reality/i.test(combinedText)) selectedByAxis.project.add('Escape2Reality');
  if (/uucpff/i.test(combinedText)) selectedByAxis.project.add('UUCPFF');
  if (/totem|\u0442\u043e\u0442\u0435\u043c/i.test(combinedText)) selectedByAxis.project.add('TOTEM');
  if (/restore[\s-]*dumaguete/i.test(combinedText)) selectedByAxis.project.add('Restore-Dumaguete');
  if (/semantic[\s-]*hypergraph|\u0441\u0435\u043c\u0430\u043d\u0442\u0438\u0447\u0435\u0441\u043a\w+ \u0433\u0438\u043f\u0435\u0440\u0433\u0440\u0430\u0444/i.test(combinedText)) {
    selectedByAxis.project.add('semantic-hypergraph');
  }
  if (/jev[\s-]*response|jev[\s-]*decision/i.test(combinedText)) {
    selectedByAxis.project.add('JeV-response');
  }

  // Infer L4: SYSTEM / CONCEPT
  if (/\u0441\u0438\u0441\u0442\u0435\u043c\u043d\w+ \u043f\u0440\u043e\u043c\u043f\u0442|system prompt|\u043e\u0440\u043a\u0435\u0441\u0442\u0440\u0430\u0446|orchestration/i.test(combinedText)) {
    selectedByAxis.system.add('agent-orchestration');
  }
  if (/\u043c\u0430\u0440\u0448\u0440\u0443\u0442\u0438\u0437\u0430\u0446|routing|router/i.test(combinedText)) {
    selectedByAxis.system.add('routing');
  }
  if (/\u043a\u043b\u0430\u0441\u0441\u0438\u0444\u0438\u043a\u0430\u0446|classification|triage|\u0442\u0440\u0438\u0430\u0436/i.test(combinedText)) {
    selectedByAxis.system.add('classification');
  }
  if (/\u0442\u0435\u0433\u0438\u0440\u043e\u0432\u0430\u043d|\u0442\u0430\u043a\u0441\u043e\u043d\u043e\u043c\u0438\w+ \u0442\u0435\u0433|tagging/i.test(combinedText)) {
    selectedByAxis.system.add('tagging');
  }
  if (/1149|world-1149/i.test(combinedText)) {
    selectedByAxis.system.add('World-1149');
  }

  // Infer Knowledge Axis
  if (/\u0442\u0435\u0445\u043d\u0438\u0447\u0435\u0441\u043a\w+ \u0437\u0430\u0434\u0430\u043d\u0438|\b\u0442\u0437\b|\u0441\u043f\u0435\u0446\u0438\u0444\u0438\u043a\u0430\u0446|specification|\u0442\u0440\u0435\u0431\u043e\u0432\u0430\u043d\u0438/i.test(combinedHeader)) {
    selectedByAxis.knowledge.add('specification');
  } else if (/\u0433\u0438\u043f\u043e\u0442\u0435\u0437|\u043f\u0440\u0435\u0434\u043f\u043e\u043b\u043e\u0436\u0435\u043d|hypothesis/i.test(combinedText)) {
    selectedByAxis.knowledge.add('hypothesis');
  } else if (/\u043c\u043e\u0434\u0435\u043b\w+|\u0441\u0442\u0440\u0443\u043a\u0442\u0443\u0440\w+|\u0430\u0440\u0445\u0438\u0442\u0435\u043a\u0442\u0443\u0440\w+|\u0442\u0430\u043a\u0441\u043e\u043d\u043e\u043c\u0438/i.test(combinedHeader)) {
    selectedByAxis.knowledge.add('model');
  } else if (/\u0440\u0435\u0448\u0435\u043d\u0438\w+|decision|\u0438\u0442\u043e\u0433/i.test(combinedHeader)) {
    selectedByAxis.knowledge.add('decision');
  }

  // Infer L5: STATUS & L7: STAGE (when relevant)
  if (selectedByAxis.status.size === 0) {
    if (selectedByAxis.type.has('idea')) {
      selectedByAxis.status.add('idea');
    } else if (selectedByAxis.type.has('project') || selectedByAxis.project.size > 0) {
      selectedByAxis.status.add('active');
    }
  }

  if (selectedByAxis.stage.size === 0) {
    if (/\u0434\u043e\u0440\u043e\u0436\u043d\w+ \u043a\u0430\u0440\u0442\w+|roadmap|\u043f\u043b\u0430\u043d \u0437\u0430\u043f\u0443\u0441\u043a|\u043a\u043e\u043d\u0446\u0435\u043f\u0446|\u0430\u0440\u0445\u0438\u0442\u0435\u043a\u0442\u0443\u0440|\u0441\u0442\u0440\u0443\u043a\u0442\u0443\u0440/i.test(combinedHeader)) {
      selectedByAxis.stage.add('design');
    } else if (/\u0440\u0435\u0430\u043b\u0438\u0437\u0430\u0446|\u0432\u043d\u0435\u0434\u0440\u0435\u043d|implementation|\u0440\u0430\u0437\u0440\u0430\u0431\u043e\u0442\u043a/i.test(combinedHeader)) {
      selectedByAxis.stage.add('implementation');
    } else if (/\u043f\u0440\u043e\u0432\u0435\u0440\u043a|\u0442\u0435\u0441\u0442\u0438\u0440\u043e\u0432\u0430\u043d|\u0432\u0430\u043b\u0438\u0434\u0430\u0446|validation/i.test(combinedHeader)) {
      selectedByAxis.stage.add('validation');
    }
  }

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
              const cleanT = normalizeToCanonicalTag(String(t));
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
                prefix: '',
                tags: sanitizeTagList(customAxis.tags, { allowSingleLetter: false })
              });
            }
          }
        }
        if (Array.isArray(raw.projectProfiles)) {
          for (const prof of raw.projectProfiles) {
            if (!prof || !prof.id || !prof.projectTag) continue;
            const pTag = normalizeToCanonicalTag(String(prof.projectTag));
            if (!pTag) continue;
            CANONICAL_TAG_MAP.set(pTag.toLowerCase(), pTag);
            const assoc: string[] = Array.isArray(prof.associatedTags)
              ? Array.from(
                  new Set(
                    prof.associatedTags
                      .map((t: unknown) => normalizeToCanonicalTag(String(t)))
                      .filter((t: string): t is string => Boolean(t))
                  )
                )
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
              const cleanKey = normalizeToCanonicalTag(k);
              if (cleanKey) {
                tagRoutes[cleanKey] = v.trim();
              }
            }
          }
        }
      } catch {}
    }
  }

  // Dynamically inject discovered Vault projects into L3, `projectProfiles`, and `tagRoutes`
  const projectAxis = axes.find(a => a.id === 'project');
  if (discoveredProjects.length > 0) {
    const existingLower = new Set((projectAxis?.tags || []).map(t => t.toLowerCase()));
    for (const proj of discoveredProjects) {
      const folderName = (proj.folder.split('/').pop() || proj.id).trim().replace(/\s+/g, '-');
      if (!folderName) continue;
      const projTag = normalizeToCanonicalTag(folderName) || folderName;
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

  // Also ensure every project/research tag in `projectAxis` has a profile and route
  if (projectAxis) {
    for (const pTag of projectAxis.tags) {
      const cleanPTag = normalizeToCanonicalTag(pTag) || pTag;
      const lower = cleanPTag.toLowerCase();
      if (!profilesMap.has(lower)) {
        const isRes = KNOWN_RESEARCH_IDS.has(lower);
        const defaultFolder = isRes ? `03_Knowledge/Research/${cleanPTag}` : `${projectsRoot}/${cleanPTag}`;
        profilesMap.set(lower, {
          id: cleanPTag,
          projectTag: cleanPTag,
          targetFolder: tagRoutes[cleanPTag] || defaultFolder,
          associatedTags: [cleanPTag],
          aliases: [cleanPTag, cleanPTag.replace(/[-_]+/g, ' ')]
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

  const cleanAxes = config.axes.map(ax => ({
    ...ax,
    prefix: '',
    tags: sanitizeTagList(ax.tags, { allowSingleLetter: false })
  }));

  const cleanProfiles = (config.projectProfiles || existingProfiles).map(prof => {
    const pTag = normalizeToCanonicalTag(prof.projectTag) || prof.id;
    const assoc = Array.from(
      new Set([pTag, ...(prof.associatedTags || []).map(t => normalizeToCanonicalTag(t)).filter(Boolean)])
    );
    return {
      ...prof,
      projectTag: pTag,
      associatedTags: assoc
    };
  });

  const rawRoutes = config.tagRoutes || existingRoutes;
  const cleanRoutes: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawRoutes)) {
    const cleanKey = normalizeToCanonicalTag(k);
    if (cleanKey && v) cleanRoutes[cleanKey] = v;
  }

  const payload: VaultTagTaxonomyConfig = {
    updatedAt: new Date().toISOString(),
    axes: cleanAxes,
    projectProfiles: cleanProfiles,
    tagRoutes: cleanRoutes
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
 * Normalizes all imported tags into 100% clean, slash-free tags (e.g. `Hermes`, `agent-orchestration`, `World-1149`)
 * while extracting:
 * - Multi-level taxonomy axes (`L0`..`L7`, `knowledge`, `relation`)
 * - Project Hashtag Profiles (`Hermes` + associated subsystem/concept/domain tags & aliases)
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
  const explicitlyMarkedProjectTags = new Set<string>();
  const explicitlyMarkedResearchTags = new Set<string>();

  const inferAxisIdFromHeading = (heading?: string): string | undefined => {
    if (!heading) return undefined;
    const h = heading.toLowerCase();
    if (/\bl0\b|root|\u0441\u0438\u0441\u0442\u0435\u043c\u043d\u044b\u0439 \u0443\u0440\u043e\u0432\u0435\u043d\u044c/.test(h)) return 'root';
    if (/\bl1\b|object type|\u0442\u0438\u043f \u043e\u0431\u044a\u0435\u043a\u0442\u0430/.test(h)) return 'type';
    if (/\bl2\b|domain|\u0434\u043e\u043c\u0435\u043d/.test(h)) return 'domain';
    if (/\bl3\b|\u043a\u043e\u043d\u043a\u0440\u0435\u0442\u043d\u044b\u0435 \u0441\u0438\u0441\u0442\u0435\u043c\u044b|named project/.test(h)) return 'project';
    if (/\bl4\b|subsystem|\u0444\u0443\u043d\u043a\u0446\u0438\u044f|\u043f\u043e\u0434\u0441\u0438\u0441\u0442\u0435\u043c\u0430/.test(h)) return 'system';
    if (/\bl5\b|status|\u0441\u0442\u0430\u0442\u0443\u0441/.test(h)) return 'status';
    if (/\bl6\b|priority|\u043f\u0440\u0438\u043e\u0440\u0438\u0442\u0435\u0442/.test(h)) return 'priority';
    if (/\bl7\b|stage|\u0441\u0442\u0430\u0434\u0438\u044f/.test(h)) return 'stage';
    if (/epistemic|knowledge|content|\u044d\u043f\u0438\u0441\u0442\u0435\u043c\u0438\u0447\u0435\u0441\u043a/.test(h)) return 'knowledge';
    if (/relation|\u0441\u0432\u044f\u0437/.test(h)) return 'relation';
    return undefined;
  };

  const registerTagInAxes = (rawTag: string, axisHint?: string): string | null => {
    const rawTrimmed = rawTag
      .trim()
      .replace(/^#+/, '')
      .replace(/[,:;.)\]}`]+$/, '')
      .replace(/^['"`(\[{]+/, '')
      .replace(/\/+$/, '')
      .trim();
    if (!rawTrimmed || rawTrimmed.length < 2 || rawTrimmed.length > 65) return null;

    const rawLower = rawTrimmed.toLowerCase();
    let prefixAxis: string | undefined;
    if (rawLower.startsWith('type/')) prefixAxis = 'type';
    else if (rawLower.startsWith('domain/')) prefixAxis = 'domain';
    else if (rawLower.startsWith('project/')) {
      prefixAxis = 'project';
    } else if (rawLower.startsWith('research/')) {
      prefixAxis = 'project';
    } else if (rawLower.startsWith('system/') || rawLower.startsWith('concept/')) prefixAxis = 'system';
    else if (rawLower.startsWith('status/')) prefixAxis = 'status';
    else if (rawLower.startsWith('priority/')) prefixAxis = 'priority';
    else if (rawLower.startsWith('stage/')) prefixAxis = 'stage';
    else if (rawLower.startsWith('knowledge/') || rawLower.startsWith('content/')) prefixAxis = 'knowledge';
    else if (rawLower.startsWith('relation/')) prefixAxis = 'relation';

    const clean = normalizeToCanonicalTag(rawTrimmed);
    if (!clean || clean.length < 2 || clean.length > 65) return null;
    if (/^\d+$/.test(clean) || /^[0-9a-f]{3,6}$/i.test(clean)) return null;
    if (BANNED_TAG_WORDS.has(clean.toLowerCase())) return null;

    // Register in CANONICAL_TAG_MAP so isValidSemanticTag accepts user-imported tags
    const canonical = CANONICAL_TAG_MAP.get(clean.toLowerCase()) || clean;
    CANONICAL_TAG_MAP.set(clean.toLowerCase(), canonical);

    const lower = canonical.toLowerCase();
    parsedTagsSet.add(lower);

    if (rawLower.startsWith('project/') || axisHint === 'project') {
      explicitlyMarkedProjectTags.add(lower);
    }
    if (rawLower.startsWith('research/') || KNOWN_RESEARCH_IDS.has(lower)) {
      explicitlyMarkedResearchTags.add(lower);
    }

    const effectiveAxisId = prefixAxis || axisHint;
    let targetAxis: TaxonomyAxisDefinition | undefined;

    if (effectiveAxisId) {
      targetAxis = axes.find(a => a.id === effectiveAxisId);
    }
    if (!targetAxis) {
      // Check if already belongs to a default axis
      targetAxis = DEFAULT_TAG_TAXONOMY.find(a => a.tags.some(t => t.toLowerCase() === lower))
        ? axes.find(
            a =>
              a.id ===
              DEFAULT_TAG_TAXONOMY.find(da => da.tags.some(t => t.toLowerCase() === lower))!.id
          )
        : axes.find(a => a.id === 'system') || axes.find(a => a.id === 'root');
    }

    if (targetAxis && !targetAxis.tags.some(t => t.toLowerCase() === lower)) {
      targetAxis.tags.push(canonical);
    }

    // If this is a project or research tag, ensure a ProjectTagProfile exists
    if (
      explicitlyMarkedProjectTags.has(lower) ||
      explicitlyMarkedResearchTags.has(lower) ||
      profilesMap.has(lower)
    ) {
      const isRes = explicitlyMarkedResearchTags.has(lower) || KNOWN_RESEARCH_IDS.has(lower);
      const defaultFolder = isRes ? `03_Knowledge/Research/${canonical}` : `${projectsRoot}/${canonical}`;
      if (!profilesMap.has(lower)) {
        profilesMap.set(lower, {
          id: canonical,
          projectTag: canonical,
          targetFolder: tagRoutes[canonical] || defaultFolder,
          associatedTags: [canonical],
          aliases: Array.from(new Set([canonical, canonical.replace(/[-_]+/g, ' ')]))
        });
      }
      if (!tagRoutes[canonical]) {
        tagRoutes[canonical] = profilesMap.get(lower)!.targetFolder;
      }
      touchedProjects.add(lower);
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
              for (const t of ax.tags) registerTagInAxes(String(t), ax.id ? String(ax.id) : undefined);
            }
          }
        }
        if (Array.isArray(parsed.projectProfiles)) {
          for (const prof of parsed.projectProfiles) {
            if (!prof || !prof.projectTag) continue;
            const pTag =
              registerTagInAxes(String(prof.projectTag), 'project') ||
              normalizeToCanonicalTag(String(prof.projectTag));
            const assoc: string[] = [pTag];
            if (Array.isArray(prof.associatedTags)) {
              for (const at of prof.associatedTags) {
                const reg = registerTagInAxes(String(at));
                if (reg && !assoc.some(x => x.toLowerCase() === reg.toLowerCase())) assoc.push(reg);
              }
            }
            const id = String(prof.id || pTag);
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
              const reg = registerTagInAxes(k) || normalizeToCanonicalTag(k);
              if (reg) tagRoutes[reg] = v.trim();
            }
          }
        }
        // Also support simple project dictionary: { "Hermes": ["#Hermes", "#memory"] }
        if (!parsed.axes && !parsed.projectProfiles) {
          for (const [key, val] of Object.entries(parsed)) {
            if (Array.isArray(val)) {
              const pTag = normalizeToCanonicalTag(key.trim().replace(/\s+/g, '-'));
              const regPTag = registerTagInAxes(pTag, 'project') || pTag;
              const assoc: string[] = [regPTag];
              for (const item of val) {
                const reg = registerTagInAxes(String(item));
                if (reg && !assoc.some(x => x.toLowerCase() === reg.toLowerCase())) assoc.push(reg);
              }
              const id = regPTag || key;
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

  // 2. Markdown / Text / YAML Parser
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

  // Step 2b: Parse explicit route lines like `#Hermes -> 01_Projects/Hermes` or `#project/Hermes -> 01_Projects/Hermes`
  for (const line of expandedLines) {
    const routeMatch = line.match(
      /^\s*(?:[-*]\s*)?#([\p{L}\p{N}_/×²+-]+)\s*(?:->|=>|→)\s*([0-9A-Za-z\u0400-\u04FF_/-]+)\s*$/u
    );
    if (routeMatch) {
      const tag = registerTagInAxes(routeMatch[1]) || normalizeToCanonicalTag(routeMatch[1]);
      const folder = routeMatch[2].trim().replace(/^\/+|\/+$/g, '');
      if (tag && folder) {
        tagRoutes[tag] = folder;
        const prof = profilesMap.get(tag.toLowerCase());
        if (prof) prof.targetFolder = folder;
      }
    }
  }

  // Step 2c: Helper to extract all tags from a text block
  const extractTagsFromBlock = (blockText: string, axisHint?: string): string[] => {
    const found: string[] = [];
    const seen = new Set<string>();

    // Match `#tag` (not followed by space, i.e. not Markdown headings)
    const hashMatches = blockText.match(/(?:^|[\s,([`])#([\p{L}\p{N}_/×²+-]+)/gu) || [];
    for (const m of hashMatches) {
      const raw = m.replace(/^[^#]*#+/, '').replace(/\/+$/, '');
      const reg = registerTagInAxes(raw, axisHint);
      if (reg && !seen.has(reg.toLowerCase())) {
        seen.add(reg.toLowerCase());
        found.push(reg);
      }
    }

    // Also match un-hashed legacy YAML/list tags with prefixes
    const prefixMatches =
      blockText.match(
        /(?:^|[\s,([`-])((?:type|domain|project|research|system|concept|status|priority|stage|knowledge|relation)\/[\p{L}\p{N}_/×²+-]+)/gu
      ) || [];
    for (const pm of prefixMatches) {
      const raw = pm.trim().replace(/^[-*,\s([`]+/, '').replace(/\/+$/, '');
      const reg = registerTagInAxes(raw, axisHint);
      if (reg && !seen.has(reg.toLowerCase())) {
        seen.add(reg.toLowerCase());
        found.push(reg);
      }
    }

    return found;
  };

  // Step 2d: Parse Markdown heading sections first so section axis hints (L0..L7) are applied
  const headingSections = normalizedMarkdown.split(/(?=^#{1,4}\s+[^\n]+)/m);
  for (const section of headingSections) {
    const headerMatch = section.match(/^#{1,4}\s+([^\n]+)/);
    const headingText = headerMatch ? headerMatch[1].trim() : undefined;
    const axisHint = inferAxisIdFromHeading(headingText);
    extractTagsFromBlock(section, axisHint);
  }

  // Associate tags with Project Profiles across logical blocks (fenced code blocks & heading sections)
  const associateBlockWithProject = (
    blockTags: string[],
    headingHint?: string,
    folderHint?: string,
    aliasesHint?: string[]
  ) => {
    if (blockTags.length === 0) return;
    const projectTagsInBlock = blockTags.filter(
      t => explicitlyMarkedProjectTags.has(t.toLowerCase()) || profilesMap.has(t.toLowerCase())
    );
    const researchTagsInBlock = blockTags.filter(t => explicitlyMarkedResearchTags.has(t.toLowerCase()));

    let targetPrimaryTag: string | null = null;
    if (projectTagsInBlock.length === 1) {
      targetPrimaryTag = projectTagsInBlock[0];
    } else if (projectTagsInBlock.length === 0 && researchTagsInBlock.length === 1 && blockTags.length > 1) {
      targetPrimaryTag = researchTagsInBlock[0];
    } else if (headingHint) {
      const cleanHeading = headingHint
        .replace(/^[0-9.)\s#-]+/, '')
        .replace(/\b(project|\u043f\u0440\u043e\u0435\u043a\u0442|\u0441\u0438\u0441\u0442\u0435\u043c\u0430|system|\u043d\u0430\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u0435|direction|\u043d\u0430\u043f\u0440\u0438\u043c\u0435\u0440)\b[:\s-]*/gi, '')
        .split(/[—–:(]/)[0]
        .trim();
      const genericHeadingRegex =
        /^(?:l[0-7]|axis|type|domain|project|projects|research|system|status|priority|stage|knowledge|relation|ai|computing|society|economy|creative|personal|operations|\u0438\u0442\u043e\u0433\u043e\u0432\u0430\u044f|\u043c\u043e\u0434\u0435\u043b\u044c|\u043e\u0442\u0434\u0435\u043b\u044c\u043d\u0430\u044f|\u043e\u0441\u044c|\u043f\u0440\u0438\u043c\u0435\u0440\u043e\u0432?|\u043f\u0440\u0438\u043c\u0435\u0440\u044b|tags|hashtags|\u0442\u0435\u0433\u0438|orthogonal|tag-to-directory)/i;
      if (cleanHeading && cleanHeading.length >= 2 && cleanHeading.length <= 35 && !genericHeadingRegex.test(cleanHeading)) {
        const slug = cleanHeading.replace(/\s+/g, '-');
        const existingProf =
          profilesMap.get(slug.toLowerCase()) ||
          Array.from(profilesMap.values()).find(
            p =>
              p.id.toLowerCase() === cleanHeading.toLowerCase() ||
              p.aliases.some(a => a.toLowerCase() === cleanHeading.toLowerCase())
          );
        if (existingProf) {
          targetPrimaryTag = existingProf.projectTag;
        } else if (folderHint) {
          const reg = registerTagInAxes(slug, 'project') || slug;
          targetPrimaryTag = reg;
        }
      }
    }

    if (!targetPrimaryTag) return;

    const key = targetPrimaryTag.toLowerCase();
    const existing = profilesMap.get(key);
    const id = existing?.id || targetPrimaryTag;
    const isRes = explicitlyMarkedResearchTags.has(key) || KNOWN_RESEARCH_IDS.has(key);
    const defaultFolder = isRes ? `03_Knowledge/Research/${id}` : `${projectsRoot}/${id}`;

    const mergedAssoc = new Set<string>(existing ? existing.associatedTags : [targetPrimaryTag]);
    for (const bt of blockTags) {
      if (explicitlyMarkedProjectTags.has(bt.toLowerCase()) && bt.toLowerCase() !== key) continue;
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
      id,
      projectTag: existing?.projectTag || targetPrimaryTag,
      targetFolder: finalFolder,
      associatedTags: Array.from(mergedAssoc),
      aliases: Array.from(mergedAliases),
      description: existing?.description
    });
    tagRoutes[existing?.projectTag || targetPrimaryTag] = finalFolder;
    touchedProjects.add(key);
  };

  // 1) Inspect fenced code blocks (```...```)
  const codeBlockRegex = /(?:([^\n`]{2,80})\n+)?```[^\n]*\n([\s\S]*?)```/g;
  let cbMatch: RegExpExecArray | null;
  while ((cbMatch = codeBlockRegex.exec(normalizedMarkdown)) !== null) {
    const precedingLine = (cbMatch[1] || '').trim().replace(/^#+\s*/, '').replace(/:$/, '');
    const blockContent = cbMatch[2] || '';
    const blockTags = extractTagsFromBlock(blockContent);
    associateBlockWithProject(blockTags, precedingLine);
  }

  // 2) Inspect Markdown heading sections (`# ...`, `## ...`, `### ...`)
  for (const section of headingSections) {
    const headerMatch = section.match(/^#{1,4}\s+([^\n]+)/);
    if (!headerMatch) continue;
    const headingText = headerMatch[1].trim();
    const axisHint = inferAxisIdFromHeading(headingText);
    if (axisHint) continue; // Do not treat axis headings (L0..L7) as single project sections

    const folderMatch = section.match(/(?:folder|directory|path|\u043f\u0430\u043f\u043a\u0430|\u0434\u0438\u0440\u0435\u043a\u0442\u043e\u0440\u0438\u044f)\s*:\s*`?([0-9A-Za-z\u0400-\u04FF_/-]+)`?/i);
    const aliasesMatch = section.match(/(?:aliases|\u0430\u043b\u0438\u0430\u0441\u044b|\u043a\u043b\u044e\u0447\u0435\u0432\u044b\u0435 \u0441\u043b\u043e\u0432\u0430|keywords)\s*:\s*([^\n]+)/i);
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
 * with 100% clean, slash-free hashtags (`#Hermes`, `#agent-orchestration`, `#World-1149`) and lossless re-import.
 */
export function exportTagTaxonomyToMarkdown(config?: Partial<VaultTagTaxonomyConfig>): string {
  const axes = config?.axes || DEFAULT_TAG_TAXONOMY;
  const projectProfiles = config?.projectProfiles || DEFAULT_PROJECT_TAG_PROFILES;
  const tagRoutes = config?.tagRoutes || DEFAULT_TAG_ROUTES;
  const lines: string[] = [
    '# Orthogonal Tag Taxonomy & Project Hashtags (L0–L7)',
    '',
    `> Updated: ${config?.updatedAt || new Date().toISOString()}`,
    '> Clean atomic hashtags (no slash prefixes) — compatible with Obsidian Local LLM Pipeline.',
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
      const clean = normalizeToCanonicalTag(t) || t.replace(/^#+/, '');
      lines.push(`#${clean}`);
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
    const uniqueTags = Array.from(
      new Set([prof.projectTag, ...prof.associatedTags].map(t => normalizeToCanonicalTag(t) || t.replace(/^#+/, '')))
    );
    for (const t of uniqueTags) {
      lines.push(`#${t}`);
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
    const clean = normalizeToCanonicalTag(tag) || tag.replace(/^#+/, '');
    lines.push(`#${clean} -> ${folder}`);
  }
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

/**
 * Extracts tags from note frontmatter, body, and filename.
 * Automatically normalizes any legacy slash-prefixed tags (`#system/semantic-ingestion` -> `semantic-ingestion`)
 * into clean, atomic tags and strips out non-word garbage codes (`#01G23`).
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

  // 2. Inline #tags in body and filename (automatically strips legacy slash prefixes)
  const bodyWithoutCode = (body || '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
  const textToScan = `${filename}\n${bodyWithoutCode}`;
  const inlineMatches = textToScan.match(/(?:^|\s)#([\p{L}\p{N}_/×²+-]+)/gu) || [];
  for (const m of inlineMatches) {
    const clean = m.trim().replace(/^#+/, '').replace(/\/+$/, '');
    addClean(clean);
  }

  return Array.from(tagsSet);
}
