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
 * Detect whether a string contains Chinese, Japanese Kanji, or CJK ideographs
 */
export function isCjkText(text: string): boolean {
  if (!text) return false;
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
}

/**
 * Clean ASS/SSA tags (e.g. {\pos(100,200)}, {\c&H00FFFF&}, {\fad(200,200)}, \N)
 */
export function cleanAssText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\{[^\}]+\}/g, '') // strip {...} tags
    .replace(/\\N/g, '\n')      // replace \N with newline
    .replace(/\\n/g, '\n')
    .replace(/\\h/g, ' ')
    .trim();
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
 * Parse ASS/SSA format subtitle string
 */
function parseAssSubtitles(rawText: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const lines = rawText.split(/\r?\n/);
  let idCounter = 1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('Dialogue:')) {
      // Format: Dialogue: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
      const content = trimmed.substring(9).trim();
      const parts = content.split(',');
      if (parts.length >= 9) {
        const start = timeStringToSeconds(parts[1]);
        const end = timeStringToSeconds(parts[2]);
        const rawDialogue = parts.slice(9).join(',');
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

  return cues.sort((a, b) => a.start - b.start);
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
 * (typically 3~7 words, max 8~9 words) matching Language Reactor's single-line display.
 * Proportionally interpolates start and end timestamps.
 */
export function splitLongCueSemantically(cue: SubtitleCue, maxWords = 8): SubtitleCue[] {
  if (!cue) return [];
  const textEn = cleanPunctuationSpacing(cleanLiveCaptionGarbage(cue.textEn || '')).trim();
  const textZh = cleanPunctuationSpacing(cleanLiveCaptionGarbage(cue.textZh || '')).trim();
  if (!textEn && !textZh) return [];

  const countWords = (t: string) => (t.trim().match(/\S+/g) || []).length;
  const isAbbreviation = (w: string) =>
    /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|e\.g|i\.e)\.$/i.test(w.trim());
  const hasTerminal = (w: string) => /[.?!。？！]$/.test(w.trim()) && !isAbbreviation(w);
  const hasClausePunct = (w: string) => /[,;:—\-"']$/.test(w.trim());
  const isConnector = (w: string) =>
    /^(and|but|or|so|because|which|that|when|where|if|while|like|with|for|to|in|on|about|as|then|after|before|since|until)$/i.test(
      w.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '')
    );

  const words = textEn.split(/\s+/).filter(Boolean);

  // If text is primarily CJK or English is empty:
  if (words.length === 0) {
    if (textZh.length <= 18) return [{ ...cue, textEn, textZh }];
    // Split long Chinese sentence at punctuation or midpoint
    const zhPieces = textZh.split(/([，。！？；：])/).reduce((acc: string[], cur, idx) => {
      if (idx % 2 === 0) acc.push(cur);
      else if (acc.length > 0) acc[acc.length - 1] += cur;
      return acc;
    }, []).filter(p => p.trim().length > 0);

    if (zhPieces.length <= 1) return [{ ...cue, textEn, textZh }];
    const dur = Math.max(0.2, cue.end - cue.start);
    let el = 0;
    return zhPieces.map((p, i) => {
      const pStart = cue.start + (el / textZh.length) * dur;
      el += p.length;
      const pEnd = i === zhPieces.length - 1 ? cue.end : cue.start + (el / textZh.length) * dur;
      return {
        ...cue,
        id: cue.id,
        start: Math.round(pStart * 100) / 100,
        end: Math.round(pEnd * 100) / 100,
        textEn: '',
        textZh: p.trim()
      };
    });
  }

  const hasInternalTerminal = words.some((w, idx) => idx < words.length - 1 && hasTerminal(w));
  if (words.length <= maxWords && !hasInternalTerminal) {
    return [{ ...cue, textEn, textZh }];
  }

  const pieces: string[] = [];
  let cur: string[] = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    cur.push(w);
    const count = cur.length;
    const remaining = words.length - (i + 1);

    if (hasTerminal(w)) {
      pieces.push(cur.join(' '));
      cur = [];
      continue;
    }

    if (hasClausePunct(w) && count >= 3 && remaining >= 2) {
      pieces.push(cur.join(' '));
      cur = [];
      continue;
    }

    if (count >= 4 && count <= maxWords && remaining >= 3) {
      const nextWord = words[i + 1];
      if (nextWord && isConnector(nextWord)) {
        pieces.push(cur.join(' '));
        cur = [];
        continue;
      }
    }

    if (count >= maxWords) {
      pieces.push(cur.join(' '));
      cur = [];
    }
  }

  if (cur.length > 0) {
    const prevPiece = pieces[pieces.length - 1];
    const prevEndsWithTerminal = prevPiece && hasTerminal(prevPiece);
    if (
      pieces.length > 0 &&
      !prevEndsWithTerminal &&
      cur.length <= 2 &&
      countWords(prevPiece) + cur.length <= maxWords + 1
    ) {
      pieces[pieces.length - 1] = pieces[pieces.length - 1] + ' ' + cur.join(' ');
    } else {
      pieces.push(cur.join(' '));
    }
  }

  if (pieces.length <= 1) {
    return [{ ...cue, textEn, textZh }];
  }

  const totalWords = words.length;
  const duration = Math.max(0.2, cue.end - cue.start);
  let elapsed = 0;
  const result: SubtitleCue[] = [];

  // Helper to split or distribute Chinese translation across split English pieces
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
    return Array(pieceCount).fill(zh);
  };

  const zhPieces = splitZhPieces(textZh, pieces.length);

  for (let idx = 0; idx < pieces.length; idx++) {
    const p = pieces[idx];
    const pCount = countWords(p);
    const start = cue.start + (elapsed / totalWords) * duration;
    elapsed += pCount;
    const end = idx === pieces.length - 1 ? cue.end : cue.start + (elapsed / totalWords) * duration;

    result.push({
      ...cue,
      id: cue.id,
      start: Math.round(start * 100) / 100,
      end: Math.round(end * 100) / 100,
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
 * Fast Local Rule-Based Semantic Sentence Segmentation (Local Fallback)
 *
 * Preserves complete, meaningful grammatical sentences (e.g. main and subordinate clauses)
 * like "While energy is fresh, it tells me to film everything first and then move on to phase two..."
 * as a single unified cue rather than slicing into rigid 8-word mechanical chunks.
 * Breaks on authentic terminal punctuation (. ? !), significant speech silence gaps (>= 0.65s),
 * or natural boundary thresholds.
 */
export function segmentCuesLocally(cues: SubtitleCue[]): SubtitleCue[] {
  if (!cues || cues.length === 0) return [];
  if (cues.length === 1) return cues;

  const isAbbreviation = (w: string) =>
    /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|e\.g|i\.e)\.$/i.test(w.trim());
  const hasTerminal = (t: string) => /[.?!。？！]$/.test(t.trim()) && !isAbbreviation(t);
  const countTokens = (t: string) => {
    if (!t) return 0;
    const cjkChars = (t.match(/[\u4e00-\u9fa5\u3040-\u30ff\u3400-\u4dbf]/g) || []).length;
    const nonCjk = t.replace(/[\u4e00-\u9fa5\u3040-\u30ff\u3400-\u4dbf]/g, ' ');
    const nonCjkWords = (nonCjk.trim().match(/\S+/g) || []).length;
    return cjkChars + nonCjkWords;
  };

  const merged: SubtitleCue[] = [];
  let accumCue: SubtitleCue | null = null;

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
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
    const accumWords = countTokens(cur.textEn || cur.textZh);
    const nextWords = countTokens(textEn || textZh);
    const totalWords = accumWords + nextWords;
    const accumHasTerminal = hasTerminal(cur.textEn) || hasTerminal(cur.textZh);

    // Natural grammatical sentence preservation rules:
    // 1. Break immediately if previous accumulation already ended with terminal punctuation (., ?, !)
    // 2. Break if there is a significant speech silence gap (gap >= 0.7s)
    // 3. Keep subordinate/coordinate sentences together up to 30 words / 10s duration
    // 4. Do NOT mechanically chop at 8 words!
    const isSilencePause = gap >= 0.7;
    const isDurationOverlength = (cue.end - cur.start) > 10.5 && totalWords > 24;
    const isWordCountOverlength = totalWords > 32;

    const shouldBreak = accumHasTerminal || isSilencePause || isDurationOverlength || isWordCountOverlength;

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
      // Merge into complete grammatical sentence
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

  return merged.map((c, idx) => ({
    ...c,
    id: idx + 1,
    start: Math.round(c.start * 1000) / 1000,
    end: Math.round(c.end * 1000) / 1000
  }));
}

/**
 * Assembles ASR speech into complete, meaningful grammatical sentences.
 * Replaces rigid 8-word mechanical chopping with semantic sentence boundary preservation.
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
 * Backward-compatible alias directing to assembleConciseAsrCues (max 8~9 words).
 */
export function mergeYouTubeAsrCues(cues: SubtitleCue[]): SubtitleCue[] {
  return assembleConciseAsrCues(cues, 8);
}

/**
 * Align original and translated YouTube JSON3 events into unified bilingual cues.
 * Uses interval overlap matching so that fine-grained acoustic ASR chunks receive
 * continuous translation coverage across multi-second translation intervals.
 */
export function alignBilingualJson3Events(
  origEvents: YouTubeJson3Event[],
  transEvents: YouTubeJson3Event[]
): SubtitleCue[] {
  if (!origEvents || origEvents.length === 0) return [];
  if (!transEvents || transEvents.length === 0) {
    return parseYouTubeJson3({ events: origEvents });
  }

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

    const oTextRaw = oEvent.segs.map(s => s.utf8 || '').join('');
    const oClean = cleanPunctuationSpacing(decodeHtmlEntities(oTextRaw.replace(/<[^>]+>/g, ''))).trim();
    if (!oClean || !isValidSubtitleText(oClean)) continue;

    const oStart = (oEvent.tStartMs || 0) / 1000;
    const oDuration = (oEvent.dDurationMs || 0) / 1000;
    const oEnd = oDuration > 0 ? oStart + oDuration : oStart + 3.0;

    let matchedTransText = '';
    let bestScore = -999;
    let bestTransIdx = -1;

    // Search around transIndex for speed and temporal coherence
    const searchStart = Math.max(0, transIndex - 5);
    const searchEnd = Math.min(cleanTransList.length, transIndex + 15);

    for (let j = searchStart; j < searchEnd; j++) {
      const candidate = cleanTransList[j];
      const overlap = Math.max(0, Math.min(oEnd, candidate.end) - Math.max(oStart, candidate.start));
      const oDur = Math.max(0.1, oEnd - oStart);
      const overlapRatio = overlap / oDur;
      const centerDiff = Math.abs((oStart + oEnd) / 2 - (candidate.start + candidate.end) / 2);
      const startDiff = Math.abs(oStart - candidate.start);

      // Score prioritizing interval overlap, then center proximity, with direct start match bonus
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

    const oIsCjk = isCjkText(oClean);
    const tIsCjk = isCjkText(tClean);

    let textEn = '';
    let textZh = '';

    if (oIsCjk && !tIsCjk) {
      // Swapped: original track is Chinese, translation track is English
      textEn = tClean;
      textZh = oClean;
    } else if (oIsCjk && tIsCjk) {
      // Both are Chinese: never assign Chinese into textEn!
      textEn = '';
      textZh = oClean;
    } else if (!oIsCjk && tIsCjk) {
      // Normal: original is English, translation is Chinese
      textEn = oClean;
      textZh = tClean;
    } else {
      // Both English or non-CJK
      textEn = oClean;
      textZh = '';
    }

    rawCues.push({
      id: rawCues.length + 1,
      start: oStart,
      end: oEnd,
      textEn,
      textZh
    });
  }

  const merged = mergeYouTubeAsrCues(rawCues);
  return sanitizeCues(merged);
}

/**
 * Parse YouTube timedtext JSON3 format into standard, non-overlapping SubtitleCue[]
 * Supports dual-track bilingual alignment when translationJsonContent is supplied.
 */
export function parseYouTubeJson3(
  jsonContent: string | object,
  translationJsonContent?: string | object
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
      return alignBilingualJson3Events(data.events, transData.events);
    }
  }

  const rawCues: SubtitleCue[] = [];
  let idCounter = 1;

  for (const event of data.events) {
    if (!event.segs || !Array.isArray(event.segs) || event.segs.length === 0) {
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
      if (isCjkText(line)) {
        textZh = line;
      } else {
        textEn = line;
      }
    } else {
      const line1 = rawLines[0];
      const line2 = rawLines.slice(1).join(' ');
      const hasChinese1 = isCjkText(line1);
      const hasChinese2 = isCjkText(line2);

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

  return sanitizeCues(rawCues);
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
 * Parse raw SRT, VTT, or ASS subtitle string into SubtitleCue[]
 */
export function parseSubtitleContent(rawText: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  if (!rawText || typeof rawText !== 'string') return cues;

  // 0. Detect and parse YouTube JSON3 timedtext
  if (rawText.trim().startsWith('{') && rawText.includes('"events"')) {
    const jsonCues = parseYouTubeJson3(rawText);
    if (jsonCues.length > 0) return jsonCues;
  }

  // 0.1 Detect and parse YouTube XML timedtext
  if (rawText.includes('<transcript') || rawText.includes('<timedtext')) {
    const xmlCues = parseYouTubeXml(rawText);
    if (xmlCues.length > 0) return xmlCues;
  }

  // 1. Detect and parse ASS/SSA subtitle format
  if (rawText.includes('[Events]') && rawText.includes('Dialogue:')) {
    return parseAssSubtitles(rawText);
  }

  // 2. Normalize line endings and remove WebVTT header if present
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
