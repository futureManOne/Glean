import { AI_PRESETS, type PhraseGlossItem } from '@/types';
import { callLlmChat } from '@/core/api/llmClient';
import { tokenizeSentence } from '@/core/subtitle/tokenizer';
import { lookupLocalDict } from '@/core/dictionary/ecdictMini';
import { reportBatchProgress, withLlmSlot } from './headlessTranslator';

export { onBatchProgress } from './headlessTranslator';
export type { BatchProgress } from './headlessTranslator';

/**
 * Store-free inline ("mixed") gloss generation for headless runtimes
 * (Bun bridge / IINA plugin). Mirrors the prompt spirit and JSON contract of
 * `mixedGlossGenerator.buildMixedTranslationPrompt` — contextual glosses over
 * dictionary senses, whole collocations over split words — while staying free
 * of app-store and `chrome.*` dependencies.
 */
export interface HeadlessGlossConfig {
  apiKey: string;
  provider: string;
  model: string;
  baseUrl?: string;
  targetLang: string;
  /** Optional: called after each batch settles (success or fallback), with cues completed. */
  onProgress?: (done: number, total: number) => void;
}

/** Cues per LLM request in the default regime. */
const BATCH_SIZE = 20;
/** Above this many queued cues the batches get coarser to cut round trips. */
const LARGE_INPUT_THRESHOLD = 200;
const LARGE_INPUT_BATCH_SIZE = 30;
/** Batches dispatched together; the shared semaphore caps real HTTP concurrency. */
const BATCH_CONCURRENCY = 4;
/** First attempt + one retry per batch. */
const MAX_BATCH_ATTEMPTS = 2;
const RETRY_DELAY_MS = 600;
const REQUEST_TIMEOUT_MS = 40000;

/** Hard cap on annotated chunks per cue (both online and offline paths). */
const MAX_PHRASES_PER_CUE = 15;
/** A gloss must stay glanceable inside a subtitle line. */
const MAX_MEANING_CHARS = 8;
const MAX_OFFLINE_PHRASES = 12;

const CONTAINER_KEYS = ['results', 'phrases', 'cues', 'items', 'data', 'result'] as const;
const META_KEYS: Record<string, true> = {
  total: true,
  success: true,
  status: true,
  error: true,
  code: true
};
const PHRASE_LIST_KEYS = ['phrases', 'glosses', 'annotations', 'items'] as const;
const INDEX_KEYS = ['index', 'id', 'idx'] as const;

/**
 * Function words that must never be glossed on their own offline. Deliberately
 * local (instead of importing `TRIVIAL_STOP_WORDS` from mixedGlossGenerator) so
 * the headless path keeps zero app-store and UI coupling.
 */
const OFFLINE_STOP_WORDS: Record<string, true> = {
  a: true, an: true, the: true,
  in: true, on: true, at: true, to: true, for: true, with: true, by: true, from: true, of: true,
  about: true, into: true, onto: true, over: true, under: true, above: true, below: true, as: true,
  than: true, off: true, out: true, up: true, down: true, per: true, via: true,
  i: true, me: true, my: true, mine: true, myself: true, you: true, your: true, yours: true,
  he: true, him: true, his: true, she: true, her: true, hers: true, it: true, its: true,
  we: true, us: true, our: true, ours: true, they: true, them: true, their: true, theirs: true,
  this: true, that: true, these: true, those: true, there: true, here: true,
  what: true, which: true, who: true, whom: true, whose: true,
  where: true, when: true, why: true, how: true, whether: true,
  is: true, am: true, are: true, was: true, were: true, be: true, been: true, being: true,
  do: true, does: true, did: true, done: true, doing: true,
  have: true, has: true, had: true, having: true,
  can: true, could: true, will: true, would: true, shall: true, should: true, may: true,
  might: true, must: true,
  and: true, or: true, but: true, so: true, because: true, if: true, then: true, though: true,
  although: true, while: true, since: true, until: true, unless: true,
  not: true, no: true, yes: true, yeah: true, oh: true, ok: true, okay: true, well: true,
  hey: true, hi: true, hello: true, hmm: true, uh: true,
  too: true, very: true, just: true, also: true, any: true, some: true, all: true, like: true,
  more: true, most: true, much: true, many: true, again: true, still: true, only: true,
  even: true, now: true, s: true, t: true, re: true, ve: true, ll: true, d: true, m: true
};

