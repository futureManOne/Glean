/**
 * ECDICT Core Dictionary & Morphological Lemmatization Engine
 * 
 * Features:
 * - 42,000+ curated high-frequency core English vocabulary (ECDICT / Oxford 3000-5000 / Collins / BNC / COCA)
 * - Complete IPA phonetic transcriptions, part of speech, concise Chinese definitions
 * - Accurate CEFR level tags (A1 - C2) and Collins star ratings (1 - 5)
 * - Over 94,000 morphological inflection mappings from skywind3000/ECDICT lemma database
 * - Blazing-fast (<1ms) memory-resident lookup with zero network latency
 */

import dictData from './ecdictCoreData.json';
import lemmaData from './lemmaCoreData.json';
import { DictEntry } from './ecdictMini';

export type { DictEntry };

const CORE_DICT = dictData as unknown as Record<string, [string, string, string, string, number]>;
const LEMMA_MAP = lemmaData as unknown as Record<string, string>;

/**
 * High-priority irregular verb, plural, and adjective mappings
 */
export const IRREGULAR_OVERRIDES: Record<string, string> = {
  "better": "good",
  "best": "good",
  "worse": "bad",
  "worst": "bad",
  "people": "person",
  "went": "go",
  "gone": "go",
  "children": "child",
  "teeth": "tooth",
  "feet": "foot",
  "mice": "mouse",
  "geese": "goose",
  "wives": "wife",
  "knives": "knife",
  "lives": "life",
  "more": "many",
  "most": "many",
  "less": "little",
  "least": "little"
};

/**
 * Return total number of vocabulary words in the core dictionary
 */
export function getCoreDictWordCount(): number {
  return Object.keys(CORE_DICT).length;
}

/**
 * Return total number of inflection mappings in the lemma database
 */
export function getCoreLemmaCount(): number {
  return Object.keys(LEMMA_MAP).length;
}

/**
 * High-precision morphological lemmatization
 * Normalizes plurals, irregular verbs, past tense, comparative/superlative forms to root lemma.
 */
export function normalizeWord(rawWord: string): string {
  if (!rawWord) return '';
  const clean = rawWord.toLowerCase().trim().replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '');
  if (!clean) return rawWord;

  // 1. High-priority irregular overrides
  if (IRREGULAR_OVERRIDES[clean]) {
    return IRREGULAR_OVERRIDES[clean];
  }

  // 2. High-precision lemma match from ECDICT/BNC lemma database (inflected -> base lemma)
  if (LEMMA_MAP[clean] && LEMMA_MAP[clean] !== clean) {
    return LEMMA_MAP[clean];
  }

  // 2. Direct match in core dictionary
  if (CORE_DICT[clean]) {
    return clean;
  }

  // 3. Rule-based morphological decomposition & suffix stripping
  if (clean.endsWith("'s") || clean.endsWith("’s")) {
    const root = clean.slice(0, -2);
    if (LEMMA_MAP[root]) return LEMMA_MAP[root];
    if (CORE_DICT[root]) return root;
  }
  if (clean.endsWith('ies') && clean.length > 4) {
    const root = clean.slice(0, -3) + 'y';
    if (CORE_DICT[root]) return root;
  }
  if (clean.endsWith('ied') && clean.length > 4) {
    const root = clean.slice(0, -3) + 'y';
    if (CORE_DICT[root]) return root;
  }
  if (clean.endsWith('ier') && clean.length > 4) {
    const root = clean.slice(0, -3) + 'y';
    if (CORE_DICT[root]) return root;
  }
  if (clean.endsWith('iest') && clean.length > 5) {
    const root = clean.slice(0, -4) + 'y';
    if (CORE_DICT[root]) return root;
  }
  if (clean.endsWith('ves') && clean.length > 4) {
    const root = clean.slice(0, -3) + 'f';
    if (CORE_DICT[root]) return root;
  }
  if (clean.endsWith('es') && clean.length > 3) {
    const root = clean.slice(0, -2);
    if (CORE_DICT[root]) return root;
  }
  if (clean.endsWith('s') && !clean.endsWith('ss') && clean.length > 3) {
    const root = clean.slice(0, -1);
    if (CORE_DICT[root]) return root;
  }
  if (clean.endsWith('ing') && clean.length > 4) {
    const base = clean.slice(0, -3);
    if (CORE_DICT[base]) return base;
    if (CORE_DICT[base + 'e']) return base + 'e';
    if (base.length > 2 && base[base.length - 1] === base[base.length - 2]) {
      const stripped = base.slice(0, -1);
      if (CORE_DICT[stripped]) return stripped;
    }
  }
  if (clean.endsWith('ed') && clean.length > 4) {
    const base = clean.slice(0, -2);
    if (CORE_DICT[base]) return base;
    if (CORE_DICT[base + 'e']) return base + 'e';
    if (base.length > 2 && base[base.length - 1] === base[base.length - 2]) {
      const stripped = base.slice(0, -1);
      if (CORE_DICT[stripped]) return stripped;
    }
  }
  if (clean.endsWith('ly') && clean.length > 4) {
    const base = clean.slice(0, -2);
    if (CORE_DICT[base]) return base;
  }

  // 4. Return lemma if available
  if (LEMMA_MAP[clean]) {
    return LEMMA_MAP[clean];
  }

  return clean;
}

/**
 * Instant local lookup with sub-millisecond (<1ms) response time
 */
export function lookupLocalDict(rawWord: string): DictEntry {
  if (!rawWord) {
    return {
      word: '',
      phonetic: '',
      pos: 'word',
      trans: '暂无离线释义',
      cefr: 'B1',
      collins: 1
    };
  }

  const clean = rawWord.toLowerCase().trim().replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '');
  const norm = normalizeWord(clean);
  const isInflected = norm && norm !== clean && CORE_DICT[norm];

  // 1. Direct match with optional lemma enhancement
  if (CORE_DICT[clean]) {
    const [phonetic, pos, trans, cefr, collins] = CORE_DICT[clean];
    let fullTrans = trans;
    let detectedLemma: string | undefined = undefined;
    // If definition is very short or mentions past tense/plural, append base lemma definition
    if (isInflected && (trans.includes('过去') || trans.includes('分词') || trans.includes('复数') || trans.length < 20)) {
      const baseTrans = CORE_DICT[norm][2];
      fullTrans = `${trans}； [${norm}] ${baseTrans}`;
      detectedLemma = norm;
    }
    return {
      word: rawWord,
      phonetic,
      pos,
      trans: fullTrans,
      lemma: detectedLemma || (isInflected ? norm : undefined),
      cefr: (cefr || (isInflected ? CORE_DICT[norm][3] : 'B1')) as any,
      collins: collins || (isInflected ? CORE_DICT[norm][4] : 1)
    };
  }

  // 2. Normalized lemma match
  if (isInflected) {
    const [phonetic, pos, trans, cefr, collins] = CORE_DICT[norm];
    return {
      word: rawWord,
      phonetic,
      pos,
      trans: `[${norm}] ${trans}`,
      lemma: norm,
      cefr: (cefr || 'B1') as any,
      collins: collins || 1
    };
  }

  // 3. Graceful fallback with root hint
  const rootHint = norm && norm !== clean ? ` (词根: ${norm})` : '';
  return {
    word: rawWord,
    phonetic: `/${clean}/`,
    pos: 'word',
    trans: `暂无离线释义${rootHint}`,
    lemma: norm && norm !== clean ? norm : undefined,
    cefr: 'B1',
    collins: 1
  };
}
