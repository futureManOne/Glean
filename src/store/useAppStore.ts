import { create } from 'zustand';
import { SubtitleCue, WordExplanation, SavedWord, AppSettings, MasteryLevel, WordToken, PopupPosition, SentenceDeepAnalysis, SubtitleMode, AI_PRESETS, PhraseGlossItem } from '@/types';
import { DEMO_SUBTITLES } from '@/core/subtitle/demoSubtitles';
import { parseSubtitleContent, shiftSubtitleTime, segmentCuesLocally } from '@/core/subtitle/parser';
import { findCurrentCueIndex, findPreviousCueIndex, findNextCueIndex } from '@/core/subtitle/syncEngine';
import { tokenizeSentence } from '@/core/subtitle/tokenizer';
import {
  explainWordInContext,
  createInitialWordExplanation,
  abortActiveWordExplanation,
  generateWordExtendedExamples
} from '@/core/dictionary/aiExplainer';
import {
  analyzeSentenceInContext,
  streamSentenceAnalysis,
  parseMarkdownAnalysis,
  generateOfflineSentenceAnalysis
} from '@/core/ai/sentenceAnalyzer';
import { VideoPlayerAdapter } from '@/core/player/BaseAdapter';
import { sanitizeVideoTitle } from '@/core/youtube/titleSanitizer';
import { evaluateAutoPause, calculateCueTargetPauseTime, areCueIdsEqual } from '@/core/player/autoPauseEngine';

interface AppStoreState {
  // Video & Subtitle state
  videoTitle: string;
  cues: SubtitleCue[];
  currentCueIndex: number;
  currentTime: number;
  isPlaying: boolean;
  repeatMode: boolean;
  autoPauseAfterSentence: boolean;
  lastPausedCueId: string | number | null;
  subtitleTimeOffset: number;
  lastVisibleSubtitleMode: SubtitleMode;
  isAdPlaying: boolean;

  currentVideoId: string | null;

  // UI state
  isSidePanelOpen: boolean;
  sidePanelTab: 'subtitles' | 'vocabulary' | 'saved';
  searchQuery: string;
  isSettingsModalOpen: boolean;
  isExportModalOpen: boolean;

  // Word popup state
  selectedWord: string | null;
  wordExplanation: WordExplanation | null;
  isLoadingExplanation: boolean;
  isLoadingExtendedExamples: boolean;
  popupPosition: PopupPosition | null;

  // Sentence Deep Analysis state (Requirement 3)
  selectedSentenceCue: SubtitleCue | null;
  sentenceAnalysis: SentenceDeepAnalysis | null;
  streamingAnalysisText: string;
  isStreamingAnalysis: boolean;
  sentenceAnalysisError: string | null;
  isLoadingSentenceAnalysis: boolean;
  isSentenceAnalysisOpen: boolean;


  // Saved words & vocabulary
  savedWords: SavedWord[];

  // Settings
  settings: AppSettings;

  // Actions
  setVideoId: (videoId: string | null) => void;
  setVideoTitle: (title: string) => void;
  setCues: (cues: SubtitleCue[], videoId?: string) => void;
  segmentAndReplaceCues: (rawCues: SubtitleCue[]) => Promise<void>;
  updateCueTranslations: (updates: Array<{ id: number | string; textZh: string }>) => void;
  updateCueMixedTranslations: (updates: Array<{ id: number | string; textZh?: string; tokens?: WordToken[]; mixedPhrases?: PhraseGlossItem[] }>) => void;
  resetMixedGlossCuesAndRetranslate: () => void;
  updateCueTranslation: (cueId: number | string, textZh: string) => void;
  loadDemoSubtitles: () => void;
  loadSubtitleFileContent: (rawContent: string, fileName?: string) => void;
  adjustTimeOffset: (offsetDelta: number) => void;
  updateCurrentTime: (time: number, player?: VideoPlayerAdapter) => void;
  seekToCue: (index: number, player: VideoPlayerAdapter) => void;
  prevCue: (player: VideoPlayerAdapter) => void;
  nextCue: (player: VideoPlayerAdapter) => void;
  repeatCurrentCue: (player: VideoPlayerAdapter) => void;
  togglePlay: (player: VideoPlayerAdapter) => void;
  setIsAdPlaying: (isAd: boolean) => void;
  
  // Subtitle visibility & mode actions (Requirement 2)
  setSubtitleMode: (mode: SubtitleMode) => void;
  cycleSubtitleMode: () => void;
  toggleSubtitleVisibility: () => void;
  
  selectWord: (word: string, contextEn: string, contextZh: string, pos?: PopupPosition) => Promise<void>;
  fetchWordExtendedExamples: (forceRefresh?: boolean) => Promise<void>;
  closeWordPopup: () => void;
  analyzeSentence: (cue: SubtitleCue, player?: any, forceRefresh?: boolean) => Promise<void>;
  closeSentenceAnalysis: () => void;
  abortActiveSentenceAnalysis: () => void;
  saveOrUpdateWord: (word: string, level: MasteryLevel, contextEn?: string, contextZh?: string) => void;
  removeSavedWord: (word: string) => void;
  
  setSidePanelOpen: (open: boolean) => void;
  setSettingsModalOpen: (open: boolean) => void;
  setExportModalOpen: (open: boolean) => void;
  setSidePanelTab: (tab: 'subtitles' | 'vocabulary' | 'saved') => void;
  setSearchQuery: (q: string) => void;
  setRepeatMode: (repeat: boolean) => void;
  setAutoPauseAfterSentence: (autoPause: boolean) => void;
  setLastPausedCueId: (id: string | number | null) => void;
  handleAutoPauseSeek: (time: number) => void;
  updateSettings: (newSettings: Partial<AppSettings>) => void;
  
