import React, { useEffect, useState } from 'react';
import { UploadCloud, FileText } from 'lucide-react';
import { VideoPlayerAdapter } from '@/core/player/BaseAdapter';
import { useAppStore } from '@/store/useAppStore';
import { SubtitleOverlay } from './SubtitleOverlay';
import { WordPopup } from './WordPopup';
import { SentenceAnalysisCard } from './SentenceAnalysisCard';
import { TranscriptPanel } from './TranscriptPanel';
import { QuarkControlBar } from './QuarkControlBar';
import { QuarkSubtitleSniffer } from '@/core/quark/quarkSubtitleSniffer';
import { YouTubeSubtitleSniffer } from '@/core/youtube/youtubeSubtitleSniffer';
import { BilibiliSubtitleSniffer } from '@/core/bilibili/bilibiliSubtitleSniffer';
import { detectPageVideoTitle } from '@/core/youtube/titleSanitizer';
import { bilingualTranslator } from '@/core/ai/bilingualTranslator';
import { AutoPauseEngine } from '@/core/player/autoPauseEngine';
import { ErrorBoundary } from './ErrorBoundary';
import { ExportModal } from './ExportModal';

interface AppOverlayProps {
  player: VideoPlayerAdapter;
}

export const AppOverlay: React.FC<AppOverlayProps> = ({ player }) => {
  const {
    updateCurrentTime,
    prevCue,
    nextCue,
    repeatCurrentCue,
    togglePlay,
    updateSettings,
    settings,
    setSidePanelOpen,
    isSidePanelOpen,
    loadSubtitleFileContent,
    setVideoTitle,
    videoTitle,
    toggleSubtitleVisibility,
    cycleSubtitleMode,
    setRepeatMode,
    repeatMode,
    cues
  } = useAppStore();

  const [videoRect, setVideoRect] = useState<{ left: number; top: number; width: number; height: number; bottom: number } | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  // Automatically start appropriate Subtitle Sniffer per website
  useEffect(() => {
    if (!settings.pluginEnabled) return;
    let cleanup: (() => void) | null = null;
    if (window.location.hostname.includes('quark.cn')) {
      const sniffer = new QuarkSubtitleSniffer(player);
      sniffer.startSniffing();
      cleanup = () => sniffer.stopSniffing();
    } else if (window.location.hostname.includes('youtube.com')) {
      const sniffer = new YouTubeSubtitleSniffer(player);
      sniffer.startSniffing();
      cleanup = () => sniffer.stopSniffing();
    } else if (window.location.hostname.includes('bilibili.com')) {
      const sniffer = new BilibiliSubtitleSniffer(player);
      sniffer.startSniffing();
      cleanup = () => sniffer.stopSniffing();
    }
    return () => {
      if (cleanup) cleanup();
    };
  }, [player, settings.pluginEnabled]);

  // Dynamic Host Page Layout Coordination (Separating Video and Sidebar without overlap)
  useEffect(() => {
    const styleId = 'lr-host-layout-style';
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }

    const panelOpen = settings.pluginEnabled && isSidePanelOpen;
    const panelWidth = panelOpen ? (settings.sidePanelWidth || 420) : 0;

    styleEl.textContent = `
      /* 1. Normal mode in Quark Pan */
      #videoBody.VideoDetail--content-body--1KZ6K00,
      #videoBody {
        ${panelOpen ? `padding-right: ${panelWidth}px !important;` : ''}
        transition: padding-right 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
      }

      /* 2. Native Fullscreen mode (#videoContainer.full-screen) */
      #videoContainer.full-screen .video-js {
        ${panelOpen ? `width: calc(100% - ${panelWidth}px) !important; margin-right: ${panelWidth}px !important;` : 'width: 100% !important; margin-right: 0 !important;'}
        transition: width 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
      }

      /* 3. Web Fullscreen mode (body.lr-web-fullscreen) */
      body.lr-web-fullscreen {
        overflow: hidden !important;
      }
      body.lr-web-fullscreen #videoContainer,
      body.lr-web-fullscreen .video-container {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        bottom: 0 !important;
        width: ${panelOpen ? `calc(100vw - ${panelWidth}px)` : '100vw'} !important;
        height: 100vh !important;
        z-index: 99998 !important;
        padding: 0 !important;
        margin: 0 !important;
        background: #000 !important;
      }
      body.lr-web-fullscreen .VideoDetail--video-container--BxYAkcp,
      body.lr-web-fullscreen .VideoDetail--content-body--1KZ6K00,
      body.lr-web-fullscreen #videoBody {
        position: static !important;
        width: 100% !important;
        height: 100% !important;
        padding: 0 !important;
        margin: 0 !important;
      }
      body.lr-web-fullscreen .video-js {
        width: 100% !important;
        height: 100% !important;
        padding-top: 0 !important;
      }
      body.lr-web-fullscreen .vjs-tech {
        position: absolute !important;
        top: 0 !important;
        left: 0 !important;
        width: 100% !important;
        height: 100% !important;
        object-fit: contain !important;
      }
      /* 4. Center Quark official floating control bar over the active video area */
      #video-toolbar-content,
      [class*="video-toolbar-content"] {
        ${panelOpen ? `left: calc((100vw - ${panelWidth}px) / 2) !important;` : 'left: 50% !important;'}
        transform: translateX(-50%) !important;
        transition: left 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
      }

      /* 5. Fullscreen / Web Fullscreen: pin official control bar to bottom, clearing hardcoded top */
      body.lr-web-fullscreen #video-toolbar-content,
      #videoContainer.full-screen #video-toolbar-content,
      .full-screen [class*="video-toolbar-content"],
      body.lr-web-fullscreen [class*="video-toolbar-content"] {
        position: fixed !important;
        top: auto !important;
        bottom: 24px !important;
        z-index: 99999 !important;
      }

      /* 6. Bilibili Web Fullscreen layout coordination */
      .bpx-state-web-fullscreen#bilibili-player,
      .bpx-state-web-fullscreen #bilibili-player,
      body.bpx-state-web-fullscreen #bilibili-player,
      .mode-webscreen#bilibili-player,
      .mode-webscreen #bilibili-player,
      body.mode-webscreen #bilibili-player,
      .player-mode-web-fullscreen#bilibili-player,
      .player-mode-web-fullscreen #bilibili-player,
      body.player-mode-web-fullscreen #bilibili-player,
      .bpx-state-web-fullscreen .bpx-player-container,
      .mode-webscreen .bpx-player-container,
      [data-screen="web"]#bilibili-player,
      [data-screen="web"] .bpx-player-container,
      .bpx-player-container[data-screen="web"],
      #bilibili-player[data-screen="web"],
      body[data-screen="web"] #bilibili-player,
      #bilibili-player:has([data-screen="web"]),
      #bilibili-player:has(.bpx-state-web-fullscreen),
      #bilibili-player:has(.mode-webscreen) {
        ${panelOpen ? `width: calc(100vw - ${panelWidth}px) !important;` : ''}
        transition: width 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
      }

      /* 7. Bilibili Native Fullscreen layout coordination */
      .bpx-state-fullscreen .bpx-player-video-area,
      .bpx-state-fullscreen .bpx-player-primary-area,
      .bpx-state-fullscreen .bpx-player-video-wrap,
      .bpx-state-fullscreen .bpx-player-control-bottom,
      #bilibili-player:fullscreen .bpx-player-video-area,
      #bilibili-player:fullscreen .bpx-player-primary-area,
      #bilibili-player:fullscreen .bpx-player-video-wrap,
      #bilibili-player:fullscreen .bpx-player-control-bottom,
      .bpx-player-container:fullscreen .bpx-player-video-area,
      .bpx-player-container:fullscreen .bpx-player-primary-area,
      .bpx-player-container:fullscreen .bpx-player-video-wrap,
      .bpx-player-container:fullscreen .bpx-player-control-bottom,
      [data-screen="full"] .bpx-player-video-area,
      [data-screen="full"] .bpx-player-primary-area,
      [data-screen="full"] .bpx-player-video-wrap,
      [data-screen="full"] .bpx-player-control-bottom,
      .bpx-player-container[data-screen="full"] .bpx-player-video-area,
      .bpx-player-container[data-screen="full"] .bpx-player-primary-area,
      .bpx-player-container[data-screen="full"] .bpx-player-video-wrap,
      .bpx-player-container[data-screen="full"] .bpx-player-control-bottom {
        ${panelOpen ? `width: calc(100% - ${panelWidth}px) !important;` : ''}
        transition: width 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
      }
    `;

    // Notify Video.js / browser to recalculate video dimensions
    window.dispatchEvent(new Event('resize'));
    const t1 = setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
    const t2 = setTimeout(() => window.dispatchEvent(new Event('resize')), 220);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      styleEl?.remove();
    };
  }, [isSidePanelOpen, settings.sidePanelWidth, settings.pluginEnabled]);

  // Measure video element position & detect video title on page
  useEffect(() => {
    const updateRect = () => {
      const video = player.getVideoElement();
      if (video) {
        const r = video.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          setVideoRect({
            left: r.left,
            top: r.top,
            width: r.width,
            height: r.height,
            bottom: r.bottom
          });
        }
      }

      // Try detecting video title from page with strict prioritization & sanitization
      if (!videoTitle) {
        const detected = detectPageVideoTitle();
        if (detected) {
          setVideoTitle(detected);
        }
      }
    };

    updateRect();
    const interval = setInterval(updateRect, 500);
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);

    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [player, videoTitle, setVideoTitle]);

  // Listen to route changes (SPA navigation across episodes) to reset video title & update rect
  useEffect(() => {
    let lastUrl = window.location.href;
    const handleUrlChange = () => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        setVideoTitle('');
        setTimeout(() => {
          window.dispatchEvent(new Event('resize'));
        }, 300);
      }
    };

    window.addEventListener('hashchange', handleUrlChange);
    window.addEventListener('popstate', handleUrlChange);
    window.addEventListener('yt-navigate-finish', handleUrlChange);
    const interval = setInterval(handleUrlChange, 1000);

    return () => {
      window.removeEventListener('hashchange', handleUrlChange);
      window.removeEventListener('popstate', handleUrlChange);
      window.removeEventListener('yt-navigate-finish', handleUrlChange);
      clearInterval(interval);
    };
  }, [setVideoTitle]);

  // Listen to video timeupdate and play state with auto sliding-window translation
  useEffect(() => {
    if (!settings.pluginEnabled) {
      bilingualTranslator.cancelBatchTranslation();
      return;
    }
    let lastTranslateTime = 0;
    let lastRecordedTime = 0;
    const unsubTime = player.onTimeUpdate((time) => {
      updateCurrentTime(time, player);

      // Detect user seek/jump (e.g. > 3 seconds jump) and notify priority scheduler
      if (lastRecordedTime > 0 && Math.abs(time - lastRecordedTime) > 3.0) {
        bilingualTranslator.notifyPlaybackSeek(time);
      }
      lastRecordedTime = time;

      // Auto sliding-window translation for upcoming cues around playback head
      const now = Date.now();
      if (now - lastTranslateTime > 800) {
        lastTranslateTime = now;
        bilingualTranslator.scheduleSlidingWindowTranslation(time);
      }
    });

    const unsubPlay = player.onPlayStateChange((paused) => {
      useAppStore.setState({ isPlaying: !paused });
      if (!paused) {
        const video = player.getVideoElement();
        bilingualTranslator.scheduleSlidingWindowTranslation(video ? video.currentTime : 0);
      }
    });

    return () => {
      unsubTime();
      unsubPlay();
    };
  }, [player, updateCurrentTime, settings.pluginEnabled]);

  // Single-sentence precision Auto-Pause (AP) engine with high-frequency frame sensing and lookahead timer
  useEffect(() => {
    if (!settings.pluginEnabled) return;
    const apEngine = new AutoPauseEngine(player);
    apEngine.start();
    return () => {
      apEngine.destroy();
    };
  }, [player, settings.pluginEnabled]);

  // Proactively trigger sliding window translation when cues load or settings hydrate
  useEffect(() => {
    // Keep the visible mode and language flags consistent after migrating older settings.
    if (settings.subtitleMode === 'both' && !settings.showChinese) {
      updateSettings({ showChinese: true, showEnglish: true });
    }
    if (settings.pluginEnabled && cues.length > 0 && settings.apiKey) {
      const video = player.getVideoElement();
      bilingualTranslator.scheduleSlidingWindowTranslation(video ? video.currentTime : 0);
    }
  }, [cues.length, settings.apiKey, settings.apiBaseUrl, settings.aiProvider, settings.modelName, settings.subtitleMode, settings.showChinese, settings.pluginEnabled, player, updateSettings]);

  // Global Drag & Drop Handler for Subtitle Files
  useEffect(() => {
    if (!settings.pluginEnabled) { setIsDraggingFile(false); return; }
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.types?.includes('Files')) {
        setIsDraggingFile(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null || (e.clientX === 0 && e.clientY === 0)) {
        setIsDraggingFile(false);
      }
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsDraggingFile(false);

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const file = files[0];
        const lowerName = file.name.toLowerCase();
        if (lowerName.endsWith('.srt') || lowerName.endsWith('.vtt') || lowerName.endsWith('.ass') || lowerName.endsWith('.txt')) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const text = event.target?.result as string;
            if (text) {
              loadSubtitleFileContent(text, file.name);
            }
          };
          reader.readAsText(file);
        }
      }
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [loadSubtitleFileContent, settings.pluginEnabled]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    if (!settings.pluginEnabled) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.composedPath()[0] as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      // Strictly guard modifier keys (Ctrl, Cmd, Alt) to prevent hijacking system shortcuts like Ctrl+C
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }

      const key = e.code;
      if (key === 'KeyA') {
        e.preventDefault();
        prevCue(player);
      } else if (key === 'KeyD') {
        e.preventDefault();
        nextCue(player);
      } else if (key === 'KeyS') {
        e.preventDefault();
        repeatCurrentCue(player);
      } else if (key === 'Space') {
        e.preventDefault();
        togglePlay(player);
      } else if (key === 'KeyW') {
        e.preventDefault();
        updateSettings({ showChinese: !settings.showChinese });
      } else if (key === 'KeyV') {
        e.preventDefault();
        toggleSubtitleVisibility();
      } else if (key === 'KeyC') {
        e.preventDefault();
        cycleSubtitleMode();
      } else if (key === 'KeyZ') {
        e.preventDefault();
        setRepeatMode(!repeatMode);
      } else if (key === 'KeyE') {
        e.preventDefault();
        setSidePanelOpen(!isSidePanelOpen);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [player, prevCue, nextCue, repeatCurrentCue, togglePlay, updateSettings, settings, setSidePanelOpen, isSidePanelOpen, toggleSubtitleVisibility, cycleSubtitleMode, setRepeatMode, repeatMode]);

  return (
    <div className="language-reactor-root font-sans antialiased text-gray-100">
      {/* 1. Drag & Drop Subtitle File Overlay */}
      {isDraggingFile && (
        <div className="fixed inset-0 z-[9999999] bg-black/80 backdrop-blur-md flex flex-col items-center justify-center p-6 pointer-events-none animate-in fade-in duration-150">
          <div className="bg-[#1f1f24] border-2 border-dashed border-blue-500 rounded-2xl p-10 flex flex-col items-center justify-center space-y-4 max-w-lg text-center shadow-2xl">
            <UploadCloud size={56} className="text-blue-400 animate-bounce" />
            <h2 className="text-lg font-bold text-white">松开鼠标立即载入字幕文件</h2>
            <p className="text-xs text-gray-300">
              支持拖入 <span className="text-blue-300 font-mono">.srt</span>、<span className="text-blue-300 font-mono">.vtt</span>、<span className="text-blue-300 font-mono">.ass</span> 等格式字幕
            </p>
          </div>
        </div>
      )}

      {/* 2. Floating Top Control Bar */}
      <ErrorBoundary name="QuarkControlBar">
        <QuarkControlBar player={player} videoRect={videoRect} />
      </ErrorBoundary>

      {settings.pluginEnabled && <>
        {/* 3. Bottom Bilingual Subtitle Bar */}
        <ErrorBoundary name="SubtitleOverlay">
          <SubtitleOverlay player={player} videoRect={videoRect} />
        </ErrorBoundary>

        {/* 4. AI Sentence Deep Analysis Card/Drawer (Requirement 3) */}
        <ErrorBoundary name="SentenceAnalysisCard">
          <SentenceAnalysisCard player={player} />
        </ErrorBoundary>

        {/* 5. Word Interactive Popup Dialog */}
        <ErrorBoundary name="WordPopup">
          <WordPopup />
        </ErrorBoundary>

        {/* 6. Right Side Transcript & Word Panel */}
        <ErrorBoundary name="TranscriptPanel">
          <TranscriptPanel player={player} />
        </ErrorBoundary>

        {/* 7. Export Subtitles & Vocabulary Modal */}
        <ErrorBoundary name="ExportModal">
          <ExportModal />
        </ErrorBoundary>
      </>}
    </div>
  );
};
