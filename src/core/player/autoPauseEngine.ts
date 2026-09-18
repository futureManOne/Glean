import { SubtitleCue } from '@/types';
import { VideoPlayerAdapter } from './BaseAdapter';
import { useAppStore } from '@/store/useAppStore';
import { findCurrentCueIndex, findPreviousCueIndex } from '@/core/subtitle/syncEngine';

/**
 * Natural acoustic smoothing buffer in seconds (65ms, strictly adhering to the 50~80ms specification).
 * Retains trailing acoustic consonants (/t/, /d/, /s/, /k/, etc.) and natural reverberation
 * without hard-cutting the speech tail.
 */
export const AP_SMOOTH_BUFFER_SECONDS = 0.065;

/**
 * Calculates the exact target pause timestamp for a subtitle cue.
 * - When there is a following cue, clamps to nextCue.start so it never bleeds into the next sentence's audio.
 * - Adds the 65ms acoustic smoothing buffer when there is adequate silence gap or at the end of transcript.
 */
export function calculateCueTargetPauseTime(cue: SubtitleCue, nextCue?: SubtitleCue, duration?: number): number {
  if (!cue) return 0;
  const cStart = Math.max(0, Number.isFinite(cue.start) ? cue.start : 0);
  const cEnd = Math.max(cStart, Number.isFinite(cue.end) ? cue.end : cStart);
  let nominalTarget = cEnd + AP_SMOOTH_BUFFER_SECONDS;
  if (duration && Number.isFinite(duration) && duration > cStart) {
    nominalTarget = Math.min(nominalTarget, duration);
  }

  if (nextCue) {
    const nStart = Math.max(0, Number.isFinite(nextCue.start) ? nextCue.start : 0);
    if (nStart > cStart) {
      if (nStart <= cEnd) {
        // Contiguous or overlapping cues: pause at earliest boundary to prevent speech collision
        return Math.min(cEnd, Math.max(cStart, nStart));
      }
      // Clamped buffer: do not overshoot past nextCue.start
      return Math.min(nominalTarget, nStart);
    }
  }
  return nominalTarget;
}

export interface AutoPauseContext {
  cues: SubtitleCue[];
  currentCueIndex: number;
  currentTime: number;
  autoPauseAfterSentence: boolean;
  isAdPlaying: boolean;
  repeatMode?: boolean;
  lastPausedCueId: string | number | null;
  playbackRate?: number;
  duration?: number;
}

export interface AutoPauseDecision {
  shouldPause: boolean;
  targetCueId?: string | number | null;
  targetPauseTime?: number;
  seekTime?: number;
  resetPausedId?: boolean;
  nextTargetPauseTime?: number;
}

/**
 * Robust cue ID equality comparator supporting both numeric and string identifiers.
 */
export function areCueIdsEqual(a: string | number | null | undefined, b: string | number | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
}


/**
 * Pure evaluation function for single-sentence auto-pause.
 * Operates deterministically on transcript cues and playback state without DOM dependencies,
 * enabling 100% reliable unit testing and high-speed execution.
 */
