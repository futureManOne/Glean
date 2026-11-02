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
import { isCjkText, isChineseText } from '@/core/subtitle/parser';
import { isEligibleForTranslation, detectSourceLanguage, resolveTargetLanguage } from '@/core/ai/bilingualTranslator';
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
      return 'text-amber-200 font-semibold bg-amber-500/20 hover:text-amber-100 hover:bg-amber-400/30 rounded px-1 py-0.5 border-b border-amber-400/40';
    }

    // 2. User saved mastery levels (refined pastel tones with strong contrast)
    if (token.level === 'learning') return 'text-purple-200 font-medium underline decoration-purple-400/70 underline-offset-4 decoration-2 bg-purple-500/15 hover:bg-purple-500/25 rounded px-1 py-0.5';
    if (token.level === 'known') return 'text-emerald-200 font-medium bg-emerald-500/15 hover:bg-emerald-500/25 rounded px-1 py-0.5';
    if (token.level === 'mastered') return 'text-sky-200 font-medium bg-sky-500/15 hover:bg-sky-500/25 rounded px-1 py-0.5';

    // 3. CEFR difficulty bands for unrecognized words (if vocabulary highlighting is on)
    if (settings.highlightVocabulary && token.cefr) {
      if (token.cefr === 'C2' || token.cefr === 'C1') {
        return 'text-rose-200 font-medium underline decoration-rose-400/50 underline-offset-4 bg-rose-500/15 hover:text-rose-100 hover:bg-rose-500/25 rounded px-1 py-0.5';
      }
      if (token.cefr === 'B2') {
        return 'text-amber-200 font-medium bg-amber-500/15 hover:text-amber-100 hover:bg-amber-500/25 rounded px-1 py-0.5';
      }
      if (token.cefr === 'B1') {
        return 'text-cyan-200 font-medium bg-cyan-500/15 hover:text-cyan-100 hover:bg-cyan-500/25 rounded px-1 py-0.5';
      }
    }

    return 'text-white hover:text-cyan-200 hover:bg-white/10 rounded px-0.5';
  };
  const sourceLang = detectSourceLanguage(cues);
  const { code: targetCode } = resolveTargetLanguage(sourceLang, settings.secondaryLang);
  const panelWidth = isSidePanelOpen ? (settings.sidePanelWidth || 420) : 0;
  const videoLeft = videoRect ? videoRect.left : 0;
  const videoWidth = videoRect ? videoRect.width : (typeof window !== 'undefined' ? window.innerWidth : 1280);
  const trueVideoCenterX = videoLeft + videoWidth / 2;

  const visibleLeft = videoLeft;
  const visibleRight = isSidePanelOpen
    ? Math.min(videoLeft + videoWidth, (typeof window !== 'undefined' ? window.innerWidth : 1280) - panelWidth)
    : (videoLeft + videoWidth);
  const visibleWidth = Math.max(280, visibleRight - visibleLeft);
  const visibleCenterX = visibleLeft + visibleWidth / 2;

  // Calculate vertical position strictly inside the video area
  let finalBottom = `${bottomPercent}%`;
  if (videoRect) {
    const viewportBottomToVideoBottom = Math.max(0, window.innerHeight - videoRect.bottom);
    const vHeight = Math.max(200, videoRect.height);
    const minBottomPx = 8; // Small safety cushion (8px) so font descenders/shadows aren't clipped by video bottom edge
    const insideVideoBottomPx = Math.max(minBottomPx, Math.round(vHeight * (bottomPercent / 100)));
    finalBottom = `${viewportBottomToVideoBottom + insideVideoBottomPx}px`;
  }

  // Horizontal boundaries reserving ~96px on the right for drag handle & AP toggle
  const rightControlsReserved = isAd ? 16 : 96;
  const rightBoundary = visibleRight - rightControlsReserved;
  const leftBoundary = visibleLeft + 16;
  const clearanceToRight = rightBoundary - trueVideoCenterX;

  // If we have comfortable clearance (>= 160px) to the right of true video center,
  // strictly anchor targetCenterX to trueVideoCenterX (0px deviation from video center).
  // In extremely tight viewports, safely clamp towards visible area center without clipping.
  let targetCenterX: number;
  if (clearanceToRight >= 160) {
    targetCenterX = trueVideoCenterX;
  } else {
    targetCenterX = Math.max(visibleCenterX - rightControlsReserved / 2, Math.min(trueVideoCenterX, rightBoundary - 140));
  }

  const maxHalfWidth = Math.max(120, Math.min(
    targetCenterX - leftBoundary,
    rightBoundary - targetCenterX
  ));
  const containerWidth = Math.min(1100, Math.max(240, Math.round(maxHalfWidth * 2)));
  const containerLeft = Math.round(targetCenterX - containerWidth / 2);

  // Position container strictly symmetrical around targetCenterX
  const containerStyle: React.CSSProperties = {
    position: 'fixed',
    left: `${containerLeft}px`,
    width: `${containerWidth}px`,
    bottom: finalBottom,
    zIndex: 99999
  };

  // Right controls anchored to the visible video right edge (never occluded by side panel)
  const windowWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const controlsRightPx = Math.max(16, windowWidth - visibleRight + 16);
  const rightControlsStyle: React.CSSProperties = {
    position: 'fixed',
    right: `${controlsRightPx}px`,
    bottom: finalBottom,
    zIndex: 100000
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
          translate="no"
          className="flex flex-col items-center space-y-2.5 select-none notranslate group/left transition-opacity duration-200"
        >
          {/* Prev Cue (∧ / A) */}
          <div className="relative group/nav-btn flex items-center">
            <button
              type="button"
              onClick={() => prevCue(player)}
              title={settings.uiLanguage === 'zh-CN' ? '跳转上一句 (快捷键 A)' : settings.uiLanguage === 'ja' ? '前の字幕へ (ショートカット A)' : 'Previous Cue (Hotkey A)'}
              aria-label="Previous Cue"
              className="w-10 h-10 rounded-full bg-black/65 hover:bg-[#161b22] backdrop-blur-md border border-white/15 hover:border-cyan-400/50 flex items-center justify-center text-gray-200 hover:text-cyan-200 shadow-xl hover:scale-105 active:scale-95 transition-all duration-150 lr-btn-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
            >
              <ChevronUp size={20} strokeWidth={2.2} />
            </button>
            <div className="absolute left-full ml-2.5 px-2.5 py-1 rounded-md bg-[#0e1117]/95 border border-white/15 text-xs text-gray-200 whitespace-nowrap opacity-0 group-hover/nav-btn:opacity-100 pointer-events-none transition-all duration-150 transform translate-x-1 group-hover/nav-btn:translate-x-0 shadow-2xl backdrop-blur-md z-50 flex items-center gap-1.5">
              <span>{settings.uiLanguage === 'zh-CN' ? '上一句' : settings.uiLanguage === 'ja' ? '前へ' : 'Prev'}</span>
              <kbd className="px-1.5 py-0.5 rounded bg-white/10 border border-white/15 text-[10px] font-mono font-semibold text-cyan-300">A</kbd>
            </div>
          </div>

          {/* Repeat Current Cue (↻ / S) */}
          <div className="relative group/nav-btn flex items-center">
            <button
              type="button"
              onClick={() => repeatCurrentCue(player)}
              title={settings.uiLanguage === 'zh-CN' ? '重播当前句 (快捷键 S)' : settings.uiLanguage === 'ja' ? '現在の字幕をリピート (ショートカット S)' : 'Repeat Current Cue (Hotkey S)'}
              aria-label="Repeat Current Cue"
              className="w-10 h-10 rounded-full bg-black/65 hover:bg-[#161b22] backdrop-blur-md border border-white/15 hover:border-cyan-400/50 flex items-center justify-center text-gray-200 hover:text-cyan-200 shadow-xl hover:scale-105 active:scale-95 transition-all duration-150 lr-btn-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
            >
              <RotateCcw size={17} strokeWidth={2.2} />
            </button>
            <div className="absolute left-full ml-2.5 px-2.5 py-1 rounded-md bg-[#0e1117]/95 border border-white/15 text-xs text-gray-200 whitespace-nowrap opacity-0 group-hover/nav-btn:opacity-100 pointer-events-none transition-all duration-150 transform translate-x-1 group-hover/nav-btn:translate-x-0 shadow-2xl backdrop-blur-md z-50 flex items-center gap-1.5">
              <span>{settings.uiLanguage === 'zh-CN' ? '重播当前句' : settings.uiLanguage === 'ja' ? 'リピート' : 'Repeat'}</span>
              <kbd className="px-1.5 py-0.5 rounded bg-white/10 border border-white/15 text-[10px] font-mono font-semibold text-cyan-300">S</kbd>
            </div>
          </div>

          {/* Next Cue (∨ / D) */}
          <div className="relative group/nav-btn flex items-center">
            <button
              type="button"
              onClick={() => nextCue(player)}
              title={settings.uiLanguage === 'zh-CN' ? '跳转下一句 (快捷键 D)' : settings.uiLanguage === 'ja' ? '次の字幕へ (ショートカット D)' : 'Next Cue (Hotkey D)'}
              aria-label="Next Cue"
              className="w-10 h-10 rounded-full bg-black/65 hover:bg-[#161b22] backdrop-blur-md border border-white/15 hover:border-cyan-400/50 flex items-center justify-center text-gray-200 hover:text-cyan-200 shadow-xl hover:scale-105 active:scale-95 transition-all duration-150 lr-btn-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
            >
              <ChevronDown size={20} strokeWidth={2.2} />
            </button>
            <div className="absolute left-full ml-2.5 px-2.5 py-1 rounded-md bg-[#0e1117]/95 border border-white/15 text-xs text-gray-200 whitespace-nowrap opacity-0 group-hover/nav-btn:opacity-100 pointer-events-none transition-all duration-150 transform translate-x-1 group-hover/nav-btn:translate-x-0 shadow-2xl backdrop-blur-md z-50 flex items-center gap-1.5">
              <span>{settings.uiLanguage === 'zh-CN' ? '下一句' : settings.uiLanguage === 'ja' ? '次へ' : 'Next'}</span>
              <kbd className="px-1.5 py-0.5 rounded bg-white/10 border border-white/15 text-[10px] font-mono font-semibold text-cyan-300">D</kbd>
            </div>
          </div>
        </div>
      )}

      {/* 2. Main Subtitle Area Container */}
      {/* 2. Main Subtitle Area Container (Strictly centered on video) */}
      {cues && cues.length > 0 && (
        <div style={containerStyle} translate="no" className="flex flex-col items-center justify-center pointer-events-none select-none notranslate min-h-[48px]">
          {/* 2.1 Centered Subtitle Cue Box: Strictly horizontally centered */}
          {hasActiveCue && (
            <div className="relative group/sub flex flex-col items-center w-full max-w-full px-2 sm:px-4 pointer-events-none">
              <div className="relative flex items-center justify-center w-full max-w-full pointer-events-none">
                {/* Main Subtitle Content Capsule (Optimized for sleek single-line display matching LR) */}
                {(() => {
                  const opacity = settings.subtitleOpacity ?? 0;
                  const isTransparent = opacity === 0;
                  const capsuleStyle: React.CSSProperties = {
                    backgroundColor: isTransparent ? 'transparent' : `rgba(0, 0, 0, ${opacity})`,
                    borderColor: isTransparent ? 'transparent' : `rgba(255, 255, 255, ${Math.min(0.2, Math.max(0.1, opacity * 0.18))})`,
                    backdropFilter: isTransparent ? 'none' : `blur(${Math.max(8, Math.round(opacity * 16))}px)`,
                    WebkitBackdropFilter: isTransparent ? 'none' : `blur(${Math.max(8, Math.round(opacity * 16))}px)`,
                    boxShadow: isTransparent ? 'none' : `0 8px 32px rgba(0, 0, 0, ${opacity * 0.5})`,
                    width: 'fit-content',
                    minWidth: `${Math.min(260, Math.max(140, containerWidth - 32))}px`,
                    maxWidth: `${Math.min(1100, Math.max(200, containerWidth - 16))}px`
                  };
                  const activeCue = displayCue || currentCue;
                  const hasKeyPhrases = Boolean(
                    activeCue?.tokens?.some(t => t.isKeyPhrase)
                  );

                  return (
                    <div
                      className={`relative pointer-events-auto text-center lr-pill-bg px-6 sm:px-8 py-2.5 sm:py-3.5 rounded-2xl transition-all duration-200 ease-out ${
                        isTransparent
                          ? '!bg-transparent !border-transparent !backdrop-blur-none !shadow-none'
                          : 'backdrop-blur-md bg-black/65 border border-white/15 shadow-2xl'
                      }`}
                      style={capsuleStyle}
                    >
                      {/* 1. English Sentence Line (Concise single line matching LR 1:1, or Mixed Mode) */}
                      {(settings.showEnglish || isMixedMode) && activeCue && activeCue.textEn && (
                        <div
                          className={`font-semibold tracking-wide text-center leading-relaxed lr-text-shadow text-white whitespace-normal break-words selection:bg-cyan-500/30 ${
                            settings.maskEnglish
                              ? 'filter blur-[5px] hover:blur-none transition-all duration-200 cursor-pointer select-none hover:select-text'
                              : ''
                          }`}
                          style={{ fontSize: `${settings.subtitleFontSize}px` }}
                          title={settings.maskEnglish ? (settings.uiLanguage === 'zh-CN' ? '听力遮罩已开启，鼠标悬停显示英文' : 'Listening mask active, hover to show text') : undefined}
                        >
                          {activeCue.tokens && activeCue.tokens.length > 0 ? (
                            activeCue.tokens.map((token) => {
                              const isCjk = isCjkText(token.text);
                              const tokenSpacing = isCjk
                                ? (token.isKeyPhrase ? (token.isPhraseStart ? 'ml-0.5' : '') : 'mx-0 px-0')
                                : 'inline-block mx-0.5';

                              return token.isWord ? (
                                <span
                                  key={token.id}
                                  onClick={(e) => handleWordClick(e, token)}
                                  onMouseEnter={(e) => handleWordMouseEnter(e, token)}
                                  onMouseLeave={handleWordMouseLeave}
                                  className={`token-word ${token.isKeyPhrase ? 'inline-block' : (isCjk ? 'inline' : 'inline-block')} ${tokenSpacing} rounded transition-all duration-150 cursor-pointer hover:scale-105 active:scale-95 group/token ${getTokenColorClass(token)}`}
                                >
                                  <span>{token.text}</span>
                                  {isMixedMode && (token.phraseMeaning && token.isPhraseEnd ? (
                                    <span className="ml-1 mr-0.5 text-[0.82em] font-medium text-emerald-300 group-hover/token:text-emerald-200 select-none">
                                      ({token.phraseMeaning})
                                    </span>
                                  ) : (!hasKeyPhrases && !token.phraseId && token.contextMeaning ? (
                                    <span className="ml-1 mr-0.5 text-[0.82em] font-medium text-emerald-300 group-hover/token:text-emerald-200 select-none">
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
                        activeCue?.textZh &&
                        activeCue.textZh.trim() !== (activeCue.textEn || '').trim() &&
                        (!targetCode || targetCode.startsWith('zh') || !isChineseText(activeCue.textZh)) ? (
                          <div
                            className={`text-gray-200/95 mt-1.5 font-medium tracking-wide lr-text-shadow leading-relaxed text-center whitespace-normal break-words selection:bg-cyan-500/30 ${
                              settings.maskChinese
                                ? 'filter blur-[5px] hover:blur-none transition-all duration-200 cursor-pointer select-none hover:select-text'
                                : ''
                            }`}
                            style={{ fontSize: `${Math.max(14, Math.round(settings.subtitleFontSize * 0.86))}px` }}
                            title={settings.maskChinese ? (settings.uiLanguage === 'zh-CN' ? '听力盲听遮罩已开启，鼠标悬停显示中文释义' : 'Listening mask active, hover to show translation') : undefined}
                          >
                            {activeCue.textZh}
                          </div>
                        ) : null
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2.2 Right-Side Controls (Drag Handle + AP Switch): Anchored to the visible right edge of the video area */}
      {cues && cues.length > 0 && !isAd && (
        <div
          style={rightControlsStyle}
          className="flex items-center space-x-2.5 shrink-0 pointer-events-auto select-none"
        >
          {/* Vertical Drag Handle */}
          <div className="relative group/drag shrink-0 flex items-center">
            <button
              type="button"
              onMouseDown={handleDragStart}
              onDoubleClick={() => updateSettings({ subtitleBottomPercent: 8 })}
              title={t.subtitleOverlay.dragTip || '拖拽调节垂直高度 (双击复位)'}
              aria-label="拖动字幕位置"
              className={`relative shrink-0 rounded-xl border border-white/15 bg-black/65 hover:bg-[#161b22] px-2 py-2 text-gray-300 shadow-xl backdrop-blur-md transition-all duration-200 hover:border-cyan-400/50 hover:text-cyan-200 cursor-row-resize active:cursor-grabbing lr-btn-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 ${
                isDragging ? 'opacity-100 border-cyan-400 text-cyan-200 shadow-[0_0_15px_rgba(6,182,212,0.35)] scale-105' : 'opacity-70 hover:opacity-100'
              }`}
            >
              <GripHorizontal size={18} className="transition-transform group-hover/drag:scale-110" />
            </button>
            {/* Double-click reset tooltip */}
            <div className="absolute right-0 bottom-full mb-2.5 px-3 py-1.5 rounded-lg bg-[#0e1117]/95 border border-white/15 text-xs text-gray-200 whitespace-nowrap opacity-0 group-hover/drag:opacity-100 pointer-events-none transition-all duration-150 transform translate-y-1 group-hover/drag:translate-y-0 shadow-2xl backdrop-blur-md z-50 flex flex-col gap-0.5 text-left">
              <span className="font-semibold text-white flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 inline-block animate-pulse" />
                {t.subtitleOverlay.dragTip || '拖拽调节垂直高度'}
              </span>
              <span className="text-[10px] text-gray-400">
                {settings.uiLanguage === 'zh-CN' ? '双击复位到默认位置 (8%)' : settings.uiLanguage === 'ja' ? 'ダブルクリックで初期位置に戻す (8%)' : 'Double-click to reset (8%)'}
              </span>
            </div>
          </div>

          {/* Right-Side AP (Auto-Pause) Switch */}
          <div className="relative group/ap flex flex-col items-center select-none shrink-0 pointer-events-auto">
            <button
              type="button"
              onClick={() => setAutoPauseAfterSentence(!autoPauseAfterSentence)}
              title={autoPauseAfterSentence ? 'AP: 单句跟读暂停已开启 (点击关闭)' : 'AP: 开启单句跟读自动暂停 (点击开启)'}
              aria-label="Auto Pause"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border backdrop-blur-md transition-all duration-200 lr-btn-shadow active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 ${
                autoPauseAfterSentence
                  ? 'bg-emerald-950/40 border-emerald-500/40 hover:border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.25)]'
                  : 'bg-black/65 border-white/15 hover:border-white/30 text-gray-400 hover:text-gray-200 opacity-75 hover:opacity-100'
              }`}
            >
              {/* Sleek Pill Track */}
              <div className={`w-8 h-4 rounded-full transition-all duration-200 relative flex items-center px-0.5 border ${
                autoPauseAfterSentence
                  ? 'bg-emerald-500 border-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.7)]'
                  : 'bg-[#1b212c] border-white/20 group-hover/ap:border-white/30'
              }`}>
                <div className={`w-3 h-3 rounded-full bg-white transition-transform duration-200 ease-out shadow-sm ${
                  autoPauseAfterSentence ? 'translate-x-4 shadow-[0_0_6px_rgba(255,255,255,0.9)]' : 'translate-x-0'
                }`} />
              </div>
              {/* Indicator & Label */}
              <div className="flex items-center gap-1">
                <span className={`text-[11px] font-bold font-mono tracking-wider transition-colors duration-200 ${
                  autoPauseAfterSentence
                    ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.8)]'
                    : 'text-gray-400 group-hover/ap:text-gray-200'
                }`}>
                  AP
                </span>
                {autoPauseAfterSentence && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981] animate-pulse" />
                )}
              </div>
            </button>

            {/* Glowing Emerald Tooltip */}
            <div className="absolute right-0 bottom-full mb-2.5 px-3 py-1.5 rounded-lg bg-[#0e1117]/95 border border-white/15 text-xs text-gray-200 whitespace-nowrap opacity-0 group-hover/ap:opacity-100 pointer-events-none transition-all duration-150 transform translate-y-1 group-hover/ap:translate-y-0 shadow-2xl backdrop-blur-md z-50 flex flex-col gap-0.5 text-left">
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${autoPauseAfterSentence ? 'bg-emerald-400 shadow-[0_0_6px_#10b981]' : 'bg-gray-500'}`} />
                <span className="font-semibold text-white">
                  {autoPauseAfterSentence
                    ? (settings.uiLanguage === 'zh-CN' ? '单句跟读暂停：已开启' : settings.uiLanguage === 'ja' ? '自動一時停止：有効' : 'Auto-Pause: Active')
                    : (settings.uiLanguage === 'zh-CN' ? '单句跟读暂停：已关闭' : settings.uiLanguage === 'ja' ? '自動一時停止：無効' : 'Auto-Pause: Inactive')}
                </span>
              </div>
              <span className="text-[10px] text-gray-400">
                {settings.uiLanguage === 'zh-CN' ? '单句播放完成后自动暂停，方便跟读跟练' : settings.uiLanguage === 'ja' ? '各文の再生終了後に自動で一時停止します' : 'Auto-pause after each cue for shadow-reading'}
              </span>
            </div>
          </div>
        </div>
      )}

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
