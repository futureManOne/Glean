import React, { useState } from 'react';
import { Volume2 } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { playPronunciation, stopCurrentAudio, PronounceOptions } from '@/core/audio/ttsEngine';
import { TtsAudioSource } from '@/types';

export { stopCurrentAudio };

interface AudioButtonProps {
  word: string;
  className?: string;
  size?: number;
  source?: TtsAudioSource;
  title?: string;
}

export function playWordAudio(
  word: string,
  onStart?: () => void,
  onEnd?: () => void,
  options?: Partial<PronounceOptions>
): void {
  if (!word || typeof window === 'undefined') return;
  const clean = word.trim();
  if (!clean) return;

  const currentSettings = useAppStore.getState().settings;
  const source = options?.source ?? currentSettings?.ttsEngine ?? 'youdao-us';
  const voiceName = options?.voiceName ?? currentSettings?.ttsVoice ?? '';
  const rate = options?.rate ?? currentSettings?.ttsRate ?? 1.0;

  playPronunciation(clean, {
    source,
    voiceName,
    rate,
    onStart,
    onEnd,
    onError: () => {
      onEnd?.();
    }
  });
}

export const AudioButton: React.FC<AudioButtonProps> = ({
  word,
  className = '',
  size = 16,
  source,
  title = '播放发音'
}) => {
  const [isPlaying, setIsPlaying] = useState(false);

  const speak = (e: React.MouseEvent) => {
    e.stopPropagation();
    playWordAudio(
      word,
      () => setIsPlaying(true),
      () => setIsPlaying(false),
      source ? { source } : undefined
    );
  };

  return (
    <button
      type="button"
      onClick={speak}
      title={title}
      aria-label={title}
      className={`p-1 rounded-full hover:bg-white/10 transition-colors text-blue-400 hover:text-blue-300 flex items-center justify-center ${className}`}
    >
      {isPlaying ? (
        <Volume2 size={size} className="animate-pulse text-cyan-400" />
      ) : (
        <Volume2 size={size} />
      )}
    </button>
  );
};
