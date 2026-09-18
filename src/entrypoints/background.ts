import { defineBackground } from 'wxt/sandbox';
import { getAiHostPermissionPattern } from '@/core/api/hostPermission';
import {
  testAiConnectionDirect,
  callLlmChatDirect,
  callLlmChatStreamDirect,
  fetchAvailableModelsDirect,
  fetchAvailableModelsDetailedDirect,
  normalizeBaseUrl
} from '@/core/api/llmClient';

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(() => {
    console.log('[VocabFrame] Extension installed successfully.');
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'CHECK_AI_HOST_PERMISSION') {
      const raw = (message?.baseUrl || '').trim();
      if (!raw) {
        sendResponse({ allowed: false });
        return false;
      }
      const normalized = normalizeBaseUrl(raw);
      if (!normalized) {
        sendResponse({ allowed: false });
        return false;
      }
      try {
        const parsed = new URL(normalized);
        if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
          sendResponse({ allowed: false });
          return false;
        }
        if (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
          sendResponse({ allowed: false });
          return false;
        }
      } catch {
        sendResponse({ allowed: false });
        return false;
      }
      const origin = getAiHostPermissionPattern(normalized);
      if (!origin) {
        sendResponse({ allowed: true });
        return false;
      }
      chrome.permissions.contains({ origins: ['https://*/*'] })
        .then(wildcardAllowed => {
          if (wildcardAllowed) {
            sendResponse({ allowed: true });
            return;
          }
          chrome.permissions.contains({ origins: [origin] })
            .then(allowed => sendResponse({ allowed }))
            .catch(() => sendResponse({ allowed: false }));
        })
        .catch(() => {
          chrome.permissions.contains({ origins: [origin] })
            .then(allowed => sendResponse({ allowed }))
            .catch(() => sendResponse({ allowed: false }));
        });
      return true;
    }
    if (message?.type === 'OPEN_AI_SETTINGS') {
      chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') })
        .then(() => sendResponse({ success: true }))
        .catch(() => sendResponse({ success: false }));
      return true;
    }
    if (message?.type === 'TEST_AI_CONNECTION') {
      testAiConnectionDirect(message.config)
        .then((result) => sendResponse({ success: true, data: result }))
        .catch((err) => sendResponse({ success: false, error: err?.message || String(err), isLlmError: true }));
      return true;
    }

    if (message?.type === 'FETCH_AVAILABLE_MODELS') {
      fetchAvailableModelsDirect(message.config)
        .then((models) => sendResponse({ success: true, data: models }))
        .catch((err) => sendResponse({ success: false, error: err?.message || String(err) }));
      return true;
    }

    if (message?.type === 'FETCH_AVAILABLE_MODELS_DETAILED') {
      fetchAvailableModelsDetailedDirect(message.config)
        .then((models) => sendResponse({ success: true, data: models }))
        .catch((err) => sendResponse({ success: false, error: err?.message || String(err) }));
      return true;
    }

    if (message?.type === 'LLM_CHAT_REQUEST') {
      callLlmChatDirect(message.config, message.params)
        .then((content) => sendResponse({ success: true, data: content }))
        .catch((err) => sendResponse({ success: false, error: err?.message || String(err), isLlmError: true }));
      return true;
    }

    return false;
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'LLM_STREAM') {
      let abortController: AbortController | null = null;

      port.onMessage.addListener((message) => {
        if (message?.type === 'START_STREAM') {
          abortController = new AbortController();
          callLlmChatStreamDirect(
            message.config,
            message.params,
            (delta, _acc) => {
              try {
                port.postMessage({ type: 'CHUNK', delta });
              } catch (_) {}
            },
            abortController.signal
          )
            .then(() => {
              try {
                port.postMessage({ type: 'DONE' });
              } catch (_) {}
            })
            .catch((err) => {
              try {
                port.postMessage({
                  type: 'ERROR',
                  error: err?.message || String(err),
                  isLlmError: true
                });
              } catch (_) {}
            });
        } else if (message?.type === 'ABORT') {
          if (abortController) {
            abortController.abort();
          }
        }
      });

      port.onDisconnect.addListener(() => {
        if (abortController) {
          abortController.abort();
        }
      });
    }
  });
});
