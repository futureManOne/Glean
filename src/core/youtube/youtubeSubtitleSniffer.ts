import { SubtitleCue } from '@/types';
import { useAppStore } from '@/store/useAppStore';
import { VideoPlayerAdapter } from '../player/BaseAdapter';
import {
  isValidSubtitleText,
  decodeHtmlEntities,
  parseYouTubeJson3,
  parseYouTubeXml,
  parseSubtitleContent,
  stripRollingOverlap,
  sanitizeCues,
  cleanPunctuationSpacing,
  cleanLiveCaptionGarbage,
  mergeYouTubeAsrCues,
  assembleLongAsrSentences,
  assembleConciseAsrCues,
  splitLongCueSemantically,
  alignBilingualJson3Events
} from '../subtitle/parser';
import { isYouTubeAdPlaying, detectPageVideoTitle } from './titleSanitizer';
import { bilingualTranslator } from '../ai/bilingualTranslator';
import { semanticSegmenter } from '../ai/semanticSegmenter';

export {
  isValidSubtitleText,
  parseYouTubeJson3,
  parseYouTubeXml,
  stripRollingOverlap,
  sanitizeCues,
  cleanPunctuationSpacing,
  cleanLiveCaptionGarbage,
  mergeYouTubeAsrCues,
  assembleLongAsrSentences,
  assembleConciseAsrCues,
  splitLongCueSemantically,
  alignBilingualJson3Events,
  isYouTubeAdPlaying,
  detectPageVideoTitle
};

export function extractYouTubeVideoId(urlStr: string): string {
  if (!urlStr) return '';
  try {
    const url = new URL(urlStr);
    if (url.searchParams.has('v')) {
      return url.searchParams.get('v') || '';
    }
    const matchShorts = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
    if (matchShorts) return matchShorts[1];
    const matchEmbed = url.pathname.match(/\/embed\/([a-zA-Z0-9_-]+)/);
    if (matchEmbed) return matchEmbed[1];
    return url.pathname;
  } catch {
    const vMatch = urlStr.match(/[?&]v=([a-zA-Z0-9_-]+)/);
    if (vMatch) return vMatch[1];
    return urlStr;
  }
}

/**
 * YouTube Subtitle Sniffer
 *
 * Implements a robust multi-layer sniffing strategy:
 * 1. Layer 1/2: Proactive page context inspection (captionTracks / timedtext?fmt=json3)
 *    and Main World fetch/XHR interception to load official full non-overlapping transcripts.
 * 2. Layer 3: HTML5 native TextTrack inspection for full cues or cuechange.
 * 3. Layer 4: Resilient live DOM caption fallback targeting only leaf elements
 *    with Rollup ASR prefix matching, debounce, and non-overlapping turn protection.
 * 4. Ad-Aware Subtitle Display & Post-Ad Lifecycle Transition (R2 & R3).
 */
export class YouTubeSubtitleSniffer {
  private player: VideoPlayerAdapter;
  private isSniffing = false;
  private domObserver: MutationObserver | null = null;
  private videoTrackObserver: MutationObserver | null = null;
  private messageListener: ((e: MessageEvent) => void) | null = null;
  private addTrackListener: (() => void) | null = null;
  private observedTracks: TextTrack[] = [];
  private processedTrackUrls = new Set<string>();
  private checkInterval: any = null;
  private liveCaptionTimeout: any = null;
  private pendingCues: SubtitleCue[] | null = null;
  private lastCapturedText = '';
  private lastUrl = '';
  private hasOfficialSubtitles = false;
  private isLiveCaptionActive = false;

  // Advertisement Lifecycle Management (R2 & R3)
  private isAdCurrentlyPlaying = false;
  private lastAdCurrentTime = 0;
  private lastAdBadgeText = '';
  private cachedMainVideoCues: SubtitleCue[] | null = null;
  private cachedMainVideoTitle = '';
  private cachedMainVideoId = '';
  private ytNavigateListener: (() => void) | null = null;

  constructor(player: VideoPlayerAdapter) {
    this.player = player;
    if (typeof window !== 'undefined') {
      try {
        useAppStore.subscribe((state) => {
          if (state.cues && state.cues.length > 0) {
            const hasRefined = state.cues.some(c => c.isAiRefined || c.isMixedRefined || c.mixedPhrases !== undefined);
            if (hasRefined) {
              const href = (typeof window !== 'undefined' && window.location?.href) ? window.location.href : '';
              const curVid = href ? extractYouTubeVideoId(href) : '';
              const storeVid = state.currentVideoId;
              if (curVid && (storeVid === curVid || !storeVid) && (!this.cachedMainVideoId || this.cachedMainVideoId === curVid)) {
                this.cachedMainVideoCues = state.cues;
                this.cachedMainVideoId = curVid;
              }
            }
          }
        });
      } catch (_) {}
    }
  }

  public handleVideoSwitch(newVideoId: string): void {
    if (!newVideoId) return;
    if (this.cachedMainVideoId === newVideoId && this.hasOfficialSubtitles && useAppStore.getState().cues.length > 0) {
      return;
    }

    console.log(`[VocabFrame] YouTube video switch detected: "${this.cachedMainVideoId}" -> "${newVideoId}". Resetting sniffer.`);
    this.hasOfficialSubtitles = false;
    this.isLiveCaptionActive = false;
    this.isAdCurrentlyPlaying = false;
    this.cachedMainVideoCues = null;
    this.cachedMainVideoId = newVideoId;
    this.cachedMainVideoTitle = '';
    this.lastCapturedText = '';
    this.lastAdCurrentTime = 0;
    this.lastAdBadgeText = '';
    if (this.liveCaptionTimeout) {
      clearTimeout(this.liveCaptionTimeout);
      this.liveCaptionTimeout = null;
    }
    for (const tr of this.observedTracks) {
      try {
        tr.oncuechange = null;
      } catch (_) {}
    }
    this.observedTracks = [];
    this.processedTrackUrls.clear();
    this.pendingCues = null;

    useAppStore.getState().setIsAdPlaying?.(false);
    useAppStore.getState().setVideoId(newVideoId);
    useAppStore.getState().setCues([]);
    useAppStore.getState().setVideoTitle('');
    bilingualTranslator.reset();

    if (typeof window !== 'undefined') {
      window.postMessage({ type: '__LR_TRIGGER_YT_INSPECT__' }, '*');
    }

    setTimeout(() => {
      if (this.cachedMainVideoId === newVideoId && !this.hasOfficialSubtitles) {
        this.prefetchFullVideoSubtitles();
      }
    }, 300);
  }

  public syncCachedCues(cues: SubtitleCue[]): void {
    if (cues && cues.length > 0) {
      this.cachedMainVideoCues = cues;
    }
  }

  private injectNativeCaptionHiderStyle() {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function' || typeof document.createElement !== 'function') return;
    const styleId = '__lr_yt_hide_native_captions__';
    if (document.getElementById(styleId)) return;

    const styleEl = document.createElement('style');
    styleEl.id = styleId;
    styleEl.textContent = `
      #movie_player .caption-window,
      #movie_player .ytp-caption-window-bottom,
      #movie_player .ytp-caption-window-rollup,
      .html5-video-player .caption-window,
      .html5-video-player .ytp-caption-window-bottom,
      .html5-video-player .ytp-caption-window-rollup {
        display: none !important;
        opacity: 0 !important;
        pointer-events: none !important;
        visibility: hidden !important;
      }
    `;
    const parent = document.head || document.documentElement;
    if (parent && typeof parent.appendChild === 'function') {
      parent.appendChild(styleEl);
    }
  }

  private removeNativeCaptionHiderStyle() {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    const styleEl = document.getElementById('__lr_yt_hide_native_captions__');
    if (styleEl && typeof styleEl.remove === 'function') {
      styleEl.remove();
    }
  }

