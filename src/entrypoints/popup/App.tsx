import React, { useState } from 'react';
import { Sparkles, Key, HardDrive, Download, Check, Loader2, Wifi, CheckCircle2, XCircle, Save, Sliders, Subtitles } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { AI_PRESETS, AiProvider, ConnectionTestResult, SupportedLang, SubtitleMode } from '@/types';
import { testAiConnection } from '@/core/api/llmClient';
import { getLocale, formatString } from '@/core/i18n';
import { SearchableModelSelect } from '@/ui/components/SearchableModelSelect';
import { ensureAiHostPermission } from '@/core/api/hostPermission';

const App: React.FC = () => {
  const { settings, updateSettings, savedWords, exportSavedWordsAnki } = useAppStore();
  const t = getLocale(settings.uiLanguage);
  const [copied, setCopied] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [isSaved, setIsSaved] = useState(false);

  const handleExport = () => {
    const data = exportSavedWordsAnki();
    const blob = new Blob([data], { type: 'text/tab-separated-values;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `glean_words_${Date.now()}.tsv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSelectProvider = (provider: AiProvider) => {
    const preset = AI_PRESETS[provider];
    updateSettings({
      aiProvider: provider,
      apiBaseUrl: preset.apiBaseUrl,
      modelName: preset.modelName
    });
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    if (!settings.apiKey) {
      setTestResult({
        success: false,
        latencyMs: 0,
        errorMessage: '请先填写 API Key'
      });
      return;
    }

    const hasPermission = await ensureAiHostPermission(settings.apiBaseUrl);
    if (!hasPermission) {
      setTestResult({ success: false, latencyMs: 0, errorMessage: '需要授权访问当前 AI 服务域名' });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const result = await testAiConnection({
        apiBaseUrl: settings.apiBaseUrl || AI_PRESETS[settings.aiProvider]?.apiBaseUrl,
        apiKey: settings.apiKey,
        modelName: settings.modelName || AI_PRESETS[settings.aiProvider]?.modelName
      });
      setTestResult(result);
    } catch (err: any) {
      setTestResult({
        success: false,
        latencyMs: 0,
        errorMessage: err?.message || '连接失败'
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveConfig = async () => {
    if (settings.apiKey && !(await ensureAiHostPermission(settings.apiBaseUrl))) {
      setTestResult({ success: false, latencyMs: 0, errorMessage: '未获得当前 AI 服务域名的访问权限' });
      return;
    }
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  return (
    <div className="w-[380px] p-4 bg-[#121214] text-gray-100 font-sans text-xs space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-[#2e2e38]">
        <div className="flex items-center space-x-2">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm shadow-md shadow-blue-600/20">
            G
          </div>
          <div>
            <h1 className="font-bold text-sm text-gray-100">{t.appName}</h1>
            <p className="text-[10px] text-gray-400">{t.appSubtitle}</p>
          </div>
        </div>
        <span className="text-[10px] bg-blue-950 text-blue-400 px-1.5 py-0.5 rounded border border-blue-800">
          {t.version}
        </span>
      </div>

      {/* Language Switcher Bar */}
      <div className="flex items-center justify-between bg-[#18181b] px-3 py-2 rounded-lg border border-[#2e2e38]">
        <span className="text-[11px] text-gray-300 font-medium">{t.uiLanguage}:</span>
        <div className="flex space-x-1">
          {(['zh-CN', 'en', 'ja'] as SupportedLang[]).map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => updateSettings({ uiLanguage: lang })}
              className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                (settings.uiLanguage || 'zh-CN') === lang
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-[#242429] border-[#2e2e38] text-gray-400 hover:text-gray-200'
              }`}
            >
              {t.lang[lang]}
            </button>
          ))}
        </div>
      </div>

      {/* Target platform badges */}
      <div className="bg-[#18181b] p-2.5 rounded-lg border border-[#2e2e38] space-y-1.5">
        <div className="text-[11px] font-semibold text-gray-300 flex items-center space-x-1.5">
          <HardDrive size={13} className="text-emerald-400" />
          <span>{t.popup.supportedPlatforms}</span>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[10px]">
          <span className="bg-[#242429] px-2 py-0.5 rounded text-emerald-300 border border-emerald-500/30">
            {t.popup.quarkPan}
          </span>
          <span className="bg-[#242429] px-2 py-0.5 rounded text-blue-300 border border-blue-500/30">
            {t.popup.youtube}
          </span>
          <span className="bg-[#242429] px-2 py-0.5 rounded text-purple-300 border border-purple-500/30">
            {t.popup.html5Video}
          </span>
        </div>
      </div>

      {/* Subtitle Appearance & Background Opacity Section */}
      <div className="bg-[#18181b] p-3 rounded-lg border border-[#2e2e38] space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-gray-200 flex items-center space-x-1.5">
            <Sliders size={13} className="text-blue-400" />
            <span>字幕外观与背景</span>
          </span>
          <span className="text-[11px] font-mono font-semibold text-blue-400">
            {Math.round((settings.subtitleOpacity ?? 0.85) * 100)}%
          </span>
        </div>

        {/* Opacity Slider */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px] text-gray-400">
            <span>卡片背景不透明度</span>
            <div className="flex space-x-1">
              {[
                { label: '0% (纯文字)', val: 0 },
                { label: '50%', val: 0.5 },
                { label: '85%', val: 0.85 },
                { label: '100%', val: 1.0 }
              ].map((p) => (
                <button
                  key={p.val}
                  type="button"
                  onClick={() => updateSettings({ subtitleOpacity: p.val })}
                  className={`px-1.5 py-0.5 rounded text-[9px] border transition-colors ${
                    (settings.subtitleOpacity ?? 0.85) === p.val
                      ? 'bg-blue-600/30 border-blue-500 text-blue-300 font-medium'
                      : 'bg-[#242429] border-[#2e2e38] text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={Math.round((settings.subtitleOpacity ?? 0.85) * 100)}
            onChange={(e) => updateSettings({ subtitleOpacity: parseInt(e.target.value, 10) / 100 })}
            className="w-full accent-blue-500 cursor-pointer h-1.5 bg-[#2a2a32] rounded-lg appearance-none"
          />
        </div>
      </div>

      {/* Subtitle Mode & Mixed Mode Configuration Section */}
      <div className="bg-[#18181b] p-3 rounded-lg border border-[#2e2e38] space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-gray-200 flex items-center space-x-1.5">
            <Subtitles size={13} className="text-emerald-400" />
            <span>字幕展示模式</span>
          </span>
          <span className="text-[10px] text-gray-400">
            {settings.subtitleMode === 'both' ? '双语' : settings.subtitleMode === 'mixed' ? '中英混合' : settings.subtitleMode === 'target' ? '仅外语' : settings.subtitleMode === 'translation' ? '仅中文' : '关闭'}
          </span>
        </div>

        {/* 5-Mode Switcher Grid */}
        <div className="grid grid-cols-5 gap-1 text-[10px]">
          {[
            { id: 'both', label: '双语' },
            { id: 'mixed', label: '中英混合' },
            { id: 'target', label: '仅外语' },
            { id: 'translation', label: '仅中文' },
            { id: 'hidden', label: '关闭' }
          ].map((m) => {
            const isSelected = settings.subtitleMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => updateSettings({
                  subtitleMode: m.id as SubtitleMode,
                  showEnglish: m.id === 'both' || m.id === 'target' || m.id === 'mixed',
                  showChinese: m.id === 'both' || m.id === 'translation'
                })}
                className={`py-1.5 rounded font-medium border text-center transition-colors ${
                  isSelected
                    ? 'bg-blue-600 border-blue-500 text-white shadow-sm'
                    : 'bg-[#242429] border-[#2e2e38] text-gray-400 hover:text-gray-200'
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>

        {/* Mixed Mode Custom Options Sub-Card */}
        <div className="bg-[#121214] p-2 rounded border border-[#2a2a32] space-y-2 text-[11px]">
          <div className="text-gray-300 font-medium text-[10px] flex items-center space-x-1 text-emerald-300">
            <Sparkles size={11} />
            <span>中英混合模式专属配置</span>
          </div>

          <label className="flex items-center space-x-2 cursor-pointer text-gray-300 hover:text-white">
            <input
              type="checkbox"
              checked={Boolean(settings.showTranslationInMixedMode)}
              onChange={(e) => updateSettings({ showTranslationInMixedMode: e.target.checked })}
              className="rounded accent-blue-500 bg-[#24242b] border-[#383842]"
            />
            <span>下方同时显示整句中文翻译 (默认关闭，仅显混合行)</span>
          </label>

          <div className="space-y-1">
            <div className="text-[10px] text-gray-400">词汇语境释义范围:</div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => updateSettings({ mixedModeFilterLevel: 'all_content' })}
                className={`py-1 px-2 rounded text-[10px] border text-center transition-colors ${
                  (settings.mixedModeFilterLevel || 'all_content') === 'all_content'
                    ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300 font-medium'
                    : 'bg-[#18181b] border-[#2e2e38] text-gray-400 hover:text-gray-200'
                }`}
              >
                全部实词注释 (推荐)
              </button>
              <button
                type="button"
                onClick={() => updateSettings({ mixedModeFilterLevel: 'advanced_only' })}
                className={`py-1 px-2 rounded text-[10px] border text-center transition-colors ${
                  settings.mixedModeFilterLevel === 'advanced_only'
                    ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300 font-medium'
                    : 'bg-[#18181b] border-[#2e2e38] text-gray-400 hover:text-gray-200'
                }`}
              >
                仅中高级词 (B1+)
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* AI Configuration Section */}
      <div className="space-y-2.5 bg-[#18181b] p-3 rounded-lg border border-[#2e2e38]">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-gray-200 flex items-center space-x-1.5">
            <Key size={13} className="text-amber-400" />
            <span>{t.popup.aiConfigTitle}</span>
          </span>
          <span className="text-[10px] text-gray-400">
            {AI_PRESETS[settings.aiProvider]?.name || '自定义'}
          </span>
        </div>

        {/* Provider Presets Tabs */}
        <div className="space-y-1.5">
          <label className="text-gray-400 block text-[10px]">{t.popup.selectPreset}</label>
          <div className="grid grid-cols-2 gap-1.5">
            {(['google', 'openai', 'deepseek', 'sub2api', 'grok', 'custom'] as AiProvider[]).map((prov) => {
              const preset = AI_PRESETS[prov];
              const isSelected = settings.aiProvider === prov;
              return (
                <button
                  key={prov}
                  type="button"
                  onClick={() => handleSelectProvider(prov)}
                  className={`px-2.5 py-1.5 rounded text-left transition-all border ${
                    isSelected
                      ? 'bg-blue-600/20 border-blue-500 text-blue-300 font-medium'
                      : 'bg-[#141416] border-[#2e2e38] text-gray-300 hover:border-gray-600'
                  } ${prov === 'custom' ? 'col-span-2' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate">{preset.name}</span>
                    {prov === 'sub2api' && (
                      <span className="text-[9px] bg-emerald-500/20 text-emerald-300 px-1 py-0.2 rounded border border-emerald-500/30">
                        {t.settingsModal.badgeDedicated || '自建'}
                      </span>
                    )}
                    {prov === 'grok' && (
                      <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1 py-0.2 rounded border border-amber-500/30">
                        {t.settingsModal.badgeDedicated || '专用'}
                      </span>
                    )}
                    {prov === 'google' && (
                      <span className="text-[9px] bg-sky-500/20 text-sky-300 px-1 py-0.2 rounded border border-sky-500/30">
                        {t.settingsModal.badgeOfficial || '官方'}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* API Form Inputs */}
        <div className="space-y-2 pt-1">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-gray-400 text-[10px]">API Key:</label>
              {settings.aiProvider === 'google' ? (
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-sky-400 hover:underline"
                >
                  {t.settingsModal.googleStudioHint || 'Google AI Studio'}
                </a>
              ) : null}
            </div>
            <input
              type="password"
              value={settings.apiKey}
              onChange={(e) => updateSettings({ apiKey: e.target.value })}
              placeholder={AI_PRESETS[settings.aiProvider]?.defaultKeyHint || 'sk-...'}
              className="w-full bg-[#121214] border border-[#383842] rounded px-2 py-1 text-gray-200 text-xs focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="text-gray-400 block text-[10px] mb-1">API Base URL:</label>
            <input
              type="text"
              value={settings.apiBaseUrl}
              onChange={(e) => updateSettings({ apiBaseUrl: e.target.value })}
              placeholder={
                settings.aiProvider === 'custom'
                  ? 'https://api.your-gateway.com/v1'
                  : AI_PRESETS[settings.aiProvider]?.apiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta/openai'
              }
              className="w-full bg-[#121214] border border-[#383842] rounded px-2 py-1 text-gray-200 text-xs focus:outline-none focus:border-blue-500 font-mono text-[11px]"
            />
          </div>

          <div>
            <label className="text-gray-400 block text-[10px] mb-1">模型名称 (Model):</label>
            <SearchableModelSelect
              ariaLabel="模型名称"
              value={settings.modelName}
              onChange={(modelName) => updateSettings({ modelName })}
              provider={settings.aiProvider || 'google'}
              apiKey={settings.apiKey}
              apiBaseUrl={settings.apiBaseUrl}
              fetchedModels={testResult?.availableModels}
              uiLanguage={settings.uiLanguage}
              placeholder={AI_PRESETS[settings.aiProvider || 'google']?.modelName || 'gemini-2.5-flash'}
            />
          </div>
          <p className="rounded border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 text-[10px] leading-relaxed text-amber-100/70">
            API Key 仅保存在本机。使用 AI 功能时，当前字幕或词汇上下文会发送到你选择的服务商。
          </p>
        </div>

        {/* Connection Test Result Badge */}
        {testResult && (
          <div
            className={`p-2 rounded border text-[11px] flex items-start space-x-1.5 ${
              testResult.success
                ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-300'
                : 'bg-rose-950/40 border-rose-700/60 text-rose-300'
            }`}
          >
            {testResult.success ? (
              <CheckCircle2 size={14} className="shrink-0 mt-0.5 text-emerald-400" />
            ) : (
              <XCircle size={14} className="shrink-0 mt-0.5 text-rose-400" />
            )}
            <div className="space-y-0.5">
              <div className="font-medium">
                {testResult.success
                  ? formatString(t.settingsModal.connectSuccess, { latency: testResult.latencyMs })
                  : t.settingsModal.connectFail}
              </div>
              <div className="text-[10px] opacity-90 break-all">
                {testResult.success
                  ? `模型: ${testResult.modelUsed}${
                      testResult.modelsCount !== undefined
                        ? ` · ${formatString(t.settingsModal.modelsAvailable, { count: testResult.modelsCount })}`
                        : ''
                    }`
                  : testResult.errorMessage}
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons: Test Connection & Save */}
        <div className="flex items-center space-x-2 pt-1">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={isTesting}
            className="flex-1 flex items-center justify-center space-x-1.5 bg-[#24242b] hover:bg-[#2d2d36] disabled:opacity-50 text-gray-200 py-1.5 rounded border border-[#383842] transition-colors"
          >
            {isTesting ? (
              <>
                <Loader2 size={13} className="animate-spin text-blue-400" />
                <span>{t.settingsModal.testing}</span>
              </>
            ) : (
              <>
                <Wifi size={13} className="text-blue-400" />
                <span>{t.settingsModal.testConnection}</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleSaveConfig}
            className="flex-1 flex items-center justify-center space-x-1.5 bg-blue-600 hover:bg-blue-500 text-white py-1.5 rounded transition-colors shadow-sm"
          >
            {isSaved ? (
              <>
                <Check size={13} />
                <span>{t.savedSuccess}</span>
              </>
            ) : (
              <>
                <Save size={13} />
                <span>{t.popup.saveConfig}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Saved Words & Anki */}
      <div className="flex items-center justify-between bg-[#18181b] p-3 rounded-lg border border-[#2e2e38]">
        <div>
          <div className="text-xs font-semibold text-gray-200">{t.transcript.tabSaved}</div>
          <div className="text-[10px] text-gray-400">已保存 {savedWords.length} 个生词</div>
        </div>
        <button
          type="button"
          onClick={handleExport}
          className="flex items-center space-x-1 text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded transition-colors"
        >
          {copied ? <Check size={13} /> : <Download size={13} />}
          <span>{copied ? t.transcript.exportSuccess : '导出 Anki'}</span>
        </button>
      </div>

      {/* Shortcuts Help */}
      <div className="text-[10px] text-gray-400 bg-[#141416] p-2.5 rounded border border-[#2e2e38] space-y-1">
        <div className="font-semibold text-gray-300">常用快捷键：</div>
        <div className="grid grid-cols-2 gap-1 text-gray-400">
          <div><kbd className="bg-[#242429] px-1 py-0.5 rounded text-gray-300">A</kbd> 上一句字幕</div>
          <div><kbd className="bg-[#242429] px-1 py-0.5 rounded text-gray-300">D</kbd> 下一句字幕</div>
          <div><kbd className="bg-[#242429] px-1 py-0.5 rounded text-gray-300">S</kbd> 重播当前句</div>
          <div><kbd className="bg-[#242429] px-1 py-0.5 rounded text-gray-300">Space</kbd> 播放 / 暂停</div>
        </div>
      </div>
    </div>
  );
};

export default App;