/**
 * Function words that may legitimately glue a collocation together offline
 * ("a lot of", "getting used to", "in front of", "as well as"): articles,
 * prepositions and verb particles. Pronouns, auxiliaries and discourse adverbs
 * are deliberately absent — "also I got" is not a chunk.
 */
const LINKING_WORDS: Record<string, true> = {
  a: true, an: true, the: true,
  of: true, to: true, in: true, on: true, at: true, for: true, with: true, by: true, from: true,
  up: true, out: true, off: true, down: true, over: true, into: true, onto: true, about: true,
  as: true, than: true, per: true, via: true, and: true, away: true, around: true,
  through: true, along: true, across: true, after: true, before: true, against: true,
  under: true, without: true, within: true, upon: true, back: true, together: true
};

/** Describe the gloss language for the prompt (target is Chinese in practice). */
function describeTargetLanguage(code: string): string {
  const normalized = (code || '').trim().toLowerCase();
  if (normalized.startsWith('zh')) return 'Simplified Chinese (简体中文)';
  if (normalized.startsWith('ja')) return 'Japanese (日本語)';
  if (normalized.startsWith('ko')) return 'Korean (한국어)';
  return normalized ? normalized.toUpperCase() : 'Simplified Chinese (简体中文)';
}

/**
 * Same annotation philosophy as `buildMixedTranslationPrompt` in the extension
 * (`mixedGlossGenerator.ts`), but keyed by `index` and returning glosses only —
 * the English sentence is never re-emitted, so it can never be rewritten.
 */
