import { expect, test, describe, beforeEach } from 'bun:test';
import {
  hashSentence,
  buildCacheKey,
  buildSentenceCacheKey,
  getWordExplanationCache,
  setWordExplanationCache,
  clearWordExplanationCache,
  getSentenceAnalysisCache,
  setSentenceAnalysisCache,
  clearSentenceAnalysisCache
} from '@/core/dictionary/aiCache';
import { WordExplanation, SentenceDeepAnalysis } from '@/types';

describe('aiCache Module', () => {
  beforeEach(async () => {
    await clearWordExplanationCache();
    await clearSentenceAnalysisCache();
  });

  test('generates deterministic hashes for sentences', () => {
    const h1 = hashSentence('This is a test sentence.');
    const h2 = hashSentence('  THIS IS A TEST SENTENCE.  ');
    const hEmpty = hashSentence('');

    expect(h1).toBe(h2);
    expect(typeof h1).toBe('string');
    expect(hEmpty).toBe('empty');
  });

  test('builds isolated cache keys for words and sentences', () => {
    const wordKey = buildCacheKey('apple', 'I eat an apple daily.');
    const sentenceKey = buildSentenceCacheKey('I eat an apple daily.', 'zh-CN');

    expect(wordKey.startsWith('apple::')).toBe(true);
    expect(sentenceKey.startsWith('zh-CN::')).toBe(true);
  });

  test('caches and retrieves word explanations with 0ms memory hits', async () => {
    const explanation: WordExplanation = {
      word: 'resilient',
      contextMeaning: 'Able to withstand hardship',
      phonetic: '/rɪˈzɪliənt/',
      definitions: ['Able to recoil or spring back into shape'],
      grammarRole: 'Adjective',
      intent: 'Praises psychological fortitude',
      cefr: 'B2',
      collins: 4
    };

    expect(await getWordExplanationCache('resilient', 'Stay resilient.')).toBeNull();

    await setWordExplanationCache('resilient', 'Stay resilient.', explanation);
    const hit = await getWordExplanationCache('resilient', 'Stay resilient.');

    expect(hit).not.toBeNull();
    expect(hit?.word).toBe('resilient');
    expect(hit?.cefr).toBe('B2');
  });

  test('caches and retrieves sentence deep analysis without hitting external network', async () => {
    const analysis: SentenceDeepAnalysis = {
      sentenceEn: 'Actions speak louder than words.',
      sentenceZh: '事实胜于雄辩。',
      authenticTranslation: '事实胜于雄辩。',
      contextTone: '坚定诚恳的说理语调',
      syntacticBreakdown: [
        { clause: 'Actions speak', role: '主谓骨架', explanation: '主语 Actions 与谓语 speak' }
      ],
      idiomsAndPhrases: [
        { phrase: 'speak louder than', meaning: '比...更有说服力' }
      ],
      pronunciationTips: [
        { phenomenon: '连读', detail: 'speak louder 紧密衔接' }
      ],
      isFallback: false
    };

    expect(await getSentenceAnalysisCache('Actions speak louder than words.', 'zh-CN')).toBeNull();

    await setSentenceAnalysisCache('Actions speak louder than words.', analysis, 'zh-CN');
    const hit = await getSentenceAnalysisCache('Actions speak louder than words.', 'zh-CN');

    expect(hit).not.toBeNull();
    expect(hit?.sentenceEn).toBe('Actions speak louder than words.');
    expect(hit?.authenticTranslation).toBe('事实胜于雄辩。');
  });

  test('clears memory cache completely', async () => {
    await setSentenceAnalysisCache('Test.', {
      sentenceEn: 'Test.',
      authenticTranslation: '测试',
      contextTone: '测试',
      syntacticBreakdown: [],
      idiomsAndPhrases: [],
      pronunciationTips: [],
      isFallback: true
    }, 'zh-CN');

    await clearSentenceAnalysisCache();
    expect(await getSentenceAnalysisCache('Test.', 'zh-CN')).toBeNull();
  });
});
