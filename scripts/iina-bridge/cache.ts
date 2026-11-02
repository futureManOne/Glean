/**
 * On-disk cache for generated subtitle tracks.
 *
 * One cache entry is a pair of files keyed by a sha1 digest:
 *   `<key>.ass`  — the finished ASS document (what IINA pulls)
 *   `<key>.json` — `{ source, cues, runs, translated, meta }` (what `/api/cues?format=json`
 *                  and `/api/job` read, including the generation metadata)
 *
 * Both are written through a `.tmp` file plus `rename`, so a reader never sees a
 * half-written document and a crashed generator cannot leave a truncated ASS
 * behind. Cache misses are normal: they mean "start a background job".
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { MixedRun } from './mixedLayout';
import { isPlainObject, type CueOut } from './types';

export const CACHE_DIR = join(homedir(), '.glean-iina', 'cache');

/** Provenance of one cache entry; also the source of `/api/job`'s counters. */
export interface CacheMeta {
  /** Local (OpenList-mapped) path of the video, i.e. the key input minus the subtitle. */
  videoPath: string;
  mode: string;
  model: string;
  /** Cues completed by the generator (equals `total` once state is ready/failed). */
  done: number;
  /** Cues in the episode. */
  total: number;
  createdAt: number;
  /**
   * True when a language-model pass was *attempted* for this entry (an API key
   * was configured and the mode wanted the model). It deliberately does not mean
   * "the model succeeded": the generators degrade instead of throwing, so a
   * success flag would keep `/api/cues` upgrading a key forever — one full
   * generation per request. A key is model-refined at most once.
   */
  llmAttempted: boolean;
  /** True when the generator degraded: the entry holds the untranslated fallback. */
  failed: boolean;
  error?: string;
}

/** Everything `/api/cues?format=json` needs; `video` is added by the server on read. */
export interface CachedCues {
  source: { name: string; format: string } | null;
  cues: CueOut[];
  runs?: MixedRun[][];
  translated: boolean;
  meta: CacheMeta;
}

export interface CacheKeyParts {
  /** Normalized video path (OpenList path or absolute local path). */
  videoPath: string;
  /** Subtitle file identity: `mtime+size` for local files, `name+size` for remote ones. */
  subIdentity: string;
  mode: string;
  model: string;
  fontSize: number;
  targetLang: string;
}

function sha1(input: string): string {
  return createHash('sha1').update(input, 'utf8').digest('hex');
}

/**
 * `sha1(videoPath | subtitle mtime+size | mode | model | fontSize | targetLang)`.
 * Deliberately excludes `translate`/`format`: one entry serves both ASS and JSON,
 * and a `translate=0` entry is upgraded in place by a later `translate=1` request.
 */
export function cacheKeyFor(parts: CacheKeyParts): string {
  return sha1(
    [
      parts.videoPath,
      parts.subIdentity,
      parts.mode,
      (parts.model || '').trim(),
      String(parts.fontSize),
      parts.targetLang,
    ].join('|')
  );
}

/**
 * Identity of a subtitle file as a cache key input: `mtime:size`, so editing or
 * re-downloading the subtitle invalidates the entry. Missing/unreadable files fall
 * back to `absent`, which still keys deterministically.
 *
 * Async on purpose: this runs on the `/api/cues` path, and a `statSync` on a
 * cloud-mounted library can block the whole event loop for seconds. The mtime is
 * floored to whole seconds so a mount that reports sub-second attribute jitter
 * cannot invalidate the cache on every request.
 */
export async function localFileIdentity(path: string): Promise<string> {
  try {
    const info = await stat(path);
    return `${Math.floor(info.mtimeMs / 1000)}:${info.size}`;
  } catch {
    return 'absent';
  }
}

let tmpCounter = 0;

/** Write-then-rename so a concurrent reader sees either the old file or the new one. */
function atomicWrite(target: string, data: string): void {
  const tmp = `${target}.${process.pid}.${tmpCounter++}.tmp`;
  try {
    writeFileSync(tmp, data, 'utf8');
    renameSync(tmp, target);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // The temp file may not exist; the original error is the interesting one.
    }
    throw err;
  }
}

/** Cached ASS document, or `null` on a miss / unreadable entry. */
export function readCachedAss(key: string): string | null {
  try {
    const ass = readFileSync(join(CACHE_DIR, `${key}.ass`), 'utf8');
    return ass.trim() ? ass : null;
  } catch {
    return null;
  }
}

function normalizeCues(value: unknown): CueOut[] | null {
  if (!Array.isArray(value)) return null;
  const cues: CueOut[] = [];
  for (const item of value) {
    if (!isPlainObject(item)) return null;
    const start = item.start;
    const end = item.end;
    if (typeof start !== 'number' || typeof end !== 'number') return null;
    cues.push({
      start,
      end,
      textEn: typeof item.textEn === 'string' ? item.textEn : '',
      textZh: typeof item.textZh === 'string' ? item.textZh : '',
    });
  }
  return cues;
}

function normalizeRuns(value: unknown): MixedRun[][] | undefined {
  if (!Array.isArray(value)) return undefined;
  const runs: MixedRun[][] = [];
  for (const slot of value) {
    if (!Array.isArray(slot)) return undefined;
    const runList: MixedRun[] = [];
    for (const run of slot) {
      if (!isPlainObject(run)) return undefined;
      const text = typeof run.text === 'string' ? run.text : '';
      runList.push({ text, kind: run.kind === 'gloss' ? 'gloss' : 'text' });
    }
    runs.push(runList);
  }
  return runs;
}

function normalizeMeta(value: unknown): CacheMeta | null {
  if (!isPlainObject(value)) return null;
  const number = (raw: unknown): number => (typeof raw === 'number' && Number.isFinite(raw) ? raw : 0);
  return {
    videoPath: typeof value.videoPath === 'string' ? value.videoPath : '',
    mode: typeof value.mode === 'string' ? value.mode : '',
    model: typeof value.model === 'string' ? value.model : '',
    done: number(value.done),
    total: number(value.total),
    createdAt: number(value.createdAt),
    llmAttempted: value.llmAttempted === true,
    failed: value.failed === true,
    ...(typeof value.error === 'string' && value.error ? { error: value.error } : {}),
  };
}

/** Cached cue payload, or `null` on a miss / a document that fails validation. */
export function readCachedJson(key: string): CachedCues | null {
  let raw: string;
  try {
    raw = readFileSync(join(CACHE_DIR, `${key}.json`), 'utf8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;

  const cues = normalizeCues(parsed.cues);
  const meta = normalizeMeta(parsed.meta);
  if (!cues || !meta) return null;

  const source = isPlainObject(parsed.source)
    ? {
        name: typeof parsed.source.name === 'string' ? parsed.source.name : '',
        format: typeof parsed.source.format === 'string' ? parsed.source.format : '',
      }
    : null;
  const runs = normalizeRuns(parsed.runs);

  return {
    source,
    cues,
    ...(runs ? { runs } : {}),
    translated: parsed.translated === true,
    meta,
  };
}

/**
 * Persist one entry. `ass` and `json` are always written together because a
 * single generation produces both views; a partial write is impossible thanks to
 * the `.tmp` + rename dance.
 */
export function writeCache(key: string, entry: { ass: string; json: CachedCues }): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  atomicWrite(join(CACHE_DIR, `${key}.ass`), entry.ass);
  atomicWrite(join(CACHE_DIR, `${key}.json`), JSON.stringify(entry.json));
}
