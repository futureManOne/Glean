import { SubtitleCue, WordToken, AI_PRESETS, PhraseGlossItem, MixedGlossDensity } from '@/types';
import { useAppStore } from '@/store/useAppStore';
import { callLlmChat } from '@/core/api/llmClient';
import { normalizeWord, lookupLocalDict } from '@/core/dictionary/ecdictMini';
import { isValidSubtitleText } from '@/core/subtitle/parser';
import { detectSourceLanguage, type BatchTranslationProgress } from './bilingualTranslator';
import { PriorityBatchQueue } from './priorityBatchQueue';

/**
 * High-frequency trivial function/stop words that must NOT be glossed in mixed mode.
 * Includes: articles, basic prepositions, pronouns, be-verbs, auxiliary verbs, basic conjunctions.
 */
export const TRIVIAL_STOP_WORDS = new Set<string>([
  // Articles
  'a', 'an', 'the',
  // Basic prepositions
  'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'of', 'about', 'into', 'onto',
  'upon', 'over', 'under', 'above', 'below', 'as', 'than',
  // Pronouns & Possessives
  'i', 'me', 'my', 'mine', 'myself',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself',
  'she', 'her', 'hers', 'herself',
  'it', 'its', 'itself',
  'we', 'us', 'our', 'ours', 'ourselves',
  'they', 'them', 'their', 'theirs', 'themselves',
  'this', 'that', 'these', 'those',
  'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how',
  // Be-verbs & Basic Auxiliaries
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'done', 'doing',
  'have', 'has', 'had', 'having',
  'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',
  // Conjunctions & Discourse Markers
  'and', 'or', 'but', 'so', 'because', 'if', 'then', 'though', 'although', 'while', 'since',
  // Common trivial particles & conversational fillers
  'not', "n't", 'no', 'yes', 'yeah', 'yep', 'nope', 'oh', 'ok', 'okay', 'well', 'hey', 'hi', 'hello',
  'there', 'here', 'too', 'very', 'just', 'up', 'down', 'out', 'off', 'back', 'so', 'any', 'some', 'all',
  'like'
]);

/**
 * Check if a word token represents a trivial stop word that should be skipped.
 */
export function isTrivialStopWord(word: string): boolean {
  if (!word) return true;
  if (/[\u4e00-\u9fa5\u3400-\u4dbf]/.test(word)) {
    const cleanCjk = word.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').trim();
    return !cleanCjk;
  }
  const clean = word.toLowerCase().replace(/^[^\w']+|[^\w']+$/g, '').trim();
  if (!clean || clean.length <= 1) {
    // Single letters like 'a', 'i', or punctuation are always skipped
    return true;
  }
  return TRIVIAL_STOP_WORDS.has(clean);
}

/**
 * Extract a concise, clean Chinese definition (1-4 characters) from local dict translation string.
 * Strips bracketed lemma tags ([preload]), part of speech prefixes, and parenthetical notes.
 * Strictly requires authentic Chinese characters to prevent English substrings or grammar tags leaking.
 */
