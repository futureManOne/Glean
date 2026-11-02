/**
 * Inline word-mix layout for Glean's IINA bridge.
 *
 * Splits one English cue into an alternating run sequence so the ASS writer can
 * render a single line such as
 *
 *   bright（明亮） it's currently（目前/现在） 557
 *
 * as plain English at full size with the glosses in smaller warm type.
 *
 * The hard invariant: concatenating every `kind === 'text'` run reproduces the
 * input sentence character for character — the layout only ever *inserts*
 * glosses, it never rewrites, trims or re-punctuates the English.
 */
import type { PhraseGlossItem } from '../../src/types';
import { isPlainObject } from './types';

export interface MixedRun {
  text: string;
  kind: 'text' | 'gloss';
  /** The English slice that the following gloss explains — rendered in an accent colour. */
  highlight?: boolean;
}

export interface MixedLayoutOptions {
  /** Upper bound on inline glosses per cue; defaults to 5. */
  maxGlosses?: number;
}

/** Glosses per line: high density coverage (~80% words). */
const DEFAULT_MAX_GLOSSES = 15;
/** Long dictionary-style meanings overflow the line; the prompt already asks for terse ones. */
const MAX_MEANING_LENGTH = 40;
/** Apostrophe variants are normalised before matching; each is one code unit, so offsets survive. */
const APOSTROPHE_VARIANTS = /[’‘ʼʻ`]/g;

interface GlossSpan {
  start: number;
  end: number;
  meaning: string;
}

interface PhraseCandidate {
  pattern: RegExp;
  meaning: string;
  wordCount: number;
  length: number;
}

/**
 * Compiles one phrase into a case-insensitive, word-boundary pattern.
 *
 * The phrase is matched literally (every regex metacharacter is escaped), then
 * the separators a transcript may spell differently are widened: runs of spaces
 * match each other, quote variants match each other, and hyphens / dashes /
 * underscores / dots collapse into one optional separator run so "well-known"
 * still finds "well known".
 */
function buildPhrasePattern(phrase: string): RegExp | null {
  const normalised = phrase.trim().replace(APOSTROPHE_VARIANTS, "'");
  if (normalised.length === 0) return null;

  const body = normalised
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '[\\s\\u00A0]+')
    .replace(/'/g, "['’‘ʼʻ`]")
    .replace(/[-–—_]|\\\./g, '[\\s\\u00A0\\-–—._]*');

  // Lookarounds rather than `\b`: phrases ending in punctuation or apostrophes
  // ("it's", "Mr.") break plain word boundaries.
  const wordChar = /[\p{L}\p{N}]/u;
  const lead = wordChar.test(normalised[0]) ? "(?<![\\p{L}\\p{N}'])" : '';
  const tail = wordChar.test(normalised[normalised.length - 1]) ? "(?![\\p{L}\\p{N}'])" : '';

  try {
    return new RegExp(`${lead}${body}${tail}`, 'giu');
  } catch {
    // Defensive: a corrupted phrase must never take down the whole cue.
    return null;
  }
}

/** Strips decorative brackets the model sometimes wraps meanings in, then clamps length. */
function normaliseMeaning(meaning: string): string {
  return meaning
    .trim()
    .replace(/^[（(【\[「『]+/, '')
    .replace(/[）)】\]」』]+$/, '')
    .trim()
    .slice(0, MAX_MEANING_LENGTH)
    .trim();
}

function resolveMaxGlosses(opts?: MixedLayoutOptions): number {
  const raw = opts?.maxGlosses;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_MAX_GLOSSES;
  return Math.max(0, Math.floor(raw));
}

