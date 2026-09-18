import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  X,
  Loader2,
  Copy,
  Check,
  RotateCcw,
  Volume2,
  Layers,
  BookOpen,
  Mic,
  MessageSquareQuote,
  RefreshCw,
  AlertCircle,
  Settings
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { AI_PRESETS } from '@/types';
import { VideoPlayerAdapter } from '@/core/player/BaseAdapter';
import { formatTimestamp } from '@/core/subtitle/parser';
import { getLocale } from '@/core/i18n';

interface SentenceAnalysisCardProps {
  player?: VideoPlayerAdapter;
}

interface ParsedSection {
  title: string;
  iconType: 'translation' | 'syntax' | 'idiom' | 'phonetic' | 'general';
  lines: string[];
}

function parseStreamingSections(markdown: string): ParsedSection[] {
  if (!markdown) return [];
  const rawSections = markdown.split(/(?=###\s+)/);
  const result: ParsedSection[] = [];

  for (const raw of rawSections) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const headerMatch = trimmed.match(/^###\s+([^\n]+)/);
    const title = headerMatch ? headerMatch[1].trim() : '';
    const content = headerMatch ? trimmed.slice(headerMatch[0].length).trim() : trimmed;

    let iconType: ParsedSection['iconType'] = 'general';
    if (/意译|語境|Nuance|Tone/i.test(title)) iconType = 'translation';
    else if (/句法|構文|Syntactic|Structure/i.test(title)) iconType = 'syntax';
    else if (/短语|熟語|Collocation|Phrasing|词汇/i.test(title)) iconType = 'idiom';
    else if (/发音|発音|Phonetic|Listening|听力/i.test(title)) iconType = 'phonetic';

    const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
    result.push({ title: title || '语言精讲', iconType, lines });
  }

  return result;
}

function renderInlineMarkdown(text: string): React.ReactNode {
  if (!text) return null;
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-amber-300">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

const SectionIcon: React.FC<{ iconType: ParsedSection['iconType'] }> = ({ iconType }) => {
  switch (iconType) {
    case 'translation':
      return <MessageSquareQuote size={15} className="text-emerald-400 shrink-0" />;
    case 'syntax':
      return <Layers size={15} className="text-blue-400 shrink-0" />;
    case 'idiom':
      return <BookOpen size={15} className="text-amber-400 shrink-0" />;
    case 'phonetic':
      return <Mic size={15} className="text-purple-400 shrink-0" />;
    default:
      return <Sparkles size={15} className="text-indigo-400 shrink-0" />;
  }
};


export const SentenceAnalysisCard: React.FC<SentenceAnalysisCardProps> = ({ player }) => {
  const {
    isSentenceAnalysisOpen,
    selectedSentenceCue,
    sentenceAnalysis,
    streamingAnalysisText,
    isStreamingAnalysis,
    sentenceAnalysisError,
    isLoadingSentenceAnalysis,
    closeSentenceAnalysis,
    analyzeSentence,
    settings,
    isSidePanelOpen,
    setSidePanelOpen
  } = useAppStore();

  const t = getLocale(settings.uiLanguage);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);

  // Auto-scroll to follow typing stream unless user scrolled up
  useEffect(() => {
    if (isStreamingAnalysis && scrollRef.current && !userScrolledUpRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [streamingAnalysisText, isStreamingAnalysis]);

  if (!isSentenceAnalysisOpen || !selectedSentenceCue) {
    return null;
  }

  const handleCopy = () => {
    if (streamingAnalysisText) {
      navigator.clipboard.writeText(streamingAnalysisText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return;
    }

    if (!sentenceAnalysis && !selectedSentenceCue) return;

    const en = selectedSentenceCue.textEn;
    const zh = selectedSentenceCue.textZh;
    const auth = sentenceAnalysis?.authenticTranslation || zh || '';
    const tone = sentenceAnalysis?.contextTone || '';

    let text = `【台词原声】: ${en}\n`;
    if (zh) text += `【参考翻译】: ${zh}\n`;
    if (auth) text += `【地道意译】: ${auth}\n`;
    if (tone) text += `【语境语气】: ${tone}\n`;

    if (sentenceAnalysis?.syntacticBreakdown && sentenceAnalysis.syntacticBreakdown.length > 0) {
      text += `\n【句法结构剖析】:\n`;
      sentenceAnalysis.syntacticBreakdown.forEach((item, i) => {
        text += `${i + 1}. [${item.clause}] (${item.role}) - ${item.explanation}\n`;
      });
    }

    if (sentenceAnalysis?.idiomsAndPhrases && sentenceAnalysis.idiomsAndPhrases.length > 0) {
      text += `\n【核心习语与短语】:\n`;
      sentenceAnalysis.idiomsAndPhrases.forEach((item, i) => {
        text += `${i + 1}. ${item.phrase} : ${item.meaning} (${item.usageNote || ''})\n`;
      });
    }

    if (sentenceAnalysis?.pronunciationTips && sentenceAnalysis.pronunciationTips.length > 0) {
      text += `\n【口语发音与听力秘诀】:\n`;
      sentenceAnalysis.pronunciationTips.forEach((item, i) => {
        text += `${i + 1}. [${item.phenomenon}] ${item.detail}\n`;
      });
    }

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRetry = () => {
    userScrolledUpRef.current = false;
    if (selectedSentenceCue) {
      analyzeSentence(selectedSentenceCue, player, true);
    }
  };

  const handleReplaySentence = () => {
    if (player && selectedSentenceCue) {
      player.seek(selectedSentenceCue.start);
      player.play();
    }
  };

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    userScrolledUpRef.current = scrollHeight - (scrollTop + clientHeight) > 50;
  };

  const modelBadge = settings.modelName || AI_PRESETS[settings.aiProvider]?.modelName || 'gemini-2.5-flash';
  const panelWidth = settings.sidePanelWidth || 420;
  const parsedSections = parseStreamingSections(streamingAnalysisText);

  const isMissingKey = sentenceAnalysisError === 'MISSING_API_KEY' || (!settings.apiKey && !streamingAnalysisText);

  return (
    <div
      role="dialog"
      aria-label={t.sentenceAnalysis.title}
      className="fixed z-[999998] transition-all duration-200 select-text"
      style={{
        right: isSidePanelOpen ? `${panelWidth + 16}px` : '24px',
        bottom: '88px',
        width: '520px',
        maxWidth: 'calc(100vw - 32px)',
        maxHeight: 'calc(100vh - 110px)'
      }}
    >
      <div className="bg-[#141419]/95 backdrop-blur-xl border border-white/15 shadow-2xl rounded-2xl flex flex-col text-gray-100 overflow-hidden max-h-[inherit]">
        {/* ================================================================= */}
        {/* Card Header */}
        {/* ================================================================= */}
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-purple-950/40 via-transparent to-transparent shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center shadow-md">
              <Sparkles size={15} className="text-white animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-sm tracking-wide text-white">{t.sentenceAnalysis.title}</h3>
                <span className="px-2 py-0.5 text-[10px] font-mono font-semibold rounded-full bg-purple-900/70 text-purple-300 border border-purple-500/30">
                  {modelBadge}
                </span>
                {isStreamingAnalysis && (
                  <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-emerald-950/80 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    流式解析中
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-1">
            {player && (
              <button
                type="button"
                onClick={handleReplaySentence}
                title={t.sentenceAnalysis.repeatSentence}
                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <RotateCcw size={14} />
              </button>
            )}

            <button
              type="button"
              onClick={handleCopy}
              title={copied ? '已复制' : '复制内容'}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
            </button>

            <button
              type="button"
              onClick={handleRetry}
              title="重新解析"
              disabled={isLoadingSentenceAnalysis || isStreamingAnalysis}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
            >
              <RefreshCw size={14} className={isLoadingSentenceAnalysis || isStreamingAnalysis ? 'animate-spin' : ''} />
            </button>

            <button
              type="button"
              onClick={closeSentenceAnalysis}
              title={t.sentenceAnalysis.close}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-red-500/20 transition-colors"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* ================================================================= */}
        {/* Card Body (Scrollable) */}
        {/* ================================================================= */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="p-4 space-y-4 overflow-y-auto custom-scrollbar flex-1"
        >
          {/* Target Sentence Banner */}
          <div className="bg-black/35 border border-white/10 rounded-xl p-3 space-y-1.5 shadow-inner">
            <div className="text-xs text-purple-400 font-semibold font-mono flex items-center justify-between">
              <span>原声台词</span>
              <span className="text-[11px] text-gray-400 font-normal">
                {formatTimestamp(selectedSentenceCue.start)} - {formatTimestamp(selectedSentenceCue.end)}
              </span>
            </div>
            <div className="text-white text-sm font-medium leading-snug tracking-wide">
              {selectedSentenceCue.textEn}
            </div>
            {selectedSentenceCue.textZh && (
              <div className="text-xs text-gray-400 leading-normal pt-0.5">
                {selectedSentenceCue.textZh}
              </div>
            )}
          </div>

          {/* Missing API Key Guidance State (Refuses fake data, gives honest direction) */}
          {isMissingKey && (
            <div className="p-5 text-center space-y-3.5 bg-gradient-to-b from-purple-950/30 to-indigo-950/20 border border-purple-500/30 rounded-2xl my-2">
              <div className="w-11 h-11 mx-auto rounded-xl bg-purple-900/50 border border-purple-400/30 flex items-center justify-center text-purple-300 shadow-inner">
                <Sparkles size={20} className="text-purple-300 animate-pulse" />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-bold text-white tracking-wide">尚未配置 AI 模型密钥</div>
                <p className="text-xs text-gray-300 leading-relaxed max-w-xs mx-auto">
                  AI 句子深度精讲采用真实大模型流式输出（拒绝套话假数据），请在设置面板中填入 API Key 即可实时开启。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSidePanelOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-purple-900/40 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                <Settings size={14} />
                <span>前往侧边栏配置 AI</span>
              </button>
            </div>
          )}

          {/* Real Error Diagnostic State (Displays genuine failure reason, never hides behind fake text) */}
          {!isMissingKey && sentenceAnalysisError && (
            <div className="p-4 text-center space-y-3 bg-red-950/25 border border-red-500/30 rounded-2xl my-2">
              <AlertCircle size={22} className="text-red-400 mx-auto" />
              <div className="space-y-1.5">
                <div className="text-sm font-semibold text-red-200">AI 精讲请求异常</div>
                <div className="text-[11px] text-gray-300 leading-relaxed font-mono p-2 bg-black/40 rounded-lg border border-white/5 break-all text-left">
                  {sentenceAnalysisError}
                </div>
              </div>
              <button
                type="button"
                onClick={handleRetry}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-medium transition-colors"
              >
                <RefreshCw size={13} />
                <span>重新解析</span>
              </button>
            </div>
          )}

          {/* Initial Loading Skeleton before first chunk arrives */}
          {isLoadingSentenceAnalysis && !streamingAnalysisText && !isMissingKey && !sentenceAnalysisError && (
            <div className="space-y-4 py-2">
              <div className="flex items-center space-x-2 text-xs text-purple-300 animate-pulse">
                <Loader2 size={14} className="animate-spin text-purple-400" />
                <span>正在连接 {modelBadge}，实时流式生成精讲中...</span>
              </div>
              <div className="space-y-2.5">
                <div className="h-16 bg-white/[0.04] rounded-xl animate-pulse" />
                <div className="h-20 bg-white/[0.04] rounded-xl animate-pulse" />
                <div className="h-16 bg-white/[0.04] rounded-xl animate-pulse" />
              </div>
            </div>
          )}

          {/* Real-Time Streaming Markdown Content */}
          {streamingAnalysisText && !isMissingKey && (
            <div className="space-y-3.5 text-xs">
              {parsedSections.map((sec, secIdx) => {
                const isLastSection = secIdx === parsedSections.length - 1;
                let cardStyle = 'bg-white/[0.03] border-white/10';
                if (sec.iconType === 'translation') cardStyle = 'bg-emerald-950/20 border-emerald-500/25';
                else if (sec.iconType === 'syntax') cardStyle = 'bg-blue-950/20 border-blue-500/25';
                else if (sec.iconType === 'idiom') cardStyle = 'bg-amber-950/20 border-amber-500/25';
                else if (sec.iconType === 'phonetic') cardStyle = 'bg-purple-950/20 border-purple-500/25';

                return (
                  <div
                    key={secIdx}
                    className={`border rounded-xl p-3 space-y-2 transition-all duration-200 ${cardStyle}`}
                  >
                    <div className="flex items-center space-x-1.5 font-semibold text-gray-200 text-xs tracking-wide border-b border-white/5 pb-1.5">
                      <SectionIcon iconType={sec.iconType} />
                      <span>{sec.title}</span>
                    </div>

                    <div className="space-y-1.5">
                      {sec.lines.map((line, lineIdx) => {
                        const isLastLine = isLastSection && lineIdx === sec.lines.length - 1;
                        const match = line.match(/^[-*]\s*\*\*(.+?)\*\*[：:]\s*(.*)$/);

                        if (match) {
                          const [, key, value] = match;
                          return (
                            <div key={lineIdx} className="space-y-0.5 py-0.5">
                              <div className="flex items-baseline gap-1 text-[11px] font-semibold text-purple-300">
                                <span>{key}</span>
                                <span className="text-gray-400">:</span>
                              </div>
                              <div className="text-gray-200 text-xs leading-relaxed pl-1">
                                {renderInlineMarkdown(value)}
                                {isLastLine && isStreamingAnalysis && (
                                  <span className="inline-block w-1.5 h-3.5 ml-1 bg-purple-400 animate-pulse align-middle" />
                                )}
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div key={lineIdx} className="text-gray-200 text-xs leading-relaxed py-0.5">
                            {renderInlineMarkdown(line)}
                            {isLastLine && isStreamingAnalysis && (
                              <span className="inline-block w-1.5 h-3.5 ml-1 bg-purple-400 animate-pulse align-middle" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Structured Analysis Fallback for tests or legacy callers */}
          {!streamingAnalysisText && !isLoadingSentenceAnalysis && !isMissingKey && !sentenceAnalysisError && sentenceAnalysis && (
            <div className="space-y-4 text-xs">
              {/* Dimension 1: 地道表达与语调 */}
              <div className="space-y-2">
                <div className="flex items-center space-x-1.5 text-gray-300 font-semibold">
                  <MessageSquareQuote size={14} className="text-emerald-400" />
                  <span>1. 地道表达与语调</span>
                </div>
                <div className="bg-emerald-950/25 border border-emerald-500/20 rounded-xl p-3 space-y-2">
                  <div className="text-sm font-medium text-emerald-200/90 leading-relaxed">
                    “{sentenceAnalysis.authenticTranslation}”
                  </div>
                  {sentenceAnalysis.contextTone && (
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <span className="text-[10px] text-gray-400">语境语调:</span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-amber-300 bg-amber-950/50 border border-amber-500/30 px-2 py-0.5 rounded-full font-medium">
                        <Volume2 size={10} />
                        {sentenceAnalysis.contextTone}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Dimension 2: 句法结构剖析 */}
              <div className="space-y-2">
                <div className="flex items-center space-x-1.5 text-gray-300 font-semibold">
                  <Layers size={14} className="text-blue-400" />
                  <span>2. 句法结构剖析</span>
                </div>
                <div className="space-y-2">
                  {sentenceAnalysis.syntacticBreakdown && sentenceAnalysis.syntacticBreakdown.length > 0 ? (
                    sentenceAnalysis.syntacticBreakdown.map((item, idx) => (
                      <div
                        key={idx}
                        className="bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 rounded-xl p-2.5 space-y-1 transition-colors"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <span className="font-mono font-semibold text-purple-200 text-xs">
                            {item.clause}
                          </span>
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-950/80 text-blue-300 border border-blue-500/30">
                            {item.role}
                          </span>
                        </div>
                        <div className="text-gray-300 text-[11px] leading-relaxed">
                          {item.explanation}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-gray-400 italic">暂无句法分块解析</div>
                  )}
                </div>
              </div>

              {/* Dimension 3: 核心习语与短语 */}
              <div className="space-y-2">
                <div className="flex items-center space-x-1.5 text-gray-300 font-semibold">
                  <BookOpen size={14} className="text-amber-400" />
                  <span>3. 核心习语与短语</span>
                </div>
                <div className="space-y-2">
                  {sentenceAnalysis.idiomsAndPhrases && sentenceAnalysis.idiomsAndPhrases.length > 0 ? (
                    sentenceAnalysis.idiomsAndPhrases.map((item, idx) => (
                      <div
                        key={idx}
                        className="bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 rounded-xl p-2.5 space-y-1 transition-colors"
                      >
                        <div className="flex items-center space-x-2">
                          <span className="font-mono font-bold text-amber-200 text-xs">
                            {item.phrase}
                          </span>
                          <span className="text-gray-200 text-[11px] font-medium">
                            {item.meaning}
                          </span>
                        </div>
                        {item.usageNote && (
                          <div className="text-[11px] text-gray-400 leading-normal">
                            {item.usageNote}
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="text-gray-400 italic">本句为基础直接陈述，未包含复杂固定短语</div>
                  )}
                </div>
              </div>

              {/* Dimension 4: 口语发音与听力秘诀 */}
              <div className="space-y-2">
                <div className="flex items-center space-x-1.5 text-gray-300 font-semibold">
                  <Mic size={14} className="text-purple-400" />
                  <span>4. 口语发音与听力秘诀</span>
                </div>
                <div className="space-y-2">
                  {sentenceAnalysis.pronunciationTips && sentenceAnalysis.pronunciationTips.length > 0 ? (
                    sentenceAnalysis.pronunciationTips.map((tip, idx) => (
                      <div
                        key={idx}
                        className="bg-purple-950/20 hover:bg-purple-950/30 border border-purple-500/20 rounded-xl p-2.5 space-y-1 transition-colors"
                      >
                        <div className="font-semibold text-purple-300 text-[11px] flex items-center space-x-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-purple-400 inline-block" />
                          <span>{tip.phenomenon}</span>
                        </div>
                        <div className="text-gray-300 text-[11px] leading-relaxed">
                          {tip.detail}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-gray-400 italic">按标准自然语速发音即可</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