export function evaluateAutoPause(context: AutoPauseContext): AutoPauseDecision {
  const { cues, currentTime, autoPauseAfterSentence, isAdPlaying, repeatMode, lastPausedCueId, playbackRate, duration } = context;

  // R3: Strictly disable auto-pause during advertisements, repeat loop mode, or when the feature is turned off
  if (!autoPauseAfterSentence || isAdPlaying || repeatMode) {
    return { shouldPause: false };
  }

  if (!cues || cues.length === 0) {
    return { shouldPause: false };
  }

  const rate = playbackRate && playbackRate > 0 ? playbackRate : 1.0;
  // Adaptive overshoot capture window: scales with playbackRate to handle background throttling & 3.0x+ speed
  const maxOvershoot = Math.max(0.65, 0.35 * rate);
  // Adaptive lookahead window into next cue: scales with playbackRate to prevent dropping fast contiguous cues
  const nextTolerance = Math.min(maxOvershoot, Math.max(0.20, 0.12 * rate));

  let effectivePausedId = lastPausedCueId;
  let shouldResetPausedId = false;

  // 1. First check if the immediately preceding cue finished and is awaiting pause
  let candidateIndex = -1;
  const prevIdx = findPreviousCueIndex(cues, -1, currentTime);
  if (prevIdx >= 0 && prevIdx < cues.length && cues[prevIdx].end <= currentTime + 0.05) {
    const prevCue = cues[prevIdx];
    const nextAfterPrev = prevIdx + 1 < cues.length ? cues[prevIdx + 1] : undefined;
    const prevTarget = calculateCueTargetPauseTime(prevCue, nextAfterPrev, duration);

    if (!areCueIdsEqual(effectivePausedId, prevCue.id)) {
      const overshoot = currentTime - prevTarget;
      const enteredNext = nextAfterPrev ? currentTime >= (nextAfterPrev.start + nextTolerance) : false;
      if (currentTime >= prevTarget && overshoot <= maxOvershoot && !enteredNext) {
        candidateIndex = prevIdx;
      }
    }
  }

  // 2. If preceding cue did not claim pause, identify active cue or upcoming cue
  if (candidateIndex === -1) {
    const activeIdx = findCurrentCueIndex(cues, currentTime, context.currentCueIndex);
    if (activeIdx >= 0) {
      candidateIndex = activeIdx;
    } else if (prevIdx >= 0 && cues[prevIdx].end <= currentTime + 0.05) {
      candidateIndex = prevIdx + 1;
    } else {
      candidateIndex = 0;
    }
  }

  if (candidateIndex < 0 || candidateIndex >= cues.length) {
    return { shouldPause: false };
  }

  const curCue = cues[candidateIndex];
  if (!curCue) {
    return { shouldPause: false };
  }

  const nextCue = candidateIndex + 1 < cues.length ? cues[candidateIndex + 1] : undefined;
  const curTargetPause = calculateCueTargetPauseTime(curCue, nextCue, duration);

  // Check if user rewound into this cue (e.g. repeated sentence or sought backwards).
  // Adaptive threshold handles both regular and short (<200ms) cues without subtracting more than cue duration.
  const cueDuration = Math.max(0, curCue.end - curCue.start);
  const rewindThreshold = curCue.end - Math.min(0.2, Math.max(0.04, cueDuration * 0.5));
  if (areCueIdsEqual(lastPausedCueId, curCue.id) && currentTime < rewindThreshold) {
    effectivePausedId = null;
    shouldResetPausedId = true;
  }

  // A. Playhead has not yet reached target pause point
  if (currentTime < curTargetPause) {
    return {
      shouldPause: false,
      nextTargetPauseTime: curTargetPause,
      resetPausedId: shouldResetPausedId
    };
  }

  // B. Playhead has reached or passed curCue's target pause point
  if (!areCueIdsEqual(effectivePausedId, curCue.id)) {
    const overshoot = currentTime - curTargetPause;
    const enteredNext = nextCue ? currentTime >= (nextCue.start + nextTolerance) : false;

    if (overshoot <= maxOvershoot && !enteredNext) {
      // Valid boundary trigger! Precision pause and clamp back
      return {
        shouldPause: true,
        targetCueId: curCue.id,
        targetPauseTime: curTargetPause,
        seekTime: curTargetPause,
        resetPausedId: shouldResetPausedId
      };
    }

    // Playhead is beyond capture window (user sought or jumped past): advance target lookahead to nextCue
    if (nextCue) {
      const nextNextCue = candidateIndex + 2 < cues.length ? cues[candidateIndex + 2] : undefined;
      return {
        shouldPause: false,
        nextTargetPauseTime: calculateCueTargetPauseTime(nextCue, nextNextCue, duration),
        resetPausedId: shouldResetPausedId
      };
    }
    return {
      shouldPause: false,
      resetPausedId: shouldResetPausedId
    };
  }

  // C. curCue was already paused and consumed
  if (nextCue) {
    const nextNextCue = candidateIndex + 2 < cues.length ? cues[candidateIndex + 2] : undefined;
    return {
      shouldPause: false,
      nextTargetPauseTime: calculateCueTargetPauseTime(nextCue, nextNextCue, duration),
      resetPausedId: shouldResetPausedId
    };
  }

  return {
    shouldPause: false,
    resetPausedId: shouldResetPausedId
  };
}