function buildSystemPrompt(targetDesc: string): string {
  return `You are a world-class bilingual subtitle editor and ESL learning specialist.
Learners watch English videos in a "mixed" (inline-gloss) subtitle format: the English sentence stays intact, and key words, phrases, verbs, idioms, and conversational chunks carry a concise ${targetDesc} gloss shown in parentheses right after them.

TARGET DENSITY: HIGH COVERAGE (~70% - 80% of words).
The user is an English learner who needs dense vocabulary and phrase support. Annotate almost all content-bearing words, verbs, phrasal verbs, idioms, nouns, adjectives, adverbs, and spoken conversational chunks (e.g. "got to say" -> "不得不说", "really" -> "真的/确实", "appreciate" -> "感激/感谢", "this" -> "这事", "guys" -> "大伙/各位", "No problem" -> "没问题/不用客气", "food on a stick" -> "串串/签子食物").

For each subtitle cue you receive {"index": n, "textEn": "..."}:
1. Thoroughly identify ALL meaningful units in the English sentence:
   - Conversational chunks & idioms (e.g. "got to say", "no problem", "as well as", "you know", "instead of")
   - Phrasal verbs & collocations (e.g. "getting used to", "step into", "dial one", "hang on", "look forward to")
   - Verbs, nouns, adjectives, adverbs, and demonstratives (e.g. "appreciate", "lunatic", "bright", "shrink's")
   - Aim for 3 to 12 glossed phrases per sentence depending on length, achieving high density (~70-80% word coverage).
2. For each unit:
   - "phrase": the exact continuous English text AS IT APPEARS in "textEn" (copy the characters verbatim, same casing). It MUST be a substring of that cue's "textEn". Never paraphrase, translate, or invent text that is not in the sentence.
   - "meaning": a concise CONTEXTUAL ${targetDesc} gloss, 2 to 8 characters, e.g. "不得不说", "感激/感谢", "买了/收到", "而且/此外", "习惯于". Give the sense used HERE in this context — NEVER dump dictionary parts of speech ("adj. 明亮的") and NEVER chain many meanings with commas or semicolons.
3. CRITICAL RULES:
   - Keep whole collocations and idioms together (extract "got to say", NOT just "say"; "a lot of", NOT "lot"; "food on a stick", NOT "stick").
   - Leave only minimal standalone grammatical function words (like standalone "I", "a", "the", "to", "and") unannotated, unless part of a phrase.
   - Never return two phrases that overlap the same words of the sentence.
   - Preserve the exact "index" integer you received for every cue.
4. Output strictly valid JSON matching this schema:
{
  "results": [
    {
      "index": 0,
      "phrases": [
        { "phrase": "got to say", "meaning": "不得不说" },
        { "phrase": "really", "meaning": "真的" },
        { "phrase": "appreciate", "meaning": "感激" },
        { "phrase": "guys", "meaning": "大伙" },
        { "phrase": "No problem", "meaning": "没问题" }
      ]
    }
  ]
}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readIndexKey(item: unknown): number | null {
  if (!isRecord(item)) return null;
  for (const key of INDEX_KEYS) {
    const value = item[key];
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      return Math.trunc(Number(value));
    }
  }
  return null;
}

/** Strip reasoning blocks and markdown fences, then parse the outermost JSON. */
function extractJsonPayload(raw: string): unknown {
  if (!raw || typeof raw !== 'string') return null;

  let cleaned = raw.trim();
  cleaned = cleaned.replace(/```[a-zA-Z0-9]*/g, '').replace(/```/g, '').trim();
  cleaned = cleaned.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').trim();

  const startObj = cleaned.indexOf('{');
  const startArr = cleaned.indexOf('[');
  const startCandidates = [startObj, startArr].filter(i => i >= 0);
  if (startCandidates.length > 0) {
    const start = Math.min(...startCandidates);
    const endObj = cleaned.lastIndexOf('}');
    const endArr = cleaned.lastIndexOf(']');
    const end = Math.max(endObj, endArr);
    if (end > start) cleaned = cleaned.slice(start, end + 1);
  }

  const stripTrailingCommas = (input: string): string => {
    let prev = '';
    let out = input;
    while (out !== prev) {
      prev = out;
      out = out.replace(/,\s*([}\]])/g, '$1');
    }
    return out;
  };

  cleaned = stripTrailingCommas(cleaned);

  try {
    return JSON.parse(cleaned);
  } catch {
    const normalized = stripTrailingCommas(
      cleaned
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
        .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    );
    try {
      return JSON.parse(normalized);
    } catch {
      return null;
    }
  }
}

/** Pull the result item list out of any supported JSON shape. */
function collectItems(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (!isRecord(parsed)) return [];

  const fromContainer = (container: Record<string, unknown>): unknown[] | null => {
    for (const key of CONTAINER_KEYS) {
      const value = container[key];
      if (Array.isArray(value)) return value;
    }
    const entries = Object.entries(container).filter(([k]) => META_KEYS[k] !== true);
    if (entries.length === 0) return null;
    const isIndexDict = entries.every(([k]) => Number.isFinite(Number(k)));
    if (!isIndexDict) return null;
    return entries.map(([k, v]) =>
      Array.isArray(v) ? { index: k, phrases: v } : isRecord(v) ? { index: k, ...v } : null
    );
  };

  if (readIndexKey(parsed) !== null && PHRASE_LIST_KEYS.some(key => Array.isArray(parsed[key]))) {
    return [parsed];
  }

  for (const key of CONTAINER_KEYS) {
    const value = parsed[key];
    if (Array.isArray(value)) return value;
    if (isRecord(value)) {
      const nested = fromContainer(value);
      if (nested) return nested;
    }
  }

  const dict = fromContainer(parsed);
  if (dict) return dict;

  return [];
}

/** Read one `{ phrase, meaning }` pair, tolerating key aliases. */
function readPhrasePair(item: unknown): PhraseGlossItem | null {
  if (!isRecord(item)) return null;
  const phrase = [item.phrase, item.text, item.word, item.chunk].find(
    (v): v is string => typeof v === 'string'
  );
  const meaning = [item.meaning, item.gloss, item.zh, item.translation, item.definition].find(
    (v): v is string => typeof v === 'string'
  );
  if (!phrase || !meaning) return null;
  return { phrase, meaning };
}

function readPhraseList(item: unknown): PhraseGlossItem[] {
  if (!isRecord(item)) return [];
  for (const key of PHRASE_LIST_KEYS) {
    const value = item[key];
    if (!Array.isArray(value)) continue;
    const pairs: PhraseGlossItem[] = [];
    for (const entry of value) {
      const pair = readPhrasePair(entry);
      if (pair) pairs.push(pair);
    }
    return pairs;
  }
  return [];
}

/** Normalize a gloss to a short, Chinese-only, single-sense string. */
function cleanMeaning(raw: string): string {
  let value = (raw || '').trim();
  if (!value) return '';

  value = value
    .replace(/[（(]词根:.*?[）)]/g, '')
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '')
    .replace(/^[a-zA-Z./\s]+\.\s*/, '')
    .trim();

  // Keep only the first sense when the model chained several.
  const chunks = value.split(/[\n，,；;、/|]/).map(chunk => chunk.trim()).filter(Boolean);
  for (const chunk of chunks) {
    const han = chunk.match(/[\u3400-\u4dbf\u4e00-\u9fa5]+/g);
    if (!han) continue;
    const joined = han.join('');
    if (!joined) continue;
    return joined.slice(0, MAX_MEANING_CHARS);
  }
  return '';
}

/**
 * Keep only glosses that can actually be located inside `textEn`
 * (case-insensitive substring), reject overlaps, order by position, cap length.
 */
function sanitizePhrases(textEn: string, rawPhrases: PhraseGlossItem[]): PhraseGlossItem[] {
  if (!textEn || rawPhrases.length === 0) return [];
  const haystack = textEn.toLowerCase();

  const candidates: Array<{ phrase: string; meaning: string; position: number }> = [];
  const seen = new Set<string>();
  const spans: Array<[number, number]> = [];

  for (const raw of rawPhrases) {
    if (candidates.length >= MAX_PHRASES_PER_CUE * 3) break;
    const phrase = (raw.phrase || '').trim();
    if (!phrase) continue;
    const meaning = cleanMeaning(raw.meaning);
    if (!meaning) continue;

    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;

    const position = haystack.indexOf(key);
    if (position < 0) continue;
    const end = position + key.length;
    if (spans.some(([s, e]) => position < e && end > s)) continue;

    seen.add(key);
    spans.push([position, end]);
    candidates.push({ phrase: textEn.slice(position, end), meaning, position });
  }

  candidates.sort((a, b) => a.position - b.position);
  return candidates
    .slice(0, MAX_PHRASES_PER_CUE)
    .map(({ phrase, meaning }) => ({ phrase, meaning }));
}

/** Parse a batch response into slot-indexed gloss arrays; missing slots stay absent. */
function parseIndexedGlosses(raw: string, count: number): Map<number, PhraseGlossItem[]> {
  const result = new Map<number, PhraseGlossItem[]>();
  if (!raw || count <= 0) return result;

  const items = collectItems(extractJsonPayload(raw));
  if (items.length === 0) return result;

  const keyed = new Map<number, PhraseGlossItem[]>();
  const indexless: PhraseGlossItem[][] = [];

  for (const item of items) {
    const phrases = readPhraseList(item);
    if (phrases.length === 0) continue;
    const key = readIndexKey(item);
    if (key === null) {
      indexless.push(phrases);
    } else if (!keyed.has(key)) {
      keyed.set(key, phrases);
    }
  }

  let cursor = 0;
  for (const phrases of indexless) {
    while (cursor < count && keyed.has(cursor)) cursor++;
    if (cursor >= count) break;
    keyed.set(cursor, phrases);
    cursor++;
  }

  // Some models renumber from 1; pick the shift with the best coverage.
  let bestShift = 0;
  let bestScore = -1;
  for (const shift of [0, 1, -1]) {
    let score = 0;
    keyed.forEach((_phrases, key) => {
      const target = key + shift;
      if (target >= 0 && target < count) score++;
    });
    if (score > bestScore) {
      bestScore = score;
      bestShift = shift;
    }
  }

  keyed.forEach((phrases, key) => {
    const target = key + bestShift;
    if (target >= 0 && target < count && !result.has(target)) result.set(target, phrases);
  });

  return result;
}

/**
 * Map the bridge config onto `LlmConfig`; `callLlmChat` derives the wire
 * protocol from the base URL, so `provider` is advisory only.
 */
function resolveLlmSettings(cfg: HeadlessGlossConfig): { apiBaseUrl: string; apiKey: string; modelName: string } | null {
  const apiKey = (cfg.apiKey || '').trim();
  const model = (cfg.model || '').trim();
  if (!apiKey || !model) return null;

  return {
    apiBaseUrl: (cfg.baseUrl || '').trim() || AI_PRESETS.google.apiBaseUrl,
    apiKey,
    modelName: model
  };
}

async function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  await promise;
}

/** One batch request with a single retry; never throws, returns an empty map on failure. */
async function requestBatch(
  items: Array<{ index: number; textEn: string }>,
  llm: { apiBaseUrl: string; apiKey: string; modelName: string },
  systemPrompt: string
): Promise<Map<number, PhraseGlossItem[]>> {
  const userPrompt = JSON.stringify(items);

  for (let attempt = 0; attempt < MAX_BATCH_ATTEMPTS; attempt++) {
    try {
      const response = await withLlmSlot(() =>
        callLlmChat(
          { ...llm, timeoutMs: REQUEST_TIMEOUT_MS },
          {
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: 0.2,
            responseFormatJson: true,
            maxTokens: 2048
          }
        )
      );
      const parsed = parseIndexedGlosses(response, items.length);
      if (parsed.size > 0) return parsed;
      console.warn('[headlessMixedGloss] Batch returned no usable glosses; retrying.', {
        size: items.length
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[headlessMixedGloss] Batch request failed:', message);
    }
    if (attempt + 1 < MAX_BATCH_ATTEMPTS) await sleep(RETRY_DELAY_MS);
  }

  return new Map();
}

interface TokenSpan {
  text: string;
  start: number;
  end: number;
  isWord: boolean;
}

/** Tokenize with absolute character offsets so phrase matches map back to the raw text. */
function buildTokenSpans(textEn: string): TokenSpan[] {
  const tokens = tokenizeSentence(textEn);
  const spans: TokenSpan[] = [];
  let cursor = 0;
  for (const token of tokens) {
    const text = typeof token.text === 'string' ? token.text : '';
    if (!text) continue;
    const found = textEn.indexOf(text, cursor);
    const start = found >= 0 ? found : cursor;
    const end = start + text.length;
    cursor = end;
    spans.push({ text, start, end, isWord: Boolean(token.isWord) });
  }
  return spans;
}

function normalizeWordText(text: string): string {
  return text.toLowerCase().replace(/^[^a-z']+|[^a-z']+$/gi, '').replace(/[’‘ʼʻ`]/g, "'");
}

