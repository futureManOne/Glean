import { VideoPlayerAdapter } from './BaseAdapter';
import { QuarkAdapter } from './QuarkAdapter';
import { YouTubeAdapter } from './YouTubeAdapter';
import { BilibiliAdapter } from './BilibiliAdapter';
import { UniversalAdapter } from './UniversalAdapter';

export * from './BaseAdapter';
export * from './QuarkAdapter';
export * from './YouTubeAdapter';
export * from './BilibiliAdapter';
export * from './UniversalAdapter';
export * from './supportedSites';
export * from './autoPauseEngine';

export function getPlayerAdapter(): VideoPlayerAdapter | null {
  const yt = new YouTubeAdapter();
  if (yt.isMatched()) {
    return yt;
  }
  const quark = new QuarkAdapter();
  if (quark.isMatched()) {
    return quark;
  }
  const bili = new BilibiliAdapter();
  if (bili.isMatched()) {
    return bili;
  }
  const universal = new UniversalAdapter();
  if (universal.isMatched()) {
    return universal;
  }
  return null;
}
