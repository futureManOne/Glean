import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Check,
  Bookmark,
  Star,
  Loader2,
  Sparkles,
  BookOpen,
  MessageSquareText,
  Copy,
  CheckCheck,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { AudioButton, playWordAudio } from './AudioButton';
import { getLocale } from '@/core/i18n';
import { AI_PRESETS, SupportedLang } from '@/types';

/**
 * WordPopup Error Boundary to prevent any unhandled render exception
 * from crashing the video overlay or host page.
 */
interface ErrorBoundaryProps {
  children: React.ReactNode;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class WordPopupErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[WordPopup] Render error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 bg-[#121620] text-gray-200 rounded-2xl border border-red-500/40 text-center space-y-2.5 max-w-[360px] shadow-2xl">
          <div className="flex items-center justify-center space-x-1.5 text-red-400 text-sm font-semibold">
            <AlertCircle size={16} />
            <span>词典弹窗渲染异常</span>
          </div>
          <p className="text-xs text-gray-400">
            遇到未预期的格式异常，请尝试重置或关闭重新选择。
          </p>
          <div className="flex justify-center space-x-2 pt-1">
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false });
                this.props.onReset?.();
              }}
              className="text-xs bg-red-600/30 hover:bg-red-600/50 text-white px-3.5 py-1.5 rounded-lg border border-red-500/30 transition-colors"
            >
              重新渲染
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Main WordPopup View Component
 */
