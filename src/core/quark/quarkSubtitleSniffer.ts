import { SubtitleCue } from '@/types';
import { parseSubtitleContent, splitBilingualLines } from '../subtitle/parser';
import { useAppStore } from '@/store/useAppStore';
import { VideoPlayerAdapter } from '../player/BaseAdapter';
import { isValidSubtitleText } from '../youtube/youtubeSubtitleSniffer';
import { bilingualTranslator } from '../ai/bilingualTranslator';

export interface EpisodeInfo {
  season?: number;
  episode: number;
}

/**
 * Extracts season and episode number from video or subtitle file names.
 * Supports:
 * - S01E02, s01e02, S1E2, Season 1 Episode 2
 * - 1x02, 01x02
 * - EP02, ep.02, E02, E2, EP1050
 * - 第02集, 第2集, 第02话, 第2话, 02集
 * - [02], 【02】, (02)
 * - Trailing numbers before extension like "Title - 02.mp4"
 */
export function extractEpisodeNumber(text: string): EpisodeInfo | null {
  if (!text || typeof text !== 'string') return null;

  // Strip directory paths if any
  const clean = text.replace(/^.*[\\\/]/, '').trim();

  // 1. Season & Episode: S01E02, Season 1 Episode 2, s1.e02, etc.
  const sMatch = clean.match(/(?:s|season)[._\-\s]*(\d{1,2})[._\-\s]*(?:e|ep|episode)[._\-\s]*(\d{1,4})/i);
  if (sMatch) {
    return {
      season: parseInt(sMatch[1], 10),
      episode: parseInt(sMatch[2], 10)
    };
  }

  // 2. Multiplier notation: 1x02, 01x02
  const xMatch = clean.match(/(?:^|[^a-zA-Z0-9])(\d{1,2})[xX](\d{1,4})(?:[^a-zA-Z0-9]|$)/);
  if (xMatch) {
    return {
      season: parseInt(xMatch[1], 10),
      episode: parseInt(xMatch[2], 10)
    };
  }

  // 3. Explicit Chinese episode indicators: 第02集, 第2集, 第02话, 第2话, 02集
  const zhMatch = clean.match(/(?:第|\b)\s*(\d{1,4})\s*(?:集|话|期)/);
  if (zhMatch) {
    return {
      episode: parseInt(zhMatch[1], 10)
    };
  }

  // 4. Explicit EP / E prefix: EP02, ep.02, E02, E2
  const epMatch = clean.match(/(?:^|[^a-zA-Z0-9])(?:ep|e|episode)[._\-\s]*(\d{1,4})(?:[^a-zA-Z0-9]|$)/i);
  if (epMatch) {
    return {
      episode: parseInt(epMatch[1], 10)
    };
  }

  // 5. Bracketed numbers: [02], 【02】, (02)
  // Exclude resolutions (480, 720, 1080, 2160) and years (1900-2099)
  const bracketMatches = Array.from(clean.matchAll(/[\[【(（]\s*(\d{1,4})\s*[\]】)）]/g));
  for (const match of bracketMatches) {
    const num = parseInt(match[1], 10);
    if (num >= 1900 && num <= 2099) continue;
    if ([480, 720, 1080, 2160].includes(num)) continue;
    return { episode: num };
  }

  // 6. Delimited standalone number: e.g. "海贼王.1050.中日双语.ass", "Westworld - 03.mp4", "Title.02.mkv"
  const delimitedMatches = Array.from(clean.matchAll(/(?:^|[\s._\-])(\d{1,4})(?:[\s._\-]|\.(?:mp4|mkv|avi|webm|flv|mov|srt|ass|vtt|ssa|sub)$)/gi));
  for (const match of delimitedMatches) {
    const num = parseInt(match[1], 10);
    if (num >= 1900 && num <= 2099) continue;
    if ([480, 720, 1080, 2160].includes(num)) continue;
    return { episode: num };
  }

  return null;
}