/** First Chinese sense of a dictionary entry, cut to `MAX_MEANING_CHARS`. */
function localMeaning(rawWord: string): string {
  const entry = lookupLocalDict(rawWord);
  if (!entry || !entry.trans) return '';
  if (entry.trans.includes('暂无离线释义') || entry.trans.includes('暂无本地释义')) return '';
  return cleanMeaning(entry.trans);
}

/** Clitic tails that mark a contraction ("it's", "don't", "we're") rather than a real word. */
const CONTRACTION_SUFFIXES: Record<string, true> = {
  s: true, t: true, re: true, ve: true, ll: true, d: true, m: true
};

function isContentWord(text: string): boolean {
  const word = normalizeWordText(text);
  if (word.length < 2) return false;
  if (OFFLINE_STOP_WORDS[word] === true) return false;

  // "it's", "I'm", "don't" carry no lexical content of their own.
  const apostrophe = word.indexOf("'");
  if (apostrophe > 0) {
    const head = word.slice(0, apostrophe);
    const tail = word.slice(apostrophe + 1);
    if (OFFLINE_STOP_WORDS[head] === true || CONTRACTION_SUFFIXES[tail] === true) return false;
  }

  if (!/[a-z]/.test(word)) return false;
  return true;
}

interface OfflineCandidate {
  phrase: string;
  meaning: string;
  start: number;
  end: number;
}

