import { LlmConfig, ConnectionTestResult, LlmChatParams } from '@/types';

export const EXTENSION_CONTEXT_INVALIDATED_MESSAGE = '扩展已更新，请刷新当前页面后重试。';

export function isExtensionContextInvalidatedError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'object' && (error as { isContextInvalidated?: boolean }).isContextInvalidated) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /extension context invalidated|context invalidated/i.test(message);
}

/**
 * Sanitize and normalize API keys by stripping surrounding quotes
 * and accidental 'Bearer ' prefix copied from documentation or curl commands.
 */
export function normalizeApiKey(key: string): string {
  let trimmed = (key || '').trim();
  let prev = '';
  // Multi-pass sanitization for arbitrarily nested wrapper artifacts
  while (trimmed !== prev) {
    prev = trimmed;
    trimmed = trimmed.replace(/^["']|["']$/g, '').trim();
    trimmed = trimmed.replace(/^Bearer\s+/i, '').trim();
    trimmed = trimmed.replace(/^(\?|&)?[a-z0-9_]*key=\s*/i, '').trim();
  }
  return trimmed;
}

/**
 * Normalize API base URL by trimming whitespace, trailing slashes,
 * stripping accidental endpoint paths (/chat/completions, /models),
 * query parameters, and standardizing Google Gemini AI Studio endpoint
 * path to the official OpenAI-compatible base URL.
 */
export function normalizeBaseUrl(url: string): string {
  let trimmed = (url || '').trim();
  if (!trimmed) return '';

  // 1. Strip hash and query parameters (e.g. ?key=AIzaSy...)
  trimmed = trimmed.split('?')[0].split('#')[0].trim().replace(/\/+$/, '');
  if (!trimmed) return '';

  // 2. Ensure protocol if missing (e.g. generativelanguage.googleapis.com or api.openai.com/v1)
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }

  // 3. Normalize multiple slashes in path (preserve protocol ://)
  trimmed = trimmed.replace(/([^:])\/+/g, '$1/');

  // 4. Upgrade http to https for known secure AI gateways
  if (
    trimmed.includes('api.openai.com') ||
    trimmed.includes('api.deepseek.com') ||
    trimmed.includes('api.x.ai') ||
    trimmed.includes('generativelanguage.googleapis.com')
  ) {
    trimmed = trimmed.replace(/^http:\/\//i, 'https://');
  }

  // 5. Strip trailing /chat/completions or /models if user accidentally pasted full endpoint
  trimmed = trimmed.replace(/\/(chat\/completions|models)$/i, '').replace(/\/+$/, '');

  // 6. Google Gemini AI Studio OpenAI-compatible endpoint auto-normalization
  if (trimmed.includes('generativelanguage.googleapis.com')) {
    if (trimmed.endsWith('/openai')) {
      if (!trimmed.endsWith('/v1beta/openai')) {
        try {
          const origin = new URL(trimmed).origin;
          trimmed = `${origin}/v1beta/openai`;
        } catch {
          trimmed = 'https://generativelanguage.googleapis.com/v1beta/openai';
        }
      }
    } else if (trimmed.endsWith('/v1beta') || trimmed.endsWith('/v1')) {
      trimmed = trimmed.replace(/\/v1$/, '/v1beta') + '/openai';
    } else {
      try {
        const origin = new URL(trimmed).origin;
        trimmed = `${origin}/v1beta/openai`;
      } catch {
        trimmed = 'https://generativelanguage.googleapis.com/v1beta/openai';
      }
    }
  }

  // 7. Ensure /v1 for standard gateways if omitted
  if (
    (trimmed.includes('api.openai.com') ||
      trimmed.includes('api.deepseek.com') ||
      trimmed.includes('api.x.ai')) &&
    !/\/(v1|v1beta|v2|v3)$/i.test(trimmed)
  ) {
    trimmed = `${trimmed}/v1`;
  }

  return trimmed;
}

/**
 * Format error messages from LLM providers into clear, actionable notifications,
 * especially for Google Gemini, Grok, and OpenAI edge cases.
 */
export function formatLlmErrorMessage(rawMsg: string, status?: number, baseUrl?: string): string {
  const msg = (rawMsg || '').trim();
  if (!msg) return `HTTP ${status || 'Error'}`;
  const lower = msg.toLowerCase();

  // 1. Google Gemini specific error diagnostics
  if (lower.includes('api key not valid') || lower.includes('api_key_invalid')) {
    return `${msg} (请检查 Google AI Studio API Key 是否有效)`;
  }
  if (lower.includes('api key expired') || lower.includes('api_key_expired')) {
    return `${msg} (Google AI Studio API Key 已过期，请重新生成)`;
  }
  if (lower.includes('unregistered callers') || lower.includes('caller does not have permission')) {
    return `${msg} (未提供有效身份凭证或项目未启用 Generative Language API，请检查 API Key)`;
  }
  if (
    lower.includes('has not been used in project') ||
    lower.includes('is disabled') ||
    lower.includes('service disabled')
  ) {
    return `${msg} (Google Generative Language API 未在项目中启用，请前往 Google Cloud 控制台启用)`;
  }
  if (
    lower.includes('user location is not supported') ||
    lower.includes('location is not supported') ||
    lower.includes('country not supported') ||
    lower.includes('region not supported')
  ) {
    return `${msg} (Google Gemini 暂不支持当前地区，请使用受支持地区的网络代理)`;
  }
  if (
    lower.includes('resource has been exhausted') ||
    lower.includes('quota exceeded') ||
    lower.includes('quota_exceeded') ||
    (status === 429 && baseUrl?.includes('googleapis.com'))
  ) {
    return `${msg} (Google Gemini API 调用配额已超限，请稍后重试或检查账单配额)`;
  }
  if (lower.includes('safety') || lower.includes('blocked due to safety') || lower.includes('content_filter')) {
    return `${msg} (输入或输出内容被 Google Gemini 安全审查策略拦截)`;
  }
  if (
    (lower.includes('not found') || lower.includes('does not exist') || lower.includes('not exist')) &&
    baseUrl?.includes('googleapis.com')
  ) {
    return `${msg} (指定的 Google Gemini 模型不存在或当前 API 版本不支持，建议使用 gemini-2.5-flash)`;
  }

  // 2. Gateway concurrency & availability diagnostics (Sub2API / Grok / OpenAI proxies)
  if (
    status === 503 ||
    lower.includes('service temporarily unavailable') ||
    lower.includes('gateway_concurrency_limit') ||
    lower.includes('concurrency limit exceeded') ||
    lower.includes('account_select_failed') ||
    lower.includes('no available grok accounts') ||
    lower.includes('no available account')
  ) {
    return `${msg} (自建 Sub2API / 上游 AI 网关并发配额已满或正在排队。建议在 Sub2API 后台将 accounts 的 concurrency 并发数适当调大，如 5~10，或稍后重试)`;
  }

  return msg;
}

/**
 * Determine default model for a given base URL if not explicitly specified.
 */
export function getDefaultModelForBaseUrl(baseUrl: string): string {
  if (baseUrl.includes('googleapis.com')) {
    return 'gemini-2.5-flash';
  }
  if (baseUrl.includes('api.openai.com')) {
    return 'gpt-4o-mini';
  }
  if (baseUrl.includes('api.deepseek.com')) {
    return 'deepseek-chat';
  }
  if (baseUrl.includes('grok')) {
    return 'grok-4.6';
  }
  if (baseUrl.includes('sub2api')) {
    return 'gpt-4o';
  }
  return 'gpt-4o';
}

export interface FetchedModel {
  id: string;
  ownedBy?: string | null;
}

/**
 * Known Anthropic/coding compatibility subpath suffixes (from cc-switch).
 * When baseUrl ends with these, probe endpoints with and without the suffix.
 */
export const KNOWN_COMPAT_SUFFIXES: string[] = [
  '/api/claudecode',
  '/api/anthropic',
  '/apps/anthropic',
  '/api/coding',
  '/claudecode',
  '/anthropic',
  '/step_plan',
  '/coding',
  '/claude'
];

/**
 * Generate candidate model endpoint URLs for probing OpenAI-compatible gateways.
 * Adopts cc-switch multi-candidate probing rules:
 * 1. If baseUrl ends in a version segment /v{N} (e.g. /v1, /v4), primary is {base}/models.
 *    If not /v1 (e.g. /v4), also append {base}/v1/models as fallback.
 *    Also probes stripped version segment {root}/models.
 * 2. If baseUrl does not end in a version segment, primary is {base}/v1/models, then {base}/models.
 * 3. If baseUrl ends in known compat suffix (e.g. /anthropic), strips it and tries /v1/models & /models.
 */
export function getCandidateModelUrls(baseUrl: string): string[] {
  const trimmed = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return [];

  const urls: string[] = [];
  const primaryUrl = `${trimmed}/models`;
  urls.push(primaryUrl);

  if (trimmed.endsWith('/v1')) {
    const withoutV1 = trimmed.replace(/\/v1$/, '');
    const alt = `${withoutV1}/models`;
    if (!urls.includes(alt)) {
      urls.push(alt);
    }
  } else if (!trimmed.includes('generativelanguage.googleapis.com')) {
    const withV1 = `${trimmed}/v1/models`;
    if (!urls.includes(withV1)) {
      urls.push(withV1);
    }
  }

  // Known compat suffixes (cc-switch style)
  for (const suffix of KNOWN_COMPAT_SUFFIXES) {
    if (trimmed.toLowerCase().endsWith(suffix)) {
      const root = trimmed.slice(0, trimmed.length - suffix.length).replace(/\/+$/, '');
      if (root && root.includes('://')) {
        const alt1 = `${root}/v1/models`;
        const alt2 = `${root}/models`;
        if (!urls.includes(alt1)) urls.push(alt1);
        if (!urls.includes(alt2)) urls.push(alt2);
      }
      break;
    }
  }

  return urls;
}


/**
 * Standardize HTTP headers for AI gateways, supporting Bearer authentication
 * and optional x-goog-api-key header for Google Gemini endpoints.
 */
export function getRequestHeaders(apiKey: string, baseUrl: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
  if (baseUrl.includes('googleapis.com')) {
    headers['x-goog-api-key'] = apiKey;
  }
  return headers;
}

/**
 * Helper to create an AbortSignal with timeout compatible across runtimes,
 * with support for linking an external AbortSignal (e.g. user abort / modal close).
 */
function createTimeoutSignal(timeoutMs: number, externalSignal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  let onAbort: (() => void) | null = null;
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      onAbort = () => controller.abort(externalSignal.reason);
      externalSignal.addEventListener('abort', onAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (externalSignal && onAbort) {
        externalSignal.removeEventListener('abort', onAbort);
      }
    }
  };
}


/**
 * Determine if request should proxy through background service worker.
 * Content scripts (running on YouTube / Quark) are subject to CORS/preflight restrictions,
 * whereas the background service worker has extension host permissions.
 */
export function shouldProxyViaBackground(): boolean {
  if (typeof chrome === 'undefined' || !chrome?.runtime?.sendMessage) {
    return false;
  }
  // If extension context was invalidated, chrome.runtime.id is falsy or throws
  try {
    if ('id' in chrome.runtime && !chrome.runtime.id) {
      return false;
    }
  } catch {
    return false;
  }
  // If window is undefined, we are already in background service worker
  if (typeof window === 'undefined') {
    return false;
  }
  return true;
}

/**
 * Send request to background service worker via chrome.runtime.sendMessage.
 */
function proxyViaBackground<T>(type: string, payload: Record<string, any>): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      if (typeof chrome === 'undefined' || !chrome?.runtime?.sendMessage || ('id' in chrome.runtime && !chrome.runtime.id)) {
        const err: any = new Error('Extension context invalidated.');
        err.isContextInvalidated = true;
        return reject(err);
      }
      chrome.runtime.sendMessage({ type, ...payload }, (res) => {
        const lastErr = chrome.runtime?.lastError;
        if (lastErr) {
          const errMsg = lastErr.message || 'Chrome runtime message failed';
          const err: any = new Error(errMsg);
          if (/extension context invalidated/i.test(errMsg)) {
            err.isContextInvalidated = true;
          }
          return reject(err);
        }
        if (!res) {
          return reject(new Error('Background service worker returned empty response'));
        }
        if (res.success) {
          resolve(res.data);
        } else {
          const err: any = new Error(res.error || 'Background request failed');
          if (res.isLlmError) {
            err.isLlmError = true;
          }
          if (/extension context invalidated/i.test(res.error || '')) {
            err.isContextInvalidated = true;
          }
          reject(err);
        }
      });
    } catch (err: any) {
      if (/extension context invalidated/i.test(err?.message || '')) {
        err.isContextInvalidated = true;
      }
      reject(err);
    }
  });
}