  /**
   * Determine if newly arrived cues should be accepted even if current cues have AI refinement.
   * Prevents state deadlock where an initial incomplete/buffered track (e.g. first 10 minutes)
   * blocks the authoritative full-video transcript (e.g. 24 minutes).
   */
  private shouldAcceptNewCues(newCues: SubtitleCue[], currentCues: SubtitleCue[]): boolean {
    if (!currentCues || currentCues.length === 0) return true;
    if (newCues.length > currentCues.length + 2) return true;
    const curMaxEnd = currentCues[currentCues.length - 1]?.end || 0;
    const newMaxEnd = newCues[newCues.length - 1]?.end || 0;
    if (newMaxEnd > curMaxEnd + 15) return true;
    return false;
  }

  /**
   * Asynchronously enhances local ASR cues with complete semantic sentences and hot-swaps them into store.
   */
  private enhanceCuesWithAi(cues: SubtitleCue[]) {
    if (!semanticSegmenter.canSegment() || !cues || cues.length <= 1) return;
    if (cues.some(c => c.isAiRefined || c.isMixedRefined) || useAppStore.getState().cues.some(c => c.isAiRefined || c.isMixedRefined)) return;
    const isAsr = cues.some(c => !/[.?!。？！]$/.test((c.textEn || c.textZh || '').trim()) && (c.end - c.start) < 4.0);
    if (!isAsr && cues.length > 5) return;

    const targetVideoId = this.cachedMainVideoId;

    semanticSegmenter.segmentTranscript(cues).then(enhanced => {
      if (!enhanced || enhanced.length === 0) return;
      // Guard against race condition if user navigated to a different video
      if (targetVideoId && this.cachedMainVideoId && this.cachedMainVideoId !== targetVideoId) return;

      this.cachedMainVideoCues = enhanced;
      if (this.isAdCurrentlyPlaying) {
        // If ad is playing, do not overwrite ad caption UI; cues are cached for post-ad restore
        return;
      }

      useAppStore.getState().setCues(enhanced);
      const vid = this.player.getVideoElement();
      bilingualTranslator.scheduleSlidingWindowTranslation(vid ? vid.currentTime : 0);
    }).catch(err => {
      console.warn('[YouTubeSubtitleSniffer] AI segmentation error:', err);
    });
  }

  /**
   * Pre-fetch full video subtitles upfront like Language Reactor.
   * Multi-channel extraction:
   * 1. Inspects DOM <script> tags for static captionTracks
   * 2. Triggers Main World inspection via __LR_TRIGGER_YT_INSPECT__
   * 3. Retries as YouTube hydrates and player initializes
   */
  public async prefetchFullVideoSubtitles(retryCount = 0): Promise<boolean> {
    if (typeof window === 'undefined' || typeof document === 'undefined') return false;

    const curVid = extractYouTubeVideoId(window.location.href);
    if (!curVid) return false;

    if (this.cachedMainVideoId && this.cachedMainVideoId !== curVid) {
      this.handleVideoSwitch(curVid);
    }

    const currentCues = useAppStore.getState().cues;
    const vidEl = this.player.getVideoElement();
    const duration = vidEl?.duration || (this.player.getDuration ? this.player.getDuration() : 0) || 0;
    const isDurationTruncated = duration > 120 && currentCues.length > 0 && currentCues[currentCues.length - 1].end < duration - 60;

    if (this.hasOfficialSubtitles && this.cachedMainVideoId === curVid && currentCues.length > 0 && !isDurationTruncated) {
      return true;
    }

    // If an ad is currently playing on YouTube, schedule a delayed retry instead of aborting permanently
    if (this.isAdCurrentlyPlaying || isYouTubeAdPlaying()) {
      if (retryCount < 10 && !this.hasOfficialSubtitles) {
        setTimeout(() => {
          if (!this.hasOfficialSubtitles) {
            this.prefetchFullVideoSubtitles(retryCount + 1);
          }
        }, 1200);
      }
      return false;
    }

    console.log(`[VocabFrame] Prefetching full subtitles upfront for ${curVid} (attempt ${retryCount + 1})...`);

    // 1. Try extracting caption tracks directly from DOM static <script> tags matching curVid
    const tracks = this.extractCaptionTracksFromDom(curVid);
    if (tracks && tracks.length > 0) {
      const success = await this.loadTracksUpfront(tracks, curVid);
      if (success) return true;
    }

    // 2. Trigger Main World inspection via postMessage
    const uiLang = useAppStore.getState().settings?.uiLanguage || 'zh-CN';
    const targetLang = uiLang === 'ja' ? 'ja' : (uiLang === 'en' ? 'en' : 'zh-Hans');
    window.postMessage({ type: '__LR_TRIGGER_YT_INSPECT__', targetLang, videoId: curVid }, '*');

    // 3. Retry if needed (e.g. while YouTube hydrates or player initializes)
    if (retryCount < 6 && !this.hasOfficialSubtitles) {
      setTimeout(() => {
        if (!this.hasOfficialSubtitles && !this.isAdCurrentlyPlaying && extractYouTubeVideoId(window.location.href) === curVid) {
          this.prefetchFullVideoSubtitles(retryCount + 1);
        }
      }, (retryCount + 1) * 800);
    }

    return false;
  }

