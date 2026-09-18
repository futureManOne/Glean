import { decodeHtmlEntities } from '../subtitle/parser';

/**
 * Title Sanitizer for Video Players (YouTube, Quark Pan, etc.)
 *
 * Prevents raw CSS, scripts, tracking params, and ad metadata from polluting the videoTitle.
 */
export function sanitizeVideoTitle(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return '';
  let clean = raw.trim();
  if (!clean) return '';

  // 1. Immediately reject raw scripts, JSON objects, CSS rules, or tracking payloads
  if (
    clean.includes('<script') ||
    clean.includes('</script>') ||
    clean.includes('<style') ||
    clean.includes('</style>') ||
    clean.includes('!important') ||
    clean.includes('@media') ||
    clean.includes('@keyframes') ||
    clean.includes('javascript:') ||
    clean.includes('.select2') ||
    clean.includes('.lln-') ||
    clean.includes('.ytp-') ||
    clean.includes('.ytd-') ||
    clean.includes('#movie_player') ||
    clean.includes('clickTrackingParams') ||
    clean.includes('innertubeCommand') ||
    clean.includes('webCommandMetadata') ||
    clean.includes('BUTTON_VIEW_MODEL') ||
    clean.includes('thumbnailOverlayVideoDetailsRenderer') ||
    clean.includes('trackingParams') ||
    clean.includes('navigationEndpoint') ||
    clean.includes('watchEndpoint') ||
    clean.includes('commandMetadata') ||
    clean.includes('serviceTrackingParams') ||
    clean.includes('accessibilityData') ||
    clean.includes('playerOverlayVideoDetailsRenderer') ||
    clean.includes('adSlotRenderer') ||
    clean.includes('adLayoutMetadata') ||
    clean.includes('ad-showing') ||
    clean.includes('ad-interrupting') ||
    clean.includes('ytp-ad') ||
    clean.includes('video-ads')
  ) {
    return '';
  }

  // 1b. Reject JS functions, arrow function code blocks, and variable declarations
  if (
    /function\s*\([^\)]*\)\s*\{/.test(clean) ||
    /\beval\s*\(/.test(clean) ||
    /(?:\([^\)]*\)|[a-zA-Z_$][\w$]*)\s*=>\s*\{/.test(clean) ||
    /(?:^|[;\s])(?:var|let|const)\s+[a-zA-Z_$][\w$]*\s*=/.test(clean) ||
    /^\/\*[\s\S]*\*\/$/.test(clean) ||
    /"?backgroundColor"?\s*:\s*(?:#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|\d+|"|\{|\[)/.test(clean)
  ) {
    return '';
  }

  // 1c. Reject CSS rules and property declarations with syntax artifacts
  if (
    /(?:[.#][\w-]+\s*,\s*)*[.#][\w-]+\s*\{[^}]*:[^}]+;?\s*\}/.test(clean) ||
    /(?:display|position|margin|padding|border|background(?:-color)?|color|font-size|width|height|z-index|opacity)\s*:\s*(?:none|block|inline|flex|grid|absolute|relative|fixed|sticky|inherit|initial|auto|#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|\d+(?:px|em|rem|%|vh|vw))\s*(?:!important)?\s*;/i.test(clean)
  ) {
    return '';
  }

  // 2. Reject JSON objects or JSON-like metadata strings
  if ((clean.startsWith('{') && clean.endsWith('}')) || (clean.startsWith('[') && clean.endsWith(']'))) {
    try {
      const parsed = JSON.parse(clean);
      if (typeof parsed === 'object' && parsed !== null) {
        return '';
      }
    } catch (_) {}
  }
  if (/"(?:clickTrackingParams|commandMetadata|webCommandMetadata|trackingParams|adSlotRenderer|adLayoutMetadata|accessibilityData|simpleText|formattedString|playerOverlayVideoDetailsRenderer|BUTTON_VIEW_MODEL|thumbnailOverlay)"\s*:/.test(clean)) {
    return '';
  }
  if (/"[a-zA-Z0-9_-]+"\s*:\s*(?:\{|\[|"(?:https?:\/\/|\/|CAE|BUTTON|\w+))/.test(clean)) {
    return '';
  }

  // 3. Strip XML/HTML tags if present and decode entities
  clean = decodeHtmlEntities(clean.replace(/<[^>]+>/g, '').trim());

  // 4. Strip notification count prefix (e.g. "(1) Video Title", "(99+) Video Title")
  clean = clean.replace(/^\(\d+\+?\)\s*/, '');

  // 5. Strip surrounding quotes if wrapped
  clean = clean.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();

  // 6. Normalize internal whitespace, tabs, and newlines
  clean = clean.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();

  // 7. Strip common platform suffixes (e.g. " - YouTube", " - 夸克网盘", "_哔哩哔哩_bilibili")
  clean = clean.replace(/\s*[-–—|_]\s*(?:哔哩哔哩|bilibili).*$/i, '');
  clean = clean.replace(/\s*[-–—|]\s*(YouTube|夸克网盘|Quark|Bilibili|哔哩哔哩)\s*$/i, '');

  // 8. Reject ad-specific phrases or lone UI labels
  const lower = clean.toLowerCase();
  const adLabels = [
    'ad',
    'ads',
    'advertisement',
    'sponsored',
    'skip ad',
    'skip ads',
    'visit advertiser',
    '广告',
    '跳过广告',
    '广告剩余',
    '广告播放中'
  ];
  if (adLabels.includes(lower)) {
    return '';
  }
  if (lower.startsWith('skip ad') || lower.startsWith('跳过广告') || lower.startsWith('ad in ')) {
    return '';
  }

  // 9. Reject standalone generic platform names
  const platformNames = [
    'youtube',
    'quark',
    '夸克',
    '夸克网盘',
    'bilibili',
    '哔哩哔哩',
    'netflix',
    'youku',
    'iqiyi',
    'ted'
  ];
  if (platformNames.includes(lower)) {
    return '';
  }

  // 10. Reject subtitle track names mistakenly treated as video titles
  const trackLabels = [
    'youtube captions',
    'captions',
    'caption',
    'subtitles',
    'subtitle',
    'auto-generated',
    'auto-translate',
    'english',
    'english (auto-generated)',
    'english (cc)',
    'english [cc]',
    'english (united states)',
    'english (uk)',
    'chinese',
    'chinese (simplified)',
    'chinese (traditional)',
    'chinese (china)',
    'chinese (taiwan)',
    '中文',
    '中文（简体）',
    '中文（繁體）',
    'en',
    'zh',
    'zh-hans',
    'zh-hant',
    'ja',
    'japanese',
    '日本語',
    'ko',
    'korean',
    '한국어',
    'es',
    'spanish',
    'fr',
    'french',
    'de',
    'german',
    'ru',
    'russian',
    'audio track',
    'original audio',
    'default',
    'unknown'
  ];
  if (trackLabels.includes(lower)) {
    return '';
  }

  // 11. Length bounding (avoid monstrous strings)
  if (clean.length > 120) {
    clean = clean.slice(0, 120).trim();
  }

  // 12. Must contain at least 1 Unicode letter or number across all human languages
  if (!/\p{L}|\p{N}/u.test(clean)) {
    return '';
  }

  // 13. Single character titles are only accepted for CJK ideographs/kana and Korean Hangul syllables
  const hasIdeograph = /[\u4e00-\u9fff\u3040-\u30ff\u3400-\u4dbf\uac00-\ud7af]/.test(clean);
  if (clean.length < 2 && !hasIdeograph) {
    return '';
  }

  return clean;
}

/**
 * Checks if a YouTube advertisement is currently playing in the active DOM.
 * Supports standard DOM and experimental nested Shadow DOM player containers.
 */
export function isYouTubeAdPlaying(): boolean {
  if (typeof document === 'undefined') return false;

  const roots: (Document | ShadowRoot)[] = [document];
  const queue: (Document | ShadowRoot)[] = [document];
  const visited = new Set<any>([document]);

  // Support direct ytd-player shadowRoot for unit test mocks and standard modern player
  const ytdPlayer = document.querySelector('ytd-player, #ytd-player');
  if (ytdPlayer && (ytdPlayer as any).shadowRoot && !visited.has((ytdPlayer as any).shadowRoot)) {
    visited.add((ytdPlayer as any).shadowRoot);
    roots.push((ytdPlayer as any).shadowRoot);
    queue.push((ytdPlayer as any).shadowRoot);
  }

  // Iteratively pierce nested open shadow roots (e.g. ytd-app -> ytd-watch-flexy -> ytd-player)
  while (queue.length > 0 && roots.length < 20) {
    const current = queue.shift()!;
    const shadowHosts = current.querySelectorAll?.(
      'ytd-app, ytd-page-manager, ytd-watch-flexy, ytd-player, #ytd-player, #movie_player, .html5-video-player'
    ) || [];
    for (let i = 0; i < shadowHosts.length; i++) {
      const sr = (shadowHosts[i] as any).shadowRoot;
      if (sr && !visited.has(sr)) {
        visited.add(sr);
        roots.push(sr);
        queue.push(sr);
      }
    }
  }

  for (const root of roots) {
    const player = root.querySelector?.('#movie_player, .html5-video-player') as HTMLElement | null;
    if (player && (player.classList?.contains?.('ad-showing') || player.classList?.contains?.('ad-interrupting') || player.hasAttribute?.('ad-showing'))) {
      return true;
    }

    if (root.querySelector?.('.ad-showing, .ad-interrupting, .ytp-ad-showing')) {
      return true;
    }

    const adModule = root.querySelector?.(
      '.video-ads.ytp-ad-module, .ytp-ad-player-overlay, .ytp-ad-text, .ytp-ad-preview-text, .ytp-ad-skip-button-container'
    );
    if (adModule) {
      const isGenericContainer = adModule.classList?.contains?.('video-ads') || adModule.classList?.contains?.('ytp-ad-module');
      if (isGenericContainer) {
        const hasActiveAd = Boolean(
          adModule.querySelector?.('.ytp-ad-player-overlay, .ytp-ad-text, .ytp-ad-preview-text, .ytp-ad-skip-button-container, .ytp-ad-simple-ad-badge, .ytp-ad-duration-remaining') ||
          (adModule.children && Array.from(adModule.children).some(c => (c as HTMLElement).offsetParent !== null || (c.textContent?.trim().length || 0) > 0))
        );
        if (hasActiveAd) {
          return true;
        }
      } else {
        if ((adModule as HTMLElement).offsetParent !== null || (adModule.textContent?.trim().length || 0) > 0 || (adModule.children && adModule.children.length > 0)) {
          return true;
        }
      }
    }

    const adBadge = root.querySelector?.('.ytp-ad-simple-ad-badge, .ytp-ad-duration-remaining');
    if (adBadge) {
      return true;
    }
  }

  return false;
}

/**
 * Robust, platform-specific page video title detection
 */
export function detectPageVideoTitle(allowDuringAd = false): string {
  if (typeof document === 'undefined') return '';

  const isYouTube = typeof window !== 'undefined' && window.location.hostname.includes('youtube.com');
  const isQuark = typeof window !== 'undefined' && window.location.hostname.includes('quark.cn');
  const isBilibili = typeof window !== 'undefined' && window.location.hostname.includes('bilibili.com');

  if (isYouTube) {
    // If an ad is currently playing on YouTube, strictly do NOT extract the ad title unless allowDuringAd is true
    if (!allowDuringAd && isYouTubeAdPlaying()) {
      return '';
    }

    // Strict YouTube title selectors in priority order
    const ytTitleSelectors = [
      'meta[name="title"]',
      'meta[property="og:title"]',
      'h1.ytd-watch-metadata yt-formatted-string',
      'ytd-watch-metadata #title h1 yt-formatted-string',
      '#above-the-fold #title h1 yt-formatted-string',
      '#above-the-fold #title h1',
      'h1.title.style-scope.ytd-video-primary-info-renderer yt-formatted-string',
      'h1.ytd-watch-metadata'
    ];

    for (const sel of ytTitleSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = (el.tagName === 'META' ? el.getAttribute('content') : el.textContent)?.trim() || '';
        const sanitized = sanitizeVideoTitle(text);
        if (sanitized) return sanitized;
      }
    }

    // Fallback: document.title without "- YouTube"
    if (document.title) {
      const docTitle = document.title.replace(/\s*[-–—|]\s*YouTube\s*$/i, '').trim();
      const sanitized = sanitizeVideoTitle(docTitle);
      if (sanitized) return sanitized;
    }
  } else if (isQuark) {
    const quarkSelectors = [
      '#videoBody .filename',
      '[class*="filename"]',
      '.video-title',
      '.preview-title'
    ];
    for (const sel of quarkSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent?.trim() || '';
        const sanitized = sanitizeVideoTitle(text);
        if (sanitized) return sanitized;
      }
    }
  } else if (isBilibili) {
    const biliSelectors = [
      'h1.video-title',
      '.video-info-title-inner',
      'h1.media-title',
      '.bpx-player-video-title',
      'meta[name="title"]',
      'meta[property="og:title"]'
    ];
    for (const sel of biliSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = (el.tagName === 'META' ? el.getAttribute('content') : el.textContent)?.trim() || '';
        const sanitized = sanitizeVideoTitle(text);
        if (sanitized) return sanitized;
      }
    }
  }

  // Universal fallback: document.title without platform suffix (never truncate with split on hyphens)
  if (document.title) {
    const cleanDoc = document.title
      .replace(/\s*[-–—|_]\s*(?:哔哩哔哩|bilibili).*$/i, '')
      .replace(/\s*[-–—|]\s*(YouTube|夸克网盘|Quark|Bilibili|哔哩哔哩)\s*$/i, '')
      .trim();
    const sanitized = sanitizeVideoTitle(cleanDoc);
    if (sanitized) return sanitized;
  }

  return '';
}
