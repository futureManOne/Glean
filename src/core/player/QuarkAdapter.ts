import { VideoPlayerAdapter } from './BaseAdapter';

export class QuarkAdapter implements VideoPlayerAdapter {
  name = 'QuarkPanAdapter';

  isMatched(): boolean {
    return window.location.hostname.includes('quark.cn');
  }

  getVideoElement(): HTMLVideoElement | null {
    // 1. Look for video inside quark player container
    const quarkPlayer = document.querySelector('div[class*="player"], .video-container, .preview-video-container, .v-player');
    if (quarkPlayer) {
      const video = quarkPlayer.querySelector('video');
      if (video) {
        const rect = video.getBoundingClientRect();
        if (rect.width > 200 && rect.height > 150) {
          return video;
        }
      }
    }

    // 2. If URL indicates video preview route, find video
    if (window.location.href.includes('video')) {
      const video = document.querySelector('video');
      if (video) {
        const rect = video.getBoundingClientRect();
        if (rect.width > 200 && rect.height > 150) {
          return video;
        }
      }
    }

    return null;
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