/**
 * Fallback connection test using minimal /chat/completions payload
 * for gateways that disable or omit /v1/models.
 */
async function testChatFallback(
  baseUrl: string,
  apiKey: string,
  modelName: string,
  timeoutMs: number,
  startTime: number
): Promise<ConnectionTestResult> {
  const { signal, cleanup } = createTimeoutSignal(Math.min(timeoutMs, 10000));
  const rawModel = (modelName || '').trim() || getDefaultModelForBaseUrl(baseUrl);
  const fallbackModel = rawModel.replace(/^models\//, '');
  const cleanApiKey = normalizeApiKey(apiKey);
  try {
    const chatUrl = `${baseUrl}/chat/completions`;
    const res = await fetch(chatUrl, {
      method: 'POST',
      headers: getRequestHeaders(cleanApiKey, baseUrl),
      body: JSON.stringify({
        model: fallbackModel,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1
      }),
      signal
    });
    cleanup();

    const latencyMs = Date.now() - startTime;
    if (res.ok) {
      return {
        success: true,
        latencyMs,
        modelsCount: 1,
        modelUsed: fallbackModel,
        availableModels: [fallbackModel]
      };
    }

    if (res.status === 404) {
      let altChatUrl = '';
      if (!baseUrl.endsWith('/v1') && !baseUrl.includes('googleapis.com')) {
        altChatUrl = `${baseUrl}/v1/chat/completions`;
      } else if (baseUrl.endsWith('/v1')) {
        altChatUrl = `${baseUrl.slice(0, -3)}/chat/completions`;
      }
      if (altChatUrl) {
        try {
          const altRes = await fetch(altChatUrl, {
            method: 'POST',
            headers: getRequestHeaders(cleanApiKey, baseUrl),
            body: JSON.stringify({
              model: fallbackModel,
              messages: [{ role: 'user', content: 'hi' }],
              max_tokens: 1
            }),
            signal
          });
          if (altRes.ok) {
            cleanup();
            return {
              success: true,
              latencyMs: Date.now() - startTime,
              modelsCount: 1,
              modelUsed: fallbackModel,
              availableModels: [fallbackModel]
            };
          }
        } catch (_) {}
      }
    }

    const text = await res.text().catch(() => '');
    let msg = '';
    try {
      const errJson = JSON.parse(text);
      msg = typeof errJson?.error === 'string' ? errJson.error : (errJson?.error?.message || errJson?.message || errJson?.detail);
    } catch {}
    if (!msg) {
      msg = text ? text.slice(0, 100) : `HTTP ${res.status}`;
    }
    return {
      success: false,
      latencyMs,
      errorMessage: formatLlmErrorMessage(msg, res.status, baseUrl)
    };
  } catch (err: any) {
    cleanup();
    return {
      success: false,
      latencyMs: Date.now() - startTime,
      errorMessage: err?.message || '备用测试失败'
    };
  }
}

/**
 * Direct execution of connection test via fetch().
 */
export async function testAiConnectionDirect(config: LlmConfig): Promise<ConnectionTestResult> {
  const rawUrl = (config.apiBaseUrl || '').trim();
  let apiKey = normalizeApiKey(config.apiKey || '');

  // If apiKey is empty but present in query params (e.g. ?key=AIzaSy...)
  if (!apiKey && rawUrl.includes('?')) {
    try {
      const match = rawUrl.match(/[?&]key=([^&#]+)/i);
      if (match && match[1]) {
        apiKey = normalizeApiKey(decodeURIComponent(match[1]));
      }
    } catch (_) {}
  }

  const baseUrl = normalizeBaseUrl(rawUrl);
  const rawModelName = (config.modelName || '').trim();
  const cleanModel = rawModelName.replace(/^models\//, '');

  if (!baseUrl) {
    return {
      success: false,
      latencyMs: 0,
      errorMessage: '缺少 API Base URL'
    };
  }

  if (!apiKey) {
    return {
      success: false,
      latencyMs: 0,
      errorMessage: '缺少 API Key'
    };
  }

  const startTime = Date.now();
  const timeoutMs = config.timeoutMs || 15000;

  // Step 1: Query candidate /models endpoints (/v1/models and /models)
  const candidateUrls: string[] = [];
  candidateUrls.push(`${baseUrl}/models`);
  if (!baseUrl.endsWith('/v1') && !baseUrl.includes('generativelanguage.googleapis.com')) {
    const withV1 = `${baseUrl}/v1/models`;
    if (!candidateUrls.includes(withV1)) {
      candidateUrls.push(withV1);
    }
  }
  let lastError: Error | null = null;
  let lastStatus: number | null = null;
  let lastStatusText = '';

  for (let i = 0; i < candidateUrls.length; i++) {
    const modelsUrl = candidateUrls[i];
    const { signal: modelsSignal, cleanup: modelsCleanup } = createTimeoutSignal(timeoutMs);

    let res: Response;
    try {
      res = await fetch(modelsUrl, {
        method: 'GET',
        headers: getRequestHeaders(apiKey, baseUrl),
        signal: modelsSignal
      });
    } catch (fetchErr: any) {
      modelsCleanup();
      if (fetchErr?.name === 'AbortError' || fetchErr?.message?.includes('timed out')) {
        return {
          success: false,
          latencyMs: Date.now() - startTime,
          errorMessage: `连接超时 (${timeoutMs}ms)`
        };
      }
      lastError = fetchErr;
      if (i < candidateUrls.length - 1) {
        continue;
      }
      // Try fallback on general network error
      try {
        return await testChatFallback(baseUrl, apiKey, cleanModel, timeoutMs, startTime);
      } catch {
        return {
          success: false,
          latencyMs: Date.now() - startTime,
          errorMessage: fetchErr?.message || '网络连接失败'
        };
      }
    }
    modelsCleanup();

    const latencyMs = Date.now() - startTime;

    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        if (i < candidateUrls.length - 1) {
          continue;
        }
        return {
          success: false,
          latencyMs,
          errorMessage: `AI 网关返回了 HTML 网页而非 JSON 数据 (请检查端点路径: ${modelsUrl})`
        };
      }

      const text = await res.text().catch(() => '');
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch {
        if (i < candidateUrls.length - 1) {
          continue;
        }
        return {
          success: false,
          latencyMs,
          errorMessage: `AI 网关返回了非 JSON 格式响应 (请检查端点路径: ${modelsUrl})`
        };
      }

      const errorMsg =
        typeof data?.error === 'string'
          ? data.error
          : data?.error?.message ||
            (typeof data?.message === 'string' && !Array.isArray(data?.data) && !Array.isArray(data?.models)
              ? data.message
              : typeof data?.detail === 'string' && !Array.isArray(data?.data) && !Array.isArray(data?.models)
              ? data.detail
              : null);
      if (errorMsg) {
        return {
          success: false,
          latencyMs,
          errorMessage: formatLlmErrorMessage(errorMsg, res.status, baseUrl)
        };
      }

      let modelsList: any[] = [];
      if (Array.isArray(data)) {
        modelsList = data;
      } else if (Array.isArray(data?.data)) {
        modelsList = data.data;
      } else if (Array.isArray(data?.models)) {
        modelsList = data.models;
      } else if (Array.isArray(data?.model)) {
        modelsList = data.model;
      }
      const availableModels = modelsList
        .map((m: any) => (typeof m === 'string' ? m.trim() : (m?.id || m?.name || m?.model || '').trim()))
        .filter(Boolean)
        .map((id: string) => id.replace(/^models\//, ''))
        .filter((val: string, idx: number, arr: string[]) => arr.indexOf(val) === idx);

      if (availableModels.length === 0 && i < candidateUrls.length - 1) {
        continue;
      }

      const firstModelId = availableModels[0] || '';
      return {
        success: true,
        latencyMs,
        modelsCount: availableModels.length,
        modelUsed: cleanModel || firstModelId || getDefaultModelForBaseUrl(baseUrl),
        availableModels
      };
    }

    lastStatus = res.status;

    // Direct auth error or client/quota error (400, 401, 403, 429), do not fallback
    if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 429) {
      const text = await res.text().catch(() => '');
      let msg = '';
      try {
        const errJson = JSON.parse(text);
        msg = typeof errJson?.error === 'string' ? errJson.error : (errJson?.error?.message || errJson?.message || errJson?.detail);
      } catch {}
      if (!msg) {
        msg = (res.status === 401 || res.status === 403 ? `鉴权失败 (HTTP ${res.status})` : (text ? text.slice(0, 150) : `HTTP ${res.status}`));
      }
      return {
        success: false,
        latencyMs,
        errorMessage: formatLlmErrorMessage(msg, res.status, baseUrl)
      };
    }

    // If 404 or 405 (endpoint not found) and another candidate is available, probe next
    if ((res.status === 404 || res.status === 405) && i < candidateUrls.length - 1) {
      continue;
    }

    // If 404 or 405 and no more candidates, fallback to chat completions
    if (res.status === 404 || res.status === 405) {
      return await testChatFallback(baseUrl, apiKey, cleanModel, timeoutMs, startTime);
    }

    const text = await res.text().catch(() => '');
    let errText = '';
    try {
      const errJson = JSON.parse(text);
      errText = typeof errJson?.error === 'string' ? errJson.error : (errJson?.error?.message || errJson?.message || errJson?.detail);
    } catch {}
    if (!errText) {
      errText = text ? text.slice(0, 100) : '';
    }
    return {
      success: false,
      latencyMs,
      errorMessage: formatLlmErrorMessage(errText ? `HTTP ${res.status}: ${errText}` : `HTTP ${res.status}`, res.status, baseUrl)
    };
  }

  return await testChatFallback(baseUrl, apiKey, cleanModel, timeoutMs, startTime);
}

/**
 * Direct execution of LLM chat completion via fetch().
 */
export async function callLlmChatDirect(config: LlmConfig, params: LlmChatParams): Promise<string> {
  const rawUrl = (config.apiBaseUrl || '').trim();
  let apiKey = normalizeApiKey(config.apiKey || '');

  // If apiKey is empty but present in query params (e.g. ?key=AIzaSy...)
  if (!apiKey && rawUrl.includes('?')) {
    try {
      const match = rawUrl.match(/[?&]key=([^&#]+)/i);
      if (match && match[1]) {
        apiKey = normalizeApiKey(decodeURIComponent(match[1]));
      }
    } catch (_) {}
  }

  const baseUrl = normalizeBaseUrl(rawUrl);
  const rawModelName = (config.modelName || '').trim();
  const cleanModel = rawModelName.replace(/^models\//, '');

  if (!baseUrl) {
    throw new Error('缺少 API Base URL');
  }
  if (!apiKey) {
    throw new Error('缺少 API Key');
  }

  const timeoutMs = config.timeoutMs || 30000;
  const { signal, cleanup } = createTimeoutSignal(timeoutMs);

  try {
    const defaultModel = cleanModel || getDefaultModelForBaseUrl(baseUrl);
    const url = `${baseUrl}/chat/completions`;
    const payload: Record<string, any> = {
      model: defaultModel,
      messages: params.messages,
      temperature: params.temperature ?? 0.3
    };

    if (params.responseFormatJson) {
      payload.response_format = { type: 'json_object' };
    }
    if (typeof params.maxTokens === 'number') {
      payload.max_tokens = params.maxTokens;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: getRequestHeaders(apiKey, baseUrl),
      body: JSON.stringify(payload),
      signal
    });

    cleanup();

    if (!res.ok) {
      if (res.status === 400 && params.responseFormatJson) {
        // Some models or third-party proxies reject response_format: { type: 'json_object' }
        // Resiliently retry without response_format
        const fallbackPayload = { ...payload };
        delete fallbackPayload.response_format;
        try {
          const fallbackRes = await fetch(url, {
            method: 'POST',
            headers: getRequestHeaders(apiKey, baseUrl),
            body: JSON.stringify(fallbackPayload),
            signal
          });
          if (fallbackRes.ok) {
            cleanup();
            const fallbackData = await fallbackRes.json();
            const fbChoice = fallbackData?.choices?.[0];
            const fbContent = fbChoice?.message?.content;
            if (typeof fbContent === 'string') {
              return fbContent;
            }
          }
        } catch (_) {}
      }

      if (res.status === 404) {
        let altUrl = '';
        if (!baseUrl.endsWith('/v1') && !baseUrl.includes('googleapis.com')) {
          altUrl = `${baseUrl}/v1/chat/completions`;
        } else if (baseUrl.endsWith('/v1')) {
          altUrl = `${baseUrl.slice(0, -3)}/chat/completions`;
        }

        if (altUrl) {
          try {
            const altRes = await fetch(altUrl, {
              method: 'POST',
              headers: getRequestHeaders(apiKey, baseUrl),
              body: JSON.stringify(payload),
              signal
            });
            if (altRes.ok) {
              cleanup();
              const altData = await altRes.json();
              const altChoice = altData?.choices?.[0];
              const altContent = altChoice?.message?.content;
              const finishReason = (altChoice?.finish_reason || '').toLowerCase();
              if (finishReason === 'safety' || finishReason === 'content_filter') {
                throw new Error(`LLM 请求被安全审查策略拦截 (finish_reason: ${finishReason})`);
              }
              if (typeof altContent === 'string') {
                return altContent;
              }
            }
          } catch (altErr: any) {
            if (altErr?.message?.includes('安全审查')) throw altErr;
          }
        }
      }

      const text = await res.text().catch(() => '');
      let rawErrMsg = '';
      try {
        const errJson = JSON.parse(text);
        rawErrMsg = typeof errJson?.error === 'string' ? errJson.error : (errJson?.error?.message || errJson?.message || errJson?.detail);
      } catch {}
      if (!rawErrMsg) {
        const isHtml = text.trim().startsWith('<') || /<html|<!doctype/i.test(text);
        if (!isHtml && text) {
          rawErrMsg = text.slice(0, 150);
        } else {
          rawErrMsg = `HTTP ${res.status} ${res.statusText || ''}`.trim();
        }
      }
      const errMsg = formatLlmErrorMessage(rawErrMsg, res.status, baseUrl);
      throw new Error(`LLM 请求失败 (${res.status}): ${errMsg}`);
    }

    const data = await res.json();
    const firstChoice = data?.choices?.[0];
    const content = firstChoice?.message?.content;

    const finishReason = (firstChoice?.finish_reason || '').toLowerCase();
    if (finishReason === 'safety' || finishReason === 'content_filter') {
      throw new Error(`LLM 请求被安全审查策略拦截 (finish_reason: ${finishReason})`);
    }

    if (typeof content !== 'string') {
      throw new Error('LLM 响应未包含有效文本内容 (choices[0].message.content)');
    }

    return content;
  } catch (err: any) {
    cleanup();
    if (err?.name === 'AbortError' || err?.message?.includes('timed out')) {
      throw new Error(`LLM 请求超时 (${timeoutMs}ms)`);
    }
    throw err;
  }
}

/**
 * Unified connection test with transparent background proxying when running in browser content scripts.
 */
export async function testAiConnection(config: LlmConfig): Promise<ConnectionTestResult> {
  if (shouldProxyViaBackground()) {
    try {
      return await proxyViaBackground<ConnectionTestResult>('TEST_AI_CONNECTION', { config });
    } catch (err: any) {
      if (isExtensionContextInvalidatedError(err)) {
        return {
          success: false,
          latencyMs: 0,
          errorMessage: EXTENSION_CONTEXT_INVALIDATED_MESSAGE
        };
      }
      if (err?.isLlmError) {
        return {
          success: false,
          latencyMs: 0,
          errorMessage: err.message
        };
      }
      console.warn('[llmClient] Background proxy transport error, falling back to direct fetch:', err);
    }
  }
  return testAiConnectionDirect(config);
}

/**
 * Unified LLM chat completion with transparent background proxying when running in browser content scripts.
 */
export async function callLlmChat(config: LlmConfig, params: LlmChatParams): Promise<string> {
  if (shouldProxyViaBackground()) {
    try {
      return await proxyViaBackground<string>('LLM_CHAT_REQUEST', { config, params });
    } catch (err: any) {
      if (err?.isLlmError) {
        throw err;
      }
      const isContextInvalidated = /extension context invalidated/i.test(err?.message || '');
      if (isContextInvalidated) {
        console.warn('[llmClient] Extension context invalidated; falling back to direct fetch with friendly retry.');
      } else {
        console.warn('[llmClient] Background proxy transport error, falling back to direct fetch:', err);
      }
    }
  }

  let retries = 0;
  const maxRetries = 1;
  while (retries <= maxRetries) {
    try {
      return await callLlmChatDirect(config, params);
    } catch (err: any) {
      if (err?.isLlmError || /安全审查/i.test(err?.message || '')) {
        throw err;
      }
      if (retries < maxRetries) {
        retries++;
        await new Promise(r => setTimeout(r, 600));
        continue;
      }
      throw err;
    }
  }
  return callLlmChatDirect(config, params);
}

export type StreamChunkCallback = (delta: string, accumulated: string) => void;

/**
 * Direct execution of LLM chat completion with streaming output via fetch() and Server-Sent Events (SSE).
 */
export async function callLlmChatStreamDirect(
  config: LlmConfig,
  params: LlmChatParams,
  onChunk: StreamChunkCallback,
  externalSignal?: AbortSignal
): Promise<string> {
  const rawUrl = (config.apiBaseUrl || '').trim();
  let apiKey = normalizeApiKey(config.apiKey || '');

  if (!apiKey && rawUrl.includes('?')) {
    try {
      const match = rawUrl.match(/[?&]key=([^&#]+)/i);
      if (match && match[1]) {
        apiKey = normalizeApiKey(decodeURIComponent(match[1]));
      }
    } catch (_) {}
  }

  const baseUrl = normalizeBaseUrl(rawUrl);
  const rawModelName = (config.modelName || '').trim();
  const cleanModel = rawModelName.replace(/^models\//, '');

  if (!baseUrl) {
    throw new Error('缺少 API Base URL');
  }
  if (!apiKey) {
    throw new Error('缺少 API Key');
  }

  const timeoutMs = config.timeoutMs || 45000;
  const { signal, cleanup } = createTimeoutSignal(timeoutMs, externalSignal);

  try {
    const defaultModel = cleanModel || getDefaultModelForBaseUrl(baseUrl);
    const url = `${baseUrl}/chat/completions`;
    const payload: Record<string, any> = {
      model: defaultModel,
      messages: params.messages,
      temperature: params.temperature ?? 0.3,
      stream: true
    };

    if (params.responseFormatJson) {
      payload.response_format = { type: 'json_object' };
    }
    if (typeof params.maxTokens === 'number') {
      payload.max_tokens = params.maxTokens;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: getRequestHeaders(apiKey, baseUrl),
      body: JSON.stringify(payload),
      signal
    });

    if (!res.ok) {
      cleanup();
      const text = await res.text().catch(() => '');
      let rawErrMsg = '';
      try {
        const errJson = JSON.parse(text);
        rawErrMsg = typeof errJson?.error === 'string' ? errJson.error : (errJson?.error?.message || errJson?.message || errJson?.detail);
      } catch {}
      if (!rawErrMsg) {
        const isHtml = text.trim().startsWith('<') || /<html|<!doctype/i.test(text);
        if (!isHtml && text) {
          rawErrMsg = text.slice(0, 150);
        } else {
          rawErrMsg = `HTTP ${res.status} ${res.statusText || ''}`.trim();
        }
      }
      const errMsg = formatLlmErrorMessage(rawErrMsg, res.status, baseUrl);
      throw new Error(`LLM 流式请求失败 (${res.status}): ${errMsg}`);
    }

    if (!res.body) {
      cleanup();
      throw new Error('LLM 响应未返回可读数据流 (res.body is null)');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let accumulated = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (trimmed === 'data: [DONE]') continue;
          if (trimmed.startsWith('data: ')) {
            try {
              const dataStr = trimmed.slice(6).trim();
              if (dataStr === '[DONE]') continue;
              const json = JSON.parse(dataStr);
              if (json?.error) {
                const streamErrMsg = json.error.message || json.error.code || JSON.stringify(json.error);
                const formatted = formatLlmErrorMessage(streamErrMsg, undefined, baseUrl);
                throw new Error(`LLM 流式响应错误: ${formatted}`);
              }
              const choice = json.choices?.[0];
              const finishReason = (choice?.finish_reason || '').toLowerCase();
              if (finishReason === 'safety' || finishReason === 'content_filter') {
                throw new Error(`LLM 请求被安全审查策略拦截 (finish_reason: ${finishReason})`);
              }
              const delta = choice?.delta?.content;
              if (typeof delta === 'string' && delta.length > 0) {
                accumulated += delta;
                onChunk(delta, accumulated);
              }
            } catch (err: any) {
              if (err?.message?.includes('安全审查') || err?.message?.includes('LLM 流式响应错误')) throw err;
              // Ignore partial JSON parsing chunk errors
            }
          }
        }
      }

      // Process any trailing bytes
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('data: ')) {
          const dataStr = trimmed.slice(6).trim();
          if (dataStr !== '[DONE]') {
            try {
              const json = JSON.parse(dataStr);
              if (json?.error) {
                const streamErrMsg = json.error.message || json.error.code || JSON.stringify(json.error);
                const formatted = formatLlmErrorMessage(streamErrMsg, undefined, baseUrl);
                throw new Error(`LLM 流式响应错误: ${formatted}`);
              }
              const delta = json.choices?.[0]?.delta?.content;
              if (typeof delta === 'string' && delta.length > 0) {
                accumulated += delta;
                onChunk(delta, accumulated);
              }
            } catch (err: any) {
              if (err?.message?.includes('LLM 流式响应错误')) throw err;
            }
          }
        }
      }
    } finally {
      cleanup();
      reader.releaseLock();
    }

    if (!accumulated && !signal.aborted) {
      throw new Error('LLM 流式响应未产生任何有效文本');
    }

    return accumulated;
  } catch (err: any) {
    cleanup();
    if (externalSignal?.aborted) {
      throw new Error('用户已中断解析');
    }
    if (err?.name === 'AbortError' || err?.message?.includes('timed out')) {
      throw new Error(`LLM 流式请求超时 (${timeoutMs}ms)`);
    }
    throw err;
  }
}

/**
 * Proxy streaming via background Port connection when running in content script.
 */
function streamViaBackground(
  config: LlmConfig,
  params: LlmChatParams,
  onChunk: StreamChunkCallback,
  externalSignal?: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      if (typeof chrome === 'undefined' || !chrome?.runtime?.connect || ('id' in chrome.runtime && !chrome.runtime.id)) {
        const err: any = new Error('Extension context invalidated.');
        err.isContextInvalidated = true;
        return reject(err);
      }

      const port = chrome.runtime.connect({ name: 'LLM_STREAM' });
      let accumulated = '';
      let finished = false;

      const cleanup = () => {
        if (externalSignal) {
          externalSignal.removeEventListener('abort', onAbort);
        }
      };

      const onAbort = () => {
        if (!finished) {
          finished = true;
          cleanup();
          try {
            port.postMessage({ type: 'ABORT' });
            port.disconnect();
          } catch (_) {}
          reject(new Error('用户已中断解析'));
        }
      };

      if (externalSignal) {
        if (externalSignal.aborted) {
          return reject(new Error('用户已中断解析'));
        }
        externalSignal.addEventListener('abort', onAbort, { once: true });
      }

      port.onMessage.addListener((msg) => {
        if (msg?.type === 'CHUNK') {
          if (typeof msg.delta === 'string') {
            accumulated += msg.delta;
            onChunk(msg.delta, accumulated);
          }
        } else if (msg?.type === 'DONE') {
          finished = true;
          cleanup();
          try { port.disconnect(); } catch (_) {}
          resolve(accumulated);
        } else if (msg?.type === 'ERROR') {
          finished = true;
          cleanup();
          try { port.disconnect(); } catch (_) {}
          const err: any = new Error(msg.error || 'Stream failed');
          if (msg.isLlmError) err.isLlmError = true;
          reject(err);
        }
      });

      port.onDisconnect.addListener(() => {
        cleanup();
        if (!finished) {
          finished = true;
          const lastErr = chrome.runtime?.lastError;
          const errMsg = lastErr?.message || 'Background streaming channel closed';
          const err: any = new Error(errMsg);
          if (/extension context invalidated/i.test(errMsg)) {
            err.isContextInvalidated = true;
          }
          reject(err);
        }
      });

      port.postMessage({ type: 'START_STREAM', config, params });
    } catch (err: any) {
      if (/extension context invalidated/i.test(err?.message || '')) {
        err.isContextInvalidated = true;
      }
      reject(err);
    }
  });
}

/**
 * Unified LLM chat streaming with transparent background proxying and direct fetch fallback.
 */
export async function callLlmChatStream(
  config: LlmConfig,
  params: LlmChatParams,
  onChunk: StreamChunkCallback,
  externalSignal?: AbortSignal
): Promise<string> {
  if (shouldProxyViaBackground()) {
    try {
      return await streamViaBackground(config, params, onChunk, externalSignal);
    } catch (err: any) {
      if (err?.isLlmError || /安全审查/i.test(err?.message || '')) {
        throw err;
      }
      console.warn('[llmClient] Background stream proxy failed, falling back to direct fetch stream:', err?.message || err);
    }
  }

  return callLlmChatStreamDirect(config, params, onChunk, externalSignal);
}


/**
 * Direct query to GET /v1/models or /models endpoint to fetch all available official models with metadata.
 * Automatically probes both /v1/models and /models for self-hosted or third-party AI gateways (e.g. Sub2API, OneAPI),
 * supports multiple response payload formats ({ data: [{id: ..., owned_by: ...}] }, flat array, etc.),
 * and returns rich FetchedModel[] objects for grouped dropdown display like cc-switch.
 */
export async function fetchAvailableModelsDetailedDirect(config: LlmConfig): Promise<FetchedModel[]> {
  const rawUrl = (config.apiBaseUrl || '').trim();
  let apiKey = normalizeApiKey(config.apiKey || '');
  if (!apiKey && rawUrl.includes('?')) {
    try {
      const match = rawUrl.match(/[?&]key=([^&#]+)/i);
      if (match && match[1]) {
        apiKey = normalizeApiKey(decodeURIComponent(match[1]));
      }
    } catch (_) {}
  }

  const baseUrl = normalizeBaseUrl(rawUrl);
  if (!baseUrl) {
    throw new Error('缺少 API Base URL');
  }
  if (!apiKey) {
    throw new Error('缺少 API Key，请先输入密钥');
  }

  // Auto-probe candidate endpoints (/v1/models, /models, stripped subpaths)
  const candidateUrls = getCandidateModelUrls(baseUrl);

  const timeoutMs = config.timeoutMs || 12000;
  let lastError: Error | null = null;
  let lastStatus: number | null = null;
  let lastStatusText = '';

  for (let i = 0; i < candidateUrls.length; i++) {
    const modelsUrl = candidateUrls[i];
    const { signal, cleanup } = createTimeoutSignal(timeoutMs);

    let res: Response;
    try {
      res = await fetch(modelsUrl, {
        method: 'GET',
        headers: getRequestHeaders(apiKey, baseUrl),
        signal
      });
    } catch (fetchErr: any) {
      cleanup();
      if (fetchErr?.name === 'AbortError' || fetchErr?.message?.includes('timed out') || fetchErr?.message?.includes('aborted')) {
        throw new Error(`获取模型超时 (${timeoutMs / 1000}s)，AI 网关无响应`);
      }
      lastError = fetchErr;
      if (i < candidateUrls.length - 1) {
        continue;
      }
      throw new Error(`网络连接失败: ${fetchErr.message || '无法连接到 AI 网关'}`);
    }
    cleanup();

    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        if (i < candidateUrls.length - 1) {
          continue;
        }
        throw new Error(`AI 网关返回了 HTML 网页而非 JSON 数据 (请检查端点路径: ${modelsUrl})`);
      }

      const text = await res.text().catch(() => '');
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch {
        if (i < candidateUrls.length - 1) {
          continue;
        }
        throw new Error(`AI 网关返回了非 JSON 格式响应 (请检查端点路径: ${modelsUrl})`);
      }

      const errorMsg =
        typeof data?.error === 'string'
          ? data.error
          : data?.error?.message ||
            (typeof data?.message === 'string' && !Array.isArray(data?.data) && !Array.isArray(data?.models)
              ? data.message
              : typeof data?.detail === 'string' && !Array.isArray(data?.data) && !Array.isArray(data?.models)
              ? data.detail
              : null);
      if (errorMsg) {
        throw new Error(formatLlmErrorMessage(errorMsg, res.status, baseUrl));
      }

      let rawList: any[] = [];
      if (Array.isArray(data)) {
        rawList = data;
      } else if (Array.isArray(data?.data)) {
        rawList = data.data;
      } else if (Array.isArray(data?.models)) {
        rawList = data.models;
      } else if (Array.isArray(data?.model)) {
        rawList = data.model;
      }

      const models: FetchedModel[] = (rawList
        .map((m: any): FetchedModel | null => {
          if (typeof m === 'string') {
            const cleanId = m.trim().replace(/^models\//, '');
            return cleanId ? { id: cleanId, ownedBy: null } : null;
          }
          const rawId = (m?.id || m?.name || m?.model || '').trim().replace(/^models\//, '');
          if (!rawId) return null;
          const ownedBy = typeof m?.owned_by === 'string' ? m.owned_by.trim() : (typeof m?.ownedBy === 'string' ? m.ownedBy.trim() : null);
          return { id: rawId, ownedBy: ownedBy || null };
        })
        .filter((item: FetchedModel | null): item is FetchedModel => Boolean(item)));

      // Deduplicate by model id
      const seen = new Set<string>();
      const deduplicated: FetchedModel[] = [];
      for (const m of models) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          deduplicated.push(m);
        }
      }

      if (deduplicated.length === 0 && i < candidateUrls.length - 1) {
        continue;
      }

      return deduplicated;
    }

    lastStatus = res.status;
    // If 404 or 405 (endpoint path not found) and another candidate is available, probe next candidate
    if ((res.status === 404 || res.status === 405) && i < candidateUrls.length - 1) {
      continue;
    }

    const text = await res.text().catch(() => '');
    let errMsg = '';
    try {
      const errJson = JSON.parse(text);
      errMsg = typeof errJson?.error === 'string' ? errJson.error : (errJson?.error?.message || errJson?.message || errJson?.detail);
    } catch {}
    if (!errMsg) {
      errMsg = (res.status === 401 || res.status === 403) ? `API Key 无效或无权限 (HTTP ${res.status})` : (text ? text.slice(0, 150) : `HTTP ${res.status}`);
    }
    lastStatusText = errMsg;

    // Authentication or permission errors: fail immediately
    if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 429) {
      throw new Error(formatLlmErrorMessage(errMsg, res.status, baseUrl));
    }

    if (res.status === 404) {
      throw new Error(formatLlmErrorMessage(`未找到模型端点 (HTTP 404): ${modelsUrl}`, 404, baseUrl));
    }

    const formatted = formatLlmErrorMessage(lastStatusText, res.status, baseUrl);
    throw new Error(`获取模型失败: ${formatted}`);
  }

  if (lastStatus) {
    const formatted = formatLlmErrorMessage(lastStatusText || `HTTP ${lastStatus}`, lastStatus, baseUrl);
    throw new Error(`获取模型失败: ${formatted}`);
  }

  if (lastError) {
    throw new Error(`网络连接失败: ${lastError.message || '无法连接到 AI 网关'}`);
  }

  return [];
}

/**
 * Direct query to GET /v1/models or /models returning string[] ids for backward compatibility.
 */
export async function fetchAvailableModelsDirect(config: LlmConfig): Promise<string[]> {
  const detailed = await fetchAvailableModelsDetailedDirect(config);
  return detailed.map((m: any) => typeof m === 'string' ? m : m.id);
}

/**
 * Unified query to retrieve official available models with metadata from provider gateway.
 */
export async function fetchAvailableModelsDetailed(config: LlmConfig): Promise<FetchedModel[]> {
  if (shouldProxyViaBackground()) {
    try {
      const res = await proxyViaBackground<any[]>('FETCH_AVAILABLE_MODELS_DETAILED', { config });
      if (Array.isArray(res)) {
        return res.map(m => typeof m === 'string' ? { id: m, ownedBy: null } : m);
      }
      return res;
    } catch (err: any) {
      if (isExtensionContextInvalidatedError(err)) {
        throw err;
      }
      const errMsg = err?.message || '';
      const isProxyTransportError =
        errMsg.includes('Background service worker returned empty response') ||
        errMsg.includes('Chrome runtime message failed') ||
        errMsg.includes('Could not establish connection');
      if (!isProxyTransportError) {
        throw err;
      }
      console.warn('[llmClient] Background proxy transport error for fetchAvailableModelsDetailed, falling back to direct fetch:', err);
    }
  }
  return fetchAvailableModelsDetailedDirect(config);
}

/**
 * Unified query to retrieve official available models from the provider gateway (string array).
 */
export async function fetchAvailableModels(config: LlmConfig): Promise<string[]> {
  const models = await fetchAvailableModelsDetailed(config);
  return models.map((m: any) => typeof m === 'string' ? m : m.id);
}
