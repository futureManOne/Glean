import { expect, test, describe } from 'bun:test';
import { isCueNeedsTranslation, detectSourceLanguage, resolveTargetLanguage } from '@/core/ai/bilingualTranslator';
import { alignBilingualJson3Events } from '@/core/subtitle/parser';
import { alignSentencesToAcousticTimestamps } from '@/core/ai/semanticSegmenter';
import { SubtitleCue } from '@/types';

describe('Chinese Video Subtitle Translation & Alignment', () => {
  describe('isCueNeedsTranslation for Chinese Source Videos', () => {
    test('identifies cues with empty translation as needing translation', () => {
      const cue: SubtitleCue = {
        id: 1,
        start: 154.0,
        end: 156.0,
        textEn: '梳理一些信息細節。',
        textZh: ''
      };
      expect(isCueNeedsTranslation(cue, 'en')).toBe(true);
    });

    test('identifies cues with untranslated Chinese textZh (missing punctuation) as needing translation', () => {
      // Box 1 in screenshot: textEn has period, textZh does not, both are Chinese
      const cue: SubtitleCue = {
        id: 2,
        start: 154.0,
        end: 156.0,
        textEn: '梳理一些信息細節。',
        textZh: '梳理一些信息細節',
        isAiRefined: true
      };
      expect(isCueNeedsTranslation(cue, 'en')).toBe(true);
    });

    test('identifies cues with merged untranslated Chinese textZh as needing translation', () => {
      // Box 2 in screenshot: textEn is short piece, textZh has original unsegmented Chinese sentence
      const cue: SubtitleCue = {
        id: 3,
        start: 160.0,
        end: 162.0,
        textEn: '我把它組合在一起，',
        textZh: '我把它組合在一起能夠變成一個我講述的故事',
        isAiRefined: true
      };
      expect(isCueNeedsTranslation(cue, 'en')).toBe(true);
    });

    test('recognizes genuinely translated English textZh as already translated', () => {
      // Item 02:27 in screenshot: Chinese dialogue with authentic English translation
      const cue: SubtitleCue = {
        id: 4,
        start: 147.0,
        end: 150.0,
        textEn: '第二個，就是我得能夠在這裏頭做一些信息核查，',
        textZh: 'The second thing is, I need to be able to do some fact-checking right in here,',
        isAiRefined: true
      };
      expect(isCueNeedsTranslation(cue, 'en')).toBe(false);
    });
  });

  describe('alignBilingualJson3Events with Chinese source and English auto-translate', () => {
    test('assigns Chinese dialogue to textEn and English translation to textZh', () => {
      const orig = [
        { tStartMs: 147000, dDurationMs: 3000, segs: [{ utf8: '第二個就是我得能夠在這裏頭做一些信息核查' }] },
        { tStartMs: 154000, dDurationMs: 2000, segs: [{ utf8: '梳理一些信息細節。' }] }
      ];
      // Only first event has translation in transEvents; second event is missing
      const trans = [
        { tStartMs: 147000, dDurationMs: 3000, segs: [{ utf8: 'The second thing is that I need to be able to do fact-checking.' }] }
      ];

      const cues = alignBilingualJson3Events(orig, trans, false);
      expect(cues.length).toBe(2);

      // Event 1: Has translation
      expect(cues[0].textEn).toBe('第二個就是我得能夠在這裏頭做一些信息核查');
      expect(cues[0].textZh).toBe('The second thing is that I need to be able to do fact-checking.');

      // Event 2: Translation missing; textZh holds Chinese original, ready for AI translation
      expect(cues[1].textZh).toBe('梳理一些信息細節。');
      expect(isCueNeedsTranslation(cues[1], 'en')).toBe(true);
    });
  });
  describe('semanticSegmenter translation preservation', () => {
    test('does not poison textZh with untranslated Chinese when segmenting Chinese speech', () => {
      const originalCues: SubtitleCue[] = [
        {
          id: 1,
          start: 160.0,
          end: 164.0,
          textEn: '我把它組合在一起能夠變成一個我講述的故事',
          textZh: '我把它組合在一起能夠變成一個我講述的故事'
        }
      ];

      const aiSentences = [
        '我把它組合在一起，',
        '能夠變成一個我講述的故事。'
      ];

      const aligned = alignSentencesToAcousticTimestamps(aiSentences, originalCues);
      expect(aligned.length).toBe(2);

      // textEn should have segmented Chinese sentences
      expect(aligned[0].textEn).toBe('我把它組合在一起，');
      expect(aligned[1].textEn).toBe('能夠變成一個我講述的故事。');

      // textZh MUST NOT be populated with Chinese! Must be empty for translation
      expect(aligned[0].textZh).toBe('');
      expect(aligned[1].textZh).toBe('');
      expect(isCueNeedsTranslation(aligned[0], 'en')).toBe(true);
      expect(isCueNeedsTranslation(aligned[1], 'en')).toBe(true);
    });
  });

  describe('detectSourceLanguage and resolveTargetLanguage', () => {
    test('correctly identifies Chinese video as zh even when partial English translations exist', () => {
      const cues: Array<{ textEn: string; textZh: string }> = [
        { textEn: '第二個就是我得能夠在這裏頭做一些信息核查', textZh: 'The second thing is fact checking' },
        { textEn: '梳理一些信息細節。', textZh: '' },
        { textEn: '這些信息細節和信息核查的內容，', textZh: 'These specific details and content' },
        { textEn: '我把它組合在一起，', textZh: '' },
        { textEn: '能夠變成一個我講述的故事。', textZh: 'can turn into a story' }
      ];

      const lang = detectSourceLanguage(cues);
      expect(lang).toBe('zh');

      const resolved = resolveTargetLanguage(lang, 'auto');
      expect(resolved.code).toBe('en');
      expect(resolved.isSourceZh).toBe(true);
    });
  });
});
