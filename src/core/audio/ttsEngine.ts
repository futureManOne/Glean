import { TtsAudioSource } from '@/types';

export interface SystemVoiceInfo {
  name: string;
  lang: string;
  displayName: string;
  isDefault: boolean;
  isHighQuality: boolean;
}

export interface PronounceOptions {
  source?: TtsAudioSource;
  voiceName?: string;
  rate?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: unknown) => void;
}

// Toy / Novelty / Low-bitrate macOS voices that sound raspy, robotic, or comical
const UNWANTED_VOICE_NAMES = new Set([
  'bad news',
  'bahh',
  'bells',
  'boing',
  'bubbles',
  'cellos',
  'deranged',
  'good news',
  'hysterical',
  'pipe organ',
  'trinoids',
  'whisper',
  'zarvox',
  'albert',
  'fred',
  'junior',
  'ralph',
  'wobble',
  'organ'
]);

// Premium / High-quality natural voices preferred on macOS and Chrome
const HIGH_QUALITY_NAME_PATTERNS = [
  /enhanced/i,
  /premium/i,
  /natural/i,
  /google/i,
  /samantha/i,
  /ava/i,
  /allison/i,
  /daniel/i,
  /karen/i,
  /oliver/i,
  /serena/i,
  /siri/i,
  /tom/i
];

let activeAudioElement: HTMLAudioElement | null = null;
let cachedVoices: SpeechSynthesisVoice[] = [];

/**
 * Returns audio streaming URL for dictionary / neural audio sources
 */
export function getAudioUrl(text: string, source: TtsAudioSource = 'youdao-us'): string | null {
  const clean = text.trim();
  if (!clean) return null;
  const encoded = encodeURIComponent(clean);

  switch (source) {
    case 'youdao-us':
      // Youdao Dictionary US Native Human Pronunciation
      return `https://dict.youdao.com/dictvoice?audio=${encoded}&type=2`;
    case 'youdao-uk':
      // Youdao Dictionary UK Native Human Pronunciation
      return `https://dict.youdao.com/dictvoice?audio=${encoded}&type=1`;
    case 'google':
      // Google Translate / Dictionary TTS
      return `https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=${encoded}`;
    case 'system':
    default:
      return null;
  }
}

/**
 * Filters and ranks available Web Speech API voices.
 * Removes novelty/toy sound effects and prioritizes high-fidelity voices.
 */
export function filterAndRankVoices(rawVoices: SpeechSynthesisVoice[]): SystemVoiceInfo[] {
  const result: SystemVoiceInfo[] = [];

  for (const voice of rawVoices) {
    const lowerName = voice.name.toLowerCase();

    // Skip novelty and sound-effect voices
    if (UNWANTED_VOICE_NAMES.has(lowerName)) {
      continue;
    }

    // Only include English voices for English learning dictionary lookup
    const isEnglish = voice.lang.toLowerCase().startsWith('en');
    if (!isEnglish) {
      continue;
    }

    const isHighQuality = HIGH_QUALITY_NAME_PATTERNS.some((pattern) => pattern.test(voice.name));

    result.push({
      name: voice.name,
      lang: voice.lang,
      displayName: `${voice.name} (${voice.lang})`,
      isDefault: voice.default,
      isHighQuality
    });
  }

  // Sort: High quality / Premium voices first, then alphabetical
  result.sort((a, b) => {
    if (a.isHighQuality && !b.isHighQuality) return -1;
    if (!a.isHighQuality && b.isHighQuality) return 1;
    return a.name.localeCompare(b.name);
  });

  return result;
}

/**
 * Asynchronously retrieves system voices with Web Speech API onvoiceschanged listener
 */
export async function getAvailableSystemVoices(): Promise<SystemVoiceInfo[]> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return [];
  }

  const synth = window.speechSynthesis;
  const current = synth.getVoices();

  if (current && current.length > 0) {
    cachedVoices = current;
    return filterAndRankVoices(current);
  }

  return new Promise((resolve) => {
    let resolved = false;

    const onVoicesChanged = () => {
      if (resolved) return;
      resolved = true;
      const voices = synth.getVoices();
      cachedVoices = voices;
      synth.removeEventListener('voiceschanged', onVoicesChanged);
      resolve(filterAndRankVoices(voices));
    };

    synth.addEventListener('voiceschanged', onVoicesChanged);

    // Timeout fallback after 350ms in case voiceschanged does not fire
    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      synth.removeEventListener('voiceschanged', onVoicesChanged);
      const fallbackVoices = synth.getVoices();
      cachedVoices = fallbackVoices;
      resolve(filterAndRankVoices(fallbackVoices));
    }, 350);
  });
}

/**
 * Stop any ongoing audio playback immediately
 */
export function stopCurrentAudio(): void {
  if (activeAudioElement) {
    try {
      activeAudioElement.pause();
      activeAudioElement.currentTime = 0;
      activeAudioElement.src = '';
    } catch {
      // Ignore audio cleanup errors
    }
    activeAudioElement = null;
  }

  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Ignore speech cancellation errors
    }
  }
}

