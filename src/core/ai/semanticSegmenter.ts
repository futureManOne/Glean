import { SubtitleCue, AppSettings, AI_PRESETS } from '@/types';
import { useAppStore } from '@/store/useAppStore';
import { callLlmChat } from '@/core/api/llmClient';
import { isValidSubtitleText, segmentCuesLocally } from '@/core/subtitle/parser';

export { segmentCuesLocally };

export interface TimedWord {
  raw: string;
  norm: string;
  cueIndex: number;
  cueStart: number;
  cueEnd: number;
  wordStart: number;
  wordEnd: number;
}

/**
 * System prompt instructing the LLM to segment speech stream into complete,
 * grammatically coherent sentences, restoring casing and punctuation while
 * preserving speech vocabulary intact. The LLM is explicitly forbidden from
 * generating timestamps.
 */
export const SEGMENTATION_SYSTEM_PROMPT = `You are an expert linguistic speech segmentation and punctuation restoration assistant.
Your task is to take unpunctuated or fragmented speech transcript and segment it into COMPLETE, MEANINGFUL GRAMMATICAL SENTENCES.

Rules:
1. Complete grammatical sentences: Keep main clauses and subordinate clauses (adverbial clauses, relative clauses, noun clauses, condition/concession) together in a single coherent sentence. NEVER mechanically slice or chop sentences based on word count.
2. Vocabulary fidelity: Keep the original spoken words intact. Do NOT paraphrase, summarize, omit words, or insert new vocabulary.
3. Punctuation & Casing: Restore natural capitalization (proper nouns, beginnings of sentences) and appropriate sentence terminators ('.', '?', '!'), as well as natural commas inside complex sentences.
4. Timestamps: Do NOT output any timestamps or time codes.
5. Output format: Output ONLY a valid JSON object with key "sentences" containing an array of strings.
Example:
{
  "sentences": [
    "While energy is fresh, it tells me to film everything first and then move on to phase two.",
    "And that gives me momentum."
  ]
}`;

/**
 * Extract tokens/words from text in any language (English, CJK, etc.).
 */
export function extractTokensFromText(text: string): string[] {
  if (!text) return [];
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const isCjk = /[\u4e00-\u9fa5\u3040-\u30ff\u3400-\u4dbf]/.test(text);
    const lang = isCjk ? 'zh' : 'en';
    const segmenter = new Intl.Segmenter(lang, { granularity: 'word' });
    return Array.from(segmenter.segment(text))
      .filter(s => s.isWordLike || /[\p{L}\p{N}]/u.test(s.segment))
      .map(s => s.segment.trim())
      .filter(Boolean);
  }
  return text.trim().split(/\s+/).filter(Boolean);
}

/**
 * Normalize word for robust acoustic timeline alignment.
 * Strips surrounding punctuation, apostrophes, and symbols while preserving
 * letters and numbers across all languages (Unicode-aware).
 */
