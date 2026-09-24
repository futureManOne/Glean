import { describe, it, expect, beforeEach, mock } from 'bun:test';
import {
  getAudioUrl,
  filterAndRankVoices,
  stopCurrentAudio,
  SystemVoiceInfo
} from '@/core/audio/ttsEngine';
import { useAppStore } from '@/store/useAppStore';

describe('TTS & Pronunciation Engine', () => {
  describe('getAudioUrl URL generation', () => {
    it('generates correct Youdao US human pronunciation URL (type=2)', () => {
      const url = getAudioUrl('productivity', 'youdao-us');
      expect(url).toBe('https://dict.youdao.com/dictvoice?audio=productivity&type=2');
    });

    it('generates correct Youdao UK human pronunciation URL (type=1)', () => {
      const url = getAudioUrl('schedule', 'youdao-uk');
      expect(url).toBe('https://dict.youdao.com/dictvoice?audio=schedule&type=1');
    });

    it('generates correct Google TTS URL', () => {
      const url = getAudioUrl('boost performance', 'google');
      expect(url).toBe(
        'https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=boost%20performance'
      );
    });

    it('returns null for system engine', () => {
      const url = getAudioUrl('hello', 'system');
      expect(url).toBeNull();
    });

    it('returns null for empty or whitespace text', () => {
      expect(getAudioUrl('', 'youdao-us')).toBeNull();
      expect(getAudioUrl('   ', 'youdao-us')).toBeNull();
    });

    it('properly encodes special characters and spaces', () => {
      const url = getAudioUrl('state-of-the-art & modern', 'youdao-us');
      expect(url).toBe(
        `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent('state-of-the-art & modern')}&type=2`
      );
    });
  });

  describe('filterAndRankVoices Web Speech API ranking & filtering', () => {
    it('filters out raspy novelty/toy macOS voices (Alex, Fred, Bells, Zarvox)', () => {
      const mockVoices: SpeechSynthesisVoice[] = [
        {
          name: 'Fred',
          lang: 'en-US',
          default: false,
          localService: true,
          voiceURI: 'Fred'
        },
        {
          name: 'Bad News',
          lang: 'en-US',
          default: false,
          localService: true,
          voiceURI: 'Bad News'
        },
        {
          name: 'Bells',
          lang: 'en-US',
          default: false,
          localService: true,
          voiceURI: 'Bells'
        },
        {
          name: 'Zarvox',
          lang: 'en-US',
          default: false,
          localService: true,
          voiceURI: 'Zarvox'
        },
        {
          name: 'Samantha',
          lang: 'en-US',
          default: true,
          localService: true,
          voiceURI: 'Samantha'
        }
      ];

      const filtered = filterAndRankVoices(mockVoices);
      const names = filtered.map((v) => v.name);

      expect(names).toContain('Samantha');
      expect(names).not.toContain('Fred');
      expect(names).not.toContain('Bad News');
      expect(names).not.toContain('Bells');
      expect(names).not.toContain('Zarvox');
    });

    it('filters out non-English voices for English word pronunciation', () => {
      const mockVoices: SpeechSynthesisVoice[] = [
        {
          name: 'Ting-Ting',
          lang: 'zh-CN',
          default: false,
          localService: true,
          voiceURI: 'Ting-Ting'
        },
        {
          name: 'Kyoko',
          lang: 'ja-JP',
          default: false,
          localService: true,
          voiceURI: 'Kyoko'
        },
        {
          name: 'Ava',
          lang: 'en-US',
          default: false,
          localService: true,
          voiceURI: 'Ava'
        }
      ];

      const filtered = filterAndRankVoices(mockVoices);
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe('Ava');
    });

    it('prioritizes high-quality voices (Enhanced, Premium, Samantha, Ava, Google) at top', () => {
      const mockVoices: SpeechSynthesisVoice[] = [
        {
          name: 'Victoria',
          lang: 'en-US',
          default: false,
          localService: true,
          voiceURI: 'Victoria'
        },
        {
          name: 'Samantha (Enhanced)',
          lang: 'en-US',
          default: false,
          localService: true,
          voiceURI: 'Samantha (Enhanced)'
        },
        {
          name: 'Google US English',
          lang: 'en-US',
          default: false,
          localService: false,
          voiceURI: 'Google US English'
        },
        {
          name: 'Agnes',
          lang: 'en-US',
          default: false,
          localService: true,
          voiceURI: 'Agnes'
        }
      ];

      const filtered = filterAndRankVoices(mockVoices);
      expect(filtered[0].isHighQuality).toBe(true);
      expect(filtered[1].isHighQuality).toBe(true);
      const highQualityNames = filtered.filter((f) => f.isHighQuality).map((f) => f.name);
      expect(highQualityNames).toContain('Samantha (Enhanced)');
      expect(highQualityNames).toContain('Google US English');
    });
  });

  describe('Audio Settings Store persistence', () => {
    it('initializes with youdao-us human voice as default', () => {
      const state = useAppStore.getState();
      expect(state.settings.ttsEngine).toBe('youdao-us');
      expect(state.settings.ttsRate).toBe(1.0);
    });

    it('allows updating audio settings', () => {
      const store = useAppStore.getState();
      store.updateSettings({
        ttsEngine: 'youdao-uk',
        ttsRate: 1.15,
        ttsVoice: 'Samantha'
      });

      const updated = useAppStore.getState();
      expect(updated.settings.ttsEngine).toBe('youdao-uk');
      expect(updated.settings.ttsRate).toBe(1.15);
      expect(updated.settings.ttsVoice).toBe('Samantha');

      // Reset back to defaults
      store.updateSettings({
        ttsEngine: 'youdao-us',
        ttsRate: 1.0,
        ttsVoice: ''
      });
    });
  });
});