export function extractFirstDefinition(rawTrans: string): string {
  if (!rawTrans) return '';
  if (
    rawTrans.includes('暂无离线释义') ||
    rawTrans.includes('暂无本地释义') ||
    rawTrans.includes('无词义')
  ) {
    return '';
  }

  // Strip root hints e.g. "(词根: preload)" or "（词根: preload）"
  const cleaned = rawTrans
    .replace(/[（(]词根:.*?[）)]/g, '')
    .trim();

  // Split into candidate chunks by comma, semicolon, newline, or slash
  const chunks = cleaned.split(/[\n，,；;、/]/).map(c => c.trim()).filter(Boolean);

  let fallbackGrammarMeaning = '';

  for (const chunk of chunks) {
    // Strip bracketed lemma e.g. "[preload]", "【计算机】"
    const candidate = chunk
      .replace(/\[[a-zA-Z0-9_\s'-]+\]/g, '')
      .replace(/【.*?】/g, '')
      // Remove part of speech prefixes like "n.", "v.", "adj.", "adv.", "vt./vi.", etc.
      .replace(/^[a-z./\s]+\.\s*/i, '')
      // Strip parenthetical notes e.g. "（用于...）", "(尤指...)"
      .replace(/[（(].*?[）)]/g, '')
      .trim();

    // Check for Chinese characters
    const hanMatch = candidate.match(/[\u4e00-\u9fa5]+/g);
    if (!hanMatch) continue;

    const pureChinese = hanMatch.join('');
    if (!pureChinese) continue;

    // Check if this chunk is a grammatical inflection label like "preload的过去式和过去分词", "复数", "现在分词"
    const grammarLabelMatch = candidate.match(/(?:过去式|过去分词|现在分词|单三|复数|第三人称|比较级|最高级)/);
    if (grammarLabelMatch) {
      if (!fallbackGrammarMeaning) {
        fallbackGrammarMeaning = grammarLabelMatch[0];
      }
      continue;
    }

    // Found real lexical meaning! Keep concise (up to 6 characters)
    return pureChinese.slice(0, 6);
  }

  return fallbackGrammarMeaning || '';
}

/**
 * Fallback to local dictionary for content words when AI is offline or loading.
 * Guards against placeholders (e.g. '暂无离线释义') and leaks.
 */
export function fallbackLocalGloss(token: WordToken): string | undefined {
  if (!token.isWord) return undefined;
  const lemma = token.lemma || normalizeWord(token.text);
  if (isTrivialStopWord(lemma)) return undefined;

  const dictEntry = lookupLocalDict(lemma || token.text);
  if (dictEntry && dictEntry.trans) {
    if (
      dictEntry.trans.startsWith('暂无离线释义') ||
      dictEntry.trans.includes('暂无本地释义')
    ) {
      return undefined;
    }
    const gloss = extractFirstDefinition(dictEntry.trans);
    if (gloss && gloss.length > 0) return gloss;
  }
  return undefined;
}

const FIXED_COLLOCATION_SUFFIXES: Record<string, string> = {
  'a lot': 'of',
  'a bit': 'of',
  'a couple': 'of',
  'a number': 'of',
  'a variety': 'of',
  'a series': 'of',
  'a kind': 'of',
  'a sort': 'of',
  'lots': 'of',
  'in front': 'of',
  'as well': 'as',
  'as long': 'as',
  'as soon': 'as',
  'as far': 'as',
  'out': 'of',
  'instead': 'of',
  'because': 'of',
  'in addition': 'to',
  'in terms': 'of',
  'in order': 'to',
  'in case': 'of',
  'in spite': 'of',
  'on top': 'of',
  'due': 'to',
  'such': 'as',
  'get used': 'to',
  'getting used': 'to',
  'look forward': 'to',
  'looking forward': 'to',
  'run out': 'of',
  'running out': 'of',
  'take care': 'of',
  'taking care': 'of',
  'according': 'to',
  'thanks': 'to',
  'prior': 'to',
  'regardless': 'of'
};

const FIXED_COLLOCATION_PREFIXES: Record<string, string> = {
  'lot of': 'a',
  'bit of': 'a',
  'couple of': 'a',
  'number of': 'a',
  'variety of': 'a',
  'series of': 'a',
  'kind of': 'a',
  'sort of': 'a',
  'front of': 'in',
  'well as': 'as',
  'long as': 'as',
  'soon as': 'as',
  'far as': 'as',
  'addition to': 'in',
  'order to': 'in',
  'terms of': 'in',
  'case of': 'in',
  'spite of': 'in',
  'top of': 'on',
  'forward to': 'look',
  'used to': 'get',
  'rid of': 'get',
  'care of': 'take'
};

const SURROUNDED_COLLOCATION_MAP: Record<string, { prev: string; next: string; full: string }> = {
  'lot': { prev: 'a', next: 'of', full: 'a lot of' },
  'bit': { prev: 'a', next: 'of', full: 'a bit of' },
  'couple': { prev: 'a', next: 'of', full: 'a couple of' },
  'number': { prev: 'a', next: 'of', full: 'a number of' },
  'variety': { prev: 'a', next: 'of', full: 'a variety of' },
  'series': { prev: 'a', next: 'of', full: 'a series of' },
  'kind': { prev: 'a', next: 'of', full: 'a kind of' },
  'sort': { prev: 'a', next: 'of', full: 'a sort of' },
  'front': { prev: 'in', next: 'of', full: 'in front of' },
  'well': { prev: 'as', next: 'as', full: 'as well as' },
  'long': { prev: 'as', next: 'as', full: 'as long as' },
  'soon': { prev: 'as', next: 'as', full: 'as soon as' },
  'far': { prev: 'as', next: 'as', full: 'as far as' },
  'addition': { prev: 'in', next: 'to', full: 'in addition to' },
  'order': { prev: 'in', next: 'to', full: 'in order to' },
  'terms': { prev: 'in', next: 'of', full: 'in terms of' },
  'case': { prev: 'in', next: 'of', full: 'in case of' },
  'spite': { prev: 'in', next: 'of', full: 'in spite of' },
  'top': { prev: 'on', next: 'of', full: 'on top of' },
  'forward': { prev: 'look', next: 'to', full: 'look forward to' },
  'rid': { prev: 'get', next: 'of', full: 'get rid of' }
};

const TERMINAL_PUNCTUATION_REGEX = /[.?!;:,—\n\r"“”]/;

/**
 * Check whether any non-word tokens between startIdx and endIdx contain sentence or clause delimiters.
 */
function hasDelimiterBetween(tokens: WordToken[], startIdx: number, endIdx: number): boolean {
  for (let i = startIdx + 1; i < endIdx; i++) {
    if (TERMINAL_PUNCTUATION_REGEX.test(tokens[i].text)) {
      return true;
    }
  }
  return false;
}

/**
 * Clean and normalize a word or contraction token for resilient comparison.
 * Normalizes typographical apostrophes (`’`, `‘`, `ʼ`, `ʻ`, `` ` ``) to ASCII `'`.
 */
export function normalizeWordForMatching(str: string): string {
  return (str || '')
    .toLowerCase()
    .replace(/[’‘ʼʻ`]/g, "'")
    .replace(/^[^\w']+|[^\w']+$/g, '')
    .replace(/^'+|'+$/g, '')
    .trim();
}

/**
 * Compare token text and lemma against target phrase word with apostrophe/contraction resilience.
 */
export function matchWord(tStr: string, lStr: string, target: string): boolean {
  const tNorm = normalizeWordForMatching(tStr);
  const lNorm = normalizeWordForMatching(lStr);
  const targetNorm = normalizeWordForMatching(target);

  if (tNorm === targetNorm || lNorm === targetNorm) return true;

  // Fallback: match contractions where apostrophe is omitted in one form (e.g. dont <-> don't, its <-> it's)
  const tNoApos = tNorm.replace(/'/g, '');
  const lNoApos = lNorm.replace(/'/g, '');
  const targetNoApos = targetNorm.replace(/'/g, '');
  if (targetNoApos.length >= 2 && (tNoApos === targetNoApos || lNoApos === targetNoApos)) {
    return true;
  }

  return false;
}

/**
 * Accurately match and map multi-word or single-word phrases onto the token sequence.
 * Tags phrase tokens with: phraseId, phraseText, phraseMeaning, isKeyPhrase, isPhraseStart, isPhraseEnd.
 * Ensures composite phrases like "a lot of" are matched as a whole semantic chunk.
 * Only the end token carries phraseMeaning and contextMeaning; leading words have no brackets.
 * When key phrases are present, clears mechanical offline glosses from non-phrase tokens.
 */
export function applyPhraseAnnotationsToTokens(
  tokens: WordToken[],
  phrases: PhraseGlossItem[]
): WordToken[] {
  if (!tokens || tokens.length === 0) return tokens || [];
  if (!phrases || phrases.length === 0) {
    return tokens.map(t => (!t.isKeyPhrase && t.contextMeaning ? { ...t, contextMeaning: undefined } : t));
  }

  // Clone tokens and reset any existing phrase markers so re-annotating cleanly re-evaluates
  const result: WordToken[] = tokens.map(t => ({
    ...t,
    phraseId: undefined,
    phraseText: undefined,
    phraseMeaning: undefined,
    isKeyPhrase: undefined,
    isPhraseStart: undefined,
    isPhraseEnd: undefined,
    contextMeaning: t.isKeyPhrase ? undefined : t.contextMeaning
  }));

  // Collect indices of all actual word tokens
  const wordIndices: number[] = [];
  for (let i = 0; i < result.length; i++) {
    if (result[i].isWord) {
      wordIndices.push(i);
    }
  }

  // Helper to calculate word count of candidate phrase
  const getPhraseWordCount = (item: PhraseGlossItem) => {
    if (!item || typeof item.phrase !== 'string') return 0;
    return item.phrase
      .trim()
      .replace(/[’‘ʼʻ`]/g, "'")
      .split(/[\s\-–—]+/)
      .map(w => w.replace(/^[^\w']+|[^\w']+$/g, '').replace(/^'+|'+$/g, '').trim())
      .filter(Boolean).length;
  };

  // Sort candidate phrases so longer multi-word phrases take precedence over shorter sub-phrases
  // (e.g. "look forward to" is evaluated before "forward to", and "image generation tutorials" before "image generation")
  const sortedPhrases = [...phrases].sort((a, b) => {
    const countA = getPhraseWordCount(a);
    const countB = getPhraseWordCount(b);
    if (countB !== countA) return countB - countA;
    return (b.phrase?.length || 0) - (a.phrase?.length || 0);
  });

  let phraseCounter = 0;

  for (const item of sortedPhrases) {
    if (!item || typeof item.phrase !== 'string' || typeof item.meaning !== 'string') continue;
    let phraseStr = item.phrase
      .trim()
      .replace(/^["'“”‘’`(\[{<]+|["'“”‘’`),.;:!?\]}>]+$/g, '')
      .trim();
    const meaningStr = item.meaning.trim().slice(0, 60);
    if (!phraseStr || !meaningStr) continue;

    // CJK Phrase Matching (Chinese dialogue in Chinese-primary video)
    const hasCjk = /[\u4e00-\u9fa5\u3400-\u4dbf]/.test(phraseStr);
    if (hasCjk) {
      const clean = (s: string) => (s || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
      const pClean = clean(phraseStr);
      if (!pClean) continue;

      for (let i = 0; i < result.length; i++) {
        if (result[i].isKeyPhrase) continue;
        if (clean(result[i].text).length === 0) continue;

        let accum = '';
        for (let j = i; j < result.length; j++) {
          if (result[j].isKeyPhrase) break;
          // Do not span across major terminal punctuation
          if (j > i && /[.?!;:\n\r。？！；：]/.test(result[j - 1].text)) break;

          accum += clean(result[j].text);
          if (accum === pClean) {
            phraseCounter++;
            const phraseId = `p-${phraseCounter}-${Math.random().toString(36).slice(2, 7)}`;
            for (let k = i; k <= j; k++) {
              result[k] = {
                ...result[k],
                isWord: true,
                isKeyPhrase: true,
                phraseId,
                phraseText: phraseStr,
                isPhraseStart: (k === i),
                isPhraseEnd: (k === j),
                phraseMeaning: (k === j ? meaningStr : undefined),
                contextMeaning: (k === j ? meaningStr : undefined)
              };
            }
            break;
          }
          if (accum.length > pClean.length) break;
        }
      }
      continue;
    }

    // Split phrase into cleaned words (support spaces, hyphens, dashes, and apostrophes)
    const pWords = phraseStr
      .toLowerCase()
      .replace(/[’‘ʼʻ`]/g, "'")
      .split(/[\s\-–—]+/)
      .map(w => w.replace(/^[^\w']+|[^\w']+$/g, '').replace(/^'+|'+$/g, '').trim())
      .filter(Boolean);

    if (pWords.length === 0) continue;

    // Slide across wordIndices and annotate ALL non-overlapping occurrences in the sentence
    let searchStart = 0;
    while (searchStart <= wordIndices.length - pWords.length) {
      let matchedStartWordPos = -1;
      let matchedWordCount = pWords.length;

      for (let w = searchStart; w <= wordIndices.length - pWords.length; w++) {
        // Avoid overlapping with already matched phrases
        let hasOverlap = false;
        for (let k = 0; k < pWords.length; k++) {
          if (result[wordIndices[w + k]].isKeyPhrase) {
            hasOverlap = true;
            break;
          }
        }
        if (hasOverlap) continue;

        let isMatch = true;
        for (let k = 0; k < pWords.length; k++) {
          // Words within the phrase must not span across sentence/clause delimiters (.,!?;: etc.)
          if (k > 0) {
            const prevTokenIdx = wordIndices[w + k - 1];
            const currTokenIdx = wordIndices[w + k];
            if (hasDelimiterBetween(result, prevTokenIdx, currTokenIdx)) {
              isMatch = false;
              break;
            }
          }

          const token = result[wordIndices[w + k]];
          const target = pWords[k];

          if (!matchWord(token.text, token.lemma || '', target)) {
            isMatch = false;
            break;
          }
        }

        if (isMatch) {
          matchedStartWordPos = w;
          break;
        }
      }

      if (matchedStartWordPos === -1) {
        break; // No more matches for this phrase in the sentence
      }

      let currentPhraseText = phraseStr;

      // 1. Check for trailing preposition/collocation expansion (e.g. "a lot" followed by "of" -> "a lot of")
      const joined = pWords.join(' ');
      if (FIXED_COLLOCATION_SUFFIXES[joined]) {
        const expectedNext = FIXED_COLLOCATION_SUFFIXES[joined];
        const nextWordPos = matchedStartWordPos + matchedWordCount;
        if (nextWordPos < wordIndices.length) {
          const lastTokenIdx = wordIndices[matchedStartWordPos + matchedWordCount - 1];
          const nextTokenIdx = wordIndices[nextWordPos];
          if (!hasDelimiterBetween(result, lastTokenIdx, nextTokenIdx)) {
            const nextToken = result[nextTokenIdx];
            if (matchWord(nextToken.text, nextToken.lemma || '', expectedNext) && !nextToken.isKeyPhrase) {
              matchedWordCount++;
              currentPhraseText = `${currentPhraseText} ${nextToken.text}`;
            }
          }
        }
      }

      // 2. Check for leading article/preposition collocation expansion (e.g. "lot of" preceded by "a" -> "a lot of", "front of" preceded by "in" -> "in front of")
      if (FIXED_COLLOCATION_PREFIXES[joined] && matchedStartWordPos > 0) {
        const expectedPrev = FIXED_COLLOCATION_PREFIXES[joined];
        const prevTokenIdx = wordIndices[matchedStartWordPos - 1];
        const startTokenIdx = wordIndices[matchedStartWordPos];
        if (!hasDelimiterBetween(result, prevTokenIdx, startTokenIdx)) {
          const prevToken = result[prevTokenIdx];
          if (matchWord(prevToken.text, prevToken.lemma || '', expectedPrev) && !prevToken.isKeyPhrase) {
            matchedStartWordPos--;
            matchedWordCount++;
            currentPhraseText = `${prevToken.text} ${currentPhraseText}`;
          }
        }
      }

      // 3. Surrounded single-word collocation expansion (e.g. "front" preceded by "in" and followed by "of" -> "in front of")
      if (SURROUNDED_COLLOCATION_MAP[joined] && matchedStartWordPos > 0 && matchedStartWordPos + 1 < wordIndices.length) {
        const rule = SURROUNDED_COLLOCATION_MAP[joined];
        const prevTokenIdx = wordIndices[matchedStartWordPos - 1];
        const currTokenIdx = wordIndices[matchedStartWordPos];
        const nextTokenIdx = wordIndices[matchedStartWordPos + 1];
        if (!hasDelimiterBetween(result, prevTokenIdx, currTokenIdx) && !hasDelimiterBetween(result, currTokenIdx, nextTokenIdx)) {
          const prevToken = result[prevTokenIdx];
          const nextToken = result[nextTokenIdx];
          if (
            matchWord(prevToken.text, prevToken.lemma || '', rule.prev) &&
            matchWord(nextToken.text, nextToken.lemma || '', rule.next) &&
            !prevToken.isKeyPhrase &&
            !nextToken.isKeyPhrase
          ) {
            matchedStartWordPos--;
            matchedWordCount += 2;
            currentPhraseText = rule.full;
          }
        }
      }

      phraseCounter++;
      const phraseId = `p-${phraseCounter}-${Math.random().toString(36).slice(2, 7)}`;
      const startIdx = wordIndices[matchedStartWordPos];
      const endIdx = wordIndices[matchedStartWordPos + matchedWordCount - 1];

      for (let k = 0; k < matchedWordCount; k++) {
        const tIdx = wordIndices[matchedStartWordPos + k];
        const isStart = (tIdx === startIdx);
        const isEnd = (tIdx === endIdx);

        result[tIdx] = {
          ...result[tIdx],
          phraseId,
          phraseText: currentPhraseText,
          phraseMeaning: isEnd ? meaningStr : undefined,
          isKeyPhrase: true,
          isPhraseStart: isStart,
          isPhraseEnd: isEnd,
          contextMeaning: isEnd ? meaningStr : undefined
        };
      }

      // Advance search cursor beyond matched span
      searchStart = matchedStartWordPos + matchedWordCount;
    }
  }

  // Thoroughly purge offline mechanical dictionary glosses from all non-phrase tokens
  // to prevent mixed old/new glosses (e.g. "tutorials(个别指导)")
  for (let i = 0; i < result.length; i++) {
    if (!result[i].isKeyPhrase && result[i].contextMeaning) {
      result[i] = {
        ...result[i],
        contextMeaning: undefined
      };
    }
  }

  return result;
}

/**
 * Parse LLM JSON response for mixed translation containing both textZh and key phrases.
 */
export function parseMixedTranslationResponse(
  response: string,
  requestedCues: Array<{ id: number; textEn: string }>
): Array<{ id: number; textZh: string; phrases: PhraseGlossItem[] }> {
  if (!response || typeof response !== 'string' || !requestedCues || requestedCues.length === 0) {
    return [];
  }

  // 1. Clean reasoning blocks
  let cleaned = response
    .replace(/<\s*(?:think|thought)[\s\S]*?<\/\s*(?:think|thought)\s*>/gi, '')
    .replace(/^<\s*(?:think|thought)[\s\S]*?(?:<\/|$)/i, '')
    .trim();

  // 2. Clean markdown code fences
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  } else {
    cleaned = cleaned.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  }

  // 3. Locate outermost JSON object or array
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    if (lastBrace > firstBrace) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }
  } else if (firstBracket !== -1 && lastBracket > firstBracket) {
    cleaned = cleaned.substring(firstBracket, lastBracket + 1);
  }

  // Clean trailing commas
  let prev = '';
  while (cleaned !== prev) {
    prev = cleaned;
    cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
  }

  let parsed: any = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    let normalized = cleaned
      .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
      .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");
    try {
      parsed = JSON.parse(normalized);
    } catch (e) {
      console.warn('[MixedGlossGenerator] Failed to parse JSON response:', e);
      return [];
    }
  }

  if (!parsed) return [];

  let rawItems: any[] = [];
  if (Array.isArray(parsed)) {
    rawItems = parsed;
  } else if (typeof parsed === 'object') {
    const container =
      parsed.results ??
      parsed.translations ??
      parsed.items ??
      parsed.cues ??
      parsed.data ??
      parsed.result;
    if (Array.isArray(container)) {
      rawItems = container;
    } else {
      rawItems = [parsed];
    }
  }

  const requestedIdMap = new Map<number, { id: number; textEn: string }>();
  requestedCues.forEach(c => requestedIdMap.set(c.id, c));

  const results: Array<{ id: number; textZh: string; phrases: PhraseGlossItem[] }> = [];

  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i];
    if (!item || typeof item !== 'object') continue;

    let targetId: number | undefined;
    if (item.id !== undefined && item.id !== null) {
      const n = Number(item.id);
      if (!isNaN(n) && requestedIdMap.has(n)) {
        targetId = n;
      }
    }

    if (targetId === undefined && i < requestedCues.length) {
      targetId = requestedCues[i].id;
    }

    if (targetId === undefined) continue;

    const textZh = typeof item.textZh === 'string'
      ? item.textZh.trim()
      : typeof item.translation === 'string'
      ? item.translation.trim()
      : '';

    const phrases: PhraseGlossItem[] = [];
    const rawPhrases = item.phrases || item.glosses || item.words || item.chunks || [];
    if (Array.isArray(rawPhrases)) {
      for (const p of rawPhrases) {
        if (!p || typeof p !== 'object') continue;
        const phrase = typeof p.phrase === 'string'
          ? p.phrase.trim()
          : typeof p.word === 'string'
          ? p.word.trim()
          : '';
        const meaning = typeof p.meaning === 'string'
          ? p.meaning.trim()
          : typeof p.en === 'string'
          ? p.en.trim()
          : typeof p.translation === 'string'
          ? p.translation.trim()
          : typeof p.zh === 'string'
          ? p.zh.trim()
          : '';

        if (phrase && meaning && !isTrivialStopWord(phrase.toLowerCase())) {
          phrases.push({ phrase, meaning });
        }
      }
    }

    results.push({
      id: targetId,
      textZh,
      phrases
    });
  }

  return results;
}

/**
 * Construct system prompt for AI Mixed Fine-Translation according to source language and annotation density.
 * - 'low': 1-2 essential phrases/words per sentence (focused on rare/high-difficulty idioms).
 * - 'medium': 2-4 key phrases/words per sentence (balanced for natural immersion).
 * - 'high': 4-8+ phrases/words per sentence (intensive coverage of all substantive nouns, verbs, adjectives, idioms).
 */
export function buildMixedTranslationPrompt(isSourceZh: boolean, density: MixedGlossDensity = 'medium'): string {
  if (isSourceZh) {
    let densityRule = '';
    if (density === 'low') {
      densityRule = 'Keep the number of annotated phrases minimal and focused: ONLY 1 to 2 essential advanced idioms, slang, or specialized domain chunks per sentence. Leave basic or common expressions unannotated.';
    } else if (density === 'high') {
      densityRule = 'Maximize translation coverage: annotate 4 to 8+ phrases, chunks, and key content words per sentence. Annotate as many substantive expressions, terms, and conversational phrases as possible so learners receive comprehensive bilingual coverage.';
    } else {
      densityRule = 'Keep the number of annotated phrases balanced: 2 to 4 key expressive chunks, technical/domain terms, colloquial phrases, or idioms per sentence.';
    }

    return `You are a world-class bilingual subtitle translator and English learning specialist.
The user is watching a Chinese video to learn authentic, conversational English in a "Mixed Chinese-English" immersion format (以中文台词为主，在中文关键短语与重点词后拓展高价值地道英文内容，辅助掌握地道英文口语表达).

For each subtitle cue:
1. "textZh": Provide a natural, fluent, and idiomatic full-sentence English translation (地道流利的完整英语翻译).
2. "phrases": Identify key expressive chunks, technical/domain terms, colloquial phrases, or idioms in the CHINESE sentence.
   - "phrase": The exact continuous Chinese phrase, idiom, or chunk AS IT APPEARS in the sentence (e.g. "数据看板", "不用你写1行代码", "统统给你搞定", "深度研究报告", "竞品调研", "省大量时间").
   - "meaning": The authentic, idiomatic, natural spoken English translation for this phrase/chunk (1 to 6 English words, e.g. "data dashboard", "without writing a single line of code", "handles everything for you", "in-depth research report", "competitor research", "save tons of time").
3. CRITICAL RULES:
   - ANNOTATION DENSITY (${density.toUpperCase()}): ${densityRule}
   - "phrase" MUST be an exact verbatim substring of the input Chinese sentence so it can be accurately located and highlighted in the subtitle.
   - "meaning" MUST be pure English (do NOT output Chinese or repeat the Chinese phrase).
   - Prioritize high-frequency spoken idioms, business/tech collocations, and expressive conversational chunks that English learners would find valuable to learn.
   - Do NOT annotate trivial single particles, pronouns, or conjunctions in isolation (e.g. 不要单独标注 '我', '你', '在', '的', '了', '是', '一个').
   - You MUST preserve the exact "id" integer for each item.
4. Output strictly valid JSON matching this schema:
{
  "results": [
    {
      "id": 1,
      "textZh": "It will directly build a functional CRM or data dashboard for you without writing a single line of code — it handles everything for you.",
      "phrases": [
        { "phrase": "数据看板", "meaning": "data dashboard" },
        { "phrase": "不用你写1行代码", "meaning": "without writing a single line of code" },
        { "phrase": "统统给你搞定", "meaning": "handles everything for you" }
      ]
    }
  ]
}`;
  }

  let densityRule = '';
  if (density === 'low') {
    densityRule = 'Keep the number of annotated phrases minimal and focused: ONLY 1 to 2 essential advanced idioms, phrasal verbs, or rare expressions per sentence. Leave common, intermediate, and basic vocabulary unannotated.';
  } else if (density === 'high') {
    densityRule = 'Maximize translation coverage: annotate 4 to 8+ phrases, words, and collocations per sentence. Annotate as many substantive content words (nouns, verbs, adjectives, adverbs, idioms, collocations) as possible (such as "notes", "different", "apps", "created", etc.), so learners receive comprehensive in-context vocabulary coverage across almost all key expressions.';
  } else {
    densityRule = 'Keep the number of annotated phrases balanced: 2 to 4 key expressive phrases, collocations, or core vocabulary per sentence, focusing on what English learners need to know to understand the sentence.';
  }

  return `You are a world-class bilingual subtitle translator and English learning specialist.
Your goal is to transform English video subtitles into an intuitive, high-yield "Mixed English-Chinese" learning format so language learners can naturally understand and absorb English through context.

For each subtitle cue:
1. "textZh": Provide a natural, fluent, and accurate full-sentence Chinese translation.
2. "phrases": Identify key expressive units in the sentence. These include:
   - Fixed collocations, quantifier phrases & prepositional idioms (e.g. "a lot of", "in front of", "as well as", "a bit of", "lots of", "a couple of", "a number of", "out of", "instead of", "because of", "such as", "as long as", "as soon as")
   - Phrasal verbs & idioms (e.g. "getting used to", "look forward to", "run out of", "give up")
   - Meaningful collocations & chunks (e.g. "image generation", "make a profit", "take into account", "high-end")
   - Key content verbs, nouns, or adjectives that carry essential contextual meaning in this sentence (e.g. "ditched", "gig", "eventually", "notes", "different", "created")
3. For each identified phrase:
   - "phrase": The exact continuous English phrase or word AS IT APPEARS in the sentence (e.g. "a lot of", "getting used to", "image generation", "ditched", "made a profit").
   - "meaning": An accurate, natural, and concise in-context Chinese gloss (1 to 5 Chinese characters, e.g. "大量/许多", "习惯于", "图像生成", "淘汰了", "获得盈利").
4. CRITICAL RULES:
   - ANNOTATION DENSITY (${density.toUpperCase()}): ${densityRule}
   - CRITICAL: For fixed collocations and quantifier phrases composed with articles/prepositions (e.g. "a lot of", "in front of", "as well as", "a bit of"), ALWAYS extract the ENTIRE phrase including leading articles ('a', 'an') and trailing prepositions ('of', 'as', 'to') as a SINGLE semantic unit. NEVER split them (e.g. extract "a lot of", NEVER "a lot" or "lot"!).
   - DO NOT annotate trivial functional words or simple grammar connectors by themselves (e.g. DO NOT annotate 'to', 'it', 'and', 'my', 'is', 'the' in isolation).
   - ALWAYS combine verbs with their prepositions/particles into full phrasal verbs when they form a single semantic unit (e.g. extract "getting used to" as a whole, NOT "getting" and "used" separately!).
   - You MUST preserve the exact "id" integer for each item.
5. Output strictly valid JSON matching this schema:
{
  "results": [
    {
      "id": 1,
      "textZh": "逐渐习惯了之后，我开始进行图像生成方面的训练，看了大量的教程...",
      "phrases": [
        { "phrase": "getting used to", "meaning": "习惯于" },
        { "phrase": "image generation", "meaning": "图像生成" },
        { "phrase": "a lot of", "meaning": "大量" }
      ]
    }
  ]
}`;
}

/**
 * AI Contextual Gloss Generator
 * Generates accurate in-context Chinese glosses for content words in subtitle cues.
 */
export class MixedGlossGenerator {
  private inFlightKeys = new Set<string>();
  private cache = new Map<string, Map<string, string>>(); // sentenceKey -> Map(lowercase word/lemma -> in-context meaning)

  public isBatchTranslating = false;
  private abortBatch = false;
  private currentFocusTime: number = 0;
  private wakeUpDelay: (() => void) | null = null;

  public cancelBatchTranslation(): void {
    this.abortBatch = true;
    this.isBatchTranslating = false;
    if (this.wakeUpDelay) {
      this.wakeUpDelay();
      this.wakeUpDelay = null;
    }
  }

  /**
   * Clear all cached sentence-level glosses and in-flight tracking keys.
   */
  public clearCache(): void {
    this.cache.clear();
    this.inFlightKeys.clear();
  }

  /**
   * Notify generator of user playback seek/jump.
   * Interrupts polite inter-batch delay and causes the next popped batch
   * to immediately prioritize the newly focused playback position.
   */
  public notifyPlaybackSeek(newTime: number): void {
    this.currentFocusTime = Math.max(0, newTime);
    if (this.wakeUpDelay) {
      this.wakeUpDelay();
      this.wakeUpDelay = null;
    }
  }

  /**
   * Check if user has configured an API key in settings
   */
  public canUseAi(): boolean {
    const settings = useAppStore.getState().settings;
    return Boolean(settings && settings.apiKey && settings.apiKey.trim().length > 0);
  }

  /**
   * Normalize sentence key for caching
   */
  public normalizeSentenceKey(textEn: string): string {
    return (textEn || '').toLowerCase().replace(/[^\w\s\u4e00-\u9fff\u3400-\u4dbf]/g, '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Filter tokens in a cue according to the configured filter level
   */
  public getEligibleWordsForCue(
    tokens: WordToken[],
    filterLevel: 'all_content' | 'advanced_only' = 'all_content'
  ): string[] {
    if (!tokens || tokens.length === 0) return [];
    const eligible: string[] = [];

    for (const token of tokens) {
      if (!token.isWord) continue;
      const clean = (token.lemma || token.text).toLowerCase().trim();
      if (isTrivialStopWord(clean)) continue;

      if (filterLevel === 'advanced_only') {
        // Only annotate B1, B2, C1, C2, or unknown/learning level
        const isAdvanced = token.cefr === 'B1' || token.cefr === 'B2' || token.cefr === 'C1' || token.cefr === 'C2';
        const isLearning = token.level === 'learning' || token.level === 'new';
        if (!isAdvanced && !isLearning) continue;
      }

      if (!eligible.includes(clean)) {
        eligible.push(clean);
      }
    }
    return eligible;
  }

  /**
   * Apply cached or local dictionary glosses to a cue's tokens synchronously
   */
  public populateGlossesSync(
    cue: SubtitleCue,
    filterLevel: 'all_content' | 'advanced_only' = 'all_content'
  ): SubtitleCue {
    if (!cue || !cue.tokens || cue.tokens.length === 0) return cue;

    // 1. If cue already contains key phrase annotations from AI fine translation, preserve it!
    // Clean any offline dictionary contextMeaning from non-phrase tokens to prevent mechanical glosses leaking
    if (cue.isMixedRefined || cue.mixedPhrases !== undefined || cue.tokens.some(t => t.isKeyPhrase)) {
      const tokensToUse = (cue.mixedPhrases && cue.mixedPhrases.length > 0 && !cue.tokens.some(t => t.isKeyPhrase))
        ? applyPhraseAnnotationsToTokens(cue.tokens, cue.mixedPhrases)
        : cue.tokens;

      const cleanedTokens = tokensToUse.map(t => {
        if (!t.isKeyPhrase && t.contextMeaning) {
          return { ...t, contextMeaning: undefined };
        }
        return t;
      });
      return {
        ...cue,
        tokens: cleanedTokens
      };
    }

    const sentenceKey = this.normalizeSentenceKey(cue.textEn);
    const cachedGlosses = this.cache.get(sentenceKey);

    const updatedTokens = cue.tokens.map((token) => {
      if (!token.isWord) return token;
      const clean = (token.lemma || token.text).toLowerCase().trim();
      if (isTrivialStopWord(clean)) {
        return token.contextMeaning ? { ...token, contextMeaning: undefined } : token;
      }

      if (filterLevel === 'advanced_only') {
        const isAdvanced = token.cefr === 'B1' || token.cefr === 'B2' || token.cefr === 'C1' || token.cefr === 'C2';
        const isLearning = token.level === 'learning' || token.level === 'new';
        if (!isAdvanced && !isLearning) {
          return token.contextMeaning ? { ...token, contextMeaning: undefined } : token;
        }
      }

      // 1. If AI in-context gloss is in cache, use it (highest accuracy)
      if (cachedGlosses) {
        const aiMeaning = cachedGlosses.get(clean) || cachedGlosses.get(token.text.toLowerCase().trim());
        if (aiMeaning) {
          return { ...token, contextMeaning: aiMeaning };
        }
      }

      // 2. If already has contextMeaning (from previous AI run), keep it
      if (token.contextMeaning) return token;

      // 3. Fallback to local dictionary concise definition
      const localFallback = fallbackLocalGloss(token);
      if (localFallback) {
        return { ...token, contextMeaning: localFallback };
      }

      return token;
    });

    return {
      ...cue,
      tokens: updatedTokens
    };
  }

  /**
   * Request AI contextual glossing for a batch of cues asynchronously
   */
  public async requestAiGlossesForCues(cues: SubtitleCue[]): Promise<void> {
    if (!cues || cues.length === 0) return;
    if (!this.canUseAi()) return;

    const settings = useAppStore.getState().settings;
    const filterLevel = settings.mixedModeFilterLevel || 'all_content';

    // Filter cues that actually need AI processing
    const pendingCues: SubtitleCue[] = [];
    for (const cue of cues) {
      if (!cue.textEn || !isValidSubtitleText(cue.textEn)) continue;
      const key = this.normalizeSentenceKey(cue.textEn);
      if (this.cache.has(key) || this.inFlightKeys.has(key)) continue;

      const words = this.getEligibleWordsForCue(cue.tokens || [], filterLevel);
      if (words.length > 0) {
        pendingCues.push(cue);
      }
    }

    if (pendingCues.length === 0) return;

    // Process up to 5 cues per request
    const batch = pendingCues.slice(0, 5);
    batch.forEach(c => this.inFlightKeys.add(this.normalizeSentenceKey(c.textEn)));

    try {
      const provider = settings.aiProvider || 'google';
      const defaultBaseUrl = AI_PRESETS[provider]?.apiBaseUrl || AI_PRESETS.google.apiBaseUrl;
      const defaultModel = AI_PRESETS[provider]?.modelName || AI_PRESETS.google.modelName;

      const items = batch.map(c => ({
        id: c.id,
        sentence: c.textEn,
        words: this.getEligibleWordsForCue(c.tokens || [], filterLevel)
      }));

      const systemPrompt = `You are a bilingual language expert and English-Chinese glossing specialist.
Your job is to provide the exact, in-context Chinese meaning (1 to 4 Chinese characters) for substantive content words in English video dialogue.

CRITICAL INSTRUCTIONS:
1. Provide the SPECIFIC, NATURAL meaning of each word in the context of THIS sentence, NOT a generic dictionary list.
2. DO NOT include trivial stop words (e.g. 'a', 'the', 'in', 'on', 'at', 'to', 'for', 'with', 'is', 'are', 'was', 'and', 'but', 'it', 'you').
3. Keep each Chinese meaning extremely concise: 1 to 4 characters (e.g. 'performance' -> '表现', 'progress' -> '进展', 'advice' -> '建议').
4. Output strictly valid JSON matching this schema:
{
  "results": [
    {
      "id": 1,
      "glosses": [
        { "word": "performance", "meaning": "表现" },
        { "word": "progress", "meaning": "进展" }
      ]
    }
  ]
}`;

      const userPrompt = JSON.stringify(items);
      const response = await callLlmChat(
        {
          apiBaseUrl: settings.apiBaseUrl || defaultBaseUrl,
          apiKey: settings.apiKey,
          modelName: settings.modelName || defaultModel
        },
        {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.1,
          maxTokens: 1000,
          responseFormatJson: true
        }
      );

      // Parse response JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const results = parsed.results || [];

        const updatedCuesMap = new Map<number, Map<string, string>>();

        for (const item of results) {
          const cue = batch.find(b => b.id === item.id);
          if (!cue || !Array.isArray(item.glosses)) continue;

          const wordGlossMap = new Map<string, string>();
          for (const g of item.glosses) {
            if (g && typeof g.word === 'string' && typeof g.meaning === 'string') {
              const cleanWord = g.word.toLowerCase().trim();
              const cleanMeaning = g.meaning.trim().slice(0, 6);
              if (cleanWord && cleanMeaning && !isTrivialStopWord(cleanWord)) {
                wordGlossMap.set(cleanWord, cleanMeaning);
              }
            }
          }

          const sentenceKey = this.normalizeSentenceKey(cue.textEn);
          this.cache.set(sentenceKey, wordGlossMap);
          updatedCuesMap.set(cue.id, wordGlossMap);
        }

        // Apply newly acquired glosses into the store reactive state
        if (updatedCuesMap.size > 0) {
          const currentCues = useAppStore.getState().cues;
          let hasChange = false;
          const nextCues = currentCues.map(c => {
            const glossMap = updatedCuesMap.get(c.id);
            if (!glossMap || !c.tokens) return c;

            hasChange = true;
            const updatedTokens = c.tokens.map(token => {
              if (!token.isWord) return token;
              const clean = (token.lemma || token.text).toLowerCase().trim();
              const newMeaning = glossMap.get(clean) || glossMap.get(token.text.toLowerCase().trim());
              if (newMeaning && newMeaning !== token.contextMeaning) {
                return { ...token, contextMeaning: newMeaning };
              }
              return token;
            });

            return { ...c, tokens: updatedTokens };
          });

          if (hasChange) {
            useAppStore.setState({ cues: nextCues });
          }
        }
      }
    } catch (err) {
      console.warn('[MixedGlossGenerator] AI gloss generation failed, staying with local fallback:', err);
    } finally {
      batch.forEach(c => this.inFlightKeys.delete(this.normalizeSentenceKey(c.textEn)));
    }
  }

  /**
   * Execute AI Mixed Fine-Translation for a batch of subtitle cues.
   * Extracts multi-word idioms/phrases, computes fluent sentence translation,
   * updates tokens and store cues with isAiRefined / isMixedRefined, and caches.
   */
  public async executeMixedTranslationBatch(chunk: SubtitleCue[]): Promise<number> {
    if (!chunk || chunk.length === 0) return 0;

    const settings = useAppStore.getState().settings;
    const provider = settings.aiProvider || 'google';
    const defaultBaseUrl = AI_PRESETS[provider]?.apiBaseUrl || AI_PRESETS.google.apiBaseUrl;
    const defaultModel = AI_PRESETS[provider]?.modelName || AI_PRESETS.google.modelName;

    const promptItems = chunk.map(c => ({ id: c.id, textEn: c.textEn }));
    const isSourceZh = detectSourceLanguage(chunk) === 'zh';
    const density = settings.mixedGlossDensity || 'medium';
    const systemPrompt = buildMixedTranslationPrompt(isSourceZh, density);

    const response = await callLlmChat(
      {
        apiBaseUrl: settings.apiBaseUrl || defaultBaseUrl,
        apiKey: settings.apiKey,
        modelName: settings.modelName || defaultModel,
        timeoutMs: 25000
      },
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(promptItems) }
        ],
        temperature: 0.2,
        responseFormatJson: true
      }
    );

    const parsedResults = parseMixedTranslationResponse(response, promptItems);
    if (parsedResults.length === 0) return 0;

    const updates: Array<{ id: number; textZh?: string; tokens?: WordToken[]; mixedPhrases?: PhraseGlossItem[] }> = [];

    for (const res of parsedResults) {
      const cue = chunk.find(c => c.id === res.id);
      if (!cue) continue;

      const tokens = cue.tokens || [];
      const updatedTokens = applyPhraseAnnotationsToTokens(tokens, res.phrases);

      // Cache glosses for fast lookup
      const sentenceKey = this.normalizeSentenceKey(cue.textEn);
      const wordGlossMap = this.cache.get(sentenceKey) || new Map<string, string>();
      for (const p of res.phrases) {
        wordGlossMap.set(p.phrase.toLowerCase().trim(), p.meaning.slice(0, 8));
      }
      this.cache.set(sentenceKey, wordGlossMap);

      updates.push({
        id: res.id,
        textZh: res.textZh,
        tokens: updatedTokens,
        mixedPhrases: res.phrases
      });
    }

    if (updates.length > 0) {
      useAppStore.getState().updateCueMixedTranslations(updates);
      return updates.length;
    }
    return 0;
  }

  /**
   * On-the-fly sliding-window AI fine translation in Mixed Mode around currentTime.
   * Translates and replaces cues in the window [currentIdx - 1, currentIdx + windowRadius].
   */
  public async translateWindowMixed(currentTime: number, windowRadius = 6): Promise<void> {
    if (!this.canUseAi()) return;
    if (this.isBatchTranslating) return;

    const { cues, isAdPlaying, isLoadingSentenceAnalysis, isStreamingAnalysis } = useAppStore.getState();
    if (isAdPlaying || !cues || cues.length === 0 || isLoadingSentenceAnalysis || isStreamingAnalysis) return;

    let currentIdx = cues.findIndex(c => currentTime >= c.start && currentTime <= c.end);
    if (currentIdx === -1) {
      currentIdx = cues.findIndex(c => c.start >= currentTime);
      if (currentIdx === -1) currentIdx = 0;
    }

    const startIdx = Math.max(0, currentIdx - 1);
    const endIdx = Math.min(cues.length, currentIdx + windowRadius);

    const candidates: SubtitleCue[] = [];
    for (let i = startIdx; i < endIdx; i++) {
      const cue = cues[i];
      if (
        Boolean(cue.textEn) &&
        isValidSubtitleText(cue.textEn) &&
        !cue.isMixedRefined &&
        cue.mixedPhrases === undefined &&
        !this.inFlightKeys.has(this.normalizeSentenceKey(cue.textEn))
      ) {
        candidates.push(cue);
      }
    }

    if (candidates.length === 0) return;

    const batch = candidates.slice(0, 5);
    batch.forEach(c => this.inFlightKeys.add(this.normalizeSentenceKey(c.textEn)));

    try {
      await this.executeMixedTranslationBatch(batch);
    } catch (err) {
      console.warn('[MixedGlossGenerator] Sliding window mixed translation error:', err);
    } finally {
      batch.forEach(c => this.inFlightKeys.delete(this.normalizeSentenceKey(c.textEn)));
    }
  }

  /**
   * AI Fine Translation in Mixed Mode:
   * Batches entire video subtitles, instructs AI to extract meaningful idioms/phrases/collocations
   * with concise in-context meanings and full natural translation, and maps them to tokens.
   * Prioritizes the current playback sentence (and immediate window) first, with seek preemption!
   */
  public async translateEntireVideoMixed(
    cues?: SubtitleCue[],
    onProgress?: (progress: BatchTranslationProgress) => void,
    forceAll: boolean = false,
    startFromTime?: number
  ): Promise<boolean> {
    if (!this.canUseAi()) {
      return false;
    }
    if (this.isBatchTranslating) {
      return false;
    }

    const allCues = cues || useAppStore.getState().cues;
    if (!allCues || allCues.length === 0) return false;

    // Filter eligible cues that have English text
    const allEligible = allCues.filter(c => Boolean(c.textEn) && isValidSubtitleText(c.textEn));
    const eligibleCues = forceAll
      ? allEligible
      : allEligible.filter(c => !c.isMixedRefined && c.mixedPhrases === undefined);

    if (eligibleCues.length === 0) {
      const p: BatchTranslationProgress = {
        total: allCues.length,
        completed: allCues.length,
        percent: 100,
        isRunning: false,
        mode: 'mixed'
      };
      onProgress?.(p);
      return true;
    }

    const initialTime = typeof startFromTime === 'number'
      ? startFromTime
      : (useAppStore.getState().currentTime || 0);
    this.currentFocusTime = initialTime;

    this.isBatchTranslating = true;
    this.abortBatch = false;

    let progress: BatchTranslationProgress = {
      total: eligibleCues.length,
      completed: 0,
      percent: 0,
      isRunning: true,
      mode: 'mixed'
    };
    onProgress?.(progress);

    const chunkSize = 5;
    let completedCount = 0;
    const queue = new PriorityBatchQueue(eligibleCues);

    try {
      while (queue.hasRemaining()) {
        if (this.abortBatch) {
          console.log('[MixedGlossGenerator] Batch translation aborted by user.');
          break;
        }

        const chunk = queue.popNextBatch(this.currentFocusTime, chunkSize);
        if (chunk.length === 0) break;

        try {
          const batchCompleted = await this.executeMixedTranslationBatch(chunk);
          if (this.abortBatch) break;
          completedCount += batchCompleted;
        } catch (err: any) {
          const errMsg = err?.message || String(err);
          console.warn('[MixedGlossGenerator] Batch chunk failed:', err);
          progress = {
            ...progress,
            error: errMsg
          };
        }

        const currentCompleted = Math.min(completedCount, eligibleCues.length);
        const percent = Math.round((currentCompleted / eligibleCues.length) * 100);

        progress = {
          total: eligibleCues.length,
          completed: currentCompleted,
          percent,
          isRunning: true,
          mode: 'mixed',
          ...(progress.error ? { error: progress.error } : {})
        };
        onProgress?.(progress);

        // Interruptible polite delay between chunks
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

      progress = {
        total: eligibleCues.length,
        completed: completedCount,
        percent: eligibleCues.length > 0 ? Math.round((completedCount / eligibleCues.length) * 100) : 100,
        isRunning: false,
        mode: 'mixed',
        ...(completedCount === 0 && progress.error ? { error: progress.error } : {})
      };
      onProgress?.(progress);
      return completedCount > 0;
    } finally {
      this.isBatchTranslating = false;
      this.wakeUpDelay = null;
    }
  }
}

export const mixedGlossGenerator = new MixedGlossGenerator();
