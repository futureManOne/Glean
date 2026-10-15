import { expect, test, describe } from 'bun:test';
import { BaseVideoPlayerAdapter } from '@/core/player/BaseAdapter';

class TestVideoAdapter extends BaseVideoPlayerAdapter {
  name = 'TestVideoAdapter';
  public videoElement: HTMLVideoElement | null = null;

  isMatched(): boolean {
    return true;
  }

  getVideoElement(): HTMLVideoElement | null {
    return this.videoElement;
  }
}

describe('BaseVideoPlayerAdapter', () => {
  test('returns safe defaults when video element is null', () => {
    const adapter = new TestVideoAdapter();
    adapter.videoElement = null;

    expect(adapter.getCurrentTime()).toBe(0);
    expect(adapter.getDuration()).toBe(0);
    expect(adapter.isPaused()).toBe(true);
    expect(adapter.getContainer()).toBeNull();

    // Safe execution of controls without throwing
    adapter.seek(10);
    adapter.play();
    adapter.pause();
    adapter.togglePlay();
    adapter.setPlaybackRate(1.5);

    const unsubTime = adapter.onTimeUpdate(() => {});
    expect(typeof unsubTime).toBe('function');
    unsubTime();

    const unsubPlay = adapter.onPlayStateChange(() => {});
    expect(typeof unsubPlay).toBe('function');
    unsubPlay();
  });

  test('delegates time and state reads to backing video element', () => {
    const adapter = new TestVideoAdapter();
    const fakeVideo = {
      currentTime: 42.5,
      duration: 120,
      paused: false,
      playbackRate: 1.0,
      play: async () => {},
      pause: () => {
        fakeVideo.paused = true;
      },
    } as unknown as HTMLVideoElement;

    adapter.videoElement = fakeVideo;

    expect(adapter.getCurrentTime()).toBe(42.5);
    expect(adapter.getDuration()).toBe(120);
    expect(adapter.isPaused()).toBe(false);

    adapter.pause();
    expect(fakeVideo.paused).toBe(true);
    expect(adapter.isPaused()).toBe(true);

    adapter.setPlaybackRate(1.75);
    expect(fakeVideo.playbackRate).toBe(1.75);

    adapter.seek(60);
    expect(fakeVideo.currentTime).toBe(60);
  });

  test('bounds seek within 0 and duration', () => {
    const adapter = new TestVideoAdapter();
    const fakeVideo = {
      currentTime: 10,
      duration: 100,
    } as unknown as HTMLVideoElement;
    adapter.videoElement = fakeVideo;

    adapter.seek(-5);
    expect(fakeVideo.currentTime).toBe(0);

    adapter.seek(150);
    expect(fakeVideo.currentTime).toBe(100);
  });

  test('registers and unregisters timeupdate and play/pause event listeners', () => {
    const listeners: Record<string, Function[]> = {
      timeupdate: [],
      play: [],
      pause: [],
    };

    const fakeVideo = {
      currentTime: 15.0,
      addEventListener: (event: string, handler: Function) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(handler);
      },
      removeEventListener: (event: string, handler: Function) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter(h => h !== handler);
        }
      },
    } as unknown as HTMLVideoElement;

    const adapter = new TestVideoAdapter();
    adapter.videoElement = fakeVideo;

    let reportedTime = 0;
    const unsubTime = adapter.onTimeUpdate((t) => {
      reportedTime = t;
    });

    expect(listeners.timeupdate.length).toBe(1);
    listeners.timeupdate[0]();
    expect(reportedTime).toBe(15.0);

    unsubTime();
    expect(listeners.timeupdate.length).toBe(0);

    let isPausedState = false;
    const unsubPlayState = adapter.onPlayStateChange((paused) => {
      isPausedState = paused;
    });

    expect(listeners.play.length).toBe(1);
    expect(listeners.pause.length).toBe(1);

    listeners.play[0]();
    expect(isPausedState).toBe(false);

    listeners.pause[0]();
    expect(isPausedState).toBe(true);

    unsubPlayState();
    expect(listeners.play.length).toBe(0);
    expect(listeners.pause.length).toBe(0);
  });
});
