import { SubtitleCue } from '@/types';
import { parseSubtitleContent, splitBilingualLines, isValidSubtitleText } from '../subtitle/parser';
import { tokenizeSentence } from '../subtitle/tokenizer';
import { useAppStore } from '@/store/useAppStore';
import { VideoPlayerAdapter } from '../player/BaseAdapter';
import { bilingualTranslator } from '../ai/bilingualTranslator';

export interface BilibiliSubtitleItem {
  from: number;
  to: number;
  location?: number;
  content: string;
}

export interface BilibiliSubtitleData {
  font_size?: number;
  font_color?: string;
  background_alpha?: number;
  background_color?: string;
  Stroke?: string;
  body: BilibiliSubtitleItem[];
}

/**
 * Parse Bilibili official JSON subtitle format ({ body: [{ from, to, content }] }) into SubtitleCue[]
 */
export function parseBilibiliSubtitleJson(jsonOrStr: any): SubtitleCue[] {
  if (!jsonOrStr) return [];

  let data: BilibiliSubtitleData | null = null;
  if (typeof jsonOrStr === 'string') {
    try {
      data = JSON.parse(jsonOrStr);
    } catch (_) {
      return [];
    }
  } else if (typeof jsonOrStr === 'object' && jsonOrStr !== null) {
    data = jsonOrStr;
  }

  if (!data || !Array.isArray(data.body) || data.body.length === 0) {
    return [];
  }

  const cues: SubtitleCue[] = [];

  data.body.forEach((item, index) => {
    if (typeof item.from !== 'number' || typeof item.to !== 'number') return;
    const rawContent = (item.content || '').trim();
    if (!rawContent || !isValidSubtitleText(rawContent)) return;

    const lines = rawContent.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let textEn = '';
    let textZh = '';

    if (lines.length >= 2) {
      const split = splitBilingualLines(lines);
      textEn = split.textEn;
      textZh = split.textZh;
    } else {
      const single = lines[0] || rawContent;
      // Check if line contains Chinese characters
      const hasChinese = /[\u4e00-\u9fa5]/.test(single);
      const hasLatin = /[a-zA-Z]{2,}/.test(single);

      if (hasChinese && hasLatin) {
        // Mixed line: e.g. "Hello world 你好世界"
        const match = single.match(/^([A-Za-z0-9\s.,!?'"-]+)\s*([\u4e00-\u9fa5].*)$/);
        if (match) {
          textEn = match[1].trim();
          textZh = match[2].trim();
        } else {
          textEn = single;
          textZh = '';
        }
      } else if (hasChinese) {
        textZh = single;
        textEn = '';
      } else {
        textEn = single;
        textZh = '';
      }
    }

    const tokens = textEn ? tokenizeSentence(textEn) : (textZh ? tokenizeSentence(textZh) : []);

    cues.push({
      id: index + 1,
      start: item.from,
      end: Math.max(item.to, item.from + 0.5),
      textEn,
      textZh,
      tokens
    });
  });

  return cues.sort((a, b) => a.start - b.start);
}

/**
 * Bilibili Subtitle Sniffer
 * Implements the Four-Layer Subtitle Sniffing Architecture for Bilibili
 */
export class BilibiliSubtitleSniffer {
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
    if (typeof window === 'undefined' || !window.location) return;
    if (!window.location.hostname.includes('bilibili.com')) return;
    if (this.isSniffing) return;
    this.isSniffing = true;

    this.injectNativeSubtitleHider();

    this.sniffTextTracks();
    this.sniffDomSubtitles();
    this.sniffNetworkRequests();
    this.scanStaticPageData();

    console.log('[VocabFrame] Bilibili Subtitle Sniffer started.');
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
    this.removeNativeSubtitleHider();
    this.processedTrackUrls.clear();
    this.activeTrackSignature = '';
  }



  private injectNativeSubtitleHider() {
    if (typeof document === 'undefined' || !document || typeof document.getElementById !== 'function') return;
    const styleId = 'lr-bili-native-subtitle-hider';
    if (document.getElementById(styleId)) return;

    const styleEl = document.createElement('style');
    styleEl.id = styleId;
    styleEl.textContent = `
      .bpx-player-subtitle-panel-text,
      .bpx-player-subtitle-wrap,
      .bilibili-player-video-subtitle {
        opacity: 0 !important;
        pointer-events: none !important;
      }
    `;
    (document.head || document.documentElement)?.appendChild(styleEl);
  }

  private removeNativeSubtitleHider() {
    if (typeof document === 'undefined' || !document || typeof document.getElementById !== 'function') return;
    const styleEl = document.getElementById('lr-bili-native-subtitle-hider');
    if (styleEl) {
      styleEl.remove();
    }
  }

  /**
   * Layer 1 & 2: HTML5 TextTracks and dynamic <track> elements
   */
  private sniffTextTracks() {
    const checkTracks = () => {
      const video = this.player.getVideoElement();
      if (!video) return;

      const currentUrl = window.location.href;
      const currentSrc = video.currentSrc || video.src || '';

      // Route or video switch detection
      if ((this.lastUrl && this.lastUrl !== currentUrl) || (this.lastVideoSrc && this.lastVideoSrc !== currentSrc)) {
        this.processedTrackUrls.clear();
        this.lastCapturedText = '';
        this.activeTrackSignature = '';
        useAppStore.getState().setVideoTitle('');
        useAppStore.getState().setCues([]);
        this.scanStaticPageData();
        window.postMessage({ type: '__LR_TRIGGER_BILI_INSPECT__' }, '*');
      }
      this.lastUrl = currentUrl;
      this.lastVideoSrc = currentSrc;

      this.bindVideoElement(video);

      // 1. Inspect video.textTracks
      if (video.textTracks && video.textTracks.length > 0) {
        for (let i = 0; i < video.textTracks.length; i++) {
          const track = video.textTracks[i];
          if (track.mode === 'disabled') {
            try {
              track.mode = 'hidden';
            } catch (_) {}
          }
        }

        const bestTrack = this.selectBestTextTrack(video.textTracks);
        if (bestTrack && bestTrack.cues && bestTrack.cues.length > 0) {
          const currentCues = useAppStore.getState().cues;
          const currentHasZh = currentCues.length > 5 && currentCues.some(c => c.textZh && /[\u4e00-\u9fa5]/.test(c.textZh));
          const candidateHasZh = this.trackHasChinese(bestTrack);
          const candidateSignature = `bili-tt-${bestTrack.cues.length}-${bestTrack.language || ''}`;

          if (currentHasZh && !candidateHasZh) {
            // Keep existing bilingual track
          } else if (candidateSignature !== this.activeTrackSignature) {
            this.activeTrackSignature = candidateSignature;
            this.convertTextTrackToCues(bestTrack);
          }
        }
      }

      // 2. Check <track> tags
      const trackTags = video.querySelectorAll('track');
      trackTags.forEach(t => {
        const src = t.getAttribute('src');
        if (src && !this.processedTrackUrls.has(src)) {
          this.processedTrackUrls.add(src);
          this.fetchAndLoadTrack(src, t.getAttribute('label') || 'Bilibili Track');
        }
      });
    };

    checkTracks();
    this.textTrackInterval = setInterval(checkTracks, 1000);
  }

  private bindVideoElement(video: HTMLVideoElement) {
    if (this.boundVideos.has(video)) return;
    this.boundVideos.add(video);

    if (video.textTracks) {
      video.textTracks.addEventListener('addtrack', () => {
        setTimeout(() => {
          if (!this.isSniffing) return;
          const bestTrack = this.selectBestTextTrack(video.textTracks);
          if (bestTrack && bestTrack.cues && bestTrack.cues.length > 1) {
            this.convertTextTrackToCues(bestTrack);
          }
        }, 300);
      });
    }

    if (this.videoTrackObserver) {
      this.videoTrackObserver.disconnect();
    }
    this.videoTrackObserver = new MutationObserver(() => {
      const tracks = video.querySelectorAll('track');
      tracks.forEach(t => {
        const src = t.getAttribute('src');
        if (src && !this.processedTrackUrls.has(src)) {
          this.processedTrackUrls.add(src);
          this.fetchAndLoadTrack(src, t.getAttribute('label') || 'Bilibili Track');
        }
      });
    });
    this.videoTrackObserver.observe(video, { childList: true, subtree: false });
  }

  private selectBestTextTrack(textTracks: TextTrackList): TextTrack | null {
    let bestTrack: TextTrack | null = null;
    let maxCues = 0;

    for (let i = 0; i < textTracks.length; i++) {
      const track = textTracks[i];
      const count = track.cues ? track.cues.length : 0;
      if (count > maxCues) {
        maxCues = count;
        bestTrack = track;
      }
    }
    return bestTrack;
  }

  private trackHasChinese(track: TextTrack): boolean {
    if (!track.cues || track.cues.length === 0) return false;
    const sampleLimit = Math.min(track.cues.length, 10);
    for (let i = 0; i < sampleLimit; i++) {
      const cue = track.cues[i] as any;
      if (cue && cue.text && /[\u4e00-\u9fa5]/.test(cue.text)) {
        return true;
      }
    }
    return false;
  }

  private convertTextTrackToCues(track: TextTrack) {
    if (!track.cues || track.cues.length === 0) return;

    const cues: SubtitleCue[] = [];
    for (let i = 0; i < track.cues.length; i++) {
      const cue = track.cues[i] as any;
      if (!cue || typeof cue.startTime !== 'number') continue;

      const rawText = (cue.text || '').trim();
      if (!rawText || !isValidSubtitleText(rawText)) continue;

      const lines = rawText.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
      const { textEn, textZh } = splitBilingualLines(lines);

      cues.push({
        id: i + 1,
        start: cue.startTime,
        end: cue.endTime,
        textEn,
        textZh,
        tokens: textEn ? tokenizeSentence(textEn) : (textZh ? tokenizeSentence(textZh) : [])
      });
    }

    if (cues.length > 0) {
      useAppStore.getState().setCues(cues);
      console.log(`[VocabFrame] Loaded ${cues.length} cues from Bilibili TextTrack.`);
    }
  }

  private async fetchAndLoadTrack(src: string, label: string) {
    try {
      const resp = await fetch(src);
      if (!resp.ok) return;
      const text = await resp.text();
      if (!text) return;

      if (text.trim().startsWith('{') || src.includes('.json')) {
        const parsed = parseBilibiliSubtitleJson(text);
        if (parsed.length > 0) {
          useAppStore.getState().setCues(parsed);
          console.log(`[VocabFrame] Loaded ${parsed.length} cues from Bilibili Subtitle JSON.`);
          return;
        }
      }

      const cues = parseSubtitleContent(text);
      if (cues.length > 0) {
        useAppStore.getState().loadSubtitleFileContent(text, label);
      }
    } catch (_) {}
  }

  /**
   * Layer 3: Scan static page script / JSON data for preloaded subtitles
   */
  private getInitialState(): any {
    try {
      const win = window as any;
      if (win.__INITIAL_STATE__) return win.__INITIAL_STATE__;

      // In isolated world, parse __INITIAL_STATE__ from DOM <script> tags
      if (typeof document !== 'undefined') {
        const scripts = document.querySelectorAll('script');
        for (let i = 0; i < scripts.length; i++) {
          const text = scripts[i].textContent || '';
          if (text.includes('__INITIAL_STATE__')) {
            const match = text.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/);
            if (match && match[1]) {
              try {
                return JSON.parse(match[1]);
              } catch (_) {}
            }
          }
        }
      }
    } catch (_) {}
    return null;
  }

  public async scanStaticPageData() {
    try {
      const state = this.getInitialState();
      let curP = 1;
      try {
        const sp = new URLSearchParams(window.location.search);
        curP = parseInt(sp.get('p') || '1', 10) || 1;
      } catch (_) {}

      if (state && state.videoData) {
        const bvid = state.videoData.bvid || state.bvid;
        const pages = state.videoData.pages;
        let targetCid = state.videoData.cid;

        if (Array.isArray(pages) && pages.length > 0) {
          const matchedPage = pages.find((pg: any) => pg.page === curP) || pages[curP - 1] || pages[0];
          if (matchedPage?.cid) {
            targetCid = matchedPage.cid;
          }
        }

        // If P1 and subtitles are already present in initial state
        if (curP === 1 && state.videoData.subtitle?.subtitles) {
          const subs = state.videoData.subtitle.subtitles;
          if (Array.isArray(subs) && subs.length > 0) {
            await this.handleSubtitlesArray(subs);
            return;
          }
        }

        // For multi-P (e.g. ?p=2) or when subtitles not in initial state, query player API with targetCid
        if (targetCid && bvid) {
          try {
            const resp = await fetch(`https://api.bilibili.com/x/player/v2?cid=${targetCid}&bvid=${bvid}`);
            if (resp.ok) {
              const data = await resp.json();
              const subs = data?.data?.subtitle?.subtitles;
              if (Array.isArray(subs) && subs.length > 0) {
                await this.handleSubtitlesArray(subs);
                return;
              }
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  private async handleSubtitlesArray(subs: any[]) {
    if (!Array.isArray(subs) || subs.length === 0) return;

    const enSub = subs.find((s: any) =>
      s.lan?.toLowerCase().includes('en') ||
      s.lan_doc?.includes('英') ||
      s.lan_doc?.toLowerCase().includes('english')
    );
    const zhSub = subs.find((s: any) =>
      s.lan?.toLowerCase().includes('zh') ||
      s.lan_doc?.includes('中')
    );

    if (enSub && zhSub && enSub !== zhSub) {
      await this.fetchAndMergeDualTracks(enSub, zhSub);
    } else {
      const bestSub = enSub || zhSub || subs[0];
      const subUrl = bestSub.subtitle_url;
      if (subUrl && !this.processedTrackUrls.has(subUrl)) {
        this.processedTrackUrls.add(subUrl);
        const fullUrl = subUrl.startsWith('//') ? `https:${subUrl}` : subUrl;
        await this.fetchAndLoadTrack(fullUrl, bestSub.lan_doc || 'Bilibili Subtitle');
      }
    }
  }

  private async fetchAndMergeDualTracks(enSub: any, zhSub: any) {
    try {
      const enUrl = enSub.subtitle_url?.startsWith('//') ? `https:${enSub.subtitle_url}` : enSub.subtitle_url;
      const zhUrl = zhSub.subtitle_url?.startsWith('//') ? `https:${zhSub.subtitle_url}` : zhSub.subtitle_url;

      if (!enUrl || !zhUrl) return;
      this.processedTrackUrls.add(enSub.subtitle_url);
      this.processedTrackUrls.add(zhSub.subtitle_url);

      const [respEn, respZh] = await Promise.all([fetch(enUrl), fetch(zhUrl)]);
      if (!respEn.ok) {
        if (respZh.ok) {
          const zhText = await respZh.text();
          const parsed = parseBilibiliSubtitleJson(zhText);
          if (parsed.length > 0) useAppStore.getState().setCues(parsed);
        }
        return;
      }

      const enText = await respEn.text();
      const enCues = parseBilibiliSubtitleJson(enText);
      if (enCues.length === 0) return;

      if (respZh.ok) {
        const zhText = await respZh.text();
        const zhCues = parseBilibiliSubtitleJson(zhText);
        if (zhCues.length > 0) {
          for (const enCue of enCues) {
            const match = zhCues.find(zh =>
              Math.max(enCue.start, zh.start) < Math.min(enCue.end, zh.end) ||
              Math.abs(zh.start - enCue.start) < 0.8
            );
            if (match) {
              enCue.textZh = match.textZh || match.textEn;
            }
          }
        }
      }

      useAppStore.getState().setCues(enCues);
      console.log(`[VocabFrame] Loaded and merged dual-track subtitles (${enCues.length} cues) from Bilibili.`);
    } catch (_) {
      if (enSub.subtitle_url) {
        const fullUrl = enSub.subtitle_url.startsWith('//') ? `https:${enSub.subtitle_url}` : enSub.subtitle_url;
        this.fetchAndLoadTrack(fullUrl, enSub.lan_doc || 'Bilibili Subtitle');
      }
    }
  }

  /**
   * Layer 4: Real-time DOM subtitle fallback
   */
  private sniffDomSubtitles() {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;

    const captureDomSubtitle = () => {
      // Only use DOM fallback if full track is not yet loaded
      if (useAppStore.getState().cues.length > 5) return;

      const video = this.player.getVideoElement();
      if (!video) return;

      const panelTexts = Array.from(document.querySelectorAll<HTMLElement>('.bpx-player-subtitle-panel-text, .bilibili-player-video-subtitle'));
      if (panelTexts.length > 0) {
        // Filter out non-subtitle elements (buttons, toolbar, control, dm)
        const validElements = panelTexts.filter(el =>
          !el.closest('button, [role="button"], [class*="Toolbar"], [class*="toolbar"], [class*="Control"], [class*="control"], [class*="menu"], [class*="setting"], [class*="tips"], [class*="dm"]')
        );

        if (validElements.length >= 2) {
          const line1 = (validElements[0].textContent || '').trim();
          const line2 = (validElements[1].textContent || '').trim();
          const combined = `${line1}\n${line2}`;
          if (combined && combined !== this.lastCapturedText && (isValidSubtitleText(line1) || isValidSubtitleText(line2))) {
            this.lastCapturedText = combined;
            const { textEn, textZh } = splitBilingualLines([line1, line2]);
            const curTime = video.currentTime;
            const newCue: SubtitleCue = {
              id: Date.now(),
              start: curTime,
              end: curTime + 3.0,
              textEn,
              textZh,
              tokens: textEn ? tokenizeSentence(textEn) : (textZh ? tokenizeSentence(textZh) : [])
            };
            const existing = [...useAppStore.getState().cues];
            existing.push(newCue);
            useAppStore.getState().setCues(existing);
            return;
          }
        } else if (validElements.length === 1) {
          const rawText = (validElements[0].textContent || '').trim();
          if (rawText && rawText !== this.lastCapturedText && isValidSubtitleText(rawText)) {
            this.lastCapturedText = rawText;
            const curTime = video.currentTime;
            const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            const { textEn, textZh } = splitBilingualLines(lines);
            const newCue: SubtitleCue = {
              id: Date.now(),
              start: curTime,
              end: curTime + 3.0,
              textEn,
              textZh,
              tokens: textEn ? tokenizeSentence(textEn) : (textZh ? tokenizeSentence(textZh) : [])
            };
            const existing = [...useAppStore.getState().cues];
            existing.push(newCue);
            useAppStore.getState().setCues(existing);
            return;
          }
        }
      }
    };

    this.domObserver = new MutationObserver(() => {
      captureDomSubtitle();
    });

    const target = (typeof document.querySelector === 'function' ? document.querySelector('.bpx-player-container, #bilibili-player') : null) || document.body;
    if (target && typeof this.domObserver.observe === 'function') {
      this.domObserver.observe(target, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }
  }

  /**
   * Listen for window messages from possible network hooks
   */
  private sniffNetworkRequests() {
    this.messageListener = (e: MessageEvent) => {
      if (!e.data) return;
      if (e.data.type === '__LR_BILI_SUBTITLE__') {
        const content = e.data.content;
        if (content) {
          const cues = parseBilibiliSubtitleJson(content);
          if (cues.length > 0) {
            useAppStore.getState().setCues(cues);
          }
        }
      } else if (e.data.type === '__LR_TRIGGER_BILI_INSPECT__') {
        this.scanStaticPageData();
        this.sniffTextTracks();
      }
    };
    window.addEventListener('message', this.messageListener);
  }
}
