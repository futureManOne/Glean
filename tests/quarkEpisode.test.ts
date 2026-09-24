import { describe, it, expect } from 'bun:test';
import {
  extractEpisodeNumber,
  scoreSubtitleQuality,
  matchEpisodeSubtitle
} from '../src/core/quark/quarkSubtitleSniffer';
import { useAppStore } from '../src/store/useAppStore';

describe('Quark Episode Matching & Session Reset', () => {
  describe('extractEpisodeNumber', () => {
    it('extracts season and episode from SxxExx notation', () => {
      expect(extractEpisodeNumber('Friends.S01E02.1080p.mkv')).toEqual({ season: 1, episode: 2 });
      expect(extractEpisodeNumber('Breaking.Bad.s05e16.720p.mp4')).toEqual({ season: 5, episode: 16 });
      expect(extractEpisodeNumber('S2E9.mp4')).toEqual({ season: 2, episode: 9 });
      expect(extractEpisodeNumber('Season 3 Episode 12.mkv')).toEqual({ season: 3, episode: 12 });
    });

    it('extracts season and episode from multiplier notation (1x02)', () => {
      expect(extractEpisodeNumber('Rick.and.Morty.4x05.HDTV.mp4')).toEqual({ season: 4, episode: 5 });
      expect(extractEpisodeNumber('Show.01x03.mkv')).toEqual({ season: 1, episode: 3 });
    });

    it('extracts episode from EP / E notation', () => {
      expect(extractEpisodeNumber('Attack_on_Titan_EP12.mp4')).toEqual({ episode: 12 });
      expect(extractEpisodeNumber('One_Piece_ep.1050.mkv')).toEqual({ episode: 1050 });
      expect(extractEpisodeNumber('Game.of.Thrones.E04.mp4')).toEqual({ episode: 4 });
      expect(extractEpisodeNumber('Show.E2.mp4')).toEqual({ episode: 2 });
    });

    it('extracts episode from Chinese episode notation', () => {
      expect(extractEpisodeNumber('海贼王.第1050集.mp4')).toEqual({ episode: 1050 });
      expect(extractEpisodeNumber('火影忍者_第02话_超清.mkv')).toEqual({ episode: 2 });
      expect(extractEpisodeNumber('脱口秀大会.03期.mp4')).toEqual({ episode: 3 });
    });

    it('extracts episode from bracketed numbers excluding resolution and year', () => {
      expect(extractEpisodeNumber('[DBD-Raws][Spy_x_Family][05][1080P].mp4')).toEqual({ episode: 5 });
      expect(extractEpisodeNumber('【NC-Raws】 鬼灭之刃 【02】 (1080P).mkv')).toEqual({ episode: 2 });
    });

    it('extracts episode from trailing delimited number before extension', () => {
      expect(extractEpisodeNumber('Westworld - 03.mp4')).toEqual({ episode: 3 });
      expect(extractEpisodeNumber('Silicon Valley.04.srt')).toEqual({ episode: 4 });
    });

    it('returns null for movie files with only year and resolution metadata', () => {
      expect(extractEpisodeNumber('Inception.2010.1080p.BluRay.x264.mp4')).toBeNull();
      expect(extractEpisodeNumber('Avatar.The.Way.of.Water.2022.2160p.mkv')).toBeNull();
    });
  });

  describe('scoreSubtitleQuality', () => {
    it('gives highest score to bilingual subtitles', () => {
      const bilingualScore = scoreSubtitleQuality('Friends.S01E02.chs&eng.ass');
      const chineseScore = scoreSubtitleQuality('Friends.S01E02.chs.ass');
      const englishScore = scoreSubtitleQuality('Friends.S01E02.eng.ass');

      expect(bilingualScore).toBeGreaterThan(chineseScore);
      expect(chineseScore).toBeGreaterThan(englishScore);
    });

    it('prefers ASS format over SRT and VTT for typography formatting', () => {
      const assScore = scoreSubtitleQuality('ep02.ass');
      const srtScore = scoreSubtitleQuality('ep02.srt');
      const vttScore = scoreSubtitleQuality('ep02.vtt');

      expect(assScore).toBeGreaterThan(srtScore);
      expect(srtScore).toBeGreaterThan(vttScore);
    });
  });

  describe('matchEpisodeSubtitle', () => {
    const folderSubtitles = [
      { name: 'Friends.S01E01.chs&eng.ass' },
      { name: 'Friends.S01E02.chs.srt' },
      { name: 'Friends.S01E02.chs&eng.ass' },
      { name: 'Friends.S01E02.eng.srt' },
      { name: 'Friends.S01E03.chs&eng.ass' },
      { name: 'Friends.S02E02.chs&eng.ass' }
    ];

    it('matches the exact episode and season, prioritizing bilingual ASS', () => {
      const videoName = 'Friends.S01E02.1080p.BluRay.mkv';
      const matched = matchEpisodeSubtitle(videoName, folderSubtitles);
      expect(matched).not.toBeNull();
      expect(matched?.name).toBe('Friends.S01E02.chs&eng.ass');
    });

    it('distinguishes different seasons with same episode number', () => {
      const videoSeason2 = 'Friends.S02E02.1080p.mkv';
      const matched = matchEpisodeSubtitle(videoSeason2, folderSubtitles);
      expect(matched?.name).toBe('Friends.S02E02.chs&eng.ass');
    });

    it('matches when episode notations differ between video and subtitle', () => {
      const subs = [
        { name: '海贼王.1050.中日双语.ass' },
        { name: '海贼王.1051.中日双语.ass' }
      ];
      const video = 'OnePiece.第1050集.1080p.mp4';
      const matched = matchEpisodeSubtitle(video, subs);
      expect(matched?.name).toBe('海贼王.1050.中日双语.ass');
    });

    it('returns null when no episode in folder matches the video', () => {
      const video = 'Friends.S01E09.1080p.mkv';
      const matched = matchEpisodeSubtitle(video, folderSubtitles);
      expect(matched).toBeNull();
    });
  });

  describe('useAppStore resetVideoSession', () => {
    it('completely resets cues, offset, title and user imported flag', () => {
      const store = useAppStore.getState();

      // Simulate loaded subtitles
      store.loadSubtitleFileContent(
        '1\n00:00:01,000 --> 00:00:03,000\nHello episode 1\n你好第一集\n',
        'Episode1.srt',
        true
      );
      store.adjustTimeOffset(1.5);

      expect(useAppStore.getState().cues.length).toBe(1);
      expect(useAppStore.getState().subtitleTimeOffset).toBe(1.5);
      expect(useAppStore.getState().isUserImportedSubtitle).toBe(true);

      // Now reset session on next episode
      useAppStore.getState().resetVideoSession('blob:http://quark/video2', 'Episode 2');

      const resetState = useAppStore.getState();
      expect(resetState.cues.length).toBe(0);
      expect(resetState.currentCueIndex).toBe(-1);
      expect(resetState.currentTime).toBe(0);
      expect(resetState.subtitleTimeOffset).toBe(0);
      expect(resetState.isUserImportedSubtitle).toBe(false);
      expect(resetState.videoTitle).toBe('Episode 2');
      expect(resetState.currentVideoId).toBe('blob:http://quark/video2');
    });
  });
});
