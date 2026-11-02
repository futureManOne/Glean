/**
 * Stage-1 inline glosses for the bridge's non-blocking `/api/cues`.
 *
 * The full `mixed` track needs a model pass over every cue (~2 minutes for an
 * episode), which is far too slow to block the first response. This module
 * builds a *dictionary-only* approximation in pure memory — no network, no
 * store, no async — so the placeholder ASS that IINA receives on a cache miss
 * already shows real `（中文）` glosses. The background job then replaces it with
 * the model-refined track and the plugin swaps the track when `/api/job` flips
 * to `ready`.
 *
 * Deliberately simpler than `headlessMixedGloss`'s offline path: single content
 * words first, plus 2–3 word windows that exist verbatim in the local ECDICT, so
 * the whole episode renders in a few milliseconds.
 */

import { lookupLocalDict } from '@/core/dictionary/ecdictMini';
import { tokenizeSentence } from '@/core/subtitle/tokenizer';
import type { PhraseGlossItem } from '@/types';

/** Same ceiling as the model path: high density coverage (~80% words). */
const MAX_GLOSSES = 12;
/** A gloss must stay glanceable inside a subtitle line. */
const MAX_MEANING_CHARS = 8;
const MAX_WINDOW_WORDS = 3;

/**
 * Function words that must never be glossed alone. Local to this module so the
 * bridge keeps zero coupling to the app's stop-word tables.
 */
const STOP_WORDS: Record<string, true> = {
  a: true, an: true, the: true,
  i: true, you: true, he: true, she: true, it: true, we: true, they: true,
  me: true, him: true, her: true, us: true, them: true,
  my: true, your: true, his: true, its: true, our: true, their: true,
  is: true, am: true, are: true, was: true, were: true, be: true, been: true, being: true,
  do: true, does: true, did: true, done: true,
  have: true, has: true, had: true,
  will: true, would: true, shall: true, should: true, can: true, could: true, may: true, might: true, must: true,
  and: true, or: true, but: true, so: true, if: true, then: true, than: true, that: true, this: true,
  these: true, those: true, there: true, here: true, when: true, while: true, as: true,
  of: true, to: true, in: true, on: true, at: true, by: true, for: true, with: true, from: true,
  about: true, into: true, over: true, after: true, before: true, up: true, down: true, out: true,
  off: true, not: true, no: true, yes: true, oh: true, yeah: true, okay: true, well: true,
  just: true, too: true, very: true, also: true, now: true, what: true, who: true, how: true,
  why: true, where: true, which: true, all: true, any: true, some: true, more: true, most: true,
};

