/**
 * ASS subtitle writer for Glean's IINA bridge.
 *
 * Emits a two-style bilingual track: English on the upper line, Chinese
 * translation on the lower line, both bottom-centred (AN2).
 */
import type { MixedRun } from './mixedLayout';
import type { CueOut } from './types';

const DEFAULT_FONT_SIZE = 54;
const EN_SIZE_RATIO = 0.78;
// Inline glosses are annotations, not the main line, so they ride at ~74% of the ZH size
// (40px at the default 54px body).
const GLOSS_SIZE_RATIO = 0.74;

const EN_FONT = 'Helvetica Neue';
// PingFang SC ships as an on-demand asset font (/System/Library/AssetsV2), which IINA's bundled
// fontconfig does not scan — libass then renders every CJK glyph as tofu. Hiragino Sans GB lives in
// /System/Library/Fonts and resolves reliably.
const ZH_FONT = 'Hiragino Sans GB';

const ZH_COLOUR = '&H00FFFFFF'; // opaque white
const EN_COLOUR = '&H00E8D8CF'; // pale cyan
// ASS colours are BGR. The gloss (Chinese hint) takes the mint-green accent, the English it
// explains takes the warm sand accent — matching the web extension's pairing.
const GLOSS_COLOUR = '&H00C8E678'; // RGB(120, 230, 200) mint green
const HIGHLIGHT_COLOUR = '&H0066D6FF'; // RGB(255, 214, 102) warm sand

const SIDE_MARGIN = 60;

interface StyleSpec {
  name: string;
  font: string;
  size: number;
  colour: string;
  outline: number;
  shadow: number;
  marginV: number;
  /** Mixed lines carry inline glosses and are much wider, so they need more breathing room. */
  marginLR?: number;
}

/** Resolves a caller supplied font size into a usable positive number. */
function normaliseFontSize(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_FONT_SIZE;
  }
  return Math.min(Math.max(value, 12), 240);
}

/** Trims trailing zeros so style sizes stay readable in the header. */
function formatNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Formats seconds as `H:MM:SS.cc` (centisecond precision, negative clamps to 0). */
export function formatTimestamp(seconds: number): string {
  const totalCs = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(totalCs / 360000);
  const minutes = Math.floor((totalCs % 360000) / 6000);
  const secs = Math.floor((totalCs % 6000) / 100);
  const centis = totalCs % 100;
  return `${hours}:${pad2(minutes)}:${pad2(secs)}.${pad2(centis)}`;
}

/**
 * Makes plain subtitle text safe inside an ASS `Text` field:
 * backslashes are dropped (no override tags or injected `\N`), braces are
 * neutralised to look-alike fullwidth characters, and newlines become `\N`.
 */
export function escapeAssText(raw: string): string {
  return escapeAssFragment(raw).trim();
}

/**
 * Same protections as {@link escapeAssText} but keeps leading/trailing spaces, so inline
 * pieces can be concatenated without welding words together.
 */
function escapeAssFragment(raw: string): string {
  return raw
    .replace(/\\/g, '')
    .replace(/\{/g, '｛')
    .replace(/\}/g, '｝')
    .replace(/\r\n|\r|\n/g, '\\N')
    .replace(/[ \t]+/g, (match) => (match.length > 1 ? ' ' : match));
}

export type CueAssMode = 'bilingual' | 'mixed';

/**
 * Narrows an untrusted `runs` slot into a usable run list.
 * Missing / malformed entries yield `[]`, which the caller renders as one plain text run.
 */
function runsAt(runs: MixedRun[][] | undefined, index: number): MixedRun[] {
  if (!Array.isArray(runs)) return [];
  const candidate: MixedRun[] | undefined = runs[index];
  return Array.isArray(candidate) ? candidate : [];
}

/**
 * Flattens runs into a single ASS text field.
 * Text runs pass through the normal escaping; gloss runs are wrapped in size/colour overrides
 * so they shrink and warm up, then the override is reset back to the body style.
 */
function buildMixedText(runs: MixedRun[], size: number, fallback: string): string {
  const glossSize = Math.round(size * GLOSS_SIZE_RATIO);
  const reset = `{\\fs${formatNumber(size)}\\c${ZH_COLOUR}&}`;
  const parts: string[] = [];

  for (const run of runs) {
    if (typeof run !== 'object' || run === null) continue;
    if (typeof run.text !== 'string') continue;
    const text = escapeAssFragment(run.text);
    if (!text) continue;
    if (run.kind === 'gloss') {
      parts.push(`{\\fs${glossSize}\\c${GLOSS_COLOUR}&}${text}${reset}`);
    } else if (run.highlight === true) {
      parts.push(`{\\c${HIGHLIGHT_COLOUR}&}${text}{\\c${ZH_COLOUR}&}`);
    } else {
      parts.push(text);
    }
  }

  const assembled = parts.join('').trim();
  return assembled || escapeAssText(fallback);
}

