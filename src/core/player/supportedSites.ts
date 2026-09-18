/**
 * Supported Sites Whitelist Utility
 *
 * Exclusively permits:
 * 1. Bilibili: *.bilibili.com, bilibili.com
 * 2. YouTube: *.youtube.com, youtube.com
 * 3. Quark Pan: pan.quark.cn, *.quark.cn, quark.cn
 * 4. Local Test/Dev Environments: localhost, 127.0.0.1
 */

export function isSupportedHostname(hostname: string): boolean {
  if (!hostname || typeof hostname !== 'string') return false;
  const lower = hostname.toLowerCase().trim();

  // Bilibili
  if (lower === 'bilibili.com' || lower.endsWith('.bilibili.com')) {
    return true;
  }

  // YouTube
  if (lower === 'youtube.com' || lower.endsWith('.youtube.com')) {
    return true;
  }

  // Quark Web / Pan
  if (lower === 'quark.cn' || lower.endsWith('.quark.cn')) {
    return true;
  }

  // Local development & test server
  if (lower === 'localhost' || lower === '127.0.0.1') {
    return true;
  }

  return false;
}

export function isSupportedUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    return isSupportedHostname(url.hostname);
  } catch (_) {
    return false;
  }
}