const WORD_SHAPE = /^[A-Za-z][A-Za-z'-]*$/;
const CJK = /[\u4e00-\u9fa5]/;
/** A window's source slice may only contain letters, spaces and inner punctuation. */
const WINDOW_SHAPE = /^[A-Za-z][A-Za-z'’ -]*$/;
/** The dictionary's "not found" marker — never a gloss. */
const UNKNOWN_MEANING = '暂无离线释义';
/** 4–5 star words are everyday vocabulary; annotating them is noise. */
const TOO_COMMON_COLLINS = 4;

/**
 * Meanings that are never useful inline: names, places, radio-alphabet words and
 * abbreviations. ECDICT files those as first senses ("Charlie" → 通讯中用以代表字),
 * and an inline gloss like that only adds noise to the subtitle line.
 */
const USELESS_MEANING = /(人名|地名|通讯中|用以代表字|缩写|简称|女子名|男子名)/;

/**
 * Short Chinese gloss for `rawWord`, or `''` when the word is unknown, too common
 * to be worth annotating, or carries no Chinese sense. Mirrors the app's own
 * "found in the local dictionary" test (skip the `暂无离线释义` placeholder).
 */
function glossFor(rawWord: string): string {
  const entry = lookupLocalDict(rawWord);
  if (entry.cefr === 'A1') return '';
  if (typeof entry.collins === 'number' && entry.collins >= TOO_COMMON_COLLINS) return '';

  const trans = entry.trans;
  if (typeof trans !== 'string' || !CJK.test(trans) || trans.startsWith(UNKNOWN_MEANING)) return '';
  for (const chunk of trans.split(/[;；,，、/]/)) {
    const match = chunk.match(/[\u4e00-\u9fa5][\u4e00-\u9fa5·（）()\s]*/);
    if (!match) continue;
    const sense = match[0].trim().slice(0, MAX_MEANING_CHARS);
    if (!sense) continue;
    if (USELESS_MEANING.test(sense)) return '';
    return sense;
  }
  return '';
}

interface WordSpan {
  text: string;
  start: number;
  end: number;
}

/**
 * Word tokens with absolute source offsets. `Intl.Segmenter` does not report
 * offsets, but tokens come back in source order, so a moving `indexOf` cursor
 * recovers them exactly — and slicing later gives verbatim phrases.
 */
function wordSpans(text: string): WordSpan[] {
  const spans: WordSpan[] = [];
  let cursor = 0;
  for (const token of tokenizeSentence(text)) {
    if (!token.isWord) continue;
    const start = text.indexOf(token.text, cursor);
    if (start < 0) continue;
    const end = start + token.text.length;
    cursor = end;
    spans.push({ text: token.text, start, end });
  }
  return spans;
}

/** Content words only: no single letters, no contractions, no function words, no bare names. */
function isContentSpan(span: WordSpan, text: string): boolean {
  const word = span.text;
  if (word.length < 2) return false;
  if (word.includes("'") || word.includes('’')) return false;
  if (!WORD_SHAPE.test(word)) return false;
  if (STOP_WORDS[word.toLowerCase()] === true) return false;
  return !looksLikeProperNoun(span, text);
}

const SENTENCE_START: Record<string, true> = { '.': true, '!': true, '?': true, ':': true, ';': true, '…': true, '¡': true, '¿': true };
const QUOTING: Record<string, true> = {
  '"': true, "'": true, '“': true, '”': true, '‘': true, '’': true, '(': true, '[': true, '-': true, '—': true,
};

/**
 * A capitalised word that is not at the start of a sentence is almost always a name
 * ("Charlie", "Monica"), and a dictionary gloss for it is noise — the stage-1 track
 * must stay readable, so those are dropped.
 */
function looksLikeProperNoun(span: WordSpan, text: string): boolean {
  if (!/^[A-Z][a-z]/.test(span.text)) return false;
  let index = span.start - 1;
  while (index >= 0) {
    const char = text[index];
    if (/\s/.test(char) || QUOTING[char] === true) {
      index -= 1;
      continue;
    }
    return SENTENCE_START[char] !== true;
  }
  return false;
}

interface Candidate {
  phrase: string;
  meaning: string;
  start: number;
  end: number;
}

/**
 * Inline glosses for every cue, index-aligned with the input (`[]` where a cue
 * has nothing worth annotating). Each `phrase` is a verbatim substring of the
 * cue text, which is what `buildMixedRuns` requires.
 */
export function fastGlossCues(cues: { textEn: string }[]): PhraseGlossItem[][] {
  return cues.map((cue) => {
    const text = typeof cue?.textEn === 'string' ? cue.textEn.trim() : '';
    if (!text || !/[A-Za-z]/.test(text)) return [];

    const spans = wordSpans(text).filter((span) => isContentSpan(span, text));
    const candidates: Candidate[] = [];

    for (let index = 0; index < spans.length; index++) {
      for (let size = MAX_WINDOW_WORDS; size >= 2; size--) {
        const group = spans.slice(index, index + size);
        if (group.length < size) continue;
        const phrase = text.slice(group[0].start, group[group.length - 1].end);
        if (!WINDOW_SHAPE.test(phrase)) continue;
        const meaning = glossFor(phrase);
        if (meaning) {
          candidates.push({ phrase, meaning, start: group[0].start, end: group[group.length - 1].end });
        }
      }
      const word = spans[index];
      const meaning = glossFor(word.text);
      if (meaning) candidates.push({ phrase: word.text, meaning, start: word.start, end: word.end });
    }
    if (candidates.length === 0) return [];

    // Longest phrase first, then left-to-right; skip anything overlapping.
    candidates.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
    const picked: Candidate[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (picked.length >= MAX_GLOSSES) break;
      const key = candidate.phrase.toLowerCase();
      if (seen.has(key)) continue;
      if (picked.some((chosen) => candidate.start < chosen.end && candidate.end > chosen.start)) continue;
      seen.add(key);
      picked.push(candidate);
    }

    picked.sort((a, b) => a.start - b.start);
    return picked.map(({ phrase, meaning }) => ({ phrase, meaning }));
  });
}
