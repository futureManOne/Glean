import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  ChevronUp,
  ChevronDown,
  RotateCcw,
  GripHorizontal
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { VideoPlayerAdapter } from '@/core/player/BaseAdapter';
import { WordToken } from '@/types';
import { WordHoverTooltip } from './WordHoverTooltip';
import { getLocale } from '@/core/i18n';
import { isYouTubeAdPlaying } from '@/core/youtube/titleSanitizer';
import { isCjkText } from '@/core/subtitle/parser';
import { isEligibleForTranslation } from '@/core/ai/bilingualTranslator';
import { mixedGlossGenerator } from '@/core/ai/mixedGlossGenerator';


interface SubtitleOverlayProps {
  player: VideoPlayerAdapter;
  videoRect: { left: number; top: number; width: number; height: number; bottom: number } | null;
}

export const SubtitleOverlay: React.FC<SubtitleOverlayProps> = ({ player, videoRect }) => {
  const {
    cues,
    isAdPlaying,
    currentCueIndex,
    currentTime,
    settings,
    updateSettings,
    selectWord,
    selectedWord,
    prevCue,
    nextCue,
    repeatCurrentCue,
    autoPauseAfterSentence,
    setAutoPauseAfterSentence,
    isSidePanelOpen
  } = useAppStore();

  const isAd = Boolean(isAdPlaying || isYouTubeAdPlaying());
  const t = getLocale(settings.uiLanguage);

  // Hover Tooltip State for Instant Contextual Lookup
  const [hoveredTokenInfo, setHoveredTokenInfo] = useState<{
    token: WordToken;
    anchorRect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  } | null>(null);
  const hoverTimeoutRef = useRef<any>(null);

  useEffect(() => {
    setHoveredTokenInfo(null);
  }, [currentCueIndex, selectedWord]);

  // 1. Vertical Dragging State & Refs
  const [isDragging, setIsDragging] = useState(false);
  const dragStartYRef = useRef<number>(0);
  const initialBottomPercentRef = useRef<number>(8);

  const bottomPercent = settings.subtitleBottomPercent ?? 8;

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    dragStartYRef.current = e.clientY;
    initialBottomPercentRef.current = settings.subtitleBottomPercent ?? 8;
  };


  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const parentHeight = videoRect?.height || window.innerHeight;
      // Moving mouse UP reduces clientY, meaning bottom distance increases
      const deltaY = dragStartYRef.current - e.clientY;
      const deltaPercent = (deltaY / parentHeight) * 100;
      const clampedPercent = Math.max(0, Math.min(80, Math.round(initialBottomPercentRef.current + deltaPercent)));
      updateSettings({ subtitleBottomPercent: clampedPercent });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, videoRect, updateSettings]);


  const handleWordClick = (e: React.MouseEvent, token: WordToken) => {
    e.stopPropagation();
    if (!token.isWord) return;

    // 1. Immediately pause the video playback
    player.pause();
    useAppStore.setState({ isPlaying: false });

    // 2. Dismiss any active hover tooltip
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setHoveredTokenInfo(null);

    const currentCue = cues[currentCueIndex];
    if (!currentCue) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const popupWidth = 390;

    let targetX = rect.left + rect.width / 2 - popupWidth / 2;
    targetX = Math.max(16, Math.min(targetX, window.innerWidth - popupWidth - 16));

    // Place directly above word (distance = 8px); if too close to viewport top, place below
    const showAbove = rect.top >= 320;
    const targetY = showAbove ? rect.top - 8 : rect.bottom + 8;
    const placement: 'top' | 'bottom' = showAbove ? 'top' : 'bottom';
    const arrowOffset = rect.left + rect.width / 2 - targetX;

    const targetWord = (token.isKeyPhrase && token.phraseText)
      ? token.phraseText
      : (token.lemma || token.text);

    selectWord(
      targetWord,
      currentCue.textEn,
      currentCue.textZh,
      { x: targetX, y: targetY, placement, arrowOffset }
    );
  };

  const handleWordMouseEnter = (e: React.MouseEvent, token: WordToken) => {
    if (!token.isWord) return;
    if (selectedWord) return; // Full WordPopup is open, don't show hover tooltip

    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setHoveredTokenInfo({
      token,
      anchorRect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      }
    });
  };

  const handleWordMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredTokenInfo(null);
    }, 120);
  };

  const getTokenColorClass = (token: WordToken) => {
    if (!token.isWord) return '';

    // 1. High-priority Key Semantic Phrase Highlight (takes top priority to ensure unified multi-word phrase styling)
    if (token.isKeyPhrase) {
      return 'text-amber-300 font-semibold hover:text-amber-200 hover:bg-amber-400/20 rounded px-0.5';
    }

    // 2. User saved mastery levels
    if (token.level === 'learning') return 'text-[#d8b4fe] font-semibold underline decoration-[#c084fc]/70 bg-[#a855f7]/15 rounded px-0.5'; // LR Purple
    if (token.level === 'known') return 'text-[#86efac] font-medium bg-[#22c55e]/15 rounded px-0.5';      // Green
    if (token.level === 'mastered') return 'text-[#93c5fd] font-medium bg-[#3b82f6]/15 rounded px-0.5';   // Blue

    // 3. CEFR difficulty bands for unrecognized words (if vocabulary highlighting is on)
    if (settings.highlightVocabulary && token.cefr) {
      if (token.cefr === 'C2' || token.cefr === 'C1') {
        return 'text-[#fca5a5] hover:text-[#f87171] hover:bg-rose-500/20 rounded px-0.5 underline decoration-rose-400/50';
      }
      if (token.cefr === 'B2') {
        return 'text-[#fde047] hover:text-[#facc15] hover:bg-amber-500/20 rounded px-0.5';
      }
      if (token.cefr === 'B1') {
        return 'text-[#93c5fd] hover:text-[#60a5fa] hover:bg-blue-500/20 rounded px-0.5';
      }
    }

    return 'text-white hover:text-blue-300 hover:bg-blue-500/20 rounded px-0.5';
  };

  const panelWidth = isSidePanelOpen ? (settings.sidePanelWidth || 420) : 0;

  // Calculate visible horizontal bounds to the left of the side panel
  const visibleRight = videoRect
    ? Math.min(videoRect.left + videoRect.width, window.innerWidth - panelWidth)
    : (window.innerWidth - panelWidth);
  const visibleLeft = videoRect ? videoRect.left : 0;
  const visibleWidth = Math.max(280, visibleRight - visibleLeft);

  // Calculate vertical position strictly inside the video area
  let finalBottom = `${bottomPercent}%`;
  if (videoRect) {
    const viewportBottomToVideoBottom = Math.max(0, window.innerHeight - videoRect.bottom);
    const vHeight = Math.max(200, videoRect.height);
    const minBottomPx = 8; // Small safety cushion (8px) so font descenders/shadows aren't clipped by video bottom edge
    const insideVideoBottomPx = Math.max(minBottomPx, Math.round(vHeight * (bottomPercent / 100)));
    finalBottom = `${viewportBottomToVideoBottom + insideVideoBottomPx}px`;
  }

  // Position container based on video bounds and visible area
  const containerStyle: React.CSSProperties = {
    position: 'fixed',
    left: `${visibleLeft}px`,
    width: `${Math.max(420, Math.min(visibleWidth, window.innerWidth * 0.94))}px`,
    bottom: finalBottom,
    zIndex: 99999
  };

  // Left vertical control buttons styling (Prev/Repeat/Next like LR)
  const leftControlsStyle: React.CSSProperties = videoRect ? {
    position: 'fixed',
    left: `${Math.max(16, videoRect.left + 16)}px`,
    top: `${Math.max(60, videoRect.top + videoRect.height / 2 - 64)}px`,
    zIndex: 99999
  } : {
    position: 'fixed',
    left: '1.5rem',
    top: '45%',
    zIndex: 99999
  };

  const currentCue = (currentCueIndex >= 0 && currentCueIndex < cues.length) ? cues[currentCueIndex] : null;
  // Acoustic Playback Window Check: Only display subtitle capsule during speech (+ small grace window of 0.35s)
  // When in silence, paused outside speech, or seeked away, subtitle capsule cleanly disappears.
  const isWithinPlaybackWindow = Boolean(
    currentCue &&
    currentTime >= currentCue.start - 0.15 &&
    currentTime <= currentCue.end + 0.35
  );
  const isMixedMode = settings.subtitleMode === 'mixed';
  const displayCue = useMemo(() => {
    if (!currentCue || !isWithinPlaybackWindow) return null;
    if (isMixedMode) {
      return mixedGlossGenerator.populateGlossesSync(currentCue, settings.mixedModeFilterLevel);
    }
    return currentCue;
  }, [currentCue, isWithinPlaybackWindow, isMixedMode, settings.mixedModeFilterLevel]);

  // Sliding window AI contextual gloss prefetching when in mixed mode
  useEffect(() => {
    if (!isMixedMode || !currentCue || !cues || cues.length === 0) return;
    const nextCues = cues.slice(currentCueIndex, currentCueIndex + 5);
    mixedGlossGenerator.requestAiGlossesForCues(nextCues);
  }, [isMixedMode, currentCueIndex, cues]);

  const hasActiveCue = Boolean(
    displayCue &&
    (((settings.showEnglish || isMixedMode) && displayCue.textEn) || ((settings.subtitleMode === 'both' || settings.showChinese) && displayCue.textZh))
  );

  if (settings.subtitleMode === 'hidden') {
    return null;
  }

  return (
    <>
      {/* Dragging Fullscreen Transparent Catcher */}
      {isDragging && (
        <div className="fixed inset-0 z-[99999999] cursor-ns-resize select-none bg-white/5 pointer-events-auto" />
      )}

      {/* 1. Left Vertical Navigation Controls Stack (Language Reactor 1:1) */}
      {cues.length > 0 && !isAd && (
        <div
          style={leftControlsStyle}
          className="flex flex-col items-center space-y-2 select-none group/left transition-opacity duration-200"
        >
          {/* Prev Cue (∧ / A) */}
          <button
            type="button"
            onClick={() => prevCue(player)}
            title="跳转上一句 (快捷键 A)"
            className="w-10 h-10 rounded-full bg-black/60 hover:bg-black/90 backdrop-blur-md border border-white/15 flex items-center justify-center text-gray-200 hover:text-white shadow-xl hover:scale-110 active:scale-95 transition-all lr-btn-shadow"
          >
            <ChevronUp size={22} strokeWidth={2.5} />
          </button>

          {/* Repeat Current Cue (↻ / S) */}
          <button
            type="button"
            onClick={() => repeatCurrentCue(player)}
            title="重播当前句 (快捷键 S)"
            className="w-10 h-10 rounded-full bg-black/60 hover:bg-black/90 backdrop-blur-md border border-white/15 flex items-center justify-center text-gray-200 hover:text-white shadow-xl hover:scale-110 active:scale-95 transition-all lr-btn-shadow"
          >
            <RotateCcw size={18} strokeWidth={2.2} />
          </button>

          {/* Next Cue (∨ / D) */}
          <button
            type="button"
            onClick={() => nextCue(player)}
            title="跳转下一句 (快捷键 D)"
            className="w-10 h-10 rounded-full bg-black/60 hover:bg-black/90 backdrop-blur-md border border-white/15 flex items-center justify-center text-gray-200 hover:text-white shadow-xl hover:scale-110 active:scale-95 transition-all lr-btn-shadow"
          >
            <ChevronDown size={22} strokeWidth={2.5} />
          </button>
        </div>
      )}

      {/* 2. Main Subtitle Area Container */}
      <div style={containerStyle} className="flex flex-col items-center justify-center px-2 sm:px-4 pointer-events-none select-none">
          
          {/* 2.1 No subtitles loaded yet: clean video overlay, preserved in right sidebar */}
          {(!cues || cues.length === 0) ? null : hasActiveCue ? (
            /* 2.2 Active Subtitle Cue Box with Vertical Drag Handle */
              <div className="relative group/sub flex flex-col items-center max-w-full pointer-events-none">
              {/* Subtitle Card & AP Toggle Row (Language Reactor 1:1) */}
              <div className="relative flex items-center justify-center space-x-3 w-auto max-w-full pointer-events-none">
                {/* Main Subtitle Content Capsule (Optimized for sleek single-line display matching LR) */}
                {(() => {
                  const opacity = settings.subtitleOpacity ?? 0.85;
                  const isTransparent = opacity === 0;
                  const capsuleStyle: React.CSSProperties = {
                    backgroundColor: isTransparent ? 'transparent' : `rgba(18, 18, 22, ${opacity})`,
                    borderColor: isTransparent ? 'transparent' : `rgba(255, 255, 255, ${Math.min(0.15, opacity * 0.15)})`,
                    backdropFilter: isTransparent ? 'none' : `blur(${Math.round(opacity * 8)}px)`,
                    WebkitBackdropFilter: isTransparent ? 'none' : `blur(${Math.round(opacity * 8)}px)`,
                    boxShadow: isTransparent ? 'none' : `0 4px 20px rgba(0, 0, 0, ${opacity * 0.4})`,
                    width: 'fit-content',
                    minWidth: 'min(calc(100% - 24px), 320px)',
                    maxWidth: 'min(92vw, 1100px)'
                  };
                  const activeCue = displayCue || currentCue;
                  const hasKeyPhrases = Boolean(
                    activeCue?.tokens?.some(t => t.isKeyPhrase) ||
                    (activeCue?.mixedPhrases && activeCue.mixedPhrases.length > 0)
                  );
                  const hasAnyInlineGlosses = Boolean(
                    activeCue?.tokens?.some(t =>
                      (t.phraseMeaning && t.isPhraseEnd) ||
                      (!hasKeyPhrases && !t.phraseId && t.contextMeaning)
                    )
                  );

                  return (
                    <div
                      className="relative pointer-events-auto text-center lr-pill-bg px-6 sm:px-8 py-2.5 sm:py-3 rounded-2xl shadow-2xl transition-all duration-150"
                      style={capsuleStyle}
                    >
                  {/* 1. English Sentence Line (Concise single line matching LR 1:1, or Mixed Mode) */}
                  {(settings.showEnglish || isMixedMode) && activeCue && activeCue.textEn && (
                    <div
                      className={`font-bold tracking-wide text-center leading-normal lr-text-shadow text-white whitespace-normal break-words ${
                        settings.maskEnglish
                          ? 'filter blur-[5px] hover:blur-none transition-all duration-200 cursor-pointer select-none hover:select-text'
                          : ''
                      }`}
                      style={{ fontSize: `${settings.subtitleFontSize}px` }}
                      title={settings.maskEnglish ? '听力遮罩已开启，鼠标悬停显示英文' : undefined}
                    >
                      {activeCue.tokens && activeCue.tokens.length > 0 ? (
                        activeCue.tokens.map((token) => {
                          const isCjk = isCjkText(token.text);
                          const tokenSpacing = isCjk
                            ? (token.isKeyPhrase ? (token.isPhraseStart ? 'ml-0.5' : '') : 'mx-0 px-0')
                            : 'inline-block mx-0.5 px-0.5';

                          return token.isWord ? (
                            <span
                              key={token.id}
                              onClick={(e) => handleWordClick(e, token)}
                              onMouseEnter={(e) => handleWordMouseEnter(e, token)}
                              onMouseLeave={handleWordMouseLeave}
                              className={`token-word ${token.isKeyPhrase ? 'inline-block' : (isCjk ? 'inline' : 'inline-block')} ${tokenSpacing} rounded transition-transform cursor-pointer hover:scale-105 active:scale-95 group/token ${getTokenColorClass(token)}`}
                            >
                              <span>{token.text}</span>
                              {isMixedMode && (token.phraseMeaning && token.isPhraseEnd ? (
                                <span className="ml-1 mr-0.5 text-[0.82em] font-medium text-emerald-300/90 group-hover/token:text-emerald-200 select-none">
                                  ({token.phraseMeaning})
                                </span>
                              ) : (!hasKeyPhrases && !token.phraseId && token.contextMeaning ? (
                                <span className="ml-1 mr-0.5 text-[0.82em] font-medium text-emerald-300/90 group-hover/token:text-emerald-200 select-none">
                                  ({token.contextMeaning})
                                </span>
                              ) : null))}
                            </span>
                          ) : (
                            <span key={token.id} className="select-text inline">
                              {token.text}
                            </span>
                          );
                        })
                      ) : (
                        <span className="inline">{activeCue.textEn}</span>
                      )}
                    </div>
                  )}

                  {/* 2. Translation Line (Concise single line, strictly controlled by settings in mixed mode) */}
                  {((!isMixedMode && (settings.subtitleMode === 'both' || settings.showChinese)) ||
                    (isMixedMode && Boolean(settings.showTranslationInMixedMode))) && (
                    activeCue?.textZh && activeCue.textZh.trim() !== (activeCue.textEn || '').trim() ? (
                      <div
                        className={`text-white mt-1 font-semibold tracking-wide lr-text-shadow leading-normal text-center whitespace-normal break-words ${
                          settings.maskChinese
                            ? 'filter blur-[5px] hover:blur-none transition-all duration-200 cursor-pointer select-none hover:select-text'
                            : ''
                        }`}
                        style={{ fontSize: `${Math.max(14, Math.round(settings.subtitleFontSize * 0.86))}px`, textShadow: '0 0 7px rgba(0,0,0,.98), 0 0 16px rgba(0,0,0,.8)' }}
                        title={settings.maskChinese ? '听力盲听遮罩已开启，鼠标悬停显示中文释义' : undefined}
                      >
                        {activeCue.textZh}
                      </div>
                    ) : null
                  )}
                    </div>
                  );
                })()}

                {!isAd && (
                  <button
                    type="button"
                    onMouseDown={handleDragStart}
                    onDoubleClick={() => updateSettings({ subtitleBottomPercent: 8 })}
                    title={t.subtitleOverlay.dragTip || '拖拽调节垂直高度 (双击复位)'}
                    aria-label="拖动字幕位置"
                    className="group/inline-drag pointer-events-auto relative shrink-0 rounded-full border border-white/20 bg-black/55 p-2 text-gray-300 opacity-40 shadow-lg backdrop-blur transition-opacity hover:border-cyan-300/70 hover:text-cyan-200 group-hover/sub:opacity-80 hover:!opacity-100 cursor-row-resize"
                  >
                    <GripHorizontal size={16} />
                  </button>
                )}

                {/* Right-Side AP (Auto-Pause) Switch (Language Reactor 1:1, hidden during ads) */}
                {!isAd && (
                  <div className="flex flex-col items-center select-none flex-shrink-0 pointer-events-auto">
                    <button
                      type="button"
                      onClick={() => setAutoPauseAfterSentence(!autoPauseAfterSentence)}
                      title={autoPauseAfterSentence ? 'AP: 单句跟读暂停已开启 (点击关闭)' : 'AP: 开启单句跟读自动暂停 (点击开启)'}
                      className="flex flex-col items-center space-y-1 group/ap p-1 rounded-xl hover:bg-black/40 backdrop-blur-sm transition-all"
                    >
                      <div className={`w-10 h-5 rounded-full transition-all relative flex items-center px-0.5 border ${
                        autoPauseAfterSentence
                          ? 'bg-emerald-500 border-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.7)]'
                          : 'bg-[#1e1e24] border-white/20 hover:border-white/40'
                      }`}>
                        <div className={`w-4 h-4 rounded-full bg-white transition-transform shadow-md ${
                          autoPauseAfterSentence ? 'translate-x-5' : 'translate-x-0'
                        }`} />
                      </div>
                      <span className={`text-[11px] font-bold font-mono tracking-wider transition-colors ${
                        autoPauseAfterSentence ? 'text-emerald-400 drop-shadow-[0_0_6px_rgba(16,185,129,0.6)]' : 'text-gray-400 group-hover/ap:text-gray-200'
                      }`}>
                        AP
                      </span>
                    </button>
                  </div>
                )}
              </div>

            </div>
          ) : null}
        </div>

      {/* 3. Hover Tooltip for Instant Contextual Meaning */}
      {hoveredTokenInfo && !selectedWord && cues[currentCueIndex] && (
        <WordHoverTooltip
          token={hoveredTokenInfo.token}
          sentenceEn={cues[currentCueIndex].textEn}
          sentenceZh={cues[currentCueIndex].textZh}
          anchorRect={hoveredTokenInfo.anchorRect}
          onClick={() => {
            const dummyEvent = {
              stopPropagation: () => {},
              currentTarget: {
                getBoundingClientRect: () => hoveredTokenInfo.anchorRect
              }
            } as any;
            handleWordClick(dummyEvent, hoveredTokenInfo.token);
          }}
        />
      )}
    </>
  );
};