const WordPopupInner: React.FC = () => {
  const {
    selectedWord,
    wordExplanation,
    isLoadingExplanation,
    isLoadingExtendedExamples,
    popupPosition,
    closeWordPopup,
    saveOrUpdateWord,
    savedWords,
    selectWord,
    fetchWordExtendedExamples,
    settings
  } = useAppStore();

  const t = getLocale(settings.uiLanguage);

  const [activeTab, setActiveTab] = useState<'context' | 'grammar' | 'examples'>('context');
  const [copied, setCopied] = useState(false);
  const [copiedExampleIdx, setCopiedExampleIdx] = useState<number | null>(null);
  const lastPronouncedWordRef = useRef<string>('');
  // Automatically pronounce the word aloud when the popup opens with a selected word
  useEffect(() => {
    if (selectedWord && selectedWord !== lastPronouncedWordRef.current) {
      lastPronouncedWordRef.current = selectedWord;
      playWordAudio(selectedWord);
    } else if (!selectedWord) {
      lastPronouncedWordRef.current = '';
    }
  }, [selectedWord]);

  // When activeTab is 'examples', trigger AI generation if not yet fetched
  useEffect(() => {
    if (
      activeTab === 'examples' &&
      selectedWord &&
      (!wordExplanation?.aiExtendedExamples || wordExplanation.aiExtendedExamples.length === 0) &&
      !isLoadingExtendedExamples
    ) {
      fetchWordExtendedExamples();
    }
  }, [activeTab, selectedWord, wordExplanation?.aiExtendedExamples, isLoadingExtendedExamples, fetchWordExtendedExamples]);

  if (!selectedWord || !popupPosition) return null;

  const savedEntry = (savedWords || []).find(w => w.word.toLowerCase() === selectedWord.toLowerCase());
  const currentLevel = savedEntry ? savedEntry.level : (wordExplanation?.level || 'new');
  const cefr = (wordExplanation?.cefr || savedEntry?.cefr || 'B1').toUpperCase();
  const collins = wordExplanation?.collins ?? savedEntry?.collins ?? 3;

  const rawModelName =
    settings.modelName?.trim() ||
    wordExplanation?.aiModel?.trim() ||
    AI_PRESETS[settings.aiProvider]?.modelName ||
    'AI';

  const formatModelDisplayName = (model: string): string => {
    const clean = model.trim().replace(/^models\//, '');
    if (clean.toLowerCase() === 'grok-4.6') return 'Grok 4.6';
    return clean;
  };

  const displayModel = formatModelDisplayName(rawModelName);

  const getAiBadgeText = (model: string, lang?: SupportedLang): string => {
    if (lang === 'en') return `${model} Deep Analysis`;
    if (lang === 'ja') return `${model} 詳細解析`;
    return `${model} 深度解析`;
  };

  const aiBadgeText = getAiBadgeText(displayModel, settings.uiLanguage);

  const getAiLoadingText = (model: string, lang?: SupportedLang): string => {
    if (lang === 'en') return `Analyzing context with ${model}...`;
    if (lang === 'ja') return `${model} が文脈を深層解析中...`;
    return `正在进行 ${model} 语境深度解析...`;
  };

  const aiLoadingText = getAiLoadingText(displayModel, settings.uiLanguage);

  const isAiExplanation =
    !wordExplanation?.isFallback &&
    (wordExplanation?.source === 'grok-ai' ||
     wordExplanation?.source === 'google' ||
     Boolean(wordExplanation?.aiModel) ||
     (Boolean(wordExplanation?.contextIntent) && wordExplanation?.source !== 'offline-rich') ||
     (Boolean(wordExplanation?.contextExplanation) &&
      wordExplanation?.source !== 'offline-rich' &&
      wordExplanation?.source !== 'ecdict-mini'));

  // Distinct color badge for CEFR levels (A1/A2 green, B1/B2 sky, C1/C2 purple)
  const getCefrBadgeStyle = (level: string) => {
    switch (level) {
      case 'A1':
      case 'A2':
        return 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-[0_0_8px_rgba(16,185,129,0.15)]';
      case 'B1':
      case 'B2':
        return 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-[0_0_8px_rgba(6,182,212,0.15)]';
      case 'C1':
      case 'C2':
        return 'bg-purple-500/15 text-purple-300 border border-purple-500/30 shadow-[0_0_8px_rgba(168,85,247,0.15)]';
      default:
        return 'bg-slate-700/30 text-slate-300 border border-slate-600/30';
    }
  };

  const handleCopyExample = (idx: number, en: string, zh?: string) => {
    const text = zh ? `${en}\n${zh}` : en;
    navigator.clipboard.writeText(text);
    setCopiedExampleIdx(idx);
    setTimeout(() => setCopiedExampleIdx(null), 1800);
  };

  const handleCopyCard = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!wordExplanation) return;
    const text = [
      `${wordExplanation.word} ${wordExplanation.phonetic || ''} [CEFR: ${cefr}]`,
      `释义: ${wordExplanation.quickCn || ''}`,
      wordExplanation.contextIntent ? `意图: ${wordExplanation.contextIntent}` : '',
      `例句: ${wordExplanation.contextSentenceEn || ''}`,
      `翻译: ${wordExplanation.contextSentenceZh || ''}`
    ].filter(Boolean).join('\n');

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRetryAi = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!selectedWord) return;
    selectWord(
      selectedWord,
      wordExplanation?.contextSentenceEn || '',
      wordExplanation?.contextSentenceZh || '',
      popupPosition
    );
  };

  return (
    <>
      {/* Invisible backdrop to dismiss popup when clicking anywhere outside */}
      <div
        className="fixed inset-0 z-[999999] bg-transparent"
        onClick={closeWordPopup}
      />

      {/* Word Popup Card */}
      <div
        translate="no"
        className="notranslate fixed z-[1000000] w-[400px] max-h-[530px] bg-[#121620]/95 backdrop-blur-xl text-gray-100 rounded-2xl shadow-[0_20px_60px_-10px_rgba(0,0,0,0.8),0_0_1px_1px_rgba(255,255,255,0.12)] border border-white/15 flex flex-col overflow-hidden font-sans ring-1 ring-black/50 animate-in fade-in zoom-in-95 duration-150"
        style={{
          left: `${popupPosition.x}px`,
          top: `${popupPosition.y}px`,
          transform: popupPosition.placement === 'bottom' ? 'none' : 'translateY(-100%)'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Pointer notch */}
        {popupPosition.arrowOffset !== undefined && (
          <div
            className={`absolute w-3 h-3 bg-[#121620] border-white/15 rotate-45 z-10 ${
              popupPosition.placement === 'bottom'
                ? '-top-1.5 border-t border-l'
                : '-bottom-1.5 border-b border-r'
            }`}
            style={{ left: `${Math.max(16, Math.min(384, popupPosition.arrowOffset))}px` }}
          />
        )}

        {/* 1. Header Bar */}
        <div className="bg-[#161c27] border-b border-white/10 px-4 py-3 flex items-center justify-between select-none relative z-20">
          <div className="flex items-center space-x-2 truncate">
            <span className="font-bold text-lg text-white tracking-tight truncate drop-shadow-sm">{selectedWord}</span>
            {wordExplanation?.phonetic && (
              <span className="text-xs text-cyan-200/90 font-mono bg-cyan-950/50 px-1.5 py-0.5 rounded border border-cyan-500/20 shrink-0">
                {wordExplanation.phonetic}
              </span>
            )}
            {/* CEFR Difficulty Badge */}
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold uppercase tracking-wider shrink-0 ${getCefrBadgeStyle(cefr)}`}>
              {cefr}
            </span>
            {/* Collins Stars */}
            {collins > 0 && (
              <div className="flex items-center space-x-0.5 text-amber-400 shrink-0" title={`柯林斯词频星级: ${collins}星`}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star
                    key={i}
                    size={10}
                    className={i < collins ? 'fill-amber-400 text-amber-400' : 'text-gray-600/50'}
                  />
                ))}
              </div>
            )}
            {/* Provider Badge */}
            {isAiExplanation ? (
              <span
                className="bg-gradient-to-r from-cyan-900/50 to-blue-900/50 border border-cyan-500/30 text-cyan-200 text-[10px] font-medium px-2 py-0.5 rounded-full shadow-sm flex items-center space-x-1 shrink-0 max-w-[140px]"
                title={aiBadgeText}
              >
                <Sparkles size={10} className="text-cyan-300 shrink-0" />
                <span className="truncate">{aiBadgeText}</span>
              </span>
            ) : wordExplanation?.source === 'offline-rich' ? (
              <span className="bg-amber-500/15 text-amber-200 border border-amber-500/30 text-[10px] px-2 py-0.5 rounded-full font-medium">
                {t.wordPopup.offlineRichBadge}
              </span>
            ) : (
              <span className="bg-white/5 text-gray-300 border border-white/10 text-[10px] px-2 py-0.5 rounded-full font-medium">
                {t.wordPopup.offlineBadge}
              </span>
            )}
          </div>

          <div className="flex items-center space-x-1 shrink-0 ml-2">
            {/* Audio Button with Hover Ripple */}
            <div className="relative group/audio flex items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-cyan-400/20 scale-75 opacity-0 group-hover/audio:scale-125 group-hover/audio:opacity-100 transition-all duration-300 ease-out pointer-events-none" />
              <AudioButton
                word={selectedWord}
                className="relative z-10 text-cyan-300 hover:text-white transition-colors p-1"
                size={16}
              />
            </div>
            <button
              type="button"
              onClick={handleCopyCard}
              title="复制生词卡"
              className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors active:scale-95"
            >
              {copied ? <CheckCheck size={16} className="text-emerald-400" /> : <Copy size={16} />}
            </button>
            <button
              type="button"
              onClick={closeWordPopup}
              title="关闭"
              className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors active:scale-95"
            >
              <X size={17} />
            </button>
          </div>
        </div>

        {/* 2. Sub-Header: Context Intent & Quick CN Strip */}
        {wordExplanation && (
          <div className="bg-[#0e121a]/85 border-b border-white/5 px-4 py-2 space-y-1.5">
            {wordExplanation.quickCn && (
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-bold text-amber-300 truncate text-sm tracking-wide" title={wordExplanation.quickCn}>
                  {wordExplanation.quickCn}
                </span>
                {wordExplanation.wordPosition && (
                  <span className="text-[10px] text-gray-400 bg-white/5 px-2 py-0.5 rounded-full border border-white/10 ml-2 shrink-0 max-w-[170px] truncate" title={wordExplanation.wordPosition}>
                    {wordExplanation.wordPosition}
                  </span>
                )}
              </div>
            )}
            {wordExplanation.contextIntent ? (
              <div className="text-[11px] bg-cyan-950/30 border-l-2 border-cyan-400 text-cyan-200/90 pl-2.5 py-1 rounded-r leading-relaxed flex items-start space-x-1.5">
                <span className="text-cyan-400 font-semibold shrink-0">{t.wordPopup.intentPrefix}</span>
                <span className="line-clamp-2 text-slate-200">{wordExplanation.contextIntent}</span>
              </div>
            ) : isLoadingExplanation ? (
              <div className="text-[11px] text-cyan-300/90 flex items-center space-x-1.5 pt-0.5 animate-pulse">
                <Loader2 size={11} className="animate-spin text-cyan-400" />
                <span>{aiLoadingText}</span>
              </div>
            ) : null}
          </div>
        )}

        {/* 3. Segmented Tab Bar */}
        <div className="p-2 bg-[#0d1017] border-b border-white/10">
          <div className="grid grid-cols-3 gap-1 bg-[#151a24] p-1 rounded-xl border border-white/5 text-xs font-medium select-none">
            <button
              type="button"
              onClick={() => setActiveTab('context')}
              className={`relative py-1.5 px-2 rounded-lg flex items-center justify-center space-x-1.5 transition-all duration-200 ${
                activeTab === 'context'
                  ? 'bg-gradient-to-b from-white/15 to-white/5 text-cyan-300 font-semibold shadow-sm border border-white/10'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.04]'
              }`}
            >
              <Sparkles size={13} className={activeTab === 'context' ? 'text-cyan-400' : 'text-gray-400'} />
              <span>{t.wordPopup.tabExplain}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('grammar')}
              className={`relative py-1.5 px-2 rounded-lg flex items-center justify-center space-x-1.5 transition-all duration-200 ${
                activeTab === 'grammar'
                  ? 'bg-gradient-to-b from-white/15 to-white/5 text-cyan-300 font-semibold shadow-sm border border-white/10'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.04]'
              }`}
            >
              <BookOpen size={13} className={activeTab === 'grammar' ? 'text-cyan-400' : 'text-gray-400'} />
              <span>{t.wordPopup.tabGrammar}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('examples');
                if (!wordExplanation?.aiExtendedExamples || wordExplanation.aiExtendedExamples.length === 0) {
                  fetchWordExtendedExamples();
                }
              }}
              className={`relative py-1.5 px-2 rounded-lg flex items-center justify-center space-x-1.5 transition-all duration-200 ${
                activeTab === 'examples'
                  ? 'bg-gradient-to-b from-white/15 to-white/5 text-cyan-300 font-semibold shadow-sm border border-white/10'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.04]'
              }`}
            >
              <MessageSquareText size={13} className={activeTab === 'examples' ? 'text-cyan-400' : 'text-gray-400'} />
              <span>{t.wordPopup.tabExamples}</span>
            </button>
          </div>
        </div>

        {/* 4. Tab Body Content */}
        <div className="p-3.5 overflow-y-auto max-h-[310px] space-y-3 leading-relaxed text-sm bg-[#121620]/90">
          {!wordExplanation && isLoadingExplanation ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-2.5 text-gray-400">
              <Loader2 size={26} className="animate-spin text-cyan-400" />
              <span className="text-xs">{aiLoadingText}</span>
            </div>
          ) : (
            <>
              {/* Tab 1: Context & Definitions */}
              {activeTab === 'context' && (
                <div className="space-y-3">
                  {/* Context Explanation */}
                  {isLoadingExplanation && !wordExplanation?.contextExplanation ? (
                    <div className="bg-[#141923] p-3 rounded-xl border border-cyan-500/30 text-gray-200 animate-pulse relative overflow-hidden">
                      <div className="absolute top-0 left-0 bottom-0 w-1 bg-cyan-400" />
                      <div className="text-[11px] text-cyan-400 font-semibold mb-1 flex items-center space-x-1.5">
                        <Loader2 size={12} className="animate-spin text-cyan-400" />
                        <span>
                          {settings.uiLanguage === 'en'
                            ? `${displayModel} extracting deep context...`
                            : settings.uiLanguage === 'ja'
                            ? `${displayModel} が文脈を抽出中...`
                            : `${displayModel} 深度语境提炼中...`}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 leading-relaxed pl-1">
                        正在结合当前整句台词，深入分析说话者意图、句中语法指代与地道语感...
                      </p>
                    </div>
                  ) : wordExplanation?.contextExplanation ? (
                    <div className="bg-[#141923] p-3 rounded-xl border border-white/10 text-gray-200 relative overflow-hidden">
                      <div className="absolute top-0 left-0 bottom-0 w-1 bg-gradient-to-b from-cyan-400 to-blue-500" />
                      <div className="text-[11px] text-cyan-300 font-semibold mb-1.5 flex items-center space-x-1.5">
                        <Sparkles size={12} className="text-cyan-400" />
                        <span>语境含义剖析：</span>
                      </div>
                      <blockquote className="text-xs text-gray-200 leading-relaxed font-sans pl-1 border-l border-white/10 italic">
                        "{wordExplanation.contextExplanation}"
                      </blockquote>
                    </div>
                  ) : (
                    <div className="bg-[#141923] p-2.5 rounded-xl border border-amber-500/30 text-gray-300 flex items-center justify-between text-xs">
                      <span>{t.wordPopup.offlineBadge}（未获取到 AI 语境）</span>
                      <button
                        type="button"
                        onClick={handleRetryAi}
                        className="text-cyan-400 hover:text-cyan-300 text-[11px] underline"
                      >
                        {t.wordPopup.retryAi}
                      </button>
                    </div>
                  )}

                  {/* Definitions by Part of Speech */}
                  {wordExplanation?.definitions && wordExplanation.definitions.length > 0 && (
                    <div className="space-y-2 pt-1">
                      <div className="text-[11px] text-gray-400 font-medium flex items-center justify-between">
                        <span>常用词性释义</span>
                        <span className="text-[10px] text-gray-500">{wordExplanation.definitions.length} 项</span>
                      </div>
                      <div className="space-y-1.5">
                        {wordExplanation.definitions.map((def, idx) => (
                          <div
                            key={idx}
                            className="text-xs flex items-start space-x-2.5 bg-[#141923] p-2.5 rounded-xl border border-white/5 hover:border-white/10 transition-colors"
                          >
                            <span className="text-amber-400 font-mono font-bold bg-amber-400/10 px-1.5 py-0.5 rounded text-[10px] border border-amber-400/20 shrink-0">
                              {def.pos}
                            </span>
                            <span className="text-gray-200 font-medium leading-relaxed">{def.meaning}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Current Sentence Context */}
                  {wordExplanation?.contextSentenceEn && (
                    <div className="bg-[#141923] p-3 rounded-xl border border-white/5 space-y-1.5 text-xs">
                      <div className="text-[11px] text-gray-400 font-medium flex items-center space-x-1">
                        <span>当前台词语境：</span>
                      </div>
                      <div className="text-white font-medium italic leading-relaxed">
                        {wordExplanation.contextSentenceEn}
                      </div>
                      {wordExplanation.contextSentenceZh && (
                        <div className="text-gray-400 text-xs leading-relaxed">
                          {wordExplanation.contextSentenceZh}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Tab 2: Grammar & Comparison */}
              {activeTab === 'grammar' && (
                <div className="space-y-3">
                  {/* Grammatical Role */}
                  <div className="bg-[#141923] p-3 rounded-xl border border-white/10 text-xs space-y-1.5">
                    <div className="font-semibold text-cyan-300 flex items-center space-x-1.5">
                      <BookOpen size={13} className="text-cyan-400" />
                      <span>语法与句法角色：</span>
                    </div>
                    <p className="text-gray-200 leading-relaxed">
                      {wordExplanation?.grammar || '在当前语境中充当核心语言实词与修饰成分。'}
                    </p>
                  </div>

                  {/* Sentence Comparison */}
                  {wordExplanation?.sentenceComparison && (
                    <div className="bg-[#141923] p-3 rounded-xl border border-white/10 text-xs space-y-2">
                      <div className="font-semibold text-indigo-300 flex items-center space-x-1.5">
                        <span>句型用法对比与辨析：</span>
                      </div>
                      {wordExplanation.sentenceComparison.currentUsage && (
                        <div className="bg-[#181e2b] p-2 rounded-lg border border-white/5 text-gray-200 leading-relaxed">
                          <span className="text-cyan-400 font-medium mr-1.5">当前用法：</span>
                          {wordExplanation.sentenceComparison.currentUsage}
                        </div>
                      )}
                      {wordExplanation.sentenceComparison.contrastUsage && (
                        <div className="bg-[#181e2b] p-2 rounded-lg border border-white/5 text-gray-200 leading-relaxed">
                          <span className="text-amber-400 font-medium mr-1.5">常态对比：</span>
                          {wordExplanation.sentenceComparison.contrastUsage}
                        </div>
                      )}
                      {wordExplanation.sentenceComparison.nuanceTip && (
                        <div className="bg-emerald-950/20 p-2 rounded-lg border border-emerald-500/20 text-emerald-200/90 leading-relaxed">
                          <span className="font-semibold text-emerald-400 mr-1.5">语感辨析：</span>
                          {wordExplanation.sentenceComparison.nuanceTip}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Collocations */}
                  {wordExplanation?.collocations && wordExplanation.collocations.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <div className="text-[11px] text-gray-400 font-medium">高频固定搭配：</div>
                      <div className="grid grid-cols-1 gap-1.5">
                        {wordExplanation.collocations.map((item, idx) => (
                          <div
                            key={idx}
                            className="bg-[#141923] px-3 py-2 rounded-xl border border-white/5 hover:border-cyan-500/30 text-xs flex items-center justify-between transition-colors"
                          >
                            <span className="text-cyan-300 font-medium">{item.phrase}</span>
                            <span className="text-gray-400 text-[11px]">{item.translation}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Tab 3: Extended Examples */}
              {activeTab === 'examples' && (
                <div className="space-y-3">
                  {/* Sub-header: status / title and regenerate action */}
                  <div className="flex items-center justify-between pb-1.5 border-b border-white/10 text-xs">
                    <div className="flex items-center space-x-1.5 text-cyan-300 font-semibold text-[11px]">
                      <Sparkles size={12} className="text-cyan-400" />
                      <span>{settings.uiLanguage === 'en' ? 'AI Scenario Examples (3 sentences)' : settings.uiLanguage === 'ja' ? 'AI 状況別発展例文 (3文)' : 'AI 场景拓展例句 (3句)'}</span>
                    </div>
                    <button
                      type="button"
                      disabled={isLoadingExtendedExamples}
                      onClick={() => fetchWordExtendedExamples(true)}
                      className="flex items-center space-x-1 text-[11px] text-gray-400 hover:text-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded-md border border-white/10"
                      title={t.wordPopup.regenerateExamples || '重新生成'}
                    >
                      <RefreshCw size={11} className={isLoadingExtendedExamples ? 'animate-spin text-cyan-400' : ''} />
                      <span>{t.wordPopup.regenerateExamples || '重新生成'}</span>
                    </button>
                  </div>

                  {isLoadingExtendedExamples ? (
                    <div className="py-8 flex flex-col items-center justify-center space-y-2.5 text-center">
                      <Loader2 size={26} className="animate-spin text-cyan-400" />
                      <p className="text-xs text-gray-200 font-medium">
                        {t.wordPopup.loadingExamples || '正在构思 3 个场景拓展例句及语法解析...'}
                      </p>
                      <p className="text-[11px] text-gray-400">
                        {settings.uiLanguage === 'en'
                          ? 'Generating tailored ESL sentences with grammar & nuance...'
                          : '深度对齐例句语境、句法功能与词义辨析...'}
                      </p>
                    </div>
                  ) : wordExplanation?.aiExtendedExamples && wordExplanation.aiExtendedExamples.length > 0 ? (
                    <div className="space-y-2.5">
                      {wordExplanation.aiExtendedExamples.map((eg, idx) => (
                        <div
                          key={idx}
                          className="bg-[#141923] hover:bg-[#161d29] p-3.5 rounded-xl border border-white/10 hover:border-cyan-500/30 shadow-[0_4px_12px_rgba(0,0,0,0.25)] space-y-2.5 text-xs transition-all duration-200 group/card"
                        >
                          {/* Sentence English + Audio & Copy buttons */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start space-x-2 flex-1 leading-relaxed">
                              <span className="bg-gradient-to-br from-cyan-500/25 to-blue-500/25 text-cyan-300 border border-cyan-500/30 font-mono font-bold px-1.5 py-0.5 rounded-md text-[10px] shrink-0 mt-0.5 shadow-sm">
                                #{idx + 1}
                              </span>
                              <div className="text-gray-100 font-medium text-xs leading-relaxed">
                                {eg.highlightWord ? (
                                  <span>
                                    {eg.en.split(new RegExp(`(${eg.highlightWord})`, 'gi')).map((part, i) =>
                                      part.toLowerCase() === eg.highlightWord?.toLowerCase() ? (
                                        <span key={i} className="text-cyan-300 font-bold underline decoration-cyan-400/60 decoration-2 underline-offset-2">
                                          {part}
                                        </span>
                                      ) : (
                                        <span key={i}>{part}</span>
                                      )
                                    )}
                                  </span>
                                ) : (
                                  eg.en
                                )}
                              </div>
                            </div>
                            <div className="flex items-center space-x-1 shrink-0 -mt-0.5">
                              <button
                                type="button"
                                onClick={() => handleCopyExample(idx, eg.en, eg.zh)}
                                title="复制例句"
                                className="p-1 rounded-md text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                              >
                                {copiedExampleIdx === idx ? (
                                  <Check size={13} className="text-emerald-400" />
                                ) : (
                                  <Copy size={13} />
                                )}
                              </button>
                              <AudioButton word={eg.en} size={14} className="text-cyan-400 hover:text-cyan-300 p-1" />
                            </div>
                          </div>

                          {/* Sentence Chinese */}
                          {eg.zh && (
                            <div className="text-gray-300/90 text-xs pl-7 leading-relaxed font-sans">
                              {eg.zh}
                            </div>
                          )}

                          {/* Syntax & Meaning Breakdown Tags */}
                          {(eg.meaningExplanation || eg.grammarExplanation) && (
                            <div className="space-y-1.5 pt-1 border-t border-white/5">
                              {eg.meaningExplanation && (
                                <div className="bg-cyan-950/20 p-2 rounded-lg border border-cyan-500/20 text-gray-200 text-[11px] leading-relaxed flex items-start space-x-2">
                                  <span className="bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-1.5 py-0.2 rounded font-semibold text-[10px] shrink-0">
                                    {t.wordPopup.meaningLabel || '词义用法'}
                                  </span>
                                  <span>{eg.meaningExplanation}</span>
                                </div>
                              )}

                              {eg.grammarExplanation && (
                                <div className="bg-indigo-950/20 p-2 rounded-lg border border-indigo-500/20 text-gray-200 text-[11px] leading-relaxed flex items-start space-x-2">
                                  <span className="bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-1.5 py-0.2 rounded font-semibold text-[10px] shrink-0">
                                    {t.wordPopup.grammarLabel || '句法结构'}
                                  </span>
                                  <span>{eg.grammarExplanation}</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : !settings.apiKey || settings.apiKey.trim() === '' ? (
                    <div className="bg-[#141923] p-3 rounded-xl border border-amber-500/30 text-xs space-y-2 text-gray-300">
                      <div className="flex items-center space-x-1.5 text-amber-400 font-medium">
                        <AlertCircle size={14} />
                        <span>{t.wordPopup.noApiKeyExamples || '未配置 AI API Key'}</span>
                      </div>
                      <p className="text-[11px] text-gray-400 leading-relaxed">
                        配置 API Key 后，点击拓展例句即可由大模型为你量身生成 3 个真实场景例句，并提供语法结构和语境词义解析。
                      </p>
                      {wordExplanation?.examples && wordExplanation.examples.length > 0 && (
                        <div className="pt-2 border-t border-white/10">
                          <div className="text-[11px] text-gray-500 mb-1">当前视频例句：</div>
                          <div className="text-gray-200 font-medium">{wordExplanation.examples[0].en}</div>
                          <div className="text-gray-400">{wordExplanation.examples[0].zh}</div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="bg-[#141923] p-3 rounded-xl border border-red-500/30 text-xs space-y-2 text-center text-gray-300">
                      <p className="text-red-400">{t.wordPopup.failedExamples || '拓展例句生成失败，请重试'}</p>
                      <button
                        type="button"
                        onClick={() => fetchWordExtendedExamples(true)}
                        className="text-xs bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-200 border border-cyan-500/30 px-3 py-1 rounded-lg transition-colors"
                      >
                        {t.wordPopup.retryAi}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* 5. Bottom Action & Status Bar */}
        <div className="bg-[#10141c]/95 px-4 py-2.5 border-t border-white/10 flex items-center justify-between text-xs select-none">
          <div className="flex items-center space-x-1.5">
            {/* Mark Known */}
            <button
              type="button"
              title="标记为已掌握 (Known)"
              onClick={() => saveOrUpdateWord(selectedWord, 'known')}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg transition-all ${
                currentLevel === 'known'
                  ? 'bg-emerald-500 text-white font-medium shadow-sm shadow-emerald-500/30'
                  : 'hover:bg-white/10 text-emerald-400 bg-emerald-500/10 border border-emerald-500/20'
              }`}
            >
              <Check size={13} />
              <span className="text-[11px]">{t.wordPopup.known}</span>
            </button>

            {/* Mark Learning */}
            <button
              type="button"
              title="加入生词本/学习中 (Learning)"
              onClick={() => saveOrUpdateWord(selectedWord, 'learning')}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg transition-all ${
                currentLevel === 'learning'
                  ? 'bg-amber-500 text-white font-medium shadow-sm shadow-amber-500/30'
                  : 'hover:bg-white/10 text-amber-400 bg-amber-500/10 border border-amber-500/20'
              }`}
            >
              <Bookmark size={13} />
              <span className="text-[11px]">{t.wordPopup.learning}</span>
            </button>

            {/* Mark Mastered */}
            <button
              type="button"
              title="熟练掌握 (Mastered)"
              onClick={() => saveOrUpdateWord(selectedWord, 'mastered')}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg transition-all ${
                currentLevel === 'mastered'
                  ? 'bg-cyan-500 text-white font-medium shadow-sm shadow-cyan-500/30'
                  : 'hover:bg-white/10 text-cyan-400 bg-cyan-500/10 border border-cyan-500/20'
              }`}
            >
              <Star size={13} />
              <span className="text-[11px]">{t.wordPopup.mastered}</span>
            </button>
          </div>

          {/* Right Status / Fallback Notice & Retry Action */}
          <div className="flex items-center space-x-2">
            {wordExplanation?.isFallback ? (
              <div className="flex items-center space-x-1.5">
                <span
                  className="text-[11px] text-amber-300/80 flex items-center space-x-1"
                  title={wordExplanation.fallbackReason || '本地词典兜底模式'}
                >
                  <AlertCircle size={12} className="text-amber-400" />
                  <span>{t.wordPopup.offlineBadge}</span>
                </span>
                <button
                  type="button"
                  onClick={handleRetryAi}
                  disabled={isLoadingExplanation}
                  className="flex items-center space-x-1 text-[11px] bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-500/40 px-2 py-0.5 rounded-lg transition-all active:scale-95"
                  title={
                    settings.uiLanguage === 'en'
                      ? `Retry ${displayModel} Analysis`
                      : settings.uiLanguage === 'ja'
                      ? `${displayModel} 解析を再試行`
                      : `重新发起 ${displayModel} 深度解析`
                  }
                >
                  <RefreshCw size={11} className={isLoadingExplanation ? 'animate-spin' : ''} />
                  <span>{t.wordPopup.retryAi}</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
};

export const WordPopup: React.FC = () => {
  return (
    <WordPopupErrorBoundary>
      <WordPopupInner />
    </WordPopupErrorBoundary>
  );
};
