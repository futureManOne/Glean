import { expect, test, describe } from 'bun:test';
import { PriorityBatchQueue } from '@/core/ai/priorityBatchQueue';

interface TestCue {
  id: number;
  start: number;
  end: number;
  text: string;
}

describe('PriorityBatchQueue', () => {
  const cues: TestCue[] = [
    { id: 1, start: 0, end: 2.5, text: 'Hello world' },
    { id: 2, start: 3.0, end: 5.5, text: 'Welcome to Glean' },
    { id: 3, start: 6.0, end: 8.0, text: 'Learning languages' },
    { id: 4, start: 10.0, end: 12.0, text: 'Deep modules' },
    { id: 5, start: 13.0, end: 15.0, text: 'Clean architecture' },
    { id: 6, start: 16.0, end: 18.0, text: 'Test surface' },
  ];

  test('reports total count and remaining items correctly', () => {
    const queue = new PriorityBatchQueue(cues);
    expect(queue.total).toBe(6);
    expect(queue.remainingCount).toBe(6);
    expect(queue.hasRemaining()).toBe(true);
  });

  test('pops empty array when queue is empty', () => {
    const queue = new PriorityBatchQueue<TestCue>([]);
    expect(queue.total).toBe(0);
    expect(queue.remainingCount).toBe(0);
    expect(queue.hasRemaining()).toBe(false);
    expect(queue.popNextBatch(5.0, 3)).toEqual([]);
  });

  test('prioritizes exact cue currently playing at focusTime', () => {
    const queue = new PriorityBatchQueue(cues);
    // At 3.5s, cue 2 is playing (3.0 - 5.5)
    const batch = queue.popNextBatch(3.5, 2);
    expect(batch.length).toBe(2);
    expect(batch[0].id).toBe(2);
    expect(batch[1].id).toBe(3);
    expect(queue.remainingCount).toBe(4);
  });

  test('supports seek preemption by jumping focusTime to later timestamp', () => {
    const queue = new PriorityBatchQueue(cues);

    // Initial pop at start of video
    const firstBatch = queue.popNextBatch(0.5, 1);
    expect(firstBatch[0].id).toBe(1);

    // User seeks forward to 13.5s (cue 5: 13.0 - 15.0)
    const preemptedBatch = queue.popNextBatch(13.5, 2);
    expect(preemptedBatch[0].id).toBe(5);
    expect(preemptedBatch[1].id).toBe(6);

    // Forward is now exhausted (14.0s is past remaining cues). PriorityBatchQueue picks the
    // closest remaining cues before focusTime (cue 4 at 10.0s, then backwards cue 3 at 6.0s)
    const wrappedBatch = queue.popNextBatch(14.0, 2);
    expect(wrappedBatch[0].id).toBe(4);
    expect(wrappedBatch[1].id).toBe(3);
  });

  test('handles wrap-around when forward remaining cues are fewer than batchSize', () => {
    const queue = new PriorityBatchQueue(cues);
    // Focus near the end (cue 6) with batchSize 3
    const batch = queue.popNextBatch(16.5, 3);
    expect(batch[0].id).toBe(6);
    // Wraps backwards to closest prior remaining cues (cue 5, then cue 4)
    expect(batch[1].id).toBe(5);
    expect(batch[2].id).toBe(4);
  });

  test('exhausts all items across successive pops without duplicates', () => {
    const queue = new PriorityBatchQueue(cues);
    const gatheredIds: number[] = [];

    while (queue.hasRemaining()) {
      const batch = queue.popNextBatch(7.0, 2);
      for (const item of batch) {
        gatheredIds.push(item.id);
      }
    }

    expect(gatheredIds.length).toBe(6);
    // Ensure all 6 distinct cues were popped exactly once
    expect(new Set(gatheredIds).size).toBe(6);
    expect(queue.remainingCount).toBe(0);
    expect(queue.hasRemaining()).toBe(false);
  });
});
