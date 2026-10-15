import { WordExplanation, SentenceDeepAnalysis } from '@/types';

const MAX_CACHE_ITEMS = 500;
const STORAGE_KEY_WORD = 'lr_ai_word_cache_v1';
const STORAGE_KEY_SENTENCE = 'lr_ai_sentence_cache_v1';

// In-memory cache for synchronous 0ms hits
const wordMemoryCache = new Map<string, WordExplanation>();
const sentenceMemoryCache = new Map<string, SentenceDeepAnalysis>();
let isWordInitialized = false;
let isSentenceInitialized = false;

/**
 * Generate simple fast 32-bit hash for a sentence string.
 */
export function hashSentence(str: string): string {
  if (!str) return 'empty';
  let hash = 0;
  const clean = str.trim().toLowerCase();
  for (let i = 0; i < clean.length; i++) {
    hash = ((hash << 5) - hash + clean.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Build unique composite cache key for words.
 */
export function buildCacheKey(word: string, contextEn: string): string {
  const cleanWord = (word || '').trim().toLowerCase();
  const sentenceHash = hashSentence(contextEn);
  return `${cleanWord}::${sentenceHash}`;
}

/**
 * Build unique composite cache key for sentence analysis.
 */
export function buildSentenceCacheKey(sentenceEn: string, targetLang: string = 'zh-CN'): string {
  const cleanSentence = (sentenceEn || '').trim().toLowerCase();
  return `${targetLang}::${hashSentence(cleanSentence)}`;
}

/**
 * Initialize word cache from chrome.storage.local if available.
 */
async function initWordCache(): Promise<void> {
  if (isWordInitialized) return;
  isWordInitialized = true;

  try {
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      const data = await new Promise<Record<string, WordExplanation> | null>((resolve) => {
        chrome.storage.local.get([STORAGE_KEY_WORD], (result) => {
          if (chrome.runtime?.lastError) {
            return resolve(null);
          }
          resolve(result?.[STORAGE_KEY_WORD] || null);
        });
      });

      if (data && typeof data === 'object') {
        const entries = Object.entries(data);
        const start = Math.max(0, entries.length - MAX_CACHE_ITEMS);
        for (let i = start; i < entries.length; i++) {
          const [k, v] = entries[i];
          if (k && v) {
            wordMemoryCache.set(k, v);
          }
        }
      }
    }
  } catch (err) {
    console.warn('[aiCache] Failed to load word cache from storage:', err);
  }
}

/**
 * Initialize sentence cache from chrome.storage.local if available.
 */
async function initSentenceCache(): Promise<void> {
  if (isSentenceInitialized) return;
  isSentenceInitialized = true;

  try {
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      const data = await new Promise<Record<string, SentenceDeepAnalysis> | null>((resolve) => {
        chrome.storage.local.get([STORAGE_KEY_SENTENCE], (result) => {
          if (chrome.runtime?.lastError) {
            return resolve(null);
          }
          resolve(result?.[STORAGE_KEY_SENTENCE] || null);
        });
      });

      if (data && typeof data === 'object') {
        const entries = Object.entries(data);
        const start = Math.max(0, entries.length - MAX_CACHE_ITEMS);
        for (let i = start; i < entries.length; i++) {
          const [k, v] = entries[i];
          if (k && v) {
            sentenceMemoryCache.set(k, v);
          }
        }
      }
    }
  } catch (err) {
    console.warn('[aiCache] Failed to load sentence cache from storage:', err);
  }
}

/**
 * Persist in-memory word cache to chrome.storage.local (debounced/throttled).
 */
let wordPersistTimer: number | NodeJS.Timeout | undefined = undefined;
function scheduleWordPersist(): void {
  if (typeof chrome === 'undefined' || !chrome?.storage?.local) return;

  clearTimeout(wordPersistTimer);
  wordPersistTimer = setTimeout(() => {
    try {
      const obj: Record<string, WordExplanation> = {};
      wordMemoryCache.forEach((v, k) => {
        obj[k] = v;
      });
      chrome.storage.local.set({ [STORAGE_KEY_WORD]: obj });
    } catch (e) {
      console.warn('[aiCache] Failed to persist word cache:', e);
    }
  }, 1000);
}

/**
 * Persist in-memory sentence cache to chrome.storage.local (debounced/throttled).
 */
let sentencePersistTimer: number | NodeJS.Timeout | undefined = undefined;
function scheduleSentencePersist(): void {
  if (typeof chrome === 'undefined' || !chrome?.storage?.local) return;

  clearTimeout(sentencePersistTimer);
  sentencePersistTimer = setTimeout(() => {
    try {
      const obj: Record<string, SentenceDeepAnalysis> = {};
      sentenceMemoryCache.forEach((v, k) => {
        obj[k] = v;
      });
      chrome.storage.local.set({ [STORAGE_KEY_SENTENCE]: obj });
    } catch (e) {
      console.warn('[aiCache] Failed to persist sentence cache:', e);
    }
  }, 1000);
}

/**
 * Retrieve cached word explanation if exists.
 */
export async function getWordExplanationCache(
  word: string,
  contextEn: string
): Promise<WordExplanation | null> {
  await initWordCache();
  const key = buildCacheKey(word, contextEn);

  if (wordMemoryCache.has(key)) {
    const val = wordMemoryCache.get(key)!;
    // Refresh LRU order (delete and re-insert)
    wordMemoryCache.delete(key);
    wordMemoryCache.set(key, val);
    return val;
  }
  return null;
}

/**
 * Save word explanation into LRU cache.
 */
export async function setWordExplanationCache(
  word: string,
  contextEn: string,
  explanation: WordExplanation
): Promise<void> {
  await initWordCache();
  const key = buildCacheKey(word, contextEn);

  if (wordMemoryCache.has(key)) {
    wordMemoryCache.delete(key);
  } else if (wordMemoryCache.size >= MAX_CACHE_ITEMS) {
    // Evict oldest entry
    const oldestKey = wordMemoryCache.keys().next().value;
    if (oldestKey) {
      wordMemoryCache.delete(oldestKey);
    }
  }

  wordMemoryCache.set(key, explanation);
  scheduleWordPersist();
}

/**
 * Clear the word cache entirely (useful for tests or reset).
 */
export async function clearWordExplanationCache(): Promise<void> {
  wordMemoryCache.clear();
  isWordInitialized = true;
  if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
    try {
      await chrome.storage.local.remove([STORAGE_KEY_WORD]);
    } catch {}
  }
}

