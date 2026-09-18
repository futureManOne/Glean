import React, { useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';

interface AudioButtonProps {
  word: string;
  className?: string;
  size?: number;
}

export function playWordAudio(word: string, onStart?: () => void, onEnd?: () => void): void {
  if (!word || typeof window === 'undefined') return;
  const clean = word.trim();
  if (!clean) return;

  try {
    if ('speechSynthesis' in window && typeof window.speechSynthesis !== 'undefined') {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.lang = 'en-US';
      utterance.rate = 0.9;
      
      if (onStart) utterance.onstart = onStart;
      if (onEnd) {
        utterance.onend = onEnd;
        utterance.onerror = onEnd;
      }

      window.speechSynthesis.speak(utterance);
    } else if (typeof Audio !== 'undefined') {
      // Fallback to online dictionary audio
      const audio = new Audio(`https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(clean)}&type=2`);
      if (onStart) onStart();
      audio.play()
        .then(() => {
          if (onEnd) audio.onended = onEnd;
        })
        .catch(() => {
          if (onEnd) onEnd();
        });
    }
  } catch (e) {
    console.warn('[Audio] Failed to play pronunciation:', e);
    if (onEnd) onEnd();
  }
}

export const AudioButton: React.FC<AudioButtonProps> = ({ word, className = '', size = 16 }) => {
  const [isPlaying, setIsPlaying] = useState(false);

  const speak = (e: React.MouseEvent) => {
    e.stopPropagation();
    playWordAudio(word, () => setIsPlaying(true), () => setIsPlaying(false));
  };

  return (
    <button
      type="button"
      onClick={speak}
      title="Pronounce"
      className={`p-1 rounded-full hover:bg-white/10 transition-colors text-blue-400 hover:text-blue-300 flex items-center justify-center ${className}`}
    >
      {isPlaying ? (
        <Volume2 size={size} className="animate-pulse text-blue-400" />
      ) : (
        <Volume2 size={size} />
      )}
    </button>
  );
};