  exportSavedWordsAnki: () => string;
  exportSavedWordsJson: () => string;
  exportSavedWordsCsv: () => string;
}

export const STORAGE_KEY_SETTINGS = 'lr_app_settings';
export const STORAGE_KEY_SECURITY_MIGRATION = 'vocabframe_security_migration_v1';

const DEFAULT_SETTINGS: AppSettings = {
  pluginEnabled: true,
  aiProvider: 'google',
  apiKey: '',
  apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  modelName: 'gemini-2.5-flash',
  uiLanguage: 'zh-CN',
  primaryLang: 'en',
  secondaryLang: 'zh-CN',
  subtitleMode: 'both',
  subtitleFontSize: 18,
  transcriptFontSize: 15,
  sidePanelWidth: 420,
  subtitleBottomPercent: 8,
  subtitleOpacity: 0.85,
  showEnglish: true,
  showChinese: true,
  showTranslationInMixedMode: true,
  mixedModeFilterLevel: 'all_content',
  mixedGlossDensity: 'medium',
  maskChinese: false,
  maskEnglish: false,
  autoPauseOnHover: false,
  autoPauseAfterSentence: false,
  highlightVocabulary: true,
  subtitleTimeOffset: 0,
  repeatCount: 1,
  playbackSpeed: 1.0,
  hotkeys: {
    prevCue: 'KeyA',
    nextCue: 'KeyD',
    repeatCue: 'KeyS',
    playPause: 'Space',
    toggleSubtitle: 'KeyV',
    cycleSubtitleMode: '',
    toggleSidePanel: 'KeyE',
    offsetMinus: 'BracketLeft',
    offsetPlus: 'BracketRight'
  }
};

const INITIAL_SAVED_WORDS: SavedWord[] = [
  {
    id: 'init-1',
    word: 'productivity',
    phonetic: '/ˌprɒdʌkˈtɪvəti/',
    quickCn: '生产率，效率，生产力',
    contextSentenceEn: 'figured why don\'t I also show you my AI productivity and focus system.',
    contextSentenceZh: '想，为什么不也向你们展示一下我的 AI 生产力和专注力系统呢？',
    timestamp: Date.now(),
    level: 'learning',
    cefr: 'B2',
    collins: 4
  },
  {
    id: 'init-2',
    word: 'creator',
    phonetic: '/kriˈeɪtər/',
    quickCn: '创作者，创造者',
    contextSentenceEn: 'I am a content creator and I also run an AI education company.',
    contextSentenceZh: '我是一名内容创作者，同时我也经营一家AI教育公司。',
    timestamp: Date.now() - 3600000,
    level: 'known',
    cefr: 'B1',
    collins: 3
  }
];

const getSavedWordsMap = (words: SavedWord[] = INITIAL_SAVED_WORDS) => {
  const map = new Map<string, SavedWord>();
  if (Array.isArray(words)) {
    words.forEach(w => map.set(w.word.toLowerCase(), w));
  }
  return map;
};

const processCuesWithWords = (rawCues: SubtitleCue[], words: SavedWord[] = INITIAL_SAVED_WORDS): SubtitleCue[] => {
  const map = getSavedWordsMap(words);
  return (rawCues || []).map(cue => {
    // If cue already has tokens with key phrases or is AI refined, preserve them and only update word mastery level!
    if (cue.tokens && cue.tokens.length > 0 && (cue.isAiRefined || cue.isMixedRefined || cue.mixedPhrases !== undefined || cue.tokens.some(t => t.isKeyPhrase))) {
      const updatedTokens = cue.tokens.map(token => {
        if (!token.isWord) return token;
        const lemma = token.lemma || token.text.toLowerCase();
        let level: WordToken['level'] = 'new';
        if (map.has(lemma)) {
          level = map.get(lemma)!.level;
        } else if (map.has(token.text.toLowerCase())) {
          level = map.get(token.text.toLowerCase())!.level;
        }
        return token.level !== level ? { ...token, level } : token;
      });
      return {
        ...cue,
        tokens: updatedTokens
      };
    }

    return {
      ...cue,
      tokens: tokenizeSentence(cue.textEn, map)
    };
  });
};

let activeSentenceAnalysisAbortController: AbortController | null = null;
const sentenceAnalysisMemoryCache = new Map<string, { analysis: SentenceDeepAnalysis; text: string }>();
let currentSegmentationSessionId = 0;

export const clearSentenceAnalysisCache = () => {
  sentenceAnalysisMemoryCache.clear();
};

export const abortActiveSentenceAnalysis = () => {
  if (activeSentenceAnalysisAbortController) {
    activeSentenceAnalysisAbortController.abort();
    activeSentenceAnalysisAbortController = null;
  }
};