/**
 * Offline fallback: dictionary-backed collocations first (2–3 word sliding
 * windows made of a content word plus neighbouring function words), then
 * remaining standalone content words. Never throws, never invents meanings.
 */
function offlinePhrases(textEn: string): PhraseGlossItem[] {
  const spans = buildTokenSpans(textEn).filter(span => span.text.trim() !== '');
  if (spans.length === 0) return [];

  const windows: OfflineCandidate[] = [];
  const singles: OfflineCandidate[] = [];

  for (let i = 0; i < spans.length; i++) {
    const head = spans[i];
    if (!head.isWord) continue;

    if (isContentWord(head.text)) {
      const meaning = localMeaning(head.text);
      if (meaning) {
        singles.push({ phrase: textEn.slice(head.start, head.end), meaning, start: head.start, end: head.end });
      }
    }

    // Grow a window while tokens stay word-like and separated by whitespace only.
    for (let length = 2; length <= 3; length++) {
      const tailIndex = i + length - 1;
      if (tailIndex >= spans.length) break;
      let contiguous = true;
      for (let k = i; k < tailIndex; k++) {
        if (!spans[k].isWord || !spans[k + 1].isWord) {
          contiguous = false;
          break;
        }
        const gap = textEn.slice(spans[k].end, spans[k + 1].start);
        if (!/^[\s-]*$/.test(gap)) {
          contiguous = false;
          break;
        }
      }
      if (!contiguous) break;

      const group = spans.slice(i, tailIndex + 1);
      // Accept only collocation shapes: optional linking words, a content core,
      // optional trailing particle — and nothing else (no pronouns/aux/adverbs).
      const kinds = group.map(span =>
        isContentWord(span.text)
          ? 'C'
          : LINKING_WORDS[normalizeWordText(span.text)] === true
            ? 'F'
            : '?'
      );
      if (kinds.some(kind => kind === '?')) continue;
      const shape = kinds.join('');
      if (!shape.includes('F') || !/^F*C+F*$/.test(shape)) continue;

      const headContent = group.find(span => isContentWord(span.text));
      if (!headContent) continue;
      const meaning = localMeaning(headContent.text);
      if (!meaning) continue;

      const start = group[0].start;
      const end = group[group.length - 1].end;
      windows.push({ phrase: textEn.slice(start, end), meaning, start, end });
    }
  }

  // Longest collocation first, then left-to-right; skip anything overlapping.
  windows.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const picked: OfflineCandidate[] = [];
  const taken: Array<[number, number]> = [];
  const seen = new Set<string>();
  const overlaps = (start: number, end: number): boolean =>
    taken.some(([s, e]) => start < e && end > s);

  for (const candidate of windows) {
    if (picked.length >= MAX_OFFLINE_PHRASES) break;
    const key = candidate.phrase.toLowerCase();
    if (seen.has(key) || overlaps(candidate.start, candidate.end)) continue;
    seen.add(key);
    taken.push([candidate.start, candidate.end]);
    picked.push(candidate);
  }

  singles.sort((a, b) => a.start - b.start);
  for (const candidate of singles) {
    if (picked.length >= MAX_OFFLINE_PHRASES) break;
    const key = candidate.phrase.toLowerCase();
    if (seen.has(key) || overlaps(candidate.start, candidate.end)) continue;
    seen.add(key);
    taken.push([candidate.start, candidate.end]);
    picked.push(candidate);
  }

  picked.sort((a, b) => a.start - b.start);
  return picked.map(({ phrase, meaning }) => ({ phrase, meaning }));
}

