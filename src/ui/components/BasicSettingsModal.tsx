import React, { useEffect, useRef } from 'react';
import { Check, Settings, X } from 'lucide-react';
import { getLocale } from '@/core/i18n';
import { useAppStore } from '@/store/useAppStore';
import { SubtitleMode, SupportedLang, SUPPORTED_TRANSLATION_LANGUAGES, MixedGlossDensity } from '@/types';
import { AiSettingsPanel } from './AiSettingsPanel';
import { AudioSettingsSection } from './AudioSettingsSection';

interface BasicSettingsModalProps {
  open: boolean;
  onClose: () => void;
  children?: React.ReactNode;
}

export const BasicSettingsModal: React.FC<BasicSettingsModalProps> = ({ open, onClose, children }) => {
  const { settings, updateSettings } = useAppStore();
  const t = getLocale(settings.uiLanguage);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previous?.focus();
  }, [open]);

  if (!open) return null;

  const setSubtitleMode = (mode: SubtitleMode) => updateSettings({
    subtitleMode: mode,
    // “双语” always means both source and translated lines, including migrated settings.
    showEnglish: mode === 'both' || mode === 'target' || mode === 'mixed',
    showChinese: mode === 'both' || mode === 'translation',
  });

  const subtitleModeLabel = (mode: SubtitleMode) => ({
    both: t.controlBar.modeBoth,
    mixed: t.controlBar.modeMixed,
    target: t.controlBar.modeTarget,
    translation: t.controlBar.modeTranslation,
    hidden: t.controlBar.modeHidden
  })[mode];

  const densityLabel = (density: MixedGlossDensity) => ({
    low: t.settingsModal.mixedGlossDensityLow || '轻度精要 (1-2 词)',
    medium: t.settingsModal.mixedGlossDensityMedium || '标准均衡 (2-4 词)',
    high: t.settingsModal.mixedGlossDensityHigh || '密集全量 (4-8+ 词)'
  })[density];

  return (
    <div translate="no" className="notranslate fixed inset-0 z-[9999999] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md animate-in fade-in duration-200">
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lr-basic-settings-title"
        className="w-[720px] max-w-full max-h-[90vh] overflow-y-auto rounded-2xl border border-white/15 bg-[#121620]/98 text-gray-100 shadow-[0_30px_90px_rgba(0,0,0,0.85),0_0_1px_1px_rgba(255,255,255,0.1)] font-sans ring-1 ring-black/50"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') onClose();
          if (event.key === 'Tab') {
            const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, [tabindex="0"]') || []);
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && (event.target === first || event.target === dialogRef.current)) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus(); }
          }
        }}
      >
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/10 bg-[#121620]/95 px-6 py-4 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-400/15 text-cyan-300 border border-cyan-400/25 shadow-[0_0_12px_rgba(6,182,212,0.15)]">
              <Settings size={18} />
            </span>
            <div>
              <h2 id="lr-basic-settings-title" className="text-sm font-bold text-white tracking-tight">{t.settingsModal.title}</h2>
              <p className="text-[11px] text-gray-400 font-sans">{t.appSubtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-gray-400 transition-all hover:bg-white/10 hover:text-white active:scale-95"
            title="关闭设置"
          >
            <X size={18} />
          </button>
        </header>

        <div className="space-y-6 p-6">
          {children}
          <AiSettingsPanel />
          <AudioSettingsSection />

          {/* UI Language Segmented Control */}
          <div>
            <label className="mb-2 block text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{t.uiLanguage}</label>
            <div className="grid grid-cols-3 gap-1.5 bg-[#0b0e14] p-1.5 rounded-xl border border-white/10">
              {(['zh-CN', 'en', 'ja'] as SupportedLang[]).map((lang) => {
                const isActive = (settings.uiLanguage || 'zh-CN') === lang;
                return (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => updateSettings({ uiLanguage: lang })}
                    className={`rounded-lg py-2 px-3 text-xs font-medium transition-all duration-200 flex items-center justify-center gap-2 ${
                      isActive
                        ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-400/50 text-cyan-200 font-semibold shadow-sm'
                        : 'border border-transparent text-gray-400 hover:text-gray-200 hover:bg-white/[0.04]'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.8)]' : 'bg-transparent'}`} />
                    <span>{t.lang[lang]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* AI 翻译目标语言选择 */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{t.settingsModal.aiTranslationLang}</label>
              <span className="text-[11px] font-mono text-cyan-300 bg-cyan-950/60 px-2.5 py-0.5 rounded-full border border-cyan-500/30">
                {SUPPORTED_TRANSLATION_LANGUAGES.find(l => l.code === (settings.secondaryLang || 'auto'))?.name || settings.secondaryLang}
              </span>
            </div>
            <select
              aria-label={t.settingsModal.aiTranslationLang}
              value={settings.secondaryLang || 'auto'}
              onChange={(e) => updateSettings({ secondaryLang: e.target.value })}
              className="w-full rounded-xl border border-white/15 bg-[#0b0e14] px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30 transition-all cursor-pointer"
            >
              {SUPPORTED_TRANSLATION_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code} className="bg-[#121620] text-white">
                  {settings.uiLanguage === 'en' ? lang.englishName : lang.name}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[11px] leading-relaxed text-gray-400">
              {t.settingsModal.aiTranslationLangDesc}
            </p>
          </div>

          {/* Subtitle Mode Segmented Control */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{t.settingsModal.defaultSubtitleMode}</label>
              <span className="text-[11px] font-medium text-cyan-300 bg-cyan-950/60 px-2.5 py-0.5 rounded-full border border-cyan-500/30">
                {subtitleModeLabel(settings.subtitleMode)}
              </span>
            </div>
            <div className="grid grid-cols-5 gap-1.5 bg-[#0b0e14] p-1.5 rounded-xl border border-white/10">
              {(['both', 'mixed', 'target', 'translation', 'hidden'] as SubtitleMode[]).map((mode) => {
                const isActive = settings.subtitleMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setSubtitleMode(mode)}
                    className={`rounded-lg py-2 px-1 text-[11px] font-medium transition-all duration-200 flex items-center justify-center gap-1.5 ${
                      isActive
                        ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-400/50 text-cyan-200 font-semibold shadow-sm'
                        : 'border border-transparent text-gray-400 hover:text-gray-200 hover:bg-white/[0.04]'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? 'bg-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.8)]' : 'bg-transparent'}`} />
                    <span className="truncate">{subtitleModeLabel(mode)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* AI 精翻覆盖密度调节 Segmented Control */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{t.settingsModal.mixedGlossDensity}</label>
              <span className="text-[11px] font-medium text-cyan-300 bg-cyan-950/60 px-2.5 py-0.5 rounded-full border border-cyan-500/30">
                {densityLabel(settings.mixedGlossDensity || 'high')}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 bg-[#0b0e14] p-1.5 rounded-xl border border-white/10">
              {(['low', 'medium', 'high'] as MixedGlossDensity[]).map((level) => {
                const isActive = (settings.mixedGlossDensity || 'high') === level;
                return (
                  <button
                    key={level}
                    type="button"
                    onClick={() => updateSettings({ mixedGlossDensity: level })}
                    className={`rounded-lg py-2 px-3 text-xs font-medium transition-all duration-200 flex items-center justify-center gap-2 ${
                      isActive
                        ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-400/50 text-cyan-200 font-semibold shadow-sm'
                        : 'border border-transparent text-gray-400 hover:text-gray-200 hover:bg-white/[0.04]'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.8)]' : 'bg-transparent'}`} />
                    <span>{densityLabel(level)}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-gray-400">
              {t.settingsModal.mixedGlossDensityDesc}
            </p>
          </div>

          {/* 中英混合模式整句中文翻译开关 */}
          {settings.subtitleMode === 'mixed' && (
            <label className="flex items-center justify-between rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-3.5 transition-all cursor-pointer hover:bg-cyan-950/30">
              <div className="pr-4">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-cyan-200">
                  <span>{t.settingsModal.mixedModeShowTranslation}</span>
                </span>
                <span className="mt-1 block text-[11px] leading-relaxed text-gray-400">
                  {t.settingsModal.mixedModeShowTranslationDesc}
                </span>
              </div>
              <input
                type="checkbox"
                checked={Boolean(settings.showTranslationInMixedMode)}
                onChange={(event) => updateSettings({ showTranslationInMixedMode: event.target.checked })}
                className="h-4 w-4 shrink-0 rounded accent-cyan-400 cursor-pointer"
              />
            </label>
          )}

          {/* Range Sliders for Font Sizes */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-[#0b0e14] p-3.5 rounded-xl border border-white/10 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-300 font-medium">{t.settingsModal.subtitleFontSize}</span>
                <span className="px-2 py-0.5 rounded-full font-mono text-xs font-bold bg-cyan-950/60 text-cyan-300 border border-cyan-500/30 shadow-sm">
                  {settings.subtitleFontSize || 23}px
                </span>
              </div>
              <input
                type="range"
                min="14"
                max="36"
                value={settings.subtitleFontSize || 23}
                onChange={(event) => updateSettings({ subtitleFontSize: Number(event.target.value) })}
                className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-400 focus:outline-none"
              />
              <div className="flex justify-between text-[10px] text-gray-500 font-mono">
                <span>14px</span>
                <span>23px (默认)</span>
                <span>36px</span>
              </div>
            </div>

            <div className="bg-[#0b0e14] p-3.5 rounded-xl border border-white/10 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-300 font-medium">{t.settingsModal.transcriptFontSize}</span>
                <span className="px-2 py-0.5 rounded-full font-mono text-xs font-bold bg-cyan-950/60 text-cyan-300 border border-cyan-500/30 shadow-sm">
                  {settings.transcriptFontSize || 15}px
                </span>
              </div>
              <input
                type="range"
                min="12"
                max="24"
                value={settings.transcriptFontSize || 15}
                onChange={(event) => updateSettings({ transcriptFontSize: Number(event.target.value) })}
                className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-400 focus:outline-none"
              />
              <div className="flex justify-between text-[10px] text-gray-500 font-mono">
                <span>12px</span>
                <span>15px (默认)</span>
                <span>24px</span>
              </div>
            </div>
          </div>

          {/* Subtitle Background Opacity */}
          <div className="bg-[#0b0e14] p-3.5 rounded-xl border border-white/10 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-300 font-medium">{t.settingsModal.subtitleOpacity}</span>
              <span className="px-2 py-0.5 rounded-full font-mono text-xs font-bold bg-cyan-950/60 text-cyan-300 border border-cyan-500/30 shadow-sm">
                {Math.round((settings.subtitleOpacity ?? 0) * 100)}%
              </span>
            </div>
            <input
              aria-label="字幕背景不透明度"
              type="range"
              min="0"
              max="100"
              step="5"
              value={Math.round((settings.subtitleOpacity ?? 0) * 100)}
              onChange={(event) => updateSettings({ subtitleOpacity: Number(event.target.value) / 100 })}
              className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-400 focus:outline-none"
            />
            <div className="flex items-center justify-between pt-0.5">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => updateSettings({ subtitleOpacity: 0 })}
                  className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                    (settings.subtitleOpacity ?? 0) === 0
                      ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-300 font-medium'
                      : 'border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-200'
                  }`}
                >
                  0% {settings.uiLanguage === 'en' ? '(Text only)' : settings.uiLanguage === 'ja' ? '（文字のみ）' : '（仅文字）'}
                </button>
                <button
                  type="button"
                  onClick={() => updateSettings({ subtitleOpacity: 0.5 })}
                  className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                    Math.round((settings.subtitleOpacity ?? 0) * 100) === 50
                      ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-300 font-medium'
                      : 'border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-200'
                  }`}
                >
                  50%
                </button>
                <button
                  type="button"
                  onClick={() => updateSettings({ subtitleOpacity: 0.8 })}
                  className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                    Math.round((settings.subtitleOpacity ?? 0) * 100) === 80
                      ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-300 font-medium'
                      : 'border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-200'
                  }`}
                >
                  80%
                </button>
              </div>
            </div>
          </div>

          {/* Mask Chinese Mode */}
          <label className="flex items-center justify-between rounded-xl border border-white/10 bg-[#0b0e14] p-3.5 hover:border-white/20 transition-colors cursor-pointer">
            <span>
              <span className="block text-xs font-semibold text-gray-200">{t.settingsModal.maskModeLabel}</span>
              <span className="mt-0.5 block text-[11px] text-gray-400">{t.settingsModal.maskModeDesc}</span>
            </span>
            <input
              type="checkbox"
              checked={!!settings.maskChinese}
              onChange={(event) => updateSettings({ maskChinese: event.target.checked })}
              className="h-4 w-4 rounded accent-cyan-400 cursor-pointer"
            />
          </label>

          {/* Footer with Save & Close */}
          <div className="flex justify-end border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-cyan-500 px-5 py-2.5 text-xs font-bold text-slate-950 shadow-[0_4px_14px_rgba(6,182,212,0.3)] transition-all hover:brightness-110 active:scale-95"
            >
              <Check size={14} />
              <span>{t.saveAndClose}</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
