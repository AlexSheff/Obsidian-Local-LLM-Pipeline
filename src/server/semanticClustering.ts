import {
  ProjectTagProfile,
  TaxonomyAxisDefinition,
  DEFAULT_PROJECT_TAG_PROFILES,
  DEFAULT_TAG_TAXONOMY,
  DEFAULT_TAG_ROUTES,
  curateOrthogonalTags,
  inferProjectFromNoteAndTaxonomy,
  resolveDirectoryFromTags,
  normalizeToCanonicalTag,
  stripTagPrefix
} from './tags';

export interface ClusterableNoteInput {
  path: string;
  filename: string;
  title: string;
  body: string;
  folder: string;
  tags: string[];
}

export interface ClusteredNoteMember {
  path: string;
  filename: string;
  title: string;
  currentFolder: string;
  recommendedFolder: string;
  snippet: string;
  currentTags: string[];
  suggestedTags: string[];
  matchedConcepts: string[];
  similarityToCluster: number; // 0..100
  needsRouting: boolean;
  needsTagUpdate: boolean;
}

export interface SemanticNoteLink {
  sourcePath: string;
  sourceTitle: string;
  targetPath: string;
  targetTitle: string;
  similarity: number; // 0..100
  sharedConcepts: string[];
}

export interface SemanticKnowledgeCluster {
  id: string;
  label: string;
  summary: string;
  dominantProject: string | null;
  dominantDomain: string | null;
  recommendedFolder: string;
  coreTags: string[];
  keyConcepts: string[];
  cohesionScore: number; // 0..100
  misplacedCount: number;
  notes: ClusteredNoteMember[];
}

export interface VaultSemanticClusteringResult {
  clusters: SemanticKnowledgeCluster[];
  semanticBridges: SemanticNoteLink[];
  totalNotes: number;
  totalClusters: number;
  misplacedNotesCount: number;
}

const STOP_WORDS = new Set([
  // English stop words
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'was', 'were', 'have', 'has', 'had',
  'not', 'but', 'what', 'all', 'when', 'can', 'there', 'use', 'each', 'which', 'their', 'how', 'will',
  'about', 'into', 'than', 'them', 'then', 'some', 'these', 'would', 'other', 'more', 'two', 'like',
  'see', 'time', 'could', 'make', 'only', 'also', 'new', 'very', 'after', 'our', 'just', 'where',
  'most', 'know', 'get', 'through', 'back', 'much', 'good', 'way', 'well', 'should', 'because', 'any',
  'every', 'between', 'both', 'under', 'while', 'such', 'here', 'take', 'why', 'things', 'over',
  'note', 'notes', 'file', 'files', 'document', 'documents', 'untitled', 'draft', 'copy', 'version',
  // Russian stop words
  'и', 'в', 'во', 'не', 'что', 'он', 'на', 'я', 'с', 'со', 'как', 'а', 'то', 'все', 'она', 'так',
  'его', 'но', 'да', 'ты', 'к', 'у', 'же', 'вы', 'за', 'бы', 'по', 'только', 'ее', 'мне', 'было',
  'вот', 'от', 'меня', 'еще', 'нет', 'о', 'из', 'ему', 'теперь', 'когда', 'даже', 'ну', 'вдруг',
  'ли', 'если', 'уже', 'или', 'ни', 'быть', 'был', 'него', 'до', 'вас', 'нибудь', 'опять', 'уж',
  'вам', 'ведь', 'там', 'потом', 'себя', 'ничего', 'ей', 'может', 'они', 'тут', 'где', 'есть',
  'надо', 'ней', 'для', 'мы', 'тебя', 'их', 'чем', 'была', 'сам', 'чтоб', 'без', 'будто', 'чего',
  'раз', 'тоже', 'себе', 'под', 'будет', 'ж', 'тогда', 'кто', 'этот', 'того', 'потому', 'этого',
  'какой', 'совсем', 'ним', 'здесь', 'этом', 'один', 'почти', 'мой', 'тем', 'чтобы', 'нее', 'сейчас',
  'были', 'куда', 'зачем', 'всех', 'никогда', 'можно', 'при', 'наконец', 'два', 'об', 'другой',
  'хоть', 'после', 'над', 'больше', 'тот', 'через', 'эти', 'нас', 'про', 'всего', 'них', 'какая',
  'много', 'разве', 'три', 'эту', 'моя', 'впрочем', 'хорошо', 'свою', 'этой', 'перед', 'иногда',
  'лучше', 'чуть', 'том', 'нельзя', 'такой', 'им', 'более', 'всегда', 'конечно', 'всю', 'между',
  'это', 'как', 'также', 'либо', 'заметка', 'заметки', 'файл', 'документ', 'черновик', 'часть'
]);