/**
 * Build inline glosses for subtitle cues: `PhraseGlossItem[][]` aligned with
 * the input. Each item is a short list of `{ phrase, meaning }` where `phrase`
 * is a verbatim (case-insensitive) substring of that cue's `textEn`.
 *
 * Batches run four at a time (waves of `Promise.allSettled`); a failing batch
 * is retried once and then degrades to `[]`. When no API key is configured —
 * or every batch fails — the dictionary-backed offline path is used instead.
 * Never throws.
 */
export async function glossCuesHeadless(
  cues: { textEn: string; textZh?: string }[],
  cfg: HeadlessGlossConfig
): Promise<PhraseGlossItem[][]> {
  const source = Array.isArray(cues) ? cues : [];
  const normalized = source.map(cue => (typeof cue?.textEn === 'string' ? cue.textEn.trim() : ''));
  const result: PhraseGlossItem[][] = normalized.map(() => []);
  if (normalized.length === 0) return result;

  const llm = resolveLlmSettings(cfg ?? ({} as HeadlessGlossConfig));
  if (!llm) {
    return normalized.map(textEn => (textEn ? offlinePhrases(textEn) : []));
  }

  const targetLang = (cfg.targetLang || 'zh').trim() || 'zh';
  const systemPrompt = buildSystemPrompt(describeTargetLanguage(targetLang));

  const pending: Array<{ cueIndex: number; textEn: string }> = [];
  normalized.forEach((textEn, cueIndex) => {
    // English cues must carry Latin letters; digits-only lines have nothing to gloss.
    if (textEn && /[A-Za-z]/.test(textEn)) pending.push({ cueIndex, textEn });
  });

  const total = pending.length;
  const batchSize = total > LARGE_INPUT_THRESHOLD ? LARGE_INPUT_BATCH_SIZE : BATCH_SIZE;

  const batches: Array<typeof pending> = [];
  for (let offset = 0; offset < total; offset += batchSize) {
    batches.push(pending.slice(offset, offset + batchSize));
  }

  const report = (done: number): void => {
    try {
      cfg.onProgress?.(done, total);
    } catch (err) {
      console.warn('[headlessMixedGloss] onProgress callback threw:', err);
    }
    reportBatchProgress('gloss', done, total);
  };

  let done = 0;
  let succeededBatches = 0;
  report(0);

  for (let wave = 0; wave < batches.length; wave += BATCH_CONCURRENCY) {
    const group = batches.slice(wave, wave + BATCH_CONCURRENCY);
    const settled = await Promise.allSettled(
      group.map(batch =>
        requestBatch(
          batch.map((item, index) => ({ index, textEn: item.textEn })),
          llm,
          systemPrompt
        )
      )
    );

    settled.forEach((outcome, k) => {
      const batch = group[k];
      if (outcome.status === 'fulfilled' && outcome.value.size > 0) {
        succeededBatches++;
        outcome.value.forEach((phrases, slot) => {
          const target = batch[slot];
          if (!target) return;
          result[target.cueIndex] = sanitizePhrases(target.textEn, phrases);
        });
      }
      done += batch.length;
      report(done);
    });
  }

  // Every batch failed: fall back to the offline dictionary for the whole set.
  if (succeededBatches === 0) {
    normalized.forEach((textEn, cueIndex) => {
      if (!textEn) return;
      result[cueIndex] = offlinePhrases(textEn);
    });
  }

  return result;
}