  /**
   * Extract captionTracks array directly from DOM <script> tags without running inline scripts.
   * Uses balanced bracket parsing to avoid syntax errors with nested arrays/objects in JSON.
   */
  public extractCaptionTracksFromDom(curVid?: string): Array<{ baseUrl: string; languageCode?: string; kind?: string; name?: any; vssId?: string }> | null {
    if (typeof document === 'undefined') return null;
    try {
      const scripts = Array.from(document.querySelectorAll('script'));
      for (const s of scripts) {
        const text = s.textContent || '';
        if (!text.includes('captionTracks')) continue;

        const key = '"captionTracks":';
        let pos = 0;
        while ((pos = text.indexOf(key, pos)) !== -1) {
          const start = text.indexOf('[', pos);
          if (start === -1) {
            pos += key.length;
            continue;
          }
          let depth = 0;
          let inString = false;
          let escape = false;
          for (let i = start; i < text.length; i++) {
            const ch = text[i];
            if (escape) {
              escape = false;
              continue;
            }
            if (ch === '\\') {
              escape = true;
              continue;
            }
            if (ch === '"') {
              inString = !inString;
              continue;
            }
            if (!inString) {
              if (ch === '[') depth++;
              else if (ch === ']') {
                depth--;
                if (depth === 0) {
                  const jsonStr = text.slice(start, i + 1);
                  try {
                    const parsed = JSON.parse(jsonStr);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                      if (curVid) {
                        const matching = parsed.filter((t: any) => {
                          const raw = t.baseUrl || t.url || '';
                          const trackVid = extractYouTubeVideoId(raw);
                          return !trackVid || trackVid === curVid;
                        });
                        if (matching.length > 0) return matching;
                      } else {
                        return parsed;
                      }
                    }
                  } catch (_) {}
                  break;
                }
              }
            }
          }
          pos += key.length;
        }

        // Alternative match for full ytInitialPlayerResponse using balanced brace matching
        const initKey = 'ytInitialPlayerResponse';
        const initPos = text.indexOf(initKey);
        if (initPos !== -1) {
          const objStart = text.indexOf('{', initPos);
          if (objStart !== -1) {
            let depth = 0;
            let inString = false;
            let escape = false;
            for (let i = objStart; i < text.length; i++) {
              const ch = text[i];
              if (escape) {
                escape = false;
                continue;
              }
              if (ch === '\\') {
                escape = true;
                continue;
              }
              if (ch === '"') {
                inString = !inString;
                continue;
              }
              if (!inString) {
                if (ch === '{') depth++;
                else if (ch === '}') {
                  depth--;
                  if (depth === 0) {
                    const jsonStr = text.slice(objStart, i + 1);
                    try {
                      const data = JSON.parse(jsonStr);
                      const ct = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
                      const initVid = data?.videoDetails?.videoId;
                      if (Array.isArray(ct) && ct.length > 0) {
                        if (curVid && initVid && initVid !== curVid) {
                          // Ignore captionTracks belonging to a different video in static script
                        } else if (curVid) {
                          const matching = ct.filter((t: any) => {
                            const raw = t.baseUrl || t.url || '';
                            const trackVid = extractYouTubeVideoId(raw);
                            return !trackVid || trackVid === curVid;
                          });
                          if (matching.length > 0) return matching;
                        } else {
                          return ct;
                        }
                      }
                    } catch (_) {}
                    break;
                  }
                }
              }
            }
          }
        }
      }
    } catch (_) {}
    return null;
  }

  /**
   * Fetch and assemble complete full-video subtitles from caption tracks
   */
  public async loadTracksUpfront(tracks: any[], videoId: string): Promise<boolean> {
    if (!Array.isArray(tracks) || tracks.length === 0 || !videoId) return false;

    // Filter tracks to ensure they match videoId if URL contains a video id
    const matchingTracks = tracks.filter(t => {
      const raw = t.baseUrl || t.url || '';
      if (!raw) return false;
      const trackVid = extractYouTubeVideoId(raw);
      return !trackVid || trackVid === videoId;
    });
    if (matchingTracks.length === 0) return false;

    // Pick best track: preferred English manual, then English ASR, then any English, then non-ASR non-Chinese, then fallback
    let chosen = matchingTracks.find(t => {
      const vss = ((t.vssId || t.vss_id) || '').toLowerCase();
      const lang = (t.languageCode || '').toLowerCase();
      return (lang === 'en' || lang.startsWith('en-') || vss === '.en' || vss.startsWith('.en.')) && t.kind !== 'asr' && (t.baseUrl || t.url);
    });
    if (!chosen) {
      chosen = matchingTracks.find(t => {
        const vss = ((t.vssId || t.vss_id) || '').toLowerCase();
        const lang = (t.languageCode || '').toLowerCase();
        return (lang === 'en' || lang.startsWith('en-') || vss === 'a.en' || vss.includes('en')) && t.kind === 'asr' && (t.baseUrl || t.url);
      });
    }
    if (!chosen) {
      chosen = matchingTracks.find(t => {
        const vss = ((t.vssId || t.vss_id) || '').toLowerCase();
        const lang = (t.languageCode || '').toLowerCase();
        return (lang === 'en' || lang.startsWith('en-') || vss.includes('en')) && (t.baseUrl || t.url);
      });
    }
    if (!chosen) {
      chosen = matchingTracks.find(t => {
        const vss = ((t.vssId || t.vss_id) || '').toLowerCase();
        const lang = (t.languageCode || '').toLowerCase();
        return t.kind !== 'asr' && !lang.startsWith('zh') && !vss.includes('zh') && (t.baseUrl || t.url);
      });
    }
    if (!chosen) {
      chosen = matchingTracks.find(t => {
        const vss = ((t.vssId || t.vss_id) || '').toLowerCase();
        const lang = (t.languageCode || '').toLowerCase();
        return !lang.startsWith('zh') && !vss.includes('zh') && (t.baseUrl || t.url);
      });
    }
    if (!chosen) {
      chosen = matchingTracks.find(t => t.baseUrl || t.url) || matchingTracks[0];
    }

    const previousVideoId = this.cachedMainVideoId;
    if (previousVideoId && previousVideoId !== videoId) {
      this.handleVideoSwitch(videoId);
    }

    const rawUrl = chosen?.baseUrl || chosen?.url;
    if (!rawUrl) return false;

    const settings = useAppStore.getState().settings;
    const chosenLang = ((chosen?.languageCode || '') as string).toLowerCase();
    const chosenVss = (((chosen?.vssId || chosen?.vss_id) || '') as string).toLowerCase();
    const isSourceChinese = chosenLang.startsWith('zh') || chosenVss.includes('zh');

    let targetLang = 'zh-Hans';
    if (isSourceChinese) {
      targetLang = (settings?.secondaryLang && settings.secondaryLang !== 'auto' && !settings.secondaryLang.startsWith('zh'))
        ? (settings.secondaryLang === 'zh-TW' ? 'zh-Hant' : settings.secondaryLang)
        : 'en';
    } else {
      const sec = settings?.secondaryLang || 'auto';
      if (sec === 'ja' || (!settings?.secondaryLang && settings?.uiLanguage === 'ja')) targetLang = 'ja';
      else if (sec === 'en') targetLang = 'en';
      else if (sec === 'zh-TW') targetLang = 'zh-Hant';
      else targetLang = 'zh-Hans';
    }

    let json3Url = '';
    let transUrl = '';
    try {
      const u = new URL(rawUrl, window.location.origin);
      u.searchParams.set('fmt', 'json3');
      u.searchParams.delete('tlang');
      json3Url = u.toString();
      u.searchParams.set('tlang', targetLang);
      transUrl = u.toString();
    } catch (_) {
      const clean = rawUrl.replace(/[?&]fmt=[^&]+/, '').replace(/[?&]tlang=[^&]+/, '');
      const sep = clean.includes('?') ? '&' : '?';
      json3Url = `${clean}${sep}fmt=json3`;
      transUrl = `${json3Url}&tlang=${targetLang}`;
    }

    try {
      const [origRes, transRes] = await Promise.all([
        fetch(json3Url, { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(transUrl, { credentials: 'same-origin' })
          .then(r => r.ok ? r.json() : null)
          .then(d => d || (targetLang === 'zh-Hans' ? fetch(transUrl.replace('tlang=zh-Hans', 'tlang=zh'), { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).catch(() => null) : null))
          .catch(() => null)
      ]);

      if (origRes && Array.isArray(origRes.events) && origRes.events.length > 0) {
        let parsed = parseYouTubeJson3(origRes, transRes);
        if (parsed.length > 2) {
          parsed = assembleLongAsrSentences(parsed);
        }

        if (parsed.length > 0) {
          const storeVid = useAppStore.getState().currentVideoId;
          const currentCues = useAppStore.getState().cues;
          const isSameVideo = (previousVideoId === videoId || this.cachedMainVideoId === videoId) && (!storeVid || storeVid === videoId);
          const hasAiRefinedCues = isSameVideo && currentCues.length > 0 && currentCues.some(c => c.isAiRefined || c.isMixedRefined || c.mixedPhrases !== undefined || c.tokens?.some(t => t.isKeyPhrase));
          const isIncomingSubstantiallyBigger = this.shouldAcceptNewCues(parsed, currentCues);
          if (hasAiRefinedCues && !isIncomingSubstantiallyBigger) {
            console.log('[VocabFrame] Preserving existing AI-refined subtitles, keeping them in loadTracksUpfront.');
            this.cachedMainVideoId = videoId;
            return true;
          }

          console.log(`[VocabFrame] Upfront preloaded ${parsed.length} full video cues for ${videoId}!`);
          this.hasOfficialSubtitles = true;
          this.isLiveCaptionActive = false;
          this.cachedMainVideoCues = parsed;
          this.cachedMainVideoId = videoId;

          const title = detectPageVideoTitle();
          if (title) {
            useAppStore.getState().setVideoTitle(title);
            this.cachedMainVideoTitle = title;
          }

          useAppStore.getState().setVideoId(videoId);
          useAppStore.getState().setCues(parsed, videoId);
          this.cachedMainVideoCues = useAppStore.getState().cues;
          this.enhanceCuesWithAi(parsed);

          // Trigger AI sliding window translation if any cues lack translation or have duplicate echo
          const hasMissingTranslation = parsed.some(c => (!c.textZh || c.textZh.trim() === c.textEn.trim()) && Boolean(c.textEn) && isValidSubtitleText(c.textEn));
          if (hasMissingTranslation && parsed.length > 0) {
            const vid = this.player.getVideoElement();
            bilingualTranslator.scheduleSlidingWindowTranslation(vid ? vid.currentTime : 0);
          }
          return true;
        }
      } else {
        // Fallback: fetch rawUrl directly (SRT/VTT/XML)
        const rawTxt = await fetch(rawUrl, { credentials: 'same-origin' }).then(r => r.ok ? r.text() : '').catch(() => '');
        if (rawTxt) {
          let parsed: SubtitleCue[] = [];
          if (rawTxt.includes('WEBVTT') || rawUrl.includes('fmt=vtt')) {
            parsed = parseSubtitleContent(rawTxt);
          } else if (rawTxt.includes('<transcript') || rawTxt.includes('<timedtext')) {
            parsed = parseYouTubeXml(rawTxt);
          }
          if (parsed.length > 0) {
            if (parsed.length > 2) {
              parsed = assembleLongAsrSentences(parsed);
            }
            const storeVid = useAppStore.getState().currentVideoId;
            const currentCues = useAppStore.getState().cues;
            const isSameVideo = (previousVideoId === videoId || this.cachedMainVideoId === videoId) && (!storeVid || storeVid === videoId);
            const hasAiRefinedCues = isSameVideo && currentCues.length > 0 && currentCues.some(c => c.isAiRefined || c.isMixedRefined || c.mixedPhrases !== undefined || c.tokens?.some(t => t.isKeyPhrase));
            const isIncomingSubstantiallyBigger = this.shouldAcceptNewCues(parsed, currentCues);
            if (hasAiRefinedCues && !isIncomingSubstantiallyBigger) {
              console.log('[VocabFrame] Preserving existing AI-refined subtitles, keeping them in loadTracksUpfront raw URL cues.');
              this.cachedMainVideoId = videoId;
              return true;
            }

            console.log(`[VocabFrame] Upfront preloaded ${parsed.length} full video cues from raw URL for ${videoId}!`);
            this.hasOfficialSubtitles = true;
            this.isLiveCaptionActive = false;
            this.cachedMainVideoCues = parsed;
            this.cachedMainVideoId = videoId;
            const title = detectPageVideoTitle();
            if (title) {
              useAppStore.getState().setVideoTitle(title);
              this.cachedMainVideoTitle = title;
            }

            useAppStore.getState().setVideoId(videoId);
            useAppStore.getState().setCues(parsed, videoId);
            this.cachedMainVideoCues = useAppStore.getState().cues;
            this.enhanceCuesWithAi(parsed);
            return true;
          }
        }
      }
    } catch (err) {
      console.warn('[VocabFrame] loadTracksUpfront error:', err);
    }
    return false;
  }

  public startSniffing() {
    if (!window.location.hostname.includes('youtube.com')) return;
    if (this.isSniffing) return;
    this.isSniffing = true;
    this.lastUrl = window.location.href;

    this.injectNativeCaptionHiderStyle();
    this.sniffNetworkRequests();
    this.sniffYouTubeDomCaptions();
    this.sniffYouTubeTextTracks();
    this.prefetchFullVideoSubtitles();

    // Listen for YouTube SPA navigation for immediate state reset
    this.ytNavigateListener = () => {
      if (!this.isSniffing || typeof window === 'undefined') return;
      const currentUrl = window.location.href;
      const curVid = extractYouTubeVideoId(currentUrl);

      if (curVid && this.cachedMainVideoId && curVid !== this.cachedMainVideoId) {
        this.handleVideoSwitch(curVid);
      }
      this.lastUrl = currentUrl;
    };
    window.addEventListener('yt-navigate-start', this.ytNavigateListener);
    window.addEventListener('yt-navigate-finish', this.ytNavigateListener);
    window.addEventListener('popstate', this.ytNavigateListener);

    console.log('[VocabFrame] YouTube Subtitle Sniffer active.');
  }

  public getIsAdPlaying(): boolean {
    return this.isAdCurrentlyPlaying;
  }

  /**
   * Seamless Advertisement Lifecycle Transition (R2 & R3)
   */
  public handleAdStateChange(isAdNow: boolean) {
    if (!this.isSniffing) return;
    if (this.isAdCurrentlyPlaying === isAdNow) return;

    this.isAdCurrentlyPlaying = isAdNow;
    useAppStore.getState().setIsAdPlaying?.(isAdNow);

    const curVideoId = extractYouTubeVideoId(window.location.href);

    if (isAdNow) {
      // Transition: Main Video -> Ad (Pre-roll or Mid-roll)
      console.log('[VocabFrame] YouTube ad started. Entering ad-aware sniffing mode.');

      // 1. Cache main video cues and title if loaded, so we can restore them post-ad
      const currentCues = useAppStore.getState().cues;
      if (currentCues.length > 0) {
        this.cachedMainVideoCues = currentCues;
        this.cachedMainVideoId = curVideoId;
      }
      const currentTitle = useAppStore.getState().videoTitle || detectPageVideoTitle(true);
      if (currentTitle) {
        this.cachedMainVideoTitle = currentTitle;
        this.cachedMainVideoId = curVideoId;
      }

      // 2. Clear current display cues so main video dialogue does not leak during the ad
      useAppStore.getState().setCues([]);
      this.isLiveCaptionActive = false;
      this.lastCapturedText = '';
      this.lastAdCurrentTime = 0;
      this.lastAdBadgeText = '';
      if (this.liveCaptionTimeout) {
        clearTimeout(this.liveCaptionTimeout);
        this.liveCaptionTimeout = null;
      }
    } else {
      // Transition: Ad -> Main Video (Post-Ad Return)
      console.log('[VocabFrame] YouTube ad finished. Performing seamless post-ad transition.');

      // 1. Clear any ad captions from store
      useAppStore.getState().setCues([]);
      this.isLiveCaptionActive = false;
      this.lastCapturedText = '';
      this.lastAdCurrentTime = 0;
      this.lastAdBadgeText = '';
      if (this.liveCaptionTimeout) {
        clearTimeout(this.liveCaptionTimeout);
        this.liveCaptionTimeout = null;
      }

      // 2. Restore cached official bilingual subtitles if we have them for this video
      if (this.cachedMainVideoCues && this.cachedMainVideoCues.length > 0 && this.cachedMainVideoId === curVideoId) {
        console.log(`[VocabFrame] Restoring ${this.cachedMainVideoCues.length} cached official cues post-ad.`);
        useAppStore.getState().setCues(this.cachedMainVideoCues);
        this.hasOfficialSubtitles = true;
        this.isLiveCaptionActive = false;
        const title = this.cachedMainVideoTitle || detectPageVideoTitle();
        if (title) {
          useAppStore.getState().setVideoTitle(title);
        }
      } else {
        this.hasOfficialSubtitles = false;
        this.isLiveCaptionActive = false;
      }

      // 3. Detect and restore legitimate video title (no JSON/CSS/DOM metadata)
      const legitimateTitle = detectPageVideoTitle();
      if (legitimateTitle) {
        useAppStore.getState().setVideoTitle(legitimateTitle);
      }

      // 4. Proactively trigger re-inspection and full subtitle prefetch for the main video
      this.prefetchFullVideoSubtitles(0);
      window.postMessage({ type: '__LR_TRIGGER_YT_INSPECT__' }, '*');

      // 5. Schedule immediate re-check of native textTracks on the main video
      setTimeout(() => {
        if (!this.isSniffing || this.isAdCurrentlyPlaying) return;
        const video = this.player.getVideoElement();
        if (video && video.textTracks) {
          for (let i = 0; i < video.textTracks.length; i++) {
            const track = video.textTracks[i];
            if (track.cues && track.cues.length > 1) {
              this.convertTextTrackToCues(track);
              break;
            }
          }
        }
      }, 300);
    }
  }

  public stopSniffing() {
    this.isSniffing = false;
    this.hasOfficialSubtitles = false;
    this.isLiveCaptionActive = false;
    this.isAdCurrentlyPlaying = false;
    useAppStore.getState().setIsAdPlaying?.(false);
    this.cachedMainVideoCues = null;
    this.cachedMainVideoId = '';
    this.cachedMainVideoTitle = '';
    this.lastAdCurrentTime = 0;
    this.lastAdBadgeText = '';
    this.removeNativeCaptionHiderStyle();
    if (this.ytNavigateListener) {
      window.removeEventListener('yt-navigate-start', this.ytNavigateListener);
      window.removeEventListener('yt-navigate-finish', this.ytNavigateListener);
      window.removeEventListener('popstate', this.ytNavigateListener);
      this.ytNavigateListener = null;
    }
    if (this.domObserver) {
      this.domObserver.disconnect();
      this.domObserver = null;
    }
    if (this.videoTrackObserver) {
      this.videoTrackObserver.disconnect();
      this.videoTrackObserver = null;
    }
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    if (this.messageListener) {
      window.removeEventListener('message', this.messageListener);
      this.messageListener = null;
    }
    if (this.liveCaptionTimeout) {
      clearTimeout(this.liveCaptionTimeout);
      this.liveCaptionTimeout = null;
    }
    const video = this.player.getVideoElement();
    if (video && video.textTracks && this.addTrackListener && typeof video.textTracks.removeEventListener === 'function') {
      video.textTracks.removeEventListener('addtrack', this.addTrackListener);
      this.addTrackListener = null;
    }
    for (const tr of this.observedTracks) {
      try {
        tr.oncuechange = null;
      } catch (_) {}
    }
    this.observedTracks = [];
    this.processedTrackUrls.clear();
    this.pendingCues = null;
    this.lastCapturedText = '';
    bilingualTranslator.reset();
  }

  /**
   * 1. Hook network requests & probe YouTube page captionTracks via Main World script
   */
  private sniffNetworkRequests() {
    if (typeof window === 'undefined') return;

    // Listen for intercepted or probed timedtext from Main World hook (secure origin check)
    this.messageListener = (event: MessageEvent) => {
      if (event.source && event.source !== window) return;
      if (event.data && event.data.type === '__LR_YT_TIMEDTEXT__') {
        const { content, transContent, format, trackName, url } = event.data;
        if (!content) return;

        let parsedCues: SubtitleCue[] = [];
        if (transContent && (format === 'json3' || !format)) {
          parsedCues = parseYouTubeJson3(content, transContent);
        } else if (format === 'vtt' || (typeof content === 'string' && content.includes('WEBVTT'))) {
          parsedCues = parseSubtitleContent(content);
        } else if (typeof content === 'string' && (content.includes('<transcript') || content.includes('<timedtext'))) {
          parsedCues = parseYouTubeXml(content);
        } else {
          parsedCues = parseYouTubeJson3(content);
        }

        // Intelligently assemble fragmented ASR cues into complete, coherent sentences like Language Reactor
        if (parsedCues.length > 2) {
          const isAsr = Boolean(
            (url && (url.includes('kind=asr') || url.includes('fmt=json3'))) ||
            (trackName && /auto-generated|自动生成|ASR/i.test(trackName)) ||
            parsedCues.some(c => !/[.?!。？！]$/.test(c.textEn.trim()) && (c.end - c.start) < 4.0)
          );
          if (isAsr) {
            parsedCues = assembleLongAsrSentences(parsedCues);
          }
        }

        if (parsedCues.length > 0) {
          const curVid = event.data.videoId || extractYouTubeVideoId(window.location.href);
          if (!curVid) return;

          console.log(`[VocabFrame] Loaded official YouTube timedtext (${parsedCues.length} cues, bilingual: ${Boolean(transContent)}) for ${curVid}:`, url);

          // If an ad is currently playing on YouTube:
          if (this.isAdCurrentlyPlaying || isYouTubeAdPlaying()) {
            // Do NOT overwrite ad cues during the ad! Cache them for post-ad transition, but preserve existing refined cues.
            const hasRefinedCached = this.cachedMainVideoId === curVid && this.cachedMainVideoCues?.some(c => c.isAiRefined || c.isMixedRefined || c.mixedPhrases !== undefined || c.tokens?.some(t => t.isKeyPhrase));
            if (!hasRefinedCached) {
              this.cachedMainVideoCues = parsedCues;
            }
            this.cachedMainVideoId = curVid;
            const title = detectPageVideoTitle(true);
            if (title) this.cachedMainVideoTitle = title;
            return;
          }

          // If video changed, switch state
          if (this.cachedMainVideoId && this.cachedMainVideoId !== curVid) {
            this.handleVideoSwitch(curVid);
          }

          const storeVid = useAppStore.getState().currentVideoId;
          const currentCues = useAppStore.getState().cues;
          const isSameVideo = this.cachedMainVideoId === curVid && (!storeVid || storeVid === curVid);
          const hasAiRefinedCues = isSameVideo && currentCues.length > 0 && currentCues.some(c => c.isAiRefined || c.isMixedRefined || c.mixedPhrases !== undefined || c.tokens?.some(t => t.isKeyPhrase));
          const isIncomingSubstantiallyBigger = this.shouldAcceptNewCues(parsedCues, currentCues);
          if (hasAiRefinedCues && !isIncomingSubstantiallyBigger) {
            console.log('[VocabFrame] Preserving existing AI-refined subtitles, preventing overwrite in timedtext.');
            return;
          }

          this.hasOfficialSubtitles = true;
          this.isLiveCaptionActive = false;
          this.cachedMainVideoCues = parsedCues;
          this.cachedMainVideoId = curVid;

          // Legitimate video title: strictly query genuine page title, NOT trackName ("YouTube Captions" or "English")
          const pageTitle = detectPageVideoTitle();
          if (pageTitle) {
            useAppStore.getState().setVideoTitle(pageTitle);
            this.cachedMainVideoTitle = pageTitle;
          }

          let finalCues = parsedCues;
          if (parsedCues.length <= 5 && currentCues.length > 0 && isSameVideo) {
            finalCues = sanitizeCues([...currentCues, ...parsedCues]);
          }
          useAppStore.getState().setVideoId(curVid);
          useAppStore.getState().setCues(finalCues, curVid);
          this.cachedMainVideoCues = useAppStore.getState().cues;
          this.enhanceCuesWithAi(finalCues);

          // Asynchronously trigger AI sliding window translation if any cues lack translation or have duplicate echo
          const hasMissingTranslation = finalCues.some(c => (!c.textZh || c.textZh.trim() === c.textEn.trim()) && Boolean(c.textEn) && isValidSubtitleText(c.textEn));
          if (hasMissingTranslation && finalCues.length > 0) {
            const vid = this.player.getVideoElement();
            bilingualTranslator.scheduleSlidingWindowTranslation(vid ? vid.currentTime : 0);
          }
        }
      }
    };
    window.addEventListener('message', this.messageListener);

    const uiLang = useAppStore.getState().settings?.uiLanguage || 'zh-CN';
    const targetLang = uiLang === 'ja' ? 'ja' : (uiLang === 'en' ? 'en' : 'zh-Hans');

    // Safe injection via web_accessible_resources external script (MV3 compliant, eliminates CSP inline-script violations)
    if (typeof document !== 'undefined' && typeof chrome !== 'undefined' && chrome?.runtime?.getURL) {
      try {
        const scriptUrl = chrome.runtime.getURL('content-scripts/mainWorld.js');
        const existingScript = document.querySelector('script[src="' + scriptUrl + '"]');
        if (!existingScript) {
          const scriptEl = document.createElement('script');
          scriptEl.src = scriptUrl;
          scriptEl.async = false;
          (document.head || document.documentElement)?.appendChild(scriptEl);
          scriptEl.onload = () => scriptEl.remove();
        }
      } catch (err) {
        console.warn('[VocabFrame] Main World script safe injection deferred:', err);
      }
    }

    // Trigger Main World caption inspection via message
    if (typeof window !== 'undefined') {
      window.postMessage({ type: '__LR_TRIGGER_YT_INSPECT__', targetLang }, '*');
    }
  }

  /**
   * 2. Listen to YouTube's official DOM captions with leaf selector & rollup debounce
   */
  private sniffYouTubeDomCaptions() {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
      return;
    }
    const isUiElement = (el: Element | null): boolean => {
      if (!el) return false;
      return Boolean(
        el.closest('button, [role="button"], [class*="ytp-settings"], [class*="ytp-menu"], [class*="ytp-tooltip"], [class*="ytp-chrome"], [class*="ytp-gradient"]')
      );
    };

    const getYouTubeCaptionText = (): { textEn: string; textZh: string } | null => {
      // Isolate active YouTube visual lines (excluding player controls, settings buttons, tooltips)
      const visualLines = Array.from(document.querySelectorAll<HTMLElement>('.caption-visual-line')).filter(
        vl => !isUiElement(vl)
      );
      let leafTexts: string[] = [];

      if (visualLines.length > 0) {
        // In YouTube's multi-line teleprompter, read only the currently active speech line
        // to prevent joining multiple rolling historical lines into a giant multi-sentence block
        const activeVl = visualLines.length === 1 ? visualLines[0] : visualLines[visualLines.length - 1];
        const segs = Array.from(activeVl.querySelectorAll<HTMLElement>('.ytp-caption-segment')).filter(
          el => !isUiElement(el) && (el.children.length === 0 || !el.querySelector('.ytp-caption-segment'))
        );
        const rawT = segs.length > 0
          ? segs.map(s => s.textContent?.trim() || '').filter(Boolean).join(' ')
          : (activeVl.textContent?.trim() || '');
        const cleaned = cleanLiveCaptionGarbage(rawT);
        if (cleaned) {
          leafTexts.push(cleaned.replace(/\s+/g, ' '));
        }
      }

      if (leafTexts.length === 0) {
        // Fallback: strictly select genuine caption segments inside caption window (exclude buttons/tooltips)
        let segments = Array.from(document.querySelectorAll<HTMLElement>('.ytp-caption-segment, .caption-window span, [class*="caption-window"] span')).filter(
          el => !isUiElement(el) && (el.children.length === 0 || !el.querySelector('.ytp-caption-segment'))
        );
        for (const seg of segments) {
          const t = cleanLiveCaptionGarbage(seg.textContent?.trim() || '');
          if (t && isValidSubtitleText(t)) leafTexts.push(t);
        }
      }

      if (leafTexts.length === 0) return null;

      if (leafTexts.length === 1) {
        const t = leafTexts[0];
        if (isValidSubtitleText(t)) {
          return { textEn: t, textZh: '' };
        }
      } else {
        const line1 = leafTexts[0];
        const line2 = leafTexts.slice(1).join(' ');
        const hasChinese1 = /[\u4e00-\u9fff\u3040-\u30ff\u3400-\u4dbf]/.test(line1);
        const hasChinese2 = /[\u4e00-\u9fff\u3040-\u30ff\u3400-\u4dbf]/.test(line2);

        let textEn = '';
        let textZh = '';
        if (!hasChinese1 && hasChinese2) {
          textEn = line1;
          textZh = line2;
        } else if (hasChinese1 && !hasChinese2) {
          textEn = line2;
          textZh = line1;
        } else {
          if (hasChinese1 && hasChinese2) {
            textEn = leafTexts.join('').trim();
          } else {
            textEn = leafTexts.join(' ').replace(/\s+/g, ' ').trim();
          }
        }

        if (isValidSubtitleText(textEn) || (textZh && isValidSubtitleText(textZh))) {
          return { textEn, textZh };
        }
      }
      return null;
    };

    this.domObserver = new MutationObserver(() => {
      if (!this.isSniffing) return;

      // Monitor ad state changes dynamically
      const adActive = isYouTubeAdPlaying();
      if (adActive !== this.isAdCurrentlyPlaying) {
        this.handleAdStateChange(adActive);
      }

      // Check for dual-ad pod transitions (Ad 1 -> Ad 2 in pod without adActive toggling false)
      if (this.isAdCurrentlyPlaying) {
        const video = this.player.getVideoElement();
        const currentTime = video ? video.currentTime : 0;

        const adBadgeEl = document.querySelector('.ytp-ad-simple-ad-badge, .ytp-ad-text, .ytp-ad-preview-text');
        const adBadgeText = adBadgeEl?.textContent?.trim() || '';
        const isBadgePodChange = Boolean(
          adBadgeText &&
          this.lastAdBadgeText &&
          adBadgeText !== this.lastAdBadgeText &&
          (adBadgeText.includes('2 of') ||
           adBadgeText.includes('2/2') ||
           adBadgeText.includes('2 个') ||
           adBadgeText.includes('2 of 2') ||
           /\b2\s*(?:\/|of|sur|von|de|个|件中|da)\s*2\b/i.test(adBadgeText))
        );

        const isTimeRewind = this.lastAdCurrentTime > 2.5 && currentTime < 1.0;

        if (isBadgePodChange || isTimeRewind) {
          console.log('[VocabFrame] Dual-ad pod transition detected. Clearing previous ad cues.');
          useAppStore.getState().setCues([]);
          this.isLiveCaptionActive = false;
          this.lastCapturedText = '';
          if (this.liveCaptionTimeout) {
            clearTimeout(this.liveCaptionTimeout);
            this.liveCaptionTimeout = null;
          }
        }
        this.lastAdBadgeText = adBadgeText;
        this.lastAdCurrentTime = currentTime;
      } else {
        this.lastAdCurrentTime = 0;
        this.lastAdBadgeText = '';
      }

      // Layer 4 protection: If official subtitles are already loaded on the main video,
      // completely suppress DOM caption sniffing to eliminate jitter.
      // BUT if an ad is playing, allow ad real-time captions to be sniffed!
      if (!this.isAdCurrentlyPlaying) {
        if (this.hasOfficialSubtitles) {
          return;
        }
        if (!this.isLiveCaptionActive && useAppStore.getState().cues.length > 1) {
          return;
        }
      }

      const captionData = getYouTubeCaptionText();
      if (captionData) {
        const key = `${captionData.textEn}__${captionData.textZh}`;
        if (key !== this.lastCapturedText) {
          this.lastCapturedText = key;
          const video = this.player.getVideoElement();
          const currentTime = video ? video.currentTime : 0;
          this.handleLiveCaption(captionData.textEn, currentTime, captionData.textZh);
        }
      } else if (this.isAdCurrentlyPlaying && this.isLiveCaptionActive) {
        // Clear ad caption when ad speech segment finishes or cues are emptied
        const video = this.player.getVideoElement();
        const currentTime = video ? video.currentTime : 0;
        const { cues } = useAppStore.getState();
        if (cues.length === 0 || (cues.length > 0 && currentTime > cues[cues.length - 1].end + 0.3)) {
          useAppStore.getState().setCues([]);
          this.isLiveCaptionActive = false;
          this.lastCapturedText = '';
        }
      }
    });

    const ytPlayer = document.querySelector('#movie_player, .html5-video-player') || document.body;
    this.domObserver.observe(ytPlayer, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  /**
   * 3. Listen to native textTracks on YouTube video
   */
  private sniffYouTubeTextTracks() {
    const checkTracks = () => {
      if (!this.isSniffing) return;
      const video = this.player.getVideoElement();
      if (!video) return;

      // 1. Dynamic ad state monitoring
      const adActive = isYouTubeAdPlaying();
      if (adActive !== this.isAdCurrentlyPlaying) {
        this.handleAdStateChange(adActive);
      }

      // 2. Video switching (SPA navigation across videos)
      const currentUrl = typeof window !== 'undefined' && window.location ? window.location.href : '';
      const curVid = extractYouTubeVideoId(currentUrl);

      if (curVid && this.cachedMainVideoId && curVid !== this.cachedMainVideoId) {
        this.handleVideoSwitch(curVid);
      }
      this.lastUrl = currentUrl;

      // 3. Legitimate video title refresh if empty and main video is playing
      if (!this.isAdCurrentlyPlaying && !useAppStore.getState().videoTitle) {
        const title = detectPageVideoTitle();
        if (title) {
          useAppStore.getState().setVideoTitle(title);
        }
      }

      // 4. Asynchronously schedule AI sliding window translation if cues lack Chinese translation
      if (!this.isAdCurrentlyPlaying) {
        const { cues } = useAppStore.getState();
        if (cues.length > 0) {
          bilingualTranslator.scheduleSlidingWindowTranslation(video.currentTime);
        }
      }

      if (!video.textTracks || video.textTracks.length === 0) return;

      for (let i = 0; i < video.textTracks.length; i++) {
        const track = video.textTracks[i];
        if (track.mode === 'disabled') {
          try {
            track.mode = 'hidden';
          } catch (_) {}
        }

        // If track has full cues loaded on the main video (AGENTS.md Layer 1: > 1 authoritative cues)
        if (!this.isAdCurrentlyPlaying && track.cues && track.cues.length > 1) {
          const curVid = typeof window !== 'undefined' ? extractYouTubeVideoId(window.location.href) : '';
          const storeVid = useAppStore.getState().currentVideoId;
          const isSameVideo = this.cachedMainVideoId === curVid && (!storeVid || storeVid === curVid);
          const currentCues = useAppStore.getState().cues;
          const hasAiRefinedCues = isSameVideo && currentCues.length > 0 && currentCues.some(c => c.isAiRefined || c.isMixedRefined || c.mixedPhrases !== undefined || c.tokens?.some(t => t.isKeyPhrase));

          const isIncomingSubstantiallyBigger = track.cues.length > currentCues.length + 5;

          if (hasAiRefinedCues && !isIncomingSubstantiallyBigger) {
            // Strictly protect existing AI refined cues from infinite loop re-parsing
          } else if (this.hasOfficialSubtitles && isSameVideo && currentCues.length > 1 && !isIncomingSubstantiallyBigger) {
            // Already initialized with authoritative official subtitles for this video
          } else if (currentCues.length <= 1 || !isSameVideo || isIncomingSubstantiallyBigger) {
            this.convertTextTrackToCues(track);
          }
        }

        if (!this.observedTracks.includes(track)) {
          this.observedTracks.push(track);
        }

        track.oncuechange = () => {
          if (!this.isSniffing) return;
          if (!this.isAdCurrentlyPlaying && this.hasOfficialSubtitles) return;
          if (!this.isAdCurrentlyPlaying && !this.isLiveCaptionActive && useAppStore.getState().cues.length > 1) return;
          if (track.activeCues && track.activeCues.length > 0) {
            const combinedText = Array.from(track.activeCues)
              .map((c: any) => c.text || '')
              .filter(Boolean)
              .join('\n');
            if (combinedText && isValidSubtitleText(combinedText)) {
              this.handleLiveCaption(combinedText, video.currentTime);
            }
          }
        };
      }
    };

    checkTracks();
    this.checkInterval = setInterval(checkTracks, 1500);

    const video = this.player.getVideoElement();
    if (video) {
      // AGENTS.md Layer 2: Observe <video> for dynamic <track src="..."> additions
      if (typeof MutationObserver !== 'undefined') {
        this.videoTrackObserver = new MutationObserver(() => {
          if (!this.isSniffing) return;
          const tracks = video.querySelectorAll<HTMLTrackElement>('track[src]');
          tracks.forEach((t) => {
            const src = t.getAttribute('src');
            if (src && !this.processedTrackUrls.has(src)) {
              this.processedTrackUrls.add(src);
              fetch(src)
                .then(r => r.text())
                .then(txt => {
                  if (txt && isValidSubtitleText(txt.slice(0, 100))) {
                    useAppStore.getState().loadSubtitleFileContent(txt);
                  }
                })
                .catch(() => {});
            }
          });
        });
        this.videoTrackObserver.observe(video, { childList: true });
      }

      if (video.textTracks && typeof video.textTracks.addEventListener === 'function') {
        this.addTrackListener = () => {
          setTimeout(checkTracks, 100);
        };
        video.textTracks.addEventListener('addtrack', this.addTrackListener);
      }
    }
  }

  private convertTextTrackToCues(track: TextTrack) {
    if (!track.cues || track.cues.length === 0) return;

    const rawCues: SubtitleCue[] = [];
    for (let i = 0; i < track.cues.length; i++) {
      const cue = track.cues[i] as any;
      const rawText = cue.text || '';
      const cleaned = decodeHtmlEntities(
        rawText.replace(/<[^>]+>/g, '').replace(/\{[^}]+\}/g, '').trim()
      );

      if (!isValidSubtitleText(cleaned)) continue;

      const lines = cleaned.split('\n').map((l: string) => l.trim()).filter(Boolean);
      let textEn = '';
      let textZh = '';

      if (lines.length === 1) {
        textEn = lines[0];
        textZh = '';
      } else if (lines.length >= 2) {
        const line1 = lines[0];
        const line2 = lines.slice(1).join(' ');
        const hasChinese1 = /[\u4e00-\u9fff\u3040-\u30ff\u3400-\u4dbf]/.test(line1);
        const hasChinese2 = /[\u4e00-\u9fff\u3040-\u30ff\u3400-\u4dbf]/.test(line2);

        if (!hasChinese1 && hasChinese2) {
          textEn = line1;
          textZh = line2;
        } else if (hasChinese1 && !hasChinese2) {
          textEn = line2;
          textZh = line1;
        } else {
          if (hasChinese1 && hasChinese2) {
            textEn = `${line1}${line2}`.trim();
          } else {
            textEn = `${line1} ${line2}`.replace(/\s+/g, ' ').trim();
          }
          textZh = '';
        }
      }

      rawCues.push({
        id: i + 1,
        start: cue.startTime,
        end: cue.endTime,
        textEn: textEn || cleaned,
        textZh: textZh || ''
      });
    }

    let sanitized = sanitizeCues(rawCues);
    if (sanitized.length > 2) {
      const isAsr = Boolean(
        (track.label && /auto-generated|自动生成|ASR/i.test(track.label)) ||
        sanitized.some(c => !/[.?!。？！]$/.test(c.textEn.trim()) && (c.end - c.start) < 4.0)
      );
      if (isAsr) {
        sanitized = assembleLongAsrSentences(sanitized);
      }
    }

    if (sanitized.length > 0) {
      const curVid = typeof window !== 'undefined' ? extractYouTubeVideoId(window.location.href) : '';
      if (curVid && this.cachedMainVideoId && curVid !== this.cachedMainVideoId) {
        this.handleVideoSwitch(curVid);
      }

      const storeVid = useAppStore.getState().currentVideoId;
      const currentCues = useAppStore.getState().cues;
      const isSameVideo = this.cachedMainVideoId === curVid && (!storeVid || storeVid === curVid);
      const isIncomingSubstantiallyBigger = this.shouldAcceptNewCues(sanitized, currentCues);
      const hasAiRefinedCues = isSameVideo && currentCues.length > 0 && currentCues.some(c => c.isAiRefined || c.isMixedRefined || c.mixedPhrases !== undefined || c.tokens?.some(t => t.isKeyPhrase));
      if (hasAiRefinedCues && !isIncomingSubstantiallyBigger) {
        console.log('[VocabFrame] Preserving existing AI-refined subtitles, preventing overwrite by raw textTrack.');
        return;
      }

      console.log(`[VocabFrame] Extracted ${sanitized.length} cues from YouTube textTrack for ${curVid}!`);
      this.hasOfficialSubtitles = true;
      this.isLiveCaptionActive = false;
      this.cachedMainVideoCues = sanitized;
      this.cachedMainVideoId = curVid;

      // Legitimate title: detect from page rather than using track.language/label
      const pageTitle = detectPageVideoTitle();
      if (pageTitle) {
        useAppStore.getState().setVideoTitle(pageTitle);
        this.cachedMainVideoTitle = pageTitle;
      }
      useAppStore.getState().setVideoId(curVid);
      useAppStore.getState().setCues(sanitized, curVid);
      this.cachedMainVideoCues = useAppStore.getState().cues;
      this.enhanceCuesWithAi(sanitized);

      const hasMissingTranslation = sanitized.some(c => (!c.textZh || c.textZh.trim() === c.textEn.trim()) && Boolean(c.textEn) && isValidSubtitleText(c.textEn));
      if (hasMissingTranslation && sanitized.length > 0) {
        const vid = this.player.getVideoElement();
        bilingualTranslator.scheduleSlidingWindowTranslation(vid ? vid.currentTime : 0);
      }
    }
  }

  private scheduleCuesUpdate(updated: SubtitleCue[], immediate = false) {
    const currentCues = useAppStore.getState().cues;
    const curVid = typeof window !== 'undefined' ? extractYouTubeVideoId(window.location.href) : '';
    const storeVid = useAppStore.getState().currentVideoId;
    const isSameVideo = this.cachedMainVideoId === curVid && (!storeVid || storeVid === curVid);
    if (isSameVideo && currentCues.length > 0 && currentCues.some(c => c.isAiRefined || c.isMixedRefined || c.mixedPhrases !== undefined || c.tokens?.some(t => t.isKeyPhrase))) {
      return;
    }

    this.pendingCues = updated;
    if (this.liveCaptionTimeout) {
      clearTimeout(this.liveCaptionTimeout);
      this.liveCaptionTimeout = null;
    }

    if (immediate) {
      useAppStore.getState().setCues(updated);
      this.pendingCues = null;
      return;
    }

    this.liveCaptionTimeout = setTimeout(() => {
      if (this.pendingCues) {
        useAppStore.getState().setCues(this.pendingCues);
        this.pendingCues = null;
      }
    }, 150);
  }

  /**
   * Handle live caption from DOM or single TextTrack cuechange with Rollup ASR debounce
   */
  private handleLiveCaption(text: string, currentTime: number, textZh: string = '') {
    if (!this.isSniffing) return;
    if (!isValidSubtitleText(text) && !isValidSubtitleText(textZh)) return;
    if (!this.isAdCurrentlyPlaying) {
      if (this.hasOfficialSubtitles) return;
      if (!this.isLiveCaptionActive && useAppStore.getState().cues.length > 5) return;
    }

    this.isLiveCaptionActive = true;
    const { cues } = useAppStore.getState();

    const cleanCompare = (s: string) =>
      (s || '').toLowerCase().replace(/[^\w\s\u4e00-\u9fff\u3040-\u30ff\u3400-\u4dbf]/g, '').replace(/\s+/g, ' ').trim();

    const curTextClean = cleanCompare(text || textZh);
    if (!curTextClean) return;

    if (cues.length > 0) {
      const lastIndex = cues.length - 1;
      const lastCue = cues[lastIndex];
      const lastTextClean = cleanCompare(lastCue.textEn || lastCue.textZh);

      const timeDelta = currentTime - lastCue.start;
      const isWithinTurnTime = timeDelta >= -0.5 && timeDelta < 8.0;

      // 1. Exact duplicate text: extend duration
      if (lastTextClean === curTextClean) {
        const updated = [...cues];
        updated[lastIndex] = {
          ...lastCue,
          end: Math.max(lastCue.end, currentTime + 3.0),
          textZh: textZh || lastCue.textZh
        };
        this.scheduleCuesUpdate(updated);
        return;
      }

      // 2. Rollup prefix accumulation (e.g. "Guys I have" -> "Guys I have gotten so so")
      // Word-boundary check prevents false positives like "the" matching "there is a cat"
      const lastEndsCjk = /[\u4e00-\u9fff\u3040-\u30ff\u3400-\u4dbf]$/.test(lastTextClean);
      const isPrefixTurn = isWithinTurnTime &&
        (curTextClean === lastTextClean ||
         curTextClean.startsWith(lastTextClean + ' ') ||
         (lastEndsCjk && curTextClean.startsWith(lastTextClean)) ||
         (curTextClean.startsWith(lastTextClean) && !/\w/.test(curTextClean.charAt(lastTextClean.length)))) &&
        lastTextClean.length >= 2;

      if (isPrefixTurn) {
        const countWords = (s: string) => (s.trim().match(/\S+/g) || []).length;
        const lastWords = countWords(lastCue.textEn);
        const hasTerminal = /[.?!。？！]$/.test((lastCue.textEn || '').trim());
        const isSentenceFull = lastWords >= 14 || (currentTime - lastCue.start) >= 4.5 || hasTerminal;

        if (isSentenceFull) {
          // Sentence has reached standard single-sentence size (14 words, 4.5s or terminal punctuation).
          // Stop growing this cue! Seal lastCue and spawn a NEW discrete cue for the subsequent sentence.
          const cleanNew = cleanLiveCaptionGarbage(text);
          let stripped = '';
          if (cleanNew.toLowerCase().startsWith(lastCue.textEn.toLowerCase())) {
            stripped = cleanNew.slice(lastCue.textEn.length).trim();
          } else {
            stripped = cleanNew;
          }
          if (stripped && isValidSubtitleText(stripped) && countWords(stripped) >= 1) {
            const newCue: SubtitleCue = {
              id: cues.length + 1,
              start: Math.round(currentTime * 100) / 100,
              end: Math.round((currentTime + 3.5) * 100) / 100,
              textEn: stripped,
              textZh: textZh || ''
            };
            this.scheduleCuesUpdate(sanitizeCues([...cues, newCue]));
            return;
          }
        } else {
          const updated = [...cues];
          updated[lastIndex] = {
            ...lastCue,
            textEn: cleanLiveCaptionGarbage(text),
            textZh: textZh || lastCue.textZh,
            end: Math.max(lastCue.end, currentTime + 3.5)
          };
          this.scheduleCuesUpdate(updated);
          return;
        }
      }

      // 3. Rollup suffix / minor update in same turn
      const curEndsCjk = /[\u4e00-\u9fff\u3040-\u30ff\u3400-\u4dbf]$/.test(curTextClean);
      const isSuffixTurn = isWithinTurnTime &&
        (lastTextClean === curTextClean ||
         lastTextClean.startsWith(curTextClean + ' ') ||
         (curEndsCjk && lastTextClean.startsWith(curTextClean)) ||
         (lastTextClean.startsWith(curTextClean) && !/\w/.test(lastTextClean.charAt(curTextClean.length)))) &&
        curTextClean.length >= 2;

      if (isSuffixTurn) {
        const updated = [...cues];
        updated[lastIndex] = {
          ...lastCue,
          textZh: textZh || lastCue.textZh,
          end: Math.max(lastCue.end, currentTime + 3.0)
        };
        this.scheduleCuesUpdate(updated);
        return;
      }

      // 4. Strip rolling teleprompter line overlap before starting new turn
      let effectiveText = text;
      if (isWithinTurnTime) {
        const stripped = stripRollingOverlap(lastCue.textEn, text);
        if (stripped !== text && isValidSubtitleText(stripped)) {
          effectiveText = stripped;
        }
      }

      // 5. User seeking backwards / Ad switch:
      if (currentTime < lastCue.start - 1.0) {
        // During an ad: time rewind indicates a new ad in pod or ad replay - reset cues completely
        if (this.isAdCurrentlyPlaying) {
          const newCue: SubtitleCue = {
            id: 1,
            start: Math.max(0, Math.round((currentTime - 0.1) * 100) / 100),
            end: Math.round((currentTime + 3.5) * 100) / 100,
            textEn: effectiveText,
            textZh: textZh || ''
          };
          this.scheduleCuesUpdate([newCue], true);
          return;
        }

        const newCue: SubtitleCue = {
          id: cues.length + 1,
          start: Math.max(0, Math.round((currentTime - 0.1) * 100) / 100),
          end: Math.round((currentTime + 3.5) * 100) / 100,
          textEn: effectiveText,
          textZh: textZh || ''
        };
        this.scheduleCuesUpdate(sanitizeCues([...cues, newCue]), false);
        return;
      }

      // 6. New turn forward: strictly prevent overlapping cross-cues
      const updated = [...cues];
      updated[lastIndex] = {
        ...lastCue,
        end: Math.min(lastCue.end, Math.max(lastCue.start + 0.3, currentTime))
      };

      const newStart = Math.max(updated[lastIndex].end, currentTime);
      const newCue: SubtitleCue = {
        id: cues.length + 1,
        start: Math.round(newStart * 100) / 100,
        end: Math.round((newStart + 3.5) * 100) / 100,
        textEn: effectiveText,
        textZh: textZh || ''
      };

      this.scheduleCuesUpdate([...updated, newCue], false);
    } else {
      const newCue: SubtitleCue = {
        id: 1,
        start: Math.max(0, Math.round((currentTime - 0.1) * 100) / 100),
        end: Math.round((currentTime + 3.5) * 100) / 100,
        textEn: text,
        textZh: textZh || ''
      };
      this.scheduleCuesUpdate([newCue], true);
    }
  }
}
