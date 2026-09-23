import { SubtitleCue } from '@/types';

/**
 * Convert timestamp string (00:01:23.456, 00:01:23,456, or 0:01:23.45) to seconds
 */
export function timeStringToSeconds(timeStr: string): number {
  if (!timeStr) return 0;
  const cleaned = timeStr.trim().replace(',', '.');
  const parts = cleaned.split(':');
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]) || 0;
    const minutes = parseFloat(parts[1]) || 0;
    const seconds = parseFloat(parts[2]) || 0;
    return hours * 3600 + minutes * 60 + seconds;
  } else if (parts.length === 2) {
    const minutes = parseFloat(parts[0]) || 0;
    const seconds = parseFloat(parts[1]) || 0;
    return minutes * 60 + seconds;
  }
  return parseFloat(cleaned) || 0;
}

/**
 * Convert seconds to readable timestamp (00:00 or 00:00:00)
 */
export function formatTimestamp(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const totalSecs = Math.floor(seconds);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  const formattedSecs = secs < 10 ? `0${secs}` : `${secs}`;
  if (mins < 60) {
    const formattedMins = mins < 10 ? `0${mins}` : `${mins}`;
    return `${formattedMins}:${formattedSecs}`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  const formattedHours = hours < 10 ? `0${hours}` : `${hours}`;
  const formattedRemMins = remMins < 10 ? `0${remMins}` : `${remMins}`;
  return `${formattedHours}:${formattedRemMins}:${formattedSecs}`;
}

/**
 * Detect whether a string contains CJK ideographs, Japanese Kana, or Korean Hangul
 */
export function isCjkText(text: string): boolean {
  if (!text) return false;
  return /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/.test(text);
}

/**
 * Detect whether a string contains Chinese Hanzi specifically (excluding Japanese Kana and Korean Hangul)
 */
export function isChineseText(text: string): boolean {
  if (!text) return false;
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text) && !/[\u3040-\u30ff\uac00-\ud7af]/.test(text);
}

/**
 * Automatically detects and decodes subtitle file buffer supporting UTF-8 (with/without BOM),
 * UTF-16LE, UTF-16BE, and Chinese legacy encodings (GB18030 / GBK / GB2312).
 */
export function decodeSubtitleBuffer(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length === 0) return '';

  // 1. Check for standard BOM signatures
  // UTF-8 BOM: EF BB BF
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  // UTF-16LE BOM: FF FE
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  // UTF-16BE BOM: FE FF
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }

  // 2. Check for UTF-16 without BOM (alternating zero bytes)
  if (bytes.length >= 4) {
    let zerosEven = 0;
    let zerosOdd = 0;
    const sampleLen = Math.min(bytes.length, 512);
    for (let i = 0; i < sampleLen; i++) {
      if (bytes[i] === 0) {
        if (i % 2 === 0) zerosEven++;
        else zerosOdd++;
      }
    }
    if (zerosOdd > sampleLen / 4) {
      try {
        return new TextDecoder('utf-16le').decode(bytes);
      } catch (_) {}
    } else if (zerosEven > sampleLen / 4) {
      try {
        return new TextDecoder('utf-16be').decode(bytes);
      } catch (_) {}
    }
  }

  // 3. Try UTF-8 with fatal: true to strictly detect encoding validity
  try {
    const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
    return utf8Decoder.decode(bytes);
  } catch (_) {
    // 4. Fallback to Chinese GB18030 / GBK (covers millions of Chinese subtitle files)
    try {
      const gbkDecoder = new TextDecoder('gb18030');
      return gbkDecoder.decode(bytes);
    } catch (_) {
      try {
        const gbkDecoder = new TextDecoder('gbk');
        return gbkDecoder.decode(bytes);
      } catch (_) {
        return new TextDecoder('utf-8').decode(bytes);
      }
    }
  }
}

/**
 * Clean ASS/SSA tags, including style overrides, vector drawings, and escape sequences.
 * e.g. {\pos(100,200)}, {\c&H00FFFF&}, {\fad(200,200)}, {\p1}m 0 0 ...{\p0}, \N
 */
export function cleanAssText(text: string): string {
  if (!text) return '';
  const cleaned = text
    // 1. Remove ASS vector drawings {\p1}...{\p0} and any embedded drawing paths
    .replace(/\{[^\}]*\\p[1-9][^\}]*\}[^]*?(?:\{[^\}]*\\p0[^\}]*\}|$)/gi, '')
    .replace(/\{[^\}]*\\p0[^\}]*\}/gi, '')
    // 2. Strip all {...} style override tags (e.g. {\pos}, {\an}, {\c&H...&}, {\fn...}, {\fs...})
    .replace(/\{[^\}]+\}/g, '')
    // 3. Replace ASS newlines with standard newlines
    .replace(/\\N/g, '\n')
    .replace(/\\n/g, '\n')
    // 4. Replace ASS hard space \h with regular space
    .replace(/\\h/g, ' ')
    .trim();

  // Filter out standalone vector path commands (e.g. "m 0 0 l 10 10...")
  if (/^[mnlbspc\d\s\.\-]+$/i.test(cleaned) && /\b[mlb]\s+[-]?\d+/i.test(cleaned)) {
    return '';
  }

  return cleaned;
}

/**
 * Splits multi-line subtitle text into English (textEn) and Chinese (textZh) translations.
 * - Handles English-only multi-line sentences (joins them without mistaking the 2nd line as Chinese).
 * - Handles Chinese-only multi-line sentences.
 * - Handles bilingual subtitles with either Chinese on top or English on top.
 */
export function splitBilingualLines(lines: string[]): { textEn: string; textZh: string } {
  if (!lines || lines.length === 0) return { textEn: '', textZh: '' };

  const cleaned = lines.map(l => (l || '').trim()).filter(Boolean);
  if (cleaned.length === 0) return { textEn: '', textZh: '' };

  if (cleaned.length === 1) {
    const line = cleaned[0];
    if (isCjkText(line)) {
      return { textEn: '', textZh: line };
    }
    return { textEn: line, textZh: '' };
  }

  const zhLines: string[] = [];
  const enLines: string[] = [];

  for (const line of cleaned) {
    if (isCjkText(line)) {
      zhLines.push(line);
    } else {
      enLines.push(line);
    }
  }

  // All lines are English
  if (zhLines.length === 0) {
    return { textEn: enLines.join(' '), textZh: '' };
  }

  // All lines are Chinese
  if (enLines.length === 0) {
    return { textEn: '', textZh: zhLines.join('') };
  }

  return {
    textEn: enLines.join(' '),
    textZh: zhLines.join('')
  };
}

/**
 * Parse ASS/SSA format subtitle string with dynamic Format header resolution and dual-event alignment
 */
export function parseAssSubtitles(rawText: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const lines = rawText.split(/\r?\n/);
  let idCounter = 1;

  let inEventsSection = false;
  // Default indices if Format header is missing
  let startIdx = 1;
  let endIdx = 2;
  let textIdx = 9;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect section transitions
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      inEventsSection = /^\[events\]$/i.test(trimmed);
      continue;
    }

    // Dynamic Format: line parsing under [Events]
    if (inEventsSection && /^format\s*:/i.test(trimmed)) {
      const formatHeader = trimmed.replace(/^format\s*:\s*/i, '');
      const cols = formatHeader.split(',').map(c => c.trim().toLowerCase());
      const s = cols.indexOf('start');
      const e = cols.indexOf('end');
      const t = cols.indexOf('text');
      if (s !== -1) startIdx = s;
      if (e !== -1) endIdx = e;
      if (t !== -1) textIdx = t;
      continue;
    }

    // Parse Dialogue lines (both standard Dialogue: and Comment: if marked)
    if (/^dialogue\s*:/i.test(trimmed)) {
      const content = trimmed.replace(/^dialogue\s*:\s*/i, '');
      const parts: string[] = [];
      let cur = '';
      let commaCount = 0;
      for (let i = 0; i < content.length; i++) {
        if (commaCount < textIdx && content[i] === ',') {
          parts.push(cur.trim());
          cur = '';
          commaCount++;
        } else {
          cur += content[i];
        }
      }
      parts.push(cur);

      if (parts.length > Math.max(startIdx, endIdx)) {
        const start = timeStringToSeconds(parts[startIdx]);
        const end = timeStringToSeconds(parts[endIdx]);
        const rawDialogue = parts[textIdx] !== undefined ? parts.slice(textIdx).join(',') : parts[parts.length - 1];
        const text = cleanAssText(rawDialogue);

        if (text && end > start) {
          const splitLines = text.split('\n').map(l => l.trim()).filter(Boolean);
          const { textEn, textZh } = splitBilingualLines(splitLines);
          let finalEn = textEn;
          let finalZh = textZh;
          if (!finalEn && !finalZh) {
            if (isCjkText(text)) {
              finalZh = text;
            } else {
              finalEn = text;
            }
          }
          cues.push({
            id: idCounter++,
            start,
            end,
            textEn: finalEn,
            textZh: finalZh
          });
        }
      }
    }
  }

  if (cues.length === 0) return [];

  // Sort chronologically
  cues.sort((a, b) => a.start - b.start || a.end - b.end);

  // Dual-Event Alignment: Many ASS fansubs use two separate Dialogue lines
  // (one English style, one Chinese style) with identical or overlapping timestamps.
  const mergedCues: SubtitleCue[] = [];
  for (let i = 0; i < cues.length; i++) {
    const cur = cues[i];
    if (mergedCues.length > 0) {
      const prev = mergedCues[mergedCues.length - 1];
      const timeDiff = Math.abs(prev.start - cur.start);
      const isOverlapping = timeDiff <= 0.8 && (Math.min(prev.end, cur.end) - Math.max(prev.start, cur.start) >= 0);

      // Check if one has English only and the other has Chinese only
      const prevEnOnly = prev.textEn && !prev.textZh;
      const prevZhOnly = !prev.textEn && prev.textZh;
      const curEnOnly = cur.textEn && !cur.textZh;
      const curZhOnly = !cur.textEn && cur.textZh;

      if (isOverlapping && ((prevEnOnly && curZhOnly) || (prevZhOnly && curEnOnly))) {
        if (curZhOnly) {
          prev.textZh = cur.textZh;
        } else {
          prev.textEn = cur.textEn;
        }
        prev.start = Math.min(prev.start, cur.start);
        prev.end = Math.max(prev.end, cur.end);
        continue;
      }
    }
    mergedCues.push({ ...cur });
  }

  return sanitizeCues(mergedCues);
}