function buildStyleLine(style: StyleSpec): string {
  const fields = [
    style.name,
    style.font,
    formatNumber(style.size),
    style.colour,
    style.colour,
    '&H00000000',
    '&H64000000',
    '-1', // bold
    '0', // italic
    '0', // underline
    '0', // strikeout
    '100', // scaleX
    '100', // scaleY
    '0', // spacing
    '0', // angle
    '1', // border style: outline + shadow
    formatNumber(style.outline),
    formatNumber(style.shadow),
    '2', // alignment: bottom centre
    String(style.marginLR ?? SIDE_MARGIN),
    String(style.marginLR ?? SIDE_MARGIN),
    String(style.marginV),
    '1', // encoding
  ];
  return `Style: ${fields.join(',')}`;
}

function dialogueLine(start: number, end: number, style: string, text: string): string {
  const line = [
    'Dialogue: 0',
    formatTimestamp(start),
    formatTimestamp(end),
    style,
    '',
    '0',
    '0',
    '0',
    '',
    `{\\an2}${text}`,
  ];
  return line.join(',');
}

interface RenderableCue {
  start: number;
  end: number;
  textEn: string;
  textZh: string;
}

function toRenderable(cue: CueOut): RenderableCue | null {
  const start = cue.start;
  const end = cue.end;
  if (typeof start !== 'number' || typeof end !== 'number') return null;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (end <= start) return null;

  const textEn = typeof cue.textEn === 'string' ? escapeAssText(cue.textEn) : '';
  const textZh = typeof cue.textZh === 'string' ? escapeAssText(cue.textZh) : '';
  if (!textEn && !textZh) return null;

  return { start, end, textEn, textZh };
}

/**
 * Serialises cues into a complete ASS document.
 *
 * `bilingual` (default): Chinese lines sit at the bottom; English lines are lifted roughly two
 * lines up. `mixed`: a single bottom line per cue, English body text with inline `（中文）` glosses.
 */
export function cuesToAss(
  cues: CueOut[],
  opts: { fontSize?: number; mode?: CueAssMode; runs?: MixedRun[][] } = {},
): string {
  const mode: CueAssMode = opts?.mode === 'mixed' ? 'mixed' : 'bilingual';
  const size = normaliseFontSize(opts?.fontSize);
  const enSize = size * EN_SIZE_RATIO;
  const zhMarginV = Math.round(size * 0.8);
  const enMarginV = zhMarginV + Math.round(size * 2.5);

  const styles: StyleSpec[] = [
    {
      name: 'ZH',
      font: ZH_FONT,
      size,
      colour: ZH_COLOUR,
      outline: 3,
      shadow: 1.5,
      marginV: zhMarginV,
    },
    {
      name: 'EN',
      font: EN_FONT,
      size: enSize,
      colour: EN_COLOUR,
      outline: 2.5,
      shadow: 1,
      marginV: enMarginV,
    },
  ];

  // Only mixed documents reference MIX, so bilingual headers stay byte-for-byte unchanged.
  if (mode === 'mixed') {
    styles.push({
      name: 'MIX',
      font: ZH_FONT,
      size,
      colour: ZH_COLOUR,
      outline: 3,
      shadow: 1.5,
      marginV: zhMarginV,
      marginLR: 150,
    });
  }

  const renderable = cues
    .map((cue, index) => ({ cue: toRenderable(cue), index }))
    .filter(
      (entry): entry is { cue: RenderableCue; index: number } => entry.cue !== null,
    )
    .sort((a, b) =>
      a.cue.start === b.cue.start ? a.cue.end - b.cue.end : a.cue.start - b.cue.start,
    );

  const lines: string[] = [
    '[Script Info]',
    '; Bilingual subtitles generated by Glean IINA bridge',
    'Title: Glean Bilingual Subtitles',
    'ScriptType: v4.00+',
    'WrapStyle: ' + (mode === 'mixed' ? '0' : '2'),
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    'PlayResX: 1920',
    'PlayResY: 1080',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styles.map(buildStyleLine),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  for (const entry of renderable) {
    const cue = entry.cue;
    if (mode === 'mixed') {
      const source = cues[entry.index];
      const rawEn = typeof source?.textEn === 'string' ? source.textEn : '';
      const rawZh = typeof source?.textZh === 'string' ? source.textZh : '';
      const text = buildMixedText(runsAt(opts?.runs, entry.index), size, rawEn || rawZh);
      if (text) lines.push(dialogueLine(cue.start, cue.end, 'MIX', text));
      continue;
    }
    if (cue.textZh) lines.push(dialogueLine(cue.start, cue.end, 'ZH', cue.textZh));
    if (cue.textEn) lines.push(dialogueLine(cue.start, cue.end, 'EN', cue.textEn));
  }

  lines.push('');
  return lines.join('\n');
}
