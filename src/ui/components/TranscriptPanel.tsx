import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import tailwindCss from '@/ui/styles/tailwind.css?inline';
import { Play, Settings, X, Search, Bookmark, Check, Star, Download, ChevronRight, FileText, Upload, Sparkles, FileJson, FileSpreadsheet, Zap, Loader2 } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { VideoPlayerAdapter } from '@/core/player/BaseAdapter';
import { SubtitleCue, WordToken, SavedWord } from '@/types';
import { formatTimestamp } from '@/core/subtitle/parser';
import { getLocale } from '@/core/i18n';
import { sanitizeVideoTitle } from '@/core/youtube/titleSanitizer';
import { bilingualTranslator, BatchTranslationProgress, isEligibleForTranslation, detectSourceLanguage, resolveTargetLanguage } from '@/core/ai/bilingualTranslator';

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
  const [batchProgress, setBatchProgress] = useState<BatchTranslationProgress>(
    bilingualTranslator.getBatchProgress()
  );
  const hostname = (typeof window !== 'undefined' && window.location?.hostname) || '';
  const isYouTube = hostname.includes('youtube.com');
  const isBilibili = hostname.includes('bilibili.com');
  const [embeddedMount, setEmbeddedMount] = useState<HTMLElement | null>(null);

  // Replace recommendations in their own column (YouTube #secondary, Bilibili .right-container),
  // preserving host nodes for clean restoration when sidebar is closed.
  useEffect(() => {
    if ((!isYouTube && !isBilibili) || !isSidePanelOpen) return;
    const host = document.createElement('language-reactor-overlay');
    host.dataset.vocabframeTranscriptHost = 'true';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = tailwindCss + ':host{display:block;width:100%;min-width:0}';
    const mount = document.createElement('div');
    mount.className = 'language-reactor-root';
    shadow.append(style, mount);

    const replacementStyle = document.createElement('style');
    replacementStyle.textContent = `
      #secondary[data-vocabframe-transcript-active] > :not([data-vocabframe-transcript-host]),
      #secondary-inner[data-vocabframe-transcript-active] > :not([data-vocabframe-transcript-host]),
      .right-container[data-vocabframe-transcript-active] > :not([data-vocabframe-transcript-host]),
      #right-container[data-vocabframe-transcript-active] > :not([data-vocabframe-transcript-host]),
      .recommend-list-v1[data-vocabframe-transcript-active] > :not([data-vocabframe-transcript-host]),
      #recom_list[data-vocabframe-transcript-active] > :not([data-vocabframe-transcript-host]),
      .plp-r[data-vocabframe-transcript-active] > :not([data-vocabframe-transcript-host]),
      .r-con[data-vocabframe-transcript-active] > :not([data-vocabframe-transcript-host]),
      .playlist-container[data-vocabframe-transcript-active] > :not([data-vocabframe-transcript-host]),
      .side-container[data-vocabframe-transcript-active] > :not([data-vocabframe-transcript-host]),
      [class*="recommend-list"][data-vocabframe-transcript-active] > :not([data-vocabframe-transcript-host]) {
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
          next = document.querySelector<HTMLElement>(
            '.right-container, #right-container, .recommend-list-v1, #recom_list, .plp-r, .r-con, .playlist-container, .side-container, [class*="recommend-list"]'
          );
        }
      }

      if (next !== secondary) {
        secondary?.removeAttribute('data-vocabframe-transcript-active');
        secondary = next;
      }
      if (secondary) {
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
        attributeFilter: ['class', 'data-screen', 'data-player-mode']
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

  const pendingTranslationCount = isMixedMode
    ? cues.filter(c => Boolean(c.textEn) && isEligibleForTranslation(c.textEn, targetCode) && !isCueMixedRefined(c)).length
    : cues.filter(c => Boolean(c.textEn) && isEligibleForTranslation(c.textEn, targetCode) && (!c.isAiRefined || !c.textZh || c.textZh.trim() === c.textEn.trim())).length;
  const activeItemRef = useRef<HTMLDivElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastUserScrollTimeRef = useRef<number>(0);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        if (text) {
          loadSubtitleFileContent(text, file.name);
        }
      };
      reader.readAsText(file);
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
        className="fixed top-20 right-0 z-[99999] bg-[#18181b] hover:bg-[#242429] text-gray-200 border-l border-y border-[#383842] p-2 rounded-l-lg shadow-2xl flex items-center space-x-1 text-xs transition-transform"
        title="展开字幕侧边栏"
      >
        <FileText size={16} className="text-blue-400" />
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
      style={panelStyle}
      className={`z-[99999] flex flex-col select-none overflow-hidden bg-[#101214] text-gray-200 shadow-2xl font-sans ${isEmbedded ? 'rounded-lg border border-white/10' : 'border-l border-white/10'}`}
    >
      
      {/* 1. Header Tabs Bar */}
      <div className="flex items-center justify-between border-b border-white/10 bg-[#171a1d] px-4 py-3">
        <div className="flex items-center space-x-5 text-sm font-semibold">
          <button
            type="button"
            onClick={() => setSidePanelTab('subtitles')}
            className={`pb-1.5 transition-colors relative ${
              sidePanelTab === 'subtitles'
                ? 'text-white font-bold border-b-2 border-cyan-400'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {t.transcript.tabSubtitles}
          </button>
          <button
            type="button"
            onClick={() => setSidePanelTab('vocabulary')}
            className={`pb-1.5 transition-colors relative ${
              sidePanelTab === 'vocabulary'
                ? 'text-white font-bold border-b-2 border-cyan-400'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {t.transcript.tabVocabulary}
          </button>
          <button
            type="button"
            onClick={() => setSidePanelTab('saved')}
            className={`pb-1.5 transition-colors relative ${
              sidePanelTab === 'saved'
                ? 'text-white font-bold border-b-2 border-cyan-400'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {t.transcript.tabSaved} ({savedWords.length})
          </button>
        </div>

        <div className="flex items-center space-x-2 text-gray-400">
          <button
            type="button"
            onClick={() => {
              const next = !autoScroll;
              setAutoScroll(next);
              if (next) {
                lastUserScrollTimeRef.current = 0;
              }
            }}
            className={`px-2 py-1 rounded text-xs transition-colors ${
              autoScroll ? 'text-blue-400 bg-blue-950/60 font-medium' : 'text-gray-500 hover:text-gray-300'
            }`}
            title="跟随视频滚动"
          >
            跟随
          </button>
          <button
            type="button"
            onClick={() => setExportModalOpen(true)}
            className="p-1 hover:text-white rounded hover:bg-white/10 transition-colors"
            title={t.transcript.exportMenu || '导出字幕与生词 (Word, PDF, SRT, Excel...)'}
          >
            <Download size={16} />
          </button>
          <button
            type="button"
            onClick={() => setSettingsModalOpen(true)}
            className="p-1 hover:text-white rounded hover:bg-white/10 transition-colors"
            title={t.controlBar.settings || 'VocabFrame 设置'}
          >
            <Settings size={16} />
          </button>
          <button
            type="button"
            onClick={() => setSidePanelOpen(false)}
            className="p-1 hover:text-white rounded hover:bg-white/10 transition-colors"
            title="收起侧边栏"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* 2. Search & Controls (for Subtitles tab) */}
      {sidePanelTab === 'subtitles' && cues.length > 0 && (
        <div className="p-3 border-b border-white/10 bg-[#121619]">
          <div className="flex items-center space-x-2">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-2.5 top-2.5 text-gray-500" />
              <input
                type="text"
                placeholder={t.transcript.searchPlaceholder}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-2.5 py-2 bg-[#1d2226] text-xs text-gray-200 rounded-md border border-white/10 focus:outline-none focus:border-cyan-400 placeholder-gray-500"
              />
            </div>

            {/* ✨ AI 精翻按钮 */}
            {batchProgress.isRunning ? (
              <div className="flex items-center space-x-1.5 bg-purple-950/70 border border-purple-800 text-purple-200 px-2.5 py-1.5 rounded-lg text-xs shrink-0">
                <Loader2 size={13} className="animate-spin text-purple-400" />
                <span className="font-mono text-[11px]">
                  {batchProgress.percent}% ({batchProgress.completed}/{batchProgress.total})
                </span>
                <button
                  type="button"
                  onClick={() => bilingualTranslator.cancelBatchTranslation()}
                  className="ml-0.5 text-gray-400 hover:text-white p-0.5"
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
                className="flex items-center space-x-1 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white px-2.5 py-1.5 rounded-lg text-xs font-medium shadow transition-all whitespace-nowrap active:scale-95 shrink-0"
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
                className="flex items-center space-x-1 text-emerald-400 bg-emerald-950/40 border border-emerald-900/60 hover:bg-emerald-900/40 px-2 py-1.5 rounded-lg text-xs whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                title="已完成精翻，点击可重新执行全片 AI 精翻"
              >
                <Check size={13} />
                <span className="text-[11px]">{isMixedMode ? '已完成混合精翻' : '已完成双语精翻'}</span>
              </button>
            )}
          </div>

          {/* AI 精翻错误提示 */}
          {batchProgress.error && !batchProgress.isRunning && (
            <div className="mt-2 flex items-center justify-between text-[11px] text-rose-300 bg-rose-950/70 border border-rose-800/80 px-2.5 py-1.5 rounded-md">
              <span className="truncate mr-1" title={batchProgress.error}>
                ⚠️ 精翻中断: {batchProgress.error}
              </span>
              <button
                type="button"
                onClick={() => bilingualTranslator.updateBatchProgress({ ...batchProgress, error: undefined })}
                className="text-gray-400 hover:text-white shrink-0 p-0.5"
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
        <div className="p-2.5 border-b border-[#2e2e38] bg-[#141416] flex items-center justify-between">
          {/* Level filters */}
          <div className="flex items-center space-x-1.5 text-xs">
            <button
              type="button"
              onClick={() => setSavedFilter('all')}
              className={`px-2.5 py-1 rounded ${
                savedFilter === 'all' ? 'bg-blue-600 text-white font-medium' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              全部
            </button>
            <button
              type="button"
              onClick={() => setSavedFilter('learning')}
              className={`px-2 py-1 rounded ${
                savedFilter === 'learning' ? 'bg-purple-900/60 text-purple-300 font-medium' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              学习中
            </button>
            <button
              type="button"
              onClick={() => setSavedFilter('known')}
              className={`px-2 py-1 rounded ${
                savedFilter === 'known' ? 'bg-emerald-900/60 text-emerald-300 font-medium' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              已掌握
            </button>
          </div>

          {/* Export Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center space-x-1.5 text-xs text-blue-400 hover:text-blue-300 bg-blue-950/40 px-2.5 py-1 rounded border border-blue-500/30 font-medium"
              title="导出单词本"
            >
              <Download size={14} />
              <span>导出</span>
            </button>

            {showExportMenu && (
              <div className="absolute top-9 right-0 w-40 bg-[#1f1f24] border border-[#383842] rounded-lg shadow-2xl p-1.5 space-y-1 z-50">
                <button
                  type="button"
                  onClick={() => downloadBlob(exportSavedWordsAnki(), `anki_words_${Date.now()}.tsv`, 'text/tab-separated-values;charset=utf-8;')}
                  className="w-full text-left px-2.5 py-2 rounded hover:bg-blue-600/30 text-gray-200 hover:text-blue-300 text-xs flex items-center space-x-2"
                >
                  <Download size={14} />
                  <span>Anki (.tsv)</span>
                </button>
                <button
                  type="button"
                  onClick={() => downloadBlob(exportSavedWordsJson(), `words_${Date.now()}.json`, 'application/json;charset=utf-8;')}
                  className="w-full text-left px-2.5 py-2 rounded hover:bg-blue-600/30 text-gray-200 hover:text-blue-300 text-xs flex items-center space-x-2"
                >
                  <FileJson size={14} />
                  <span>JSON 格式</span>
                </button>
                <button
                  type="button"
                  onClick={() => downloadBlob(exportSavedWordsCsv(), `words_${Date.now()}.csv`, 'text/csv;charset=utf-8;')}
                  className="w-full text-left px-2.5 py-2 rounded hover:bg-blue-600/30 text-gray-200 hover:text-blue-300 text-xs flex items-center space-x-2"
                >
                  <FileSpreadsheet size={14} />
                  <span>CSV 表格</span>
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
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center space-y-3.5 text-gray-400">
                <FileText size={44} className="text-amber-500/70 animate-pulse" />
                <div>
                  <div className="font-bold text-base text-gray-100">
                    广告播放中
                  </div>
                  <p className="text-xs text-gray-400 mt-1.5 leading-relaxed max-w-[280px] mx-auto">
                    若广告包含字幕将实时展现，正片开始后将自动载入双语字幕与台词列表。
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center space-y-3.5 text-gray-400">
                <FileText size={44} className="text-blue-500/60" />
                <div>
                  <div className="font-bold text-base text-gray-100">
                    {sanitizeVideoTitle(videoTitle) ? `《${sanitizeVideoTitle(videoTitle)}》` : '当前视频'} 暂未载入字幕
                  </div>
                  <p className="text-xs text-gray-300 mt-1.5 leading-relaxed max-w-[280px] mx-auto">
                    请导入与本集视频匹配的字幕文件（.srt / .vtt），即可开启实时双语对照、单句复读与单词点查。
                  </p>
                </div>

                <div className="pt-2 flex flex-col space-y-2.5 w-full max-w-[240px]">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-semibold flex items-center justify-center space-x-2 shadow-lg transition-colors"
                  >
                    <Upload size={16} />
                    <span>导入本地字幕 (.srt / .vtt)</span>
                  </button>

                  <button
                    type="button"
                    onClick={loadDemoSubtitles}
                    className="w-full py-2 px-4 bg-[#1f1f24] hover:bg-[#282830] text-gray-200 hover:text-white rounded-xl text-sm flex items-center justify-center space-x-2 border border-[#383842] transition-colors"
                  >
                    <Sparkles size={15} className="text-amber-400" />
                    <span>体验示例双语字幕</span>
                  </button>
                </div>

                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept=".srt,.vtt,.ass,.txt"
                  className="hidden"
                />
              </div>
            )
          ) : (
            filteredCues.map((cue, idx) => {
              const isActive = cue.id === cues[currentCueIndex]?.id;
              return (
                <div
                  key={cue.id}
                  ref={isActive ? activeItemRef : null}
                  className={`group px-3 py-2.5 rounded-lg border-y border-white/[0.04] transition-all flex items-start space-x-2.5 ${
                    isAdPlaying ? 'cursor-default' : 'cursor-pointer'
                  } ${
                    isActive
                      ? 'bg-[#281b36] border-l-[3px] border-[#a855f7] shadow-md'
                      : `${idx % 2 === 0 ? 'bg-[#18181c]' : 'bg-[#121215]'} border-l-[3px] border-transparent ${!isAdPlaying ? 'hover:bg-[#202028]' : ''}`
                  }`}
                  onClick={() => {
                    if (!isAdPlaying) {
                      seekToCue(cue.id - 1, player);
                    }
                  }}
                >
                  {/* LR-Style Purple Play Indicator on Active or Hover (hidden during ads) */}
                  <div className="shrink-0 pt-0.5">
                    {isActive ? (
                      <div className="w-5 h-5 rounded-full bg-[#a855f7] text-white flex items-center justify-center shadow-md">
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
                        className="w-5 h-5 rounded-full text-gray-400 group-hover:text-white group-hover:bg-[#a855f7]/80 flex items-center justify-center transition-all opacity-0 group-hover:opacity-100"
                        title="跳转播放"
                      >
                        <Play size={10} fill="currentColor" className="ml-0.5" />
                      </button>
                    ) : null}
                  </div>

                  {/* Subtitle Content */}
                  <div className="flex-1 space-y-1">
                    {/* English Tokens */}
                    <div
                      className="text-white font-medium leading-relaxed"
                      style={{ fontSize: `${transcriptFontSize}px`, lineHeight: 1.55 }}
                    >
                      {cue.tokens && cue.tokens.length > 0 ? (() => {
                        const hasKeyPhrases = Boolean(
                          cue.isAiRefined ||
                          cue.isMixedRefined ||
                          cue.mixedPhrases !== undefined ||
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
                                  ? 'text-amber-300 font-semibold hover:bg-amber-500/20'
                                  : token.level === 'learning'
                                  ? 'text-[#c084fc] font-semibold hover:bg-purple-500/20'
                                  : token.level === 'known'
                                  ? 'text-[#86efac] hover:bg-emerald-500/20'
                                  : 'hover:text-cyan-300 hover:bg-white/10'
                              }`}
                            >
                              <span>{token.text}</span>
                              {isMixedMode && (token.phraseMeaning && token.isPhraseEnd ? (
                                <span className="ml-1 mr-0.5 text-[0.82em] font-medium text-emerald-300/90 select-none">
                                  ({token.phraseMeaning})
                                </span>
                              ) : (!hasKeyPhrases && !token.phraseId && token.contextMeaning ? (
                                <span className="ml-1 mr-0.5 text-[0.82em] font-medium text-emerald-300/90 select-none">
                                  ({token.contextMeaning})
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

                    {/* Translation Line (hidden if identical to primary dialogue line to prevent duplicate echo) */}
                    {cue.textZh && cue.textZh.trim() !== (cue.textEn || '').trim() && (
                      <div
                        className="text-gray-400 leading-normal"
                        style={{ fontSize: `${Math.max(12, transcriptFontSize - 2)}px` }}
                      >
                        {cue.textZh}
                      </div>
                    )}

                    {/* Timestamp */}
                    <div className="text-xs text-gray-500">
                      {formatTimestamp(cue.start)}
                    </div>
                  </div>

                  {/* Right-Aligned AI Sentence Deep Analysis Button (strictly hidden during ads) */}
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
                            ? 'bg-purple-600/40 text-purple-200 ring-1 ring-purple-400 opacity-100'
                            : isActive
                            ? 'text-purple-300 hover:text-white hover:bg-purple-800/40 opacity-90'
                            : 'text-gray-400 hover:text-purple-300 hover:bg-white/10 opacity-0 group-hover:opacity-100'
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
          <div className="space-y-2.5 text-sm">
            <div className="text-gray-400 text-xs px-1">本视频共提取高频核心词汇：</div>
            {Array.from(
              new Set(
                cues
                  .flatMap(c => c.tokens || [])
                  .filter(t => t.isWord && t.text.length > 2)
                  .map(t => (t.lemma || t.text).toLowerCase())
              )
            ).map((word, idx) => (
              <div
                key={idx}
                className="bg-[#18181b] p-3 rounded-lg border border-[#2e2e38] flex items-center justify-between hover:border-blue-500/50 cursor-pointer transition-colors"
                onClick={() => {
                  player.pause();
                  useAppStore.setState({ isPlaying: false });
                  selectWord(word, '', '');
                }}
              >
                <div className="flex items-center space-x-2">
                  <span className="font-semibold text-gray-100 text-sm">{word}</span>
                </div>
                <span className="text-blue-400 text-xs font-medium">查看释义 &rarr;</span>
              </div>
            ))}
          </div>
        )}

        {/* SAVED WORDS TAB */}
        {sidePanelTab === 'saved' && (
          <div className="space-y-2.5 text-sm">
            {filteredSavedWords.length === 0 ? (
              <div className="text-center py-12 text-gray-500 text-sm">
                暂无此分类下的生词
              </div>
            ) : (
              filteredSavedWords.map((word) => (
                <div
                  key={word.id}
                  className="bg-[#18181b] p-3 rounded-lg border border-[#2e2e38] space-y-2 hover:border-[#383842] transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-base text-gray-100">{word.word}</span>
                      <span className="text-gray-400 font-mono text-xs">{word.phonetic}</span>
                      {word.cefr && (
                        <span className="text-xs bg-blue-950 text-blue-300 px-1.5 py-0.5 rounded font-mono">
                          {word.cefr}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeSavedWord(word.word)}
                      className="text-gray-500 hover:text-red-400 p-1 rounded"
                      title="移除"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="text-gray-200 text-sm">{word.quickCn}</div>
                  {word.contextSentenceEn && (
                    <div className="text-xs text-gray-400 italic bg-[#121214] p-2 rounded border border-[#242429]">
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
      <div className="bg-[#141416] px-4 py-2.5 border-t border-[#2e2e38] flex items-center justify-between text-xs text-gray-400">
        <div className="flex items-center space-x-2.5">
          <span><kbd className="bg-[#242429] px-1.5 py-0.5 rounded text-xs text-gray-300 font-mono">A</kbd> 上句</span>
          <span><kbd className="bg-[#242429] px-1.5 py-0.5 rounded text-xs text-gray-300 font-mono">S</kbd> 重播</span>
          <span><kbd className="bg-[#242429] px-1.5 py-0.5 rounded text-xs text-gray-300 font-mono">D</kbd> 下句</span>
        </div>
        <div className="text-gray-500 font-medium">
          <span>VocabFrame</span>
        </div>
      </div>
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
