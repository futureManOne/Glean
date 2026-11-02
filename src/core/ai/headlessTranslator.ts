import { AI_PRESETS } from '@/types';
import { callLlmChat } from '@/core/api/llmClient';
import { isValidSubtitleText } from '@/core/subtitle/parser';

/**
 * Store-free bilingual subtitle translation for headless runtimes
 * (Bun bridge / IINA plugin), mirroring the prompt and JSON contract of
 * `bilingualTranslator.ts` while staying free of app-store dependencies.
 */
export interface HeadlessLlmConfig {
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
/** Process-wide ceiling on in-flight LLM requests (translation + gloss share it). */
const MAX_CONCURRENT_REQUESTS = 4;
/** First attempt + one retry per batch. */
const MAX_BATCH_ATTEMPTS = 2;
const RETRY_DELAY_MS = 600;
const REQUEST_TIMEOUT_MS = 40000;

/** Coarse progress event, emitted once per finished batch. */
export interface BatchProgress {
  /** Cues finished so far, failed batches included. */
  done: number;
  /** Cues queued for the model in this run. */
  total: number;
  /** Which headless pass produced the event. */
  kind: 'translate' | 'gloss';
}

type BatchProgressListener = (progress: BatchProgress) => void;

/** Subscribers are shared by both headless modules; empty set = zero-cost reporting. */
const progressListeners = new Set<BatchProgressListener>();

/**
 * Subscribe to batch progress for headless translation and gloss runs.
 * Returns an unsubscribe function. `jobs.ts` filters on `kind` to isolate a run.
 */
export function onBatchProgress(listener: BatchProgressListener): () => void {
  progressListeners.add(listener);
  return () => {
    progressListeners.delete(listener);
  };
}

/** Fan a progress event out to subscribers; allocates nothing when nobody listens. */
export function reportBatchProgress(kind: BatchProgress['kind'], done: number, total: number): void {
  if (progressListeners.size === 0) return;
  const progress: BatchProgress = { done, total, kind };
  for (const listener of progressListeners) {
    try {
      listener(progress);
    } catch (err) {
      console.warn('[headlessTranslator] Progress listener threw:', err);
    }
  }
}

/** In-flight LLM requests across every headless module. */
let activeRequests = 0;
/** Callers parked because the gate was full; filled on a first-in-first-out basis. */
const slotQueue: Array<() => void> = [];

/**
 * Run one LLM request under the shared `MAX_CONCURRENT_REQUESTS` gate. The slot
 * is handed straight to the next waiter (rather than decremented and re-taken),
 * so a late arrival can never barge past a parked caller.
 */
export async function withLlmSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    const { promise, resolve } = Promise.withResolvers<void>();
    slotQueue.push(resolve);
    await promise;
  } else {
    activeRequests++;
  }

  try {
    return await task();
  } finally {
    const next = slotQueue.shift();
    if (next) next();
    else activeRequests--;
  }
}

const CONTAINER_KEYS = ['translations', 'subtitles', 'cues', 'items', 'data', 'results', 'result'] as const;
const META_KEYS = new Set(['total', 'success', 'status', 'error', 'code']);
const TEXT_KEYS = [
  'textZh',
  'translation',
  'text_zh',
  'english',
  'chinese',
  'zh',
  'en',
  'text',
  'targetText'
] as const;
const INDEX_KEYS = ['index', 'id', 'idx'] as const;

/**
 * Describe the target language for the prompt, reusing the phrasing of
 * `resolveTargetLanguage` in bilingualTranslator.
 */
function describeTargetLanguage(code: string): string {
  const lang = (code || 'zh').trim();
  if (lang === 'en') return 'natural, fluent, and idiomatic conversational English (地道自然口语英语)';
  if (lang === 'zh-TW' || lang === 'zh-HK') return '自然流暢、貼合語境的繁體中文';
  if (lang.startsWith('zh')) return '自然流畅、贴合语境的简体中文';
  if (lang === 'ja') return '自然な会話調の日本語';
  if (lang === 'ko') return '자연스러운 구어체 한국어';
  if (lang === 'fr') return 'français naturel et fluide';
  if (lang === 'de') return 'natürliches und flüssiges Deutsch';
  if (lang === 'es') return 'español natural y conversacional';
  if (lang === 'ru') return 'естественный разговорный русский язык';
  return '自然流畅、贴合语境的简体中文';
}

/**
 * Same system prompt contract as `BilingualTranslator.translateBatch`,
 * keyed by "index" (the payload field sent to the model) instead of "id".
 */