/**
 * Parse LRC format lyrics/dialogue subtitle string (e.g. [01:23.45]Hello world)
 */
export function parseLrcSubtitles(rawText: string): SubtitleCue[] {
  if (!rawText) return [];
  const lines = rawText.split(/\r?\n/);
  const items: Array<{ time: number; text: string }> = [];

  const timeRegex = /\[(\d{1,2}):(\d{2})(?:[.:](\d{2,3}))?\]/g;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    timeRegex.lastIndex = 0;
    const timestamps: number[] = [];
    let match: RegExpExecArray | null;
    let lastIndex = 0;

    while ((match = timeRegex.exec(trimmed)) !== null) {
      const mins = parseInt(match[1], 10) || 0;
      const secs = parseInt(match[2], 10) || 0;
      const msPart = match[3] || '0';
      const ms = msPart.length === 2 ? parseInt(msPart, 10) * 10 : parseInt(msPart, 10);
      timestamps.push(mins * 60 + secs + ms / 1000);
      lastIndex = timeRegex.lastIndex;
    }

    if (timestamps.length > 0) {
      const lyricText = trimmed.slice(lastIndex).trim();
      if (lyricText && isValidSubtitleText(lyricText)) {
        for (const t of timestamps) {
          items.push({ time: t, text: lyricText });
        }
      }
    }
  }

  if (items.length === 0) return [];
  items.sort((a, b) => a.time - b.time);

  const cues: SubtitleCue[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const nextItem = items[i + 1];
    const start = item.time;
    const end = nextItem ? Math.min(start + 8.0, Math.max(start + 0.8, nextItem.time)) : start + 3.5;

    const splitLines = item.text.split(/\\n|\/|\n/).map(l => l.trim()).filter(Boolean);
    const { textEn, textZh } = splitBilingualLines(splitLines);

    cues.push({
      id: i + 1,
      start,
      end,
      textEn: textEn || (!isCjkText(item.text) ? item.text : ''),
      textZh: textZh || (isCjkText(item.text) ? item.text : '')
    });
  }

  return sanitizeCues(cues);
}

/**
 * Parse MicroDVD SUB format (e.g. {100}{200}Hello or {00:01:23}{00:01:26}Hello)
 */
export function parseMicroDvdSubtitles(rawText: string, fps = 25): SubtitleCue[] {
  if (!rawText) return [];
  const lines = rawText.split(/\r?\n/);
  const cues: SubtitleCue[] = [];
  let idCounter = 1;

  // Regex matching {start}{end}text
  const subRegex = /^\{([\d:.]+)\}\{([\d:.]+)\}(.*)$/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = subRegex.exec(trimmed);
    if (!match) continue;

    const rawStart = match[1];
    const rawEnd = match[2];
    const rawContent = match[3].trim();

    let start = 0;
    let end = 0;

    if (rawStart.includes(':')) {
      start = timeStringToSeconds(rawStart);
      end = timeStringToSeconds(rawEnd);
    } else {
      start = (parseInt(rawStart, 10) || 0) / fps;
      end = (parseInt(rawEnd, 10) || 0) / fps;
    }

    if (end <= start) end = start + 3.0;

    // MicroDVD uses | for newlines
    const splitLines = rawContent.split('|').map(l => l.trim()).filter(Boolean);
    const { textEn, textZh } = splitBilingualLines(splitLines);

    if (textEn || textZh || isValidSubtitleText(rawContent)) {
      cues.push({
        id: idCounter++,
        start,
        end,
        textEn: textEn || (!isCjkText(rawContent) ? rawContent : ''),
        textZh: textZh || (isCjkText(rawContent) ? rawContent : '')
      });
    }
  }

  return sanitizeCues(cues);
}

/**
 * Parse TTML / DFXP / XML timed text subtitles
 */
export function parseTtmlSubtitles(xmlText: string): SubtitleCue[] {
  if (!xmlText || typeof xmlText !== 'string') return [];
  const cues: SubtitleCue[] = [];
  let id = 1;

  const parseTtmlTime = (val: string): number => {
    if (!val) return 0;
    const clean = val.trim();
    if (clean.endsWith('s')) {
      return parseFloat(clean) || 0;
    }
    if (clean.endsWith('ms')) {
      return (parseFloat(clean) || 0) / 1000;
    }
    if (clean.includes(':')) {
      return timeStringToSeconds(clean);
    }
    return parseFloat(clean) || 0;
  };

  // Match <p ... begin="..." end="...">content</p> or <span ...>
  const pRegex = /<p\b[^>]*begin="([^"]+)"(?:[^>]*end="([^"]+)")?(?:[^>]*dur="([^"]+)")?[^>]*>([\s\S]*?)<\/p>/gi;
  let match: RegExpExecArray | null;

  while ((match = pRegex.exec(xmlText)) !== null) {
    const beginStr = match[1];
    const endStr = match[2];
    const durStr = match[3];
    const rawContent = match[4] || '';

    const start = parseTtmlTime(beginStr);
    let end = endStr ? parseTtmlTime(endStr) : durStr ? start + parseTtmlTime(durStr) : start + 3.0;
    if (end <= start) end = start + 3.0;

    const cleaned = decodeHtmlEntities(rawContent.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim());
    if (cleaned && isValidSubtitleText(cleaned)) {
      const splitLines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
      const { textEn, textZh } = splitBilingualLines(splitLines);
      cues.push({
        id: id++,
        start,
        end,
        textEn: textEn || (!isCjkText(cleaned) ? cleaned : ''),
        textZh: textZh || (isCjkText(cleaned) ? cleaned : '')
      });
    }
  }

  return sanitizeCues(cues);
}

/**
 * Parse Bilibili BCC / JSON subtitle format ({ body: [ { from, to, content } ] })
 */
export function parseBccJsonSubtitles(jsonContent: string | object): SubtitleCue[] {
  let data: any;
  if (typeof jsonContent === 'string') {
    try {
      data = JSON.parse(jsonContent);
    } catch {
      return [];
    }
  } else {
    data = jsonContent;
  }

  if (!data || !Array.isArray(data.body) || data.body.length === 0) {
    return [];
  }

  const cues: SubtitleCue[] = [];
  let id = 1;

  for (const item of data.body) {
    const start = typeof item.from === 'number' ? item.from : parseFloat(item.from) || 0;
    const end = typeof item.to === 'number' ? item.to : parseFloat(item.to) || start + 3.0;
    const rawContent = (item.content || '').trim();
    if (!rawContent || !isValidSubtitleText(rawContent)) continue;

    const splitLines = rawContent.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
    const { textEn, textZh } = splitBilingualLines(splitLines);

    cues.push({
      id: id++,
      start,
      end,
      textEn: textEn || (!isCjkText(rawContent) ? rawContent : ''),
      textZh: textZh || (isCjkText(rawContent) ? rawContent : '')
    });
  }

  return sanitizeCues(cues);
}

/**
 * Validate that a text string is genuine subtitle/dialogue and NOT code/JSON/telemetry
 */
export function isValidSubtitleText(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length < 1 || trimmed.length > 350) return false;

  // Reject common UI button labels
  const UI_WORDS = new Set([
    '字幕', '选集', '倍速', '画质', '全屏', '设置', '清晰度', '弹幕', '音量', '暂停', '播放',
    '高清', '超清', '自动', '关闭', '开启', '重播', '上一个', '下一个', '列表', '下载', '分享', '画中画',
    'subtitles', 'closed captions', 'settings', 'playback speed', 'quality', 'full screen', 'fullscreen',
    'autoplay', 'subscribe', 'up next', 'pause', 'play'
  ]);
  if (UI_WORDS.has(trimmed) || UI_WORDS.has(trimmed.toLowerCase())) return false;

  // Reject code, JSON, script artifacts, and telemetry
  if (
    trimmed.includes('function(') ||
    trimmed.includes('function (') ||
    trimmed.includes('window.') ||
    trimmed.includes('document.') ||
    trimmed.includes('protobuf') ||
    trimmed.includes('watchEndpoint') ||
    trimmed.includes('screenWatchType') ||
    trimmed.includes('ytcsi') ||
    /<yt-[a-z0-9_-]+/i.test(trimmed) ||
    /^yt-[a-z0-9_-]+$/i.test(trimmed) ||
    /\b(var|let|const)\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*=[^=]/.test(trimmed) ||
    /\([a-zA-Z0-9_$,\s]*\)\s*=>/.test(trimmed) ||
    trimmed.includes('};') ||
    trimmed.includes('</div') ||
    trimmed.includes('</script') ||
    trimmed.includes('</button') ||
    trimmed.includes('</span') ||
    trimmed.includes('__LR_') ||
    trimmed.includes('__webpack')
  ) {
    return false;
  }

  // Reject JSON objects or arrays of objects, while allowing speaker labels [John], [Music], [Applause]
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[{') && trimmed.endsWith('}]'))) {
    try {
      const obj = JSON.parse(trimmed);
      if (typeof obj === 'object' && obj !== null) return false;
    } catch {}
  }

  return true;
}

/**
 * Decode common HTML entities like &amp;, &#39;, &quot;, &lt;, &gt;
 */
