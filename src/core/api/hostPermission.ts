import { normalizeBaseUrl } from './llmClient';

const ALWAYS_ALLOWED_AI_HOSTS = new Set([
  'api.openai.com',
  'api.deepseek.com',
  'generativelanguage.googleapis.com'
]);

export function getAiHostPermissionPattern(baseUrl: string): string | null {
  try {
    const raw = (baseUrl || '').trim();
    if (!raw) return null;
    const normalized = normalizeBaseUrl(raw);
    if (!normalized) return null;
    const url = new URL(normalized);
    if (url.protocol !== 'https:') return null;
    if (!url.hostname.includes('.') && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return null;
    if (ALWAYS_ALLOWED_AI_HOSTS.has(url.hostname)) return null;
    return `${url.origin}/*`;
  } catch {
    return null;
  }
}

export async function ensureAiHostPermission(baseUrl: string): Promise<boolean> {
  const raw = (baseUrl || '').trim();
  if (!raw) return true;
  const normalized = normalizeBaseUrl(raw);
  if (!normalized) return false;
  try {
    const url = new URL(normalized);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      return false;
    }
    if (!url.hostname.includes('.') && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      return false;
    }
  } catch {
    return false;
  }
  const origin = getAiHostPermissionPattern(normalized);
  if (!origin || typeof chrome === 'undefined' || !chrome.permissions) return true;
  try {
    if (chrome.permissions.contains) {
      const hasWildcard = await chrome.permissions.contains({ origins: ['https://*/*'] }).catch(() => false);
      if (hasWildcard) return true;
      const has = await chrome.permissions.contains({ origins: [origin] }).catch(() => false);
      if (has) return true;
    }
  } catch {}
  return chrome.permissions.request({ origins: [origin] });
}

