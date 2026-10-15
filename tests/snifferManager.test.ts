import { expect, test, describe } from 'bun:test';
import { createSubtitleSniffer } from '@/core/subtitle/snifferManager';
import { QuarkSubtitleSniffer } from '@/core/quark/quarkSubtitleSniffer';
import { YouTubeSubtitleSniffer } from '@/core/youtube/youtubeSubtitleSniffer';
import { BilibiliSubtitleSniffer } from '@/core/bilibili/bilibiliSubtitleSniffer';
import { BaseVideoPlayerAdapter } from '@/core/player/BaseAdapter';

class MockPlayerAdapter extends BaseVideoPlayerAdapter {
  name = 'MockPlayer';
  isMatched(): boolean {
    return true;
  }
  getVideoElement(): HTMLVideoElement | null {
    return null;
  }
}

describe('createSubtitleSniffer Factory', () => {
  const player = new MockPlayerAdapter();

  test('resolves QuarkSubtitleSniffer for quark.cn hostnames', () => {
    const sniffer = createSubtitleSniffer(player, 'pan.quark.cn');
    expect(sniffer).toBeInstanceOf(QuarkSubtitleSniffer);
    expect(typeof sniffer?.startSniffing).toBe('function');
    expect(typeof sniffer?.stopSniffing).toBe('function');
  });

  test('resolves YouTubeSubtitleSniffer for youtube.com hostnames', () => {
    const sniffer = createSubtitleSniffer(player, 'www.youtube.com');
    expect(sniffer).toBeInstanceOf(YouTubeSubtitleSniffer);
    expect(typeof sniffer?.startSniffing).toBe('function');
    expect(typeof sniffer?.stopSniffing).toBe('function');
  });

  test('resolves BilibiliSubtitleSniffer for bilibili.com hostnames', () => {
    const sniffer = createSubtitleSniffer(player, 'www.bilibili.com');
    expect(sniffer).toBeInstanceOf(BilibiliSubtitleSniffer);
    expect(typeof sniffer?.startSniffing).toBe('function');
    expect(typeof sniffer?.stopSniffing).toBe('function');
  });

  test('returns null for unsupported domains', () => {
    expect(createSubtitleSniffer(player, 'netflix.com')).toBeNull();
    expect(createSubtitleSniffer(player, 'v.qq.com')).toBeNull();
    expect(createSubtitleSniffer(player, '')).toBeNull();
  });
});
