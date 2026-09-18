import { SubtitleCue } from '@/types';
import { parseSubtitleContent, splitBilingualLines } from '../subtitle/parser';
import { useAppStore } from '@/store/useAppStore';
import { VideoPlayerAdapter } from '../player/BaseAdapter';
import { isValidSubtitleText } from '../youtube/youtubeSubtitleSniffer';
import { bilingualTranslator } from '../ai/bilingualTranslator';

/**
 * Quark Subtitle Sniffer (Exclusively for Quark Pan)
 */
export class QuarkSubtitleSniffer {
  private player: VideoPlayerAdapter;
  private isSniffing = false;
  private domObserver: MutationObserver | null = null;
  private videoTrackObserver: MutationObserver | null = null;
  private textTrackInterval: any = null;
  private messageListener: ((e: MessageEvent) => void) | null = null;
  private lastCapturedText = '';
  private processedTrackUrls = new Set<string>();
  private boundVideos = new WeakSet<HTMLVideoElement>();
  private lastUrl = '';
  private lastVideoSrc = '';
  private activeTrackSignature = '';

  constructor(player: VideoPlayerAdapter) {
    this.player = player;
  }

  public startSniffing() {
    // ONLY activate on Quark Cloud Drive (pan.quark.cn)
    if (!window.location.hostname.includes('quark.cn')) return;
    if (this.isSniffing) return;
    this.isSniffing = true;

    this.sniffTextTracks();
    this.sniffDomSubtitles();
    this.sniffNetworkRequests();

    console.log('[VocabFrame] Quark Subtitle Sniffer started.');
  }

  public stopSniffing() {
    this.isSniffing = false;
    if (this.domObserver) {
      this.domObserver.disconnect();
      this.domObserver = null;
    }
    if (this.videoTrackObserver) {
      this.videoTrackObserver.disconnect();
      this.videoTrackObserver = null;
    }
    if (this.textTrackInterval) {
      clearInterval(this.textTrackInterval);
      this.textTrackInterval = null;
    }
    if (this.messageListener) {
      window.removeEventListener('message', this.messageListener);
      this.messageListener = null;
    }
    this.processedTrackUrls.clear();
    this.activeTrackSignature = '';
  }

  /**
   * 1. Extract from video.textTracks and <track> elements
   */
  private sniffTextTracks() {
    const checkTracks = () => {
      const video = this.player.getVideoElement();
      if (!video) return;

      const currentUrl = window.location.href;
      const currentSrc = video.currentSrc || video.src || '';

      // Detect episode change or video source change
      if ((this.lastUrl && this.lastUrl !== currentUrl) || (this.lastVideoSrc && this.lastVideoSrc !== currentSrc)) {
        console.log('[VocabFrame] Video / Episode switched. Resetting track sniffer state.');
        this.processedTrackUrls.clear();
        this.lastCapturedText = '';
        this.activeTrackSignature = '';
        useAppStore.getState().setVideoTitle('');
      }
      this.lastUrl = currentUrl;
      this.lastVideoSrc = currentSrc;

      this.bindVideoElement(video);

      // Check existing video.textTracks
      if (video.textTracks && video.textTracks.length > 0) {
        // Ensure tracks are set to hidden (never disabled) to force browser parsing
        for (let i = 0; i < video.textTracks.length; i++) {
          const track = video.textTracks[i];
          if (track.mode === 'disabled') {
            try {
              track.mode = 'hidden';
            } catch (_) {}
          }
        }

        // Single best track candidate selection
        const bestTrack = this.selectBestTextTrack(video.textTracks);
        if (bestTrack && bestTrack.cues && bestTrack.cues.length > 0) {
          const currentCues = useAppStore.getState().cues;
          const currentHasZh = currentCues.length > 5 && currentCues.some(c => c.textZh && /[\u4e00-\u9fa5]/.test(c.textZh));
          const candidateHasZh = this.trackHasChinese(bestTrack);
          const candidateSignature = this.getTrackSignature(bestTrack, candidateHasZh);

          // Anti-downgrade guard: If store already has bilingual subtitles, NEVER overwrite with monolingual English track!
          if (currentHasZh && !candidateHasZh) {
            // Keep bilingual subtitles intact
          } else if (candidateSignature !== this.activeTrackSignature) {
            this.activeTrackSignature = candidateSignature;
            this.convertTextTrackToCues(bestTrack);
          }
        }
      }

      // Check <track> tags inside video element
      const trackTags = video.querySelectorAll('track');
      trackTags.forEach(t => {
        const src = t.getAttribute('src');
        if (src && !this.processedTrackUrls.has(src)) {
          this.processedTrackUrls.add(src);
          const title = t.getAttribute('srclang') || t.getAttribute('label') || 'Quark Subtitle';
          fetch(src)
            .then(res => res.text())
            .then(text => {
              if (text && (text.includes('-->') || text.includes('WEBVTT') || text.includes('Dialogue:'))) {
                const currentCues = useAppStore.getState().cues;
                const currentHasZh = currentCues.length > 5 && currentCues.some(c => c.textZh && /[\u4e00-\u9fa5]/.test(c.textZh));
                const newHasZh = /[\u4e00-\u9fa5]/.test(text);
                // Anti-downgrade guard for fetched tracks
                if (currentHasZh && !newHasZh) {
                  console.log('[VocabFrame] Ignored monolingual track fetch to protect bilingual subtitles.');
                  return;
                }
                console.log('[VocabFrame] Fetched track content from:', src);
                useAppStore.getState().loadSubtitleFileContent(text, title);
              }
            })
            .catch(err => {
              console.warn('[VocabFrame] Track fetch error:', err);
            });
        }
      });
    };

    // Initial check
    checkTracks();

    // Check periodically to catch external subtitles added dynamically by Quark player
    this.textTrackInterval = setInterval(() => {
      if (!this.isSniffing) {
        clearInterval(this.textTrackInterval);
        return;
      }
      checkTracks();
    }, 1500);
  }