export function normalizeWordForAlignment(word: string): string {
  if (!word) return '';
  return word
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * Extract word-level stream with interpolated acoustic timestamps from ASR cues.
 * The first word of each cue anchors to cue.start, and the last word anchors to cue.end.
 */
export function extractTimedWords(cues: SubtitleCue[]): TimedWord[] {
  if (!cues || cues.length === 0) return [];
  const words: TimedWord[] = [];

  for (let cIdx = 0; cIdx < cues.length; cIdx++) {
    const cue = cues[cIdx];
    const text = (cue.textEn || cue.textZh || '').trim();
    if (!text) continue;

    const rawTokens = extractTokensFromText(text);
    if (rawTokens.length === 0) continue;

    const duration = Math.max(0.1, cue.end - cue.start);
    const count = rawTokens.length;

    for (let wIdx = 0; wIdx < count; wIdx++) {
      const raw = rawTokens[wIdx];
      const norm = normalizeWordForAlignment(raw);
      if (!norm) continue;

      const wordStart = wIdx === 0 ? cue.start : cue.start + (wIdx / count) * duration;
      const wordEnd = wIdx === count - 1 ? cue.end : cue.start + ((wIdx + 1) / count) * duration;

      words.push({
        raw,
        norm,
        cueIndex: cIdx,
        cueStart: cue.start,
        cueEnd: cue.end,
        wordStart: Math.round(wordStart * 1000) / 1000,
        wordEnd: Math.round(wordEnd * 1000) / 1000
      });
    }
  }

  return words;
}

/**
 * R2. Acoustic Timestamp Anchoring & Word-Level Alignment
 *
 * Maps the first word of each AI-segmented sentence to the start time of the corresponding
 * original ASR cue, and the last word to the end time of the concluding ASR cue.
 * Ensures 100% acoustic synchronization with zero cumulative timestamp drift or hallucination.
 * Guarantees valid, strictly monotonic start and end timestamps matching original speech duration.
 */
export function alignSentencesToAcousticTimestamps(
  aiSentences: string[],
  originalCues: SubtitleCue[]
): SubtitleCue[] {
  if (!aiSentences || aiSentences.length === 0) {
    return originalCues || [];
  }
  if (!originalCues || originalCues.length === 0) {
    return [];
  }

  const timedWords = extractTimedWords(originalCues);
  if (timedWords.length === 0) {
    return originalCues;
  }

  const cleanSentences = aiSentences
    .map(s => (typeof s === 'string' ? s.trim() : ''))
    .filter(s => s.length > 0);

  if (cleanSentences.length === 0) {
    return originalCues;
  }

  const alignedCues: SubtitleCue[] = [];
  let cursor = 0;
  const totalTimedWords = timedWords.length;
  const maxSpeechEnd = originalCues[originalCues.length - 1].end;

  for (let sIdx = 0; sIdx < cleanSentences.length; sIdx++) {
    // If we have already consumed the entire timed words stream, ignore any extra hallucinated sentences
    if (cursor >= totalTimedWords) {
      break;
    }

    const sentenceText = cleanSentences[sIdx];
    const rawTokens = extractTokensFromText(sentenceText);
    const normTokens = rawTokens.map(normalizeWordForAlignment).filter(Boolean);

    if (normTokens.length === 0) continue;

    const firstWord = normTokens[0];
    const lastWord = normTokens[normTokens.length - 1];
    const secondLastWord = normTokens.length >= 2 ? normTokens[normTokens.length - 2] : '';

    // 1. Locate start index in timed word stream with forward lookahead window
    let matchStartIdx = -1;
    const searchLimit = Math.min(totalTimedWords, cursor + 30);

    for (let i = cursor; i < searchLimit; i++) {
      if (timedWords[i].norm === firstWord) {
        matchStartIdx = i;
        break;
      }
    }

    // Secondary check: if first word omitted or changed, check second word
    if (matchStartIdx === -1 && normTokens.length >= 2) {
      const secondWord = normTokens[1];
      for (let i = cursor; i < searchLimit - 1; i++) {
        if (timedWords[i + 1].norm === secondWord) {
          matchStartIdx = i;
          break;
        }
      }
    }

    if (matchStartIdx === -1) {
      // Fuzzy search for longer words (length >= 3) to prevent false positives on single-letter words
      for (let i = cursor; i < searchLimit; i++) {
        const tn = timedWords[i].norm;
        if (
          (firstWord.length >= 3 && tn.startsWith(firstWord)) ||
          (tn.length >= 3 && firstWord.startsWith(tn))
        ) {
          matchStartIdx = i;
          break;
        }
      }
    }

    if (matchStartIdx === -1) {
      matchStartIdx = Math.min(cursor, totalTimedWords - 1);
    }

    // 2. Locate end index in timed word stream
    // Choose candidate that is CLOSEST to expectedEndOffset to prevent jumping into subsequent sentences
    const expectedEndOffset = matchStartIdx + normTokens.length - 1;
    const endSearchStart = Math.max(matchStartIdx, expectedEndOffset - 6);
    const endSearchLimit = Math.min(totalTimedWords, expectedEndOffset + 8);

    let matchEndIdx = -1;
    let bestScore = Infinity;

    for (let i = endSearchStart; i < endSearchLimit; i++) {
      if (timedWords[i].norm === lastWord) {
        let dist = Math.abs(i - expectedEndOffset);
        // Bonus if preceding word also matches secondLastWord
        if (secondLastWord && i > matchStartIdx && timedWords[i - 1]?.norm === secondLastWord) {
          dist -= 10;
        }
        if (dist < bestScore) {
          bestScore = dist;
          matchEndIdx = i;
        }
      }
    }

    if (matchEndIdx === -1) {
      matchEndIdx = Math.min(totalTimedWords - 1, Math.max(matchStartIdx, expectedEndOffset));
    }

    // Guard: ensure matchEndIdx is at or after matchStartIdx
    if (matchEndIdx < matchStartIdx) {
      matchEndIdx = matchStartIdx;
    }

    // If this is the last AI sentence, anchor end to the very end of the timed word stream
    if (sIdx === cleanSentences.length - 1) {
      matchEndIdx = totalTimedWords - 1;
    }

    const startWord = timedWords[matchStartIdx];
    const endWord = timedWords[matchEndIdx];

    // Acoustic Anchoring (R2):
    // First word anchors to cueStart if at start of cue, or wordStart
    const rawStart = matchStartIdx === 0 || startWord.wordStart === startWord.cueStart
      ? startWord.cueStart
      : startWord.wordStart;

    // Last word anchors to cueEnd if at end of cue, or wordEnd
    const rawEnd = matchEndIdx === totalTimedWords - 1 || endWord.wordEnd === endWord.cueEnd
      ? endWord.cueEnd
      : endWord.wordEnd;

    // Strict non-overlapping monotonic timeline guarantees
    let finalStart = rawStart;
    if (alignedCues.length > 0) {
      const prevCue = alignedCues[alignedCues.length - 1];
      if (finalStart < prevCue.end) {
        finalStart = prevCue.end;
      }
    }

    let finalEnd = Math.max(finalStart + 0.2, rawEnd);
    if (sIdx === cleanSentences.length - 1 && originalCues.length > 0) {
      if (maxSpeechEnd > finalStart) {
        finalEnd = Math.max(finalEnd, maxSpeechEnd);
      }
    }

    // Clamp finalEnd to not exceed speech duration unless single cue
    if (finalEnd > maxSpeechEnd && maxSpeechEnd > finalStart) {
      finalEnd = maxSpeechEnd;
    }

    // Preserve any existing Chinese translations associated with original cues in this range
    const startCueIdx = startWord.cueIndex;
    const endCueIdx = endWord.cueIndex;
    const zhParts: string[] = [];
    for (let c = startCueIdx; c <= endCueIdx && c < originalCues.length; c++) {
      const zh = (originalCues[c].textZh || '').trim();
      if (zh && !zhParts.includes(zh)) {
        zhParts.push(zh);
      }
    }
    const mergedZh = zhParts.join('');

    alignedCues.push({
      id: alignedCues.length + 1,
      start: Math.round(finalStart * 1000) / 1000,
      end: Math.round(finalEnd * 1000) / 1000,
      textEn: sentenceText,
      textZh: mergedZh
    });

    cursor = matchEndIdx + 1;
  }

  // Sanity check: Ensure final cue terminates at the original speech stream end
  if (alignedCues.length > 0 && originalCues.length > 0) {
    const origLastEnd = originalCues[originalCues.length - 1].end;
    const lastAligned = alignedCues[alignedCues.length - 1];
    if (origLastEnd > lastAligned.start && lastAligned.end < origLastEnd) {
      lastAligned.end = origLastEnd;
    }
  }

  return alignedCues;
}


/**
 * Robust zero-failure JSON parser for AI segmentation responses.
 */
export function parseSegmentationResponse(raw: string): string[] {
  if (!raw || typeof raw !== 'string') return [];

  // 1. Remove thinking / thought blocks (DeepSeek R1, Grok reasoning)
  let cleaned = raw
    .replace(/<\s*(?:think|thought)[\s\S]*?<\/\s*(?:think|thought)\s*>/gi, '')
    .replace(/^<\s*(?:think|thought)[\s\S]*?(?:<\/|$)/i, '')
    .trim();

  // 2. Extract markdown code fence (```json ... ``` or ``` ... ```)
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  } else {
    cleaned = cleaned.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  }

  // 3. Locate outermost JSON structure
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');

  if (firstBrace !== -1 && lastBrace > firstBrace) {
    if (firstBracket !== -1 && firstBracket < firstBrace && lastBracket > lastBrace) {
      cleaned = cleaned.substring(firstBracket, lastBracket + 1);
    } else {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }
  } else if (firstBracket !== -1 && lastBracket > firstBracket) {
    cleaned = cleaned.substring(firstBracket, lastBracket + 1);
  }

  // 4. Remove trailing commas
  let prev = '';
  while (cleaned !== prev) {
    prev = cleaned;
    cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
  }

  let parsed: any = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Lenient smart quote recovery
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
    } catch {
      return [];
    }
  }

  if (!parsed) return [];

  // Extract string array
  let sentenceList: string[] = [];
  if (Array.isArray(parsed)) {
    sentenceList = parsed.map(s => (typeof s === 'string' ? s : String(s || '')));
  } else if (typeof parsed === 'object') {
    const list = parsed.sentences || parsed.cues || parsed.items || parsed.results || parsed.data;
    if (Array.isArray(list)) {
      sentenceList = list.map(s => (typeof s === 'string' ? s : String(s || '')));
    }
  }

  return sentenceList.map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * R1, R3, R4. AI Semantic Sentence Segmentation Engine
 *
 * Implements:
 * - Chunked batching (300~500 words per chunk or full transcript)
 * - Acoustic boundary mapping without LLM timestamp hallucination
 * - 50-sentence LRU cache
 * - In-flight deduplication
 * - Defensive fallback to local rule-based segmentation on network/syntax failure
 */
