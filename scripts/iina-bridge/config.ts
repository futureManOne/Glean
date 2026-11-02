/**
 * Bridge configuration loader.
 *
 * The integration layer writes `~/.glean-iina/config.json`; the bridge only
 * reads it (and seeds it with defaults on first run so the user has a file to
 * edit). Every field falls back to a default when absent or of the wrong type.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { isPlainObject, type BridgeConfig, type LlmProvider } from './types';

export const CONFIG_PATH = join(homedir(), '.glean-iina', 'config.json');

export const DEFAULT_CONFIG: BridgeConfig = {
  port: 7788,
  openlist: {
    baseUrl: 'http://127.0.0.1:5244',
    token: '',
  },
  llm: {
    apiKey: '',
    provider: 'google',
    model: 'gemini-2.5-flash',
  },
  targetLang: 'zh-CN',
  translate: true,
  subtitleFontSize: 22,
};

const PROVIDERS: LlmProvider[] = ['google', 'deepseek', 'openai', 'anthropic'];

function section(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key];
  return isPlainObject(value) ? value : {};
}

function pickString(source: Record<string, unknown>, key: string, fallback: string): string {
  const value = source[key];
  return typeof value === 'string' ? value : fallback;
}

function pickOptionalString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function pickNumber(source: Record<string, unknown>, key: string, fallback: number): number {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function pickBoolean(source: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = source[key];
  return typeof value === 'boolean' ? value : fallback;
}

function pickProvider(source: Record<string, unknown>, key: string, fallback: LlmProvider): LlmProvider {
  const value = source[key];
  return typeof value === 'string' && (PROVIDERS as string[]).includes(value) ? (value as LlmProvider) : fallback;
}

function pickPort(source: Record<string, unknown>): number {
  const value = pickNumber(source, 'port', DEFAULT_CONFIG.port);
  return Number.isInteger(value) && value > 0 && value < 65536 ? value : DEFAULT_CONFIG.port;
}

function mergeConfig(raw: unknown): BridgeConfig {
  const root = isPlainObject(raw) ? raw : {};
  const openlist = section(root, 'openlist');
  const llm = section(root, 'llm');
  const fontSize = pickNumber(root, 'subtitleFontSize', DEFAULT_CONFIG.subtitleFontSize);

  return {
    port: pickPort(root),
    openlist: {
      baseUrl: pickString(openlist, 'baseUrl', DEFAULT_CONFIG.openlist.baseUrl).replace(/\/+$/, ''),
      token: pickString(openlist, 'token', DEFAULT_CONFIG.openlist.token).trim(),
      cookie: pickOptionalString(openlist, 'cookie'),
    },
    llm: {
      apiKey: pickString(llm, 'apiKey', DEFAULT_CONFIG.llm.apiKey).trim(),
      provider: pickProvider(llm, 'provider', DEFAULT_CONFIG.llm.provider),
      model: pickString(llm, 'model', DEFAULT_CONFIG.llm.model),
      baseUrl: pickOptionalString(llm, 'baseUrl'),
    },
    targetLang: pickString(root, 'targetLang', DEFAULT_CONFIG.targetLang),
    translate: pickBoolean(root, 'translate', DEFAULT_CONFIG.translate),
    subtitleFontSize: fontSize > 0 ? fontSize : DEFAULT_CONFIG.subtitleFontSize,
  };
}

/** `GLEAN_IINA_PORT` overrides the configured port (useful for parallel tests). */
function applyPortOverride(cfg: BridgeConfig): BridgeConfig {
  const raw = process.env.GLEAN_IINA_PORT;
  if (!raw) return cfg;
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port <= 0 || port >= 65536) return cfg;
  return { ...cfg, port };
}

function seedConfigFile(): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, 'utf8');
  console.log(`[bridge] Created default config at ${CONFIG_PATH}`);
}

export function loadConfig(): BridgeConfig {
  if (!existsSync(CONFIG_PATH)) {
    try {
      seedConfigFile();
    } catch (err) {
      console.warn('[bridge] Failed to create config file:', err instanceof Error ? err.message : err);
    }
    return applyPortOverride(structuredClone(DEFAULT_CONFIG));
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    return applyPortOverride(mergeConfig(parsed));
  } catch (err) {
    console.warn(
      `[bridge] Invalid config at ${CONFIG_PATH}, using defaults:`,
      err instanceof Error ? err.message : err
    );
    return applyPortOverride(structuredClone(DEFAULT_CONFIG));
  }
}