export function decodeHtmlEntities(text: string): string {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

export interface YouTubeJson3Event {
  tStartMs?: number;
  dDurationMs?: number;
  wWinId?: number;
  segs?: Array<{
    utf8: string;
    tOffsetMs?: number;
    acAsrConf?: number;
  }>;
}

export interface YouTubeJson3Data {
  wireMagic?: string;
  pens?: any[];
  wsWinStyles?: any[];
  wpWinPositions?: any[];
  events?: YouTubeJson3Event[];
}

/**
 * Clean unwanted spaces before punctuation and formatting artifacts.
 * e.g.:
 *  "feeling , heavy suspicion" -> "feeling, heavy suspicion"
 *  "so pretty ." -> "so pretty."
 *  "hello ! why ?" -> "hello! why?"
 *  "你好 ， 感觉" -> "你好，感觉"
 */
export function cleanPunctuationSpacing(text: string): string {
  if (!text) return '';
  return text
    // Remove space between CJK characters (common ASR artifact)
    .replace(/([\u4e00-\u9fff\u3040-\u30ff\u3400-\u4dbf])\s+([\u4e00-\u9fff\u3040-\u30ff\u3400-\u4dbf])/g, '$1$2')
    // Remove space before English punctuation: , . ! ? ; :
    .replace(/\s+([,.\!?;:])/g, '$1')
    // Remove space before and after Chinese/CJK punctuation
    .replace(/\s*([，。？！；：、“”‘’《》【】（）])\s*/g, '$1')
    // Ensure single space after English punctuation if followed directly by letters
    .replace(/([,.\!?;:])([a-zA-Z])/g, '$1 $2')
    // Collapse multiple consecutive spaces
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Detect and strip rolling teleprompter line overlap between the tail of prevText and the head of curText.
 * Uses accurate token-level indices to slice raw text without corrupting words or punctuation.
 * e.g.:
 *   prev: "Guys, I have gotten so many questions"
 *   cur:  ">> so many questions about my system."
 *   returns: "about my system."
 */
export function stripRollingOverlap(prevText: string, curText: string): string {
  if (!prevText || !curText) return curText;

  // 1. CJK character-level matching with accurate slicing
  const cjkRegex = /[\u4e00-\u9fff\u3040-\u30ff\u3400-\u4dbf]/g;
  const hasCjkP = /[\u4e00-\u9fff\u3040-\u30ff\u3400-\u4dbf]/.test(prevText);
  const hasCjkC = /[\u4e00-\u9fff\u3040-\u30ff\u3400-\u4dbf]/.test(curText);

  if (hasCjkP && hasCjkC) {
    const cleanP = prevText.replace(/[^\u4e00-\u9fff\u3040-\u30ff\u3400-\u4dbf]/g, '');
    const cChars: { char: string; endIndex: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = cjkRegex.exec(curText)) !== null) {
      cChars.push({ char: m[0], endIndex: m.index + m[0].length });
    }

    if (cleanP.length >= 3 && cChars.length >= 3) {
      const maxOverlap = Math.min(cleanP.length, cChars.length);
      for (let clen = maxOverlap; clen >= 3; clen--) {
        const cPrefix = cChars.slice(0, clen).map(c => c.char).join('');
        if (cleanP.endsWith(cPrefix)) {
          const cutIndex = cChars[clen - 1].endIndex;
          let remaining = curText.slice(cutIndex).trim();
          remaining = remaining.replace(/^[，。？！、；：\s,\.\?!;:\-]+/, '').trim();
          if (remaining.length > 0) {
            return remaining;
          }
        }
      }
    }
  }

  // 2. English / space-separated word-level matching with symmetric token extraction and accurate slicing
  const normWord = (w: string) => w.toLowerCase().replace(/['’]/g, '').replace(/[^\w]/g, '');
  const wordRegex = /[a-zA-Z0-9]+(?:['’][a-zA-Z0-9]+)?/g;

  const pTokens: string[] = [];
  let pm: RegExpExecArray | null;
  while ((pm = wordRegex.exec(prevText)) !== null) {
    const norm = normWord(pm[0]);
    if (norm) pTokens.push(norm);
  }

  const cTokens: { norm: string; endIndex: number }[] = [];
  let wm: RegExpExecArray | null;
  while ((wm = wordRegex.exec(curText)) !== null) {
    const norm = normWord(wm[0]);
    if (norm) {
      cTokens.push({
        norm,
        endIndex: wm.index + wm[0].length
      });
    }
  }

  if (pTokens.length >= 2 && cTokens.length >= 2) {
    const maxOverlap = Math.min(pTokens.length, cTokens.length);
    for (let len = maxOverlap; len >= 2; len--) {
      const pSuffix = pTokens.slice(pTokens.length - len).join(' ');
      const cPrefix = cTokens.slice(0, len).map(t => t.norm).join(' ');
      if (pSuffix === cPrefix) {
        const cutIndex = cTokens[len - 1].endIndex;
        let remaining = curText.slice(cutIndex).trim();
        remaining = remaining.replace(/^[,\.\?!;:\s\-]+/, '').trim();
        if (remaining.length > 0) {
          return remaining;
        }
      }
    }
  }

  return curText;
}

/**
 * Sanitize cues: sort, merge ASR rollups / duplicate sentences, eliminate timeline overlap, and re-index.
 */
export function sanitizeCues(cues: SubtitleCue[]): SubtitleCue[] {
  if (!cues || cues.length === 0) return [];

  // A cue is valid if either textEn or textZh contains valid subtitle text
  const valid = cues
    .map(c => {
      let textEn = cleanPunctuationSpacing((c.textEn || '').trim());
      let textZh = cleanPunctuationSpacing((c.textZh || '').trim());
      // If textEn is empty but textZh is valid, promote textZh to textEn ONLY IF textZh is NOT CJK
      if (!textEn && textZh && isValidSubtitleText(textZh) && !isCjkText(textZh)) {
        textEn = textZh;
        textZh = '';
      }
      // If textEn contains CJK and textZh is empty, demote textEn to textZh
      if (textEn && !textZh && isCjkText(textEn)) {
        textZh = textEn;
        textEn = '';
      }
      return {
        ...c,
        textEn,
        textZh
      };
    })
    .filter(c => c && (isValidSubtitleText(c.textEn) || isValidSubtitleText(c.textZh)) && (c.end > c.start || c.end === 0));

  if (valid.length === 0) return [];

  valid.sort((a, b) => a.start - b.start || a.end - b.end);

  const cleanCompare = (s: string) =>
    (s || '').toLowerCase().replace(/[^\w\s\u4e00-\u9fff\u3040-\u30ff\u3400-\u4dbf]/g, '').replace(/\s+/g, ' ').trim();

  const sanitized: SubtitleCue[] = [];

  for (const cue of valid) {
    const start = Math.max(0, cue.start);
    let end = cue.end > start ? cue.end : start + 3.0;
    let textEn = cleanPunctuationSpacing(cue.textEn.trim());
    const textZh = cleanPunctuationSpacing((cue.textZh || '').trim());

    if (sanitized.length === 0) {
      sanitized.push({
        id: 1,
        start,
        end: Math.max(start + 0.5, end),
        textEn,
        textZh
      });
      continue;
    }

    const prev = sanitized[sanitized.length - 1];
    const prevText = cleanCompare(prev.textEn || prev.textZh);
    let curText = cleanCompare(textEn || textZh);

    // 1. Exact duplicate text within close proximity: expand end time and update textZh if provided
    if (prevText === curText && Math.abs(start - prev.start) < 6.0) {
      prev.end = Math.max(prev.end, end);
      if (textZh) {
        if (!prev.textZh || textZh.length >= prev.textZh.length || textZh.includes(prev.textZh)) {
          prev.textZh = textZh;
        }
      }
      continue;
    }

    // 2. Rollup prefix extension (e.g. "Guys I have" -> "Guys I have gotten so so")
    const prevEndsCjk = /[\u4e00-\u9fff\u3040-\u30ff\u3400-\u4dbf]$/.test(prevText);
    const isPrefixTurn = (
      curText === prevText ||
      curText.startsWith(prevText + ' ') ||
      (prevEndsCjk && curText.startsWith(prevText)) ||
      (curText.startsWith(prevText) && !/\w/.test(curText.charAt(prevText.length)))
    ) &&
      start - prev.start < 7.0 &&
      prevText.length >= 2;

    if (isPrefixTurn) {
      if (textEn) prev.textEn = textEn;
      prev.end = Math.max(prev.end, end);
      if (textZh) {
        if (!prev.textZh || textZh.length >= prev.textZh.length || textZh.includes(prev.textZh)) {
          prev.textZh = textZh;
        }
      }
      continue;
    }

    // 3. Rollup suffix / slight ASR update in same turn
    const curEndsCjk = /[\u4e00-\u9fff\u3040-\u30ff\u3400-\u4dbf]$/.test(curText);
    const isSuffixTurn = (
      prevText === curText ||
      prevText.startsWith(curText + ' ') ||
      (curEndsCjk && prevText.startsWith(curText)) ||
      (prevText.startsWith(curText) && !/\w/.test(prevText.charAt(curText.length)))
    ) &&
      start - prev.start < 5.0 &&
      curText.length >= 2;

    if (isSuffixTurn) {
      prev.end = Math.max(prev.end, end);
      if (textZh) {
        if (!prev.textZh || textZh.length >= prev.textZh.length || textZh.includes(prev.textZh)) {
          prev.textZh = textZh;
        }
      }
      continue;
    }

    // 4. Rolling line teleprompter overlap (e.g. line 1 + line 2 rolling into line 2 + line 3)
    if (start - prev.start < 8.0) {
      const stripped = stripRollingOverlap(prev.textEn, textEn);
      if (stripped !== textEn && isValidSubtitleText(stripped)) {
        textEn = cleanPunctuationSpacing(stripped);
        curText = cleanCompare(textEn);
      }
    }

    // 4.1 Dual-track bilingual alignment check (one has English, one has Chinese with overlapping timestamps)
    const prevHasEnOnly = Boolean(prev.textEn && !prev.textZh);
    const prevHasZhOnly = Boolean(!prev.textEn && prev.textZh);
    const curHasEnOnly = Boolean(textEn && !textZh);
    const curHasZhOnly = Boolean(!textEn && textZh);

    if ((prevHasEnOnly && curHasZhOnly) || (prevHasZhOnly && curHasEnOnly)) {
      const overlap = Math.min(prev.end, end) - Math.max(prev.start, start);
      const minDur = Math.min(prev.end - prev.start, end - start);
      if (overlap > 0.3 || (minDur > 0 && overlap / minDur > 0.4) || Math.abs(prev.start - start) < 1.2) {
        if (curHasZhOnly) {
          prev.textZh = textZh;
        } else {
          prev.textEn = textEn;
        }
        prev.start = Math.min(prev.start, start);
        prev.end = Math.max(prev.end, end);
        continue;
      }
    }

    // 5. Consecutive new cue in timeline: ensure strict non-overlapping timeline
    if (prev.end > start) {
      prev.end = Math.max(prev.start + 0.2, start);
    }

    const adjustedStart = Math.max(prev.end, start);
    const adjustedEnd = Math.max(adjustedStart + 0.4, end);

    sanitized.push({
      id: sanitized.length + 1,
      start: adjustedStart,
      end: adjustedEnd,
      textEn,
      textZh
    });
  }

  return sanitized.map((c, idx) => ({
    ...c,
    id: idx + 1,
    start: Math.round(c.start * 1000) / 1000,
    end: Math.round(c.end * 1000) / 1000
  }));
}

/**
 * Intelligently splits a single subtitle cue into concise, semantically complete sub-cues
 * (soft limit 8~12 words, hard limit 14 words or 70 characters) matching Language Reactor's
 * concise single-line display and YouTube native subtitle standards.
 * Proportionally interpolates start and end timestamps.
 */
export function splitLongCueSemantically(cue: SubtitleCue, maxWords = 12, maxChars = 70): SubtitleCue[] {
  if (!cue) return [];
  let textEn = cleanPunctuationSpacing(cleanLiveCaptionGarbage(cue.textEn || '')).trim();
  let textZh = cleanPunctuationSpacing(cleanLiveCaptionGarbage(cue.textZh || '')).trim();
  if (!textEn && !textZh) return [];

  // Demote Chinese from textEn to textZh if textZh is empty
  if (textEn && !textZh && isChineseText(textEn)) {
    textZh = textEn;
    textEn = '';
  }

  const countWords = (t: string) => (t.trim().match(/\S+/g) || []).length;
  const isAbbreviation = (w: string) =>
    /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|e\.g|i\.e)\.$/i.test(w.trim());
  const hasTerminal = (w: string) => /[.?!。？！]$/.test(w.trim()) && !isAbbreviation(w);
  const hasClausePunct = (w: string) => /[,;:—\-"'，；：]$/.test(w.trim());
  const isConnector = (w: string) =>
    /^(and|but|or|so|because|which|that|when|where|if|while|like|with|for|to|in|on|about|as|then|after|before|since|until|although|though)$/i.test(
      w.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '')
    );

  // Helper to split or distribute Chinese/translation across split English pieces
  const splitZhPieces = (zh: string, pieceCount: number): string[] => {
    if (!zh || pieceCount <= 1) return Array(pieceCount).fill(zh || '');
    const parts = zh.split(/(?<=[。！？；，、])/).filter(p => p.trim().length > 0);
    if (parts.length >= pieceCount) {
      const res: string[] = [];
      const perPiece = Math.floor(parts.length / pieceCount);
      for (let i = 0; i < pieceCount; i++) {
        const start = i * perPiece;
        const end = i === pieceCount - 1 ? parts.length : (i + 1) * perPiece;
        res.push(parts.slice(start, end).join(''));
      }
      return res;
    }
    // Proportional character slicing fallback so overlong Chinese is never duplicated in full
    const perChar = Math.ceil(zh.length / pieceCount);
    const res: string[] = [];
    for (let i = 0; i < pieceCount; i++) {
      res.push(zh.slice(i * perChar, (i + 1) * perChar));
    }
    return res;
  };

  const effectiveEnd = Math.max(cue.start + 0.2, cue.end);
  const duration = effectiveEnd - cue.start;

  // Tokenize textEn with support for unspaced languages like Thai/Khmer via Intl.Segmenter
  let words = textEn.split(/\s+/).filter(Boolean);
  if (words.length <= 1 && textEn.length > 25 && typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    try {
      const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
      const segmented = Array.from(segmenter.segment(textEn))
        .filter(s => s.isWordLike || /[\p{L}\p{N}]/u.test(s.segment))
        .map(s => s.segment.trim())
        .filter(Boolean);
      if (segmented.length > 1) {
        words = segmented;
      }
    } catch (_) {}
  }

  const isZhOverlength = isCjkText(textZh) ? textZh.length > 30 : textZh.length > maxChars;

  // If text is primarily CJK or English is empty:
  if (words.length === 0) {
    if (!isZhOverlength && textZh.length <= maxChars) {
      return [{ ...cue, end: effectiveEnd, textEn, textZh }];
    }
    // Split long Chinese sentence at punctuation or natural break
    const zhPieces = textZh.split(/([，。！？；：、])/).reduce((acc: string[], cur, idx) => {
      if (idx % 2 === 0) acc.push(cur);
      else if (acc.length > 0) acc[acc.length - 1] += cur;
      return acc;
    }, []).filter(p => p.trim().length > 0);

    const refinedZh: string[] = [];
    let curZh = '';
    const maxZhLimit = isCjkText(textZh) ? 30 : maxChars;
    for (const p of zhPieces) {
      if (!curZh) {
        curZh = p;
      } else if (curZh.length + p.length <= maxZhLimit) {
        curZh += p;
      } else {
        refinedZh.push(curZh);
        curZh = p;
      }
    }
    if (curZh) {
      refinedZh.push(curZh);
    }

    const finalZh: string[] = [];
    for (const p of refinedZh) {
      if (p.length <= maxZhLimit) {
        finalZh.push(p);
      } else {
        const sliceStep = isCjkText(p) ? 25 : maxChars;
        for (let i = 0; i < p.length; i += sliceStep) {
          finalZh.push(p.slice(i, i + sliceStep));
        }
      }
    }

    if (finalZh.length <= 1) return [{ ...cue, end: effectiveEnd, textEn, textZh }];
    let el = 0;
    return finalZh.map((p, i) => {
      const pStart = cue.start + (el / textZh.length) * duration;
      el += p.length;
      const pEnd = i === finalZh.length - 1 ? effectiveEnd : cue.start + (el / textZh.length) * duration;
      const safeEnd = Math.max(pStart + 0.2, pEnd);
      return {
        ...cue,
        id: cue.id,
        start: Math.round(pStart * 1000) / 1000,
        end: Math.round(safeEnd * 1000) / 1000,
        textEn: '',
        textZh: p.trim()
      };
    });
  }

  // If textEn is short (<= 1 word) but textZh is overlong, split based on textZh
  if (words.length <= 1 && isZhOverlength) {
    const zhSplit = splitLongCueSemantically({ ...cue, end: effectiveEnd, textEn: '', textZh }, maxWords, maxChars);
    if (zhSplit.length > 1) {
      zhSplit[0].textEn = textEn;
      return zhSplit;
    }
  }

  const hasInternalTerminal = words.some((w, idx) => idx < words.length - 1 && hasTerminal(w));
  const isEnOverlength = words.length > 14 || textEn.length > maxChars;
  if (words.length <= maxWords && !hasInternalTerminal && !isEnOverlength && !isZhOverlength) {
    return [{ ...cue, end: effectiveEnd, textEn, textZh }];
  }

  const pieces: string[] = [];
  let cur: string[] = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const remaining = words.length - (i + 1);

    // Lookahead: if adding this word would violate hard limits (14 words or maxChars),
    // flush the current accumulated piece first so it stays within bounds.
    if (cur.length > 0 && (cur.length >= 14 || cur.join(' ').length + 1 + w.length > maxChars)) {
      pieces.push(cur.join(' '));
      cur = [];
    }

    cur.push(w);
    const count = cur.length;
    const curLen = cur.join(' ').length;

    if (hasTerminal(w)) {
      pieces.push(cur.join(' '));
      cur = [];
      continue;
    }

    // Natural clause break: comma / semicolon with reasonable length
    if (hasClausePunct(w) && count >= 4 && remaining >= 3) {
      pieces.push(cur.join(' '));
      cur = [];
      continue;
    }

    // Natural connector break (e.g. before "and", "but", "so", "because", etc.)
    if (count >= 5 && count <= maxWords && remaining >= 3) {
      const nextWord = words[i + 1];
      if (nextWord && isConnector(nextWord)) {
        pieces.push(cur.join(' '));
        cur = [];
        continue;
      }
    }

    // Soft/hard limit reached: soft limit maxWords (12), hard limit 14 words or maxChars (70 chars)
    if (count >= maxWords && remaining >= 3) {
      pieces.push(cur.join(' '));
      cur = [];
    } else if (count >= 14 || curLen >= maxChars) {
      pieces.push(cur.join(' '));
      cur = [];
    }
  }

  if (cur.length > 0) {
    const prevPiece = pieces[pieces.length - 1];
    const prevEndsWithTerminal = prevPiece && hasTerminal(prevPiece);
    const prevCount = prevPiece ? countWords(prevPiece) : 0;
    const prevLen = prevPiece ? prevPiece.length : 0;
    const curLen = cur.join(' ').length;
    if (
      pieces.length > 0 &&
      !prevEndsWithTerminal &&
      cur.length <= 2 &&
      prevCount + cur.length <= 14 &&
      prevLen + curLen + 1 <= maxChars
    ) {
      pieces[pieces.length - 1] = pieces[pieces.length - 1] + ' ' + cur.join(' ');
    } else {
      pieces.push(cur.join(' '));
    }
  }

  // Safe slicing pass: ensure absolutely NO piece in pieces exceeds maxChars
  const safePieces: string[] = [];
  for (const p of pieces) {
    if (p.length <= maxChars) {
      safePieces.push(p);
    } else {
      for (let i = 0; i < p.length; i += maxChars) {
        safePieces.push(p.slice(i, i + maxChars));
      }
    }
  }

  if (safePieces.length <= 1) {
    if (isZhOverlength && words.length >= 2) {
      // If safePieces is only 1 piece but textZh exceeds limit, force a mid-point split
      const mid = Math.floor(words.length / 2);
      safePieces.length = 0;
      safePieces.push(words.slice(0, mid).join(' '));
      safePieces.push(words.slice(mid).join(' '));
    } else {
      return [{ ...cue, end: effectiveEnd, textEn, textZh }];
    }
  }

  const totalWords = words.length > 0 ? words.length : safePieces.length;
  let elapsed = 0;
  const result: SubtitleCue[] = [];

  const zhPieces = splitZhPieces(textZh, safePieces.length);

  for (let idx = 0; idx < safePieces.length; idx++) {
    const p = safePieces[idx];
    const pCount = words.length > 0 ? countWords(p) : 1;
    const start = cue.start + (elapsed / totalWords) * duration;
    elapsed += pCount;
    const end = idx === safePieces.length - 1 ? effectiveEnd : cue.start + (elapsed / totalWords) * duration;
    const safeEnd = Math.max(start + 0.2, end);

    result.push({
      ...cue,
      id: cue.id,
      start: Math.round(start * 1000) / 1000,
      end: Math.round(safeEnd * 1000) / 1000,
      textEn: p.trim(),
      textZh: zhPieces[idx] || textZh
    });
  }

  return result;
}

/**
 * Intelligent assembly of fragmented YouTube ASR cues into concise, single-line units.
 * Matches Language Reactor 1:1: keeps lines typically 3~7 words (maximum 8~9 words, "能少不能多"),
 * breaking at natural semantic junctures (terminal punctuation, clause boundaries, speech pauses,
 * and coordinating connectors) so that subtitles never overflow into bulky multi-line blocks.
 */
export function assembleConciseAsrCues(cues: SubtitleCue[], maxWords = 8): SubtitleCue[] {
  if (!cues || cues.length === 0) return [];

  const countWords = (text: string) => (text.trim().match(/\S+/g) || []).length;
  const isAbbreviation = (text: string) =>
    /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|e\.g|i\.e)\.$/i.test(text.trim());
  const hasTerminal = (text: string) => /[.?!。？！]$/.test(text.trim()) && !isAbbreviation(text);
  const hasClausePunct = (text: string) => /[,;:—\-"']$/.test(text.trim());

  // Step 1: Pre-split any long cues or cues with internal punctuation
  const normalized: SubtitleCue[] = [];
  for (const c of cues) {
    const split = splitLongCueSemantically(c, maxWords);
    normalized.push(...split);
  }

  // Step 2: Merge adjacent tiny fragments if they form a clean, concise single line
  const merged: SubtitleCue[] = [];
  let currentAccum: SubtitleCue | null = null;

  for (const cue of normalized) {
    const textEn = cue.textEn.trim();
    const textZh = cue.textZh ? cue.textZh.trim() : '';
    if (!textEn && !textZh) continue;

    if (!currentAccum) {
      currentAccum = { ...cue, textEn, textZh };
      const isTerminal = currentAccum.textEn
        ? hasTerminal(currentAccum.textEn)
        : hasTerminal(currentAccum.textZh);
      if (isTerminal) {
        merged.push(currentAccum);
        currentAccum = null;
      }
      continue;
    }

    const gap = cue.start - currentAccum.end;
    const accumWords = countWords(currentAccum.textEn);
    const nextWords = countWords(textEn);
    const hasTerm = currentAccum.textEn
      ? hasTerminal(currentAccum.textEn)
      : hasTerminal(currentAccum.textZh);
    const hasClause = currentAccum.textEn
      ? hasClausePunct(currentAccum.textEn)
      : hasClausePunct(currentAccum.textZh);

    // Strict concise merging heuristics matching Language Reactor 1:1:
    // 1. Never merge across terminal punctuation
    // 2. Never merge if accum already has clause punctuation (comma/colon/etc.) and >= 3 words
    // 3. Never merge across speech pause (gap >= 0.25s)
    // 4. Never merge if combined words > maxWords (8~9 words) or duration > 4.5s
    // 5. Only merge if accum is small (<= 2 words up to 9 words, or <= 4 words up to 8 words)
    const canMerge =
      !hasTerm &&
      !hasClause &&
      ((accumWords <= 2 && accumWords + nextWords <= 9) || (accumWords <= 4 && accumWords + nextWords <= maxWords)) &&
      (cue.end - currentAccum.start) <= 4.5 &&
      gap >= -0.4 &&
      gap < 0.25;

    if (!canMerge) {
      merged.push(currentAccum);
      currentAccum = { ...cue, textEn, textZh };
      const isTerminal = currentAccum.textEn
        ? hasTerminal(currentAccum.textEn)
        : hasTerminal(currentAccum.textZh);
      if (isTerminal) {
        merged.push(currentAccum);
        currentAccum = null;
      }
    } else {
      const newEn = currentAccum.textEn
        ? `${currentAccum.textEn} ${textEn}`
        : textEn;

      let newZh = currentAccum.textZh || '';
      if (textZh) {
        if (!newZh) newZh = textZh;
        else if (newZh === textZh || newZh.includes(textZh)) {
          // Exactly the same translation or already included, do not duplicate
        } else if (textZh.includes(newZh)) {
          newZh = textZh;
        } else if (/[\u4e00-\u9fff]/.test(newZh) && /[\u4e00-\u9fff]/.test(textZh)) {
          newZh = `${newZh}${textZh}`;
        } else {
          newZh = `${newZh} ${textZh}`;
        }
      }

      currentAccum = {
        ...currentAccum,
        end: Math.max(currentAccum.end, cue.end),
        textEn: cleanPunctuationSpacing(newEn),
        textZh: cleanPunctuationSpacing(newZh)
      };

      const isTerminal = currentAccum.textEn
        ? hasTerminal(currentAccum.textEn)
        : hasTerminal(currentAccum.textZh);
      if (isTerminal) {
        merged.push(currentAccum);
        currentAccum = null;
      }
    }
  }

  if (currentAccum) {
    merged.push(currentAccum);
  }

  return merged.map((c, i) => ({ ...c, id: i + 1 }));
}

/**
 * Fast Local Rule-Based Semantic Sentence Segmentation (Local Fallback & ASR Assembly)
 *
 * Implements Language Reactor & YouTube Native subtitle standards:
 * - Concise, single-line/two-line reading units (soft limit 8~12 words, hard limit 14 words or 70 chars)
 * - Breaks on authentic terminal punctuation (. ? !), speech silence gaps (>= 0.35s),
 *   clause boundaries (comma/semicolon), or coordinating connectors (and, but, so, because, etc.)
 * - Strict upper bound prevents screen-dominating oversized 30~40+ word blocks.
 */
export function segmentCuesLocally(cues: SubtitleCue[]): SubtitleCue[] {
  if (!cues || cues.length === 0) return [];

  // Step 0: Pre-split any incoming oversized cues (word count > 14 or length > 70 chars)
  const normalized: SubtitleCue[] = [];
  for (const c of cues) {
    const split = splitLongCueSemantically(c, 12, 70);
    normalized.push(...split);
  }

  if (normalized.length <= 1) return normalized;

  const isAbbreviation = (w: string) =>
    /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|e\.g|i\.e)\.$/i.test(w.trim());
  const hasTerminal = (t: string) => /[.?!。？！]$/.test(t.trim()) && !isAbbreviation(t);
  const hasClausePunct = (t: string) => /[,;:—\-"'，；：]$/.test(t.trim());
  const isConnectorWord = (w: string) =>
    /^(and|but|or|so|because|which|that|when|where|if|while|like|with|for|to|in|on|about|as|then|after|before|since|until|although|though)$/i.test(
      w.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '')
    );
  const countWords = (t: string) => {
    if (!t) return 0;
    return (t.trim().match(/\S+/g) || []).length;
  };
  const countTokens = (t: string) => {
    if (!t) return 0;
    const cjkChars = (t.match(/[\u4e00-\u9fa5\u3040-\u30ff\u3400-\u4dbf]/g) || []).length;
    const nonCjk = t.replace(/[\u4e00-\u9fa5\u3040-\u30ff\u3400-\u4dbf]/g, ' ');
    const nonCjkWords = (nonCjk.trim().match(/\S+/g) || []).length;
    return cjkChars + nonCjkWords;
  };

  const merged: SubtitleCue[] = [];
  let accumCue: SubtitleCue | null = null;

  for (let i = 0; i < normalized.length; i++) {
    const cue = normalized[i];
    const textEn = (cue.textEn || '').trim();
    const textZh = (cue.textZh || '').trim();
    if (!textEn && !textZh) continue;

    if (!accumCue) {
      accumCue = {
        ...cue,
        id: merged.length + 1,
        textEn,
        textZh
      };

      if (hasTerminal(textEn) || hasTerminal(textZh)) {
        merged.push(accumCue);
        accumCue = null;
      }
      continue;
    }

    const cur: SubtitleCue = accumCue;
    const gap = cue.start - cur.end;
    const accumWords = countWords(cur.textEn);
    const nextWords = countWords(textEn);
    const totalWords = accumWords + nextWords;
    const combinedEnLength = (cur.textEn ? `${cur.textEn} ${textEn}` : textEn).length;
    const combinedZhLength = (cur.textZh ? `${cur.textZh}${textZh}` : textZh).length;

    const accumHasTerminal = hasTerminal(cur.textEn) || hasTerminal(cur.textZh);
    const accumHasClause = hasClausePunct(cur.textEn) || hasClausePunct(cur.textZh);

    const firstNextWord = (textEn || '').trim().split(/\s+/)[0] || '';
    const isNextConnector = isConnectorWord(firstNextWord);

    // Natural grammatical sentence preservation & concise bounds:
    // 1. Break immediately if previous accumulation ended with terminal punctuation (., ?, !)
    // 2. Break if there is a speech silence gap (gap >= 0.35s)
    // 3. Break if previous accumulation ended with clause punctuation and already has >= 5 words
    // 4. Break if next cue starts with connector/conjunction and accum is already at soft limit (>= 7 words or total > 12 words)
    // 5. Break if duration exceeds 4.5s and words >= 8
    // 6. Hard limit: total words > 14 OR total English chars > 70 OR Chinese chars > 30
    const isSilencePause = gap >= 0.35;
    const isClauseBreak = accumHasClause && (accumWords >= 5 || totalWords > 10);
    const isConnectorBreak = isNextConnector && (accumWords >= 7 || totalWords > 12);
    const isDurationOverlength = (cue.end - cur.start) > 4.5 && totalWords >= 8;
    const isHardLimitReached = totalWords > 14 || combinedEnLength > 70 || combinedZhLength > 30;

    const shouldBreak =
      accumHasTerminal ||
      isSilencePause ||
      isClauseBreak ||
      isConnectorBreak ||
      isDurationOverlength ||
      isHardLimitReached;

    if (shouldBreak) {
      merged.push(cur);
      accumCue = {
        ...cue,
        id: merged.length + 1,
        textEn,
        textZh
      };

      if (hasTerminal(textEn) || hasTerminal(textZh)) {
        merged.push(accumCue);
        accumCue = null;
      }
    } else {
      // Merge within concise boundary
      const combinedEn: string = cur.textEn
        ? `${cur.textEn} ${textEn}`
        : textEn;

      let combinedZh: string = cur.textZh || '';
      if (textZh) {
        if (!combinedZh) combinedZh = textZh;
        else if (combinedZh === textZh || combinedZh.includes(textZh)) {
          // Already included
        } else if (textZh.includes(combinedZh)) {
          combinedZh = textZh;
        } else if (/[\u4e00-\u9fff]/.test(combinedZh) && /[\u4e00-\u9fff]/.test(textZh)) {
          combinedZh = `${combinedZh}${textZh}`;
        } else {
          combinedZh = `${combinedZh} ${textZh}`;
        }
      }

      accumCue = {
        ...cur,
        end: Math.max(cur.end, cue.end),
        textEn: combinedEn.replace(/\s+/g, ' ').trim(),
        textZh: combinedZh.replace(/\s+/g, ' ').trim()
      };

      if (hasTerminal(accumCue.textEn) || hasTerminal(accumCue.textZh)) {
        merged.push(accumCue);
        accumCue = null;
      }
    }
  }

  if (accumCue) {
    merged.push(accumCue);
  }

  // Final validation pass: ensure absolutely NO cue exceeds 14 words or 70 characters (or 30 CJK chars)
  const finalized: SubtitleCue[] = [];
  for (const c of merged) {
    const enWords = countWords(c.textEn);
    const enLen = (c.textEn || '').length;
    const zhLen = (c.textZh || '').length;
    const isZhCjk = isCjkText(c.textZh);
    const maxZhLimit = isZhCjk ? 30 : 70;
    if (enWords > 14 || enLen > 70 || zhLen > maxZhLimit) {
      finalized.push(...splitLongCueSemantically(c, 12, 70));
    } else {
      finalized.push(c);
    }
  }

  return finalized.map((c, idx) => ({
    ...c,
    id: idx + 1,
    start: Math.round(c.start * 1000) / 1000,
    end: Math.round(c.end * 1000) / 1000
  }));
}

/**
 * Assembles ASR speech into concise, meaningful grammatical sentences matching Language Reactor.
 * Replaces screen-dominating oversized blocks with concise 8~12 word units (hard limit 14 words).
 */
export function assembleLongAsrSentences(cues: SubtitleCue[]): SubtitleCue[] {
  return segmentCuesLocally(cues);
}

/**
 * Clean UI garbage and auto-generated noise from live captions (e.g. "英语 (自动生成) 点击 查看设置")
 */
export function cleanLiveCaptionGarbage(text: string): string {
  if (!text) return '';
  return text
    .replace(/(?:\b|\s*)(?:英语|英文|中文|English|Chinese)?\s*[\(（]?(?:自动生成|auto-generated)[\)）]?\s*(?:点击\s*)?(?:查看设置|settings)?(?:\b|\s*)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Backward-compatible alias directing to assembleLongAsrSentences (soft limit 8~12 words, max 14 words).
 */
export function mergeYouTubeAsrCues(cues: SubtitleCue[]): SubtitleCue[] {
  return assembleLongAsrSentences(cues);
}

/**
 * Accurately slices a YouTube JSON3 ASR event into concise Language Reactor subtitle units
 * (8~12 words, max 14 words / 70 chars) anchored directly to YouTube's native micro-timestamps (tOffsetMs).
 */
export function sliceYouTubeAsrEvent(event: YouTubeJson3Event): SubtitleCue[] {
  if (!event || !event.segs || !Array.isArray(event.segs) || event.segs.length === 0) {
    return [];
  }

  const tStartMs = event.tStartMs || 0;
  const dDurationMs = event.dDurationMs || 0;
  const eventEndMs = dDurationMs > 0 ? tStartMs + dDurationMs : tStartMs + 3000;

  // Step 1: Pre-calculate segment base timestamps with proportional interpolation for missing tOffsetMs
  const segTimes: number[] = new Array(event.segs.length);
  let sIdx = 0;
  while (sIdx < event.segs.length) {
    if (typeof event.segs[sIdx].tOffsetMs === 'number') {
      segTimes[sIdx] = tStartMs + (event.segs[sIdx].tOffsetMs || 0);
      sIdx++;
    } else {
      let runEnd = sIdx;
      while (runEnd < event.segs.length && typeof event.segs[runEnd].tOffsetMs !== 'number') {
        runEnd++;
      }
      const prevAnchorTime = sIdx > 0 ? segTimes[sIdx - 1] : tStartMs;
      let nextAnchorTime = eventEndMs;
      if (runEnd < event.segs.length && typeof event.segs[runEnd].tOffsetMs === 'number') {
        nextAnchorTime = tStartMs + (event.segs[runEnd].tOffsetMs || 0);
      }
      const safeNextAnchorTime = Math.max(prevAnchorTime, nextAnchorTime);
      let totalRunLen = 0;
      for (let k = sIdx; k < runEnd; k++) {
        totalRunLen += Math.max(1, (event.segs[k].utf8 || '').trim().length);
      }
      let accLen = 0;
      for (let k = sIdx; k < runEnd; k++) {
        const fraction = totalRunLen > 0 ? accLen / totalRunLen : (k - sIdx) / (runEnd - sIdx);
        segTimes[k] = Math.round(prevAnchorTime + fraction * (safeNextAnchorTime - prevAnchorTime));
        accLen += Math.max(1, (event.segs[k].utf8 || '').trim().length);
      }
      sIdx = runEnd;
    }
  }

  for (let k = 1; k < segTimes.length; k++) {
    if (segTimes[k] < segTimes[k - 1]) {
      segTimes[k] = segTimes[k - 1];
    }
  }

  // Step 2: Normalize all segs into micro-tokens with accurate start timestamps
  interface SegToken {
    text: string;
    startMs: number;
    isLineBreak: boolean;
  }

  const countWords = (t: string) => (t.trim().match(/\S+/g) || []).length;
  const isAbbr = (w: string) => /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|e\.g|i\.e)\.$/i.test(w.trim());
  const hasTerminal = (w: string) => /[.?!。？！]$/.test(w.trim()) && !isAbbr(w);
  const hasClausePunct = (w: string) => /[,;:—\-"'，；：]$/.test(w.trim());
  const isConnector = (w: string) =>
    /^(and|but|or|so|because|which|that|when|where|if|while|like|with|for|to|in|on|about|as|then|after|before|since|until|although|though)$/i.test(
      w.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '')
    );

  const tokens: SegToken[] = [];

  for (let i = 0; i < event.segs.length; i++) {
    const s = event.segs[i];
    const rawText = s.utf8 || '';
    if (!rawText) continue;

    const segTimeMs = Math.min(eventEndMs, Math.max(tStartMs, segTimes[i] ?? tStartMs));
    const nextSegTime = (i + 1 < segTimes.length) ? Math.max(segTimeMs, segTimes[i + 1]) : eventEndMs;

    if (rawText.includes('\n')) {
      const parts = rawText.split('\n');
      for (let pIdx = 0; pIdx < parts.length; pIdx++) {
        const partText = parts[pIdx];
        const isBreak = pIdx > 0;
        const partTimeMs = isBreak
          ? Math.round(segTimeMs + (pIdx / parts.length) * (nextSegTime - segTimeMs))
          : segTimeMs;
        if (partText) {
          tokens.push({
            text: partText,
            startMs: partTimeMs,
            isLineBreak: isBreak
          });
        } else if (isBreak && tokens.length > 0) {
          tokens[tokens.length - 1].isLineBreak = true;
        }
      }
    } else {
      tokens.push({
        text: rawText,
        startMs: segTimeMs,
        isLineBreak: false
      });
    }
  }

  if (tokens.length === 0) {
    return [];
  }

  // Step 3: Group tokens into concise, natural cues
  const cues: SubtitleCue[] = [];
  let curGroup: SegToken[] = [];

  const flushGroup = (nextStartMs?: number) => {
    if (curGroup.length === 0) return;
    const groupTextRaw = curGroup.map(t => t.text).join('');
    const decoded = cleanPunctuationSpacing(decodeHtmlEntities(groupTextRaw.replace(/<[^>]+>/g, ''))).trim();
    if (decoded && isValidSubtitleText(decoded)) {
      const gStart = curGroup[0].startMs / 1000;
      let gEnd: number;
      if (typeof nextStartMs === 'number' && nextStartMs > curGroup[0].startMs) {
        gEnd = Math.min(eventEndMs / 1000, nextStartMs / 1000);
      } else {
        gEnd = eventEndMs / 1000;
      }
      gEnd = Math.max(gStart + 0.3, gEnd);

      if (cues.length > 0) {
        const prevCue = cues[cues.length - 1];
        if (prevCue.end > gStart) {
          prevCue.end = Math.max(prevCue.start + 0.2, gStart);
        }
      }
      const adjustedStart = cues.length > 0 ? Math.max(cues[cues.length - 1].end, gStart) : gStart;
      const maxEndSec = Math.max(adjustedStart + 0.2, eventEndMs / 1000);
      const adjustedEnd = Math.min(maxEndSec, Math.max(adjustedStart + 0.3, gEnd));

      const isZh = isChineseText(decoded);
      cues.push({
        id: cues.length + 1,
        start: Math.round(adjustedStart * 1000) / 1000,
        end: Math.round(adjustedEnd * 1000) / 1000,
        textEn: isZh ? '' : decoded,
        textZh: isZh ? decoded : ''
      });
    }
    curGroup = [];
  };

  for (let idx = 0; idx < tokens.length; idx++) {
    const tok = tokens[idx];
    const tokWords = countWords(tok.text);
    const tokChars = tok.text.length;

    if (curGroup.length > 0) {
      const curText = curGroup.map(t => t.text).join('');
      const curWords = countWords(curText);
      const curChars = curText.length;
      const lastTok = curGroup[curGroup.length - 1];
      const lastDur = Math.max(150, Math.min(500, countWords(lastTok.text) * 220));
      const silenceGapMs = tok.startMs - (lastTok.startMs + lastDur);

      const endsWithTerm = hasTerminal(curText);
      const endsWithClause = hasClausePunct(curText);
      const firstTokWord = tok.text.trim().split(/\s+/)[0] || '';
      const isNextConn = isConnector(firstTokWord);

      const isCjk = isCjkText(curText + tok.text);
      const maxAllowedChars = isCjk ? 30 : 70;

      const isSilencePause = silenceGapMs >= 350;
      const isClauseBreak = endsWithClause && (curWords >= 4 || curWords + tokWords > 10);
      const isConnBreak = isNextConn && (curWords >= 7 || curWords + tokWords > 12);
      const isWordLimit = curWords >= 10 && tokWords >= 4;
      const isHardLimit = curWords + tokWords > 14 || curChars + tokChars > maxAllowedChars;

      if (tok.isLineBreak || endsWithTerm || isSilencePause || isClauseBreak || isConnBreak || isWordLimit || isHardLimit) {
        flushGroup(tok.startMs);
      }
    }

    curGroup.push(tok);
  }

  flushGroup(eventEndMs);

  // Step 4: Final verification pass to ensure no individual cue exceeds 14 words / 70 chars (or 30 CJK chars)
  const finalized: SubtitleCue[] = [];
  for (const c of cues) {
    const isCjk = isCjkText(c.textEn || c.textZh);
    const maxChars = isCjk ? 30 : 70;
    const wCount = countWords(c.textEn || c.textZh);
    const cLen = (c.textEn || c.textZh).length;
    if (wCount > 14 || cLen > maxChars) {
      finalized.push(...splitLongCueSemantically(c, 12, maxChars));
    } else {
      finalized.push(c);
    }
  }

  return sanitizeCues(finalized);
}

/**
 * Align original and translated YouTube JSON3 events into unified bilingual cues.
 * Uses interval overlap matching so that fine-grained acoustic ASR chunks receive
 * continuous translation coverage across multi-second translation intervals.
 *
 * R2 Standard:
 * - Manual Captions: 1:1 exact native timestamps and intervals preserved without modification.
 * - ASR Captions: concise Language Reactor assembly (8~12 words, max 14 words / 70 chars),
 *   anchored tightly to native acoustic event and tOffsetMs timings.
 */
export function alignBilingualJson3Events(
  origEvents: YouTubeJson3Event[],
  transEvents: YouTubeJson3Event[],
  isAsrHint?: boolean
): SubtitleCue[] {
  if (!origEvents || origEvents.length === 0) return [];
  if (!transEvents || transEvents.length === 0) {
    return parseYouTubeJson3({ events: origEvents }, undefined, isAsrHint);
  }

  // Detect whether original events are ASR
  const isAsr = isAsrHint ?? (
    origEvents.some(e => Array.isArray(e.segs) && e.segs.some(s => typeof s.tOffsetMs === 'number' && s.tOffsetMs > 0)) ||
    origEvents.some(e => Array.isArray(e.segs) && e.segs.some(s => typeof s.acAsrConf === 'number')) ||
    (origEvents.length > 2 &&
      origEvents.some(e => Array.isArray(e.segs) && e.segs.length > 1 && e.segs.some(s => s.utf8 === '\n')) &&
      !origEvents.some(e => Array.isArray(e.segs) && e.segs.some(s => /[.?!。？！]$/.test((s.utf8 || '').trim()))))
  );

  // Pre-parse valid translation events with normalized timestamps
  interface TransItem {
    start: number;
    end: number;
    text: string;
    isCjk: boolean;
  }

  const cleanTransList: TransItem[] = [];
  for (const t of transEvents) {
    if (!t.segs || t.segs.length === 0) continue;
    const tStart = (t.tStartMs || 0) / 1000;
    const tDur = (t.dDurationMs || 0) / 1000;
    const tEnd = tDur > 0 ? tStart + tDur : tStart + 3.0;
    const tRaw = t.segs.map(s => s.utf8 || '').join('');
    const tClean = cleanPunctuationSpacing(decodeHtmlEntities(tRaw.replace(/<[^>]+>/g, ''))).trim();
    if (tClean && isValidSubtitleText(tClean)) {
      cleanTransList.push({
        start: tStart,
        end: tEnd,
        text: tClean,
        isCjk: isCjkText(tClean)
      });
    }
  }

  const rawCues: SubtitleCue[] = [];
  let transIndex = 0;

  for (let i = 0; i < origEvents.length; i++) {
    const oEvent = origEvents[i];
    if (!oEvent.segs || oEvent.segs.length === 0) continue;

    if (isAsr) {
      const sliced = sliceYouTubeAsrEvent(oEvent);
      for (const sc of sliced) {
        rawCues.push({
          ...sc,
          id: rawCues.length + 1
        });
      }
      continue;
    }

    const oTextRaw = oEvent.segs.map(s => s.utf8 || '').join('');
    const oClean = cleanPunctuationSpacing(decodeHtmlEntities(oTextRaw.replace(/<[^>]+>/g, ''))).trim();
    if (!oClean || !isValidSubtitleText(oClean)) continue;

    const oStart = (oEvent.tStartMs || 0) / 1000;
    const oDuration = (oEvent.dDurationMs || 0) / 1000;
    const oEnd = oDuration > 0 ? oStart + oDuration : oStart + 3.0;

    const isZh = isChineseText(oClean);
    rawCues.push({
      id: rawCues.length + 1,
      start: oStart,
      end: oEnd,
      textEn: isZh ? '' : oClean,
      textZh: isZh ? oClean : ''
    });
  }

  // Match translation to each raw cue
  for (const cue of rawCues) {
    const oStart = cue.start;
    const oEnd = cue.end;
    let matchedTransText = '';
    let bestScore = -999;
    let bestTransIdx = -1;

    const searchStart = Math.max(0, transIndex - 5);
    const searchEnd = Math.min(cleanTransList.length, transIndex + 15);

    for (let j = searchStart; j < searchEnd; j++) {
      const candidate = cleanTransList[j];
      const overlap = Math.max(0, Math.min(oEnd, candidate.end) - Math.max(oStart, candidate.start));
      const oDur = Math.max(0.1, oEnd - oStart);
      const overlapRatio = overlap / oDur;
      const centerDiff = Math.abs((oStart + oEnd) / 2 - (candidate.start + candidate.end) / 2);
      const startDiff = Math.abs(oStart - candidate.start);

      let score = overlapRatio * 10 - centerDiff;
      if (startDiff <= 0.3) score += 5;

      const isValidCandidate =
        overlap > 0 ||
        (oStart >= candidate.start - 0.5 && oEnd <= candidate.end + 0.5) ||
        startDiff <= 1.2 ||
        centerDiff <= 3.0;

      if (isValidCandidate && score > bestScore) {
        bestScore = score;
        matchedTransText = candidate.text;
        bestTransIdx = j;
      }
    }

    if (bestTransIdx !== -1) {
      transIndex = Math.max(transIndex, bestTransIdx);
    }

    const tClean = cleanPunctuationSpacing(decodeHtmlEntities(matchedTransText.replace(/<[^>]+>/g, ''))).trim();

    const origText = cue.textEn || cue.textZh;
    const oIsChinese = isChineseText(origText);
    const tIsChinese = isChineseText(tClean);

    if (tClean) {
      if (oIsChinese && !tIsChinese) {
        cue.textZh = origText;
        cue.textEn = tClean;
      } else if (oIsChinese && tIsChinese) {
        cue.textZh = origText;
        cue.textEn = '';
      } else {
        cue.textEn = origText;
        cue.textZh = tClean;
      }
    } else {
      if (oIsChinese) {
        cue.textEn = '';
        cue.textZh = origText;
      } else {
        cue.textEn = origText;
        cue.textZh = '';
      }
    }
  }

  // R2: For manual captions, keep 1:1 original timestamps and cuts!
  if (!isAsr) {
    return sanitizeCues(rawCues);
  }

  // R1: For ASR captions, assemble concisely into 8~12 words (max 14 words / 70 chars)
  const merged = assembleLongAsrSentences(rawCues);
  return sanitizeCues(merged);
}

/**
 * Parse YouTube timedtext JSON3 format into standard, non-overlapping SubtitleCue[]
 * Supports dual-track bilingual alignment when translationJsonContent is supplied.
 *
 * R2:
 * - Manual Captions: 1:1 native timestamps and cuts preserved without altering.
 * - ASR Captions: Language Reactor concise single-line standard (soft 8~12 words, max 14 words / 70 chars).
 */
export function parseYouTubeJson3(
  jsonContent: string | object,
  translationJsonContent?: string | object,
  isAsrHint?: boolean
): SubtitleCue[] {
  let data: YouTubeJson3Data;
  if (typeof jsonContent === 'string') {
    try {
      data = JSON.parse(jsonContent);
    } catch {
      return [];
    }
  } else if (typeof jsonContent === 'object' && jsonContent !== null) {
    data = jsonContent as YouTubeJson3Data;
  } else {
    return [];
  }

  if (!data || !Array.isArray(data.events) || data.events.length === 0) {
    return [];
  }

  // Detect whether events are ASR
  const isAsr = isAsrHint ?? (
    data.events.some(e => Array.isArray(e.segs) && e.segs.some(s => typeof s.tOffsetMs === 'number' && s.tOffsetMs > 0)) ||
    data.events.some(e => Array.isArray(e.segs) && e.segs.some(s => typeof s.acAsrConf === 'number')) ||
    (data.events.length > 2 &&
      data.events.some(e => Array.isArray(e.segs) && e.segs.length > 1 && e.segs.some(s => s.utf8 === '\n')) &&
      !data.events.some(e => Array.isArray(e.segs) && e.segs.some(s => /[.?!。？！]$/.test((s.utf8 || '').trim()))))
  );

  // If translation JSON is provided, align bilingually
  if (translationJsonContent) {
    let transData: YouTubeJson3Data | null = null;
    if (typeof translationJsonContent === 'string') {
      try {
        transData = JSON.parse(translationJsonContent);
      } catch {}
    } else if (typeof translationJsonContent === 'object' && translationJsonContent !== null) {
      transData = translationJsonContent as YouTubeJson3Data;
    }

    if (transData && Array.isArray(transData.events) && transData.events.length > 0) {
      return alignBilingualJson3Events(data.events, transData.events, isAsr);
    }
  }

  const rawCues: SubtitleCue[] = [];
  let idCounter = 1;

  for (const event of data.events) {
    if (!event.segs || !Array.isArray(event.segs) || event.segs.length === 0) {
      continue;
    }

    if (isAsr) {
      const sliced = sliceYouTubeAsrEvent(event);
      for (const sc of sliced) {
        rawCues.push({
          ...sc,
          id: idCounter++
        });
      }
      continue;
    }

    const fullSegText = event.segs.map(s => s.utf8 || '').join('');
    const decodedFull = cleanPunctuationSpacing(decodeHtmlEntities(fullSegText.replace(/<[^>]+>/g, ''))).trim();
    if (!decodedFull) continue;

    // Split by lines to check if bilingual or wrapped
    const rawLines = decodedFull.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (rawLines.length === 0) continue;

    let textEn = '';
    let textZh = '';

    if (rawLines.length === 1) {
      const line = rawLines[0];
      if (isChineseText(line)) {
        textZh = line;
      } else {
        textEn = line;
      }
    } else {
      const line1 = rawLines[0];
      const line2 = rawLines.slice(1).join(' ');
      const hasChinese1 = isChineseText(line1);
      const hasChinese2 = isChineseText(line2);

      if (!hasChinese1 && hasChinese2) {
        textEn = line1;
        textZh = line2;
      } else if (hasChinese1 && !hasChinese2) {
        textEn = line2;
        textZh = line1;
      } else {
        // Both same language: merge into a continuous sentence
        if (hasChinese1 && hasChinese2) {
          textEn = '';
          textZh = `${line1}${line2}`.trim();
        } else {
          textEn = `${line1} ${line2}`.replace(/\s+/g, ' ').trim();
          textZh = '';
        }
      }
    }

    if (!isValidSubtitleText(textEn) && !isValidSubtitleText(textZh)) {
      continue;
    }

    const start = (event.tStartMs || 0) / 1000;
    const duration = (event.dDurationMs || 0) / 1000;
    const end = duration > 0 ? start + duration : start + 3.0;

    rawCues.push({
      id: idCounter++,
      start,
      end,
      textEn,
      textZh
    });
  }

  // R2: For manual captions, keep 1:1 original timestamps and cuts!
  if (!isAsr) {
    return sanitizeCues(rawCues);
  }

  // R1: For ASR captions, assemble concisely into 8~12 words (max 14 words / 70 chars)
  const merged = assembleLongAsrSentences(rawCues);
  return sanitizeCues(merged);
}

/**
 * Parse YouTube XML timedtext format (<transcript> or <timedtext>) into standard SubtitleCue[]
 */
export function parseYouTubeXml(xmlText: string): SubtitleCue[] {
  if (!xmlText || typeof xmlText !== 'string') return [];
  if (!xmlText.includes('<transcript') && !xmlText.includes('<timedtext') && !xmlText.includes('<text ') && !xmlText.includes('<p ')) {
    return [];
  }

  const rawCues: SubtitleCue[] = [];
  let id = 1;

  // Format 1: <text start="1.23" dur="4.56">hello</text>
  const textTagRegex = /<text\s+start="([\d.]+)"(?:\s+dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/gi;
  let match: RegExpExecArray | null;

  while ((match = textTagRegex.exec(xmlText)) !== null) {
    const start = parseFloat(match[1]) || 0;
    const dur = match[2] ? parseFloat(match[2]) : 3.0;
    const rawContent = match[3] || '';
    const cleaned = decodeHtmlEntities(rawContent.replace(/<[^>]+>/g, '').replace(/\r?\n/g, ' ').trim());
    if (cleaned && isValidSubtitleText(cleaned)) {
      const isCjk = isCjkText(cleaned);
      rawCues.push({
        id: id++,
        start,
        end: start + dur,
        textEn: isCjk ? '' : cleaned,
        textZh: isCjk ? cleaned : ''
      });
    }
  }

  // Format 2: <p t="1230" d="4560">hello</p>
  if (rawCues.length === 0) {
    const pTagRegex = /<p\s+t="(\d+)"(?:\s+d="(\d+)")?[^>]*>([\s\S]*?)<\/p>/gi;
    while ((match = pTagRegex.exec(xmlText)) !== null) {
      const start = (parseInt(match[1], 10) || 0) / 1000;
      const dur = match[2] ? (parseInt(match[2], 10) || 0) / 1000 : 3.0;
      const rawContent = match[3] || '';
      const cleaned = decodeHtmlEntities(rawContent.replace(/<[^>]+>/g, '').replace(/\r?\n/g, ' ').trim());
      if (cleaned && isValidSubtitleText(cleaned)) {
        const isCjk = isCjkText(cleaned);
        rawCues.push({
          id: id++,
          start,
          end: start + dur,
          textEn: isCjk ? '' : cleaned,
          textZh: isCjk ? cleaned : ''
        });
      }
    }
  }

  return sanitizeCues(rawCues);
}

/**
 * Parse raw SRT, VTT, ASS, SSA, LRC, SUB, TTML, or JSON subtitle string/buffer into SubtitleCue[]
 */
export function parseSubtitleContent(rawInput: string | ArrayBuffer | Uint8Array): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  if (!rawInput) return cues;

  let rawText = '';
  if (typeof rawInput === 'string') {
    rawText = rawInput;
  } else if (rawInput instanceof ArrayBuffer || rawInput instanceof Uint8Array) {
    rawText = decodeSubtitleBuffer(rawInput);
  } else {
    return cues;
  }

  if (!rawText || typeof rawText !== 'string') return cues;
  rawText = rawText.replace(/^\uFEFF/, '').trim();

  // 0. Detect and parse YouTube JSON3 or Bilibili BCC JSON timedtext
  if (rawText.startsWith('{') || rawText.startsWith('[')) {
    if (rawText.includes('"events"')) {
      const jsonCues = parseYouTubeJson3(rawText);
      if (jsonCues.length > 0) return jsonCues;
    }
    if (rawText.includes('"body"')) {
      const bccCues = parseBccJsonSubtitles(rawText);
      if (bccCues.length > 0) return bccCues;
    }
  }

  // 0.1 Detect and parse YouTube XML / TTML / DFXP timedtext
  if (rawText.includes('<transcript') || rawText.includes('<timedtext')) {
    const xmlCues = parseYouTubeXml(rawText);
    if (xmlCues.length > 0) return xmlCues;
  }
  if (rawText.includes('<tt') || rawText.includes('xmlns="http://www.w3.org/ns/ttml"') || (rawText.includes('<p ') && rawText.includes('begin='))) {
    const ttmlCues = parseTtmlSubtitles(rawText);
    if (ttmlCues.length > 0) return ttmlCues;
  }

  // 1. Detect and parse ASS / SSA subtitle format
  if (
    /\[Events\]/i.test(rawText) ||
    /\[V4\+?\s*Styles\]/i.test(rawText) ||
    /\[Script\s*Info\]/i.test(rawText) ||
    /^\s*Dialogue\s*:/im.test(rawText)
  ) {
    const assCues = parseAssSubtitles(rawText);
    if (assCues.length > 0) return assCues;
  }

  // 2. Detect and parse MicroDVD SUB format (e.g. {100}{200}Hello or {00:01:23}{00:01:25}Hello)
  if (/^\{[\d:.]+\}\{[\d:.]+\}/m.test(rawText)) {
    const subCues = parseMicroDvdSubtitles(rawText);
    if (subCues.length > 0) return subCues;
  }

  // 3. Detect and parse LRC Lyrics format (e.g. [01:23.45]Hello)
  if (/^\[\d{1,2}:\d{2}[.:]\d{2,3}\]/m.test(rawText)) {
    const lrcCues = parseLrcSubtitles(rawText);
    if (lrcCues.length > 0) return lrcCues;
  }

  // 4. Normalize line endings and remove WebVTT header if present
  const text = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^WEBVTT[^\n]*\n+/i, '')
    .replace(/NOTE[^\n]*\n+/gi, '');

  const blocks = text.split(/\n\n+/);
  let idCounter = 1;

  for (const block of blocks) {
    const lines = block.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) continue;

    let timeLineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) {
        timeLineIndex = i;
        break;
      }
    }

    if (timeLineIndex === -1) continue;

    const timeLine = lines[timeLineIndex];
    const parts = timeLine.split('-->');
    if (parts.length < 2) continue;

    const startStr = parts[0].trim().split(' ')[0];
    const endStr = parts[1].trim().split(' ')[0];
    const start = timeStringToSeconds(startStr);
    const end = timeStringToSeconds(endStr);

    if (end <= start && end !== 0) continue;

    const textLines = lines.slice(timeLineIndex + 1);
    if (textLines.length === 0) continue;

    // Strip basic HTML / styling tags like <i>, <b>, <font color="...">, <c.color>
    const cleanLines = textLines.map(l =>
      l.replace(/<[^>]+>/g, '').replace(/\{[^\}]+\}/g, '').trim()
    ).filter(Boolean);

    if (cleanLines.length === 0) continue;

    const { textEn, textZh } = splitBilingualLines(cleanLines);
    let finalEn = textEn;
    let finalZh = textZh;
    if (!finalEn && !finalZh) {
      const fullText = cleanLines.join(' ');
      if (isCjkText(fullText)) {
        finalZh = cleanLines.join('');
      } else {
        finalEn = fullText;
      }
    }

    cues.push({
      id: idCounter++,
      start,
      end,
      textEn: finalEn,
      textZh: finalZh
    });
  }

  return cues.sort((a, b) => a.start - b.start);
}