/**
 * High-frequency boundary sensing and lookahead execution engine for Auto-Pause.
 * Integrates hardware frame callback (rVFC / RAF) with adaptive lookahead micro-timers
 * to overcome the coarse ~250ms HTML5 timeupdate sampling rate.
 */
export class AutoPauseEngine {
  private player: VideoPlayerAdapter;
  private boundVideoElement: HTMLVideoElement | null = null;
  private isInternalSeek: boolean = false;
  private internalSeekTimeout: any = null;
  private rafId: number | null = null;
  private lookaheadTimer: any = null;
  private unsubStore: (() => void) | null = null;
  private unsubPlay: (() => void) | null = null;
  private lastObservedTime: number = 0;
  private isDestroyed: boolean = false;

  constructor(player: VideoPlayerAdapter) {
    this.player = player;
  }

  public start(): void {
    this.isDestroyed = false;
    this.lastObservedTime = this.player.getCurrentTime();

    // 1. Listen to play state changes from player adapter
    this.unsubPlay = this.player.onPlayStateChange((paused) => {
      if (!paused) {
        this.startHighFrequencyLoop();
      } else {
        this.stopHighFrequencyLoop();
      }
    });

    // 2. Also listen to video element native events directly for instant response
    this.boundVideoElement = this.player.getVideoElement();
    if (this.boundVideoElement) {
      this.boundVideoElement.addEventListener('play', this.handlePlay);
      this.boundVideoElement.addEventListener('pause', this.handlePause);
      this.boundVideoElement.addEventListener('seeking', this.handleSeeking);
      this.boundVideoElement.addEventListener('seeked', this.handleSeeking);
      this.boundVideoElement.addEventListener('ratechange', this.handleRateChange);
    }

    // 3. Subscribe to store state changes (autoPauseAfterSentence, repeatMode, isAdPlaying)
    this.unsubStore = useAppStore.subscribe((state, prevState) => {
      if (
        state.autoPauseAfterSentence !== prevState.autoPauseAfterSentence ||
        state.repeatMode !== prevState.repeatMode ||
        state.isAdPlaying !== prevState.isAdPlaying
      ) {
        if (state.autoPauseAfterSentence && !state.repeatMode && !state.isAdPlaying && !this.player.isPaused()) {
          this.startHighFrequencyLoop();
        } else {
          this.stopHighFrequencyLoop();
        }
      }
    });

    if (!this.player.isPaused()) {
      this.startHighFrequencyLoop();
    }
  }

  private handlePlay = () => {
    this.startHighFrequencyLoop();
  };

  private handlePause = () => {
    this.stopHighFrequencyLoop();
  };

  private handleRateChange = () => {
    this.clearLookahead();
    if (!this.player.isPaused() && !this.isDestroyed) {
      this.checkBoundary();
    }
  };

  private handleSeeking = () => {
    this.clearLookahead();
    if (this.isInternalSeek) {
      return;
    }
    useAppStore.getState().handleAutoPauseSeek(this.player.getCurrentTime());
  };

