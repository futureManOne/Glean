import { SupportedLang } from '@/types';
import { zhCN, TranslationSchema } from './locales/zh-CN';
import { en } from './locales/en';
import { ja } from './locales/ja';

export type { TranslationSchema } from './locales/zh-CN';

export const LOCALES: Record<SupportedLang, TranslationSchema> = {
  'zh-CN': zhCN,
  'en': en,
  'ja': ja
};

/**
 * Detect user's preferred language from browser environment
 */
export function detectBrowserLanguage(): SupportedLang {
  if (typeof navigator === 'undefined' || !navigator.language) {
    return 'zh-CN';
  }
  const code = navigator.language.toLowerCase();
  if (code.startsWith('ja')) return 'ja';
  if (code.startsWith('en')) return 'en';
  return 'zh-CN';
}

/**
 * Get translation schema for specific language (falls back to zh-CN)
 */
export function getLocale(lang?: SupportedLang): TranslationSchema {
  if (!lang || !LOCALES[lang]) {
    return LOCALES['zh-CN'];
  }
  return LOCALES[lang];
}

/**
 * Interpolate parameters into string template e.g. "Loaded {count} items" -> "Loaded 5 items"
 */
export function formatString(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    return params[key] !== undefined ? String(params[key]) : `{${key}}`;
  });
}
