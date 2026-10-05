import { expect, test, describe } from 'bun:test';
import { getPlatformFromHostname, isPlatformEnabled, isSupportedHostname } from '@/core/player';

describe('Platform Enable/Disable Configuration', () => {
  test('correctly identifies supported platforms from hostname', () => {
    expect(getPlatformFromHostname('www.youtube.com')).toBe('youtube');
    expect(getPlatformFromHostname('youtube.com')).toBe('youtube');
    expect(getPlatformFromHostname('m.youtube.com')).toBe('youtube');

    expect(getPlatformFromHostname('www.bilibili.com')).toBe('bilibili');
    expect(getPlatformFromHostname('bilibili.com')).toBe('bilibili');

    expect(getPlatformFromHostname('pan.quark.cn')).toBe('quark');
    expect(getPlatformFromHostname('quark.cn')).toBe('quark');

    expect(getPlatformFromHostname('google.com')).toBeNull();
    expect(getPlatformFromHostname('v.qq.com')).toBeNull();
  });

  test('defaults to enabled (true) when enabledPlatforms is undefined or partially defined', () => {
    expect(isPlatformEnabled('www.youtube.com')).toBe(true);
    expect(isPlatformEnabled('www.bilibili.com')).toBe(true);
    expect(isPlatformEnabled('pan.quark.cn')).toBe(true);
    expect(isPlatformEnabled('localhost')).toBe(true);

    expect(isPlatformEnabled('www.youtube.com', {})).toBe(true);
    expect(isPlatformEnabled('www.bilibili.com', {})).toBe(true);
    expect(isPlatformEnabled('pan.quark.cn', {})).toBe(true);
  });

  test('respects user disable toggle per platform', () => {
    // Disable YouTube only
    const noYoutube = { youtube: false, bilibili: true, quark: true };
    expect(isPlatformEnabled('www.youtube.com', noYoutube)).toBe(false);
    expect(isPlatformEnabled('youtube.com', noYoutube)).toBe(false);
    expect(isPlatformEnabled('www.bilibili.com', noYoutube)).toBe(true);
    expect(isPlatformEnabled('pan.quark.cn', noYoutube)).toBe(true);

    // Disable Bilibili only
    const noBilibili = { youtube: true, bilibili: false, quark: true };
    expect(isPlatformEnabled('www.youtube.com', noBilibili)).toBe(true);
    expect(isPlatformEnabled('www.bilibili.com', noBilibili)).toBe(false);
    expect(isPlatformEnabled('bilibili.com', noBilibili)).toBe(false);
    expect(isPlatformEnabled('pan.quark.cn', noBilibili)).toBe(true);

    // Disable Quark only
    const noQuark = { youtube: true, bilibili: true, quark: false };
    expect(isPlatformEnabled('www.youtube.com', noQuark)).toBe(true);
    expect(isPlatformEnabled('www.bilibili.com', noQuark)).toBe(true);
    expect(isPlatformEnabled('pan.quark.cn', noQuark)).toBe(false);
    expect(isPlatformEnabled('quark.cn', noQuark)).toBe(false);
  });

  test('always rejects unsupported hostnames regardless of configuration', () => {
    const allEnabled = { youtube: true, bilibili: true, quark: true };
    expect(isPlatformEnabled('netflix.com', allEnabled)).toBe(false);
    expect(isPlatformEnabled('twitter.com', allEnabled)).toBe(false);
  });
});