/**
 * Bilingual RU/EN semantic concept synonym & stem normalizer so documents written in Russian,
 * English, or mixed terminology map onto the exact same semantic concept dimensions.
 */
const BILINGUAL_CONCEPT_STEMS: Array<{ pattern: RegExp; concept: string }> = [
  { pattern: /^(?:агент\w*|мультиагент\w*|agent\w*|multi-?agent\w*)$/i, concept: 'concept:agents' },
  { pattern: /^(?:оркестрац\w*|orchestrat\w*)$/i, concept: 'concept:agent-orchestration' },
  { pattern: /^(?:гермес\w*|hermes)$/i, concept: 'concept:Hermes' },
  { pattern: /^(?:нейромикон\w*|neuromicon)$/i, concept: 'concept:Neuromicon' },
  { pattern: /^(?:дефрагментац\w*|defragment\w*)$/i, concept: 'concept:Defragmentation' },
  { pattern: /^(?:1149|world-?1149)$/i, concept: 'concept:World-1149' },
  { pattern: /^(?:uucpff|кинофестивал\w*|фестивал\w*)$/i, concept: 'concept:UUCPFF' },
  { pattern: /^(?:гиперграф\w*|hypergraph\w*)$/i, concept: 'concept:hypergraph' },
  { pattern: /^(?:квантован\w*|quantiz\w*)$/i, concept: 'concept:semantic-quantization' },
  { pattern: /^(?:семанти\w*|semantic\w*)$/i, concept: 'concept:semantics' },
  { pattern: /^(?:онтолог\w*|ontolog\w*|таксоном\w*|taxonom\w*)$/i, concept: 'concept:ontology' },
  { pattern: /^(?:маршрутизац\w*|роутинг\w*|роутер\w*|rout(?:e|er|ing|ed))$/i, concept: 'concept:routing' },
  { pattern: /^(?:классификац\w*|триаж\w*|classif\w*|triage)$/i, concept: 'concept:classification' },
  { pattern: /^(?:тегирован\w*|тег\w*|хэштег\w*|tag(?:ging|s|ged)?|hashtag\w*)$/i, concept: 'concept:tagging' },
  { pattern: /^(?:память|памяти|memory|episodic|semantic-memory)$/i, concept: 'concept:memory' },
  { pattern: /^(?:трансромедиа|трансмедиа\w*|transmedia|arg)$/i, concept: 'concept:transmedia' },
  { pattern: /^(?:сценари\w*|screenplay\w*|драматург\w*|storytelling)$/i, concept: 'concept:scenario' },
  { pattern: /^(?:фильм\w*|кино\w*|film\w*|cinema)$/i, concept: 'concept:film' },
  { pattern: /^(?:экономик\w*|econom\w*|монетизац\w*|рынок|рынк\w*)$/i, concept: 'concept:economy' },
  { pattern: /^(?:философ\w*|сознани\w*|philosoph\w*|consciousness)$/i, concept: 'concept:philosophy' },
  { pattern: /^(?:безопасност\w*|шифрован\w*|криптограф\w*|cybersecurity|cryptograph\w*)$/i, concept: 'concept:cybersecurity' },
  { pattern: /^(?:протокол\w*|protocol\w*|спецификац\w*|specification\w*)$/i, concept: 'concept:protocol' },
  { pattern: /^(?:исследован\w*|гипотез\w*|research\w*|hypothes\w*)$/i, concept: 'concept:research' },
  { pattern: /^(?:языков\w*|модел\w*|llm\w*|llama\w*|qwen\w*|gguf)$/i, concept: 'concept:LLM' },
  { pattern: /^(?:обсидиан\w*|obsidian|vault|хранилищ\w*)$/i, concept: 'concept:knowledge-management' }
];

