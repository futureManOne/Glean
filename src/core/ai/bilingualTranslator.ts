import { SubtitleCue, AI_PRESETS } from '@/types';
import { useAppStore } from '@/store/useAppStore';
import { callLlmChat } from '@/core/api/llmClient';
import { isValidSubtitleText } from '@/core/subtitle/parser';
import { mixedGlossGenerator } from './mixedGlossGenerator';
import { PriorityBatchQueue } from './priorityBatchQueue';

export interface TranslationItem {
  id: number;
  textZh: string;
}

export interface BatchTranslationProgress {
  total: number;
  completed: number;
  percent: number;
  isRunning: boolean;
  mode?: 'both' | 'mixed';
  error?: string;
}

/**
 * Detect the primary language of subtitle cues or sample text.
 * Returns 'zh' if predominantly CJK characters, 'en' if predominantly English, or 'other'.
 */
export function detectSourceLanguage(cuesOrText: Array<{ textEn?: string; textZh?: string }> | string): 'zh' | 'en' | 'other' {
  let sample = '';
  if (typeof cuesOrText === 'string') {
    sample = cuesOrText;
  } else if (Array.isArray(cuesOrText) && cuesOrText.length > 0) {
    sample = cuesOrText.slice(0, 20).map(c => c.textEn || c.textZh || '').join(' ');
  }
  if (!sample) return 'en';

  const cjkChars = (sample.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const englishWords = (sample.match(/[a-zA-Z]{2,}/g) || []).length;

  if (cjkChars >= 10 && englishWords === 0) {
    return 'zh';
  }
  if (cjkChars > englishWords * 3 && cjkChars >= 15) {
    return 'zh';
  }
  return 'en';
}

/**
 * Intelligently resolve the target translation language and description based on source language
 * and user configured secondary language.
 *
 * Core Rule:
 * 1. If source is Chinese ('zh') and target is 'auto' or Chinese ('zh-CN', 'zh-TW', 'zh'),
 *    automatically translate to English ('en')!
 * 2. If source is English ('en') and target is 'en', automatically translate to Simplified Chinese ('zh-CN')!
 * 3. Otherwise, translate to user's selected language.
 */
export function resolveTargetLanguage(
  sourceLang: 'zh' | 'en' | 'other',
  configuredLang?: string
): { code: string; desc: string; isSourceZh: boolean } {
  const conf = (configuredLang || 'auto').trim();
  const isSourceZh = sourceLang === 'zh';

  if (isSourceZh) {
    // If source is Chinese and user configured auto or Chinese, intelligently translate to English!
    if (conf === 'auto' || conf.startsWith('zh')) {
      return { code: 'en', desc: 'natural, fluent, and idiomatic conversational English (地道自然口语英语)', isSourceZh: true };
    }
    if (conf === 'ja') return { code: 'ja', desc: '自然な会話調の日本語', isSourceZh: true };
    if (conf === 'ko') return { code: 'ko', desc: '자연스러운 구어체 한국어', isSourceZh: true };
    if (conf === 'fr') return { code: 'fr', desc: 'français naturel et fluide', isSourceZh: true };
    if (conf === 'de') return { code: 'de', desc: 'natürliches und flüssiges Deutsch', isSourceZh: true };
    if (conf === 'es') return { code: 'es', desc: 'español natural y conversacional', isSourceZh: true };
    if (conf === 'ru') return { code: 'ru', desc: 'естественный разговорный русский язык', isSourceZh: true };
    return { code: conf, desc: 'natural, fluent, and idiomatic conversational English', isSourceZh: true };
  } else {
    // Source is English or other foreign language
    if (conf === 'en') {
      return { code: 'zh-CN', desc: '自然流畅、贴合语境的简体中文', isSourceZh: false };
    }
    if (conf === 'zh-TW') {
      return { code: 'zh-TW', desc: '自然流暢、貼合語境的繁體中文', isSourceZh: false };
    }
    if (conf === 'ja') return { code: 'ja', desc: '自然な会話調の日本語', isSourceZh: false };
    if (conf === 'ko') return { code: 'ko', desc: '자연스러운 구어体 한국어', isSourceZh: false };
    if (conf === 'fr') return { code: 'fr', desc: 'français naturel et fluide', isSourceZh: false };
    if (conf === 'de') return { code: 'de', desc: 'natürliches und flüssiges Deutsch', isSourceZh: false };
    if (conf === 'es') return { code: 'es', desc: 'español natural y conversacional', isSourceZh: false };
    if (conf === 'ru') return { code: 'ru', desc: 'естественный разговорный русский язык', isSourceZh: false };
    return { code: 'zh-CN', desc: '自然流畅、贴合语境的简体中文', isSourceZh: false };
  }
}

/**
 * Check whether a text cue is eligible for translation.
 * Ensures Chinese text is valid for translating to English (or other targets),
 * while preserving standard English-to-Chinese validation rules.
 */
export function isEligibleForTranslation(textEn: string, targetLangCode?: string): boolean {
  if (!textEn || !isValidSubtitleText(textEn)) return false;
  const hasEnglishWords = /[a-zA-Z]{2,}/.test(textEn);
  const cjkChars = (textEn.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;

  // When target is explicitly English (or non-Chinese), Chinese text is eligible
  if (targetLangCode === 'en' || (targetLangCode && !targetLangCode.startsWith('zh'))) {
    if (cjkChars > 0) return true;
    return hasEnglishWords;
  }

  // Default behavior (English to Chinese translation)
  if (cjkChars > 0 && !hasEnglishWords) return false;
  if (cjkChars > textEn.length / 2) return false;
  return hasEnglishWords;
}

/**
 * Intelligent Sliding Window Bilingual Translator
 *
 * Automatically checks whether an API key is configured. If configured and a video's official
 * subtitles lack translation (e.g. English ASR without Chinese, or Chinese audio without English),
 * it fetches translations asynchronously around the current playback head without blocking playback.
 */
export class BilingualTranslator {
  private inFlightIds = new Set<number>();
  private cache = new Map<string, string>(); // normalized textEn -> textZh
  private failedAttempts = new Map<number, { count: number; lastTime: number }>();
  private isTranslating = false;
  private maxBatchSize = 10;

  /**
   * Check whether user has configured an API key in settings
   */
  public canTranslate(): boolean {
    const settings = useAppStore.getState().settings;
    return Boolean(settings && settings.apiKey && settings.apiKey.trim().length > 0);
  }

  /**
   * Normalize text for cache lookup
   */
  public normalizeKey(text: string): string {
    return (text || '').toLowerCase().replace(/[^\w\s\u4e00-\u9fff]/g, '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Translate a batch of subtitle cues using the configured LLM.
   * Returns a list of { id, textZh } updates.
   */
  public async translateBatch(cues: Array<{ id: number; textEn: string }>): Promise<TranslationItem[]> {
    if (!cues || cues.length === 0) return [];
    if (!this.canTranslate()) return [];

    const settings = useAppStore.getState().settings;
    const sourceLang = detectSourceLanguage(cues);
    const { code: targetCode, desc: targetLangDesc, isSourceZh } = resolveTargetLanguage(sourceLang, settings.secondaryLang);

    const provider = settings.aiProvider || 'google';
    const defaultBaseUrl = AI_PRESETS[provider]?.apiBaseUrl || AI_PRESETS.google.apiBaseUrl;
    const defaultModel = AI_PRESETS[provider]?.modelName || AI_PRESETS.google.modelName;

    const eligibleCues = cues.filter(c => isEligibleForTranslation(c.textEn, targetCode));
    if (eligibleCues.length === 0) return [];

    const promptItems = eligibleCues.map(c => ({ id: c.id, textEn: c.textEn }));

    const systemPrompt = isSourceZh
      ? `You are a professional subtitle translator and native bilingual speaker.
Translate the following Chinese video subtitle sentences into ${targetLangDesc}.
Output natural, idiomatic, spoken English matching conversational sitcom/dialogue tone. Do not add notes, markdown, explanations, or commentary.
CRITICAL: You MUST preserve the exact original "id" integer for each item. Do NOT renumber or start from 1. If an input item has id 35, your output object MUST have id 35.
Output ONLY a valid JSON object with key "translations" containing an array of objects with keys "id" and "textZh", e.g.:
{
  "translations": [
    { "id": 1, "textZh": "Natural English translation here" }
  ]
}`
      : `You are a professional subtitle translator and native bilingual speaker.
Translate the following video subtitle sentences into natural, accurate, and conversational ${targetLangDesc}.
Match conversational sitcom dialogue tone. Do not add notes, markdown, or commentary.
CRITICAL: You MUST preserve the exact original "id" integer for each item. Do NOT renumber or start from 1. If an input item has id 35, your output object MUST have id 35.
Output ONLY a valid JSON object with key "translations" containing an array of objects with keys "id" and "textZh", e.g.:
{
  "translations": [
    { "id": 1, "textZh": "翻译内容" }
  ]
}`;

    const userPrompt = JSON.stringify(promptItems);

    let retries = 0;
    const maxRetries = 0;
    while (retries <= maxRetries) {
      try {
        const response = await callLlmChat(
          {
            apiBaseUrl: settings.apiBaseUrl || defaultBaseUrl,
            apiKey: settings.apiKey,
            modelName: settings.modelName || defaultModel,
            // Hard upper bound: subtitles must never wait longer than 20 seconds.
            timeoutMs: 20000
          },
          {
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: 0.3,
            responseFormatJson: true
          }
        );

        return this.parseTranslationResponse(response, cues, targetCode);
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        const isContextInvalidated = /extension context invalidated/i.test(errMsg);
        if (isContextInvalidated) {
          console.warn('[BilingualTranslator] Extension context invalidated; applying silent fallback.');
          return [];
        }
        if (retries < maxRetries) {
          retries++;
          await new Promise(r => setTimeout(r, 600));
          continue;
        }
        console.warn('[BilingualTranslator] Translation batch request failed:', err);
        return [];
      }
    }
    return [];
  }

  /**
   * Parse LLM JSON translation response with multi-level fallback,
   * resilient formatting cleaning, and automatic ID alignment.
   */
  public parseTranslationResponse(
    response: string,
    requestedCues: Array<{ id: number; textEn: string }>,
    targetCode = 'zh-CN'
  ): TranslationItem[] {
    if (!response || typeof response !== 'string' || !requestedCues || requestedCues.length === 0) {
      return [];
    }

    // 1. Clean thinking / thought blocks (DeepSeek R1, Grok reasoning)
    let cleaned = response
      .replace(/<\s*(?:think|thought)[\s\S]*?<\/\s*(?:think|thought)\s*>/gi, '')
      .replace(/^<\s*(?:think|thought)[\s\S]*?(?:<\/|$)/i, '')
      .trim();

    // 2. Clean markdown code fences (```json ... ``` or ``` ... ```)
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) {
      cleaned = fenceMatch[1].trim();
    } else {
      cleaned = cleaned.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    }

    // 3. Locate outermost JSON object { ... } or array [ ... ]
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
    }

    // 4. Clean trailing commas: ,\s*([}\]]) -> $1
    let prev = '';
    while (cleaned !== prev) {
      prev = cleaned;
      cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
    }

    // 5. Parse JSON with smart quote normalization fallback
    let parsed: any = null;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Normalize smart quotes to standard quotes
      let normalized = cleaned
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
        .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");

      prev = '';
      while (normalized !== prev) {
        prev = normalized;
        normalized = normalized.replace(/,\s*([}\]])/g, '$1');
      }

      try {
        parsed = JSON.parse(normalized);
      } catch (e) {
        console.warn('[BilingualTranslator] Failed to parse translation JSON:', e);
        return [];
      }
    }

    if (!parsed) return [];

    // 6. Extract raw items from multi-level structure:
    let rawItems: any[] = [];
    const requestedIdSet = new Set<number>(requestedCues.map(c => c.id));

    if (Array.isArray(parsed)) {
      rawItems = parsed;
    } else if (typeof parsed === 'object') {
      let container =
        parsed.translations ??
        parsed.subtitles ??
        parsed.cues ??
        parsed.items ??
        parsed.data ??
        parsed.results ??
        parsed.result;

      // Handle nested container e.g. { data: { translations: [...] } }
      if (container && typeof container === 'object' && !Array.isArray(container)) {
        const nested =
          container.translations ??
          container.subtitles ??
          container.cues ??
          container.items ??
          container.data;
        if (nested) {
          container = nested;
        }
      }

      if (Array.isArray(container)) {
        rawItems = container;
      } else if (container && typeof container === 'object') {
        // Container is a dictionary: { translations: { "35": "..." } }
        rawItems = Object.entries(container).map(([k, v]) => {
          if (typeof v === 'string') {
            return { id: k, textZh: v };
          } else if (v && typeof v === 'object') {
            return { id: (v as any).id ?? k, ...(v as any) };
          }
          return { id: k, textZh: String(v) };
        });
      } else if (
        'id' in parsed &&
        ('textZh' in parsed ||
          'translation' in parsed ||
          'text_zh' in parsed ||
          'chinese' in parsed ||
          'english' in parsed ||
          'zh' in parsed ||
          'en' in parsed ||
          'text' in parsed ||
          'targetText' in parsed)
      ) {
        // Single object
        rawItems = [parsed];
      } else {
        // Check if root is a key-value dictionary: { "35": "翻译内容" } or { "35": { "textZh": "..." } }
        const entries = Object.entries(parsed).filter(
          ([k]) => k !== 'total' && k !== 'success' && k !== 'status' && k !== 'error' && k !== 'code'
        );
        const isDict =
          entries.length > 0 &&
          entries.every(([k]) => {
            const num = Number(k);
            return (!isNaN(num) && Number.isFinite(num)) || requestedIdSet.has(num);
          });

        if (isDict) {
          rawItems = entries.map(([k, v]) => {
            if (typeof v === 'string') {
              return { id: k, textZh: v };
            } else if (v && typeof v === 'object') {
              return { id: (v as any).id ?? k, ...(v as any) };
            }
            return { id: k, textZh: String(v) };
          });
        }
      }
    }

    if (rawItems.length === 0) return [];

    // 7. Helper to extract translation text across supported key aliases
    const extractText = (item: any): string => {
      if (typeof item === 'string') return item.trim();
      if (!item || typeof item !== 'object') return '';
      const val =
        item.textZh ||
        item.translation ||
        item.text_zh ||
        item.english ||
        item.chinese ||
        item.zh ||
        item.en ||
        item.text ||
        item.targetText ||
        '';
      return typeof val === 'string' ? val.trim() : String(val || '').trim();
    };

    // 8. Positional alignment and ID resolution
    const requestedIdMap = new Map<number, { id: number; textEn: string }>();
    requestedCues.forEach(c => requestedIdMap.set(c.id, c));

    const returnedIds: number[] = rawItems.map(it => {
      if (it && typeof it === 'object' && it.id !== undefined && it.id !== null) {
        const n = Number(it.id);
        return isNaN(n) ? NaN : n;
      }
      return NaN;
    });

    const validIdMatches = returnedIds.filter(id => !isNaN(id) && requestedIdMap.has(id)).length;
    const isOneToN = rawItems.length > 0 && returnedIds.every((id, idx) => id === idx + 1);
    const isZeroToN = rawItems.length > 0 && returnedIds.every((id, idx) => id === idx);
    const reqIsOneToN = requestedCues.length > 0 && requestedCues.every((c, idx) => c.id === idx + 1);
    const reqIsZeroToN = requestedCues.length > 0 && requestedCues.every((c, idx) => c.id === idx);

    const isReindexed = (isOneToN && !reqIsOneToN) || (isZeroToN && !reqIsZeroToN);

    const results: TranslationItem[] = [];

    for (let i = 0; i < rawItems.length; i++) {
      const item = rawItems[i];
      const textZh = extractText(item);
      if (!textZh) continue;

      let targetCue: { id: number; textEn: string } | undefined;

      // Rule A: If IDs were re-indexed fall back to positional index
      if (isReindexed || validIdMatches === 0) {
        if (i < requestedCues.length) {
          targetCue = requestedCues[i];
        }
      }

      // Rule B: Match by explicit ID if it exists in requestedCues
      if (!targetCue && item && typeof item === 'object' && item.id !== undefined && item.id !== null) {
        const idNum = Number(item.id);
        if (!isNaN(idNum) && requestedIdMap.has(idNum)) {
          targetCue = requestedIdMap.get(idNum);
        }
      }

      // Rule C: Match by original text if returned in payload
      if (!targetCue && item && typeof item === 'object') {
        const sourceText = item.textEn || item.english || item.source || item.original || item.sourceText;
        if (sourceText && typeof sourceText === 'string') {
          const normSource = this.normalizeKey(sourceText);
          targetCue = requestedCues.find(c => this.normalizeKey(c.textEn) === normSource);
        }
      }

      // Rule D: Fallback to positional alignment if still unresolved
      if (!targetCue && i < requestedCues.length) {
        targetCue = requestedCues[i];
      }

      if (targetCue) {
        // Anti-echo protection: If source was Chinese and target is English, do not accept identical Chinese echo
        const sourceIsZh = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(targetCue.textEn);
        const outputIsZh = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(textZh);
        if (sourceIsZh && targetCode === 'en' && outputIsZh && textZh.trim() === targetCue.textEn.trim()) {
          console.warn('[BilingualTranslator] Skipping echoed identical Chinese text from LLM:', textZh);
          continue;
        }

        results.push({ id: targetCue.id, textZh });
        if (targetCue.textEn) {
          const norm = this.normalizeKey(targetCue.textEn);
          this.cache.set(norm, textZh);
          this.cache.set(`${targetCode}:${norm}`, textZh);
        }
      }
    }

    return results;
  }

  /**
   * Schedule sliding-window translation around the current playback position.
   * Looks at window [currentCueIndex - 2, currentCueIndex + 12].
   * If any cues are missing translations or have not been AI-refined, requests them in batches.
   */
  public async scheduleSlidingWindowTranslation(currentTime: number, windowRadius = 12): Promise<void> {
    if (!this.canTranslate()) return;
    if (this.isTranslating) return;

    const subtitleMode = useAppStore.getState().settings.subtitleMode;
    if (subtitleMode === 'mixed') {
      return mixedGlossGenerator.translateWindowMixed(currentTime, Math.min(windowRadius, 6));
    }

    const { cues, settings, isAdPlaying, isLoadingSentenceAnalysis, isStreamingAnalysis } = useAppStore.getState();
    if (isAdPlaying || !cues || cues.length === 0 || isLoadingSentenceAnalysis || isStreamingAnalysis) return;

    const sourceLang = detectSourceLanguage(cues);
    const { code: targetCode } = resolveTargetLanguage(sourceLang, settings.secondaryLang);

    // Check if any cues still lack AI-refined translation or have duplicated echo
    const isCueNeedsTranslation = (c: SubtitleCue) => {
      if (!c.textEn || !isEligibleForTranslation(c.textEn, targetCode)) return false;
      if (!c.isAiRefined) return true;
      if (!c.textZh) return true;
      if (c.textZh.trim() === c.textEn.trim()) return true;
      return false;
    };

    const missingCount = cues.filter(isCueNeedsTranslation).length;
    if (missingCount === 0) return;

    // Find current or closest cue index
    let currentIdx = cues.findIndex(c => currentTime >= c.start && currentTime <= c.end);
    if (currentIdx === -1) {
      currentIdx = cues.findIndex(c => c.start >= currentTime);
      if (currentIdx === -1) currentIdx = 0;
    }

    const startIdx = Math.max(0, currentIdx - 2);
    const endIdx = Math.min(cues.length, currentIdx + windowRadius);

    const candidates: Array<{ id: number; textEn: string }> = [];
    const cachedUpdates: TranslationItem[] = [];

    for (let i = startIdx; i < endIdx; i++) {
      const cue = cues[i];
      if (isCueNeedsTranslation(cue)) {
        // Check cache first
        const normKey = `${targetCode}:${this.normalizeKey(cue.textEn)}`;
        if (this.cache.has(normKey)) {
          cachedUpdates.push({ id: cue.id, textZh: this.cache.get(normKey)! });
        } else if (!this.inFlightIds.has(cue.id)) {
          const failRecord = this.failedAttempts.get(cue.id);
          const now = Date.now();
          const backoffMs = failRecord ? Math.min(8000 * Math.pow(1.5, Math.min(failRecord.count - 1, 4)), 60000) : 0;
          if (!failRecord || now - failRecord.lastTime > backoffMs) {
            candidates.push({ id: cue.id, textEn: cue.textEn });
          }
        }
      }
    }

    // Apply any cached results immediately
    if (cachedUpdates.length > 0) {
      useAppStore.getState().updateCueTranslations(cachedUpdates);
    }

    if (candidates.length === 0) return;

    // Limit batch size to maxBatchSize
    const batch = candidates.slice(0, this.maxBatchSize);
    for (const item of batch) {
      this.inFlightIds.add(item.id);
    }

    this.isTranslating = true;
    try {
      const results = await this.translateBatch(batch);
      if (results.length > 0) {
        useAppStore.getState().updateCueTranslations(results);
        for (const res of results) {
          this.failedAttempts.delete(res.id);
        }
      } else {
        const now = Date.now();
        for (const item of batch) {
          const prevAttempt = this.failedAttempts.get(item.id) || { count: 0, lastTime: 0 };
          this.failedAttempts.set(item.id, { count: prevAttempt.count + 1, lastTime: now });
        }
      }
    } finally {
      for (const item of batch) {
        this.inFlightIds.delete(item.id);
      }
      this.isTranslating = false;
    }
  }

  private isBatchTranslating = false;
  private abortBatch = false;
  private batchProgress: BatchTranslationProgress = { total: 0, completed: 0, percent: 0, isRunning: false };
  private batchListeners = new Set<(progress: BatchTranslationProgress) => void>();
  private currentFocusTime: number = 0;
  private wakeUpDelay: (() => void) | null = null;

  /**
   * Notify translator of user seeking/jumping playback position.
   * Interrupts polite inter-batch delay and causes the next popped batch
   * to immediately prioritize the newly focused playback position.
   */
  public notifyPlaybackSeek(newTime: number): void {
    this.currentFocusTime = Math.max(0, newTime);
    if (this.wakeUpDelay) {
      this.wakeUpDelay();
      this.wakeUpDelay = null;
    }
    mixedGlossGenerator.notifyPlaybackSeek(newTime);
  }

  public addBatchListener(listener: (p: BatchTranslationProgress) => void) {
    this.batchListeners.add(listener);
    listener(this.batchProgress);
    return () => {
      this.batchListeners.delete(listener);
    };
  }

  private notifyProgress() {
    for (const listener of this.batchListeners) {
      try {
        listener({ ...this.batchProgress });
      } catch (_) {}
    }
  }

  public getBatchProgress(): BatchTranslationProgress {
    return { ...this.batchProgress };
  }

  public updateBatchProgress(progress: BatchTranslationProgress): void {
    this.batchProgress = { ...progress };
    this.notifyProgress();
  }

  public cancelBatchTranslation(): void {
    this.abortBatch = true;
    this.isBatchTranslating = false;
    mixedGlossGenerator.cancelBatchTranslation();
    this.batchProgress = {
      ...this.batchProgress,
      isRunning: false
    };
    this.notifyProgress();
  }

  /**
   * Batch translate the entire video's subtitles upfront or on user demand.
   * In 'mixed' mode, performs AI Fine Translation with semantic phrase annotation.
   * In 'both' or other modes, translates sentences into natural target language (English if source is Chinese).
   */
  public async translateEntireVideo(
    cues?: SubtitleCue[],
    onProgress?: (progress: BatchTranslationProgress) => void,
    forceAll: boolean = false,
    startFromTime?: number
  ): Promise<boolean> {
    if (!this.canTranslate()) {
      return false;
    }

    if (this.isBatchTranslating || mixedGlossGenerator.isBatchTranslating) {
      return false;
    }

    const initialTime = typeof startFromTime === 'number'
      ? startFromTime
      : (useAppStore.getState().currentTime || 0);
    this.currentFocusTime = initialTime;

    const subtitleMode = useAppStore.getState().settings.subtitleMode;
    if (subtitleMode === 'mixed') {
      return mixedGlossGenerator.translateEntireVideoMixed(cues, (p) => {
        this.batchProgress = { ...p };
        this.notifyProgress();
        onProgress?.(p);
      }, forceAll, initialTime);
    }

    const allCues = cues || useAppStore.getState().cues;
    if (!allCues || allCues.length === 0) return false;

    const settings = useAppStore.getState().settings;
    const sourceLang = detectSourceLanguage(allCues);
    const { code: targetCode } = resolveTargetLanguage(sourceLang, settings.secondaryLang);

    // Filter cues that lack translation, have not been AI-refined, or have duplicate echo
    const isCueNeedsTranslation = (c: SubtitleCue) => {
      if (!c.textEn || !isEligibleForTranslation(c.textEn, targetCode)) return false;
      if (forceAll) return true;
      if (!c.isAiRefined) return true;
      if (!c.textZh) return true;
      if (c.textZh.trim() === c.textEn.trim()) return true;
      return false;
    };

    const eligible = allCues.filter(c => Boolean(c.textEn) && isEligibleForTranslation(c.textEn, targetCode));
    const untranslated = forceAll
      ? eligible
      : eligible.filter(isCueNeedsTranslation);

    if (untranslated.length === 0) {
      this.batchProgress = { total: allCues.length, completed: allCues.length, percent: 100, isRunning: false, mode: 'both' };
      onProgress?.(this.batchProgress);
      this.notifyProgress();
      return true;
    }

    this.isBatchTranslating = true;
    this.abortBatch = false;
    this.batchProgress = {
      total: untranslated.length,
      completed: 0,
      percent: 0,
      isRunning: true,
      mode: 'both'
    };
    onProgress?.(this.batchProgress);
    this.notifyProgress();

    const chunkSize = 6;
    let completedCount = 0;
    const queue = new PriorityBatchQueue(untranslated);

    try {
      while (queue.hasRemaining()) {
        if (this.abortBatch) {
          console.log('[BilingualTranslator] Batch translation aborted by user.');
          break;
        }

        const chunk = queue.popNextBatch(this.currentFocusTime, chunkSize);
        if (chunk.length === 0) break;

        const toFetch: Array<{ id: number; textEn: string }> = [];
        const cachedResults: TranslationItem[] = [];

        for (const item of chunk) {
          const normKey = `${targetCode}:${this.normalizeKey(item.textEn)}`;
          if (this.cache.has(normKey)) {
            cachedResults.push({ id: item.id, textZh: this.cache.get(normKey)! });
          } else {
            toFetch.push({ id: item.id, textEn: item.textEn });
          }
        }

        if (cachedResults.length > 0) {
          useAppStore.getState().updateCueTranslations(cachedResults);
        }

        let fetchedCount = 0;
        if (toFetch.length > 0) {
          const results = await this.translateBatch(toFetch);
          if (this.abortBatch) break;
          if (results && results.length > 0) {
            useAppStore.getState().updateCueTranslations(results);
            fetchedCount = results.length;
          }
        }

        const batchCompleted = cachedResults.length + fetchedCount;
        completedCount += batchCompleted;
        const currentCompleted = Math.min(completedCount, untranslated.length);
        const percent = Math.round((currentCompleted / untranslated.length) * 100);

        this.batchProgress = {
          total: untranslated.length,
          completed: currentCompleted,
          percent,
          isRunning: true,
          mode: 'both'
        };
        onProgress?.(this.batchProgress);
        this.notifyProgress();

        // Interruptible delay between chunks to be polite to API rate limits
        if (queue.hasRemaining() && !this.abortBatch) {
          await new Promise<void>(res => {
            const timer = setTimeout(() => {
              this.wakeUpDelay = null;
              res();
            }, 200);
            this.wakeUpDelay = () => {
              clearTimeout(timer);
              res();
            };
          });
        }
      }

      this.batchProgress = {
        ...this.batchProgress,
        completed: completedCount,
        percent: untranslated.length > 0 ? Math.round((completedCount / untranslated.length) * 100) : 100,
        isRunning: false
      };
      onProgress?.(this.batchProgress);
      this.notifyProgress();
      return completedCount > 0;
    } catch (err: any) {
      console.warn('[BilingualTranslator] Batch translation error:', err);
      this.batchProgress = {
        ...this.batchProgress,
        isRunning: false,
        error: err?.message || 'Translation error'
      };
      onProgress?.(this.batchProgress);
      this.notifyProgress();
      return false;
    } finally {
      this.isBatchTranslating = false;
      this.wakeUpDelay = null;
    }
  }

  /**
   * Clear in-flight states and translation cache (e.g. on video change)
   */
  public reset(): void {
    this.inFlightIds.clear();
    this.cache.clear();
    this.failedAttempts.clear();
    this.isTranslating = false;
    this.wakeUpDelay = null;
    this.currentFocusTime = 0;
    this.cancelBatchTranslation();
  }
}

export const bilingualTranslator = new BilingualTranslator();
