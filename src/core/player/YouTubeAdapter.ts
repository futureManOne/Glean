import { BaseVideoPlayerAdapter } from './BaseAdapter';

export class YouTubeAdapter extends BaseVideoPlayerAdapter {
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
}