function stemWord(word: string): string {
  const w = word.toLowerCase().trim();
  for (const rule of BILINGUAL_CONCEPT_STEMS) {
    if (rule.pattern.test(w)) return rule.concept;
  }
  // Light Russian suffix stripping
  if (/^[а-яё]{5,}$/i.test(w)) {
    return w
      .replace(/(?:остями|остях|остей|остью|ости|ость|ением|ениям|ениях|ений|ение|ения|анием|ания|ание|ами|ями|ого|его|ому|ему|ыми|ими|ая|яя|ое|ее|ые|ие|ый|ий|ой|ам|ям|ах|ях|ов|ев|ей|ью|ии|ия|ие)$/i, '')
      .slice(0, 12);
  }
  // Light English suffix stripping
  if (/^[a-z]{5,}$/i.test(w)) {
    return w
      .replace(/(?:ization|ational|fulness|ousness|iveness|ements|ations|ingly|edly|ments|ness|able|ible|tion|sion|ance|ence|ship|ings|ally|ing|ies|ers|ion|ent|ant|ive|ous|ful|est|ism|ist|ed|ly|es|s)$/i, '')
      .slice(0, 12);
  }
  return w;
}

function extractBodyCleanSnippet(body: string, maxLen = 180): string {
  const cleaned = (body || '')
    .replace(/^---[\s\S]*?---\r?\n/, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#+\s+[^\n]+/gm, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~`>#-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen).trim() + '…';
}

function extractMarkdownHeadingsAndBold(body: string): string {
  const headings = (body.match(/^#{1,4}\s+([^\r\n]+)/gm) || []).map(h => h.replace(/^#{1,4}\s+/, ''));
  const bolds = (body.match(/\*\*([^*]{2,50})\*\*/g) || []).map(b => b.replace(/\*\*/g, ''));
  return [...headings, ...bolds].join(' ');
}

function tokenizeAndNormalize(text: string): { stems: string[]; rawTerms: Map<string, string> } {
  const cleaned = text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[`*_~>|[\](){}<>:;,.!?"'/\\+=]+/g, ' ');
  const rawTokens = cleaned.match(/[\p{L}\p{N}-]{3,}/gu) || [];
  const stems: string[] = [];
  const rawTerms = new Map<string, string>();

  for (const tok of rawTokens) {
    const lower = tok.toLowerCase().replace(/^-+|-+$/g, '');
    if (lower.length < 3 || /^\d+$/.test(lower)) continue;
    if (STOP_WORDS.has(lower)) continue;
    const stem = stemWord(lower);
    if (stem.length < 3) continue;
    stems.push(stem);
    if (!rawTerms.has(stem)) {
      rawTerms.set(stem, stem.startsWith('concept:') ? stem.slice('concept:'.length) : lower);
    }
  }

  // Also add meaningful bigrams of consecutive concepts/stems
  const bigrams: string[] = [];
  for (let i = 0; i < Math.min(stems.length - 1, 250); i++) {
    if (stems[i] !== stems[i + 1]) {
      const bg = `${stems[i]}_${stems[i + 1]}`;
      bigrams.push(bg);
    }
  }

  return { stems: [...stems, ...bigrams], rawTerms };
}

function cosineSimilarity(vecA: Map<string, number>, vecB: Map<string, number>): number {
  if (vecA.size === 0 || vecB.size === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [, val] of vecA) normA += val * val;
  for (const [, val] of vecB) normB += val * val;
  if (normA === 0 || normB === 0) return 0;

  const [smaller, larger] = vecA.size <= vecB.size ? [vecA, vecB] : [vecB, vecA];
  for (const [k, valA] of smaller) {
    const valB = larger.get(k);
    if (valB !== undefined) {
      dot += valA * valB;
    }
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Performs deep, full-meaning semantic clustering of vault documents using:
 * 1) Full-body TF-IDF + bilingual RU/EN concept stem normalization + bigrams
 * 2) Structural emphasis (Markdown headings, bold keyphrases)
 * 3) Orthogonal Taxonomy & Project Tag Profile semantic anchors
 * 4) Pairwise Cosine Similarity + Hybrid Medoid/Agglomerative Community Clustering
 */
export function buildSemanticKnowledgeClusters(params: {
  notes: ClusterableNoteInput[];
  projectProfiles?: ProjectTagProfile[];
  discoveredProjects?: Array<{ id: string; folder: string; aliases: string[] }>;
  axes?: TaxonomyAxisDefinition[];
  tagRoutes?: Record<string, string>;
  projectsRoot?: string;
}): VaultSemanticClusteringResult {
  const {
    notes,
    projectProfiles = DEFAULT_PROJECT_TAG_PROFILES,
    discoveredProjects = [],
    axes = DEFAULT_TAG_TAXONOMY,
    tagRoutes = DEFAULT_TAG_ROUTES,
    projectsRoot = '01_Projects'
  } = params;

  if (!notes || notes.length === 0) {
    return {
      clusters: [],
      semanticBridges: [],
      totalNotes: 0,
      totalClusters: 0,
      misplacedNotesCount: 0
    };
  }

  interface EnrichedNote {
    input: ClusterableNoteInput;
    cleanCurrentTags: string[];
    inferredTags: string[];
    matchedProject: string | null;
    matchedDomain: string | null;
    recommendedFolder: string;
    tfMap: Map<string, number>;
    tfidfVector: Map<string, number>;
    readableConceptMap: Map<string, string>;
    topConcepts: string[];
  }

  const domainTagSet = new Set(
    (axes.find(a => a.id === 'domain')?.tags || DEFAULT_TAG_TAXONOMY.find(a => a.id === 'domain')?.tags || []).map(t =>
      t.toLowerCase()
    )
  );

  const dfMap = new Map<string, number>();
  const enrichedNotes: EnrichedNote[] = [];

  for (const note of notes) {
    const cleanCurrentTags = Array.from(
      new Set(
        (note.tags || [])
          .map(t => normalizeToCanonicalTag(String(t)))
          .filter(t => Boolean(t) && !t.includes('/'))
      )
    );

    // 1. Infer Project & Orthogonal Tags from the FULL document body (not just title!)
    const projInf = inferProjectFromNoteAndTaxonomy({
      filename: note.filename,
      title: note.title,
      body: note.body,
      existingTags: cleanCurrentTags,
      folder: note.folder,
      discoveredProjects,
      projectProfiles,
      projectsRoot
    });

    const curatedTags = curateOrthogonalTags({
      rawTags: cleanCurrentTags,
      title: note.title,
      filename: note.filename,
      body: note.body,
      folder: note.folder,
      discoveredProjects,
      projectProfiles,
      customAxes: axes,
      replaceExisting: false,
      maxTags: 8
    });

    const routeDecision = resolveDirectoryFromTags({
      tags: curatedTags,
      projectProfiles,
      discoveredProjects,
      tagRoutes,
      projectsRoot,
      fallbackFolder: note.folder && note.folder !== '00_Inbox' ? note.folder : '03_Knowledge/Essays'
    });

    const matchedProject = projInf.matchedProfile?.id || routeDecision.matchedProjectId || null;
    const matchedDomain = curatedTags.find(t => domainTagSet.has(t.toLowerCase())) || null;

    // 2. Build Multi-Zone Term Frequency from Full Body + Headings + Semantic Tags
    // Notice we weight body content heavily so two files with totally different titles cluster by full meaning
    const bodyText = note.body || '';
    const emphasisText = extractMarkdownHeadingsAndBold(bodyText);
    const bodyTokens = tokenizeAndNormalize(bodyText);
    const emphasisTokens = tokenizeAndNormalize(`${emphasisText} ${note.title}`);

    const tfMap = new Map<string, number>();
    const readableConceptMap = new Map<string, string>(bodyTokens.rawTerms);
    for (const [k, v] of emphasisTokens.rawTerms) {
      if (!readableConceptMap.has(k)) readableConceptMap.set(k, v);
    }

    for (const stem of bodyTokens.stems) {
      const weight = stem.startsWith('concept:') ? 2.5 : 1.0;
      tfMap.set(stem, (tfMap.get(stem) || 0) + weight);
    }
    for (const stem of emphasisTokens.stems) {
      const weight = stem.startsWith('concept:') ? 3.0 : 1.5;
      tfMap.set(stem, (tfMap.get(stem) || 0) + weight);
    }

    // Inject inferred semantic tags & project concepts as high-signal dimensions
    for (const tag of curatedTags) {
      const lower = tag.toLowerCase();
      if (lower === 'ru' || lower === 'en' || lower === 'ph' || lower === 'active' || lower === 'reference') continue;
      const dim = `tag:${lower}`;
      tfMap.set(dim, (tfMap.get(dim) || 0) + 4.0);
      readableConceptMap.set(dim, tag);
    }
    if (matchedProject) {
      const projDim = `project:${matchedProject.toLowerCase()}`;
      tfMap.set(projDim, (tfMap.get(projDim) || 0) + 6.5);
      readableConceptMap.set(projDim, matchedProject);
    }

    for (const term of tfMap.keys()) {
      dfMap.set(term, (dfMap.get(term) || 0) + 1);
    }

    enrichedNotes.push({
      input: note,
      cleanCurrentTags,
      inferredTags: curatedTags,
      matchedProject,
      matchedDomain,
      recommendedFolder: routeDecision.targetFolder,
      tfMap,
      tfidfVector: new Map(),
      readableConceptMap,
      topConcepts: []
    });
  }

  // 3. Compute sublinear TF-IDF vectors for every note
  const N = Math.max(1, enrichedNotes.length);
  for (const en of enrichedNotes) {
    const scoredTerms: Array<{ term: string; score: number; label: string }> = [];
    for (const [term, tf] of en.tfMap.entries()) {
      const df = dfMap.get(term) || 1;
      // Smooth IDF that still rewards shared concepts in small vaults
      const idf = Math.log(1 + (N + 1) / (df + 0.5)) + (term.startsWith('project:') || term.startsWith('concept:') ? 0.8 : 0);
      const weight = (1 + Math.log(tf)) * idf;
      en.tfidfVector.set(term, weight);
      if (!term.includes('_') && !term.startsWith('project:')) {
        const label = en.readableConceptMap.get(term) || term.replace(/^(?:concept|tag):/, '');
        if (label && label.length >= 3) {
          scoredTerms.push({ term, score: weight, label });
        }
      }
    }
    scoredTerms.sort((a, b) => b.score - a.score);
    const seenLabels = new Set<string>();
    for (const st of scoredTerms) {
      const cleanLabel = stripTagPrefix(st.label);
      if (!cleanLabel || seenLabels.has(cleanLabel.toLowerCase())) continue;
      seenLabels.add(cleanLabel.toLowerCase());
      en.topConcepts.push(cleanLabel);
      if (en.topConcepts.length >= 6) break;
    }
  }

  // 4. Compute pairwise semantic similarity matrix & discover semantic bridges
  const simMatrix: number[][] = Array.from({ length: N }, () => Array(N).fill(0));
  const semanticBridges: SemanticNoteLink[] = [];

  for (let i = 0; i < N; i++) {
    simMatrix[i][i] = 1;
    for (let j = i + 1; j < N; j++) {
      let sim = cosineSimilarity(enrichedNotes[i].tfidfVector, enrichedNotes[j].tfidfVector);
      // Boost if both notes deeply match the same project or share 2+ semantic non-generic tags
      if (
        enrichedNotes[i].matchedProject &&
        enrichedNotes[i].matchedProject === enrichedNotes[j].matchedProject
      ) {
        sim = Math.min(1, sim + 0.28);
      }
      const sharedTags = enrichedNotes[i].inferredTags.filter(
        t =>
          !['ru', 'en', 'ph', 'active', 'reference', 'project'].includes(t.toLowerCase()) &&
          enrichedNotes[j].inferredTags.some(t2 => t2.toLowerCase() === t.toLowerCase())
      );
      if (sharedTags.length >= 2) {
        sim = Math.min(1, sim + Math.min(0.22, sharedTags.length * 0.07));
      }

      simMatrix[i][j] = sim;
      simMatrix[j][i] = sim;

      if (sim >= 0.24) {
        const sharedConcepts = Array.from(
          new Set([
            ...sharedTags,
            ...enrichedNotes[i].topConcepts.filter(c =>
              enrichedNotes[j].topConcepts.some(c2 => c2.toLowerCase() === c.toLowerCase())
            )
          ])
        ).slice(0, 5);
        semanticBridges.push({
          sourcePath: enrichedNotes[i].input.path,
          sourceTitle: enrichedNotes[i].input.title || enrichedNotes[i].input.filename,
          targetPath: enrichedNotes[j].input.path,
          targetTitle: enrichedNotes[j].input.title || enrichedNotes[j].input.filename,
          similarity: Math.round(sim * 100),
          sharedConcepts
        });
      }
    }
  }

  semanticBridges.sort((a, b) => b.similarity - a.similarity);

  // 5. Hybrid Agglomerative + Anchor Clustering
  // Start each note in its own cluster, then iteratively merge clusters whose average similarity >= threshold
  let rawClusters: number[][] = enrichedNotes.map((_, idx) => [idx]);

  const clusterSimilarity = (cA: number[], cB: number[]): number => {
    let total = 0;
    for (const i of cA) {
      for (const j of cB) {
        total += simMatrix[i][j];
      }
    }
    return total / (cA.length * cB.length);
  };

  // First pass: merge notes that share the same explicit/inferred Project Profile
  const byProject = new Map<string, number[]>();
  const unprojectedIndices: number[] = [];
  for (let i = 0; i < N; i++) {
    const proj = enrichedNotes[i].matchedProject;
    if (proj) {
      if (!byProject.has(proj)) byProject.set(proj, []);
      byProject.get(proj)!.push(i);
    } else {
      unprojectedIndices.push(i);
    }
  }

  rawClusters = [
    ...Array.from(byProject.values()),
    ...unprojectedIndices.map(idx => [idx])
  ];

  // Second pass: Agglomerative clustering by full-content cosine similarity (threshold = 0.22)
  const MERGE_THRESHOLD = 0.22;
  let merged = true;
  while (merged && rawClusters.length > 1) {
    merged = false;
    let bestSim = MERGE_THRESHOLD;
    let bestPair: [number, number] | null = null;

    for (let a = 0; a < rawClusters.length; a++) {
      for (let b = a + 1; b < rawClusters.length; b++) {
        // Avoid merging two different explicit projects together
        const projA = enrichedNotes[rawClusters[a][0]].matchedProject;
        const projB = enrichedNotes[rawClusters[b][0]].matchedProject;
        if (projA && projB && projA !== projB) continue;

        const sim = clusterSimilarity(rawClusters[a], rawClusters[b]);
        if (sim > bestSim) {
          bestSim = sim;
          bestPair = [a, b];
        }
      }
    }

    if (bestPair) {
      const [a, b] = bestPair;
      rawClusters[a] = [...rawClusters[a], ...rawClusters[b]];
      rawClusters.splice(b, 1);
      merged = true;
    }
  }

  // Third pass: Attach remaining singletons to their closest semantic cluster if similarity >= 0.14 or same primary domain
  if (rawClusters.length > 1) {
    const multiClusters = rawClusters.filter(c => c.length >= 2);
    const singletons = rawClusters.filter(c => c.length === 1);
    if (multiClusters.length > 0 && singletons.length > 0) {
      const remainingSingletons: number[][] = [];
      for (const s of singletons) {
        const idx = s[0];
        const note = enrichedNotes[idx];
        let bestTarget = -1;
        let bestScore = 0.14;
        for (let m = 0; m < multiClusters.length; m++) {
          const sim = clusterSimilarity(s, multiClusters[m]);
          const targetDomain = enrichedNotes[multiClusters[m][0]].matchedDomain;
          const domainBonus = note.matchedDomain && note.matchedDomain === targetDomain ? 0.08 : 0;
          if (sim + domainBonus > bestScore) {
            bestScore = sim + domainBonus;
            bestTarget = m;
          }
        }
        if (bestTarget >= 0) {
          multiClusters[bestTarget].push(idx);
        } else {
          remainingSingletons.push(s);
        }
      }
      rawClusters = [...multiClusters, ...remainingSingletons];
    }
  }

  // Group any remaining singletons that share the same domain/folder so the UI stays clean
  if (rawClusters.filter(c => c.length === 1).length > 2) {
    const multi = rawClusters.filter(c => c.length >= 2);
    const singles = rawClusters.filter(c => c.length === 1).map(c => c[0]);
    const byDomain = new Map<string, number[]>();
    for (const idx of singles) {
      const key = enrichedNotes[idx].matchedDomain || enrichedNotes[idx].recommendedFolder || 'general';
      if (!byDomain.has(key)) byDomain.set(key, []);
      byDomain.get(key)!.push(idx);
    }
    rawClusters = [...multi, ...Array.from(byDomain.values())];
  }

  // 6. Format SemanticKnowledgeCluster objects
  let totalMisplaced = 0;
  const formattedClusters: SemanticKnowledgeCluster[] = rawClusters.map((memberIndices, cIdx) => {
    const members = memberIndices.map(i => enrichedNotes[i]);

    // Determine dominant project, domain, coreTags, keyConcepts, and recommendedFolder
    const projectCounts = new Map<string, number>();
    const domainCounts = new Map<string, number>();
    const folderCounts = new Map<string, number>();
    const tagCounts = new Map<string, { tag: string; count: number }>();
    const conceptCounts = new Map<string, { concept: string; count: number }>();

    for (const m of members) {
      if (m.matchedProject) {
        projectCounts.set(m.matchedProject, (projectCounts.get(m.matchedProject) || 0) + 1);
      }
      if (m.matchedDomain) {
        domainCounts.set(m.matchedDomain, (domainCounts.get(m.matchedDomain) || 0) + 1);
      }
      if (m.recommendedFolder) {
        folderCounts.set(m.recommendedFolder, (folderCounts.get(m.recommendedFolder) || 0) + 1);
      }
      for (const t of m.inferredTags) {
        const low = t.toLowerCase();
        if (low === 'ru' || low === 'en' || low === 'ph') continue;
        const prev = tagCounts.get(low);
        tagCounts.set(low, { tag: prev?.tag || t, count: (prev?.count || 0) + 1 });
      }
      for (const c of m.topConcepts) {
        const low = c.toLowerCase();
        const prev = conceptCounts.get(low);
        conceptCounts.set(low, { concept: prev?.concept || c, count: (prev?.count || 0) + 1 });
      }
    }

    const dominantProject =
      Array.from(projectCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const dominantDomain =
      Array.from(domainCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const recommendedFolder =
      Array.from(folderCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || '03_Knowledge/Essays';

    const coreTags = Array.from(tagCounts.values())
      .sort((a, b) => b.count - a.count)
      .map(x => x.tag)
      .slice(0, 6);

    const keyConcepts = Array.from(conceptCounts.values())
      .sort((a, b) => b.count - a.count)
      .map(x => x.concept)
      .filter(c => !coreTags.some(t => t.toLowerCase() === c.toLowerCase()))
      .slice(0, 6);

    // Compute average intra-cluster cohesion
    let pairSum = 0;
    let pairCount = 0;
    for (let i = 0; i < memberIndices.length; i++) {
      for (let j = i + 1; j < memberIndices.length; j++) {
        pairSum += simMatrix[memberIndices[i]][memberIndices[j]];
        pairCount++;
      }
    }
    const rawCohesion = pairCount > 0 ? pairSum / pairCount : 0.78;
    const cohesionScore = Math.min(99, Math.max(52, Math.round((0.45 + rawCohesion * 0.55) * 100)));

    // Build human-friendly cluster label & summary
    let label = '';
    if (dominantProject) {
      const subConcepts = coreTags
        .filter(t => t.toLowerCase() !== dominantProject.toLowerCase() && t.toLowerCase() !== 'project' && t.toLowerCase() !== 'active')
        .slice(0, 2);
      label =
        subConcepts.length > 0
          ? `${dominantProject}: ${subConcepts.join(' & ')}`
          : `${dominantProject} Knowledge Cluster`;
    } else if (dominantDomain) {
      const secondary = coreTags.filter(t => t.toLowerCase() !== dominantDomain.toLowerCase()).slice(0, 2);
      label =
        secondary.length > 0
          ? `${dominantDomain} — ${secondary.join(' & ')}`
          : `${dominantDomain} Knowledge Cluster`;
    } else if (coreTags.length > 0) {
      label = coreTags.slice(0, 3).join(' · ');
    } else {
      label = `Semantic Cluster #${cIdx + 1}`;
    }

    const summary = dominantProject
      ? `Documents semantically centered on #${dominantProject} (${coreTags.map(t => `#${t}`).join(', ')}). Target directory: ${recommendedFolder}.`
      : `Documents sharing deep semantic concepts (${[...coreTags.slice(0, 3).map(t => `#${t}`), ...keyConcepts.slice(0, 2)].join(', ')}). Recommended directory: ${recommendedFolder}.`;

    let misplacedCount = 0;
    const noteMembers: ClusteredNoteMember[] = memberIndices.map(idx => {
      const m = enrichedNotes[idx];
      let simToCluster = 0.85;
      if (memberIndices.length > 1) {
        const others = memberIndices.filter(o => o !== idx);
        const avg = others.reduce((acc, o) => acc + simMatrix[idx][o], 0) / others.length;
        simToCluster = Math.min(0.99, Math.max(0.5, 0.45 + avg * 0.6));
      }

      const currentNorm = (m.input.folder || '').replace(/^\/+|\/+$/g, '').toLowerCase();
      const targetNorm = recommendedFolder.replace(/^\/+|\/+$/g, '').toLowerCase();
      const needsRouting = Boolean(targetNorm && currentNorm !== targetNorm);
      if (needsRouting) {
        misplacedCount++;
        totalMisplaced++;
      }

      // Merge note's own inferred tags with top cluster tags
      const mergedSuggested = Array.from(
        new Set([...m.inferredTags, ...coreTags.slice(0, 3)])
      ).slice(0, 8);
      const currentLower = new Set(m.cleanCurrentTags.map(t => t.toLowerCase()));
      const needsTagUpdate =
        mergedSuggested.some(t => !currentLower.has(t.toLowerCase())) ||
        (m.input.tags || []).some(t => String(t).includes('/'));

      return {
        path: m.input.path,
        filename: m.input.filename,
        title: m.input.title || m.input.filename.replace(/\.md$/i, ''),
        currentFolder: m.input.folder || 'Root',
        recommendedFolder,
        snippet: extractBodyCleanSnippet(m.input.body),
        currentTags: m.cleanCurrentTags,
        suggestedTags: mergedSuggested,
        matchedConcepts: m.topConcepts.slice(0, 4),
        similarityToCluster: Math.round(simToCluster * 100),
        needsRouting,
        needsTagUpdate
      };
    });

    noteMembers.sort((a, b) => b.similarityToCluster - a.similarityToCluster);

    return {
      id: `cluster_${cIdx + 1}_${(dominantProject || dominantDomain || 'knowledge').toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      label,
      summary,
      dominantProject,
      dominantDomain,
      recommendedFolder,
      coreTags,
      keyConcepts,
      cohesionScore,
      misplacedCount,
      notes: noteMembers
    };
  });

  // Sort clusters: multi-note clusters first, then by size and cohesion
  formattedClusters.sort((a, b) => {
    if (b.notes.length !== a.notes.length) return b.notes.length - a.notes.length;
    return b.cohesionScore - a.cohesionScore;
  });

  return {
    clusters: formattedClusters,
    semanticBridges: semanticBridges.slice(0, 20),
    totalNotes: notes.length,
    totalClusters: formattedClusters.length,
    misplacedNotesCount: totalMisplaced
  };
}