/**
 * Retrieve cached sentence deep analysis if exists.
 */
export async function getSentenceAnalysisCache(
  sentenceEn: string,
  targetLang: string = 'zh-CN'
): Promise<SentenceDeepAnalysis | null> {
  await initSentenceCache();
  const key = buildSentenceCacheKey(sentenceEn, targetLang);

  if (sentenceMemoryCache.has(key)) {
    const val = sentenceMemoryCache.get(key)!;
    // Refresh LRU order
    sentenceMemoryCache.delete(key);
    sentenceMemoryCache.set(key, val);
    return val;
  }
  return null;
}

/**
 * Save sentence deep analysis into LRU cache.
 */
export async function setSentenceAnalysisCache(
  sentenceEn: string,
  analysis: SentenceDeepAnalysis,
  targetLang: string = 'zh-CN'
): Promise<void> {
  await initSentenceCache();
  const key = buildSentenceCacheKey(sentenceEn, targetLang);

  if (sentenceMemoryCache.has(key)) {
    sentenceMemoryCache.delete(key);
  } else if (sentenceMemoryCache.size >= MAX_CACHE_ITEMS) {
    const oldestKey = sentenceMemoryCache.keys().next().value;
    if (oldestKey) {
      sentenceMemoryCache.delete(oldestKey);
    }
  }

  sentenceMemoryCache.set(key, analysis);
  scheduleSentencePersist();
}

/**
 * Clear the sentence analysis cache entirely (useful for tests or reset).
 */
export async function clearSentenceAnalysisCache(): Promise<void> {
  sentenceMemoryCache.clear();
  isSentenceInitialized = true;
  if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
    try {
      await chrome.storage.local.remove([STORAGE_KEY_SENTENCE]);
    } catch {}
  }
}
