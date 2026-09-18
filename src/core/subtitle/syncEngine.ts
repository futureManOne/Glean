import { SubtitleCue } from '@/types';

/**
 * Fast search to find active cue index for the current video playback time.
 * Incorporates hysteresis damping: if current playback time is within the active range of
 * the current cue, it maintains currentIndex, eliminating oscillation across adjacent or overlapping intervals.
 */
export function findCurrentCueIndex(cues: SubtitleCue[], currentTime: number, currentIndex: number = -1): number {
  if (!cues || cues.length === 0) return -1;

  // 1. Hysteresis damping: if current playback time is within the active range of the current cue,
  // maintain current index to eliminate oscillation.
  if (currentIndex >= 0 && currentIndex < cues.length) {
    const curCue = cues[currentIndex];
    if (currentTime >= curCue.start - 0.05 && currentTime <= curCue.end + 0.05) {
      return currentIndex;
    }

    // Smooth forward sequential check (O(1) fast path)
    if (currentIndex + 1 < cues.length) {
      const nextCue = cues[currentIndex + 1];
      if (currentTime >= nextCue.start - 0.05 && currentTime <= nextCue.end + 0.05) {
        return currentIndex + 1;
      }
    }

    // Smooth backward sequential check (O(1) fast path)
    if (currentIndex - 1 >= 0) {
      const prevCue = cues[currentIndex - 1];
      if (currentTime >= prevCue.start - 0.05 && currentTime <= prevCue.end + 0.05) {
        return currentIndex - 1;
      }
    }
  }

  // 2. Binary search fallback when seeking or currentIndex is out of range
  let low = 0;
  let high = cues.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const cue = cues[mid];

    // Give a 0.05s buffer to avoid jitter
    if (currentTime >= cue.start - 0.05 && currentTime <= cue.end + 0.05) {
      return mid;
    } else if (currentTime < cue.start) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return -1;
}

/**
 * Find index of previous subtitle cue
 */
export function findPreviousCueIndex(cues: SubtitleCue[], currentIndex: number, currentTime: number): number {
  if (!cues || cues.length === 0) return -1;
  if (currentIndex > 0) return currentIndex - 1;
  if (currentIndex === 0) return 0;

  // If not currently in a cue (currentIndex < 0), find the closest one before currentTime
  for (let i = cues.length - 1; i >= 0; i--) {
    if (cues[i].end <= currentTime) {
      return i;
    }
  }
  return -1;
}

/**
 * Find index of next subtitle cue
 */
export function findNextCueIndex(cues: SubtitleCue[], currentIndex: number, currentTime: number): number {
  if (!cues || cues.length === 0) return -1;
  if (currentIndex >= 0 && currentIndex < cues.length - 1) return currentIndex + 1;

  // If not currently in a cue, find the first one after currentTime
  for (let i = 0; i < cues.length; i++) {
    if (cues[i].start > currentTime) {
      return i;
    }
  }
  return cues.length - 1;
}
