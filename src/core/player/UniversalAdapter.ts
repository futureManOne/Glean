import { VideoPlayerAdapter } from './BaseAdapter';

export class UniversalAdapter implements VideoPlayerAdapter {
  name = 'UniversalVideoAdapter';

  isMatched(): boolean {
    // Only match local development and E2E test environments (localhost / 127.0.0.1).
    // Production supported sites (Bilibili, YouTube, Quark) have dedicated adapters.
    const host = typeof window !== 'undefined' ? (window.location?.hostname || '') : '';
    return host === 'localhost' || host === '127.0.0.1';
  }

  getVideoElement(): HTMLVideoElement | null {
    // Find all video elements on page
    const videos = Array.from(document.querySelectorAll('video'));
    if (videos.length === 0) return null;

    // Filter only genuine, active, visible main video players (not small thumbnail hover previews)
    const validVideos = videos.filter(v => {
      const rect = v.getBoundingClientRect();
      // Must be substantial size (>= 320x180) and visible on screen
      const isLargeEnough = rect.width >= 320 && rect.height >= 180;
      const isVisible = rect.top < window.innerHeight && rect.bottom > 0 && rect.left < window.innerWidth && rect.right > 0;
      // Exclude hidden or zero opacity
      const style = window.getComputedStyle(v);
      const isDisplayed = style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') > 0.1;

      return isLargeEnough && isVisible && isDisplayed;
    });

    if (validVideos.length === 0) return null;
    if (validVideos.length === 1) return validVideos[0];

    // Pick the largest visible video
    return validVideos.reduce((best, cur) => {
      const bestRect = best.getBoundingClientRect();
      const curRect = cur.getBoundingClientRect();
      const bestArea = bestRect.width * bestRect.height;
      const curArea = curRect.width * curRect.height;
      return curArea > bestArea ? cur : best;
    }, validVideos[0]);
  }

  getContainer(): HTMLElement | null {
    const video = this.getVideoElement();
    if (!video) return null;

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
