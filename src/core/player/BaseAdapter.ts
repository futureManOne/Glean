export interface VideoPlayerAdapter {
  name: string;
  isMatched(): boolean;
  getVideoElement(): HTMLVideoElement | null;
  getContainer(): HTMLElement | null;
  getCurrentTime(): number;
  getDuration(): number;
  isPaused(): boolean;
  seek(seconds: number): void;
  play(): void;
  pause(): void;
  togglePlay(): void;
  setPlaybackRate(rate: number): void;
  onTimeUpdate(callback: (currentTime: number) => void): () => void;
  onPlayStateChange(callback: (paused: boolean) => void): () => void;
}

/**
 * BaseVideoPlayerAdapter
 *
 * Deep module implementation providing full standard HTML5 video control,
 * event listeners, playback state, and ancestor container discovery.
 * Platform adapters specialize only the seam: DOM route matching and
 * video element detection.
 */
export abstract class BaseVideoPlayerAdapter implements VideoPlayerAdapter {
  abstract name: string;
  abstract isMatched(): boolean;
  abstract getVideoElement(): HTMLVideoElement | null;

  getContainer(): HTMLElement | null {
    const video = this.getVideoElement();
    if (!video) return null;

    let parent = video.parentElement;
    while (parent && parent !== document.body) {
      try {
        const style = window.getComputedStyle(parent);
        if (style.position === 'relative' || style.position === 'absolute' || style.position === 'fixed') {
          return parent;
        }
      } catch {}
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

    const handler = () => {
      callback(video.currentTime);
    };

    video.addEventListener('timeupdate', handler);
    return () => {
      video.removeEventListener('timeupdate', handler);
    };
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
