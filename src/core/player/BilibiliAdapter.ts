import { VideoPlayerAdapter } from './BaseAdapter';

/**
 * Determines whether the current path is a legitimate Bilibili video playback route.
 * Strictly guards against activating the plugin on homepage, search page, user space, etc.
 */
export function isBilibiliWatchPage(pathname?: string): boolean {
  let path = pathname;
  if (!path && typeof window !== 'undefined' && window.location) {
    path = window.location.pathname;
    if (!path && window.location.href) {
      try {
        path = new URL(window.location.href).pathname;
      } catch (_) {
        path = '';
      }
    }
  }
  const cleanPath = (path || '').toLowerCase();
  const hostname = (typeof window !== 'undefined' && window.location?.hostname)
    ? window.location.hostname.toLowerCase()
    : '';

  if (hostname === 'player.bilibili.com') {
    return true;
  }

  // Strictly reject non-playback subdomains (search results, user space, live streams, feeds, etc.)
  if (
    hostname.startsWith('search.') ||
    hostname === 's.bilibili.com' ||
    hostname.startsWith('space.') ||
    hostname.startsWith('live.') ||
    hostname.startsWith('t.') ||
    hostname.startsWith('message.') ||
    hostname.startsWith('member.') ||
    hostname.startsWith('account.') ||
    hostname.startsWith('manga.') ||
    hostname.startsWith('game.') ||
    hostname.startsWith('mall.') ||
    hostname.startsWith('show.')
  ) {
    return false;
  }

  return (
    cleanPath === '/video' ||
    cleanPath.startsWith('/video/') ||
    cleanPath.startsWith('/bangumi/play/') ||
    cleanPath.startsWith('/list/') ||
    cleanPath.startsWith('/medialist/play/') ||
    cleanPath.startsWith('/cheese/play/') ||
    cleanPath.startsWith('/festival/') ||
    cleanPath.startsWith('/blackboard/') ||
    cleanPath.startsWith('/player.html') ||
    cleanPath.startsWith('/html5player.html')
  );
}

/**
 * Checks whether a given video element belongs to a hover preview card, feed card,
 * or non-main player micro video.
 */
export function isPreviewOrFeedVideo(video: HTMLVideoElement): boolean {
  if (!video) return false;
  if (typeof video.matches === 'function') {
    if (video.matches('[class*="preview"], [class*="mini-player"], [class*="miniPlayer"], [class*="hover-player"], [class*="hover-card"]')) {
      return true;
    }
  }
  if (typeof video.closest === 'function') {
    const previewContainer = video.closest(
      '.bili-video-card, .feed-card, .bili-feed-card, .video-card, [class*="preview"], [class*="mini-player"], [class*="miniPlayer"], .bpx-player-ending-related, .recommend-video-card, .bili-cover-card, .feed-card-wrapper, .floor-card, .v-popover, .popover-video-card, .bili-dyn-card, .bili-dyn-item, .video-card-recom, [data-v-popover], [class*="hover-player"], [class*="hover-card"], .hover-card, .video-page-card, .video-page-card-small, .story-video-card, .up-video-card, .rec-list, .recommend-list-v1, .right-container, #right-container, #secondary'
    );
    if (previewContainer) {
      return true;
    }
  }
  return false;
}

export class BilibiliAdapter implements VideoPlayerAdapter {
  name = 'BilibiliAdapter';

  isMatched(): boolean {
    if (typeof window === 'undefined' || !window.location) return false;
    const hostname = (window.location.hostname || '').toLowerCase();
    return hostname === 'bilibili.com' || hostname.endsWith('.bilibili.com');
  }