function buildSystemPrompt(targetDesc: string, targetLang: string): string {
  const sampleTranslation = targetLang.trim().toLowerCase().startsWith('zh') ? '翻译内容' : 'Natural translation here';
  return `You are a professional subtitle translator and native bilingual speaker.
Translate the following video subtitle sentences into natural, accurate, and conversational ${targetDesc}.
Match conversational sitcom dialogue tone. Do not add notes, markdown, or commentary.
CRITICAL: You MUST preserve the exact original "index" integer for each item. Do NOT renumber or start from 1. If an input item has index 35, your output object MUST have index 35.
Output ONLY a valid JSON object with key "translations" containing an array of objects with keys "index" and "textZh", e.g.:
{
  "translations": [
    { "index": 1, "textZh": "${sampleTranslation}" }
  ]
}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readIndexKey(item: unknown): number | null {
  if (!isRecord(item)) return null;
  for (const key of INDEX_KEYS) {
    const raw = item[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
    if (typeof raw === 'string' && raw.trim() !== '') {
      const n = Number(raw.trim());
      if (Number.isFinite(n)) return Math.trunc(n);
    }
  }
  return null;
}

function readTranslationText(item: unknown): string {
  if (typeof item === 'string') return item.trim();
  if (!isRecord(item)) return '';
  for (const key of TEXT_KEYS) {
    const raw = item[key];
    if (typeof raw === 'string') {
      const text = raw.trim();
      if (text) return text;
    }
  }
  return '';
}

/**
 * Strip reasoning blocks and markdown fences, then parse the outermost JSON
 * structure. Mirrors the recovery pipeline of `parseTranslationResponse`.
 */
function extractJsonPayload(raw: string): unknown {
  if (!raw || typeof raw !== 'string') return null;

  let cleaned = raw
    .replace(/<\s*(?:think|thought)[\s\S]*?<\/\s*(?:think|thought)\s*>/gi, '')
    .replace(/^<\s*(?:think|thought)[\s\S]*?(?:<\/|$)/i, '')
    .trim();

  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  } else {
    cleaned = cleaned.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  }

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  const hasBraces = firstBrace !== -1 && lastBrace > firstBrace;
  const hasBrackets = firstBracket !== -1 && lastBracket > firstBracket;

  if (hasBraces && hasBrackets) {
    if (firstBrace < firstBracket && lastBrace > lastBracket) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    } else if (firstBracket < firstBrace && lastBracket > lastBrace) {
      cleaned = cleaned.substring(firstBracket, lastBracket + 1);
    } else if (firstBrace < firstBracket) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    } else {
      cleaned = cleaned.substring(firstBracket, lastBracket + 1);
    }
  } else if (hasBraces) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  } else if (hasBrackets) {
    cleaned = cleaned.substring(firstBracket, lastBracket + 1);
  } else {
    return null;
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

/** Pull the translation item list out of any supported JSON shape. */
function collectItems(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (!isRecord(parsed)) return [];

  const fromContainer = (container: Record<string, unknown>): unknown[] | null => {
    for (const key of CONTAINER_KEYS) {
      const value = container[key];
      if (Array.isArray(value)) return value;
    }
    const entries = Object.entries(container).filter(([k]) => !META_KEYS.has(k));
    if (entries.length === 0) return null;
    const isIndexDict = entries.every(([k]) => Number.isFinite(Number(k)));
    if (!isIndexDict) return null;
    return entries.map(([k, v]) => (typeof v === 'string' ? { index: k, textZh: v } : isRecord(v) ? { index: k, ...v } : null));
  };

  for (const key of CONTAINER_KEYS) {
    const value = parsed[key];
    if (Array.isArray(value)) return value;
    if (isRecord(value)) {
      const nested = fromContainer(value);
      if (nested) return nested;
    }
  }

  if (readIndexKey(parsed) !== null) return [parsed];

  const dict = fromContainer(parsed);
  if (dict) return dict;

  return [];
}

/**
 * Prefer the index the model echoed back; if it looks off by a constant
 * (some models renumber from 1) pick the shift with the best coverage.
 */
function pickIndexShift(keyed: Map<number, string>, count: number): number {
  let bestShift = 0;
  let bestScore = -1;
  for (const shift of [0, 1, -1]) {
    let score = 0;
    keyed.forEach((_text, key) => {
      const target = key + shift;
      if (target >= 0 && target < count) score++;
    });
    if (score > bestScore) {
      bestScore = score;
      bestShift = shift;
    }
  }
  return bestShift;
}

/** Parse a batch response into a slot-indexed map; missing slots stay absent. */
function parseIndexedTranslations(raw: string, count: number): Map<number, string> {
  const result = new Map<number, string>();
  if (!raw || count <= 0) return result;

  const items = collectItems(extractJsonPayload(raw));
  if (items.length === 0) return result;

  const keyed = new Map<number, string>();
  const indexless: string[] = [];

  for (const item of items) {
    const text = readTranslationText(item);
    if (!text) continue;
    const key = readIndexKey(item);
    if (key === null) {
      indexless.push(text);
    } else if (!keyed.has(key)) {
      keyed.set(key, text);
    }
  }

  // Items without an index fill the remaining slots in order.
  let cursor = 0;
  for (const text of indexless) {
    while (cursor < count && keyed.has(cursor)) cursor++;
    if (cursor >= count) break;
    keyed.set(cursor, text);
    cursor++;
  }

  const shift = pickIndexShift(keyed, count);
  keyed.forEach((text, key) => {
    const target = key + shift;
    if (target >= 0 && target < count && !result.has(target)) result.set(target, text);
  });

  return result;
}

/**
 * Map the bridge config onto `LlmConfig`; `callLlmChat` derives the wire
 * protocol from the base URL, so `provider` is advisory only.
 */
function resolveLlmSettings(cfg: HeadlessLlmConfig): { apiBaseUrl: string; apiKey: string; modelName: string } | null {
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

/** One batch request with a single retry; never throws, returns {} on failure. */
async function requestBatch(
  items: Array<{ index: number; textEn: string }>,
  llm: { apiBaseUrl: string; apiKey: string; modelName: string },
  systemPrompt: string
): Promise<Map<number, string>> {
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
            temperature: 0.3,
            responseFormatJson: true
          }
        )
      );
      const parsed = parseIndexedTranslations(response, items.length);
      if (parsed.size > 0) return parsed;
      console.warn('[headlessTranslator] Batch returned no usable translations; retrying.', { size: items.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[headlessTranslator] Batch request failed:', message);
    }
    if (attempt + 1 < MAX_BATCH_ATTEMPTS) await sleep(RETRY_DELAY_MS);
  }

  return new Map();
}

/**
 * Translate subtitle cues into `cfg.targetLang`, preserving input length.
 * Batches run four at a time (one wave of `Promise.allSettled`); cues that
 * already carry a non-blank `textZh` are passed through untouched, failed
 * batches fall back to empty strings and never throw.
 */
export async function translateCuesHeadless(
  cues: { textEn: string; textZh: string }[],
  cfg: HeadlessLlmConfig
): Promise<{ textZh: string }[]> {
  const source = Array.isArray(cues) ? cues : [];
  const result = source.map(cue => ({ textZh: typeof cue?.textZh === 'string' ? cue.textZh.trim() : '' }));
  if (source.length === 0) return result;

  const targetLang = (cfg?.targetLang || 'zh').trim() || 'zh';
  const wantsChinese = targetLang.toLowerCase().startsWith('zh');

  const pending: Array<{ cueIndex: number; textEn: string }> = [];
  source.forEach((cue, i) => {
    if (result[i].textZh) return;
    const textEn = typeof cue?.textEn === 'string' ? cue.textEn.trim() : '';
    if (!textEn || !isValidSubtitleText(textEn)) return;
    // English cues must carry Latin letters; otherwise there is nothing to translate.
    if (wantsChinese && !/[A-Za-z]/.test(textEn)) return;
    pending.push({ cueIndex: i, textEn });
  });
  if (pending.length === 0) return result;

  const llm = resolveLlmSettings(cfg);
  if (!llm) {
    console.warn('[headlessTranslator] Missing apiKey/model; returning empty translations.');
    return result;
  }

  const systemPrompt = buildSystemPrompt(describeTargetLanguage(targetLang), targetLang);
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
      console.warn('[headlessTranslator] onProgress callback threw:', err);
    }
    reportBatchProgress('translate', done, total);
  };

  let done = 0;
  report(0);

  for (let wave = 0; wave < batches.length; wave += BATCH_CONCURRENCY) {
    const group = batches.slice(wave, wave + BATCH_CONCURRENCY);
    const settled = await Promise.allSettled(
      group.map(batch =>
        requestBatch(
          batch.map((entry, index) => ({ index, textEn: entry.textEn })),
          llm,
          systemPrompt
        )
      )
    );

    settled.forEach((outcome, k) => {
      const batch = group[k];
      const batchNo = wave + k + 1;
      if (outcome.status === 'fulfilled') {
        for (const [slot, text] of outcome.value) {
          const entry = batch[slot];
          if (!entry || !text) continue;
          result[entry.cueIndex].textZh = text;
        }
        console.log(`[headlessTranslator] Batch ${batchNo}: ${outcome.value.size}/${batch.length} translated.`);
      } else {
        // requestBatch never throws today; a rejection would still only cost this batch.
        console.warn(`[headlessTranslator] Batch ${batchNo} rejected:`, outcome.reason);
      }
      done += batch.length;
      report(done);
    });
  }

  return result;
}
