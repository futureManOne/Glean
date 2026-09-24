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
    <div className="fixed inset-0 z-[9999999] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lr-basic-settings-title"
        className="w-[680px] max-w-full max-h-[90vh] overflow-y-auto rounded-xl border border-white/15 bg-[#15191d] text-gray-100 shadow-[0_24px_80px_rgba(0,0,0,.55)] font-sans"
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
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-[#15191d]/95 px-5 py-4 backdrop-blur">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-400/15 text-cyan-300">
              <Settings size={17} />
            </span>
            <div>
              <h2 id="lr-basic-settings-title" className="text-sm font-semibold text-white">{t.settingsModal.title}</h2>
              <p className="text-[11px] text-gray-400">{t.appSubtitle}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white" title="关闭设置">
            <X size={18} />
          </button>
        </header>

        <div className="space-y-6 p-6">
          {children}
          <AiSettingsPanel />
          <AudioSettingsSection />
          <div>
            <label className="mb-2 block text-[11px] font-medium text-gray-400">{t.uiLanguage}</label>
            <div className="grid grid-cols-3 gap-2">
              {(['zh-CN', 'en', 'ja'] as SupportedLang[]).map((lang) => (
                <button key={lang} type="button" onClick={() => updateSettings({ uiLanguage: lang })} className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${(settings.uiLanguage || 'zh-CN') === lang ? 'border-cyan-300/60 bg-cyan-300/15 text-cyan-200' : 'border-white/10 bg-white/[0.03] text-gray-400 hover:bg-white/[0.07] hover:text-gray-200'}`}>
                  {t.lang[lang]}
                </button>
              ))}
            </div>
          </div>

          {/* AI 翻译目标语言选择 */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-[11px] font-medium text-gray-400">{t.settingsModal.aiTranslationLang}</label>
              <span className="text-[11px] text-cyan-300">
                {SUPPORTED_TRANSLATION_LANGUAGES.find(l => l.code === (settings.secondaryLang || 'auto'))?.name || settings.secondaryLang}
              </span>
            </div>
            <select
              aria-label={t.settingsModal.aiTranslationLang}
              value={settings.secondaryLang || 'auto'}
              onChange={(e) => updateSettings({ secondaryLang: e.target.value })}
              className="w-full rounded-lg border border-white/15 bg-[#101418] px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-400"
            >
              {SUPPORTED_TRANSLATION_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {settings.uiLanguage === 'en' ? lang.englishName : lang.name}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
              {t.settingsModal.aiTranslationLangDesc}
            </p>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
            <label className="text-[11px] font-medium text-gray-400">{t.settingsModal.defaultSubtitleMode}</label>
              <span className="text-[11px] text-cyan-300">{subtitleModeLabel(settings.subtitleMode)}</span>
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {(['both', 'mixed', 'target', 'translation', 'hidden'] as SubtitleMode[]).map((mode) => (
                <button key={mode} type="button" onClick={() => setSubtitleMode(mode)} className={`rounded-lg border px-1.5 py-2 text-[11px] font-medium transition-colors ${settings.subtitleMode === mode ? 'border-cyan-300/60 bg-cyan-300/15 text-cyan-200' : 'border-white/10 bg-white/[0.03] text-gray-400 hover:bg-white/[0.07]'}`}>
                  {subtitleModeLabel(mode)}
                </button>
              ))}
            </div>
          </div>

          {/* AI 精翻覆盖密度调节 */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-[11px] font-medium text-gray-400">{t.settingsModal.mixedGlossDensity}</label>
              <span className="text-[11px] text-cyan-300">{densityLabel(settings.mixedGlossDensity || 'medium')}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(['low', 'medium', 'high'] as MixedGlossDensity[]).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => updateSettings({ mixedGlossDensity: level })}
                  className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${(settings.mixedGlossDensity || 'medium') === level ? 'border-cyan-300/60 bg-cyan-300/15 text-cyan-200' : 'border-white/10 bg-white/[0.03] text-gray-400 hover:bg-white/[0.07] hover:text-gray-200'}`}
                >
                  {densityLabel(level)}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
              {t.settingsModal.mixedGlossDensityDesc}
            </p>
          </div>

          {/* 中英混合模式整句中文翻译开关 */}
          {settings.subtitleMode === 'mixed' && (
            <label className="flex items-center justify-between rounded-xl border border-cyan-400/30 bg-cyan-950/20 p-3.5 transition-all">
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

          <div className="grid grid-cols-2 gap-4">
            <label className="space-y-2">
              <span className="flex items-center justify-between text-[11px] text-gray-400"><span>{t.settingsModal.subtitleFontSize}</span><b className="font-mono text-cyan-300">{settings.subtitleFontSize || 18}px</b></span>
              <input type="range" min="14" max="36" value={settings.subtitleFontSize || 18} onChange={(event) => updateSettings({ subtitleFontSize: Number(event.target.value) })} className="w-full accent-cyan-400" />
            </label>
            <label className="space-y-2">
              <span className="flex items-center justify-between text-[11px] text-gray-400"><span>{t.settingsModal.transcriptFontSize}</span><b className="font-mono text-cyan-300">{settings.transcriptFontSize || 15}px</b></span>
              <input type="range" min="12" max="24" value={settings.transcriptFontSize || 15} onChange={(event) => updateSettings({ transcriptFontSize: Number(event.target.value) })} className="w-full accent-cyan-400" />
            </label>
          </div>

          <label className="block space-y-2">
            <span className="flex items-center justify-between text-[11px] text-gray-400"><span>{t.settingsModal.subtitleOpacity}</span><b className="font-mono text-cyan-300">{Math.round((settings.subtitleOpacity ?? 0.85) * 100)}%</b></span>
            <input aria-label="字幕背景不透明度" type="range" min="0" max="100" step="5" value={Math.round((settings.subtitleOpacity ?? 0.85) * 100)} onChange={(event) => updateSettings({ subtitleOpacity: Number(event.target.value) / 100 })} className="w-full accent-cyan-400" />
            <button type="button" onClick={() => updateSettings({ subtitleOpacity: 0 })} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-cyan-200 hover:bg-white/10">{settings.uiLanguage === 'en' ? '0% (Text only)' : settings.uiLanguage === 'ja' ? '0%（文字のみ）' : '全透明（仅文字）'}</button>
          </label>

          <label className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
            <span><span className="block text-xs font-medium text-gray-200">{t.settingsModal.maskModeLabel}</span><span className="mt-0.5 block text-[11px] text-gray-500">{t.settingsModal.maskModeDesc}</span></span>
            <input type="checkbox" checked={!!settings.maskChinese} onChange={(event) => updateSettings({ maskChinese: event.target.checked })} className="h-4 w-4 accent-cyan-400" />
          </label>

          <div className="flex justify-end border-t border-white/10 pt-4">
            <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-400 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-cyan-300">
              <Check size={14} /> {t.saveAndClose}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
