import React, { useState } from 'react';
import { AI_PRESETS, AiProvider, ConnectionTestResult } from '@/types';
import { useAppStore } from '@/store/useAppStore';
import { ensureAiHostPermission, getAiHostPermissionPattern } from '@/core/api/hostPermission';
import { EXTENSION_CONTEXT_INVALIDATED_MESSAGE, isExtensionContextInvalidatedError, testAiConnection } from '@/core/api/llmClient';
import { getLocale } from '@/core/i18n';
import { SearchableModelSelect } from './SearchableModelSelect';

export function AiSettingsPanel() {
  const { settings, updateSettings } = useAppStore();
  const t = getLocale(settings.uiLanguage);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [contextInvalidated, setContextInvalidated] = useState(false);
  const fieldClass = 'mt-1 w-full rounded-lg border border-white/15 bg-[#101418] px-3 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-400';
  const contextMessage = settings.uiLanguage === 'en'
    ? 'The extension was updated. Refresh this page and try again.'
    : settings.uiLanguage === 'ja'
    ? '拡張機能が更新されました。このページを再読み込みして、もう一度お試しください。'
    : EXTENSION_CONTEXT_INVALIDATED_MESSAGE;

  const selectProvider = (provider: AiProvider) => {
    const preset = AI_PRESETS[provider];
    updateSettings({ aiProvider: provider, apiBaseUrl: preset.apiBaseUrl, modelName: preset.modelName });
    setResult(null);
    setMessage('');
    setNeedsPermission(false);
    setContextInvalidated(false);
  };

  const authorize = async () => {
    const origin = getAiHostPermissionPattern(settings.apiBaseUrl);
    if (!origin) {
      setNeedsPermission(false);
      return true;
    }

    // Content scripts cannot request optional permissions; use the extension settings page.
    try {
      if (typeof chrome !== 'undefined' && !chrome.permissions) {
        const response = await chrome.runtime.sendMessage({ type: 'CHECK_AI_HOST_PERMISSION', baseUrl: settings.apiBaseUrl });
        if (response?.allowed) { setNeedsPermission(false); return true; }
        setNeedsPermission(true);
        setMessage('配置已保存在本机。此服务需要授权，请打开扩展设置并点击保存配置，授权后返回重试。');
        return false;
      }
      if (await ensureAiHostPermission(settings.apiBaseUrl)) return true;
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) {
        setNeedsPermission(false);
        setContextInvalidated(true);
        setMessage(contextMessage);
        return false;
      }
      throw error;
    }
    setMessage(settings.uiLanguage === 'en' ? 'Check the HTTPS endpoint and authorize this AI host.' : settings.uiLanguage === 'ja' ? 'HTTPS エンドポイントを確認し、AI ホストへのアクセスを許可してください。' : '请检查 HTTPS 服务地址，并授权访问该 AI 服务域名');
    return false;
  };

  const testConnection = async () => {
    setResult(null);
    setMessage('');
    if (!settings.apiKey.trim()) { setMessage(settings.uiLanguage === 'en' ? 'Enter an API Key first.' : settings.uiLanguage === 'ja' ? '先に API キーを入力してください。' : '请先填写 API Key'); return; }
    setBusy(true);
    try {
      if (getAiHostPermissionPattern(settings.apiBaseUrl) && !(await authorize())) return;
      const response = await testAiConnection({
        apiKey: settings.apiKey, apiBaseUrl: settings.apiBaseUrl,
        modelName: settings.modelName, timeoutMs: 15000,
      });
      setResult(response);
      setMessage(response.success ? `${t.settingsModal.connectSuccess.replace('{latency}', String(response.latencyMs))}` : response.errorMessage || t.settingsModal.connectFail);
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) {
        setContextInvalidated(true);
        setMessage(contextMessage);
      } else {
        setMessage(error instanceof Error ? error.message : '连接失败');
      }
    } finally { setBusy(false); }
  };

  const saveConfig = async () => {
    try {
      if (settings.apiKey && getAiHostPermissionPattern(settings.apiBaseUrl) && !(await authorize())) return;
      setMessage('AI 配置已保存');
      updateSettings({ aiProvider: settings.aiProvider, apiKey: settings.apiKey, apiBaseUrl: settings.apiBaseUrl, modelName: settings.modelName });
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) {
        setContextInvalidated(true);
        setMessage(contextMessage);
      } else {
        setMessage(error instanceof Error ? error.message : (settings.uiLanguage === 'en' ? 'Save failed' : settings.uiLanguage === 'ja' ? '保存に失敗しました' : '保存失败'));
      }
    }
  };

  return (
    <section className="space-y-3 border-t border-white/10 pt-4" aria-label="AI 配置">
      <h3 className="text-base font-semibold text-cyan-300">{settings.uiLanguage === 'en' ? 'AI Configuration' : settings.uiLanguage === 'ja' ? 'AI 設定' : 'AI 配置'}</h3>
      <label className="block text-xs text-gray-300">{t.settingsModal.aiProvider}
        <select aria-label="AI 服务商" className={fieldClass} value={settings.aiProvider} onChange={event => selectProvider(event.target.value as AiProvider)}>
          {Object.entries(AI_PRESETS).map(([id, preset]) => <option key={id} value={id}>{preset.name}</option>)}
        </select>
      </label>
      <label className="block text-xs text-gray-300">{t.settingsModal.apiKey}
        <input aria-label="API Key" type="password" autoComplete="off" spellCheck={false} value={settings.apiKey} onChange={event => updateSettings({ apiKey: event.target.value })} className={fieldClass} placeholder={AI_PRESETS[settings.aiProvider]?.defaultKeyHint} />
      </label>
      <label className="block text-xs text-gray-300">{t.settingsModal.apiBaseUrl}
        <input aria-label="API Base URL" type="url" spellCheck={false} value={settings.apiBaseUrl} onChange={event => updateSettings({ apiBaseUrl: event.target.value })} className={fieldClass} placeholder="https://api.example.com/v1" />
      </label>
      <div className="block text-xs text-gray-300">
        <label className="block" htmlFor="lr-ai-model-select">{t.settingsModal.modelName}</label>
        <SearchableModelSelect
          id="lr-ai-model-select"
          ariaLabel="模型名称"
          value={settings.modelName}
          onChange={(modelName) => updateSettings({ modelName })}
          provider={settings.aiProvider}
          apiKey={settings.apiKey}
          apiBaseUrl={settings.apiBaseUrl}
          fetchedModels={result?.availableModels}
          uiLanguage={settings.uiLanguage}
          placeholder={AI_PRESETS[settings.aiProvider]?.modelName}
          className="mt-1"
        />
      </div>
      <p className="text-[11px] leading-relaxed text-gray-400">{settings.uiLanguage === 'en' ? 'Your API key stays on this device. Subtitle and vocabulary context is sent to the selected provider when AI is used.' : settings.uiLanguage === 'ja' ? 'API キーはこの端末に保存されます。AI 使用時、字幕や単語の文脈が選択したプロバイダーに送信されます。' : 'API Key 保存在本机。使用 AI 时，字幕或词汇上下文会发送到所选服务商。'}</p>
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={testConnection} className="flex-1 rounded-lg border border-white/15 px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-50">{busy ? t.settingsModal.testing : t.settingsModal.testConnection}</button>
        <button type="button" disabled={busy} onClick={saveConfig} className="flex-1 rounded-lg bg-cyan-400/15 px-3 py-2 text-xs text-cyan-200 hover:bg-cyan-400/25">{settings.uiLanguage === 'en' ? 'Save AI Configuration' : settings.uiLanguage === 'ja' ? 'AI 設定を保存' : '保存 AI 配置'}</button>
      </div>
      {contextInvalidated && <button type="button" className="text-xs text-cyan-300 underline underline-offset-4" onClick={() => window.location.reload()}>
        {settings.uiLanguage === 'en' ? 'Refresh current page' : settings.uiLanguage === 'ja' ? '現在のページを再読み込み' : '刷新当前页面'}
      </button>}
      {needsPermission && <button type="button" className="text-xs text-cyan-300 underline underline-offset-4" onClick={async () => {
        try { await chrome.runtime.sendMessage({ type: 'OPEN_AI_SETTINGS' }); }
        catch { setMessage('请点击浏览器工具栏中的 Glean 图标，在扩展设置中授权此 AI 服务。'); }
      }}>打开扩展设置授权 AI 服务</button>}
      {message && <p role="status" className="break-words text-xs text-gray-200">{message}</p>}
    </section>
  );
}
