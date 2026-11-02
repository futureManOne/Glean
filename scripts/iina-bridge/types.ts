/**
 * Shared types for the Glean ↔ IINA local bridge.
 *
 * These shapes are a cross-process contract: the IINA Lua plugin, the bridge
 * server, and the tests all rely on the exact field names below.
 */

export type LlmProvider = 'google' | 'deepseek' | 'openai' | 'anthropic';

export interface BridgeConfig {
  port: number;
  openlist: {
    baseUrl: string;
    token: string;
    cookie?: string;
  };
  llm: {
    apiKey: string;
    provider: LlmProvider;
    model: string;
    baseUrl?: string;
  };
  targetLang: string;
  translate: boolean;
  subtitleFontSize: number;
}

export interface SubtitleCandidate {
  name: string;
  size: number;
  format: string;
  score: number;
}

export interface CueOut {
  start: number;
  end: number;
  textEn: string;
  textZh: string;
}

/**
 * Canonical boundary guard for JSON parsed from disk / the network.
 * This package has no schema validator, so every untyped payload is narrowed
 * through this single check and its fields are then inspected with `typeof`.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
