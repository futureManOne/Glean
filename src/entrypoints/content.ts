import { defineContentScript } from 'wxt/sandbox';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { createShadowRootUi } from 'wxt/client';
import { AppOverlay } from '@/ui/components/AppOverlay';
import { getPlayerAdapter, isSupportedHostname } from '@/core/player';
import tailwindCss from '@/ui/styles/tailwind.css?inline';

export default defineContentScript({
  matches: [
    '*://*.bilibili.com/*',
    '*://*.youtube.com/*',
    '*://pan.quark.cn/*',
    '*://*.quark.cn/*',
    'http://127.0.0.1/*',
    'http://localhost/*'
  ],
  runAt: 'document_idle',
  cssInjectionMode: 'ui',
  async main(ctx) {
    let isMounting = false;
    let mountedUi: any = null;

    const cleanupOverlay = () => {
      if (mountedUi) {
        try {
          mountedUi.remove();
        } catch (_) {}
        mountedUi = null;
      }
      const existingEl = document.querySelector('language-reactor-overlay:not([data-vocabframe-controls-host]):not([data-vocabframe-transcript-host])');
      if (existingEl) {
        existingEl.remove();
      }

      // Also clean up any lingering embedded hosts and layout styling on non-video routes
      const controlsHost = document.querySelector('language-reactor-overlay[data-vocabframe-controls-host]');
      if (controlsHost) controlsHost.remove();
      const transcriptHost = document.querySelector('language-reactor-overlay[data-vocabframe-transcript-host]');
      if (transcriptHost) transcriptHost.remove();
      const activeSecondary = document.querySelector('[data-vocabframe-transcript-active]');
      if (activeSecondary) activeSecondary.removeAttribute('data-vocabframe-transcript-active');
      const layoutStyle = document.getElementById('lr-host-layout-style');
      if (layoutStyle) layoutStyle.remove();
    };

    const checkAndSyncPlayer = async () => {
      // 1. Strict hostname whitelist guard (never display on unsupported pages)
      if (!isSupportedHostname(window.location.hostname)) {
        cleanupOverlay();
        return false;
      }

      // 2. Adapter check
      const adapter = getPlayerAdapter();
      if (!adapter) {
        cleanupOverlay();
        return false;
      }

      const video = adapter.getVideoElement();

      // If no valid video is playing on this page (e.g. YouTube Home page, Quark list, Bilibili feed)
      if (!video) {
        cleanupOverlay();
        return false;
      }

      // Already mounted and valid
      if (document.querySelector('language-reactor-overlay:not([data-vocabframe-controls-host]):not([data-vocabframe-transcript-host])') && mountedUi) {
        return true;
      }

      if (isMounting) return false;

      const mountTarget = document.body || document.documentElement;
      if (!mountTarget) return false;

      isMounting = true;

      try {
        const ui = await createShadowRootUi(ctx, {
          name: 'language-reactor-overlay',
          position: 'inline',
          anchor: mountTarget,
          append: 'last',
          onMount: (uiContainer, shadowRoot) => {
            // Inject Tailwind CSS inside shadow root
            const style = document.createElement('style');
            style.textContent = tailwindCss;
            shadowRoot.appendChild(style);

            // Mount React App
            const root = ReactDOM.createRoot(uiContainer);
            root.render(React.createElement(AppOverlay, { player: adapter }));
            return root;
          },
          onRemove: (root) => {
            root?.unmount();
          }
        });

        ui.mount();
        mountedUi = ui;
        console.log('[VocabFrame] Mounted on active video page.');
        return true;
      } catch (err) {
        console.warn('[VocabFrame] Mount deferred:', err);
        return false;
      } finally {
        isMounting = false;
      }
    };

    const init = () => {
      if (!isSupportedHostname(window.location.hostname)) {
        cleanupOverlay();
        return;
      }

      // Initial check
      checkAndSyncPlayer();

      // Debounced observer for SPA navigation
      let timer: any = null;
      const debouncedCheck = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(checkAndSyncPlayer, 400);
      };

      const observer = new MutationObserver(debouncedCheck);
      const target = document.body || document.documentElement;
      if (target) {
        observer.observe(target, {
          childList: true,
          subtree: true
        });
      }

      // Listen to SPA navigation events (YouTube, Quark Pan, React/Vue routers)
      window.addEventListener('popstate', debouncedCheck);
      window.addEventListener('hashchange', debouncedCheck);
      window.addEventListener('yt-navigate-finish', debouncedCheck);

      // Periodically check URL changes for SPA routers using pushState/replaceState
      let lastHref = window.location.href;
      const urlCheckInterval = setInterval(() => {
        if (window.location.href !== lastHref) {
          lastHref = window.location.href;
          debouncedCheck();
        }
      }, 500);

      // Handle Fullscreen migration to prevent Top Layer from hiding overlay
      const handleFullscreenChange = () => {
        const fsElement = document.fullscreenElement || (document as any).webkitFullscreenElement;
        const overlay = document.querySelector('language-reactor-overlay:not([data-vocabframe-controls-host]):not([data-vocabframe-transcript-host])');
        if (!overlay) return;

        if (fsElement) {
          if (overlay.parentElement !== fsElement) {
            fsElement.appendChild(overlay);
          }
        } else {
          const defaultParent = document.body || document.documentElement;
          if (defaultParent && overlay.parentElement !== defaultParent) {
            defaultParent.appendChild(overlay);
          }
        }
        window.dispatchEvent(new Event('resize'));
      };

      document.addEventListener('fullscreenchange', handleFullscreenChange);
      document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
});
