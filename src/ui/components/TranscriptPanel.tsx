import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import tailwindCss from '@/ui/styles/tailwind.css?inline';
import {
  Play,
  Settings,
  X,
  Search,
  Bookmark,
  Check,
  Star,
  Download,
  ChevronRight,
  FileText,
  Upload,
  Sparkles,
  FileJson,
  FileSpreadsheet,
  Zap,
  Loader2,
  Volume2,
  BookOpen,
  Trash2,
  ListFilter
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { AudioButton } from '@/ui/components/AudioButton';
import { VideoPlayerAdapter } from '@/core/player/BaseAdapter';
import { SubtitleCue, WordToken, SavedWord } from '@/types';
import { formatTimestamp, isChineseText } from '@/core/subtitle/parser';
import { getLocale } from '@/core/i18n';
import { sanitizeVideoTitle } from '@/core/youtube/titleSanitizer';
import { bilingualTranslator, BatchTranslationProgress, isEligibleForTranslation, isCueNeedsTranslation, detectSourceLanguage, resolveTargetLanguage } from '@/core/ai/bilingualTranslator';
const getCefrBadgeClass = (cefr?: string) => {
  if (!cefr) return 'bg-white/5 text-slate-400 border-white/10';
  const c = cefr.toUpperCase();
  if (c.startsWith('A')) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  if (c.startsWith('B')) return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
  if (c.startsWith('C')) return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
  return 'bg-white/5 text-slate-400 border-white/10';
};

interface TranscriptPanelProps {
  player: VideoPlayerAdapter;
}

export const TranscriptPanel: React.FC<TranscriptPanelProps> = ({ player }) => {
  const {
    cues,
    isAdPlaying,
    currentTime,
    currentCueIndex,
    videoTitle,
    isSidePanelOpen,
    setSidePanelOpen,
    sidePanelTab,
    setSidePanelTab,
    seekToCue,
    selectWord,
    savedWords,
    exportSavedWordsAnki,
    exportSavedWordsJson,
    exportSavedWordsCsv,
    removeSavedWord,
    loadDemoSubtitles,
    loadSubtitleFileContent,
    detectedFolderSubtitles,
    loadDetectedFolderSubtitle,
    settings,
    setSettingsModalOpen,
    setExportModalOpen,
    analyzeSentence,
    selectedSentenceCue,
    isSentenceAnalysisOpen
  } = useAppStore();

  const t = getLocale(settings.uiLanguage);

  const [searchTerm, setSearchTerm] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [savedFilter, setSavedFilter] = useState<'all' | 'learning' | 'known' | 'mastered'>('all');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const importMenuRef = useRef<HTMLDivElement>(null);
  const [batchProgress, setBatchProgress] = useState<BatchTranslationProgress>(
    bilingualTranslator.getBatchProgress()
  );
  const hostname = (typeof window !== 'undefined' && window.location?.hostname) || '';
  const isYouTube = hostname.includes('youtube.com');
  const isBilibili = hostname.includes('bilibili.com');
  const [embeddedMount, setEmbeddedMount] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!showImportMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (importMenuRef.current && !importMenuRef.current.contains(e.target as Node)) {
        setShowImportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showImportMenu]);

  // Replace recommendations in their own column (YouTube #secondary, Bilibili .right-container),
  // preserving host nodes for clean restoration when sidebar is closed.
  useEffect(() => {
    if ((!isYouTube && !isBilibili) || !isSidePanelOpen) return;
    const host = document.createElement('language-reactor-overlay');
    host.dataset.gleanTranscriptHost = 'true';
    host.setAttribute('translate', 'no');
    host.classList.add('notranslate');
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = tailwindCss + ':host{display:block;width:100%;min-width:0}';
    const mount = document.createElement('div');
    mount.className = 'language-reactor-root notranslate';
    mount.setAttribute('translate', 'no');
    shadow.append(style, mount);

    const replacementStyle = document.createElement('style');
    replacementStyle.textContent = `
      #secondary[data-glean-transcript-active] > :not([data-glean-transcript-host]):not([data-vocabframe-transcript-host]),
      #secondary-inner[data-glean-transcript-active] > :not([data-glean-transcript-host]):not([data-vocabframe-transcript-host]),
      .right-container[data-glean-transcript-active] > :not([data-glean-transcript-host]):not([data-vocabframe-transcript-host]),
      #right-container[data-glean-transcript-active] > :not([data-glean-transcript-host]):not([data-vocabframe-transcript-host]),
      .recommend-list-v1[data-glean-transcript-active] > :not([data-glean-transcript-host]):not([data-vocabframe-transcript-host]),
      #recom_list[data-glean-transcript-active] > :not([data-glean-transcript-host]):not([data-vocabframe-transcript-host]),
      .plp-r[data-glean-transcript-active] > :not([data-glean-transcript-host]):not([data-vocabframe-transcript-host]),
      .r-con[data-glean-transcript-active] > :not([data-glean-transcript-host]):not([data-vocabframe-transcript-host]),
      .playlist-container[data-glean-transcript-active] > :not([data-glean-transcript-host]):not([data-vocabframe-transcript-host]),
      .side-container[data-glean-transcript-active] > :not([data-glean-transcript-host]):not([data-vocabframe-transcript-host]),
      [class*="recommend-list"][data-glean-transcript-active] > :not([data-glean-transcript-host]):not([data-vocabframe-transcript-host]),
      #secondary[data-vocabframe-transcript-active] > :not([data-glean-transcript-host]):not([data-vocabframe-transcript-host]),
      #secondary-inner[data-vocabframe-transcript-active] > :not([data-glean-transcript-host]):not([data-vocabframe-transcript-host]),
      .right-container[data-vocabframe-transcript-active] > :not([data-glean-transcript-host]):not([data-vocabframe-transcript-host]),
      #right-container[data-vocabframe-transcript-active] > :not([data-glean-transcript-host]):not([data-vocabframe-transcript-host]),
      .recommend-list-v1[data-vocabframe-transcript-active] > :not([data-glean-transcript-host]):not([data-vocabframe-transcript-host]),
      #recom_list[data-vocabframe-transcript-active] > :not([data-glean-transcript-host]):not([data-vocabframe-transcript-host]),
      .plp-r[data-vocabframe-transcript-active] > :not([data-glean-transcript-host]):not([data-vocabframe-transcript-host]),
      .r-con[data-vocabframe-transcript-active] > :not([data-glean-transcript-host]):not([data-vocabframe-transcript-host]),
      .playlist-container[data-vocabframe-transcript-active] > :not([data-glean-transcript-host]):not([data-vocabframe-transcript-host]),
      .side-container[data-vocabframe-transcript-active] > :not([data-glean-transcript-host]):not([data-vocabframe-transcript-host]),
      [class*="recommend-list"][data-vocabframe-transcript-active] > :not([data-glean-transcript-host]):not([data-vocabframe-transcript-host]) {
        display: none !important;
      }
    `;
    if (document.head) {
      document.head.append(replacementStyle);
    }
    let secondary: HTMLElement | null = null;

    const isBilibiliFullscreenOrWeb = () => {
      if (typeof document === 'undefined') return false;
      return (
        Boolean(document.fullscreenElement) ||
        Boolean((document as any).webkitFullscreenElement) ||
        Boolean(document.body && (
          document.body.classList.contains('bpx-state-web-fullscreen') ||
          document.body.classList.contains('mode-webscreen') ||
          document.body.classList.contains('player-mode-web-fullscreen') ||
          document.body.classList.contains('bpx-state-fullscreen') ||
          document.body.getAttribute('data-screen') === 'web' ||
          document.body.getAttribute('data-screen') === 'full'
        )) ||
        Boolean(document.querySelector(
          '.bpx-state-web-fullscreen, .mode-webscreen, .player-mode-web-fullscreen, .bpx-state-fullscreen, [data-screen="web"], [data-screen="full"]'
        ))
      );
    };

    const syncSecondary = () => {
      let next: HTMLElement | null = null;
      if (isYouTube) {
        const isFullscreen = Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement);
        if (!isFullscreen) {
          const activeWatch = player.getContainer()?.closest('ytd-watch-flexy:not([hidden]), ytd-watch-grid:not([hidden])')
            || document.querySelector<HTMLElement>('ytd-watch-flexy:not([hidden]), ytd-watch-grid:not([hidden])');
          next = activeWatch?.querySelector<HTMLElement>('#secondary')
            || document.querySelector<HTMLElement>('ytd-watch-flexy:not([hidden]) #secondary, ytd-watch-grid:not([hidden]) #secondary, #columns > #secondary, #secondary');
        }
      } else if (isBilibili) {
        // Only embed into right-container in normal mode.
        // In web fullscreen or fullscreen, sidebar smoothly switches to alongside player.
        if (!isBilibiliFullscreenOrWeb()) {
          const app = document.getElementById('app');
          const isHydrating = Boolean(app && app.hasAttribute('data-server-rendered'));
          // Wait until Bilibili's Vue app has finished server-side hydration and the mini header has mounted
          const isHeaderReady = Boolean(
            document.querySelector('.bili-header--mini, .bili-header--fixed') ||
            (document.getElementById('biliMainHeader') && !isHydrating)
          );
          if (!isHydrating && isHeaderReady) {
            next = document.querySelector<HTMLElement>(
              '.right-container, #right-container, .recommend-list-v1, #recom_list, .plp-r, .r-con, .playlist-container, .side-container, [class*="recommend-list"]'
            );
          }
        }
      }

      if (next !== secondary) {
        secondary?.removeAttribute('data-glean-transcript-active');
        secondary?.removeAttribute('data-vocabframe-transcript-active');
        secondary = next;
      }
      if (secondary) {
        secondary.setAttribute('data-glean-transcript-active', '');
        secondary.setAttribute('data-vocabframe-transcript-active', '');
        if (host.parentElement !== secondary) secondary.prepend(host);
        setEmbeddedMount(mount);
      } else {
        host.remove();
        setEmbeddedMount(null);
      }
    };

    syncSecondary();
    const observer = new MutationObserver(syncSecondary);
    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'data-screen', 'data-player-mode', 'data-server-rendered']
      });
    }
    window.addEventListener('yt-navigate-finish', syncSecondary);
    window.addEventListener('popstate', syncSecondary);
    window.addEventListener('hashchange', syncSecondary);
    window.addEventListener('resize', syncSecondary);
    document.addEventListener('fullscreenchange', syncSecondary);
    document.addEventListener('webkitfullscreenchange', syncSecondary);

    return () => {
      observer.disconnect();
      window.removeEventListener('yt-navigate-finish', syncSecondary);
      window.removeEventListener('popstate', syncSecondary);
      window.removeEventListener('hashchange', syncSecondary);
      window.removeEventListener('resize', syncSecondary);
      document.removeEventListener('fullscreenchange', syncSecondary);
      document.removeEventListener('webkitfullscreenchange', syncSecondary);
      secondary?.removeAttribute('data-glean-transcript-active');
      secondary?.removeAttribute('data-vocabframe-transcript-active');
      host.remove();
      replacementStyle.remove();
      setEmbeddedMount(null);
    };
  }, [isYouTube, isBilibili, isSidePanelOpen]);

  useEffect(() => {
    return bilingualTranslator.addBatchListener(setBatchProgress);
  }, []);

  const isMixedMode = settings.subtitleMode === 'mixed';
  const isCueMixedRefined = (c: SubtitleCue) =>
    Boolean(c.isMixedRefined || c.mixedPhrases !== undefined || c.tokens?.some(t => t.isKeyPhrase));

  const sourceLang = detectSourceLanguage(cues);
  const { code: targetCode } = resolveTargetLanguage(sourceLang, settings.secondaryLang);

  const pendingTranslationCount = cues.filter(c => isCueNeedsTranslation(c, targetCode)).length;
  const activeItemRef = useRef<HTMLDivElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastUserScrollTimeRef = useRef<number>(0);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const buffer = event.target?.result as ArrayBuffer;
        if (buffer) {
          loadSubtitleFileContent(buffer, file.name, true);
        }
      };
      reader.readAsArrayBuffer(file);
      e.target.value = '';
    }
  };

  // Auto-scroll transcript to active cue with safe container-scoped scrolling & visibility deadband
  useEffect(() => {
    if (!autoScroll || sidePanelTab !== 'subtitles') return;
    const container = listContainerRef.current;
    const item = activeItemRef.current;
    if (!container || !item) return;

    // Pause auto-scroll if user has manually scrolled within the last 2.5 seconds
    if (Date.now() - lastUserScrollTimeRef.current < 2500) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();

    // Deadband check: if the item is already comfortably within the middle 60% of the visible container,
    // do NOT scroll at all. This completely eliminates sentence-by-sentence micro-jitter.
    const relativeTop = itemRect.top - containerRect.top;
    const relativeBottom = itemRect.bottom - containerRect.top;
    const containerHeight = container.clientHeight;

    const isComfortablyVisible =
      relativeTop >= containerHeight * 0.2 &&
      relativeBottom <= containerHeight * 0.8;

    if (!isComfortablyVisible) {
      // Calculate target scroll position within container ONLY (never affects outer host page/window)
      const itemOffsetTop = item.offsetTop;
      const targetScrollTop = itemOffsetTop - (containerHeight / 2) + (item.clientHeight / 2);

      container.scrollTo({
        top: Math.max(0, targetScrollTop),
        behavior: 'smooth'
      });
    }
  }, [currentCueIndex, autoScroll, sidePanelTab]);

  if (!isSidePanelOpen) {
    return (
      <button
        type="button"
        onClick={() => setSidePanelOpen(true)}
        className="fixed top-24 right-0 z-[99999] bg-[#0e1117]/90 hover:bg-[#161b22] text-slate-200 border-l border-y border-white/15 px-3 py-2 rounded-l-xl shadow-2xl backdrop-blur-md flex items-center space-x-1.5 text-xs transition-all hover:-translate-x-0.5 group active:scale-95"
        title="展开字幕侧边栏"
      >
        <FileText size={15} className="text-cyan-400 group-hover:scale-110 transition-transform" />
        <span className="font-medium">台词</span>
      </button>
    );
  }

  const filteredCues = searchTerm.trim()
    ? cues.filter(
        c =>
          c.textEn.toLowerCase().includes(searchTerm.toLowerCase()) ||
          c.textZh.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : cues;

  const filteredSavedWords = (savedWords || []).filter(w => {
    if (savedFilter === 'all') return true;
    return w.level === savedFilter;
  });

  const vocabularyList = useMemo(() => {
    const map = new Map<string, { word: string; count: number; cefr?: string }>();
    cues.forEach(cue => {
      (cue.tokens || []).forEach(token => {
        if (token.isWord && token.text.length > 1) {
          const key = (token.lemma || token.text).toLowerCase();
          const existing = map.get(key);
          if (existing) {
            existing.count += 1;
            if (!existing.cefr && token.cefr) existing.cefr = token.cefr;
          } else {
            map.set(key, { word: key, count: 1, cefr: token.cefr });
          }
        }
      });
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [cues]);

  const savedWordMap = useMemo(() => {
    const map = new Map<string, SavedWord>();
    (savedWords || []).forEach(w => {
      map.set(w.word.toLowerCase(), w);
    });
    return map;
  }, [savedWords]);
  const handleWordClick = (e: React.MouseEvent, token: WordToken, cue: SubtitleCue) => {
    e.stopPropagation();
    if (!token.isWord) return;

    // Pause player immediately
    player.pause();
    useAppStore.setState({ isPlaying: false });

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const popupWidth = 390;
    let targetX = Math.max(16, rect.left - popupWidth - 12);
    let targetY = Math.max(16, Math.min(rect.top - 80, window.innerHeight - 480));

    const targetWord = (token.isKeyPhrase && token.phraseText)
      ? token.phraseText
      : (token.lemma || token.text);

    selectWord(
      targetWord,
      cue.textEn,
      cue.textZh,
      { x: targetX, y: targetY, placement: 'bottom' }
    );
  };

  const downloadBlob = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setShowExportMenu(false);
  };

  const panelWidth = settings.sidePanelWidth || 420;
  const transcriptFontSize = settings.transcriptFontSize || 15;
  const isEmbedded = Boolean(embeddedMount);
  const panelStyle: React.CSSProperties = isEmbedded
    ? { position: 'relative', width: '100%', minWidth: 0, height: isBilibili ? 'max(520px, calc(100vh - 120px))' : 'max(320px, calc(100vh - 96px))' }
    : { position: 'fixed', top: 0, right: 0, bottom: 0, width: `${panelWidth}px`, zIndex: 99999 };

  const panel = (
    <div
      data-vocabframe-transcript
      translate="no"
      style={panelStyle}
      className={`z-[99999] notranslate flex flex-col select-none overflow-hidden bg-[#0e1117] text-gray-200 shadow-2xl font-sans ${isEmbedded ? 'rounded-xl border border-white/10' : 'border-l border-white/10'}`}
    >
      
      {/* 1. Header Tabs Bar */}
      <div className="flex items-center justify-between border-b border-white/10 bg-[#0e1117]/95 backdrop-blur-md px-3.5 py-2.5">
        <div className="flex items-center p-0.5 bg-black/40 border border-white/[0.08] rounded-xl text-xs font-medium space-x-0.5">
          <button
            type="button"
            onClick={() => setSidePanelTab('subtitles')}
            className={`px-3 py-1.5 rounded-lg transition-all duration-200 flex items-center space-x-1.5 ${
              sidePanelTab === 'subtitles'
                ? 'bg-white/15 text-white shadow-sm font-semibold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
            }`}
          >
            <span>{t.transcript.tabSubtitles}</span>
            {cues.length > 0 && (
              <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                sidePanelTab === 'subtitles'
                  ? 'bg-cyan-500/25 text-cyan-300'
                  : 'bg-white/5 text-slate-400'
              }`}>
                {cues.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setSidePanelTab('vocabulary')}
            className={`px-3 py-1.5 rounded-lg transition-all duration-200 flex items-center space-x-1.5 ${
              sidePanelTab === 'vocabulary'
                ? 'bg-white/15 text-white shadow-sm font-semibold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
            }`}
          >
            <span>{t.transcript.tabVocabulary}</span>
            {vocabularyList.length > 0 && (
              <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                sidePanelTab === 'vocabulary'
                  ? 'bg-cyan-500/25 text-cyan-300'
                  : 'bg-white/5 text-slate-400'
              }`}>
                {vocabularyList.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setSidePanelTab('saved')}
            className={`px-3 py-1.5 rounded-lg transition-all duration-200 flex items-center space-x-1.5 ${
              sidePanelTab === 'saved'
                ? 'bg-white/15 text-white shadow-sm font-semibold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
            }`}
          >
            <span>{t.transcript.tabSaved}</span>
            {savedWords.length > 0 && (
              <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                sidePanelTab === 'saved'
                  ? 'bg-cyan-500/25 text-cyan-300'
                  : 'bg-white/5 text-slate-400'
              }`}>
                {savedWords.length}
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center space-x-1 text-slate-400">
          <button
            type="button"
            onClick={() => {
              const next = !autoScroll;
              setAutoScroll(next);
              if (next) {
                lastUserScrollTimeRef.current = 0;
              }
            }}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-200 active:scale-95 ${
              autoScroll
                ? 'text-cyan-300 bg-cyan-500/15 border border-cyan-500/30 shadow-[0_0_8px_rgba(6,182,212,0.15)]'
                : 'text-slate-400 hover:text-slate-200 bg-white/5 hover:bg-white/10 border border-white/5'
            }`}
            title="跟随视频滚动"
          >
            跟随
          </button>

          {/* 导入字幕按钮 (本地上传 / 网盘同目录字幕快捷载入) */}
          <div className="relative" ref={importMenuRef}>
            <button
              type="button"
              onClick={() => {
                if (detectedFolderSubtitles && detectedFolderSubtitles.length > 0) {
                  setShowImportMenu(prev => !prev);
                } else {
                  fileInputRef.current?.click();
                }
              }}
              className="p-1.5 hover:text-white text-slate-400 rounded-lg hover:bg-white/10 transition-colors relative active:scale-95"
              title={
                detectedFolderSubtitles && detectedFolderSubtitles.length > 0
                  ? '导入字幕（本地上传 / 选择同目录字幕）'
                  : (t.transcript.importSubtitles || '导入本地字幕文件')
              }
            >
              <Upload size={15} />
              {detectedFolderSubtitles && detectedFolderSubtitles.length > 0 && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-cyan-400 ring-2 ring-[#0e1117]" />
              )}
            </button>

            {/* 同目录字幕下拉浮层 */}
            {showImportMenu && (
              <div className="absolute right-0 top-full mt-2 w-72 bg-[#161b22] border border-white/15 rounded-xl shadow-2xl z-[100000] p-2 text-xs backdrop-blur-md">
                <div className="flex items-center justify-between px-2 py-1.5 border-b border-white/10 text-slate-300 font-medium">
                  <div className="flex items-center space-x-1.5 text-cyan-400 font-semibold">
                    <Sparkles size={13} />
                    <span>网盘同目录字幕</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono bg-white/5 px-1.5 py-0.5 rounded border border-white/5">
                    {detectedFolderSubtitles.length} 个
                  </span>
                </div>

                <div className="max-h-48 overflow-y-auto py-1 space-y-1">
                  {detectedFolderSubtitles.map((sub, sIdx) => (
                    <button
                      key={sIdx}
                      type="button"
                      onClick={() => {
                        loadDetectedFolderSubtitle(sub);
                        setShowImportMenu(false);
                      }}
                      className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-white/10 text-slate-200 hover:text-white flex items-center justify-between group transition-colors"
                    >
                      <div className="flex items-center space-x-2 truncate mr-2">
                        <FileText size={13} className="text-cyan-400 shrink-0" />
                        <span className="truncate text-[11px]" title={sub.name}>
                          {sub.name}
                        </span>
                      </div>
                      <span className="text-[10px] text-cyan-400 group-hover:text-cyan-300 group-hover:underline shrink-0 font-medium">
                        载入
                      </span>
                    </button>
                  ))}
                </div>

                <div className="pt-1.5 mt-1 border-t border-white/10">
                  <button
                    type="button"
                    onClick={() => {
                      setShowImportMenu(false);
                      fileInputRef.current?.click();
                    }}
                    className="w-full py-1.5 px-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-lg text-xs font-medium flex items-center justify-center space-x-1.5 shadow-sm transition-all"
                  >
                    <Upload size={13} />
                    <span>从本地上传字幕文件...</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setExportModalOpen(true)}
            className="p-1.5 hover:text-white text-slate-400 rounded-lg hover:bg-white/10 transition-colors active:scale-95"
            title={t.transcript.exportMenu || '导出字幕与生词 (Word, PDF, SRT, Excel...)'}
          >
            <Download size={15} />
          </button>
          <button
            type="button"
            onClick={() => setSettingsModalOpen(true)}
            className="p-1.5 hover:text-white text-slate-400 rounded-lg hover:bg-white/10 transition-colors active:scale-95"
            title={t.controlBar.settings || 'Glean 设置'}
          >
            <Settings size={15} />
          </button>
          <button
            type="button"
            onClick={() => setSidePanelOpen(false)}
            className="p-1.5 hover:text-white text-slate-400 rounded-lg hover:bg-white/10 transition-colors active:scale-95"
            title="收起侧边栏"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* 2. Search & Controls (for Subtitles tab) */}
      {sidePanelTab === 'subtitles' && cues.length > 0 && (
        <div className="p-3 border-b border-white/10 bg-[#12161f]">
          <div className="flex items-center space-x-2">
            <div className="relative flex-1 group">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-cyan-400 transition-colors pointer-events-none" />
              <input
                type="text"
                placeholder={t.transcript.searchPlaceholder}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-7 py-1.5 bg-white/[0.04] text-xs text-slate-100 rounded-lg border border-white/10 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 placeholder-slate-500 transition-all"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-0.5 rounded-full hover:bg-white/10 transition-colors"
                  title="清空搜索"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* ✨ AI 精翻按钮 */}
            {batchProgress.isRunning ? (
              <div className="flex items-center space-x-1.5 bg-purple-950/60 border border-purple-500/30 text-purple-200 px-2.5 py-1.5 rounded-lg text-xs shrink-0 shadow-sm">
                <Loader2 size={13} className="animate-spin text-purple-400" />
                <span className="font-mono text-[11px]">
                  {batchProgress.percent}% ({batchProgress.completed}/{batchProgress.total})
                </span>
                <button
                  type="button"
                  onClick={() => bilingualTranslator.cancelBatchTranslation()}
                  className="ml-0.5 text-slate-400 hover:text-white p-0.5 rounded hover:bg-white/10 transition-colors"
                  title="取消精翻"
                >
                  <X size={12} />
                </button>
              </div>
            ) : pendingTranslationCount > 0 ? (
              <button
                type="button"
                onClick={() => {
                  if (!bilingualTranslator.canTranslate()) {
                    alert('请先在设置中填写并保存 AI API Key，即可使用 AI 精翻功能。');
                    return;
                  }
                  bilingualTranslator.translateEntireVideo(cues, undefined, false, currentTime);
                }}
                className="flex items-center space-x-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white px-2.5 py-1.5 rounded-lg text-xs font-medium shadow-md shadow-purple-950/40 transition-all whitespace-nowrap active:scale-95 shrink-0"
                title={isMixedMode ? `AI精翻 (当前模式: 中英混合短语精翻，待精翻 ${pendingTranslationCount} 句)` : `AI精翻 (当前模式: 双语全句精翻，待精翻 ${pendingTranslationCount} 句)`}
              >
                <Zap size={13} className="text-yellow-300 fill-yellow-300" />
                <span>✨ AI精翻</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (!bilingualTranslator.canTranslate()) {
                    alert('请先在设置中填写并保存 AI API Key，即可使用 AI 精翻功能。');
                    return;
                  }
                  bilingualTranslator.translateEntireVideo(cues, undefined, true, currentTime);
                }}
                className="flex items-center space-x-1 text-emerald-400 bg-emerald-950/30 border border-emerald-500/30 hover:bg-emerald-900/30 px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                title="已完成精翻，点击可重新执行全片 AI 精翻"
              >
                <Check size={13} />
                <span className="text-[11px] font-medium">{isMixedMode ? '已完成混合精翻' : '已完成双语精翻'}</span>
              </button>
            )}
          </div>

          {/* AI 精翻错误提示 */}
          {batchProgress.error && !batchProgress.isRunning && (
            <div className="mt-2 flex items-center justify-between text-[11px] text-rose-300 bg-rose-950/60 border border-rose-800/60 px-2.5 py-1.5 rounded-lg">
              <span className="truncate mr-1" title={batchProgress.error}>
                ⚠️ 精翻中断: {batchProgress.error}
              </span>
              <button
                type="button"
                onClick={() => bilingualTranslator.updateBatchProgress({ ...batchProgress, error: undefined })}
                className="text-slate-400 hover:text-white shrink-0 p-0.5 rounded hover:bg-white/10 transition-colors"
                title="关闭提示"
              >
                <X size={12} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* 2b. Filter & Export Bar (for Saved tab) */}
      {sidePanelTab === 'saved' && (
        <div className="p-2.5 border-b border-white/10 bg-[#12161f] flex items-center justify-between">
          {/* Level filters */}
          <div className="flex items-center p-0.5 bg-black/40 border border-white/[0.08] rounded-xl text-xs space-x-0.5">
            <button
              type="button"
              onClick={() => setSavedFilter('all')}
              className={`px-2.5 py-1 rounded-lg transition-colors font-medium ${
                savedFilter === 'all'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              全部 ({savedWords.length})
            </button>
            <button
              type="button"
              onClick={() => setSavedFilter('learning')}
              className={`px-2.5 py-1 rounded-lg transition-colors font-medium ${
                savedFilter === 'learning'
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              学习中 ({savedWords.filter(w => w.level === 'learning').length})
            </button>
            <button
              type="button"
              onClick={() => setSavedFilter('known')}
              className={`px-2.5 py-1 rounded-lg transition-colors font-medium ${
                savedFilter === 'known'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              已掌握 ({savedWords.filter(w => w.level === 'known' || w.level === 'mastered').length})
            </button>
          </div>

          {/* Export Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center space-x-1.5 text-xs text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 px-2.5 py-1 rounded-lg border border-cyan-500/30 font-medium transition-all active:scale-95"
              title="导出单词本"
            >
              <Download size={13} />
              <span>导出</span>
            </button>

            {showExportMenu && (
              <div className="absolute top-9 right-0 w-44 bg-[#161b22] border border-white/15 rounded-xl shadow-2xl p-1.5 space-y-1 z-50 backdrop-blur-md">
                <button
                  type="button"
                  onClick={() => downloadBlob(exportSavedWordsAnki(), `anki_words_${Date.now()}.tsv`, 'text/tab-separated-values;charset=utf-8;')}
                  className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-white/10 text-slate-200 hover:text-white text-xs flex items-center space-x-2 transition-colors"
                >
                  <Download size={13} className="text-cyan-400" />
                  <span>Anki 卡片 (.tsv)</span>
                </button>
                <button
                  type="button"
                  onClick={() => downloadBlob(exportSavedWordsJson(), `words_${Date.now()}.json`, 'application/json;charset=utf-8;')}
                  className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-white/10 text-slate-200 hover:text-white text-xs flex items-center space-x-2 transition-colors"
                >
                  <FileJson size={13} className="text-cyan-400" />
                  <span>JSON 格式 (.json)</span>
                </button>
                <button
                  type="button"
                  onClick={() => downloadBlob(exportSavedWordsCsv(), `words_${Date.now()}.csv`, 'text/csv;charset=utf-8;')}
                  className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-white/10 text-slate-200 hover:text-white text-xs flex items-center space-x-2 transition-colors"
                >
                  <FileSpreadsheet size={13} className="text-cyan-400" />
                  <span>CSV 表格 (.csv)</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. Tab Content */}
      <div
        ref={listContainerRef}
        onWheel={() => { lastUserScrollTimeRef.current = Date.now(); }}
        onTouchMove={() => { lastUserScrollTimeRef.current = Date.now(); }}
        className="flex-1 overflow-y-auto p-3 space-y-2.5"
      >
        {/* SUBTITLES TAB */}
        {sidePanelTab === 'subtitles' && (
          cues.length === 0 ? (
            isAdPlaying ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center space-y-3.5 text-slate-400">
                <FileText size={44} className="text-amber-500/70 animate-pulse" />
                <div>
                  <div className="font-bold text-base text-slate-100">
                    广告播放中
                  </div>
                  <p className="text-xs text-slate-400 mt-1.5 leading-relaxed max-w-[280px] mx-auto">
                    若广告包含字幕将实时展现，正片开始后将自动载入双语字幕与台词列表。
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center space-y-3.5 text-slate-400">
                <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 shadow-inner">
                  <FileText size={28} />
                </div>
                <div>
                  <div className="font-bold text-base text-slate-100">
                    {sanitizeVideoTitle(videoTitle) ? `《${sanitizeVideoTitle(videoTitle)}》` : '当前视频'} 暂未载入字幕
                  </div>
                  <p className="text-xs text-slate-400 mt-1.5 leading-relaxed max-w-[280px] mx-auto">
                    支持 .ass / .ssa / .srt / .vtt / .lrc / .sub / .ttml 等格式，导入后即可开启实时双语对照、单句复读与单词点查。
                  </p>
                </div>

                {detectedFolderSubtitles && detectedFolderSubtitles.length > 0 && (
                  <div className="w-full max-w-[280px] p-3 mb-1 rounded-xl border border-cyan-500/30 bg-cyan-950/40 text-left">
                    <div className="flex items-center space-x-1.5 text-xs font-semibold text-cyan-300 mb-2">
                      <Sparkles size={14} className="text-cyan-400" />
                      <span>发现网盘同目录字幕</span>
                    </div>
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-0.5">
                      {detectedFolderSubtitles.map((sub, sIdx) => (
                        <div key={sIdx} className="flex items-center justify-between text-xs text-slate-200 bg-white/5 hover:bg-white/10 rounded-lg px-2.5 py-1.5 transition-colors">
                          <span className="truncate max-w-[150px] font-mono text-[11px] text-slate-300" title={sub.name}>
                            {sub.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => loadDetectedFolderSubtitle(sub)}
                            className="ml-2 px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-[11px] font-medium transition-colors shrink-0 shadow-sm"
                          >
                            一键载入
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-2 flex flex-col space-y-2 w-full max-w-[240px]">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full py-2.5 px-4 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-xl text-sm font-semibold flex items-center justify-center space-x-2 shadow-lg shadow-cyan-950/50 transition-all active:scale-95"
                  >
                    <Upload size={15} />
                    <span>导入本地字幕文件</span>
                  </button>

                  <button
                    type="button"
                    onClick={loadDemoSubtitles}
                    className="w-full py-2 px-4 bg-white/5 hover:bg-white/10 text-slate-200 hover:text-white rounded-xl text-sm flex items-center justify-center space-x-2 border border-white/10 transition-colors active:scale-95"
                  >
                    <Sparkles size={14} className="text-amber-400" />
                    <span>体验示例双语字幕</span>
                  </button>
                </div>
              </div>
            )
          ) : (
            filteredCues.map((cue, idx) => {
              const isActive = cue.id === cues[currentCueIndex]?.id;
              return (
                <div
                  key={cue.id}
                  ref={isActive ? activeItemRef : null}
                  className={`group relative px-3.5 py-2.5 rounded-xl transition-all duration-200 flex items-start space-x-3 border ${
                    isAdPlaying ? 'cursor-default' : 'cursor-pointer'
                  } ${
                    isActive
                      ? 'bg-cyan-950/20 border-cyan-500/35 shadow-md shadow-cyan-950/30 ring-1 ring-cyan-500/20'
                      : 'bg-[#13161f]/50 hover:bg-[#181d28] border-white/[0.04] hover:border-white/10'
                  }`}
                  onClick={() => {
                    if (!isAdPlaying) {
                      seekToCue(cue.id - 1, player);
                    }
                  }}
                >
                  {/* Left accent indicator for active cue */}
                  {isActive && (
                    <span className="absolute left-0 top-2.5 bottom-2.5 w-1 rounded-r-full bg-gradient-to-b from-cyan-400 to-emerald-400 shadow-[0_0_8px_rgba(6,182,212,0.6)]" />
                  )}

                  {/* Play / Jump Indicator on Active or Hover */}
                  <div className="shrink-0 pt-0.5">
                    {isActive ? (
                      <div className="w-5 h-5 rounded-full bg-cyan-400 text-slate-950 flex items-center justify-center shadow-sm shadow-cyan-400/40">
                        <Play size={10} fill="currentColor" className="ml-0.5" />
                      </div>
                    ) : !isAdPlaying ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          seekToCue(cue.id - 1, player);
                          player.play();
                        }}
                        className="w-5 h-5 rounded-full text-slate-400 hover:text-white bg-white/5 hover:bg-cyan-500/20 border border-white/5 hover:border-cyan-500/30 flex items-center justify-center transition-all opacity-0 group-hover:opacity-100"
                        title="跳转播放"
                      >
                        <Play size={10} fill="currentColor" className="ml-0.5" />
                      </button>
                    ) : null}
                  </div>

                  {/* Subtitle Content */}
                  <div className="flex-1 min-w-0 space-y-1">
                    {/* English Tokens */}
                    <div
                      className={`leading-relaxed tracking-wide ${
                        isActive ? 'text-white font-semibold' : 'text-slate-100 font-medium'
                      }`}
                      style={{ fontSize: `${transcriptFontSize}px`, lineHeight: 1.55 }}
                    >
                      {cue.tokens && cue.tokens.length > 0 ? (() => {
                        const hasKeyPhrases = Boolean(
                          cue.tokens?.some(t => t.isKeyPhrase)
                        );
                        return cue.tokens.map((token) => {
                          const isCjk = /[\u4e00-\u9fa5\u3400-\u4dbf]/.test(token.text);
                          const tokenSpacing = isCjk
                            ? (token.isKeyPhrase ? (token.isPhraseStart ? 'ml-0.5' : '') : 'mx-0 px-0')
                            : 'mx-0.5 px-0.5';

                          return token.isWord ? (
                            <span
                              key={token.id}
                              onClick={(e) => handleWordClick(e, token, cue)}
                              className={`token-word cursor-pointer rounded transition-colors ${tokenSpacing} ${
                                token.isKeyPhrase
                                  ? 'text-amber-300 font-semibold bg-amber-400/10 px-1 py-0.5 rounded border border-amber-400/20 hover:bg-amber-400/25'
                                  : token.level === 'learning'
                                  ? 'text-purple-300 font-semibold bg-purple-500/10 px-1 py-0.5 rounded border border-purple-500/20 hover:bg-purple-500/25'
                                  : token.level === 'known'
                                  ? 'text-emerald-300 bg-emerald-500/10 px-1 py-0.5 rounded border border-emerald-500/20 hover:bg-emerald-500/25'
                                  : 'hover:text-cyan-300 hover:bg-white/10 px-0.5 py-0.5 rounded'
                              }`}
                            >
                              <span>{token.text}</span>
                              {isMixedMode && (token.phraseMeaning && token.isPhraseEnd ? (
                                <span className="inline-flex items-center ml-1 px-1.5 py-0.2 text-[0.78em] font-medium rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 select-none leading-none align-baseline">
                                  {token.phraseMeaning}
                                </span>
                              ) : (!hasKeyPhrases && !token.phraseId && token.contextMeaning ? (
                                <span className="inline-flex items-center ml-1 px-1.5 py-0.2 text-[0.78em] font-medium rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 select-none leading-none align-baseline">
                                  {token.contextMeaning}
                                </span>
                              ) : null))}
                            </span>
                          ) : (
                            <span key={token.id}>{token.text}</span>
                          );
                        });
                      })() : (
                        cue.textEn
                      )}
                    </div>

                    {/* Translation Line */}
                    {cue.textZh &&
                      cue.textZh.trim() !== (cue.textEn || '').trim() &&
                      (!targetCode || targetCode.startsWith('zh') || !isChineseText(cue.textZh)) && (
                      <div
                        className={`leading-normal ${
                          isActive ? 'text-slate-200' : 'text-slate-400'
                        }`}
                        style={{ fontSize: `${Math.max(12, transcriptFontSize - 2)}px` }}
                      >
                        {cue.textZh}
                      </div>
                    )}

                    {/* Timestamp */}
                    <div className="flex items-center space-x-2 text-[11px] font-mono text-slate-500">
                      <span>{formatTimestamp(cue.start)}</span>
                    </div>
                  </div>

                  {/* Right-Aligned AI Sentence Deep Analysis Button */}
                  {!isAdPlaying && (
                    <div className="shrink-0 pt-0.5 self-center">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          analyzeSentence(cue, player);
                        }}
                        title="AI 单句精讲: 深度句法剖析、地道发音与习语拆解"
                        className={`p-1.5 rounded-lg transition-all flex items-center justify-center ${
                          isSentenceAnalysisOpen && selectedSentenceCue?.id === cue.id
                            ? 'bg-purple-600/40 text-purple-200 ring-1 ring-purple-400 opacity-100 shadow-sm'
                            : isActive
                            ? 'text-cyan-300 hover:text-white hover:bg-cyan-500/20 opacity-90'
                            : 'text-slate-400 hover:text-cyan-300 hover:bg-white/10 opacity-0 group-hover:opacity-100'
                        }`}
                      >
                        <Sparkles size={14} className={isSentenceAnalysisOpen && selectedSentenceCue?.id === cue.id ? 'animate-spin' : ''} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )
        )}

        {/* VOCABULARY TAB */}
        {sidePanelTab === 'vocabulary' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-slate-400 text-xs px-1 pb-1">
              <span>本视频高频核心词汇</span>
              <span className="font-mono text-[11px] text-slate-500">{vocabularyList.length} 词</span>
            </div>
            {vocabularyList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center space-y-3 text-slate-400">
                <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 shadow-inner">
                  <BookOpen size={24} />
                </div>
                <div className="font-semibold text-slate-200 text-sm">暂未提取到核心词汇</div>
                <p className="text-xs text-slate-400 max-w-[240px]">
                  导入双语或外语字幕后，将自动为您统计并提取整段视频的重点单词。
                </p>
              </div>
            ) : (
              vocabularyList.map((item, idx) => {
                const isSaved = savedWordMap.has(item.word);
                const savedItem = savedWordMap.get(item.word);
                return (
                  <div
                    key={idx}
                    className="bg-[#13161f]/70 hover:bg-[#181d28] p-3 rounded-xl border border-white/[0.06] hover:border-cyan-500/30 flex items-center justify-between cursor-pointer transition-all duration-200 group"
                    onClick={() => {
                      player.pause();
                      useAppStore.setState({ isPlaying: false });
                      selectWord(item.word, '', '');
                    }}
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <span className="font-semibold text-slate-100 text-sm truncate group-hover:text-cyan-300 transition-colors">
                        {item.word}
                      </span>
                      {item.cefr && (
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${getCefrBadgeClass(item.cefr)}`}>
                          {item.cefr}
                        </span>
                      )}
                      {item.count > 1 && (
                        <span className="text-[10px] font-mono text-slate-400 bg-white/5 border border-white/5 px-1.5 py-0.5 rounded">
                          ×{item.count}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center space-x-1.5 shrink-0">
                      <AudioButton word={item.word} size={14} className="text-slate-400 hover:text-cyan-300" />
                      {isSaved ? (
                        <span className="p-1 text-amber-400" title={savedItem?.level === 'known' ? '已掌握' : '已收藏'}>
                          <Star size={14} fill="currentColor" />
                        </span>
                      ) : (
                        <span className="text-cyan-400 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                          释义 &rarr;
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* SAVED WORDS TAB */}
        {sidePanelTab === 'saved' && (
          <div className="space-y-2.5 text-sm">
            {filteredSavedWords.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center space-y-3 text-slate-400">
                <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 shadow-inner">
                  <Bookmark size={24} />
                </div>
                <div className="font-semibold text-slate-200 text-sm">暂无生词记录</div>
                <p className="text-xs text-slate-400 max-w-[240px]">
                  在视频播放过程中，点击字幕中的任意单词即可查词并加入生词本。
                </p>
              </div>
            ) : (
              filteredSavedWords.map((word) => (
                <div
                  key={word.id}
                  className="bg-[#13161f]/70 hover:bg-[#181d28] p-3 rounded-xl border border-white/[0.06] hover:border-white/15 space-y-2 transition-all duration-200 cursor-pointer"
                  onClick={() => {
                    selectWord(word.word, word.contextSentenceEn || '', word.contextSentenceZh || '');
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-base text-slate-100">{word.word}</span>
                      {word.phonetic && (
                        <span className="text-slate-400 font-mono text-xs">{word.phonetic}</span>
                      )}
                      {word.cefr && (
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${getCefrBadgeClass(word.cefr)}`}>
                          {word.cefr}
                        </span>
                      )}
                      <AudioButton word={word.word} size={14} className="text-slate-400 hover:text-cyan-300 ml-0.5" />
                    </div>
                    <div className="flex items-center space-x-1.5">
                      {word.level && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          word.level === 'known' || word.level === 'mastered'
                            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25'
                            : 'bg-purple-500/15 text-purple-300 border border-purple-500/25'
                        }`}>
                          {word.level === 'known' || word.level === 'mastered' ? '已掌握' : '学习中'}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeSavedWord(word.word);
                        }}
                        className="text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 p-1 rounded-md transition-colors"
                        title="从生词本移除"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  {word.quickCn && (
                    <div className="text-slate-200 text-xs font-medium">{word.quickCn}</div>
                  )}
                  {word.contextSentenceEn && (
                    <div className="text-xs text-slate-400 italic bg-black/30 p-2 rounded-lg border border-white/5">
                      "{word.contextSentenceEn}"
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* 4. Footer Shortcuts Info */}
      <div className="bg-[#0e1117]/95 px-3.5 py-2 border-t border-white/10 flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center space-x-2.5">
          <span><kbd className="bg-white/5 border border-white/10 px-1.5 py-0.5 rounded text-[11px] text-slate-300 font-mono shadow-inner">A</kbd> 上句</span>
          <span><kbd className="bg-white/5 border border-white/10 px-1.5 py-0.5 rounded text-[11px] text-slate-300 font-mono shadow-inner">S</kbd> 重播</span>
          <span><kbd className="bg-white/5 border border-white/10 px-1.5 py-0.5 rounded text-[11px] text-slate-300 font-mono shadow-inner">D</kbd> 下句</span>
        </div>
        <div className="flex items-center space-x-1.5 text-slate-500 text-[11px] font-semibold tracking-wider uppercase">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.8)]" />
          <span>Glean</span>
        </div>
      </div>

      {/* Hidden file input: Always mounted in DOM so header and empty-state buttons can trigger it */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept=".srt,.vtt,.ass,.ssa,.lrc,.sub,.ttml,.xml,.json,.bcc,.txt"
        className="hidden"
      />
    </div>
  );
  if (isYouTube) {
    return embeddedMount ? createPortal(panel, embeddedMount) : panel;
  }
  if (isBilibili) {
    return embeddedMount ? createPortal(panel, embeddedMount) : panel;
  }
  return panel;
};
