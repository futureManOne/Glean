import { expect, test, describe } from 'bun:test';
import { applyPhraseAnnotationsToTokens, mixedGlossGenerator, parseMixedTranslationResponse } from '@/core/ai/mixedGlossGenerator';
import { WordToken, PhraseGlossItem, SubtitleCue } from '@/types';

function makeTokens(words: string[]): WordToken[] {
  return words.map((w, idx) => ({
    id: `tok-${idx}`,
    text: w,
    isWord: /^[a-zA-Z0-9'-]+$/.test(w),
    lemma: w.toLowerCase().replace(/^[^\w']+|[^\w']+$/g, '')
  }));
}

describe('Mixed Mode Phrase Annotation', () => {
  test('matches contiguous phrases normally', () => {
    // "How did you find out this recipe ?"
    const tokens = makeTokens(['How', 'did', 'you', 'find', 'out', 'this', 'recipe', '?']);
    const phrases: PhraseGlossItem[] = [
      { phrase: 'find out', meaning: '发现/得知' },
      { phrase: 'recipe', meaning: '食谱' }
    ];

    const result = applyPhraseAnnotationsToTokens(tokens, phrases);
    const findToken = result.find(t => t.text === 'find');
    const outToken = result.find(t => t.text === 'out');
    const recipeToken = result.find(t => t.text === 'recipe');

    expect(findToken?.isKeyPhrase).toBe(true);
    expect(findToken?.isPhraseStart).toBe(true);
    expect(findToken?.isPhraseEnd).toBe(false);

    expect(outToken?.isKeyPhrase).toBe(true);
    expect(outToken?.isPhraseEnd).toBe(true);
    expect(outToken?.phraseMeaning).toBe('发现/得知');

    expect(recipeToken?.isKeyPhrase).toBe(true);
    expect(recipeToken?.phraseMeaning).toBe('食谱');
  });

  test('matches separable phrasal verb "find ... out" in "How do you find everything out ?"', () => {
    const tokens = makeTokens(['-', 'How', 'do', 'you', 'find', 'everything', 'out', '?']);
    const phrases: PhraseGlossItem[] = [
      { phrase: 'find out', meaning: '打听清楚' }
    ];

    const result = applyPhraseAnnotationsToTokens(tokens, phrases);
    const findToken = result.find(t => t.text === 'find');
    const everythingToken = result.find(t => t.text === 'everything');
    const outToken = result.find(t => t.text === 'out');

    expect(findToken?.isKeyPhrase).toBe(true);
    expect(findToken?.isPhraseStart).toBe(true);

    // "everything" in between should NOT be a key phrase
    expect(everythingToken?.isKeyPhrase).toBeUndefined();

    expect(outToken?.isKeyPhrase).toBe(true);
    expect(outToken?.isPhraseEnd).toBe(true);
    expect(outToken?.phraseMeaning).toBe('打听清楚');
  });

  test('matches separable phrasal verb with pronoun like "turn it off"', () => {
    const tokens = makeTokens(['Did', 'you', 'turn', 'it', 'off', '?']);
    const phrases: PhraseGlossItem[] = [
      { phrase: 'turn off', meaning: '关掉' }
    ];

    const result = applyPhraseAnnotationsToTokens(tokens, phrases);
    const turnToken = result.find(t => t.text === 'turn');
    const itToken = result.find(t => t.text === 'it');
    const offToken = result.find(t => t.text === 'off');

    expect(turnToken?.isKeyPhrase).toBe(true);
    expect(itToken?.isKeyPhrase).toBeUndefined();
    expect(offToken?.isKeyPhrase).toBe(true);
    expect(offToken?.phraseMeaning).toBe('关掉');
  });

  test('matches separable phrasal verb with ellipsis in phrase input "find...out"', () => {
    const tokens = makeTokens(['How', 'did', 'they', 'find', 'all', 'this', 'out', '?']);
    const phrases: PhraseGlossItem[] = [
      { phrase: 'find...out', meaning: '查明' }
    ];

    const result = applyPhraseAnnotationsToTokens(tokens, phrases);
    const findToken = result.find(t => t.text === 'find');
    const outToken = result.find(t => t.text === 'out');

    expect(findToken?.isKeyPhrase).toBe(true);
    expect(outToken?.isKeyPhrase).toBe(true);
    expect(outToken?.phraseMeaning).toBe('查明');
  });

  test('matches 3-word separable phrase like "take this factor into account"', () => {
    const tokens = makeTokens(['We', 'should', 'take', 'this', 'factor', 'into', 'account', '.']);
    const phrases: PhraseGlossItem[] = [
      { phrase: 'take into account', meaning: '考虑到' }
    ];

    const result = applyPhraseAnnotationsToTokens(tokens, phrases);
    const takeToken = result.find(t => t.text === 'take');
    const factorToken = result.find(t => t.text === 'factor');
    const accountToken = result.find(t => t.text === 'account');

    expect(takeToken?.isKeyPhrase).toBe(true);
    expect(factorToken?.isKeyPhrase).toBeUndefined();
    expect(accountToken?.isKeyPhrase).toBe(true);
    expect(accountToken?.phraseMeaning).toBe('考虑到');
  });

  test('does NOT match across sentence delimiter boundary', () => {
    const tokens = makeTokens(['He', 'did', 'find', '.', 'Out', 'there', 'was', 'rain']);
    const phrases: PhraseGlossItem[] = [
      { phrase: 'find out', meaning: '查明' }
    ];

    const result = applyPhraseAnnotationsToTokens(tokens, phrases);
    const findToken = result.find(t => t.text === 'find');
    const outToken = result.find(t => t.text === 'Out');

    expect(findToken?.isKeyPhrase).toBeUndefined();
    expect(outToken?.isKeyPhrase).toBeUndefined();
  });

  test('populateGlossesSync provides fallback when 0 phrases matched', () => {
    const cue: SubtitleCue = {
      id: 1,
      start: 0,
      end: 2,
      textEn: 'How do you find everything out ?',
      tokens: makeTokens(['-', 'How', 'do', 'you', 'find', 'everything', 'out', '?']),
      isMixedRefined: true,
      mixedPhrases: [] // 0 phrases returned from AI
    };

    const populated = mixedGlossGenerator.populateGlossesSync(cue, 'all_content');
    // Content word like "find" should receive a fallback definition instead of being completely empty
    const findToken = populated.tokens?.find(t => t.text === 'find');
    expect(findToken?.contextMeaning).toBeDefined();
    expect(findToken?.contextMeaning?.length).toBeGreaterThan(0);
  });

  test('parseMixedTranslationResponse extracts both full textZh and separable phrases', () => {
    const rawLlmResponse = JSON.stringify({
      results: [
        {
          id: 5,
          textZh: '你是怎么把这一切打听清楚的？',
          phrases: [
            { phrase: 'find out', meaning: '打听清楚' }
          ]
        }
      ]
    });

    const parsed = parseMixedTranslationResponse(rawLlmResponse, [
      { id: 5, textEn: '- How do you find everything out ?' }
    ]);

    expect(parsed.length).toBe(1);
    expect(parsed[0].textZh).toBe('你是怎么把这一切打听清楚的？');
    expect(parsed[0].phrases.length).toBe(1);
    expect(parsed[0].phrases[0].phrase).toBe('find out');
    expect(parsed[0].phrases[0].meaning).toBe('打听清楚');

    // And verify tokens mapped
    const tokens = makeTokens(['-', 'How', 'do', 'you', 'find', 'everything', 'out', '?']);
    const annotated = applyPhraseAnnotationsToTokens(tokens, parsed[0].phrases);
    expect(annotated.find(t => t.text === 'find')?.isKeyPhrase).toBe(true);
    expect(annotated.find(t => t.text === 'out')?.isKeyPhrase).toBe(true);
    expect(annotated.find(t => t.text === 'out')?.phraseMeaning).toBe('打听清楚');
  });
});
