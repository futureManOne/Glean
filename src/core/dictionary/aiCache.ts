import { WordExplanation } from '@/types';

const MAX_CACHE_ITEMS = 500;
const STORAGE_KEY = 'lr_ai_word_cache_v1';

// In-memory cache for synchronous 0ms hits
const memoryCache = new Map<string, WordExplanation>();
let isInitialized = false;

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
 * Build unique composite cache key.
 */
export function buildCacheKey(word: string, contextEn: string): string {
  const cleanWord = (word || '').trim().toLowerCase();
  const sentenceHash = hashSentence(contextEn);
  return `${cleanWord}::${sentenceHash}`;
}

/**
 * Initialize cache from chrome.storage.local if available.
 */
async function initCache(): Promise<void> {
  if (isInitialized) return;
  isInitialized = true;

  try {
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      const data = await new Promise<Record<string, WordExplanation> | null>((resolve) => {
        chrome.storage.local.get([STORAGE_KEY], (result) => {
          if (chrome.runtime?.lastError) {
            return resolve(null);
          }
          resolve(result?.[STORAGE_KEY] || null);
        });
      });

      if (data && typeof data === 'object') {
        const entries = Object.entries(data);
        // Only load the most recent MAX_CACHE_ITEMS entries
        const start = Math.max(0, entries.length - MAX_CACHE_ITEMS);
        for (let i = start; i < entries.length; i++) {
          const [k, v] = entries[i];
          if (k && v) {
            memoryCache.set(k, v);
          }
        }
      }
    }
  } catch (err) {
    console.warn('[aiCache] Failed to load cache from storage:', err);
  }
}

/**
 * Persist in-memory cache to chrome.storage.local (debounced/throttled).
 */
let persistTimer: any = null;
function schedulePersist(): void {
  if (typeof chrome === 'undefined' || !chrome?.storage?.local) return;

  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      const obj: Record<string, WordExplanation> = {};
      memoryCache.forEach((v, k) => {
        obj[k] = v;
      });
      chrome.storage.local.set({ [STORAGE_KEY]: obj });
    } catch (e) {
      console.warn('[aiCache] Failed to persist cache:', e);
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
  await initCache();
  const key = buildCacheKey(word, contextEn);

  if (memoryCache.has(key)) {
    const val = memoryCache.get(key)!;
    // Refresh LRU order (delete and re-insert)
    memoryCache.delete(key);
    memoryCache.set(key, val);
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
  await initCache();
  const key = buildCacheKey(word, contextEn);

  if (memoryCache.has(key)) {
    memoryCache.delete(key);
  } else if (memoryCache.size >= MAX_CACHE_ITEMS) {
    // Evict oldest entry
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey) {
      memoryCache.delete(oldestKey);
    }
  }

  memoryCache.set(key, explanation);
  schedulePersist();
}

/**
 * Clear the cache entirely (useful for tests or reset).
 */
export async function clearWordExplanationCache(): Promise<void> {
  memoryCache.clear();
  isInitialized = true;
  if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
    try {
      await chrome.storage.local.remove([STORAGE_KEY]);
    } catch (_) {}
  }
}
