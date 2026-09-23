import React, { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Upload, Repeat, Settings, BookOpen, Sparkles, CheckCircle2, ScanText, Maximize2, Minimize2, Eye, EyeOff, Subtitles, Headphones } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { VideoPlayerAdapter } from '@/core/player/BaseAdapter';
import { QuarkSubtitleSniffer } from '@/core/quark/quarkSubtitleSniffer';
import { BilibiliSubtitleSniffer } from '@/core/bilibili/bilibiliSubtitleSniffer';
import { getLocale } from '@/core/i18n';
import { BasicSettingsModal } from './BasicSettingsModal';

interface QuarkControlBarProps {
  player: VideoPlayerAdapter;
  videoRect: { left: number; top: number; width: number; height: number; bottom: number } | null;
}

export const QuarkControlBar: React.FC<QuarkControlBarProps> = ({ player, videoRect }) => {
  const {
    repeatMode,
    setRepeatMode,
    loadSubtitleFileContent,
    detectedFolderSubtitles,
    loadDetectedFolderSubtitle,
    loadDemoSubtitles,
    settings,
    updateSettings,
    setSidePanelOpen,
    isSidePanelOpen,
    cues,
    toggleSubtitleVisibility,
    cycleSubtitleMode,
    isSettingsModalOpen,
    setSettingsModalOpen
  } = useAppStore();
  const t = getLocale(settings.uiLanguage);
  const hostname = (typeof window !== 'undefined' && window.location?.hostname) || '';
  const isYouTube = hostname.includes('youtube.com');
  const isBilibili = hostname.includes('bilibili.com');
  const isQuark = hostname.includes('quark.cn');
  const isEmbedded = isYouTube || isBilibili || isQuark;
  const [showLoadMenu, setShowLoadMenu] = useState(false);
  const [isWebFullscreen, setIsWebFullscreen] = useState(() => (typeof document !== 'undefined' && document.body) ? document.body.classList.contains('lr-web-fullscreen') : false);
  const [nativeControls, setNativeControls] = useState<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const checkFullscreenState = () => setIsWebFullscreen((typeof document !== 'undefined' && document.body) ? document.body.classList.contains('lr-web-fullscreen') : false);
    window.addEventListener('resize', checkFullscreenState);
    return () => window.removeEventListener('resize', checkFullscreenState);
  }, []);

  useEffect(() => {
    if (!isEmbedded) return;
    // An isolated host participates in the native control bar's layout and auto-hide.
    const host = document.createElement('language-reactor-overlay');
    host.dataset.gleanControlsHost = 'true';
    if (isBilibili) {
      host.className = 'bpx-player-ctrl-btn';
      host.style.marginRight = '12px';
    } else {
      host.style.marginRight = '8px';
    }
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
        display: inline-flex !important;
        width: auto !important;
        height: inherit !important;
        vertical-align: top !important;
        align-items: center !important;
        justify-content: center !important;
        box-sizing: border-box !important;
      }
      button:focus-visible { outline: 2px solid #67e8f9 !important; outline-offset: -2px; }
      button:hover { background: #ffffff18 !important; }
    `;
    const mount = document.createElement('div');
    mount.style.height = '100%';
    mount.style.display = 'inline-flex';
    mount.style.alignItems = 'center';
    mount.style.justifyContent = 'center';
    mount.style.boxSizing = 'border-box';
    shadow.append(style, mount);
    const syncControls = () => {
      let controls: HTMLElement | null = null;
      if (isYouTube) {
        controls = player.getContainer()?.querySelector<HTMLElement>('.ytp-right-controls') ?? null;
      } else if (isBilibili) {
        const container = player.getContainer();
        controls = (container?.querySelector<HTMLElement>(
          '.bpx-player-control-bottom-right, .bilibili-player-video-control-bottom-right, .squirtle-controller-wrap-right, [class*="control-bottom-right"]'
        )) || (document.querySelector<HTMLElement>(
          '.bpx-player-control-bottom-right, .bilibili-player-video-control-bottom-right, .squirtle-controller-wrap-right, [class*="control-bottom-right"]'
        ));
      } else if (isQuark) {
        const container = player.getContainer();
        controls = (container?.querySelector<HTMLElement>(
          '[class*="controls-right"], [class*="right-controls"], [class*="control-bar-right"], [class*="ControlBar"] [class*="right"], .vjs-control-bar'
        )) || (document.querySelector<HTMLElement>(
          '[class*="controls-right"], [class*="right-controls"], [class*="control-bar-right"], [class*="ControlBar"] [class*="right"], .vjs-control-bar'
        ));
      }

      if (controls) {
        if (host.parentElement !== controls) controls.prepend(host);
        setNativeControls(mount);
      } else {
        host.remove();
        setNativeControls(null);
      }
    };
    syncControls();
    const observer = new MutationObserver(syncControls);
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
    window.addEventListener('yt-navigate-finish', syncControls);
    window.addEventListener('popstate', syncControls);
    window.addEventListener('hashchange', syncControls);
    return () => {
      observer.disconnect();
      host.remove();
      window.removeEventListener('yt-navigate-finish', syncControls);
      window.removeEventListener('popstate', syncControls);
      window.removeEventListener('hashchange', syncControls);
    };
  }, [isEmbedded, isYouTube, isBilibili, isQuark, player]);

  const toggleWebFullscreen = () => {
    if (isBilibili) {
      const biliWebBtn = document.querySelector<HTMLElement>(
        '.bpx-player-ctrl-web, .bilibili-player-video-web-fullscreen, [class*="ctrl-web"]'
      );
      if (biliWebBtn) {
        biliWebBtn.click();
        return;
      }
    } else if (isYouTube) {
      const ytSizeBtn = document.querySelector<HTMLElement>('.ytp-size-button');
      if (ytSizeBtn) {
        ytSizeBtn.click();
        return;
      }
    }
    const isFull = document.body.classList.toggle('lr-web-fullscreen');
    setIsWebFullscreen(isFull);
    window.dispatchEvent(new Event('resize'));
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const buffer = reader.result as ArrayBuffer;
      if (buffer) loadSubtitleFileContent(buffer, file.name);
      setShowLoadMenu(false);
    };
    reader.readAsArrayBuffer(file);
  };

  const handleManualSniff = () => {
    if (window.location.hostname.includes('bilibili.com')) {
      window.postMessage({ type: '__LR_TRIGGER_BILI_INSPECT__' }, '*');
    } else if (window.location.hostname.includes('youtube.com')) {
      // Reuse the sniffer owned by AppOverlay; a second instance would outlive the off switch.
      window.postMessage({ type: '__LR_TRIGGER_YT_INSPECT__' }, '*');
    } else {
      new QuarkSubtitleSniffer(player).startSniffing();
    }
    setShowLoadMenu(false);
  };

  const sniffLabel = isBilibili ? '自动抓取B站自带字幕' : isYouTube ? '自动抓取YouTube自带字幕' : '自动抓取夸克自带字幕';
  const nativeControl = nativeControls ? createPortal(
    <div
      onClick={event => event.stopPropagation()}
      onMouseDown={event => event.stopPropagation()}
      onMouseUp={event => event.stopPropagation()}
      onPointerDown={event => event.stopPropagation()}
      onPointerUp={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation()}
      data-glean-native-control="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        transform: isBilibili ? 'translateY(-6px)' : undefined,
        marginRight: isBilibili ? undefined : '8px',
        gap: '2px',
        boxSizing: 'border-box',
        verticalAlign: 'top',
        fontFamily: 'Arial, sans-serif'
      }}
    >
      <button
        type="button"
        onClick={() => { const enabled = !settings.pluginEnabled; updateSettings({ pluginEnabled: enabled }); }}
        role="switch"
        aria-checked={settings.pluginEnabled}
        aria-label={settings.pluginEnabled ? '关闭 Glean 拾句' : '开启 Glean 拾句'}
        title={settings.pluginEnabled ? '关闭 Glean 拾句' : '开启 Glean 拾句'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          height: isBilibili ? '24px' : '36px',
          maxHeight: '36px',
          padding: isBilibili ? '0 6px' : '0 8px',
          border: 0,
          borderRadius: '4px',
          background: 'transparent',
          color: settings.pluginEnabled ? '#67e8f9' : '#aaa',
          cursor: 'pointer',
          fontSize: '12px',
          boxSizing: 'border-box',
          lineHeight: '1'
        }}
      >
        <span
          style={{
            position: 'relative',
            display: 'inline-block',
            width: isBilibili ? '26px' : '28px',
            height: isBilibili ? '14px' : '16px',
            borderRadius: '999px',
            background: settings.pluginEnabled ? '#0891b2' : '#555',
            transition: 'background .16s',
            flexShrink: 0
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: '2px',
              left: settings.pluginEnabled ? (isBilibili ? '14px' : '14px') : '2px',
              width: isBilibili ? '10px' : '12px',
              height: isBilibili ? '10px' : '12px',
              borderRadius: '50%',
              background: '#fff',
              transition: 'left .16s'
            }}
          />
        </span>
        <span style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>拾句</span>
      </button>
      <button
        type="button"
        onClick={() => {
          const panelIsVisible = settings.pluginEnabled && isSidePanelOpen;
          updateSettings({ pluginEnabled: true });
          setSidePanelOpen(!panelIsVisible);
        }}
        aria-label={settings.pluginEnabled && isSidePanelOpen ? '收起台词侧边栏' : '展开台词侧边栏'}
        title={settings.pluginEnabled && isSidePanelOpen ? '收起台词侧边栏' : '展开台词侧边栏'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: isBilibili ? '24px' : '34px',
          height: isBilibili ? '24px' : '36px',
          maxHeight: '36px',
          border: 0,
          borderRadius: '4px',
          background: 'transparent',
          color: (settings.pluginEnabled && isSidePanelOpen) ? '#67e8f9' : '#aaa',
          cursor: 'pointer',
          boxSizing: 'border-box',
          padding: 0
        }}
      >
        <BookOpen size={isBilibili ? 15 : 16} />
      </button>
      <button
        type="button"
        onClick={() => setSettingsModalOpen(true)}
        aria-label="打开 Glean 拾句 设置"
        title="Glean 拾句 设置"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: isBilibili ? '24px' : '34px',
          height: isBilibili ? '24px' : '36px',
          maxHeight: '36px',
          border: 0,
          borderRadius: '4px',
          background: 'transparent',
          color: '#ddd',
          cursor: 'pointer',
          boxSizing: 'border-box',
          padding: 0
        }}
      >
        <Settings size={isBilibili ? 15 : 16} />
      </button>
    </div>,
    nativeControls
  ) : null;

  const toolbar = (
    <div data-glean-toolbar className="flex flex-wrap items-center gap-2 text-xs text-gray-200">
      <div className="flex items-center space-x-1.5 border-r border-white/15 pr-2.5 font-bold text-cyan-300"><Sparkles size={16} /><span>Glean 拾句</span></div>
      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${cues.length ? 'border-emerald-500/30 bg-emerald-950/60 text-emerald-400' : 'border-gray-700/30 bg-gray-900/60 text-gray-400'}`}>{cues.length ? `${cues.length} 句字幕` : '无字幕'}</span>
      <div className="relative">
        <button type="button" onClick={() => setShowLoadMenu(!showLoadMenu)} className="flex items-center space-x-1.5 rounded-md px-2 py-1.5 font-medium text-gray-200 transition-colors hover:bg-white/10"><Upload size={14} /><span>{t.controlBar.subtitleSource}</span></button>
        {showLoadMenu && (
          <div className="absolute left-0 top-9 z-[100000] w-56 space-y-1 rounded-xl border border-[#383842] bg-[#1f1f24] p-1.5 shadow-2xl">
            {detectedFolderSubtitles && detectedFolderSubtitles.length > 0 && (
              <div className="border-b border-[#383842]/70 pb-1 mb-1">
                <div className="px-2 py-1 text-[10px] font-semibold text-cyan-400">发现网盘同目录字幕</div>
                {detectedFolderSubtitles.map((sub, sIdx) => (
                  <button
                    key={sIdx}
                    type="button"
                    onClick={() => {
                      loadDetectedFolderSubtitle(sub);
                      setShowLoadMenu(false);
                    }}
                    className="flex w-full items-center justify-between space-x-1.5 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-cyan-300 hover:bg-cyan-950/60 transition-colors"
                  >
                    <span className="truncate max-w-[140px]" title={sub.name}>{sub.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-cyan-600/80 text-white rounded shrink-0">载入</span>
                  </button>
                ))}
              </div>
            )}
            <button type="button" onClick={handleManualSniff} className="flex w-full items-center space-x-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-emerald-300 hover:bg-blue-600/30"><ScanText size={14} /><span>{sniffLabel}</span></button>
            <button type="button" onClick={() => fileInputRef.current?.click()} className="flex w-full items-center space-x-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-gray-200 hover:bg-blue-600/30"><Upload size={14} /><span>{t.controlBar.importLocal}</span></button>
            <button type="button" onClick={() => { loadDemoSubtitles(); setShowLoadMenu(false); }} className="flex w-full items-center space-x-2 rounded-lg border-t border-[#383842]/50 px-2.5 pb-2 pt-2 text-left text-xs font-medium text-gray-200 hover:bg-blue-600/30"><CheckCircle2 size={14} className="text-amber-400" /><span>{t.controlBar.loadDemo}</span></button>
          </div>
        )}
        <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".srt,.vtt,.ass,.ssa,.lrc,.sub,.ttml,.xml,.json,.bcc,.txt" className="hidden" />
      </div>
      <button type="button" onClick={() => setRepeatMode(!repeatMode)} className={`flex items-center space-x-1.5 rounded-md px-2 py-1.5 font-medium transition-colors ${repeatMode ? 'border border-amber-500/50 bg-amber-600/40 text-amber-300' : 'text-gray-300 hover:bg-white/10'}`} title="单句循环跟读模式"><Repeat size={14} /><span>{t.sentenceAnalysis.loopSentence}</span></button>
      <button type="button" onClick={toggleSubtitleVisibility} className={`flex items-center space-x-1.5 rounded-md px-2 py-1.5 font-medium transition-colors ${settings.subtitleMode === 'hidden' ? 'border border-rose-500/50 bg-rose-950/70 text-rose-300' : 'text-emerald-400 hover:bg-white/10'}`} title="切换字幕显示">{settings.subtitleMode === 'hidden' ? <EyeOff size={14} /> : <Eye size={14} />}<span>{settings.subtitleMode === 'hidden' ? t.controlBar.showSubtitle : t.controlBar.hideSubtitle}</span></button>
      <button type="button" onClick={cycleSubtitleMode} className="flex items-center space-x-1 rounded-md px-2 py-1.5 text-xs font-bold text-gray-300 transition-colors hover:bg-white/10" title="切换字幕模式"><Subtitles size={13} /><span>{settings.subtitleMode === 'both' ? t.controlBar.modeBoth : settings.subtitleMode === 'mixed' ? (t.controlBar.modeMixed || '中英混合') : settings.subtitleMode === 'target' ? t.controlBar.modeTarget : settings.subtitleMode === 'translation' ? t.controlBar.modeTranslation : t.controlBar.modeHidden}</span></button>
      <button type="button" onClick={() => updateSettings({ maskChinese: !settings.maskChinese })} className={`flex items-center space-x-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${settings.maskChinese ? 'border border-emerald-500/40 bg-emerald-950/70 text-emerald-300' : 'text-gray-400 hover:bg-white/10'}`} title={t.controlBar.maskModeTitle}><Headphones size={13} /><span>盲听</span></button>
      <div className="flex items-center space-x-0.5 rounded-lg bg-white/5 px-1 py-0.5 text-xs font-mono"><button type="button" onClick={() => updateSettings({ subtitleFontSize: Math.max(13, (settings.subtitleFontSize || 18) - 1) })} className="rounded px-1 py-0.5 text-gray-400 hover:bg-white/10 hover:text-white">A-</button><span className="px-0.5 text-[11px] text-gray-400">{settings.subtitleFontSize || 18}</span><button type="button" onClick={() => updateSettings({ subtitleFontSize: Math.min(36, (settings.subtitleFontSize || 18) + 1) })} className="rounded px-1 py-0.5 text-gray-400 hover:bg-white/10 hover:text-white">A+</button></div>
      <button
        type="button"
        onClick={() => {
          const panelIsVisible = settings.pluginEnabled && isSidePanelOpen;
          updateSettings({ pluginEnabled: true });
          setSidePanelOpen(!panelIsVisible);
        }}
        className={`rounded-lg p-1.5 transition-colors ${settings.pluginEnabled && isSidePanelOpen ? 'bg-cyan-400/10 text-cyan-300' : 'text-gray-400 hover:bg-white/10'}`}
        title="切换台词侧边栏"
        aria-label="切换台词侧边栏"
      >
        <BookOpen size={16} />
      </button>
      <button type="button" onClick={toggleWebFullscreen} className={`rounded-lg p-1.5 transition-colors ${isWebFullscreen ? 'bg-cyan-400/10 text-cyan-300' : 'text-gray-400 hover:bg-white/10'}`} title={isWebFullscreen ? '退出网页全屏' : '网页全屏'}>{isWebFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
    </div>
  );

  return <>
    {nativeControl}
    <BasicSettingsModal open={isSettingsModalOpen} onClose={() => setSettingsModalOpen(false)}>
      {toolbar}
    </BasicSettingsModal>
  </>;
};
