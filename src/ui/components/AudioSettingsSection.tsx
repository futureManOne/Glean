import React, { useState, useEffect } from 'react';
import { Volume2, VolumeX, Sparkles, Sliders, Check, Music } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { getLocale } from '@/core/i18n';
import { TtsAudioSource } from '@/types';
import {
  getAvailableSystemVoices,
  playPronunciation,
  stopCurrentAudio,
  SystemVoiceInfo
} from '@/core/audio/ttsEngine';

export const AudioSettingsSection: React.FC = () => {
  const { settings, updateSettings } = useAppStore();
  const t = getLocale(settings.uiLanguage);

  const [systemVoices, setSystemVoices] = useState<SystemVoiceInfo[]>([]);
  const [isPlayingTest, setIsPlayingTest] = useState(false);

  const currentEngine: TtsAudioSource = settings.ttsEngine || 'youdao-us';
  const currentVoice = settings.ttsVoice || '';
  const currentRate = settings.ttsRate ?? 1.0;

  // Load available system voices on mount
  useEffect(() => {
    let isMounted = true;
    getAvailableSystemVoices().then((voices) => {
      if (isMounted) {
        setSystemVoices(voices);
      }
    });
    return () => {
      isMounted = false;
      stopCurrentAudio();
    };
  }, []);

  const handleTestAudio = () => {
    if (isPlayingTest) {
      stopCurrentAudio();
      setIsPlayingTest(false);
      return;
    }

    setIsPlayingTest(true);

    const testText =
      currentEngine === 'youdao-uk'
        ? 'Brilliant! Enjoy learning with authentic British pronunciation.'
        : 'Awesome! Enjoy learning with crystal clear native pronunciation.';

    playPronunciation(testText, {
      source: currentEngine,
      voiceName: currentVoice,
      rate: currentRate,
      onStart: () => setIsPlayingTest(true),
      onEnd: () => setIsPlayingTest(false),
      onError: () => setIsPlayingTest(false)
    });
  };

  const engineOptions: Array<{ id: TtsAudioSource; label: string; tag?: string; desc: string }> = [
    {
      id: 'youdao-us',
      label: t.settingsModal.ttsEngineYoudaoUS || '有道美音真人原声',
      tag: '⭐ 推荐',
      desc: '权威真人母语录音，纯正饱满、清晰清脆，彻底告别旧款 Mac 的沙哑机械音'
    },
    {
      id: 'youdao-uk',
      label: t.settingsModal.ttsEngineYoudaoUK || '有道英音真人原声',
      desc: '英式 Oxford/BBC 纯正母语发音，典雅地道'
    },
    {
      id: 'google',
      label: t.settingsModal.ttsEngineGoogle || 'Google TTS (国际标准)',
      desc: 'Google 云端国际标准发音，支持完整长句与各类俚语'
    },
    {
      id: 'system',
      label: t.settingsModal.ttsEngineSystem || '系统原生语音 (Web Speech)',
      desc: '使用 macOS / 浏览器内置语音库，已自动排除沙哑的 Alex 等机械音'
    }
  ];

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-sky-500/15 text-sky-300">
            <Volume2 size={14} />
          </span>
          <h3 className="text-xs font-semibold text-white">
            {t.settingsModal.audioSectionTitle || '🔊 单词发音与朗读语音设置'}
          </h3>
        </div>

        {/* 试听测试按钮 */}
        <button
          type="button"
          onClick={handleTestAudio}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
            isPlayingTest
              ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300 animate-pulse'
              : 'border-cyan-400/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20'
          }`}
          title="点击试听当前声音配置"
        >
          {isPlayingTest ? <VolumeX size={13} /> : <Volume2 size={13} />}
          <span>
            {isPlayingTest
              ? t.settingsModal.testingAudio || '正在试听...'
              : t.settingsModal.testAudio || '🔊 试听发音'}
          </span>
        </button>
      </div>

      <p className="text-[11px] leading-relaxed text-gray-400">
        {t.settingsModal.audioSectionDesc ||
          '推荐优先使用有道真人原声，母语录音纯正清晰；如选用系统语音，已自动为您屏蔽 Mac 旧版低质声音（如沙哑的 Alex）。'}
      </p>

      {/* 发音引擎来源切换 */}
      <div className="space-y-2">
        <label className="text-[11px] font-medium text-gray-400 block">
          {t.settingsModal.ttsEngine || '发音引擎与来源:'}
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {engineOptions.map((opt) => {
            const isSelected = currentEngine === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => updateSettings({ ttsEngine: opt.id })}
                className={`text-left p-2.5 rounded-lg border transition-all ${
                  isSelected
                    ? 'border-cyan-400/80 bg-cyan-950/40 text-white shadow-[0_0_12px_rgba(6,182,212,0.15)]'
                    : 'border-white/10 bg-white/[0.02] text-gray-300 hover:bg-white/[0.05] hover:border-white/20'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold flex items-center gap-1.5">
                    {opt.label}
                    {opt.tag && (
                      <span className="text-[10px] font-normal px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        {opt.tag}
                      </span>
                    )}
                  </span>
                  {isSelected && <Check size={14} className="text-cyan-400 shrink-0" />}
                </div>
                <p className="text-[10.5px] text-gray-400 mt-1 line-clamp-2 leading-relaxed">
                  {opt.desc}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* 若选中系统语音，展示发音人选择下拉框 */}
      {currentEngine === 'system' && (
        <div className="p-3 rounded-lg border border-sky-400/20 bg-sky-950/20 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-medium text-sky-200">
              {t.settingsModal.ttsVoice || '系统发音人 (System Voice):'}
            </label>
            <span className="text-[10px] text-sky-300/80">
              {systemVoices.length > 0 ? `已检测到 ${systemVoices.length} 个英语声音` : '加载中...'}
            </span>
          </div>

          <select
            value={currentVoice}
            onChange={(e) => updateSettings({ ttsVoice: e.target.value })}
            className="w-full rounded-lg border border-white/15 bg-[#101418] px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-400"
          >
            <option value="">
              ✨ {t.settingsModal.ttsVoiceAuto || '自动优选高质量声音 (Samantha / Ava / Google 等)'}
            </option>
            {systemVoices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.isHighQuality ? '⭐ ' : ''}
                {v.displayName}
              </option>
            ))}
          </select>
          <p className="text-[10.5px] text-gray-400 leading-relaxed">
            提示：Mac 用户可在「系统设置 → 辅助功能 → 朗读内容 → 系统声音」中免费下载 Samantha (Enhanced) 或 Ava (Premium) 苹果高保真语音包。
          </p>
        </div>
      )}

      {/* 语速调节 */}
      <div className="pt-1">
        <label className="space-y-1.5 block">
          <div className="flex items-center justify-between text-[11px] text-gray-400">
            <span>{t.settingsModal.ttsRate || '发音语速:'}</span>
            <div className="flex items-center gap-2">
              <b className="font-mono text-cyan-300">{currentRate.toFixed(2)}x</b>
              {currentRate !== 1.0 && (
                <button
                  type="button"
                  onClick={() => updateSettings({ ttsRate: 1.0 })}
                  className="text-[10px] text-cyan-400 hover:underline"
                >
                  重置 1.0x
                </button>
              )}
            </div>
          </div>
          <input
            type="range"
            min="0.7"
            max="1.3"
            step="0.05"
            value={currentRate}
            onChange={(e) => updateSettings({ ttsRate: parseFloat(e.target.value) })}
            className="w-full accent-cyan-400 cursor-pointer"
          />
        </label>
      </div>
    </div>
  );
};