  public checkBoundary(): boolean {
    const state = useAppStore.getState();
    if (
      !state.autoPauseAfterSentence ||
      state.repeatMode ||
      state.isAdPlaying ||
      !state.cues ||
      state.cues.length === 0 ||
      this.player.isPaused()
    ) {
      this.clearLookahead();
      return false;
    }

    const currentTime = this.player.getCurrentTime();
    const duration = this.player.getDuration();
    const video = this.boundVideoElement || this.player.getVideoElement();
    const playbackRate = (video && video.playbackRate > 0) ? video.playbackRate : 1.0;

    // Detect seek jump
    if (Math.abs(currentTime - this.lastObservedTime) > 1.5 || currentTime < this.lastObservedTime - 0.2) {
      state.handleAutoPauseSeek(currentTime);
    }
    this.lastObservedTime = currentTime;

    const decision = evaluateAutoPause({
      cues: state.cues,
      currentCueIndex: state.currentCueIndex,
      currentTime,
      autoPauseAfterSentence: state.autoPauseAfterSentence,
      isAdPlaying: state.isAdPlaying,
      repeatMode: state.repeatMode,
      lastPausedCueId: state.lastPausedCueId,
      playbackRate,
      duration
    });

    if (decision.resetPausedId) {
      state.setLastPausedCueId(null);
    }

    if (decision.shouldPause && decision.targetCueId !== undefined && decision.targetCueId !== null) {
      this.clearLookahead();
      this.player.pause();
      const targetTime = decision.seekTime ?? decision.targetPauseTime ?? currentTime;
      if (decision.seekTime !== undefined && Math.abs(currentTime - decision.seekTime) > 0.04) {
        this.isInternalSeek = true;
        if (this.internalSeekTimeout) clearTimeout(this.internalSeekTimeout);
        this.internalSeekTimeout = setTimeout(() => {
          this.isInternalSeek = false;
          this.internalSeekTimeout = null;
        }, 120);
        this.player.seek(decision.seekTime);
      }
      state.setLastPausedCueId(decision.targetCueId);
      const targetIndex = state.cues.findIndex((c) => areCueIdsEqual(c.id, decision.targetCueId));
      useAppStore.setState({
        isPlaying: false,
        currentTime: targetTime,
        ...(targetIndex !== -1 ? { currentCueIndex: targetIndex } : {})
      });
      return true;
    }

    // Schedule precision lookahead timer when approaching boundary
    if (decision.nextTargetPauseTime && decision.nextTargetPauseTime > currentTime) {
      const remainingSec = decision.nextTargetPauseTime - currentTime;
      const delayMs = (remainingSec / playbackRate) * 1000;
      if (delayMs > 0 && delayMs <= 400) {
        this.scheduleLookahead(delayMs);
      }
    }

    return false;
  }

  private scheduleLookahead(delayMs: number): void {
    if (this.lookaheadTimer) {
      clearTimeout(this.lookaheadTimer);
    }
    this.lookaheadTimer = setTimeout(() => {
      this.lookaheadTimer = null;
      if (!this.player.isPaused() && !this.isDestroyed) {
        this.checkBoundary();
      }
    }, Math.max(0, Math.round(delayMs)));
  }

  private clearLookahead(): void {
    if (this.lookaheadTimer) {
      clearTimeout(this.lookaheadTimer);
      this.lookaheadTimer = null;
    }
  }

  private startHighFrequencyLoop(): void {
    if (this.isDestroyed || this.rafId !== null) return;

    const tick = () => {
      if (this.isDestroyed) return;
      const didPause = this.checkBoundary();

      if (!didPause && !this.player.isPaused()) {
        this.requestNextFrame(tick);
      } else {
        this.rafId = null;
      }
    };

    this.requestNextFrame(tick);
  }

  private requestNextFrame(callback: () => void): void {
    const video = this.boundVideoElement || this.player.getVideoElement();
    if (typeof video?.requestVideoFrameCallback === 'function') {
      this.rafId = video.requestVideoFrameCallback(() => callback());
    } else if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      this.rafId = window.requestAnimationFrame(callback);
    } else {
      this.rafId = setTimeout(callback, 16) as any;
    }
  }

  private stopHighFrequencyLoop(): void {
    this.clearLookahead();
    if (this.rafId !== null) {
      const video = this.boundVideoElement || this.player.getVideoElement();
      if (typeof video?.cancelVideoFrameCallback === 'function') {
        try { video.cancelVideoFrameCallback(this.rafId); } catch (_) {}
      } else if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        try { window.cancelAnimationFrame(this.rafId); } catch (_) {}
      } else {
        clearTimeout(this.rafId);
      }
      this.rafId = null;
    }
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.stopHighFrequencyLoop();

    if (this.internalSeekTimeout) {
      clearTimeout(this.internalSeekTimeout);
      this.internalSeekTimeout = null;
    }
    this.isInternalSeek = false;

    if (this.unsubPlay) {
      this.unsubPlay();
      this.unsubPlay = null;
    }
    if (this.unsubStore) {
      this.unsubStore();
      this.unsubStore = null;
    }

    if (this.boundVideoElement) {
      this.boundVideoElement.removeEventListener('play', this.handlePlay);
      this.boundVideoElement.removeEventListener('pause', this.handlePause);
      this.boundVideoElement.removeEventListener('seeking', this.handleSeeking);
      this.boundVideoElement.removeEventListener('seeked', this.handleSeeking);
      this.boundVideoElement.removeEventListener('ratechange', this.handleRateChange);
      this.boundVideoElement = null;
    }
  }
}
