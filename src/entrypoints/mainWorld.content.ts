import { defineContentScript } from 'wxt/sandbox';

export default defineContentScript({
  matches: ['*://*.youtube.com/*', '*://*.bilibili.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const hostname = window.location.hostname || '';
    if (hostname.includes('youtube.com')) {
      initYouTubeMainWorld();
    } else if (hostname.includes('bilibili.com')) {
      initBilibiliMainWorld();
    }
  }
});

function initYouTubeMainWorld() {
  if ((window as any).__LR_YT_SNIFFER_INJECTED__) {
    return;
  }
  (window as any).__LR_YT_SNIFFER_INJECTED__ = true;

  console.log('[Glean] YouTube Main World content script initialized.');

    let lastDispatchedUrl = '';
    let lastDispatchedVideoId = '';
    const potTokens: Record<string, string> = {};

    function getCurrentVideoId(): string {
      try {
        const u = new URL(window.location.href);
        return u.searchParams.get('v') || '';
      } catch (_) {
        return '';
      }
    }

    function capturePot(url: string) {
      if (typeof url !== 'string') return;
      if (url.includes('/timedtext?') || url.includes('/timedtext/')) {
        try {
          const parts = url.split('?');
          if (parts[1]) {
            const sp = new URLSearchParams(parts[1]);
            const pot = sp.get('pot');
            const v = sp.get('v') || getCurrentVideoId();
            if (pot && v) {
              potTokens[v] = pot;
            }
          }
        } catch (_) {}
      }
    }

    // Intercept XMLHttpRequest to capture Proof of Origin Token (pot) and timedtext
    try {
      const origXhrOpen = XMLHttpRequest.prototype.open;
      const origXhrSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method: string, url: any, ...rest: any[]) {
        (this as any).__lr_yt_url = typeof url === 'string' ? url : (url && url.href) || String(url);
        if (typeof url === 'string') capturePot(url);
        return origXhrOpen.apply(this, [method, url, ...rest] as any);
      };
      XMLHttpRequest.prototype.send = function(...args: any[]) {
        this.addEventListener('load', function() {
          try {
            const reqUrl = (this as any).__lr_yt_url;
            if (isTimedTextUrl(reqUrl)) {
              const curVid = getCurrentVideoId();
              let origJson3 = '';
              let transJson3 = '';
              try {
                const u = new URL(reqUrl, window.location.origin);
                u.searchParams.set('fmt', 'json3');
                u.searchParams.delete('tlang');
                if (curVid && potTokens[curVid] && !u.searchParams.has('pot')) {
                  u.searchParams.set('c', 'WEB');
                  u.searchParams.set('pot', potTokens[curVid]);
                }
                const curLangParam = (u.searchParams.get('lang') || '').toLowerCase();
                const isCurLangZh = curLangParam.startsWith('zh');
                origJson3 = u.toString();
                const transTarget = isCurLangZh ? 'en' : 'zh-Hans';
                u.searchParams.set('tlang', transTarget);
                transJson3 = u.toString();
              } catch (_) {
                const cleanBase = reqUrl.replace(/[?&]fmt=[^&]+/, '').replace(/[?&]tlang=[^&]+/, '');
                const sep = cleanBase.includes('?') ? '&' : '?';
                let extra = '';
                if (curVid && potTokens[curVid]) {
                  extra = `&c=WEB&pot=${potTokens[curVid]}`;
                }
                const curLangParam = (reqUrl.match(/[?&]lang=([^&]+)/)?.[1] || '').toLowerCase();
                const transTarget = curLangParam.startsWith('zh') ? 'en' : 'zh-Hans';
                origJson3 = cleanBase + sep + 'fmt=json3' + extra;
                transJson3 = origJson3 + '&tlang=' + transTarget;
              }

              Promise.all([
                origFetch(origJson3, { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).catch(() => null),
                origFetch(transJson3, { credentials: 'same-origin' })
                  .then(r => r.ok ? r.json() : null)
                  .then(d => d || origFetch(transJson3.replace('tlang=zh-Hans', 'tlang=zh'), { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).catch(() => null))
                  .catch(() => null)
              ]).then(([origD, transD]) => {
                if (origD && origD.events && origD.events.length > 0) {
                  const validTrans = transD && transD.events && transD.events.length > 0 ? transD : null;
                  dispatchTimedtext(origD, validTrans, origJson3, 'json3');
                }
              }).catch(() => {});
            }
          } catch (_) {}
        });
        return origXhrSend.apply(this, args as any);
      };
    } catch (_) {}

    function dispatchTimedtext(content: any, transContent: any, url: string, format = 'json3', trackName = '') {
      if (!content) return;
      const curVid = getCurrentVideoId();
      if (url && url === lastDispatchedUrl && curVid === lastDispatchedVideoId) return;

      lastDispatchedUrl = url || '';
      if (curVid) lastDispatchedVideoId = curVid;

      window.postMessage({
        type: '__LR_YT_TIMEDTEXT__',
        content: typeof content === 'string' ? content : JSON.stringify(content),
        transContent: transContent ? (typeof transContent === 'string' ? transContent : JSON.stringify(transContent)) : null,
        url: url || '',
        format: format || 'json3',
        trackName: trackName || '',
        videoId: curVid
      }, '*');
    }

    function isTimedTextUrl(u: any): boolean {
      const str = typeof u === 'string' ? u : (u && u.href) || '';
      if (!str) return false;
      return str.includes('/timedtext') || str.includes('timedtext?');
    }

    function processTracks(tracks: any[], targetLang = 'zh-Hans') {
      if (!Array.isArray(tracks) || tracks.length === 0) return;
      const player = document.getElementById('movie_player') as any;
      const curVid = getCurrentVideoId();

      // Ensure we do not mistake ad caption tracks for main video subtitles
      if (player && typeof player.getAdState === 'function') {
        const adState = player.getAdState();
        if (adState !== -1 && adState !== 0) {
          return;
        }
      }

      let chosen: any = null;

      if (player && typeof player.getOption === 'function') {
        const cur = player.getOption('captions', 'track');
        const curLang = ((cur?.languageCode || '') as string).toLowerCase();
        const curVss = (((cur?.vssId || cur?.vss_id) || '') as string).toLowerCase();
        const curUrl = cur?.baseUrl || cur?.url || '';
        const isCurZh = curLang.startsWith('zh') || curVss.includes('zh') || curUrl.includes('lang=zh');
        const isCurEn = curLang === 'en' || curLang.startsWith('en-') || curVss === '.en' || curVss === 'a.en' || curVss.includes('en');
        if (!isCurZh && !curUrl.includes('tlang=') && isCurEn) {
          if (curUrl) {
            chosen = cur;
          } else if (curLang) {
            chosen = tracks.find((t: any) => (t.languageCode || '').toLowerCase() === curLang);
          }
        }
      }
      if (!chosen) {
        chosen = tracks.find((t: any) => {
          const vss = ((t.vssId || t.vss_id) || '').toLowerCase();
          const lang = (t.languageCode || '').toLowerCase();
          return (lang === 'en' || lang.startsWith('en-') || vss === '.en' || vss.startsWith('.en.')) && t.kind !== 'asr' && (t.baseUrl || t.url);
        });
      }
      if (!chosen) {
        chosen = tracks.find((t: any) => {
          const vss = ((t.vssId || t.vss_id) || '').toLowerCase();
          const lang = (t.languageCode || '').toLowerCase();
          return (lang === 'en' || lang.startsWith('en-') || vss === 'a.en' || vss.includes('en')) && t.kind === 'asr' && (t.baseUrl || t.url);
        });
      }
      if (!chosen) {
        chosen = tracks.find((t: any) => {
          const vss = ((t.vssId || t.vss_id) || '').toLowerCase();
          const lang = (t.languageCode || '').toLowerCase();
          return (lang === 'en' || lang.startsWith('en-') || vss.includes('en')) && (t.baseUrl || t.url);
        });
      }
      if (!chosen) {
        chosen = tracks.find((t: any) => {
          const vss = ((t.vssId || t.vss_id) || '').toLowerCase();
          const lang = (t.languageCode || '').toLowerCase();
          return t.kind !== 'asr' && !lang.startsWith('zh') && !vss.includes('zh') && (t.baseUrl || t.url);
        });
      }
      if (!chosen) {
        chosen = tracks.find((t: any) => {
          const vss = ((t.vssId || t.vss_id) || '').toLowerCase();
          const lang = (t.languageCode || '').toLowerCase();
          return !lang.startsWith('zh') && !vss.includes('zh') && (t.baseUrl || t.url);
        });
      }
      if (!chosen) {
        chosen = tracks.find((t: any) => t.baseUrl || t.url) || tracks[0];
      }

      const rawUrl = chosen ? (chosen.baseUrl || chosen.url) : '';
    if (!rawUrl) return;

    // Verify rawUrl matches curVid if it specifies v=
    try {
      const uTest = new URL(rawUrl, window.location.origin);
      const urlVid = uTest.searchParams.get('v');
      if (urlVid && curVid && urlVid !== curVid) {
        return;
      }
    } catch (_) {}

      const chosenLang = ((chosen.languageCode || '') as string).toLowerCase();
      const chosenVss = (((chosen.vssId || chosen.vss_id) || '') as string).toLowerCase();
      const isEnglishTrack = chosenLang === 'en' || chosenLang.startsWith('en-') || chosenVss.includes('en');
      const isSourceZh = chosenLang.startsWith('zh') || chosenVss.includes('zh') || rawUrl.includes('lang=zh');
      const actualTargetLang = isSourceZh ? 'en' : targetLang;

      const label = (chosen.name && (chosen.name.simpleText || (chosen.name.runs && chosen.name.runs[0] && chosen.name.runs[0].text))) ||
                    chosen.displayName || chosen.languageName || chosen.languageCode || 'YouTube Captions';

      let json3Url = '';
      let transUrl = '';
      try {
        const u = new URL(rawUrl, window.location.origin);
        u.searchParams.set('fmt', 'json3');
        u.searchParams.delete('tlang');
        if (curVid && potTokens[curVid] && !u.searchParams.has('pot')) {
          u.searchParams.set('c', 'WEB');
          u.searchParams.set('pot', potTokens[curVid]);
        }
        json3Url = u.toString();
        u.searchParams.set('tlang', actualTargetLang);
        transUrl = u.toString();
      } catch (_) {
        const cleanBase = rawUrl.replace(/[?&]fmt=[^&]+/, '').replace(/[?&]tlang=[^&]+/, '');
        const sep = cleanBase.includes('?') ? '&' : '?';
        let extra = '';
        if (curVid && potTokens[curVid]) {
          extra = `&c=WEB&pot=${potTokens[curVid]}`;
        }
        json3Url = cleanBase + sep + 'fmt=json3' + extra;
        transUrl = json3Url + '&tlang=' + actualTargetLang;
      }

      if (isEnglishTrack) {
        (window as any).__LR_YT_ENGLISH_TRACK_URL__ = json3Url;
      }

      Promise.all([
        fetch(json3Url, { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(transUrl, { credentials: 'same-origin' })
          .then(r => r.ok ? r.json() : null)
          .then(d => d || fetch(transUrl.replace('tlang=zh-Hans', 'tlang=zh'), { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).catch(() => null))
          .catch(() => null)
      ]).then(([origData, transData]) => {
        if (origData && origData.events && origData.events.length > 0) {
          const validTrans = transData && transData.events && transData.events.length > 0 ? transData : null;
          dispatchTimedtext(origData, validTrans, json3Url, 'json3', label);
        } else {
          fetch(rawUrl, { credentials: 'same-origin' })
            .then(r => r.text())
            .then(txt => {
              if (txt && (txt.includes('WEBVTT') || txt.includes('<transcript') || txt.includes('<timedtext') || txt.includes('-->'))) {
                const fmt = txt.includes('WEBVTT') ? 'vtt' : (txt.includes('<transcript') || txt.includes('<timedtext') ? 'xml' : 'vtt');
                dispatchTimedtext(txt, null, rawUrl, fmt, label);
              }
            })
            .catch(() => {});
        }
      }).catch(() => {});
    }

    function inspectPageCaptions(targetLang = 'zh-Hans') {
      try {
        const curVid = getCurrentVideoId();
        if (!curVid) return;

        const player = document.getElementById('movie_player') as any;

        // Skip caption inspection during ad playback
        if (player && typeof player.getAdState === 'function') {
          const adState = player.getAdState();
          if (adState !== -1 && adState !== 0) {
            return;
          }
        }

        if (player && typeof player.loadModule === 'function') {
          try {
            player.loadModule('captions');
          } catch (_) {}
        }

        let tracks: any[] | null = null;

        // 1. YouTube Player API with { includeAsr: true }
        if (player && typeof player.getOption === 'function') {
          const list = player.getOption('captions', 'tracklist', { includeAsr: true });
          if (Array.isArray(list) && list.length > 0 && list[0] && (list[0].baseUrl || list[0].url)) {
            tracks = list;
          }
        }

        // 2. Player Response from movie_player instance
        if (!tracks && player && typeof player.getPlayerResponse === 'function') {
          const resp = player.getPlayerResponse();
          const respVid = resp?.videoDetails?.videoId;
          if (!respVid || respVid === curVid) {
            tracks = resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
          }
        }

        // 3. ytd-watch-flexy element state
        if (!tracks) {
          const watchFlexy = document.querySelector('ytd-watch-flexy') as any;
          const pData = watchFlexy && (watchFlexy.playerData || (watchFlexy.__data && watchFlexy.__data.playerData));
          tracks = pData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        }

        // 4. ytInitialPlayerResponse in window
        if (!tracks && (window as any).ytInitialPlayerResponse) {
          const initResp = (window as any).ytInitialPlayerResponse;
          const initVid = initResp?.videoDetails?.videoId;
          if (!initVid || curVid === initVid) {
            tracks = initResp?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
          }
        }

        if (Array.isArray(tracks) && tracks.length > 0) {
          processTracks(tracks, targetLang);
        }
      } catch (_) {}
    }

    // Hook window.fetch
    const origFetch = window.fetch;
    window.fetch = async function(...args: any[]) {
      const resp = await origFetch.apply(this, args as [any, any]);
      try {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && (args[0].url || args[0].href)) || '';
        if (url) capturePot(url);

        if (isTimedTextUrl(url)) {
          const curVid = getCurrentVideoId();
          let origJson3 = '';
          let transJson3 = '';
          try {
            const u = new URL(url, window.location.origin);
            u.searchParams.set('fmt', 'json3');
            u.searchParams.delete('tlang');
            if (curVid && potTokens[curVid] && !u.searchParams.has('pot')) {
              u.searchParams.set('c', 'WEB');
              u.searchParams.set('pot', potTokens[curVid]);
            }
            const curLangParam = (u.searchParams.get('lang') || '').toLowerCase();
            if (curLangParam.startsWith('zh') && (window as any).__LR_YT_ENGLISH_TRACK_URL__) {
              origJson3 = (window as any).__LR_YT_ENGLISH_TRACK_URL__;
            } else {
              origJson3 = u.toString();
            }
            u.searchParams.set('tlang', 'zh-Hans');
            transJson3 = u.toString();
          } catch (_) {
            const cleanBase = url.replace(/[?&]fmt=[^&]+/, '').replace(/[?&]tlang=[^&]+/, '');
            const sep = cleanBase.includes('?') ? '&' : '?';
            let extra = '';
            if (curVid && potTokens[curVid]) {
              extra = `&c=WEB&pot=${potTokens[curVid]}`;
            }
            origJson3 = cleanBase + sep + 'fmt=json3' + extra;
            transJson3 = origJson3 + '&tlang=' + 'zh-Hans';
          }

          Promise.all([
            origFetch(origJson3, { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).catch(() => null),
            origFetch(transJson3, { credentials: 'same-origin' })
              .then(r => r.ok ? r.json() : null)
              .then(d => d || origFetch(transJson3.replace('tlang=zh-Hans', 'tlang=zh'), { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).catch(() => null))
              .catch(() => null)
          ]).then(([origD, transD]) => {
            if (origD && origD.events && origD.events.length > 0) {
              const validTrans = transD && transD.events && transD.events.length > 0 ? transD : null;
              dispatchTimedtext(origD, validTrans, origJson3, 'json3');
            }
          }).catch(() => {});
        }
      } catch (_) {}
      return resp;
    };

    // Polling retry on initial load and navigation
    let inspectInterval: any = null;
    function startInspectPolling(targetLang = 'zh-Hans') {
      if (inspectInterval) clearInterval(inspectInterval);
      let inspectRetries = 0;
      inspectInterval = setInterval(() => {
        inspectRetries++;
        const curVid = getCurrentVideoId();
        // Only stop polling once the current video has its subtitles dispatched or retries exhausted
        if ((curVid && lastDispatchedVideoId === curVid) || inspectRetries > 25) {
          clearInterval(inspectInterval);
          inspectInterval = null;
          return;
        }
        inspectPageCaptions(targetLang);
      }, 600);
    }

    function attachPlayerListeners() {
      const player = document.getElementById('movie_player') as any;
      if (player && typeof player.addEventListener === 'function') {
        try {
          player.addEventListener('onAdStateChange', (state: any) => {
            // Ad finished
            if (state === -1 || state === 0) {
              lastDispatchedVideoId = '';
              lastDispatchedUrl = '';
              inspectPageCaptions();
              startInspectPolling();
            }
          });
          player.addEventListener('onStateChange', (state: any) => {
            // Video playing
            if (state === 1) {
              const curVid = getCurrentVideoId();
              if (curVid && lastDispatchedVideoId !== curVid) {
                inspectPageCaptions();
                startInspectPolling();
              }
            }
          });
        } catch (_) {}
      }
    }

    inspectPageCaptions();
    startInspectPolling();
    setTimeout(attachPlayerListeners, 1000);

    const resetNavigationState = () => {
      lastDispatchedVideoId = '';
      lastDispatchedUrl = '';
      delete (window as any).__LR_YT_ENGLISH_TRACK_URL__;
    };

    window.addEventListener('yt-navigate-start', () => {
      resetNavigationState();
    });
    window.addEventListener('yt-page-data-updated', () => {
      resetNavigationState();
      inspectPageCaptions();
      startInspectPolling();
      attachPlayerListeners();
    });
    window.addEventListener('yt-player-updated', () => {
      resetNavigationState();
      inspectPageCaptions();
      startInspectPolling();
      attachPlayerListeners();
    });
    window.addEventListener('yt-navigate-finish', () => {
      resetNavigationState();
      inspectPageCaptions();
      startInspectPolling();
      attachPlayerListeners();
    });

    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === '__LR_TRIGGER_YT_INSPECT__') {
        const lang = e.data.targetLang || 'zh-Hans';
        resetNavigationState();
        inspectPageCaptions(lang);
        startInspectPolling(lang);
        attachPlayerListeners();
      }
    });
}

function initBilibiliMainWorld() {
  if ((window as any).__LR_BILI_SNIFFER_INJECTED__) {
    return;
  }
  (window as any).__LR_BILI_SNIFFER_INJECTED__ = true;

  console.log('[Glean] Bilibili Main World content script initialized.');

  let lastDispatchedCid = '';
  let lastDispatchedUrl = '';
  const cachedSubtitles: Record<string, any> = {};

  function getCurrentVideoInfo(): { bvid: string; p: number } {
    try {
      const pathname = window.location.pathname || '';
      const bvMatch = pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/i);
      const bvid = bvMatch ? bvMatch[1] : '';
      const sp = new URLSearchParams(window.location.search);
      const p = parseInt(sp.get('p') || '1', 10) || 1;
      return { bvid, p };
    } catch (_) {
      return { bvid: '', p: 1 };
    }
  }

  function mergeAndDispatchDualTracks(enJson: any, zhJson: any, source = 'network') {
    if (!enJson || !enJson.body || !Array.isArray(enJson.body)) {
      if (zhJson && Array.isArray(zhJson.body)) {
        window.postMessage({
          type: '__LR_BILI_SUBTITLE__',
          content: typeof zhJson === 'string' ? zhJson : JSON.stringify(zhJson),
          source
        }, '*');
      }
      return;
    }

    if (!zhJson || !zhJson.body || !Array.isArray(zhJson.body)) {
      window.postMessage({
        type: '__LR_BILI_SUBTITLE__',
        content: typeof enJson === 'string' ? enJson : JSON.stringify(enJson),
        source
      }, '*');
      return;
    }

    const mergedBody = enJson.body.map((enItem: any) => {
      const match = zhJson.body.find((zhItem: any) =>
        Math.max(enItem.from, zhItem.from) < Math.min(enItem.to, zhItem.to) ||
        Math.abs(zhItem.from - enItem.from) < 0.8
      );
      const zhContent = match ? (match.content || '').trim() : '';
      const enContent = (enItem.content || '').trim();
      return {
        from: enItem.from,
        to: enItem.to,
        location: enItem.location,
        content: zhContent ? `${enContent}\n${zhContent}` : enContent
      };
    });

    const mergedJson = {
      ...enJson,
      body: mergedBody
    };

    window.postMessage({
      type: '__LR_BILI_SUBTITLE__',
      content: JSON.stringify(mergedJson),
      source
    }, '*');
  }

  async function fetchAndProcessSubtitles(subs: any[]) {
    if (!Array.isArray(subs) || subs.length === 0) return;

    const enSub = subs.find((s: any) =>
      (s.lan || '').toLowerCase().includes('en') ||
      (s.lan_doc || '').includes('英')
    );
    const zhSub = subs.find((s: any) =>
      (s.lan || '').toLowerCase().includes('zh') ||
      (s.lan_doc || '').includes('中')
    );

    const targetSub = enSub || zhSub || subs[0];
    if (!targetSub) return;

    try {
      if (enSub && zhSub && enSub !== zhSub) {
        const enUrl = enSub.subtitle_url?.startsWith('//') ? `https:${enSub.subtitle_url}` : enSub.subtitle_url;
        const zhUrl = zhSub.subtitle_url?.startsWith('//') ? `https:${zhSub.subtitle_url}` : zhSub.subtitle_url;

        const [enRes, zhRes] = await Promise.all([
          fetch(enUrl, { credentials: 'include' }).then(r => r.ok ? r.json() : null).catch(() => null),
          fetch(zhUrl, { credentials: 'include' }).then(r => r.ok ? r.json() : null).catch(() => null)
        ]);

        if (enRes || zhRes) {
          mergeAndDispatchDualTracks(enRes, zhRes, 'api');
          return;
        }
      }

      const singleUrl = targetSub.subtitle_url?.startsWith('//') ? `https:${targetSub.subtitle_url}` : targetSub.subtitle_url;
      if (singleUrl) {
        const res = await fetch(singleUrl, { credentials: 'include' });
        if (res.ok) {
          const json = await res.json();
          window.postMessage({
            type: '__LR_BILI_SUBTITLE__',
            content: JSON.stringify(json),
            source: 'api'
          }, '*');
        }
      }
    } catch (_) {}
  }

  // Intercept XMLHttpRequest and fetch in Main World
  try {
    const origXhrOpen = XMLHttpRequest.prototype.open;
    const origXhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method: string, url: any, ...rest: any[]) {
      (this as any).__lr_bili_url = typeof url === 'string' ? url : (url && url.href) || String(url);
      return origXhrOpen.apply(this, [method, url, ...rest] as any);
    };
    XMLHttpRequest.prototype.send = function(...args: any[]) {
      this.addEventListener('load', function() {
        try {
          const reqUrl = (this as any).__lr_bili_url || '';
          if (reqUrl.includes('aisubtitle.hdslb.com') || reqUrl.includes('/ai_subtitle/')) {
            const txt = this.responseText;
            if (txt && txt.includes('"body"')) {
              const json = JSON.parse(txt);
              if (json && Array.isArray(json.body)) {
                const lang = (json.lang || '').toLowerCase();
                cachedSubtitles[lang] = json;
                if (cachedSubtitles['ai-en'] && cachedSubtitles['ai-zh']) {
                  mergeAndDispatchDualTracks(cachedSubtitles['ai-en'], cachedSubtitles['ai-zh'], 'network');
                } else {
                  window.postMessage({
                    type: '__LR_BILI_SUBTITLE__',
                    content: txt,
                    source: 'network'
                  }, '*');
                }
              }
            }
          } else if (reqUrl.includes('/x/player/v2') || reqUrl.includes('/x/player/wbi/v2') || reqUrl.includes('/dm/web/view')) {
            const txt = this.responseText;
            if (txt && txt.includes('"subtitle"')) {
              const json = JSON.parse(txt);
              const subs = json?.data?.subtitle?.subtitles;
              if (Array.isArray(subs) && subs.length > 0) {
                fetchAndProcessSubtitles(subs);
              }
            }
          }
        } catch (_) {}
      });
      return origXhrSend.apply(this, args as any);
    };

    const origFetch = window.fetch;
    window.fetch = async function(...args: any[]) {
      const resp = await origFetch.apply(this, args as [any, any]);
      try {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && (args[0].url || args[0].href)) || '';
        if (url.includes('aisubtitle.hdslb.com') || url.includes('/ai_subtitle/')) {
          resp.clone().text().then(txt => {
            if (txt && txt.includes('"body"')) {
              const json = JSON.parse(txt);
              if (json && Array.isArray(json.body)) {
                const lang = (json.lang || '').toLowerCase();
                cachedSubtitles[lang] = json;
                if (cachedSubtitles['ai-en'] && cachedSubtitles['ai-zh']) {
                  mergeAndDispatchDualTracks(cachedSubtitles['ai-en'], cachedSubtitles['ai-zh'], 'network');
                } else {
                  window.postMessage({
                    type: '__LR_BILI_SUBTITLE__',
                    content: txt,
                    source: 'network'
                  }, '*');
                }
              }
            }
          }).catch(() => {});
        } else if (url.includes('/x/player/v2') || url.includes('/x/player/wbi/v2') || url.includes('/dm/web/view')) {
          resp.clone().json().then(data => {
            const subs = data?.data?.subtitle?.subtitles;
            if (Array.isArray(subs) && subs.length > 0) {
              fetchAndProcessSubtitles(subs);
            }
          }).catch(() => {});
        }
      } catch (_) {}
      return resp;
    };
  } catch (_) {}

  async function inspectBilibiliPage() {
    const { bvid, p } = getCurrentVideoInfo();
    const curUrl = window.location.href;
    if (!bvid) return;

    const state = (window as any).__INITIAL_STATE__;
    if (state && state.videoData) {
      const pages = state.videoData.pages;
      let targetCid = state.videoData.cid;
      if (Array.isArray(pages) && pages.length > 0) {
        const matchedPage = pages.find((pg: any) => pg.page === p) || pages[p - 1] || pages[0];
        if (matchedPage?.cid) {
          targetCid = matchedPage.cid;
        }
      }

      if (p === 1 && state.videoData.subtitle?.subtitles?.length > 0) {
        fetchAndProcessSubtitles(state.videoData.subtitle.subtitles);
        return;
      }

      if (targetCid && (String(targetCid) !== lastDispatchedCid || curUrl !== lastDispatchedUrl)) {
        try {
          const apiResp = await fetch(`/x/player/v2?cid=${targetCid}&bvid=${bvid}`, { credentials: 'include' });
          if (apiResp.ok) {
            const data = await apiResp.json();
            const subs = data?.data?.subtitle?.subtitles;
            if (Array.isArray(subs) && subs.length > 0) {
              lastDispatchedCid = String(targetCid);
              lastDispatchedUrl = curUrl;
              fetchAndProcessSubtitles(subs);
              return;
            }
          }
        } catch (_) {}
      }
    }
  }

  let lastUrl = window.location.href;
  setInterval(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      lastDispatchedCid = '';
      inspectBilibiliPage();
    }
  }, 800);

  window.addEventListener('popstate', () => { lastDispatchedCid = ''; inspectBilibiliPage(); });
  window.addEventListener('hashchange', () => { lastDispatchedCid = ''; inspectBilibiliPage(); });
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === '__LR_TRIGGER_BILI_INSPECT__') {
      inspectBilibiliPage();
    }
  });

  inspectBilibiliPage();
  setTimeout(inspectBilibiliPage, 800);
  setTimeout(inspectBilibiliPage, 2000);
}