/** Builds the pattern/priority list, dropping anything that cannot produce a gloss. */
function collectCandidates(phrases: unknown): PhraseCandidate[] {
  if (!Array.isArray(phrases)) return [];
  const candidates: PhraseCandidate[] = [];

  for (const raw of phrases as unknown[]) {
    if (!isPlainObject(raw)) continue;
    const phraseText = raw.phrase;
    const meaningText = raw.meaning;
    if (typeof phraseText !== 'string' || typeof meaningText !== 'string') continue;

    const meaning = normaliseMeaning(meaningText);
    if (!meaning) continue;

    const words = phraseText.replace(APOSTROPHE_VARIANTS, "'").match(/[\p{L}\p{N}][\p{L}\p{N}']*/gu) ?? [];
    if (words.length === 0) continue;

    const pattern = buildPhrasePattern(phraseText);
    if (!pattern) continue;

    candidates.push({ pattern, meaning, wordCount: words.length, length: phraseText.trim().length });
  }

  // Longer phrases first so "good husband" wins over a bare "husband",
  // and any cap trims the least informative glosses.
  candidates.sort((a, b) => (b.wordCount - a.wordCount) || (b.length - a.length));
  return candidates;
}

/**
 * Picks at most `maxGlosses` non-overlapping occurrences — one per phrase, first
 * free occurrence wins — and returns them ordered by position in the sentence.
 */
function collectSpans(textEn: string, phrases: unknown, maxGlosses: number): GlossSpan[] {
  if (maxGlosses <= 0) return [];
  const haystack = textEn.replace(APOSTROPHE_VARIANTS, "'");
  const spans: GlossSpan[] = [];

  for (const candidate of collectCandidates(phrases)) {
    if (spans.length >= maxGlosses) break;
    const pattern = candidate.pattern;
    pattern.lastIndex = 0;

    let match = pattern.exec(haystack);
    while (match !== null) {
      const start = match.index;
      const end = start + match[0].length;
      const clash = spans.some(span => start < span.end && span.start < end);
      if (end > start && !clash) {
        spans.push({ start, end, meaning: candidate.meaning });
        break;
      }
      // Zero-length matches would spin forever; step past them.
      if (match[0].length === 0) pattern.lastIndex += 1;
      match = pattern.exec(haystack);
    }
  }

  return spans.sort((a, b) => a.start - b.start);
}

/**
 * Walks the sentence, emitting text slices and `（meaning）` glosses in between.
 * Each gloss is appended right after the phrase it explains — the English of
 * that phrase stays in the preceding text run, so the text runs still spell out
 * the whole sentence.
 */
function interleave(textEn: string, spans: GlossSpan[]): MixedRun[] {
  const runs: MixedRun[] = [];
  let cursor = 0;

  for (const span of spans) {
    if (span.start > cursor) {
      runs.push({ text: textEn.slice(cursor, span.start), kind: 'text' });
    }
    // The explained English itself is highlighted (teal) so the eye can pair it
    // with the （中文） that follows, exactly like the web extension does.
    runs.push({ text: textEn.slice(span.start, span.end), kind: 'text', highlight: true });
    runs.push({ text: `（${span.meaning}）`, kind: 'gloss' });
    cursor = span.end;
  }

  if (cursor < textEn.length) {
    runs.push({ text: textEn.slice(cursor), kind: 'text' });
  }

  return runs;
}

/** Invariant check: the visible English must survive the layout untouched. */
function preservesText(runs: MixedRun[], textEn: string): boolean {
  let rebuilt = '';
  for (const run of runs) {
    if (run.kind === 'text') rebuilt += run.text;
  }
  return rebuilt === textEn;
}

/**
 * Converts `phrases` found inside `textEn` into inline gloss runs.
 *
 * Every run carries either a slice of the original sentence or a
 * self-bracketed `（中文）` gloss, so the ASS writer only has to style each
 * run and concatenate. Unmatched phrases are dropped; a cue with no usable
 * phrase degrades to a single plain text run.
 */
export function buildMixedRuns(
  textEn: string,
  phrases: PhraseGlossItem[],
  opts?: MixedLayoutOptions
): MixedRun[] {
  if (typeof textEn !== 'string' || textEn.length === 0) return [];

  const spans = collectSpans(textEn, phrases, resolveMaxGlosses(opts));
  if (spans.length === 0) return [{ text: textEn, kind: 'text' }];

  const runs = interleave(textEn, spans);
  // Never emit a lossy layout: fall back to the untouched sentence.
  return preservesText(runs, textEn) ? runs : [{ text: textEn, kind: 'text' }];
}