/**
 * Shift subtitle cues by offset in seconds (+0.5s or -0.5s)
 */
export function shiftSubtitleTime(cues: SubtitleCue[], offsetSeconds: number): SubtitleCue[] {
  if (!cues || cues.length === 0 || offsetSeconds === 0) return cues;
  return cues.map(cue => ({
    ...cue,
    start: Math.max(0, cue.start + offsetSeconds),
    end: Math.max(0.1, cue.end + offsetSeconds)
  }));
}

/**
 * Merge separate English subtitle cues and Chinese subtitle cues by timeline alignment
 */
export function mergeSubtitleTracks(enCues: SubtitleCue[], zhCues: SubtitleCue[]): SubtitleCue[] {
  if (!zhCues || zhCues.length === 0) return enCues;
  if (!enCues || enCues.length === 0) return zhCues;

  return enCues.map((enCue) => {
    const midTime = (enCue.start + enCue.end) / 2;
    const matchedZh = zhCues.find(zh => midTime >= zh.start && midTime <= zh.end)
      || zhCues.find(zh => Math.abs(zh.start - enCue.start) < 1.2);

    return {
      ...enCue,
      textZh: matchedZh ? (matchedZh.textZh || matchedZh.textEn) : enCue.textZh || ''
    };
  });
}