  getVideoElement(): HTMLVideoElement | null {
    // Strictly guard route: only activate on actual video playback pages
    if (!isBilibiliWatchPage()) {
      return null;
    }

    // 1. Primary Bilibili Dash / Web Player video selectors
    const primarySelectors = [
      '.bpx-player-video-wrap video',
      '#bilibili-player video',
      '.bilibili-player-video video',
      '.bpx-player-container video',
      '#bofqi video',
      '.player-wrap video'
    ];

    for (const sel of primarySelectors) {
      const video = document.querySelector<HTMLVideoElement>(sel);
      if (video && !isPreviewOrFeedVideo(video)) {
        const rect = video.getBoundingClientRect();
        if (rect.width > 200 && rect.height > 120) {
          return video;
        }
      }
    }

    // 2. Fallback: Search all videos on Bilibili page and pick the active visible playback video
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return null;
    const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video'));
    if (videos.length === 0) return null;

    const validVideos = videos.filter(v => {
      if (isPreviewOrFeedVideo(v)) return false;
      const rect = v.getBoundingClientRect();
      const isVisible = rect.width >= 200 && rect.height >= 120 &&
                        rect.top < window.innerHeight && rect.bottom > 0 &&
                        rect.left < window.innerWidth && rect.right > 0;
      const style = window.getComputedStyle ? window.getComputedStyle(v) : null;
      const isDisplayed = style ? (style.display !== 'none' && style.visibility !== 'hidden') : true;
      return isVisible && isDisplayed;
    });

    if (validVideos.length === 0) return null;
    if (validVideos.length === 1) return validVideos[0];

    return validVideos.reduce((best, cur) => {
      const bestRect = best.getBoundingClientRect();
      const curRect = cur.getBoundingClientRect();
      return (curRect.width * curRect.height) > (bestRect.width * bestRect.height) ? cur : best;
    }, validVideos[0]);
  }

  getContainer(): HTMLElement | null {
    const video = this.getVideoElement();
    if (!video) return null;

    // Search for Bilibili standard player wrap
    const playerContainer = document.querySelector<HTMLElement>(
      '.bpx-player-container, #bilibili-player, .bilibili-player-video-wrap, #bofqi, .player-wrap'
    );
    if (playerContainer) {
      return playerContainer;
    }

    let parent = video.parentElement;
    while (parent && parent !== document.body) {
      const style = window.getComputedStyle(parent);
      if (style.position === 'relative' || style.position === 'absolute' || style.position === 'fixed') {
        return parent;
      }
      parent = parent.parentElement;
    }

    return video.parentElement || document.body;
  }

  getCurrentTime(): number {
    const video = this.getVideoElement();
    return video ? video.currentTime : 0;
  }

  getDuration(): number {
    const video = this.getVideoElement();
    return video ? video.duration : 0;
  }

  isPaused(): boolean {
    const video = this.getVideoElement();
    return video ? video.paused : true;
  }

  seek(seconds: number): void {
    const video = this.getVideoElement();
    if (video) {
      const safeTime = Math.max(0, Math.min(seconds, video.duration || seconds));
      video.currentTime = safeTime;
    }
  }

  play(): void {
    const video = this.getVideoElement();
    if (video && video.paused) {
      video.play().catch(() => {});
    }
  }

  pause(): void {
    const video = this.getVideoElement();
    if (video && !video.paused) {
      video.pause();
    }
  }

  togglePlay(): void {
    const video = this.getVideoElement();
    if (video) {
      if (video.paused) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    }
  }

  setPlaybackRate(rate: number): void {
    const video = this.getVideoElement();
    if (video) {
      video.playbackRate = rate;
    }
  }

  onTimeUpdate(callback: (currentTime: number) => void): () => void {
    const video = this.getVideoElement();
    if (!video) return () => {};

    const handler = () => callback(video.currentTime);
    video.addEventListener('timeupdate', handler);
    return () => video.removeEventListener('timeupdate', handler);
  }

  onPlayStateChange(callback: (paused: boolean) => void): () => void {
    const video = this.getVideoElement();
    if (!video) return () => {};

    const playHandler = () => callback(false);
    const pauseHandler = () => callback(true);

    video.addEventListener('play', playHandler);
    video.addEventListener('pause', pauseHandler);

    return () => {
      video.removeEventListener('play', playHandler);
      video.removeEventListener('pause', pauseHandler);
    };
  }
}