export const useAppStore = create<AppStoreState>((set, get) => {
  return {
    videoTitle: '',
    cues: [],
    currentCueIndex: -1,
    currentTime: 0,
    isPlaying: false,
    repeatMode: false,
    autoPauseAfterSentence: false,
    lastPausedCueId: null,
    subtitleTimeOffset: 0,

    isSidePanelOpen: true,
    sidePanelTab: 'subtitles',
    searchQuery: '',
    isSettingsModalOpen: false,
    isExportModalOpen: false,

    selectedWord: null,
    wordExplanation: null,
    isLoadingExplanation: false,
    isLoadingExtendedExamples: false,
    popupPosition: null,

    selectedSentenceCue: null,
    sentenceAnalysis: null,
    streamingAnalysisText: '',
    isStreamingAnalysis: false,
    sentenceAnalysisError: null,
    isLoadingSentenceAnalysis: false,
    isSentenceAnalysisOpen: false,

    savedWords: INITIAL_SAVED_WORDS,
    settings: DEFAULT_SETTINGS,
    isAdPlaying: false,
    currentVideoId: null,

    setIsAdPlaying: (isAdPlaying) => {
      set({ isAdPlaying, lastPausedCueId: null });
    },

    setVideoId: (videoId) => {
      const prev = get().currentVideoId;
      if (prev && videoId && prev !== videoId) {
        clearSentenceAnalysisCache();
        abortActiveSentenceAnalysis();
        set({
          currentVideoId: videoId,
          cues: [],
          currentCueIndex: -1,
          currentTime: 0,
          lastPausedCueId: null,
          videoTitle: '',
          selectedSentenceCue: null,
          sentenceAnalysis: null,
          streamingAnalysisText: '',
          isStreamingAnalysis: false,
          sentenceAnalysisError: null,
          isLoadingSentenceAnalysis: false,
          isSentenceAnalysisOpen: false
        });
        return;
      }
      set({ currentVideoId: videoId });
    },

    setVideoTitle: (title) => {
      if (get().isAdPlaying && title) {
        // Strictly protect videoTitle from being corrupted by ad metadata
        return;
      }
      set({ videoTitle: sanitizeVideoTitle(title) });
    },

    setCues: (cues, videoId) => {
      const currentCues = get().cues;
      const currentWords = get().savedWords || INITIAL_SAVED_WORDS;
      const curVid = get().currentVideoId;

      if (!cues || cues.length === 0) {
        set({ cues: [], currentCueIndex: -1, lastPausedCueId: null });
        return;
      }

      // If videoId is provided and differs from currentVideoId, strictly do not merge refined cues from old video!
      const isSwitchingVideo = Boolean(videoId && curVid && videoId !== curVid);
      if (isSwitchingVideo) {
        clearSentenceAnalysisCache();
        abortActiveSentenceAnalysis();
        const processed = processCuesWithWords(cues, currentWords);
        set({
          currentVideoId: videoId || null,
          cues: processed,
          currentCueIndex: processed.length > 0 ? 0 : -1,
          lastPausedCueId: null
        });
        return;
      }

      if (videoId && !curVid) {
        set({ currentVideoId: videoId });
      }

      // Check if current cues have AI refined subtitles that should NOT be overwritten by raw incoming cues for the same video
      const refinedByText = new Map<string, SubtitleCue[]>();
      for (const c of currentCues) {
        if (c.isAiRefined || c.isMixedRefined || c.mixedPhrases !== undefined || c.tokens?.some(t => t.isKeyPhrase)) {
          const norm = (c.textEn || '').trim().toLowerCase().replace(/[^\w]/g, '');
          if (norm) {
            const list = refinedByText.get(norm) || [];
            list.push(c);
            refinedByText.set(norm, list);
          }
        }
      }

      const mergedCues = cues.map(cue => {
        if (cue.isAiRefined) return cue;
        const norm = (cue.textEn || '').trim().toLowerCase().replace(/[^\w]/g, '');
        const candidates = norm ? refinedByText.get(norm) : undefined;
        if (candidates && candidates.length > 0) {
          // Find closest candidate in start time
          let bestIdx = 0;
          let minDiff = Math.abs(candidates[0].start - cue.start);
          for (let i = 1; i < candidates.length; i++) {
            const diff = Math.abs(candidates[i].start - cue.start);
            if (diff < minDiff) {
              minDiff = diff;
              bestIdx = i;
            }
          }

          // If unique occurrence in video, allow wide window (e.g. 30s); if multiple, require reasonable proximity (e.g. 12s)
          const maxAllowedDiff = candidates.length === 1 ? 30.0 : 12.0;
          if (minDiff <= maxAllowedDiff) {
            const existingRefined = candidates[bestIdx];
            candidates.splice(bestIdx, 1);
            return {
              ...cue,
              textZh: existingRefined.textZh || cue.textZh,
              tokens: existingRefined.tokens || cue.tokens,
              mixedPhrases: existingRefined.mixedPhrases,
              isAiRefined: true,
              isMixedRefined: existingRefined.isMixedRefined
            };
          }
        }
        return cue;
      });

      const processed = processCuesWithWords(mergedCues, currentWords);
      const { currentTime, currentCueIndex } = get();

      let targetIndex = -1;
      if (processed.length > 0) {
        if (currentTime > 0) {
          targetIndex = findCurrentCueIndex(processed, currentTime, currentCueIndex);
        }
        if (targetIndex === -1) {
          if (currentCueIndex >= 0 && currentCueIndex < processed.length) {
            targetIndex = currentCueIndex;
          } else if (currentTime > 0) {
            const prevIdx = findPreviousCueIndex(processed, -1, currentTime);
            targetIndex = prevIdx >= 0 ? prevIdx : 0;
          } else {
            targetIndex = 0;
          }
        }
      }

      let resolvedPausedCueId: string | number | null = null;
      if (currentTime > 0 && processed.length > 0) {
        const prevIdx = findPreviousCueIndex(processed, -1, currentTime);
        if (prevIdx >= 0 && prevIdx < processed.length && processed[prevIdx].end <= currentTime + 0.05) {
          const prevCue = processed[prevIdx];
          const nextCue = prevIdx + 1 < processed.length ? processed[prevIdx + 1] : undefined;
          const targetPause = calculateCueTargetPauseTime(prevCue, nextCue);
          if (currentTime >= targetPause - 0.05) {
            resolvedPausedCueId = prevCue.id;
          }
        }
      }

      set({ cues: processed, currentCueIndex: targetIndex, lastPausedCueId: resolvedPausedCueId });
    },

    segmentAndReplaceCues: async (rawCues) => {
      if (!rawCues || rawCues.length === 0) return;

      const sessionId = ++currentSegmentationSessionId;

      // 1. Zero-latency immediate rendering: initial subtitles render immediately (within 10ms) using fast local fallback
      const localCues = segmentCuesLocally(rawCues);
      get().setCues(localCues);

      // 2. When an AI key is configured, trigger asynchronous chunked sentence segmentation
      const apiKey = (get().settings?.apiKey || '').trim();
      if (!apiKey) return;

      try {
        const { semanticSegmenter } = await import('@/core/ai/semanticSegmenter');
        const enhanced = await semanticSegmenter.segmentTranscript(rawCues);

        // Guard against stale race condition (e.g. video switch while awaiting AI segmentation)
        if (sessionId !== currentSegmentationSessionId) return;

        if (enhanced && enhanced.length > 0) {
          // Hot-swap the segmented complete sentences into useAppStore seamlessly
          get().setCues(enhanced);

          // Trigger bilingual translation on the newly formed complete sentences
          const { bilingualTranslator } = await import('@/core/ai/bilingualTranslator');
          bilingualTranslator.scheduleSlidingWindowTranslation(get().currentTime);
        }
      } catch (err) {
        console.warn('[useAppStore] AI semantic segmentation fallback to local cues:', err);
      }
    },

    updateCueTranslations: (updates) => {
      if (!updates || updates.length === 0) return;
      const map = new Map<number, string>();
      for (const u of updates) {
        if (!u) continue;
        const idNum = Number(u.id);
        const textZh = typeof u.textZh === 'string' ? u.textZh.trim() : '';
        if (!isNaN(idNum) && Number.isFinite(idNum) && textZh.length > 0) {
          map.set(idNum, textZh);
        }
      }
      if (map.size === 0) return;

      const { cues } = get();
      let changed = false;
      const nextCues = cues.map(c => {
        if (map.has(c.id)) {
          const newZh = map.get(c.id)!;
          if (c.textZh !== newZh || !c.isAiRefined) {
            changed = true;
            return { ...c, textZh: newZh, isAiRefined: true };
          }
        }
        return c;
      });

      if (changed) {
        set({ cues: nextCues });
      }
    },

    updateCueMixedTranslations: (updates) => {
      if (!updates || updates.length === 0) return;
      const map = new Map<number, { textZh?: string; tokens?: WordToken[]; mixedPhrases?: PhraseGlossItem[] }>();
      for (const u of updates) {
        if (!u) continue;
        const idNum = Number(u.id);
        if (!isNaN(idNum) && Number.isFinite(idNum)) {
          map.set(idNum, u);
        }
      }
      if (map.size === 0) return;

      const { cues } = get();
      let changed = false;
      const nextCues = cues.map(c => {
        if (map.has(c.id)) {
          const u = map.get(c.id)!;
          changed = true;
          return {
            ...c,
            ...(u.textZh !== undefined ? { textZh: u.textZh } : {}),
            ...(u.tokens ? { tokens: u.tokens } : {}),
            ...(u.mixedPhrases ? { mixedPhrases: u.mixedPhrases } : {}),
            isAiRefined: true,
            isMixedRefined: true
          };
        }
        return c;
      });

      if (changed) {
        set({ cues: nextCues });
      }
    },

    resetMixedGlossCuesAndRetranslate: () => {
      const { cues, currentTime } = get();
      import('@/core/ai/mixedGlossGenerator').then(({ mixedGlossGenerator }) => {
        mixedGlossGenerator.clearCache();
        mixedGlossGenerator.cancelBatchTranslation();
      }).catch(() => {});
      import('@/core/ai/bilingualTranslator').then(({ bilingualTranslator }) => {
        bilingualTranslator.cancelBatchTranslation();
      }).catch(() => {});

      if (cues && cues.length > 0) {
        const nextCues = cues.map(c => ({
          ...c,
          isMixedRefined: false,
          mixedPhrases: undefined,
          tokens: c.tokens?.map(t => ({
            ...t,
            phraseId: undefined,
            phraseText: undefined,
            phraseMeaning: undefined,
            isKeyPhrase: undefined,
            isPhraseStart: undefined,
            isPhraseEnd: undefined,
            contextMeaning: undefined,
          }))
        }));
        set({ cues: nextCues });

        import('@/core/ai/bilingualTranslator').then(({ bilingualTranslator }) => {
          if (bilingualTranslator.canTranslate()) {
            bilingualTranslator.translateEntireVideo(nextCues, undefined, true, currentTime).catch(() => {});
          }
        }).catch(() => {});
      }
    },

    updateCueTranslation: (cueId, textZh) => {
      get().updateCueTranslations([{ id: cueId, textZh }]);
    },

    loadDemoSubtitles: () => {
      currentSegmentationSessionId++;
      const currentWords = get().savedWords || INITIAL_SAVED_WORDS;
      set({ currentVideoId: 'demo', cues: [] });
      set({ cues: processCuesWithWords(DEMO_SUBTITLES, currentWords), currentCueIndex: 0, subtitleTimeOffset: 0 });
    },

    loadSubtitleFileContent: (rawContent, fileName) => {
      currentSegmentationSessionId++;
      const parsed = parseSubtitleContent(rawContent);
      if (parsed && parsed.length > 0) {
        const currentWords = get().savedWords || INITIAL_SAVED_WORDS;
        set({ currentVideoId: fileName || 'file', cues: [] });
        const processed = processCuesWithWords(parsed, currentWords);
        const { currentTime, currentCueIndex } = get();

        let targetIndex = -1;
        if (currentTime > 0) {
          targetIndex = findCurrentCueIndex(processed, currentTime, currentCueIndex);
          if (targetIndex === -1) {
            const prevIdx = findPreviousCueIndex(processed, -1, currentTime);
            targetIndex = prevIdx >= 0 ? prevIdx : 0;
          }
        }
        if (targetIndex === -1) {
          targetIndex = 0;
        }

        set({
          currentVideoId: fileName || 'file',
          cues: processed,
          currentCueIndex: targetIndex,
          subtitleTimeOffset: 0,
          videoTitle: fileName ? sanitizeVideoTitle(fileName) : get().videoTitle,
          lastPausedCueId: null
        });
        console.log(`[VocabFrame] Loaded ${parsed.length} subtitle cues.`);

        // Proactively trigger sliding window AI translation around current playback head
        const apiKey = (get().settings?.apiKey || '').trim();
        if (apiKey) {
          import('@/core/ai/bilingualTranslator').then(({ bilingualTranslator }) => {
            bilingualTranslator.scheduleSlidingWindowTranslation(get().currentTime);
          }).catch(() => {});
        }
      }
    },

    adjustTimeOffset: (offsetDelta: number) => {
      const { cues, subtitleTimeOffset } = get();
      if (!cues || cues.length === 0) return;
      const shifted = shiftSubtitleTime(cues, offsetDelta);
      set({
        cues: shifted,
        subtitleTimeOffset: Math.round((subtitleTimeOffset + offsetDelta) * 10) / 10
      });
    },

    updateCurrentTime: (time, player) => {
      const { cues, currentCueIndex, repeatMode, autoPauseAfterSentence, isAdPlaying } = get();

      // Clear expired ad caption so overlay stays cleanly empty when ad speech ends
      if (isAdPlaying && cues.length > 0 && time > cues[cues.length - 1].end + 0.3) {
        set({ cues: [], currentCueIndex: -1, currentTime: time });
        return;
      }

      if (!cues || cues.length === 0) {
        set({ currentTime: time });
        return;
      }

      const newIndex = findCurrentCueIndex(cues, time, currentCueIndex);
      
      // 1. Single-sentence repeat loop mode (strictly disabled during ads)
      if (!isAdPlaying && repeatMode && currentCueIndex >= 0 && currentCueIndex < cues.length && player) {
        const curCue = cues[currentCueIndex];
        if (time >= curCue.end) {
          player.seek(curCue.start);
          return;
        }
      }

      // 2. Auto-pause after sentence (for shadowing practice, strictly disabled during ads)
      if (!isAdPlaying && autoPauseAfterSentence && cues.length > 0 && player) {
        const video = player.getVideoElement();
        const playbackRate = (video && video.playbackRate > 0) ? video.playbackRate : 1.0;
        const duration = player.getDuration ? player.getDuration() : undefined;
        const decision = evaluateAutoPause({
          cues,
          currentCueIndex: newIndex !== -1 ? newIndex : currentCueIndex,
          currentTime: time,
          autoPauseAfterSentence,
          isAdPlaying,
          repeatMode,
          lastPausedCueId: get().lastPausedCueId,
          playbackRate,
          duration
        });

        if (decision.resetPausedId) {
          set({ lastPausedCueId: null });
        }

        if (decision.shouldPause && decision.targetCueId !== undefined && decision.targetCueId !== null) {
          player.pause();
          const targetTime = decision.seekTime ?? decision.targetPauseTime ?? time;
          if (decision.seekTime !== undefined && Math.abs(time - decision.seekTime) > 0.04) {
            player.seek(decision.seekTime);
          }
          const targetIndex = cues.findIndex((c) => areCueIdsEqual(c.id, decision.targetCueId));
          set({
            lastPausedCueId: decision.targetCueId,
            isPlaying: false,
            currentTime: targetTime,
            ...(targetIndex !== -1 ? { currentCueIndex: targetIndex } : {})
          });
          return;
        }
      }

      if (newIndex !== currentCueIndex && newIndex !== -1) {
        set({ currentTime: time, currentCueIndex: newIndex });
      } else if (newIndex === -1) {
        // When in a silence gap, check if user seeked or time jumped far from current cue
        const curCue = currentCueIndex >= 0 && currentCueIndex < cues.length ? cues[currentCueIndex] : null;
        const isFarAway = !curCue || time < curCue.start - 0.5 || time > curCue.end + 4.0;
        if (isFarAway) {
          const prevIdx = findPreviousCueIndex(cues, -1, time);
          const targetIdx = prevIdx >= 0 ? prevIdx : 0;
          if (targetIdx !== currentCueIndex) {
            set({ currentTime: time, currentCueIndex: targetIdx });
            return;
          }
        }
        set({ currentTime: time });
      } else {
        set({ currentTime: time });
      }
    },

    seekToCue: (index, player) => {
      if (get().isAdPlaying) return;
      const { cues } = get();
      if (index >= 0 && index < cues.length) {
        const targetCue = cues[index];
        player.seek(targetCue.start);
        set({ currentCueIndex: index, currentTime: targetCue.start, lastPausedCueId: null });
      }
    },

    prevCue: (player) => {
      if (get().isAdPlaying) return;
      const { cues, currentCueIndex, currentTime } = get();
      const prevIdx = findPreviousCueIndex(cues, currentCueIndex, currentTime);
      if (prevIdx !== -1) {
        get().seekToCue(prevIdx, player);
      }
    },

    nextCue: (player) => {
      if (get().isAdPlaying) return;
      const { cues, currentCueIndex, currentTime } = get();
      const nextIdx = findNextCueIndex(cues, currentCueIndex, currentTime);
      if (nextIdx !== -1) {
        get().seekToCue(nextIdx, player);
      }
    },

    repeatCurrentCue: (player) => {
      if (get().isAdPlaying) return;
      const { cues, currentCueIndex } = get();
      if (currentCueIndex >= 0 && currentCueIndex < cues.length) {
        get().seekToCue(currentCueIndex, player);
        player.play();
      }
    },

    togglePlay: (player) => {
      player.togglePlay();
      set({ isPlaying: !player.isPaused() });
    },

    lastVisibleSubtitleMode: 'both',

    setSubtitleMode: (mode: SubtitleMode) => {
      if (mode !== 'hidden') {
        set({ lastVisibleSubtitleMode: mode });
      }
      const showEnglish = mode === 'both' || mode === 'target' || mode === 'mixed';
      const showChinese = mode === 'both' || mode === 'translation';
      get().updateSettings({
        subtitleMode: mode,
        showEnglish,
        showChinese
      });
    },

    cycleSubtitleMode: () => {
      const modes: SubtitleMode[] = ['both', 'mixed', 'target', 'translation', 'hidden'];
      const current = get().settings.subtitleMode || 'both';
      const nextIndex = (modes.indexOf(current) + 1) % modes.length;
      const nextMode = modes[nextIndex];
      if (nextMode === 'hidden') {
        set({
          selectedWord: null,
          wordExplanation: null,
          popupPosition: null,
          isSentenceAnalysisOpen: false,
          selectedSentenceCue: null,
          sentenceAnalysis: null
        });
      }
      get().setSubtitleMode(nextMode);
    },

    toggleSubtitleVisibility: () => {
      const current = get().settings.subtitleMode || 'both';
      if (current === 'hidden') {
        const last = get().lastVisibleSubtitleMode || 'both';
        get().setSubtitleMode(last);
      } else {
        set({
          lastVisibleSubtitleMode: current,
          selectedWord: null,
          wordExplanation: null,
          popupPosition: null,
          isSentenceAnalysisOpen: false,
          selectedSentenceCue: null,
          sentenceAnalysis: null
        });
        get().setSubtitleMode('hidden');
      }
    },

    selectWord: async (word, contextEn, contextZh, pos) => {
      // 1. Invalidate any in-flight requests from previously clicked words
      abortActiveWordExplanation();

      // Automatically close AI sentence analysis if open to prevent modal overlap
      if (get().isSentenceAnalysisOpen) {
        abortActiveSentenceAnalysis();
        set({
          isSentenceAnalysisOpen: false,
          selectedSentenceCue: null,
          sentenceAnalysis: null,
          streamingAnalysisText: '',
          isStreamingAnalysis: false,
          sentenceAnalysisError: null,
          isLoadingSentenceAnalysis: false
        });
      }


      const { settings, savedWords } = get();
      const existing = (savedWords || []).find(w => w.word.toLowerCase() === word.toLowerCase());
      const level = existing ? existing.level : 'new';

      // 2. Synchronous 0ms Staged Rendering: Immediately display local dictionary definition & phonetic
      const initialExplanation = createInitialWordExplanation(word, contextEn, contextZh, level);

      const defaultPos: PopupPosition = typeof window !== 'undefined'
        ? { x: window.innerWidth / 2 - 195, y: window.innerHeight / 2 - 200, placement: 'bottom' }
        : { x: 200, y: 200, placement: 'bottom' };

      set({
        selectedWord: word,
        wordExplanation: initialExplanation,
        isLoadingExplanation: true,
        isLoadingExtendedExamples: false,
        popupPosition: pos || defaultPos
      });

      // 3. Asynchronously fetch Grok 4.6 context analysis and smoothly enhance
      try {
        const explanation = await explainWordInContext(word, contextEn, contextZh, settings, level);
        // Ensure user hasn't selected another word or closed popup in the meantime
        if (get().selectedWord === word) {
          const currentExp = get().wordExplanation;
          const mergedExplanation = {
            ...explanation,
            aiExtendedExamples: currentExp?.aiExtendedExamples || explanation.aiExtendedExamples
          };
          set({ wordExplanation: mergedExplanation, isLoadingExplanation: false });
        }
      } catch (err) {
        console.error('Failed to explain word:', err);
        if (get().selectedWord === word) {
          set({ isLoadingExplanation: false });
        }
      }
    },

    fetchWordExtendedExamples: async (forceRefresh = false) => {
      const { selectedWord, wordExplanation, settings, isLoadingExtendedExamples } = get();
      if (!selectedWord || isLoadingExtendedExamples) return;

      // If already has examples and not forced refresh, avoid duplicate LLM calls
      if (!forceRefresh && wordExplanation?.aiExtendedExamples && wordExplanation.aiExtendedExamples.length >= 3) {
        return;
      }

      set({ isLoadingExtendedExamples: true });

      const contextEn = wordExplanation?.contextSentenceEn || '';
      const contextZh = wordExplanation?.contextSentenceZh || '';

      try {
        const examples = await generateWordExtendedExamples(selectedWord, contextEn, contextZh, settings);
        if (get().selectedWord === selectedWord) {
          const currentExp = get().wordExplanation;
          if (currentExp) {
            set({
              wordExplanation: {
                ...currentExp,
                aiExtendedExamples: examples
              },
              isLoadingExtendedExamples: false
            });
          } else {
            set({ isLoadingExtendedExamples: false });
          }
        }
      } catch (err) {
        console.error('[useAppStore] Failed to fetch extended examples:', err);
        if (get().selectedWord === selectedWord) {
          set({ isLoadingExtendedExamples: false });
        }
      }
    },

    closeWordPopup: () => {
      abortActiveWordExplanation();
      set({
        selectedWord: null,
        wordExplanation: null,
        popupPosition: null,
        isLoadingExplanation: false,
        isLoadingExtendedExamples: false
      });
    },

    analyzeSentence: async (cue, player, forceRefresh = false) => {
      if (get().isAdPlaying) return;

      // Automatically close WordPopup if open to prevent modal overlap
      if (get().selectedWord) {
        get().closeWordPopup();
      }

      // Abort any active sentence analysis stream
      abortActiveSentenceAnalysis();

      if (player && typeof player.pause === 'function') {
        try {
          player.pause();
        } catch (e) {
          console.warn('[useAppStore] Failed to pause playback during sentence analysis:', e);
        }
      }

      const cacheKey = (cue.textEn || '').trim().toLowerCase();
      if (!forceRefresh && cacheKey && sentenceAnalysisMemoryCache.has(cacheKey)) {
        const cached = sentenceAnalysisMemoryCache.get(cacheKey)!;
        set({
          isPlaying: false,
          selectedSentenceCue: cue,
          isSentenceAnalysisOpen: true,
          isLoadingSentenceAnalysis: false,
          isStreamingAnalysis: false,
          sentenceAnalysis: cached.analysis,
          streamingAnalysisText: cached.text,
          sentenceAnalysisError: null
        });
        return;
      }

      const apiKey = (get().settings.apiKey || '').trim();
      // If no API key configured, record offline fallback for contract/test compatibility
      // and mark MISSING_API_KEY so UI prompts user to configure key without fake boilerplate
      if (!apiKey) {
        const offlineAnalysis = generateOfflineSentenceAnalysis(cue);
        set({
          isPlaying: false,
          selectedSentenceCue: cue,
          isSentenceAnalysisOpen: true,
          isLoadingSentenceAnalysis: false,
          isStreamingAnalysis: false,
          sentenceAnalysis: offlineAnalysis,
          sentenceAnalysisError: 'MISSING_API_KEY',
          streamingAnalysisText: ''
        });
        return;
      }

      const abortController = new AbortController();
      activeSentenceAnalysisAbortController = abortController;

      set({
        isPlaying: false,
        selectedSentenceCue: cue,
        isSentenceAnalysisOpen: true,
        isLoadingSentenceAnalysis: true,
        isStreamingAnalysis: true,
        streamingAnalysisText: '',
        sentenceAnalysisError: null,
        sentenceAnalysis: null
      });

      try {
        const streamResult = await streamSentenceAnalysis(
          cue,
          get().settings,
          (_delta, accumulated) => {
            set({
              streamingAnalysisText: accumulated,
              isLoadingSentenceAnalysis: false
            });
          },
          abortController.signal
        );

        const parsed = parseMarkdownAnalysis(streamResult, cue);
        if (cacheKey) {
          sentenceAnalysisMemoryCache.set(cacheKey, { analysis: parsed, text: streamResult });
          if (sentenceAnalysisMemoryCache.size > 50) {
            const firstKey = sentenceAnalysisMemoryCache.keys().next().value;
            if (firstKey) sentenceAnalysisMemoryCache.delete(firstKey);
          }
        }
        set({
          sentenceAnalysis: parsed,
          streamingAnalysisText: streamResult,
          isStreamingAnalysis: false,
          isLoadingSentenceAnalysis: false,
          sentenceAnalysisError: null
        });
      } catch (err: any) {
        if (abortController.signal.aborted) {
          return;
        }
        console.warn('[useAppStore] Failed to analyze sentence:', err);
        const isMissingKey = err?.isMissingApiKey || err?.message === 'MISSING_API_KEY';
        const errMsg = isMissingKey
          ? 'MISSING_API_KEY'
          : err?.message || '请求解析失败，请检查网络或配置';

        set({
          isLoadingSentenceAnalysis: false,
          isStreamingAnalysis: false,
          sentenceAnalysisError: errMsg
        });
      } finally {
        if (activeSentenceAnalysisAbortController === abortController) {
          activeSentenceAnalysisAbortController = null;
        }
      }
    },

    closeSentenceAnalysis: () => {
      abortActiveSentenceAnalysis();
      set({
        isSentenceAnalysisOpen: false,
        selectedSentenceCue: null,
        sentenceAnalysis: null,
        streamingAnalysisText: '',
        isStreamingAnalysis: false,
        isLoadingSentenceAnalysis: false,
        sentenceAnalysisError: null
      });
    },

    abortActiveSentenceAnalysis: () => {
      abortActiveSentenceAnalysis();
    },


    saveOrUpdateWord: (word, level, contextEn = '', contextZh = '') => {
      const { savedWords, cues, wordExplanation } = get();
      const cleanWord = word.trim();
      const list = savedWords || [];
      const existingIndex = list.findIndex(w => w.word.toLowerCase() === cleanWord.toLowerCase());

      let updatedList: SavedWord[];
      if (existingIndex >= 0) {
        updatedList = [...list];
        updatedList[existingIndex] = {
          ...updatedList[existingIndex],
          level,
          timestamp: Date.now()
        };
      } else {
        const newEntry: SavedWord = {
          id: `word-${Date.now()}`,
          word: cleanWord,
          phonetic: wordExplanation?.phonetic || `/${cleanWord}/`,
          quickCn: wordExplanation?.quickCn || '已标记词汇',
          contextSentenceEn: contextEn || wordExplanation?.contextSentenceEn || '',
          contextSentenceZh: contextZh || wordExplanation?.contextSentenceZh || '',
          timestamp: Date.now(),
          level,
          cefr: wordExplanation?.cefr || 'B1',
          collins: wordExplanation?.collins || 3
        };
        updatedList = [newEntry, ...list];
      }

      // Update explanation level if open
      let newExpl = wordExplanation;
      if (wordExplanation && wordExplanation.word.toLowerCase() === cleanWord.toLowerCase()) {
        newExpl = { ...wordExplanation, level };
      }

      set({
        savedWords: updatedList,
        wordExplanation: newExpl,
        cues: processCuesWithWords(cues, updatedList)
      });
    },

    removeSavedWord: (word) => {
      const { savedWords, cues } = get();
      const updatedList = (savedWords || []).filter(w => w.word.toLowerCase() !== word.toLowerCase());
      set({
        savedWords: updatedList,
        cues: processCuesWithWords(cues, updatedList)
      });
    },

    setSidePanelOpen: (open) => set({ isSidePanelOpen: open }),
    setSettingsModalOpen: (open) => set({ isSettingsModalOpen: open }),
    setExportModalOpen: (open) => set({ isExportModalOpen: open }),
    setSidePanelTab: (tab) => set({ sidePanelTab: tab }),
    setSearchQuery: (q) => set({ searchQuery: q }),
    setRepeatMode: (repeat) => set({ repeatMode: repeat }),
    setAutoPauseAfterSentence: (autoPause) => set({ autoPauseAfterSentence: autoPause, lastPausedCueId: null }),
    setLastPausedCueId: (id) => set({ lastPausedCueId: id }),
    handleAutoPauseSeek: (time) => {
      const { cues } = get();
      if (!cues || cues.length === 0) {
        set({ lastPausedCueId: null });
        return;
      }
      const prevIdx = findPreviousCueIndex(cues, -1, time);
      if (prevIdx >= 0 && prevIdx < cues.length && cues[prevIdx].end <= time + 0.05) {
        const prevCue = cues[prevIdx];
        const nextCue = prevIdx + 1 < cues.length ? cues[prevIdx + 1] : undefined;
        const targetPause = calculateCueTargetPauseTime(prevCue, nextCue);
        if (time >= Math.min(prevCue.end, targetPause) - 0.05) {
          set({ lastPausedCueId: prevCue.id });
          return;
        }
      }
      set({ lastPausedCueId: null });
    },
    updateSettings: (newSettings) => {
      const prevDensity = get().settings.mixedGlossDensity;
      const densityChanged = newSettings.mixedGlossDensity !== undefined && newSettings.mixedGlossDensity !== prevDensity;

      set((state) => {
        const updated = { ...state.settings, ...newSettings };
        // If provider changed and apiBaseUrl / modelName were not explicitly given, populate preset defaults
        if (newSettings.aiProvider && newSettings.aiProvider !== state.settings.aiProvider) {
          const newPreset = AI_PRESETS[newSettings.aiProvider];
          const oldPreset = AI_PRESETS[state.settings.aiProvider];
          if (newPreset) {
            if (newSettings.apiBaseUrl === undefined && (!state.settings.apiBaseUrl || state.settings.apiBaseUrl === oldPreset?.apiBaseUrl)) {
              updated.apiBaseUrl = newPreset.apiBaseUrl;
            }
            if (newSettings.modelName === undefined && (!state.settings.modelName || state.settings.modelName === oldPreset?.modelName)) {
              updated.modelName = newPreset.modelName;
            }
          }
        }
        if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
          try {
            chrome.storage.local.set({ [STORAGE_KEY_SETTINGS]: updated });
          } catch {
            // Ignore write errors in non-extension or restricted environments
          }
        }
        return { settings: updated };
      });

      if (densityChanged) {
        get().resetMixedGlossCuesAndRetranslate();
      }
    },

    exportSavedWordsAnki: () => {
      const { savedWords } = get();
      return (savedWords || []).map(w => 
        `${w.word}\t${w.phonetic}\t${w.quickCn}\t${w.contextSentenceEn}\t${w.contextSentenceZh}\t${w.level}\t${w.cefr || 'B1'}`
      ).join('\n');
    },

    exportSavedWordsJson: () => {
      const { savedWords } = get();
      return JSON.stringify(savedWords || [], null, 2);
    },

    exportSavedWordsCsv: () => {
      const { savedWords } = get();
      const header = 'Word,Phonetic,Translation,Context_EN,Context_ZH,Level,CEFR\n';
      const rows = (savedWords || []).map(w =>
        `"${w.word}","${w.phonetic}","${w.quickCn.replace(/"/g, '""')}","${w.contextSentenceEn.replace(/"/g, '""')}","${w.contextSentenceZh.replace(/"/g, '""')}","${w.level}","${w.cefr || 'B1'}"`
      ).join('\n');
      return header + rows;
    }
  };
});

