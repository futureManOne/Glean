import { describe, it, expect } from 'bun:test';
import {
  decodeSubtitleBuffer,
  cleanAssText,
  splitBilingualLines,
  parseAssSubtitles,
  parseLrcSubtitles,
  parseMicroDvdSubtitles,
  parseTtmlSubtitles,
  parseBccJsonSubtitles,
  parseSubtitleContent,
  parseYouTubeJson3,
  sliceYouTubeAsrEvent,
  alignBilingualJson3Events,
  assembleLongAsrSentences,
  segmentCuesLocally,
  splitLongCueSemantically,
  timeStringToSeconds,
  formatTimestamp,
  sanitizeCues,
  isCjkText,
  isChineseText
} from '../src/core/subtitle/parser';
import {
  splitOverlongAiSentence,
  alignSentencesToAcousticTimestamps
} from '../src/core/ai/semanticSegmenter';

describe('Subtitle Parser & Encoding Decoder', () => {
  describe('decodeSubtitleBuffer', () => {
    it('decodes UTF-8 text with BOM correctly', () => {
      const text = 'Hello world, UTF-8 with BOM';
      const encoded = new TextEncoder().encode(text);
      const bom = new Uint8Array([0xEF, 0xBB, 0xBF, ...encoded]);
      const decoded = decodeSubtitleBuffer(bom);
      expect(decoded).toBe(text);
    });

    it('decodes standard UTF-8 text without BOM', () => {
      const text = '1\n00:00:01,000 --> 00:00:04,000\nHello world\n你好世界\n';
      const encoded = new TextEncoder().encode(text);
      const decoded = decodeSubtitleBuffer(encoded);
      expect(decoded).toBe(text);
    });

    it('decodes UTF-16LE text with BOM', () => {
      const str = '1\n00:00:01,000 --> 00:00:03,000\nTest UTF16\n';
      const buffer = new Uint8Array(2 + str.length * 2);
      buffer[0] = 0xFF;
      buffer[1] = 0xFE;
      for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        buffer[2 + i * 2] = code & 0xFF;
        buffer[2 + i * 2 + 1] = (code >> 8) & 0xFF;
      }
      const decoded = decodeSubtitleBuffer(buffer);
      expect(decoded).toBe(str);
    });
  });

  describe('cleanAssText', () => {
    it('strips ASS font, color, and position override tags', () => {
      const raw = '{\\pos(192,240)\\fn微软雅黑\\fs18\\b1\\c&H00FFFF&}Look out!{\\r} Watch your step.';
      const cleaned = cleanAssText(raw);
      expect(cleaned).toBe('Look out! Watch your step.');
    });

    it('removes ASS vector drawing commands and drawing paths', () => {
      const raw = '{\\p1}m 0 0 l 100 0 l 100 100 l 0 100{\\p0}Genuine dialogue text';
      const cleaned = cleanAssText(raw);
      expect(cleaned).toBe('Genuine dialogue text');
    });

    it('filters out lines that only contain standalone vector drawing paths', () => {
      const raw = 'm 0 0 l 100 0 l 100 100 l 0 100';
      const cleaned = cleanAssText(raw);
      expect(cleaned).toBe('');
    });

    it('converts \\N and \\h into clean newlines and spaces', () => {
      const raw = 'First\\Nline\\hwith\\hspaces';
      const cleaned = cleanAssText(raw);
      expect(cleaned).toBe('First\nline with spaces');
    });
  });

  describe('splitBilingualLines', () => {
    it('splits bilingual lines with English on top and Chinese on bottom', () => {
      const lines = ['Never give up.', '永不言弃。'];
      const { textEn, textZh } = splitBilingualLines(lines);
      expect(textEn).toBe('Never give up.');
      expect(textZh).toBe('永不言弃。');
    });

    it('splits bilingual lines with Chinese on top and English on bottom', () => {
      const lines = ['永不言弃。', 'Never give up.'];
      const { textEn, textZh } = splitBilingualLines(lines);
      expect(textEn).toBe('Never give up.');
      expect(textZh).toBe('永不言弃。');
    });

    it('handles monolingual multi-line sentences without misclassification', () => {
      const enLines = ['This is a long sentence', 'that spans across two lines.'];
      const enRes = splitBilingualLines(enLines);
      expect(enRes.textEn).toBe('This is a long sentence that spans across two lines.');
      expect(enRes.textZh).toBe('');

      const zhLines = ['这是一句很长很长的台词', '跨越了两行显示。'];
      const zhRes = splitBilingualLines(zhLines);
      expect(zhRes.textEn).toBe('');
      expect(zhRes.textZh).toBe('这是一句很长很长的台词跨越了两行显示。');
    });
  });

  describe('parseAssSubtitles (Advanced ASS / SSA)', () => {
    it('parses standard ASS file with \\N bilingual lines', () => {
      const assContent = `
[Script Info]
Title: Sample ASS Fansub
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:01:23.45,0:01:26.78,Default,,0,0,0,,{\\fn微软雅黑\\fs16}Good morning, detective.\\N{\\fn黑体\\fs14}早上好，警探。
Dialogue: 0,0:01:27.00,0:01:30.00,Default,,0,0,0,,{\\c&H00FFFF&}Did you find anything?\\N你有什么发现吗？
`;
      const cues = parseAssSubtitles(assContent);
      expect(cues.length).toBe(2);

      expect(cues[0].start).toBeCloseTo(83.45, 2);
      expect(cues[0].end).toBeCloseTo(86.78, 2);
      expect(cues[0].textEn).toBe('Good morning, detective.');
      expect(cues[0].textZh).toBe('早上好，警探。');

      expect(cues[1].start).toBeCloseTo(87.0, 2);
      expect(cues[1].end).toBeCloseTo(90.0, 2);
      expect(cues[1].textEn).toBe('Did you find anything?');
      expect(cues[1].textZh).toBe('你有什么发现吗？');
    });

    it('handles dual-event alignment: pairs separate English & Chinese Dialogue lines with identical timestamps', () => {
      const dualEventAss = `
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:10.00,0:00:13.50,English,,0,0,0,,I didn't expect to see you here.
Dialogue: 0,0:00:10.00,0:00:13.50,Chinese,,0,0,0,,真没想到会在这里见到你。
Dialogue: 0,0:00:14.00,0:00:17.00,English,,0,0,0,,We must leave right now.
Dialogue: 0,0:00:14.00,0:00:17.00,Chinese,,0,0,0,,我们必须马上离开。
`;
      const cues = parseAssSubtitles(dualEventAss);
      expect(cues.length).toBe(2);

      expect(cues[0].textEn).toBe("I didn't expect to see you here.");
      expect(cues[0].textZh).toBe('真没想到会在这里见到你。');
      expect(cues[0].start).toBeCloseTo(10.0, 1);
      expect(cues[0].end).toBeCloseTo(13.5, 1);

      expect(cues[1].textEn).toBe('We must leave right now.');
      expect(cues[1].textZh).toBe('我们必须马上离开。');
    });

    it('dynamically adapts to custom Format header columns', () => {
      const customFormatAss = `
[Events]
Format: Start, End, Style, Text
Dialogue: 0:02:15.00,0:02:18.50,Default,Target acquired!
Dialogue: 0:02:19.00,0:02:22.00,Default,Mission accomplished.
`;
      const cues = parseAssSubtitles(customFormatAss);
      expect(cues.length).toBe(2);
      expect(cues[0].start).toBeCloseTo(135.0, 1);
      expect(cues[0].end).toBeCloseTo(138.5, 1);
      expect(cues[0].textEn).toBe('Target acquired!');
    });
  });

  describe('parseLrcSubtitles', () => {
    it('parses standard timestamped lyrics', () => {
      const lrcContent = `
[00:04.50]Is this the real life?
[00:08.20]Is this just fantasy?
[00:12.80]Caught in a landslide, no escape from reality.
`;
      const cues = parseLrcSubtitles(lrcContent);
      expect(cues.length).toBe(3);
      expect(cues[0].start).toBeCloseTo(4.5, 2);
      expect(cues[0].end).toBeCloseTo(8.2, 2);
      expect(cues[0].textEn).toBe('Is this the real life?');

      expect(cues[1].start).toBeCloseTo(8.2, 2);
      expect(cues[1].textEn).toBe('Is this just fantasy?');
    });

    it('parses bilingual LRC lyrics with slash separator', () => {
      const lrcBilingual = `
[01:05.30]Welcome to our world / 欢迎来到我们的世界
`;
      const cues = parseLrcSubtitles(lrcBilingual);
      expect(cues.length).toBe(1);
      expect(cues[0].textEn).toBe('Welcome to our world');
      expect(cues[0].textZh).toBe('欢迎来到我们的世界');
    });
  });

  describe('parseMicroDvdSubtitles', () => {
    it('parses frame-based MicroDVD .sub with 25 fps', () => {
      const subContent = `
{25}{75}Hello from MicroDVD
{100}{150}Line 1|Line 2
`;
      const cues = parseMicroDvdSubtitles(subContent, 25);
      expect(cues.length).toBe(2);
      expect(cues[0].start).toBeCloseTo(1.0, 2);
      expect(cues[0].end).toBeCloseTo(3.0, 2);
      expect(cues[0].textEn).toBe('Hello from MicroDVD');

      expect(cues[1].start).toBeCloseTo(4.0, 2);
      expect(cues[1].end).toBeCloseTo(6.0, 2);
      expect(cues[1].textEn).toBe('Line 1 Line 2');
    });

    it('parses time-based MicroDVD subtitles', () => {
      const subContent = `
{00:01:20}{00:01:25}Time-based MicroDVD line
`;
      const cues = parseMicroDvdSubtitles(subContent);
      expect(cues.length).toBe(1);
      expect(cues[0].start).toBeCloseTo(80.0, 1);
      expect(cues[0].end).toBeCloseTo(85.0, 1);
      expect(cues[0].textEn).toBe('Time-based MicroDVD line');
    });
  });

  describe('parseTtmlSubtitles', () => {
    it('parses XML / TTML timed text subtitles', () => {
      const ttmlContent = `
<tt xmlns="http://www.w3.org/ns/ttml">
  <body>
    <div>
      <p begin="00:00:10.500" end="00:00:14.200">Welcome to Netflix series.<br/>欢迎观看本节目。</p>
      <p begin="00:00:15.000" dur="00:00:03.000">Chapter One starts now.</p>
    </div>
  </body>
</tt>
`;
      const cues = parseTtmlSubtitles(ttmlContent);
      expect(cues.length).toBe(2);
      expect(cues[0].start).toBeCloseTo(10.5, 2);
      expect(cues[0].end).toBeCloseTo(14.2, 2);
      expect(cues[0].textEn).toBe('Welcome to Netflix series.');
      expect(cues[0].textZh).toBe('欢迎观看本节目。');

      expect(cues[1].start).toBeCloseTo(15.0, 1);
      expect(cues[1].end).toBeCloseTo(18.0, 1);
      expect(cues[1].textEn).toBe('Chapter One starts now.');
    });
  });

  describe('parseBccJsonSubtitles', () => {
    it('parses Bilibili BCC / JSON subtitle structure', () => {
      const jsonContent = JSON.stringify({
        body: [
          { from: 1.5, to: 4.2, content: "Hello world\n你好世界" },
          { from: 5.0, to: 8.0, content: "Learning English with Glean" }
        ]
      });
      const cues = parseBccJsonSubtitles(jsonContent);
      expect(cues.length).toBe(2);
      expect(cues[0].start).toBeCloseTo(1.5, 2);
      expect(cues[0].end).toBeCloseTo(4.2, 2);
      expect(cues[0].textEn).toBe('Hello world');
      expect(cues[0].textZh).toBe('你好世界');

      expect(cues[1].start).toBeCloseTo(5.0, 2);
      expect(cues[1].textEn).toBe('Learning English with Glean');
    });
  });

  describe('parseSubtitleContent routing & unified entry', () => {
    it('routes SRT subtitle content', () => {
      const srt = `1
00:00:01,000 --> 00:00:04,000
First sentence
第一句

2
00:00:05,000 --> 00:00:08,000
Second sentence
第二句
`;
      const cues = parseSubtitleContent(srt);
      expect(cues.length).toBe(2);
      expect(cues[0].textEn).toBe('First sentence');
      expect(cues[0].textZh).toBe('第一句');
    });

    it('routes WebVTT subtitle content', () => {
      const vtt = `WEBVTT

00:00:02.000 --> 00:00:05.000
WebVTT line
VTT 中文
`;
      const cues = parseSubtitleContent(vtt);
      expect(cues.length).toBe(1);
      expect(cues[0].textEn).toBe('WebVTT line');
      expect(cues[0].textZh).toBe('VTT 中文');
    });

    it('routes ASS subtitle content', () => {
      const ass = `[Events]
Format: Start, End, Style, Text
Dialogue: 0:00:01.00,0:00:03.00,Default,ASS Subtitle\\NASS 中文字幕
`;
      const cues = parseSubtitleContent(ass);
      expect(cues.length).toBe(1);
      expect(cues[0].textEn).toBe('ASS Subtitle');
      expect(cues[0].textZh).toBe('ASS 中文字幕');
    });

    it('routes ArrayBuffer input directly', () => {
      const text = `1
00:00:01,000 --> 00:00:03,000
Buffer test
`;
      const buf = new TextEncoder().encode(text).buffer;
      const cues = parseSubtitleContent(buf);
      expect(cues.length).toBe(1);
      expect(cues[0].textEn).toBe('Buffer test');
    });
  });

  describe('sanitizeCues timeline and protection', () => {
    it('preserves simultaneous dual-language cues without clipping', () => {
      const rawCues = [
        { id: 1, start: 5.0, end: 8.0, textEn: 'This is English only', textZh: '' },
        { id: 2, start: 5.0, end: 8.0, textEn: '', textZh: '这是对应的中文' }
      ];
      const sanitized = sanitizeCues(rawCues);
      expect(sanitized.length).toBe(1);
      expect(sanitized[0].textEn).toBe('This is English only');
      expect(sanitized[0].textZh).toBe('这是对应的中文');
      expect(sanitized[0].start).toBeCloseTo(5.0, 1);
      expect(sanitized[0].end).toBeCloseTo(8.0, 1);
    });

    it('converts timestamp strings and formats seconds accurately', () => {
      expect(timeStringToSeconds('01:23.456')).toBeCloseTo(83.456, 3);
      expect(timeStringToSeconds('01:23,456')).toBeCloseTo(83.456, 3);
      expect(timeStringToSeconds('01:02:03.450')).toBeCloseTo(3723.45, 2);
      expect(formatTimestamp(83.456)).toBe('01:23');
      expect(formatTimestamp(3723)).toBe('01:02:03');
    });
  });

  describe('YouTube JSON3 ASR vs Manual Captions & Concise Timing Alignment', () => {
    it('preserves manual captions 1:1 without altering timestamps or merging cues', () => {
      const manualJson = {
        events: [
          { tStartMs: 1000, dDurationMs: 2500, segs: [{ utf8: 'Welcome to this presentation.' }] },
          { tStartMs: 3800, dDurationMs: 1900, segs: [{ utf8: 'Today we discuss language reactor.' }] },
          { tStartMs: 6000, dDurationMs: 3100, segs: [{ utf8: 'Notice that each line is distinct.' }] }
        ]
      };
      const cues = parseYouTubeJson3(manualJson, undefined, false);
      expect(cues.length).toBe(3);
      expect(cues[0].start).toBeCloseTo(1.0, 2);
      expect(cues[0].end).toBeCloseTo(3.5, 2);
      expect(cues[0].textEn).toBe('Welcome to this presentation.');
      expect(cues[1].start).toBeCloseTo(3.8, 2);
      expect(cues[1].end).toBeCloseTo(5.7, 2);
      expect(cues[1].textEn).toBe('Today we discuss language reactor.');
      expect(cues[2].start).toBeCloseTo(6.0, 2);
      expect(cues[2].end).toBeCloseTo(9.1, 2);
      expect(cues[2].textEn).toBe('Notice that each line is distinct.');
    });

    it('splits ASR multi-line events with tOffsetMs into micro-timestamped cues', () => {
      const asrJson = {
        events: [
          {
            tStartMs: 10000,
            dDurationMs: 4000,
            segs: [
              { utf8: 'and so I went' },
              { utf8: '\nto the store', tOffsetMs: 1800 },
              { utf8: '\nand bought groceries', tOffsetMs: 3000 }
            ]
          }
        ]
      };
      const cues = parseYouTubeJson3(asrJson, undefined, true);
      expect(cues.length).toBeGreaterThanOrEqual(2);
      expect(cues[0].start).toBeCloseTo(10.0, 1);
      expect(cues[0].textEn).toContain('and so I went');
      for (const cue of cues) {
        const words = (cue.textEn || '').split(/\s+/).filter(Boolean).length;
        expect(words).toBeLessThanOrEqual(14);
        expect((cue.textEn || '').length).toBeLessThanOrEqual(70);
      }
    });

    it('simulates fast continuous unpunctuated ASR speech (Emma Markin style) and enforces concise boundaries', () => {
      const rawEvents = [
        { tStartMs: 132000, dDurationMs: 1800, segs: [{ utf8: 'i think that was one of the' }] },
        { tStartMs: 133800, dDurationMs: 1700, segs: [{ utf8: 'biggest changes in my entire life' }] },
        { tStartMs: 135500, dDurationMs: 1900, segs: [{ utf8: 'because when i moved to that city' }] },
        { tStartMs: 137400, dDurationMs: 2000, segs: [{ utf8: 'i had no friends and no family' }] },
        { tStartMs: 139400, dDurationMs: 2100, segs: [{ utf8: 'so i had to start completely over' }] },
        { tStartMs: 141500, dDurationMs: 2200, segs: [{ utf8: 'and build everything from scratch again' }] }
      ];

      const cues = parseYouTubeJson3({ events: rawEvents }, undefined, true);

      expect(cues.length).toBeGreaterThanOrEqual(3);
      for (const cue of cues) {
        const wordCount = (cue.textEn || '').split(/\s+/).filter(Boolean).length;
        expect(wordCount).toBeLessThanOrEqual(14);
        expect((cue.textEn || '').length).toBeLessThanOrEqual(70);
        expect(cue.end).toBeGreaterThan(cue.start);
        expect(cue.start).toBeGreaterThanOrEqual(132.0);
        expect(cue.end).toBeLessThanOrEqual(144.5);
      }

      const texts = cues.map(c => c.textEn);
      const hasConjunctionBreak = texts.some(t =>
        /^(because|so|and|i think|i had)\b/i.test(t) ||
        /\b(life|city|family|over)\b/i.test(t)
      );
      expect(hasConjunctionBreak).toBe(true);

      const totalWordsOriginal = rawEvents
        .map(e => e.segs[0].utf8)
        .join(' ')
        .split(/\s+/)
        .filter(Boolean).length;
      const totalWordsResult = cues
        .map(c => c.textEn)
        .join(' ')
        .split(/\s+/)
        .filter(Boolean).length;
      expect(totalWordsResult).toBe(totalWordsOriginal);
    });

    it('splits overlong cues semantically with exact word preservation and timing distribution', () => {
      const longCue = {
        id: 1,
        start: 10.0,
        end: 22.0,
        textEn: 'we have been traveling across the globe to explore different cultural traditions and we discovered many exciting things that inspired us to continue our journey forward',
        textZh: ''
      };
      const split = splitLongCueSemantically(longCue, 12, 70);
      expect(split.length).toBeGreaterThanOrEqual(2);

      for (const piece of split) {
        const words = piece.textEn.split(/\s+/).filter(Boolean);
        expect(words.length).toBeLessThanOrEqual(14);
        expect(piece.textEn.length).toBeLessThanOrEqual(70);
        expect(piece.end).toBeGreaterThan(piece.start);
      }

      expect(split[0].start).toBeCloseTo(10.0, 1);
      expect(split[split.length - 1].end).toBeCloseTo(22.0, 1);

      const originalWords = longCue.textEn.split(/\s+/).filter(Boolean);
      const resultWords = split.flatMap(c => c.textEn.split(/\s+/).filter(Boolean));
      expect(resultWords).toEqual(originalWords);
    });

    it('enforces CJK character length limit (<= 30 characters) without text truncation', () => {
      const longZhCue = {
        id: 1,
        start: 0.0,
        end: 10.0,
        textEn: '',
        textZh: '这是一个非常非常长的中文连续句子用于测试字幕切分引擎是否能够在超过三十个中文字符时进行自然断句并且不丢失任何文本内容'
      };
      const split = splitLongCueSemantically(longZhCue, 12, 70);
      expect(split.length).toBeGreaterThanOrEqual(2);

      for (const piece of split) {
        expect(piece.textZh.length).toBeLessThanOrEqual(30);
      }

      const joinedZh = split.map(c => c.textZh).join('');
      expect(joinedZh).toBe(longZhCue.textZh);
    });

    it('aligns bilingual manual YouTube tracks 1:1 without altering timestamps', () => {
      const origEvents = [
        { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'Hello world.' }] },
        { tStartMs: 3500, dDurationMs: 2000, segs: [{ utf8: 'How are you?' }] }
      ];
      const transEvents = [
        { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: '你好，世界。' }] },
        { tStartMs: 3500, dDurationMs: 2000, segs: [{ utf8: '你好吗？' }] }
      ];

      const cues = alignBilingualJson3Events(origEvents, transEvents, false);
      expect(cues.length).toBe(2);
      expect(cues[0].textEn).toBe('Hello world.');
      expect(cues[0].textZh).toBe('你好，世界。');
      expect(cues[0].start).toBeCloseTo(1.0, 2);
      expect(cues[0].end).toBeCloseTo(3.0, 2);
      expect(cues[1].textEn).toBe('How are you?');
      expect(cues[1].textZh).toBe('你好吗？');
      expect(cues[1].start).toBeCloseTo(3.5, 2);
      expect(cues[1].end).toBeCloseTo(5.5, 2);
    });

    it('accurately slices multi-word ASR events using tOffsetMs and silence gaps without newline', () => {
      const event = {
        events: [
          {
            tStartMs: 1000,
            dDurationMs: 9000,
            segs: [
              { utf8: 'hello', tOffsetMs: 0 },
              { utf8: ' everyone', tOffsetMs: 500 },
              { utf8: ' welcome', tOffsetMs: 1000 },
              { utf8: ' to', tOffsetMs: 1300 },
              { utf8: ' another', tOffsetMs: 1600 },
              { utf8: ' video', tOffsetMs: 1900 },
              { utf8: ' today', tOffsetMs: 2300 },
              { utf8: ' we', tOffsetMs: 2600 },
              { utf8: ' are', tOffsetMs: 2900 },
              { utf8: ' going', tOffsetMs: 3200 },
              { utf8: ' to', tOffsetMs: 3500 },
              { utf8: ' talk', tOffsetMs: 3800 },
              { utf8: ' about', tOffsetMs: 4100 },
              { utf8: ' something', tOffsetMs: 4400 },
              { utf8: ' very', tOffsetMs: 4700 },
              { utf8: ' special', tOffsetMs: 5000 },
              { utf8: ' and', tOffsetMs: 7000 },
              { utf8: ' I', tOffsetMs: 7300 },
              { utf8: ' hope', tOffsetMs: 7600 },
              { utf8: ' you', tOffsetMs: 7900 },
              { utf8: ' enjoy', tOffsetMs: 8200 },
              { utf8: ' it', tOffsetMs: 8500 }
            ]
          }
        ]
      };

      const cues = parseYouTubeJson3(event, undefined, true);
      expect(cues.length).toBeGreaterThanOrEqual(2);

      for (const c of cues) {
        const words = (c.textEn || '').split(/\s+/).filter(Boolean).length;
        expect(words).toBeLessThanOrEqual(14);
        expect((c.textEn || '').length).toBeLessThanOrEqual(70);
        expect(c.end).toBeGreaterThan(c.start);
      }

      // The pause occurred between 'special' (5000ms offset) and 'and' (7000ms offset).
      // The cue starting with 'and' should start at 8.0s (1000 + 7000ms) within 0.2s!
      const andCue = cues.find(c => c.textEn.startsWith('and'));
      expect(andCue).toBeDefined();
      if (andCue) {
        expect(andCue.start).toBeCloseTo(8.0, 1);
      }
    });

    it('accurately resolves tOffsetMs lookahead when newline segment lacks tOffsetMs', () => {
      const event = {
        events: [
          {
            tStartMs: 1000,
            dDurationMs: 5000,
            segs: [
              { utf8: 'hello world' },
              { utf8: '\n' },
              { utf8: 'good morning', tOffsetMs: 1200 }
            ]
          }
        ]
      };

      const cues = sliceYouTubeAsrEvent(event.events[0]);
      expect(cues.length).toBe(2);
      expect(cues[0].textEn).toBe('hello world');
      expect(cues[1].textEn).toBe('good morning');
      expect(cues[0].start).toBeCloseTo(1.0, 1);
      expect(cues[1].start).toBeCloseTo(2.2, 1);
    });

    it('strictly enforces <= 70 character hard limit on long technical / compound words in splitLongCueSemantically', () => {
      const longCue = {
        id: 1,
        start: 0.0,
        end: 15.0,
        textEn: 'Comprehensive telecommunication infrastructure investigations demonstrated extraordinary intergovernmental misunderstandings',
        textZh: ''
      };

      const split = splitLongCueSemantically(longCue, 12, 70);
      expect(split.length).toBeGreaterThanOrEqual(2);

      for (const piece of split) {
        expect(piece.textEn.length).toBeLessThanOrEqual(70);
        const words = piece.textEn.split(/\s+/).filter(Boolean);
        expect(words.length).toBeLessThanOrEqual(14);
      }

      const origWords = longCue.textEn.split(/\s+/).filter(Boolean);
      const resWords = split.flatMap(c => c.textEn.split(/\s+/).filter(Boolean));
      expect(resWords).toEqual(origWords);
    });

    it('preserves manual Chinese / Japanese subtitles 1:1 without false ASR classification', () => {
      const manualCjkJson = {
        events: [
          { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: '欢迎大家收看本期视频。' }] },
          { tStartMs: 3200, dDurationMs: 1800, segs: [{ utf8: '今天我们讨论语言反应堆的核心原理。' }] }
        ]
      };

      // In manual CJK, isAsrHint is false or undefined (no ASR url, no ASR label)
      const cues = parseYouTubeJson3(manualCjkJson, undefined, false);
      expect(cues.length).toBe(2);
      expect(cues[0].textZh).toBe('欢迎大家收看本期视频。');
      expect(cues[0].start).toBeCloseTo(1.0, 2);
      expect(cues[0].end).toBeCloseTo(3.0, 2);
      expect(cues[1].textZh).toBe('今天我们讨论语言反应堆的核心原理。');
      expect(cues[1].start).toBeCloseTo(3.2, 2);
      expect(cues[1].end).toBeCloseTo(5.0, 2);
    });
  });

  describe('AI Semantic Segmenter Overlength Breaking & Acoustic Alignment', () => {
    it('splits overlong AI sentence into <= 14 word pieces without vocabulary loss', () => {
      const overlongSentence =
        'I wanted to learn English so I started listening to podcasts every morning and reading articles every evening because consistency is the key to fluency.';
      const pieces = splitOverlongAiSentence(overlongSentence, 12, 70);

      expect(pieces.length).toBeGreaterThanOrEqual(2);
      for (const piece of pieces) {
        const words = piece.split(/\s+/).filter(Boolean);
        expect(words.length).toBeLessThanOrEqual(14);
        expect(piece.length).toBeLessThanOrEqual(70);
      }

      const originalWords = overlongSentence.split(/\s+/).filter(Boolean);
      const pieceWords = pieces.flatMap(p => p.split(/\s+/).filter(Boolean));
      expect(pieceWords).toEqual(originalWords);
    });

    it('aligns segmented sentences strictly to acoustic raw cues with monotonic timestamps', () => {
      const rawCues = [
        { id: 1, start: 1.0, end: 3.0, textEn: 'i wanted to learn english', textZh: '' },
        { id: 2, start: 3.1, end: 5.5, textEn: 'so i started listening to podcasts', textZh: '' },
        { id: 3, start: 5.6, end: 8.0, textEn: 'every morning and reading articles', textZh: '' },
        { id: 4, start: 8.1, end: 11.0, textEn: 'because consistency is the key', textZh: '' }
      ];

      const aiSentences = [
        'I wanted to learn English,',
        'so I started listening to podcasts every morning',
        'and reading articles,',
        'because consistency is the key.'
      ];

      const aligned = alignSentencesToAcousticTimestamps(aiSentences, rawCues);
      expect(aligned.length).toBe(4);

      for (let i = 0; i < aligned.length; i++) {
        const c = aligned[i];
        expect(c.end).toBeGreaterThan(c.start);
        if (i > 0) {
          expect(c.start).toBeGreaterThanOrEqual(aligned[i - 1].start);
        }
      }

      expect(aligned[0].start).toBeCloseTo(1.0, 1);
      expect(aligned[aligned.length - 1].end).toBeCloseTo(11.0, 1);
    });

    it('strictly enforces <= 70 characters on long compound / technical words in splitOverlongAiSentence', () => {
      const overlongCompound =
        'Comprehensive telecommunication infrastructure investigations demonstrated extraordinary intergovernmental misunderstandings';
      const pieces = splitOverlongAiSentence(overlongCompound, 12, 70);

      expect(pieces.length).toBeGreaterThanOrEqual(2);
      for (const piece of pieces) {
        expect(piece.length).toBeLessThanOrEqual(70);
        const words = piece.split(/\s+/).filter(Boolean);
        expect(words.length).toBeLessThanOrEqual(14);
      }

      const origWords = overlongCompound.split(/\s+/).filter(Boolean);
      const resWords = pieces.flatMap(p => p.split(/\s+/).filter(Boolean));
      expect(resWords).toEqual(origWords);
    });
  });

  describe('YouTubeSubtitleSniffer Network Timedtext Interception & TDZ Guard', () => {
    it('safely handles manual timedtext message without TDZ ReferenceError on parsedCues', () => {
      // Emulate the message listener logic from YouTubeSubtitleSniffer
      const eventData = {
        type: '__LR_YT_TIMEDTEXT__',
        content: JSON.stringify({
          events: [
            { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'Hello manual caption.' }] }
          ]
        }),
        format: 'json3',
        trackName: 'English (United States)',
        url: 'https://www.youtube.com/api/timedtext?v=testVid&lang=en'
      };

      const url = eventData.url;
      const trackName = eventData.trackName;
      const content = eventData.content;
      const format = eventData.format;
      const transContent = undefined;

      const isAsrFromMeta = Boolean(
        (url && url.includes('kind=asr')) ||
        (trackName && /auto-generated|自动生成|ASR/i.test(trackName))
      );

      let parsedCues = [];
      if (transContent && (format === 'json3' || !format)) {
        parsedCues = parseYouTubeJson3(content, transContent, isAsrFromMeta ? true : undefined);
      } else if (format === 'vtt' || (typeof content === 'string' && content.includes('WEBVTT'))) {
        parsedCues = parseSubtitleContent(content);
      } else if (typeof content === 'string' && (content.includes('<transcript') || content.includes('<timedtext'))) {
        parsedCues = parseYouTubeXml(content);
      } else {
        parsedCues = parseYouTubeJson3(content, undefined, isAsrFromMeta ? true : undefined);
      }

      const isAsr = Boolean(
        isAsrFromMeta ||
        (parsedCues.length > 2 &&
          !parsedCues.some(c => /[.?!。？！]$/.test((c.textEn || c.textZh || '').trim())) &&
          parsedCues.some(c => (c.end - c.start) < 3.5))
      );

      expect(isAsr).toBe(false);
      expect(parsedCues.length).toBe(1);
      expect(parsedCues[0].textEn).toBe('Hello manual caption.');
      expect(parsedCues[0].start).toBeCloseTo(1.0, 2);
      expect(parsedCues[0].end).toBeCloseTo(3.0, 2);
    });

    it('assembles WebVTT ASR cues when kind=asr is in URL', () => {
      const vttContent = `WEBVTT

1
00:00:01.000 --> 00:00:02.000
first part

2
00:00:02.000 --> 00:00:03.000
of the speech

3
00:00:03.000 --> 00:00:04.000
stream continues`;

      const url = 'https://www.youtube.com/api/timedtext?v=123&kind=asr&fmt=vtt';
      const isAsrFromMeta = Boolean(url.includes('kind=asr'));
      let parsedCues = parseSubtitleContent(vttContent);
      expect(parsedCues.length).toBe(3);

      const isAsr = Boolean(isAsrFromMeta || (parsedCues.length > 2 && parsedCues.some(c => (c.end - c.start) < 3.5)));
      if (isAsr && parsedCues.length > 2) {
        parsedCues = assembleLongAsrSentences(parsedCues);
      }

      expect(parsedCues.length).toBe(1);
      expect(parsedCues[0].textEn).toBe('first part of the speech stream continues');
      expect(parsedCues[0].start).toBeCloseTo(1.0, 2);
      expect(parsedCues[0].end).toBeCloseTo(4.0, 2);
    });

    it('interpolates proportional timestamps for multi-segment ASR events with zero tOffsetMs', () => {
      const words = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone twentytwo'.split(' ');
      const ev = {
        tStartMs: 1000,
        dDurationMs: 10000,
        segs: words.map(w => ({ utf8: w + ' ' }))
      };

      const sliced = sliceYouTubeAsrEvent(ev);
      // Verify all sliced cues have non-trivial durations (> 0.4s), strictly monotonic and non-overlapping
      expect(sliced.length).toBeGreaterThanOrEqual(3);
      for (let i = 0; i < sliced.length; i++) {
        expect(sliced[i].end).toBeGreaterThan(sliced[i].start);
        expect(sliced[i].end - sliced[i].start).toBeGreaterThan(0.35);
        if (i > 0) {
          expect(sliced[i].start).toBeGreaterThanOrEqual(sliced[i - 1].end - 0.05);
        }
      }

      const parsed = parseYouTubeJson3({ events: [ev] }, undefined, true);
      expect(parsed.length).toBe(3);
      for (const cue of parsed) {
        const count = cue.textEn.split(/\s+/).filter(Boolean).length;
        expect(count).toBeLessThanOrEqual(14);
        expect(cue.textEn.length).toBeLessThanOrEqual(70);
        // Ensure no 200ms blip collapsing
        expect(cue.end - cue.start).toBeGreaterThan(1.0);
      }
      expect(parsed[0].start).toBeCloseTo(1.0, 1);
      expect(parsed[parsed.length - 1].end).toBeCloseTo(11.0, 1);
    });

    it('splits single-segment ASR events with 20+ words into concise cues <= 14 words in sliceYouTubeAsrEvent', () => {
      const ev = {
        tStartMs: 1000,
        dDurationMs: 10000,
        segs: [{ utf8: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty.' }]
      };

      const sliced = sliceYouTubeAsrEvent(ev);
      expect(sliced.length).toBe(2);
      for (const cue of sliced) {
        const count = cue.textEn.split(/\s+/).filter(Boolean).length;
        expect(count).toBeLessThanOrEqual(14);
        expect(cue.textEn.length).toBeLessThanOrEqual(70);
      }
      expect(sliced[0].start).toBeCloseTo(1.0, 1);
      expect(sliced[sliced.length - 1].end).toBeCloseTo(11.0, 1);
    });

    it('preserves manual captions with internal newline line breaks 1:1 without false ASR slicing', () => {
      const manualJson = {
        events: [
          {
            tStartMs: 1000,
            dDurationMs: 4000,
            segs: [{ utf8: 'This is the first long line of manual caption text here\nAnd this is the second long line of manual caption text here.' }]
          }
        ]
      };

      const parsed = parseYouTubeJson3(manualJson);
      expect(parsed.length).toBe(1);
      expect(parsed[0].start).toBeCloseTo(1.0, 2);
      expect(parsed[0].end).toBeCloseTo(5.0, 2);
      expect(parsed[0].textEn).toBe('This is the first long line of manual caption text here And this is the second long line of manual caption text here.');
    });

    it('demotes CJK from textEn to textZh and enforces 30 character limit in splitLongCueSemantically', () => {
      const cue = {
        id: 1,
        start: 0.0,
        end: 10.0,
        textEn: '在过去的一年里我们进行了大量的系统架构重构和性能优化工作取得了非常显著的成果使得整个系统的响应速度提升了百分之五十',
        textZh: ''
      };

      const result = splitLongCueSemantically(cue);
      expect(result.length).toBe(3);
      for (const c of result) {
        expect(c.textEn).toBe('');
        expect(c.textZh.length).toBeLessThanOrEqual(30);
      }
      expect(result[0].start).toBeCloseTo(0.0, 1);
      expect(result[result.length - 1].end).toBeCloseTo(10.0, 1);
    });
  });

  describe('Review Round 3: Edge Cases, Multi-Language CJK/Thai, Zero-Duration & Monotonicity', () => {
    it('strictly splits single unbroken tokens > 70 chars into pieces <= 70 chars in splitLongCueSemantically', () => {
      const cue = {
        id: 1,
        start: 1.0,
        end: 5.0,
        textEn: 'a'.repeat(85),
        textZh: ''
      };

      const result = splitLongCueSemantically(cue, 12, 70);
      expect(result.length).toBeGreaterThanOrEqual(2);
      for (const piece of result) {
        expect(piece.textEn.length).toBeLessThanOrEqual(70);
        expect(piece.end).toBeGreaterThan(piece.start);
      }
      expect(result.map(p => p.textEn).join('')).toBe(cue.textEn);
    });

    it('strictly splits single unbroken tokens > 70 chars in splitOverlongAiSentence', () => {
      const token85 = 'b'.repeat(85);
      const pieces = splitOverlongAiSentence(token85, 12, 70);
      expect(pieces.length).toBeGreaterThanOrEqual(2);
      for (const p of pieces) {
        expect(p.length).toBeLessThanOrEqual(70);
      }
      expect(pieces.join('')).toBe(token85);
    });

    it('guards against zero/negative duration in splitLongCueSemantically, generating valid positive durations', () => {
      const zeroDurCue = {
        id: 1,
        start: 5.0,
        end: 5.0,
        textEn: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen',
        textZh: ''
      };

      const result = splitLongCueSemantically(zeroDurCue, 12, 70);
      expect(result.length).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < result.length; i++) {
        expect(result[i].end).toBeGreaterThan(result[i].start);
        expect(result[i].end - result[i].start).toBeGreaterThanOrEqual(0.05);
      }
    });

    it('splits bilingual cues where textEn is short but textZh is > 30 characters without duplicating Chinese', () => {
      const bilingualCue = {
        id: 1,
        start: 0.0,
        end: 10.0,
        textEn: 'Hello world',
        textZh: '我们进行系统架构重构和性能优化工作取得了非常显著的成果使得整个系统的响应速度提升了百分之五十'
      };

      const result = splitLongCueSemantically(bilingualCue, 12, 70);
      expect(result.length).toBeGreaterThanOrEqual(2);
      for (const piece of result) {
        expect(piece.textZh.length).toBeLessThanOrEqual(30);
        expect(piece.end).toBeGreaterThan(piece.start);
      }
      // Ensure the Chinese text was split across pieces and not repeated in full
      expect(result[0].textZh).not.toBe(bilingualCue.textZh);
      expect(result[1].textZh).not.toBe(bilingualCue.textZh);
    });

    it('segments unspaced Thai text using Intl.Segmenter into <= 14 words and <= 70 characters', () => {
      const thaiText = 'สวัสดีครับวันนี้เราจะมาพูดถึงเรื่องการเรียนภาษาอังกฤษที่ทำให้คุณเก่งขึ้นอย่างรวดเร็วและมีประสิทธิภาพมากที่สุดในโลก';
      const thaiCue = {
        id: 1,
        start: 0.0,
        end: 10.0,
        textEn: thaiText,
        textZh: ''
      };

      const result = splitLongCueSemantically(thaiCue, 12, 70);
      expect(result.length).toBeGreaterThanOrEqual(2);
      for (const piece of result) {
        expect(piece.textEn.length).toBeLessThanOrEqual(70);
        expect(piece.end).toBeGreaterThan(piece.start);
      }
    });

    it('recognizes Japanese Kana and Korean Hangul as CJK in isCjkText and does not misclassify them in sanitizeCues', () => {
      const jpKana = 'ありがとうございます';
      const krHangul = '안녕하세요';

      expect(isCjkText(jpKana)).toBe(true);
      expect(isCjkText(krHangul)).toBe(true);

      const sanitizedJp = sanitizeCues([{ id: 1, start: 1.0, end: 3.0, textEn: '', textZh: jpKana }]);
      expect(sanitizedJp.length).toBe(1);
      expect(sanitizedJp[0].textZh).toBe(jpKana);
      expect(sanitizedJp[0].textEn).toBe('');

      const sanitizedKr = sanitizeCues([{ id: 1, start: 1.0, end: 3.0, textEn: '', textZh: krHangul }]);
      expect(sanitizedKr.length).toBe(1);
      expect(sanitizedKr[0].textZh).toBe(krHangul);
      expect(sanitizedKr[0].textEn).toBe('');
    });

    it('aligns Japanese original audio with Chinese translation in alignBilingualJson3Events without dropping Japanese dialogue', () => {
      const orig = [{ tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'こんにちは世界' }] }];
      const trans = [{ tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: '你好世界' }] }];

      const aligned = alignBilingualJson3Events(orig, trans, false);
      expect(aligned.length).toBe(1);
      expect(aligned[0].textEn).toBe('こんにちは世界');
      expect(aligned[0].textZh).toBe('你好世界');
    });

    it('enforces monotonic segment timestamps in sliceYouTubeAsrEvent even when segment tOffsetMs is out of order', () => {
      const event = {
        tStartMs: 1000,
        dDurationMs: 6000,
        segs: [
          { utf8: 'First chunk of words ', tOffsetMs: 2000 },
          { utf8: 'middle chunk without offset ' },
          { utf8: '\n', tOffsetMs: 0 },
          { utf8: 'third chunk of words here', tOffsetMs: 4500 }
        ]
      };

      const sliced = sliceYouTubeAsrEvent(event);
      expect(sliced.length).toBeGreaterThanOrEqual(1);
      for (let i = 0; i < sliced.length; i++) {
        expect(sliced[i].end).toBeGreaterThan(sliced[i].start);
        if (i > 0) {
          expect(sliced[i].start).toBeGreaterThanOrEqual(sliced[i - 1].end - 0.05);
        }
      }
    });
  });
});