/**
 * Export SubtitleCue[] to standard SRT text format
 */
export function exportCuesToSrt(cues: SubtitleCue[]): string {
  const formatSrtTime = (seconds: number): string => {
    const totalMs = Math.floor(seconds * 1000);
    const hrs = Math.floor(totalMs / 3600000);
    const mins = Math.floor((totalMs % 3600000) / 60000);
    const secs = Math.floor((totalMs % 60000) / 1000);
    const ms = totalMs % 1000;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
  };

  return cues.map((cue, idx) => {
    const timeLine = `${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}`;
    const text = cue.textZh ? `${cue.textEn}\n${cue.textZh}` : cue.textEn;
    return `${idx + 1}\n${timeLine}\n${text}\n`;
  }).join('\n');
}

/**
 * Export SubtitleCue[] to standard WebVTT text format
 */
export function exportCuesToVtt(cues: SubtitleCue[]): string {
  const formatVttTime = (seconds: number): string => {
    const totalMs = Math.floor(seconds * 1000);
    const hrs = Math.floor(totalMs / 3600000);
    const mins = Math.floor((totalMs % 3600000) / 60000);
    const secs = Math.floor((totalMs % 60000) / 1000);
    const ms = totalMs % 1000;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  };

  const body = cues.map((cue) => {
    const timeLine = `${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}`;
    const text = cue.textZh ? `${cue.textEn}\n${cue.textZh}` : cue.textEn;
    return `${timeLine}\n${text}\n`;
  }).join('\n');

  return `WEBVTT\n\n${body}`;
}