// Asynchronous hydration and live sync with chrome.storage.local
if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
  try {
    chrome.storage.local.get([STORAGE_KEY_SETTINGS, STORAGE_KEY_SECURITY_MIGRATION], (res) => {
      if (chrome.runtime?.lastError) return;
      const storedSettings = res?.[STORAGE_KEY_SETTINGS];
      const needsCredentialReset = !res?.[STORAGE_KEY_SECURITY_MIGRATION];
      if (storedSettings) {
        const migratedSettings = needsCredentialReset
          ? { ...storedSettings, apiKey: '' }
          : storedSettings;
        useAppStore.setState((state) => ({
          settings: { ...state.settings, ...migratedSettings }
        }));
        if (needsCredentialReset) {
          chrome.storage.local.set({
            [STORAGE_KEY_SETTINGS]: migratedSettings,
            [STORAGE_KEY_SECURITY_MIGRATION]: true
          });
        }
      } else if (needsCredentialReset) {
        chrome.storage.local.set({ [STORAGE_KEY_SECURITY_MIGRATION]: true });
      }
    });

    if (chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes[STORAGE_KEY_SETTINGS]?.newValue) {
          useAppStore.setState((state) => ({
            settings: { ...state.settings, ...changes[STORAGE_KEY_SETTINGS].newValue }
          }));
        }
      });
    }
  } catch (err) {
    console.warn('[useAppStore] Storage sync init error:', err);
  }
}