/**
 * Speaks text using Web Speech API with the preferred or best available voice
 */
export function speakWithSpeechSynthesis(
  text: string,
  options: {
    voiceName?: string;
    rate?: number;
    onStart?: () => void;
    onEnd?: () => void;
    onError?: (error: unknown) => void;
  } = {}
): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    options.onError?.(new Error('speechSynthesis is not supported in this environment'));
    options.onEnd?.();
    return;
  }

  const clean = text.trim();
  if (!clean) {
    options.onEnd?.();
    return;
  }

  stopCurrentAudio();

  const synth = window.speechSynthesis;
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.lang = 'en-US';
  utterance.rate = Math.max(0.6, Math.min(1.5, options.rate ?? 1.0));

  const voices = cachedVoices.length > 0 ? cachedVoices : synth.getVoices();

  if (voices.length > 0) {
    let selectedVoice: SpeechSynthesisVoice | undefined;

    // 1. If user explicitly specified a voice name, find it
    if (options.voiceName) {
      selectedVoice = voices.find((v) => v.name === options.voiceName);
    }

    // 2. Otherwise pick high quality English voice (Samantha, Ava, Google US English)
    if (!selectedVoice) {
      selectedVoice = voices.find(
        (v) =>
          v.lang.toLowerCase().startsWith('en') &&
          HIGH_QUALITY_NAME_PATTERNS.some((p) => p.test(v.name)) &&
          !UNWANTED_VOICE_NAMES.has(v.name.toLowerCase())
      );
    }

    // 3. Fallback to any English voice that is not in the unwanted novelty list
    if (!selectedVoice) {
      selectedVoice = voices.find(
        (v) => v.lang.toLowerCase().startsWith('en') && !UNWANTED_VOICE_NAMES.has(v.name.toLowerCase())
      );
    }

    if (selectedVoice) {
      utterance.voice = selectedVoice;
      utterance.lang = selectedVoice.lang;
    }
  }

  if (options.onStart) {
    utterance.onstart = () => options.onStart?.();
  }

  utterance.onend = () => {
    options.onEnd?.();
  };

  utterance.onerror = (e) => {
    options.onError?.(e);
    options.onEnd?.();
  };

  synth.speak(utterance);
}

/**
 * Universal pronunciation entrypoint.
 * Respects configured TTS audio source (Youdao US/UK human voice, Google TTS, or System voice).
 * Gracefully falls back to system speech synthesis if network audio fails.
 */
export function playPronunciation(text: string, options: PronounceOptions = {}): void {
  const clean = text.trim();
  if (!clean) {
    options.onEnd?.();
    return;
  }

  const source = options.source || 'youdao-us';
  const rate = options.rate ?? 1.0;

  // If system voice is explicitly selected, use Web Speech API directly
  if (source === 'system') {
    speakWithSpeechSynthesis(clean, {
      voiceName: options.voiceName,
      rate,
      onStart: options.onStart,
      onEnd: options.onEnd,
      onError: options.onError
    });
    return;
  }

  // Get audio streaming URL for dictionary human voice or Google TTS
  const audioUrl = getAudioUrl(clean, source);
  if (!audioUrl) {
    speakWithSpeechSynthesis(clean, {
      voiceName: options.voiceName,
      rate,
      onStart: options.onStart,
      onEnd: options.onEnd,
      onError: options.onError
    });
    return;
  }

  stopCurrentAudio();

  try {
    const audio = new Audio(audioUrl);
    activeAudioElement = audio;

    // Apply playback rate
    if (rate !== 1.0) {
      audio.playbackRate = Math.max(0.6, Math.min(1.5, rate));
    }

    let started = false;

    const handleStart = () => {
      if (!started) {
        started = true;
        options.onStart?.();
      }
    };

    const handleEnd = () => {
      if (activeAudioElement === audio) {
        activeAudioElement = null;
      }
      options.onEnd?.();
    };

    const handleError = (err: unknown) => {
      if (activeAudioElement === audio) {
        activeAudioElement = null;
      }
      // Fallback seamlessly to system voice if network audio fails
      speakWithSpeechSynthesis(clean, {
        voiceName: options.voiceName,
        rate,
        onStart: options.onStart,
        onEnd: options.onEnd,
        onError: options.onError
      });
    };

    audio.onplay = handleStart;
    audio.onended = handleEnd;
    audio.onerror = handleError;

    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          handleStart();
        })
        .catch((err) => {
          handleError(err);
        });
    }
  } catch (err) {
    // Immediate fallback on constructor or network initiation error
    speakWithSpeechSynthesis(clean, {
      voiceName: options.voiceName,
      rate,
      onStart: options.onStart,
      onEnd: options.onEnd,
      onError: options.onError
    });
  }
}
