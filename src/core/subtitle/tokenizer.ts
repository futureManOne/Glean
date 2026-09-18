import { WordToken, SavedWord } from '@/types';
import { normalizeWord, lookupLocalDict } from '../dictionary/ecdictMini';

/**
 * Tokenize an English sentence into clickable words and non-word separators
 */
export function tokenizeSentence(
  text: string,
  savedWordsMap: Map<string, SavedWord> = new Map()
): WordToken[] {
  if (!text) return [];

  // Use native Intl.Segmenter for word boundary segmentation
  let segments: Intl.SegmentData[] = [];
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const isCjk = /[\u4e00-\u9fa5\u3400-\u4dbf]/.test(text);
    const lang = isCjk ? 'zh' : 'en';
    const segmenter = new Intl.Segmenter(lang, { granularity: 'word' });
    segments = Array.from(segmenter.segment(text));
  } else {
    // Fallback regex segmentation
    const regex = /([a-zA-Z0-9'’ʼʻ-]+|[\u4e00-\u9fa5\u3400-\u4dbf]+|[^a-zA-Z0-9'’ʼʻ\u4e00-\u9fa5\u3400-\u4dbf-]+)/g;
    let match;
    let index = 0;
    while ((match = regex.exec(text)) !== null) {
      const matchStr = match[0];
      const isWord = /^[a-zA-Z0-9'’ʼʻ-]+$/.test(matchStr) || /^[\u4e00-\u9fa5\u3400-\u4dbf]+$/.test(matchStr);
      segments.push({
        segment: matchStr,
        index: index,
        input: text,
        isWordLike: isWord
      });
      index += matchStr.length;
    }
  }

  return segments.map((seg, idx) => {
    const hasEnglish = /[a-zA-Z]/.test(seg.segment);
    const hasCjk = /[\u4e00-\u9fa5\u3400-\u4dbf]/.test(seg.segment);
    const isWord = Boolean(seg.isWordLike && (hasEnglish || hasCjk));
    const lemma = hasEnglish ? normalizeWord(seg.segment) : undefined;
    
    // Check if word is already in saved words dictionary
    let level: WordToken['level'] = 'new';
    if (lemma && savedWordsMap.has(lemma)) {
      level = savedWordsMap.get(lemma)!.level;
    } else if (isWord && savedWordsMap.has(seg.segment.toLowerCase())) {
      level = savedWordsMap.get(seg.segment.toLowerCase())!.level;
    }

    // Lookup CEFR level
    let cefr: WordToken['cefr'] = undefined;
    if (hasEnglish) {
      const dictEntry = lookupLocalDict(lemma || seg.segment);
      cefr = dictEntry.cefr;
    }

    return {
      id: `token-${idx}-${seg.index}`,
      text: seg.segment,
      isWord,
      lemma,
      level,
      cefr
    };
  });
}