export function scoreSubtitleQuality(name: string): number {
  let score = 10;
  const lower = name.toLowerCase();
  // Prefer bilingual subtitles
  if (
    lower.includes('双语') ||
    lower.includes('中英') ||
    lower.includes('chs&eng') ||
    lower.includes('zh&en') ||
    lower.includes('bilingual') ||
    lower.includes('chs.eng') ||
    lower.includes('zh.en')
  ) {
    score += 100;
  } else if (
    lower.includes('chs') ||
    lower.includes('cht') ||
    lower.includes('zh') ||
    lower.includes('中文') ||
    lower.includes('简中') ||
    lower.includes('繁中')
  ) {
    score += 50;
  }
  // Prefer ASS / SSA for rich typography, then SRT, then VTT
  if (lower.endsWith('.ass') || lower.endsWith('.ssa')) score += 10;
  else if (lower.endsWith('.srt')) score += 8;
  else if (lower.endsWith('.vtt')) score += 6;

  return score;
}

export function matchEpisodeSubtitle<T extends { name: string }>(
  videoName: string,
  subtitles: T[]
): T | null {
  if (!videoName || !subtitles || subtitles.length === 0) return null;

  const targetEp = extractEpisodeNumber(videoName);
  if (!targetEp) {
    // Exact or prefix match fallback when no episode pattern is detected
    const baseVideo = videoName.replace(/\.[^/.]+$/, '').trim().toLowerCase();
    const matched = subtitles.filter(s => {
      const baseSub = s.name.replace(/\.[^/.]+$/, '').trim().toLowerCase();
      return baseSub === baseVideo || baseSub.startsWith(baseVideo) || baseVideo.startsWith(baseSub);
    });
    if (matched.length > 0) {
      return matched.sort((a, b) => scoreSubtitleQuality(b.name) - scoreSubtitleQuality(a.name))[0];
    }
    return null;
  }

  const candidates: Array<{ sub: T; score: number }> = [];

  for (const sub of subtitles) {
    const subEp = extractEpisodeNumber(sub.name);
    if (!subEp) continue;

    // If both have season, season must match!
    if (targetEp.season !== undefined && subEp.season !== undefined && targetEp.season !== subEp.season) {
      continue;
    }

    // Episode numbers must match
    if (targetEp.episode === subEp.episode) {
      candidates.push({
        sub,
        score: scoreSubtitleQuality(sub.name)
      });
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].sub;
}

export function detectQuarkVideoTitle(): string {
  if (typeof document === 'undefined') return '';

  const selectors = [
    '[class*="VideoHeader--title"]',
    '[class*="video-title"]',
    '[class*="preview-title"]',
    '[class*="Header--title"]',
    '[class*="fileName"]',
    '[class*="file-name"]',
    '[class*="title-text"]',
    '.preview-title',
    '.video-title',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    const text = el?.getAttribute('title') || el?.textContent?.trim() || '';
    if (text && text.length > 1 && !text.includes('夸克') && isValidQuarkTitle(text)) {
      return text;
    }
  }

  const docTitle = document.title || '';
  const cleaned = docTitle
    .replace(/[\-_—|•]\s*夸克.*$/i, '')
    .replace(/夸克网盘.*$/i, '')
    .trim();
  if (cleaned && cleaned.length > 1 && isValidQuarkTitle(cleaned)) {
    return cleaned;
  }

  return '';
}

function isValidQuarkTitle(t: string): boolean {
  const blacklist = ['全部文件', '我的网盘', '分享文件', '夸克网盘', 'Quark', '视频播放', '播放中', '我的文件'];
  return !blacklist.some(b => t.toLowerCase() === b.toLowerCase());
}

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
  private lastVideoTitle = '';
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

    console.log('[Glean] Quark Subtitle Sniffer started.');
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
    this.lastVideoTitle = '';
  }

  /**
   * Handle episode or video source change cleanly:
   * 1. Purge previous episode subtitles, AI translation and time offset
   * 2. Auto-match folder subtitle for new episode if available
   */
  private handleEpisodeSwitch(newVideoSrc: string, explicitTitle?: string) {
    const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
    const detectedTitle = explicitTitle || detectQuarkVideoTitle();
    console.log(`[Glean] Episode switched! Resetting video session. (title: ${detectedTitle || 'unnamed'})`);

    this.processedTrackUrls.clear();
    this.lastCapturedText = '';
    this.activeTrackSignature = '';
    this.lastVideoSrc = newVideoSrc;
    this.lastUrl = currentUrl;
    this.lastVideoTitle = detectedTitle;

    // 1. Completely reset video session in AppStore (clears cues, offsets, ai states, isUserImportedSubtitle)
    useAppStore.getState().resetVideoSession(newVideoSrc, detectedTitle);

    // 2. Attempt automatic episode matching against detected folder subtitles
    const folderSubs = useAppStore.getState().detectedFolderSubtitles;
    if (detectedTitle && folderSubs.length > 0) {
      const matched = matchEpisodeSubtitle(detectedTitle, folderSubs);
      if (matched) {
        console.log(`[Glean] Auto-matched folder subtitle for "${detectedTitle}":`, matched.name);
        useAppStore.getState().loadDetectedFolderSubtitle(matched);
      }
    }
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
      const currentTitle = detectQuarkVideoTitle();

      const hasUrlChanged = Boolean(this.lastUrl && this.lastUrl !== currentUrl);
      const hasSrcChanged = Boolean(this.lastVideoSrc && this.lastVideoSrc !== currentSrc);
      const hasTitleChanged = Boolean(this.lastVideoTitle && currentTitle && this.lastVideoTitle !== currentTitle);

      if (hasUrlChanged || hasSrcChanged || hasTitleChanged) {
        this.handleEpisodeSwitch(currentSrc, currentTitle);
      } else {
        if (!this.lastUrl) this.lastUrl = currentUrl;
        if (!this.lastVideoSrc) this.lastVideoSrc = currentSrc;
        if (!this.lastVideoTitle && currentTitle) {
          this.lastVideoTitle = currentTitle;
          if (!useAppStore.getState().videoTitle) {
            useAppStore.getState().setVideoTitle(currentTitle);
          }
        }
      }

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
          const isUserImported = useAppStore.getState().isUserImportedSubtitle;

          // If user explicitly imported subtitles for this video session, don't let background sniffer overwrite it
          if (isUserImported && currentCues.length > 0) {
            // Keep user imported subtitles intact
          } else {
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
      }

      // Check <track> tags inside video element
      const isUserImported = useAppStore.getState().isUserImportedSubtitle;
      if (isUserImported && useAppStore.getState().cues.length > 0) {
        return;
      }

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
                  console.log('[Glean] Ignored monolingual track fetch to protect bilingual subtitles.');
                  return;
                }
                console.log('[Glean] Fetched track content from:', src);
                useAppStore.getState().loadSubtitleFileContent(text, title, false);
              }
            })
            .catch(err => {
              console.warn('[Glean] Track fetch error:', err);
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

    const onVideoSrcReset = () => {
      const newSrc = video.currentSrc || video.src || '';
      if (newSrc && this.lastVideoSrc && newSrc !== this.lastVideoSrc) {
        this.handleEpisodeSwitch(newSrc);
      }
    };
    video.addEventListener('loadstart', onVideoSrcReset);
    video.addEventListener('emptied', onVideoSrcReset);

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
          const isUserImported = useAppStore.getState().isUserImportedSubtitle;
          if (isUserImported && useAppStore.getState().cues.length > 0) {
            return;
          }

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
                      console.log('[Glean] Ignored dynamic monolingual track to protect bilingual subtitles.');
                      return;
                    }
                    useAppStore.getState().loadSubtitleFileContent(text, title, false);
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
        `[Glean] Extracted ${parsedCues.length} cues from best textTrack (${track.label || track.language || 'unnamed'})`
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

    // 1. Listen for intercepted subtitles and folder files from Main World hook script
    this.messageListener = (event: MessageEvent) => {
      if (!event.data) return;

      if (event.data.type === '__LR_SUBTITLE_INTERCEPTED__') {
        const isUserImported = useAppStore.getState().isUserImportedSubtitle;
        if (isUserImported && useAppStore.getState().cues.length > 0) {
          return;
        }

        const { content, sourceUrl, fileName } = event.data;
        if (content && (content.includes('-->') || content.includes('WEBVTT') || content.includes('Dialogue:') || content.includes('[Events]') || content.includes('{\\'))) {
          const currentCues = useAppStore.getState().cues;
          const currentHasZh = currentCues.length > 5 && currentCues.some(c => c.textZh && /[\u4e00-\u9fa5]/.test(c.textZh));
          const newHasZh = /[\u4e00-\u9fa5]/.test(content);
          if (currentHasZh && !newHasZh) {
            console.log('[Glean] Ignored intercepted monolingual subtitle to protect bilingual subtitles.');
            return;
          }
          console.log('[Glean] Intercepted network subtitle via Main World hook:', sourceUrl || fileName);
          useAppStore.getState().loadSubtitleFileContent(content, fileName || '夸克在线字幕', false);
        }
      } else if (event.data.type === '__LR_QUARK_FOLDER_FILES__') {
        const files = event.data.files;
        if (Array.isArray(files) && files.length > 0) {
          const current = useAppStore.getState().detectedFolderSubtitles;
          const merged = [...current];
          for (const f of files) {
            if (!merged.some(m => m.name === f.name)) {
              merged.push(f);
            }
          }
          useAppStore.getState().setDetectedFolderSubtitles(merged);

          // If current video has no cues, attempt instant episode match
          if (useAppStore.getState().cues.length === 0) {
            const currentTitle = useAppStore.getState().videoTitle || detectQuarkVideoTitle();
            if (currentTitle) {
              const matched = matchEpisodeSubtitle(currentTitle, merged);
              if (matched) {
                console.log('[Glean] Auto-matched folder subtitle from intercepted folder files:', matched.name);
                useAppStore.getState().loadDetectedFolderSubtitle(matched);
              }
            }
          }
        }
      }
    };
    window.addEventListener('message', this.messageListener);

    // 2. DOM scanning for same-directory subtitle files (e.g. "指中英.ass" in Quark file list table)
    this.sniffDomFolderFiles();

    // 3. Inject hook script into host page's MAIN world
    const hookCode = `
      (function() {
        if (window.__LR_QUARK_SNIFFER_INJECTED__) return;
        window.__LR_QUARK_SNIFFER_INJECTED__ = true;

        const SUB_EXTS = ['.vtt', '.srt', '.ass', '.ssa', '.lrc', '.sub', '.ttml'];

        const isSubtitleUrl = function(u) {
          if (!u || typeof u !== 'string') return false;
          const low = u.toLowerCase();
          return SUB_EXTS.some(function(ext) { return low.includes(ext); }) || low.includes('subtitle') || low.includes('caption');
        };

        const checkAndDispatch = function(text, url, name) {
          if (text && (text.includes('-->') || text.includes('WEBVTT') || text.includes('Dialogue:') || text.includes('[Events]') || text.includes('{\\\\') || /^\\[\\d{2}:\\d{2}/.test(text))) {
            window.postMessage({
              type: '__LR_SUBTITLE_INTERCEPTED__',
              sourceUrl: url,
              fileName: name || '',
              content: text
            }, '*');
          }
        };

        const inspectJsonForSubtitles = function(json) {
          if (!json || typeof json !== 'object') return;
          const candidates = [];
          const extractFiles = function(list) {
            if (!Array.isArray(list)) return;
            for (let i = 0; i < list.length; i++) {
              const item = list[i];
              if (!item) continue;
              const name = item.file_name || item.fileName || item.name || '';
              const lower = (name || '').toLowerCase();
              if (SUB_EXTS.some(function(ext) { return lower.endsWith(ext); })) {
                candidates.push({
                  name: name,
                  fid: item.fid || item.file_id || item.id || '',
                  shareId: item.share_id || item.shareId || '',
                  downloadUrl: item.download_url || item.downloadUrl || item.url || '',
                  size: item.size || 0
                });
              }
            }
          };

          if (json.data) {
            extractFiles(json.data.list);
            extractFiles(json.data.files);
            extractFiles(json.data);
          }
          if (json.list) extractFiles(json.list);

          if (candidates.length > 0) {
            window.postMessage({
              type: '__LR_QUARK_FOLDER_FILES__',
              files: candidates
            }, '*');
          }
        };

        // Listen for requests to load a specific file fid
        window.addEventListener('message', function(e) {
          if (e.data && e.data.type === '__LR_LOAD_QUARK_SUBTITLE_FID__') {
            const info = e.data.fileInfo;
            if (!info) return;
            if (info.downloadUrl) {
              fetch(info.downloadUrl, { credentials: 'include' })
                .then(function(r) { return r.text(); })
                .then(function(txt) { checkAndDispatch(txt, info.downloadUrl, info.name); })
                .catch(function() {});
            } else if (info.fid) {
              // Try Quark Pan download ticket API
              fetch('/drive/v1/files/download?fids=' + encodeURIComponent(info.fid), { credentials: 'include' })
                .then(function(r) { return r.json(); })
                .then(function(res) {
                  const dlUrl = res && res.data && (res.data[0]?.download_url || res.data?.download_url);
                  if (dlUrl) {
                    return fetch(dlUrl).then(function(r) { return r.text(); }).then(function(txt) {
                      checkAndDispatch(txt, dlUrl, info.name);
                    });
                  }
                })
                .catch(function() {});
            }
          }
        });

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
            } else if (url.includes('/drive/') || url.includes('/share/') || url.includes('/file/')) {
              const clone = resp.clone();
              clone.json().then(function(json) {
                inspectJsonForSubtitles(json);
              }).catch(function() {});
            }
          } catch(_) {}
          return resp;
        };

        // Hook XMLHttpRequest
        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function(method, url) {
          this.__lr_url = typeof url === 'string' ? url : (url && url.href) || '';
          return origOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function() {
          this.addEventListener('load', function() {
            try {
              const u = this.__lr_url || '';
              if (isSubtitleUrl(u)) {
                checkAndDispatch(this.responseText, u);
              } else if (u.includes('/drive/') || u.includes('/share/') || u.includes('/file/')) {
                try {
                  const json = JSON.parse(this.responseText);
                  inspectJsonForSubtitles(json);
                } catch(_) {}
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
      console.warn('[Glean] Main World script injection deferred:', err);
    }
  }

  /**
   * 4. Scan the Quark DOM table for same-folder subtitle files (e.g. "指中英.ass")
   */
  private sniffDomFolderFiles() {
    const scanDom = () => {
      if (typeof document === 'undefined') return;
      const SUB_EXTS = ['.ass', '.ssa', '.srt', '.vtt', '.lrc', '.sub', '.ttml'];
      const candidates: Array<{ name: string; fid?: string }> = [];

      // Query elements that might hold file names in Quark drive file list
      const nodes = document.querySelectorAll(
        '[title*="."], [class*="file-name"], [class*="filename"], [class*="title"], td, span'
      );

      nodes.forEach((node) => {
        const titleAttr = node.getAttribute('title') || '';
        const textContent = (node.textContent || '').trim();
        const candidateName = titleAttr || textContent;
        if (!candidateName || candidateName.length > 120) return;

        const lower = candidateName.toLowerCase();
        if (SUB_EXTS.some(ext => lower.endsWith(ext))) {
          if (!candidates.some(c => c.name === candidateName)) {
            candidates.push({ name: candidateName });
          }
        }
      });

      if (candidates.length > 0) {
        const current = useAppStore.getState().detectedFolderSubtitles;
        const hasNew = candidates.some(c => !current.some(cur => cur.name === c.name));
        if (hasNew) {
          const merged = [...current];
          for (const c of candidates) {
            if (!merged.some(m => m.name === c.name)) merged.push(c);
          }
          useAppStore.getState().setDetectedFolderSubtitles(merged);

          if (useAppStore.getState().cues.length === 0) {
            const currentTitle = useAppStore.getState().videoTitle || detectQuarkVideoTitle();
            if (currentTitle) {
              const matched = matchEpisodeSubtitle(currentTitle, merged);
              if (matched) {
                console.log('[Glean] Auto-matched folder subtitle from DOM files:', matched.name);
                useAppStore.getState().loadDetectedFolderSubtitle(matched);
              }
            }
          }
        }
      }
    };

    scanDom();
    setTimeout(scanDom, 1500);
    setTimeout(scanDom, 3500);
  }
}
