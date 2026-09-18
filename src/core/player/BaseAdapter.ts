export interface VideoPlayerAdapter {
  name: string;
  isMatched(): boolean;
  getVideoElement(): HTMLVideoElement | null;
  getContainer(): HTMLElement | null;
  getCurrentTime(): number;
  getDuration(): number;
  isPaused(): boolean;
  seek(seconds: number): void;
  play(): void;
  pause(): void;
  togglePlay(): void;
  setPlaybackRate(rate: number): void;
  onTimeUpdate(callback: (currentTime: number) => void): () => void;
  onPlayStateChange(callback: (paused: boolean) => void): () => void;
}
