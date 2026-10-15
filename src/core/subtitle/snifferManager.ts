import { VideoPlayerAdapter } from '../player/BaseAdapter';
import { QuarkSubtitleSniffer } from '../quark/quarkSubtitleSniffer';
import { YouTubeSubtitleSniffer } from '../youtube/youtubeSubtitleSniffer';
import { BilibiliSubtitleSniffer } from '../bilibili/bilibiliSubtitleSniffer';

/**
 * SubtitleSniffer Seam Interface
 *
 * Provides a uniform contract for platform-specific subtitle sniffers.
 */
export interface SubtitleSniffer {
  startSniffing(): void;
  stopSniffing(): void;
}

/**
 * Polymorphic SubtitleSniffer Factory
 *
 * Resolves and instantiates the appropriate SubtitleSniffer instance
 * based on current video player and host environment.
 */
export function createSubtitleSniffer(
  player: VideoPlayerAdapter,
  hostname?: string
): SubtitleSniffer | null {
  const host = (
    hostname ||
    (typeof window !== 'undefined' && window.location ? window.location.hostname : '') ||
    ''
  ).toLowerCase();

  if (host.includes('quark.cn')) {
    return new QuarkSubtitleSniffer(player);
  }
  if (host.includes('youtube.com')) {
    return new YouTubeSubtitleSniffer(player);
  }
  if (host.includes('bilibili.com')) {
    return new BilibiliSubtitleSniffer(player);
  }
  return null;
}