  private bindVideoElement(video: HTMLVideoElement) {
    if (this.boundVideos.has(video)) return;
    this.boundVideos.add(video);

    if (video.textTracks) {
      const onAddTrack = (e: Event) => {
        const track = (e as TrackEvent).track;
        if (track) {
          if (track.mode === 'disabled') {
            try {
              track.mode = 'hidden';
            } catch (_) {}
          }
          this.bindSingleTrack(track);
        }
      };

      video.textTracks.addEventListener('addtrack', onAddTrack);

      for (let i = 0; i < video.textTracks.length; i++) {
        this.bindSingleTrack(video.textTracks[i]);
      }
    }

    // Observe changes inside the video tag (e.g. injected <track> nodes)
    if (!this.videoTrackObserver) {
      this.videoTrackObserver = new MutationObserver(() => {
        const currentVideo = this.player.getVideoElement();
        if (currentVideo) {
          const trackTags = currentVideo.querySelectorAll('track');
          trackTags.forEach(t => {
            const src = t.getAttribute('src');
            if (src && !this.processedTrackUrls.has(src)) {
              this.processedTrackUrls.add(src);
              const title = t.getAttribute('srclang') || t.getAttribute('label') || 'Quark Subtitle';
              fetch(src)
                .then(res => res.text())
                .then(text => {
                  if (text && (text.includes('-->') || text.includes('WEBVTT') || text.includes('Dialogue:'))) {
                    const currentCues = useAppStore.getState().cues;
                    const currentHasZh = currentCues.length > 5 && currentCues.some(c => c.textZh && /[\u4e00-\u9fa5]/.test(c.textZh));
                    const newHasZh = /[\u4e00-\u9fa5]/.test(text);
                    if (currentHasZh && !newHasZh) {
                      console.log('[VocabFrame] Ignored dynamic monolingual track to protect bilingual subtitles.');
                      return;
                    }
                    useAppStore.getState().loadSubtitleFileContent(text, title);
                  }
                })
                .catch(() => {});
            }
          });
        }
      });
    }

    this.videoTrackObserver.observe(video, { childList: true, attributes: true, attributeFilter: ['src'] });
  }

  private bindSingleTrack(track: TextTrack) {
    const onCueChange = () => {
      // Only evaluate if store currently has no cues or invalid cues
      const currentCues = useAppStore.getState().cues;
      if (currentCues.length <= 1) {
        const video = this.player.getVideoElement();
        if (video?.textTracks) {
          const best = this.selectBestTextTrack(video.textTracks);
          if (best && best.cues && best.cues.length > 0) {
            const hasZh = this.trackHasChinese(best);
            const sig = this.getTrackSignature(best, hasZh);
            if (sig !== this.activeTrackSignature) {
              this.activeTrackSignature = sig;
              this.convertTextTrackToCues(best);
            }
          }
        }
      }
    };

    track.addEventListener('cuechange', onCueChange);
    track.oncuechange = onCueChange;
  }