export class SemanticSentenceSegmenter {
  private inFlightKeys = new Set<string>();
  private lruCache = new Map<string, string[]>(); // normalizedChunk -> sentences
  private maxCacheSize = 50;

  public canSegment(): boolean {
    const settings = useAppStore.getState().settings;
    return Boolean(settings && settings.apiKey && settings.apiKey.trim().length > 0);
  }

  public getCacheSize(): number {
    return this.lruCache.size;
  }

  public clearCache(): void {
    this.lruCache.clear();
    this.inFlightKeys.clear();
  }

  /**
   * Fast normalized chunk key for caching and in-flight tracking (Unicode-aware)
   */
  public getChunkKey(text: string): string {
    return (text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Split a large set of ASR cues into chunks of 300~500 words at natural pauses.
   */
  public partitionCuesIntoChunks(cues: SubtitleCue[], targetWordLimit = 400): SubtitleCue[][] {
    if (!cues || cues.length === 0) return [];
    const countWordsOrTokens = (t: string) => {
      if (!t) return 0;
      const cjkChars = (t.match(/[\u4e00-\u9fa5\u3040-\u30ff\u3400-\u4dbf]/g) || []).length;
      const nonCjk = t.replace(/[\u4e00-\u9fa5\u3040-\u30ff\u3400-\u4dbf]/g, ' ');
      const nonCjkWords = (nonCjk.trim().match(/\S+/g) || []).length;
      return cjkChars + nonCjkWords;
    };

    const totalWords = cues.reduce((sum, c) => sum + countWordsOrTokens(c.textEn || c.textZh), 0);
    if (totalWords <= 500) {
      return [cues];
    }

    const chunks: SubtitleCue[][] = [];
    let currentChunk: SubtitleCue[] = [];
    let currentWordCount = 0;

    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      const words = countWordsOrTokens(cue.textEn || cue.textZh);
      currentChunk.push(cue);
      currentWordCount += words;

      const nextCue = cues[i + 1];
      const gap = nextCue ? nextCue.start - cue.end : 0;
      const isPause = gap >= 0.4;

      if (currentWordCount >= 300 && (isPause || currentWordCount >= targetWordLimit || i === cues.length - 1)) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentWordCount = 0;
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  /**
   * Segment a single chunk of cues with AI, falling back defensively to local segmentation.
   */
  public async segmentChunk(chunkCues: SubtitleCue[]): Promise<SubtitleCue[]> {
    if (!chunkCues || chunkCues.length === 0) return [];

    const rawTranscript = chunkCues
      .map(c => (c.textEn || c.textZh || '').trim())
      .filter(Boolean)
      .join(' ');

    const chunkKey = this.getChunkKey(rawTranscript);

    // 1. Check LRU Cache
    if (this.lruCache.has(chunkKey)) {
      const cachedSentences = this.lruCache.get(chunkKey)!;
      // Re-insert to maintain LRU order
      this.lruCache.delete(chunkKey);
      this.lruCache.set(chunkKey, cachedSentences);
      return alignSentencesToAcousticTimestamps(cachedSentences, chunkCues);
    }

    // 2. Guard against duplicate in-flight requests
    if (this.inFlightKeys.has(chunkKey)) {
      return segmentCuesLocally(chunkCues);
    }

    if (!this.canSegment()) {
      return segmentCuesLocally(chunkCues);
    }

    this.inFlightKeys.add(chunkKey);

    const settings = useAppStore.getState().settings;
    const provider = settings.aiProvider || 'google';
    const defaultBaseUrl = AI_PRESETS[provider]?.apiBaseUrl || AI_PRESETS.google.apiBaseUrl;
    const defaultModel = AI_PRESETS[provider]?.modelName || AI_PRESETS.google.modelName;

    try {
      const response = await callLlmChat(
        {
          apiBaseUrl: settings.apiBaseUrl || defaultBaseUrl,
          apiKey: settings.apiKey,
          modelName: settings.modelName || defaultModel,
          timeoutMs: 20000
        },
        {
          messages: [
            { role: 'system', content: SEGMENTATION_SYSTEM_PROMPT },
            { role: 'user', content: rawTranscript }
          ],
          temperature: 0.2,
          responseFormatJson: true
        }
      );

      const sentences = parseSegmentationResponse(response);

      if (sentences.length > 0) {
        // Update LRU cache (capped at maxCacheSize)
        if (this.lruCache.size >= this.maxCacheSize) {
          const firstKey = this.lruCache.keys().next().value;
          if (firstKey) this.lruCache.delete(firstKey);
        }
        this.lruCache.set(chunkKey, sentences);

        return alignSentencesToAcousticTimestamps(sentences, chunkCues);
      } else {
        // AI returned invalid syntax or empty list -> Fall back to local segmentation
        return segmentCuesLocally(chunkCues);
      }
    } catch (err) {
      console.warn('[SemanticSegmenter] AI segmentation failed, falling back to local segmentation:', err);
      return segmentCuesLocally(chunkCues);
    } finally {
      this.inFlightKeys.delete(chunkKey);
    }
  }

  /**
   * Segment full transcript (handles chunking, alignment, and concatenation).
   */
  public async segmentTranscript(cues: SubtitleCue[]): Promise<SubtitleCue[]> {
    if (!cues || cues.length === 0) return [];
    if (cues.length === 1) return cues;

    if (!this.canSegment()) {
      return segmentCuesLocally(cues);
    }

    const chunks = this.partitionCuesIntoChunks(cues);
    const allAligned: SubtitleCue[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunkCues = chunks[i];
      const chunkResult = await this.segmentChunk(chunkCues);

      // Clamp monotonic start against previous chunk end
      for (const cue of chunkResult) {
        let start = cue.start;
        if (allAligned.length > 0) {
          const prev = allAligned[allAligned.length - 1];
          if (start < prev.end) {
            start = prev.end;
          }
        }
        const end = Math.max(start + 0.3, cue.end);
        allAligned.push({
          ...cue,
          id: allAligned.length + 1,
          start: Math.round(start * 1000) / 1000,
          end: Math.round(end * 1000) / 1000
        });
      }
    }

    return allAligned;
  }
}

export const semanticSegmenter = new SemanticSentenceSegmenter();
