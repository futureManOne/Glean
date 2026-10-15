import { BaseVideoPlayerAdapter } from './BaseAdapter';

export class QuarkAdapter extends BaseVideoPlayerAdapter {
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
}
