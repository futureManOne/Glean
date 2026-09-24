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
        <div className="p-4 bg-[#242429] text-gray-200 rounded-xl border border-red-500/40 text-center space-y-2.5 max-w-[360px] shadow-2xl">
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
              className="text-xs bg-red-600/30 hover:bg-red-600/50 text-white px-3 py-1 rounded transition-colors"
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
        return 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
      case 'B1':
      case 'B2':
        return 'bg-sky-500/20 text-sky-300 border border-sky-500/30';
      case 'C1':
      case 'C2':
        return 'bg-purple-500/20 text-purple-300 border border-purple-500/30';
      default:
        return 'bg-gray-700/50 text-gray-300 border border-gray-600/40';
    }
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
        className="fixed z-[1000000] w-[390px] max-h-[520px] bg-[#242429] text-gray-100 rounded-xl shadow-2xl border border-[#383842] flex flex-col overflow-hidden font-sans animate-in fade-in zoom-in-95 duration-150"
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
            className={`absolute w-3 h-3 bg-[#242429] border-[#383842] rotate-45 z-10 ${
              popupPosition.placement === 'bottom'
                ? '-top-1.5 border-t border-l bg-[#0284c7]'
                : '-bottom-1.5 border-b border-r bg-[#242429]'
            }`}
            style={{ left: `${Math.max(16, Math.min(374, popupPosition.arrowOffset))}px` }}
          />
        )}

        {/* 1. Header Bar */}
        <div className="bg-[#0284c7] text-white px-3.5 py-2.5 flex items-center justify-between select-none">
          <div className="flex items-center space-x-2 truncate">
            <span className="font-bold text-lg truncate">{selectedWord}</span>
            {wordExplanation?.phonetic && (
              <span className="text-xs text-blue-100 opacity-95 font-mono">
                {wordExplanation.phonetic}
              </span>
            )}
            {/* CEFR Difficulty Badge */}
            <span className={`text-[11px] px-1.5 py-0.5 rounded font-mono font-bold ${getCefrBadgeStyle(cefr)}`}>
              {cefr}
            </span>
            {/* Provider Badge */}
            {isAiExplanation ? (
              <span
                className="bg-gradient-to-r from-blue-700 to-indigo-700 text-white text-[10px] font-semibold px-2 py-0.5 rounded shadow-sm flex items-center space-x-1 shrink-0 max-w-[170px]"
                title={aiBadgeText}
              >
                <Sparkles size={10} className="text-yellow-300 shrink-0" />
                <span className="truncate">{aiBadgeText}</span>
              </span>
            ) : wordExplanation?.source === 'offline-rich' ? (
              <span className="bg-amber-600/30 text-amber-200 border border-amber-400/40 text-[10px] px-1.5 py-0.5 rounded">
                {t.wordPopup.offlineRichBadge}
              </span>
            ) : (
              <span className="bg-gray-700/60 text-gray-300 border border-gray-600/40 text-[10px] px-1.5 py-0.5 rounded">
                {t.wordPopup.offlineBadge}
              </span>
            )}
          </div>

          <div className="flex items-center space-x-1.5 shrink-0 ml-2">
            <button
              type="button"
              onClick={handleCopyCard}
              title="复制生词卡"
              className="p-1 rounded hover:bg-white/20 text-white transition-colors"
            >
              {copied ? <CheckCheck size={16} className="text-emerald-300" /> : <Copy size={16} />}
            </button>
            <AudioButton word={selectedWord} className="text-white hover:text-white/80" size={17} />
            <button
              type="button"
              onClick={closeWordPopup}
              className="p-1 rounded hover:bg-white/20 text-white transition-colors"
            >
              <X size={17} />
            </button>
          </div>
        </div>

        {/* 2. Sub-Header: Context Intent & Quick CN Strip */}
        {wordExplanation && (
          <div className="bg-[#1e1e23] border-b border-[#383842]/60 px-3.5 py-2 space-y-1">
            {wordExplanation.quickCn && (
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-semibold text-yellow-300 truncate text-sm" title={wordExplanation.quickCn}>
                  {wordExplanation.quickCn}
                </span>
                {wordExplanation.wordPosition && (
                  <span className="text-[11px] text-gray-400 ml-2 shrink-0 max-w-[170px] truncate" title={wordExplanation.wordPosition}>
                    {wordExplanation.wordPosition}
                  </span>
                )}
              </div>
            )}
            {wordExplanation.contextIntent ? (
              <div className="text-[11px] text-sky-200/90 leading-tight flex items-start space-x-1 pt-0.5">
                <span className="text-sky-400 font-semibold shrink-0">{t.wordPopup.intentPrefix}</span>
                <span className="line-clamp-2 text-gray-300">{wordExplanation.contextIntent}</span>
              </div>
            ) : isLoadingExplanation ? (
              <div className="text-[11px] text-sky-300/80 flex items-center space-x-1.5 pt-0.5 animate-pulse">
                <Loader2 size={11} className="animate-spin text-sky-400" />
                <span>{aiLoadingText}</span>
              </div>
            ) : null}
          </div>
        )}

        {/* 3. Tabs Navigation */}
        <div className="flex border-b border-[#383842] bg-[#1c1c20] text-xs font-medium select-none">
          <button
            type="button"
            onClick={() => setActiveTab('context')}
            className={`flex-1 py-2 flex items-center justify-center space-x-1 border-b-2 transition-colors ${
              activeTab === 'context'
                ? 'border-[#0284c7] text-[#38bdf8] bg-[#242429]'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Sparkles size={13} />
            <span>{t.wordPopup.tabExplain}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('grammar')}
            className={`flex-1 py-2 flex items-center justify-center space-x-1 border-b-2 transition-colors ${
              activeTab === 'grammar'
                ? 'border-[#0284c7] text-[#38bdf8] bg-[#242429]'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <BookOpen size={13} />
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
            className={`flex-1 py-2 flex items-center justify-center space-x-1 border-b-2 transition-colors ${
              activeTab === 'examples'
                ? 'border-[#0284c7] text-[#38bdf8] bg-[#242429]'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <MessageSquareText size={13} />
            <span>{t.wordPopup.tabExamples}</span>
          </button>
        </div>

        {/* 4. Tab Body Content */}
        <div className="p-3.5 overflow-y-auto max-h-[300px] space-y-3 leading-relaxed text-sm bg-[#242429]">
          {!wordExplanation && isLoadingExplanation ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-2.5 text-gray-400">
              <Loader2 size={26} className="animate-spin text-[#0284c7]" />
              <span className="text-xs">{aiLoadingText}</span>
            </div>
          ) : (
            <>
              {/* Tab 1: Context & Definitions */}
              {activeTab === 'context' && (
                <div className="space-y-3">
                  {/* Context Explanation */}
              {isLoadingExplanation && !wordExplanation?.contextExplanation ? (
                <div className="bg-[#18181b] p-3 rounded-lg border border-sky-500/30 text-gray-200 animate-pulse">
                  <div className="text-[11px] text-sky-400 font-semibold mb-1 flex items-center space-x-1.5">
                    <Loader2 size={12} className="animate-spin text-sky-400" />
                    <span>
                      {settings.uiLanguage === 'en'
                        ? `${displayModel} extracting deep context...`
                        : settings.uiLanguage === 'ja'
                        ? `${displayModel} が文脈を抽出中...`
                        : `${displayModel} 深度语境提炼中...`}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    正在结合当前整句台词，深入分析说话者意图、句中语法指代与地道语感...
                  </p>
                </div>
              ) : wordExplanation?.contextExplanation ? (
                <div className="bg-[#18181b] p-3 rounded-lg border border-[#383842] text-gray-200">
                  <div className="text-[11px] text-sky-400 font-semibold mb-1 flex items-center space-x-1">
                    <Sparkles size={11} />
                    <span>语境含义剖析：</span>
                  </div>
                  <p className="text-xs text-gray-300 leading-relaxed">
                    {wordExplanation.contextExplanation}
                  </p>
                </div>
              ) : (
                <div className="bg-[#18181b] p-2.5 rounded-lg border border-amber-500/30 text-gray-300 flex items-center justify-between text-xs">
                  <span>{t.wordPopup.offlineBadge}（未获取到 AI 语境）</span>
                  <button
                    type="button"
                    onClick={handleRetryAi}
                    className="text-sky-400 hover:text-sky-300 text-[11px] underline"
                  >
                    {t.wordPopup.retryAi}
                  </button>
                </div>
              )}

              {/* Definitions by Part of Speech */}
              {wordExplanation?.definitions && wordExplanation.definitions.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <div className="text-[11px] text-gray-400 font-medium">常用词性释义：</div>
                  {wordExplanation.definitions.map((def, idx) => (
                    <div key={idx} className="text-xs flex items-start space-x-2 bg-[#1b1b20] p-2 rounded border border-[#383842]/40">
                      <span className="text-yellow-400 font-mono font-semibold shrink-0">
                        {def.pos}
                      </span>
                      <span className="text-gray-200">{def.meaning}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Current Sentence Context */}
              {wordExplanation?.contextSentenceEn && (
                <div className="text-xs border-t border-[#383842]/60 pt-2 text-gray-400">
                  <div className="text-[11px] text-gray-500 mb-1">当前台词语境：</div>
                  <div className="text-gray-200 italic font-medium">{wordExplanation.contextSentenceEn}</div>
                  {wordExplanation.contextSentenceZh && (
                    <div className="text-gray-400 mt-1">{wordExplanation.contextSentenceZh}</div>
                  )}
                </div>
              )}
            </div>
          )}

              {/* Tab 2: Grammar & Comparison */}
              {activeTab === 'grammar' && (
                <div className="space-y-2.5">
                  {/* Grammatical Role */}
                  <div className="bg-[#18181b] p-2.5 rounded border border-[#383842] text-xs text-gray-300">
                    <div className="font-semibold text-blue-400 mb-1 flex items-center space-x-1">
                      <BookOpen size={12} />
                      <span>语法与句法角色：</span>
                    </div>
                    <p className="leading-relaxed">
                      {wordExplanation?.grammar || '在当前语境中充当核心语言实词与修饰成分。'}
                    </p>
                  </div>

                  {/* Sentence Comparison */}
                  {wordExplanation?.sentenceComparison && (
                    <div className="bg-[#18181b] p-2.5 rounded border border-[#383842] text-xs space-y-1.5">
                      <div className="font-semibold text-indigo-400 mb-0.5">句型用法对比与辨析：</div>
                      {wordExplanation.sentenceComparison.currentUsage && (
                        <div className="text-gray-300">
                          <span className="text-sky-400 font-medium">当前用法：</span>
                          {wordExplanation.sentenceComparison.currentUsage}
                        </div>
                      )}
                      {wordExplanation.sentenceComparison.contrastUsage && (
                        <div className="text-gray-300">
                          <span className="text-amber-400 font-medium">常态对比：</span>
                          {wordExplanation.sentenceComparison.contrastUsage}
                        </div>
                      )}
                      {wordExplanation.sentenceComparison.nuanceTip && (
                        <div className="text-emerald-300/90 pt-0.5 border-t border-[#383842]/50">
                          <span className="font-medium text-emerald-400">语感辨析：</span>
                          {wordExplanation.sentenceComparison.nuanceTip}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Collocations */}
                  {wordExplanation?.collocations && wordExplanation.collocations.length > 0 && (
                    <div className="space-y-1 pt-1">
                      <div className="text-[11px] text-gray-400 font-medium">高频固定搭配：</div>
                      <div className="grid grid-cols-1 gap-1.5">
                        {wordExplanation.collocations.map((item, idx) => (
                          <div key={idx} className="bg-[#1b1b20] px-2.5 py-1.5 rounded border border-[#383842]/40 text-xs flex items-center justify-between">
                            <span className="text-sky-300 font-medium">{item.phrase}</span>
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
                  <div className="flex items-center justify-between pb-1 border-b border-[#383842]/60 text-xs">
                    <div className="flex items-center space-x-1.5 text-sky-400 font-semibold text-[11px]">
                      <Sparkles size={12} />
                      <span>{settings.uiLanguage === 'en' ? 'AI Scenario Examples (3 sentences)' : settings.uiLanguage === 'ja' ? 'AI 状況別発展例文 (3文)' : 'AI 场景拓展例句 (3句)'}</span>
                    </div>
                    <button
                      type="button"
                      disabled={isLoadingExtendedExamples}
                      onClick={() => fetchWordExtendedExamples(true)}
                      className="flex items-center space-x-1 text-[11px] text-gray-400 hover:text-sky-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      title={t.wordPopup.regenerateExamples || '重新生成'}
                    >
                      <RefreshCw size={11} className={isLoadingExtendedExamples ? 'animate-spin text-sky-400' : ''} />
                      <span>{t.wordPopup.regenerateExamples || '重新生成'}</span>
                    </button>
                  </div>

                  {isLoadingExtendedExamples ? (
                    <div className="py-6 flex flex-col items-center justify-center space-y-2.5 text-center">
                      <Loader2 size={24} className="animate-spin text-sky-400" />
                      <p className="text-xs text-gray-300 font-medium">
                        {t.wordPopup.loadingExamples || '正在构思 3 个场景拓展例句及语法解析...'}
                      </p>
                      <p className="text-[11px] text-gray-500">
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
                          className="bg-[#18181b] p-3 rounded-lg border border-[#383842] hover:border-[#4d4d59] space-y-2 text-xs transition-colors"
                        >
                          {/* Sentence English + Audio */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start space-x-1.5 flex-1 leading-relaxed">
                              <span className="bg-sky-500/20 text-sky-300 font-mono font-bold px-1.5 py-0.5 rounded text-[10px] shrink-0 mt-0.5">
                                #{idx + 1}
                              </span>
                              <div className="text-gray-100 font-medium">
                                {eg.highlightWord ? (
                                  <span>
                                    {eg.en.split(new RegExp(`(${eg.highlightWord})`, 'gi')).map((part, i) =>
                                      part.toLowerCase() === eg.highlightWord?.toLowerCase() ? (
                                        <span key={i} className="text-sky-400 font-bold underline decoration-sky-400/60 decoration-2">
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
                            <AudioButton word={eg.en} size={14} className="shrink-0 -mt-0.5" />
                          </div>

                          {/* Sentence Chinese */}
                          {eg.zh && (
                            <div className="text-gray-300/90 text-xs pl-6">
                              {eg.zh}
                            </div>
                          )}

                          {/* Meaning explanation */}
                          {eg.meaningExplanation && (
                            <div className="bg-[#1b1b20] p-2 rounded border border-sky-500/20 text-gray-300 text-[11px] leading-relaxed flex items-start space-x-1.5">
                              <span className="text-sky-400 font-semibold shrink-0">📖 {t.wordPopup.meaningLabel || '词义用法'}:</span>
                              <span>{eg.meaningExplanation}</span>
                            </div>
                          )}

                          {/* Grammar explanation */}
                          {eg.grammarExplanation && (
                            <div className="bg-[#1b1b20] p-2 rounded border border-indigo-500/20 text-gray-300 text-[11px] leading-relaxed flex items-start space-x-1.5">
                              <span className="text-indigo-400 font-semibold shrink-0">🔍 {t.wordPopup.grammarLabel || '语法结构'}:</span>
                              <span>{eg.grammarExplanation}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : !settings.apiKey || settings.apiKey.trim() === '' ? (
                    <div className="bg-[#18181b] p-3 rounded-lg border border-amber-500/30 text-xs space-y-2 text-gray-300">
                      <div className="flex items-center space-x-1.5 text-amber-400 font-medium">
                        <AlertCircle size={14} />
                        <span>{t.wordPopup.noApiKeyExamples || '未配置 AI API Key'}</span>
                      </div>
                      <p className="text-[11px] text-gray-400 leading-relaxed">
                        配置 API Key 后，点击拓展例句即可由大模型为你量身生成 3 个真实场景例句，并提供语法结构和语境词义解析。
                      </p>
                      {/* Show current subtitle sentence as fallback if available */}
                      {wordExplanation?.examples && wordExplanation.examples.length > 0 && (
                        <div className="pt-2 border-t border-[#383842]/50">
                          <div className="text-[11px] text-gray-500 mb-1">当前视频例句：</div>
                          <div className="text-gray-200 font-medium">{wordExplanation.examples[0].en}</div>
                          <div className="text-gray-400">{wordExplanation.examples[0].zh}</div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="bg-[#18181b] p-3 rounded-lg border border-red-500/30 text-xs space-y-2 text-center text-gray-300">
                      <p className="text-red-400">{t.wordPopup.failedExamples || '拓展例句生成失败，请重试'}</p>
                      <button
                        type="button"
                        onClick={() => fetchWordExtendedExamples(true)}
                        className="text-xs bg-sky-600/30 hover:bg-sky-600/50 text-sky-300 px-3 py-1 rounded transition-colors"
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
        <div className="bg-[#1c1c20] px-3 py-2 border-t border-[#383842] flex items-center justify-between text-xs select-none">
          <div className="flex items-center space-x-1.5">
            {/* Mark Known */}
            <button
              type="button"
              title="标记为已掌握 (Known)"
              onClick={() => saveOrUpdateWord(selectedWord, 'known')}
              className={`p-1.5 rounded transition-colors ${
                currentLevel === 'known'
                  ? 'bg-emerald-600 text-white'
                  : 'hover:bg-white/10 text-emerald-400'
              }`}
            >
              <Check size={14} />
            </button>

            {/* Mark Learning */}
            <button
              type="button"
              title="加入生词本/学习中 (Learning)"
              onClick={() => saveOrUpdateWord(selectedWord, 'learning')}
              className={`p-1.5 rounded transition-colors ${
                currentLevel === 'learning'
                  ? 'bg-amber-600 text-white'
                  : 'hover:bg-white/10 text-amber-400'
              }`}
            >
              <Bookmark size={14} />
            </button>

            {/* Mark Mastered */}
            <button
              type="button"
              title="熟练掌握 (Mastered)"
              onClick={() => saveOrUpdateWord(selectedWord, 'mastered')}
              className={`p-1.5 rounded transition-colors ${
                currentLevel === 'mastered'
                  ? 'bg-blue-600 text-white'
                  : 'hover:bg-white/10 text-blue-400'
              }`}
            >
              <Star size={14} />
            </button>

            <span className="text-[11px] text-gray-400 ml-1">
              {currentLevel === 'known' && t.wordPopup.known}
              {currentLevel === 'learning' && t.wordPopup.learning}
              {currentLevel === 'mastered' && t.wordPopup.mastered}
              {currentLevel === 'new' && t.wordPopup.newWord}
            </span>
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
                  className="flex items-center space-x-1 text-[11px] bg-sky-600/30 hover:bg-sky-600/50 text-sky-200 border border-sky-500/40 px-2 py-0.5 rounded transition-all active:scale-95"
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
            ) : (
              <div className="flex items-center space-x-0.5 text-[11px] text-yellow-400/90 font-mono">
                {Array.from({ length: collins }).map((_, i) => (
                  <span key={i}>★</span>
                ))}
              </div>
            )}
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
