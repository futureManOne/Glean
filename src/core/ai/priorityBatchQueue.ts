/**
 * PriorityBatchQueue:
 * A time-aware priority queue for batching subtitle cues for AI translation.
 *
 * Prioritization:
 * 1. Immediate Focus Window: Cues closest to the current playback head (focusTime) are popped first.
 * 2. Forward Streaming: Pops subsequent cues progressing forward towards the end of the video.
 * 3. Sweep Wrap-Around: After reaching the end, pops earlier cues from start up to the initial focus position.
 * 4. Seek Preemption: When playback position jumps (seek), updating focusTime immediately routes the next popped batch to the newly focused playback window.
 */
export class PriorityBatchQueue<T extends { id: number; start: number; end: number }> {
  private remainingMap = new Map<number, T>();
  private sortedList: T[];

  constructor(items: T[]) {
    // Keep items sorted chronologically by start time
    this.sortedList = [...items].sort((a, b) => a.start - b.start);
    for (const item of this.sortedList) {
      this.remainingMap.set(item.id, item);
    }
  }

  public get total(): number {
    return this.sortedList.length;
  }

  public get remainingCount(): number {
    return this.remainingMap.size;
  }

  public hasRemaining(): boolean {
    return this.remainingMap.size > 0;
  }

  /**
   * Pops the next batch of up to `batchSize` items prioritizing items closest to `focusTime`.
   */
  public popNextBatch(focusTime: number, batchSize: number): T[] {
    if (this.remainingMap.size === 0) return [];

    let bestIndex = -1;
    let minDistance = Infinity;

    // 1. Exact match: cue whose time strictly covers focusTime
    for (let i = 0; i < this.sortedList.length; i++) {
      const item = this.sortedList[i];
      if (!this.remainingMap.has(item.id)) continue;

      if (item.start <= focusTime && item.end >= focusTime) {
        bestIndex = i;
        break;
      }
    }

    // 2. Earliest remaining cue starting immediately at or after focusTime
    if (bestIndex === -1) {
      for (let i = 0; i < this.sortedList.length; i++) {
        const item = this.sortedList[i];
        if (!this.remainingMap.has(item.id)) continue;

        if (item.start >= focusTime) {
          const dist = item.start - focusTime;
          if (dist < minDistance) {
            minDistance = dist;
            bestIndex = i;
          }
        }
      }
    }

    // 3. Margin match: cue ending right before focusTime (within 0.5s acoustic tail)
    if (bestIndex === -1) {
      for (let i = 0; i < this.sortedList.length; i++) {
        const item = this.sortedList[i];
        if (!this.remainingMap.has(item.id)) continue;

        if (item.start - 0.5 <= focusTime && item.end + 0.5 >= focusTime) {
          bestIndex = i;
          break;
        }
      }
    }

    // 3. Third priority: if focusTime is past the last remaining cue, pick the closest remaining cue before focusTime
    if (bestIndex === -1) {
      for (let i = this.sortedList.length - 1; i >= 0; i--) {
        const item = this.sortedList[i];
        if (this.remainingMap.has(item.id)) {
          bestIndex = i;
          break;
        }
      }
    }

    // 4. Fallback: pick the first available remaining cue
    if (bestIndex === -1) {
      for (let i = 0; i < this.sortedList.length; i++) {
        if (this.remainingMap.has(this.sortedList[i].id)) {
          bestIndex = i;
          break;
        }
      }
    }

    if (bestIndex === -1) return [];

    const batch: T[] = [];

    // Forward gather starting at bestIndex
    for (let i = bestIndex; i < this.sortedList.length && batch.length < batchSize; i++) {
      const item = this.sortedList[i];
      if (this.remainingMap.has(item.id)) {
        batch.push(item);
        this.remainingMap.delete(item.id);
      }
    }

    // Backward wrap-around if batch is not yet full
    if (batch.length < batchSize) {
      for (let i = bestIndex - 1; i >= 0 && batch.length < batchSize; i--) {
        const item = this.sortedList[i];
        if (this.remainingMap.has(item.id)) {
          batch.push(item);
          this.remainingMap.delete(item.id);
        }
      }
    }

    return batch;
  }
}
