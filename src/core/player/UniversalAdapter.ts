import { BaseVideoPlayerAdapter } from './BaseAdapter';

export class UniversalAdapter extends BaseVideoPlayerAdapter {
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
}