  /**
   * Score and select the single best subtitle track from video.textTracks
   */
  private selectBestTextTrack(textTracks: TextTrackList): TextTrack | null {
    let bestTrack: TextTrack | null = null;
    let bestScore = -1;

    for (let i = 0; i < textTracks.length; i++) {
      const track = textTracks[i];
      if (!track.cues || track.cues.length === 0) continue;

      let score = 0;
      const cueCount = track.cues.length;
      score += Math.min(cueCount, 500);

      // Check if cues contain Chinese characters
      const hasZh = this.trackHasChinese(track);
      if (hasZh) {
        score += 1000;
      }

      // Showing mode bonus (user explicitly selected this track in Quark player)
      if (track.mode === 'showing') {
        score += 200;
      }

      // Label & language analysis
      const label = (track.label || '').toLowerCase();
      const lang = (track.language || '').toLowerCase();
      if (
        label.includes('zh') ||
        label.includes('chs') ||
        label.includes('cht') ||
        label.includes('双语') ||
        label.includes('中英') ||
        lang.startsWith('zh')
      ) {
        score += 300;
      }

      // Deduct score if explicitly marked as English only when we prefer bilingual
      if (label.endsWith('-en') || label.includes('eng') || lang.startsWith('en')) {
        if (!hasZh) {
          score -= 200;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestTrack = track;
      }
    }

    return bestTrack;
  }

  private trackHasChinese(track: TextTrack): boolean {
    if (!track.cues || track.cues.length === 0) return false;
    const checkCount = Math.min(track.cues.length, 30);
    for (let i = 0; i < checkCount; i++) {
      const cue = track.cues[i] as any;
      if (/[\u4e00-\u9fa5]/.test(cue.text || '')) {
        return true;
      }
    }
    if (track.cues.length > 30) {
      const mid = Math.floor(track.cues.length / 2);
      for (let i = mid; i < Math.min(track.cues.length, mid + 15); i++) {
        const cue = track.cues[i] as any;
        if (/[\u4e00-\u9fa5]/.test(cue.text || '')) {
          return true;
        }
      }
    }
    return false;
  }

  private getTrackSignature(track: TextTrack, hasZh: boolean): string {
    return `${track.label || ''}_${track.language || ''}_${track.cues?.length || 0}_${hasZh ? 'zh' : 'en'}`;
  }

  private convertTextTrackToCues(track: TextTrack) {
    if (!track.cues || track.cues.length === 0) return;

    const parsedCues: SubtitleCue[] = [];
    for (let i = 0; i < track.cues.length; i++) {
      const cue = track.cues[i] as any;
      const rawText = cue.text || '';
      const cleaned = rawText
        .replace(/<[^>]+>/g, '')
        .replace(/\{[^}]+\}/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();

      if (!isValidSubtitleText(cleaned)) continue;

      const lines = cleaned.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
      const { textEn, textZh } = splitBilingualLines(lines);

      parsedCues.push({
        id: i + 1,
        start: cue.startTime,
        end: cue.endTime,
        textEn: textEn || cleaned,
        textZh: textZh || ''
      });
    }

    if (parsedCues.length > 0) {
      console.log(
        `[VocabFrame] Extracted ${parsedCues.length} cues from best textTrack (${track.label || track.language || 'unnamed'})`
      );
      const title = track.language || track.label || '';
      if (title && (title.includes('.') || title.length > 3)) {
        useAppStore.getState().setVideoTitle(title);
      }
      useAppStore.getState().setCues(parsedCues);
      const vid = this.player.getVideoElement();
      const apiKey = (useAppStore.getState().settings?.apiKey || '').trim();
      if (apiKey) {
        bilingualTranslator.scheduleSlidingWindowTranslation(vid ? vid.currentTime : 0);
      }
    }
  }

  /**
   * 2. Live DOM Subtitle Container Sniffer
   */
  private sniffDomSubtitles() {
    // Specific subtitle containers only - DO NOT use generic [class*="subtitle"] which matches toolbars
    const targetSelectors = [
      '.v-subtitle',
      '.player-subtitle',
      '.v-caption-content',
      '.quark-subtitle-item',
      '.quark-player-subtitle',
      '.subtitle-item',
      '.v-danmaku-subtitle'
    ];

    const findSubtitleText = (): string | null => {
      for (const sel of targetSelectors) {
        const elements = document.querySelectorAll(sel);
        for (let i = 0; i < elements.length; i++) {
          const el = elements[i];
          if (!el) continue;

          // Never capture our own extension overlay
          if (el.closest('language-reactor-overlay')) continue;

          // Never capture toolbars, buttons, control bars, dialogs, menus, tips
          if (
            el.closest(
              'button, [role="button"], [class*="Toolbar"], [class*="toolbar"], [class*="Control"], [class*="control"], [class*="menu"], [class*="Menu"], [class*="dialog"], [class*="Dialog"], [class*="tips"], [class*="Tips"], [class*="setting"], [class*="Setting"], header, nav, footer'
            )
          ) {
            continue;
          }

          const rawText = el.textContent?.trim() || '';
          const text = rawText.replace(/<[^>]+>/g, '').trim();

          if (text && isValidSubtitleText(text)) {
            // Reject short single-word UI labels
            if (text.length <= 2 && !/[\u4e00-\u9fa5]/.test(text)) continue;
            return text;
          }
        }
      }
      return null;
    };

    this.domObserver = new MutationObserver(() => {
      const text = findSubtitleText();
      if (text && text !== this.lastCapturedText) {
        this.lastCapturedText = text;
        const video = this.player.getVideoElement();
        const currentTime = video ? video.currentTime : 0;
        this.handleLiveSubtitleText(text, currentTime);
      }
    });

    const playerContainer = document.querySelector('div[class*="player"], .video-container') || document.body;
    this.domObserver.observe(playerContainer, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  private handleLiveSubtitleText(rawText: string, currentTime: number) {
    if (!isValidSubtitleText(rawText)) return;

    const { cues, setCues } = useAppStore.getState();

    // If we already have full subtitle cues from track or file (more than 5 cues), do not corrupt with live DOM fragments
    if (cues.length > 5) return;

    const lines = rawText.split(/\n|<br\s*\/?>/i).map(l => l.trim()).filter(Boolean);
    const { textEn, textZh } = splitBilingualLines(lines);

    const existingIndex = cues.findIndex(
      c => Math.abs(c.start - currentTime) < 3.0 || c.textEn === textEn
    );

    if (existingIndex >= 0) {
      const updated = [...cues];
      updated[existingIndex] = {
        ...updated[existingIndex],
        textEn: textEn || updated[existingIndex].textEn,
        textZh: textZh || updated[existingIndex].textZh
      };
      setCues(updated);
    } else {
      const newCue: SubtitleCue = {
        id: cues.length + 1,
        start: Math.max(0, currentTime - 0.5),
        end: currentTime + 4.0,
        textEn: textEn || rawText,
        textZh: textZh || ''
      };
      const updated = [...cues, newCue].sort((a, b) => a.start - b.start);
      setCues(updated);
    }
  }

  /**
   * 3. Network Fetch & XHR Interceptor (Quark API only via Main World hook)
   */
  private sniffNetworkRequests() {
    if (typeof window === 'undefined') return;

    // 1. Listen for intercepted subtitles from Main World hook script
    this.messageListener = (event: MessageEvent) => {
      if (event.data && event.data.type === '__LR_SUBTITLE_INTERCEPTED__') {
        const { content, sourceUrl } = event.data;
        if (content && (content.includes('-->') || content.includes('WEBVTT') || content.includes('{\\'))) {
          const currentCues = useAppStore.getState().cues;
          const currentHasZh = currentCues.length > 5 && currentCues.some(c => c.textZh && /[\u4e00-\u9fa5]/.test(c.textZh));
          const newHasZh = /[\u4e00-\u9fa5]/.test(content);
          if (currentHasZh && !newHasZh) {
            console.log('[VocabFrame] Ignored intercepted monolingual subtitle to protect bilingual subtitles.');
            return;
          }
          console.log('[VocabFrame] Intercepted network subtitle via Main World hook:', sourceUrl);
          useAppStore.getState().loadSubtitleFileContent(content, '夸克在线字幕');
        }
      }
    };
    window.addEventListener('message', this.messageListener);

    // 2. Inject hook script into host page's MAIN world
    const hookCode = `
      (function() {
        if (window.__LR_QUARK_SNIFFER_INJECTED__) return;
        window.__LR_QUARK_SNIFFER_INJECTED__ = true;

        const isSubtitleUrl = function(u) {
          if (!u || typeof u !== 'string') return false;
          const low = u.toLowerCase();
          return low.includes('.vtt') || low.includes('.srt') || low.includes('.ass') || low.includes('subtitle') || low.includes('caption');
        };

        const checkAndDispatch = function(text, url) {
          if (text && (text.includes('-->') || text.includes('WEBVTT') || text.includes('{\\\\'))) {
            window.postMessage({
              type: '__LR_SUBTITLE_INTERCEPTED__',
              sourceUrl: url,
              content: text
            }, '*');
          }
        };

        // Hook window.fetch
        const origFetch = window.fetch;
        window.fetch = async function(...args) {
          const resp = await origFetch.apply(this, args);
          try {
            const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
            if (isSubtitleUrl(url)) {
              const clone = resp.clone();
              clone.text().then(function(txt) {
                checkAndDispatch(txt, url);
              }).catch(function() {});
            }
          } catch(_) {}
          return resp;
        };

        // Hook XMLHttpRequest
        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function(method, url) {
          this.__lr_url = url;
          return origOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function() {
          this.addEventListener('load', function() {
            try {
              if (isSubtitleUrl(this.__lr_url)) {
                checkAndDispatch(this.responseText, this.__lr_url);
              }
            } catch(_) {}
          });
          return origSend.apply(this, arguments);
        };
      })();
    `;

    try {
      const scriptEl = document.createElement('script');
      scriptEl.textContent = hookCode;
      (document.head || document.documentElement).appendChild(scriptEl);
      scriptEl.remove();
    } catch (err) {
      console.warn('[VocabFrame] Main World script injection deferred:', err);
    }
  }
}
