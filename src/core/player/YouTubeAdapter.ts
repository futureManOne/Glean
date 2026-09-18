import { VideoPlayerAdapter } from './BaseAdapter';

export class YouTubeAdapter implements VideoPlayerAdapter {
  name = 'YouTubeAdapter';

  isMatched(): boolean {
    return window.location.hostname.includes('youtube.com');
  }

  getVideoElement(): HTMLVideoElement | null {
    // Only activate on actual video watch pages or shorts
    const pathname = window.location.pathname;
    const isWatchPage = pathname.startsWith('/watch') || pathname.startsWith('/shorts');
    if (!isWatchPage) {
      return null;
    }

    // Find YouTube main playback video
    const mainVideo = document.querySelector<HTMLVideoElement>(
      '#movie_player video.html5-main-video, .html5-video-player video.html5-main-video, ytd-watch-flexy video.html5-main-video'
    );
    if (mainVideo) {
      const rect = mainVideo.getBoundingClientRect();
      if (rect.width > 200 && rect.height > 150) {
        return mainVideo;
      }
    }

    // Fallback: Check visible video inside #movie_player
    const playerContainer = document.querySelector('#movie_player, .html5-video-player');
    if (playerContainer) {
      const video = playerContainer.querySelector('video');
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

    const ytPlayer = document.querySelector('#movie_player, .html5-video-player');
    if (ytPlayer) return ytPlayer as HTMLElement;

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
