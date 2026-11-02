/**
 * OpenList (aka AList) integration for the IINA bridge.
 *
 * Videos are served through OpenList's `/d/<path>` (direct) or `/p/<path>`
 * (share) endpoints; sibling subtitle files live in the same virtual directory.
 * Guest access is disabled on the target instance, so every API call carries the
 * configured token. Absolute filesystem paths and `file://` URLs are handled
 * locally instead of over HTTP.
 */

import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isPlainObject, type BridgeConfig, type SubtitleCandidate } from './types';

const REQUEST_TIMEOUT_MS = 8000;
const HEALTH_TIMEOUT_MS = 3000;
const LIST_PAGE_SIZE = 200;

const SUBTITLE_EXTS = ['.srt', '.vtt', '.ass', '.ssa', '.lrc', '.sub', '.ttml', '.xml', '.bcc', '.txt'];

interface OpenListEntry {
  name: string;
  size: number;
  is_dir: boolean;
}

interface PathParts {
  dir: string;
  name: string;
}

interface EpisodeRef {
  season?: number;
  episode: number;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function splitPath(path: string): PathParts {
  const normalized = path.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  if (slash < 0) return { dir: '/', name: normalized };
  const dir = slash === 0 ? '/' : normalized.slice(0, slash);
  return { dir, name: normalized.slice(slash + 1) };
}

function stripExtension(name: string): string {
  return name.replace(/\.[^./\\]+$/, '');
}

/**
 * Map a player URL onto an OpenList virtual path.
 * `http://host:5244/d/影视/剧集/S01E02.mkv?sign=…` → `/影视/剧集/S01E02.mkv`.
 * `file:///Users/me/a/b.mp4` and `/Users/me/a/b.mp4` return the local path.
 */
export function resolveOpenListPath(videoUrl: string): string | null {
  const raw = (videoUrl ?? '').trim();
  if (!raw) return null;

  if (raw.startsWith('file://')) {
    try {
      const decoded = safeDecode(new URL(raw).pathname);
      return decoded && decoded !== '/' ? decoded : null;
    } catch {
      return null;
    }
  }

  if (raw.startsWith('/') && !raw.startsWith('//')) {
    return raw.length > 1 ? raw : null;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const decoded = safeDecode(url.pathname);
  const stripped = decoded.replace(/^\/(?:d|p)\//, '/');
  if (!stripped || stripped === '/') return null;
  return stripped;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/** OpenList expects the bare token in `Authorization` (no `Bearer` prefix). */
export function authHeaders(cfg: BridgeConfig): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = cfg.openlist.token.trim();
  if (token) headers.Authorization = token;
  if (cfg.openlist.cookie) headers.Cookie = cfg.openlist.cookie;
  return headers;
}

function baseUrlOf(cfg: BridgeConfig): string {
  return cfg.openlist.baseUrl.replace(/\/+$/, '');
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    const reason = controller.signal.aborted
      ? `timed out after ${timeoutMs}ms`
      : err instanceof Error
        ? err.message
        : String(err);
    throw new Error(`OpenList request failed (${url}): ${reason}`);
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(res: Response, label: string): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`OpenList ${label} returned invalid JSON (HTTP ${res.status})`);
  }
}

function openListError(label: string, payload: unknown): Error {
  const message = isPlainObject(payload) && typeof payload.message === 'string' ? payload.message : 'unknown error';
  const code = isPlainObject(payload) && typeof payload.code === 'number' ? payload.code : -1;
  return new Error(`OpenList ${label} failed (${code}): ${message}`);
}

function parseListPayload(payload: unknown): OpenListEntry[] {
  if (!isPlainObject(payload)) throw new Error('OpenList /api/fs/list returned an unexpected payload');
  if (payload.code !== 200) throw openListError('/api/fs/list', payload);

  const data = isPlainObject(payload.data) ? payload.data : {};
  const content = Array.isArray(data.content) ? data.content : [];
  const entries: OpenListEntry[] = [];
  for (const item of content) {
    if (!isPlainObject(item)) continue;
    const name = typeof item.name === 'string' ? item.name : '';
    if (!name) continue;
    entries.push({
      name,
      size: typeof item.size === 'number' ? item.size : 0,
      is_dir: item.is_dir === true,
    });
  }
  return entries;
}

async function apiList(dir: string, cfg: BridgeConfig): Promise<OpenListEntry[]> {
  const res = await fetchWithTimeout(`${baseUrlOf(cfg)}/api/fs/list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(cfg) },
    body: JSON.stringify({ path: dir, page: 1, per_page: LIST_PAGE_SIZE, refresh: false }),
  });
  const payload = await readJson(res, '/api/fs/list');
  if (!res.ok) throw openListError(`/api/fs/list (HTTP ${res.status})`, payload);
  return parseListPayload(payload);
}

interface FileInfo {
  rawUrl: string | null;
  sign: string | null;
  headers: Record<string, string>;
}

/**
 * Resolve a download target through `/api/fs/get`.
 * The endpoint returns `raw_url` plus a `sign` that must accompany it on
 * instances with signed downloads enabled.
 */
async function apiFileInfo(targetPath: string, cfg: BridgeConfig): Promise<FileInfo> {
  const res = await fetchWithTimeout(`${baseUrlOf(cfg)}/api/fs/get`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(cfg) },
    body: JSON.stringify({ path: targetPath, password: '' }),
  });
  const payload = await readJson(res, '/api/fs/get');
  if (!res.ok) throw openListError(`/api/fs/get (HTTP ${res.status})`, payload);
  if (!isPlainObject(payload) || payload.code !== 200) throw openListError('/api/fs/get', payload);

  const data = isPlainObject(payload.data) ? payload.data : {};
  const headers: Record<string, string> = {};
  if (isPlainObject(data.header)) {
    for (const [key, value] of Object.entries(data.header)) {
      if (typeof value === 'string' && value) headers[key] = value;
    }
  }

  const rawUrl =
    typeof data.raw_url === 'string' && data.raw_url
      ? data.raw_url
      : typeof data.url === 'string' && data.url
        ? data.url
        : null;

  return {
    rawUrl,
    sign: typeof data.sign === 'string' && data.sign ? data.sign : null,
    headers,
  };
}

/**
 * Reachability probe: OpenList counts as reachable only when `/api/fs/list`
 * actually succeeds. Guest access is disabled on the target instance, so a
 * missing or invalid token must report `false` rather than a bare 401 answer.
 */
export async function isOpenListReachable(cfg: BridgeConfig): Promise<boolean> {
  if (!cfg.openlist.token) return false;
  try {
    const res = await fetchWithTimeout(
      `${baseUrlOf(cfg)}/api/fs/list`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(cfg) },
        body: JSON.stringify({ path: '/', page: 1, per_page: 1 }),
      },
      HEALTH_TIMEOUT_MS
    );
    const payload = await readJson(res, '/api/fs/list');
    return res.ok && isPlainObject(payload) && payload.code === 200;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Local filesystem fallback
// ---------------------------------------------------------------------------

function localDirEntries(dir: string): OpenListEntry[] | null {
  try {
    if (!dir || !statSync(dir).isDirectory()) return null;
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const full = join(dir, entry.name);
        let size = 0;
        try {
          size = statSync(full).size;
        } catch {
          size = 0;
        }
        return { name: entry.name, size, is_dir: false };
      });
  } catch {
    return null;
  }
}

function localFileBytes(targetPath: string): Uint8Array | null {
  try {
    if (!targetPath || !statSync(targetPath).isFile()) return null;
    return new Uint8Array(readFileSync(targetPath));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Subtitle matching
// ---------------------------------------------------------------------------

const NOISE_NUMBERS = [480, 720, 1080, 2160];

function isNoiseNumber(value: number): boolean {
  if (value >= 1900 && value <= 2099) return true;
  return NOISE_NUMBERS.includes(value);
}

/** Loose season/episode extraction, mirroring `extractEpisodeNumber` in quarkSubtitleSniffer. */
function extractEpisode(text: string): EpisodeRef | null {
  const lower = text.toLowerCase();

  const seasonEpisode = lower.match(/s(\d{1,2})[ ._-]*e(\d{1,4})/);
  if (seasonEpisode) return { season: Number(seasonEpisode[1]), episode: Number(seasonEpisode[2]) };

  const cross = lower.match(/(?:^|[^a-z0-9])(\d{1,2})x(\d{1,4})(?:[^a-z0-9]|$)/);
  if (cross) return { season: Number(cross[1]), episode: Number(cross[2]) };

  const zhEpisode = lower.match(/第\s*(\d{1,4})\s*[集话期]/);
  if (zhEpisode) return { episode: Number(zhEpisode[1]) };

  const prefixed = lower.match(/(?:^|[^a-z0-9])(?:ep|e|episode)[ ._-]*(\d{1,4})(?:[^a-z0-9]|$)/);
  if (prefixed) return { episode: Number(prefixed[1]) };

  const suffixed = lower.match(/(?:^|[^a-z0-9])(\d{1,4})\s*[集话期]/);
  if (suffixed) return { episode: Number(suffixed[1]) };

  const bracketed = lower.match(/[[【(（]\s*(\d{1,4})\s*[\]】)）]/);
  if (bracketed && !isNoiseNumber(Number(bracketed[1]))) return { episode: Number(bracketed[1]) };

  const delimited = lower.match(/(?:^|[\s._-])(\d{1,4})(?=[\s._-]|$)/);
  if (delimited && !isNoiseNumber(Number(delimited[1]))) return { episode: Number(delimited[1]) };

  return null;
}

function titleTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((token) => token.length >= 2 && !/^\d+$/.test(token));
}

function qualityBonus(lowerName: string): number {
  let bonus = 0;
  if (/双语|中英|bilingual|chs[&.\s]?eng|zh[&.\s]?en/.test(lowerName)) bonus += 10;
  else if (/chs|cht|简中|繁中|中文/.test(lowerName)) bonus += 5;

  if (lowerName.endsWith('.ass') || lowerName.endsWith('.ssa')) bonus += 6;
  else if (lowerName.endsWith('.srt')) bonus += 4;
  else if (lowerName.endsWith('.vtt')) bonus += 2;
  return bonus;
}

// ---------------------------------------------------------------------------
// Source-language detection
// ---------------------------------------------------------------------------

const PROBE_BYTES = 4096;
const PROBE_LIMIT = 6;
const PROBE_TIMEOUT_MS = 1200;
/** Total time the language sniff may spend on I/O, so callers never wait. */
const PROBE_BUDGET_MS = 900;

/** Best source: Chinese + English on alternating lines, needs no model calls. */
const BILINGUAL_SCORE = 100;
const EN_CONTENT_BONUS = 40;
const ZH_CONTENT_PENALTY = -20;
const EN_NAME_BONUS = 10;
const ZH_NAME_PENALTY = -5;
/** Widest bonus the content sniff can apply, used to stop scanning early. */
const MAX_CONTENT_SCORE = BILINGUAL_SCORE;

/** `HHLGB S01E15-EN.srt`, `show.en.srt`, `show_english.vtt`, `剧集 英文.srt`. */
const EN_NAME_MARKER = /(?:^|[\s._-])(?:en|eng|english)(?=$|[\s._-])|英文/;
/** `show.zh.srt`, `show_zh-Hans.srt`, `show.chs.srt`, `剧集 简体.srt`. */
const ZH_NAME_MARKER =
  /(?:^|[\s._-])(?:zh|zh-?(?:cn|tw|hk|hans|hant)|chs|cht|chinese)(?=$|[\s._-])|中文|简体|繁体|简中|繁中/;

const ASS_OVERRIDE_TAG = /\{[^}]*\}/g;
const ASS_DIALOGUE_PREFIX = /^\s*dialogue\s*:\s*(?:[^,]*,){9}/i;
const TIMESTAMP_LINE = /^\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/;
const SRT_INDEX_LINE = /^\s*\d+\s*$/;
/** Non-cue lines: WebVTT blocks and ASS/SRT section headers. */
const CONTAINER_HEADER = /^\s*(?:WEBVTT|NOTE\s*$|\[[^\]]*\])/;

/**
 * Language classification per file, keyed by path and size. Survives OS page
 * cache eviction, so replays and plugin polling never re-read the same 4 KB.
 */
const languageCache = new Map<string, number>();
const LANGUAGE_CACHE_LIMIT = 512;

/** Language signalled by the file name itself, or `null` when it carries no marker. */
function nameLanguageScore(subFileName: string): number | null {
  const base = stripExtension(subFileName).toLowerCase();
  if (EN_NAME_MARKER.test(base)) return EN_NAME_BONUS;
  if (ZH_NAME_MARKER.test(base)) return ZH_NAME_PENALTY;
  return null;
}

/** First `limit` bytes of a local file (never reads the whole file). */
function localHeadBytes(targetPath: string, limit: number = PROBE_BYTES): Uint8Array | null {
  let fd: number | null = null;
  try {
    if (!targetPath || !statSync(targetPath).isFile()) return null;
    fd = openSync(targetPath, 'r');
    const buffer = Buffer.allocUnsafe(limit);
    const read = readSync(fd, buffer, 0, limit, 0);
    return new Uint8Array(buffer.subarray(0, read));
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * First `PROBE_BYTES` of a remote subtitle. Signed instances reject the bare
 * `/d/` path, so the URL comes from `/api/fs/get` exactly like a full download.
 */
async function remoteHeadBytes(targetPath: string, cfg: BridgeConfig): Promise<Uint8Array | null> {
  const base = baseUrlOf(cfg);
  const encodedPath = targetPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const range: Record<string, string> = { Range: `bytes=0-${PROBE_BYTES - 1}` };

  const attempts: Array<{ url: string; headers: Record<string, string> }> = [];
  try {
    const info = await apiFileInfo(targetPath, cfg);
    if (info.sign) {
      const signQuery = `?sign=${encodeURIComponent(info.sign)}`;
      attempts.push({
        url: `${base}/d${encodedPath}${signQuery}`,
        headers: { ...info.headers, ...authHeaders(cfg), ...range },
      });
    }
    if (info.rawUrl) {
      const rawAbsolute = info.rawUrl.startsWith('http') ? info.rawUrl : `${base}${info.rawUrl}`;
      const separator = rawAbsolute.includes('?') ? '&' : '?';
      attempts.push({
        url: info.sign ? `${rawAbsolute}${separator}sign=${encodeURIComponent(info.sign)}` : rawAbsolute,
        headers: { ...info.headers, ...range },
      });
    }
  } catch {
    /* unreachable or unknown path: fall through to the unsigned attempt */
  }
  attempts.push({ url: `${base}/d${encodedPath}`, headers: { ...authHeaders(cfg), ...range } });

  for (const attempt of attempts) {
    try {
      const res = await fetchWithTimeout(attempt.url, { headers: attempt.headers }, PROBE_TIMEOUT_MS);
      if (!res.ok) continue;
      const body = new Uint8Array(await res.arrayBuffer());
      return body.subarray(0, PROBE_BYTES);
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Classify a subtitle head: bilingual (Chinese and English cue lines), English
 * only, or Chinese only. Shares are taken over letter-like characters so
 * timestamps, arrows, indices and markup cannot skew a 4 KB sample.
 */
function contentLanguageScore(bytes: Uint8Array | null): number {
  if (!bytes || bytes.length === 0) return 0;

  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const rawLines = text.split(/\r?\n/);
  // `.ass`/`.ssa` heads are mostly style sheets; only the dialogue lines matter.
  const dialogues = rawLines.filter((line) => /^\s*dialogue\s*:/i.test(line));
  const lines = dialogues.length > 0 ? dialogues : rawLines;

  let latinChars = 0;
  let cjkChars = 0;
  let latinLines = 0;
  let cjkLines = 0;

  for (const raw of lines) {
    const line = raw.replace(ASS_DIALOGUE_PREFIX, '').replace(ASS_OVERRIDE_TAG, '');
    if (!line.trim()) continue;
    if (TIMESTAMP_LINE.test(line) || SRT_INDEX_LINE.test(line) || CONTAINER_HEADER.test(line)) continue;

    let latin = 0;
    let cjk = 0;
    for (const char of line) {
      const code = char.codePointAt(0) ?? 0;
      if (code < 0x80) {
        if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) latin += 1;
      } else if (
        (code >= 0x3400 && code <= 0x4dbf) ||
        (code >= 0x4e00 && code <= 0x9fff) ||
        (code >= 0xf900 && code <= 0xfaff)
      ) {
        cjk += 1;
      }
    }
    latinChars += latin;
    cjkChars += cjk;
    if (latin > 0) latinLines += 1;
    if (cjk > 0) cjkLines += 1;
  }

  const totalChars = latinChars + cjkChars;
  if (totalChars < 40) return 0;

  const cjkShare = cjkChars / totalChars;
  // Paired libraries ship a file carrying BOTH languages; it is the best source
  // because it renders without a single model call.
  if (cjkLines > 0 && latinLines > 0 && cjkShare > 0.05 && cjkShare < 0.95) return BILINGUAL_SCORE;
  if (cjkShare <= 0.05) return EN_CONTENT_BONUS;
  if (cjkShare >= 0.95) return ZH_CONTENT_PENALTY;
  return 0;
}

/**
 * Similarity score for a subtitle file against the video basename.
 * Exact basename 100, containment 60, matching episode +40 (conflicting -25),
 * shared title tokens +5 each (max 25), plus codec/language quality bonuses.
 */
export function scoreSubtitle(videoBaseName: string, subFileName: string): number {
  const video = videoBaseName.toLowerCase().trim();
  const sub = stripExtension(subFileName).toLowerCase().trim();
  let score = 0;

  if (video && sub === video) score += 100;
  else if (video && sub && (sub.includes(video) || video.includes(sub))) score += 60;

  const videoEpisode = extractEpisode(video);
  const subEpisode = extractEpisode(sub);
  if (videoEpisode && subEpisode) {
    if (videoEpisode.episode === subEpisode.episode) score += 40;
    else score -= 25;
    if (videoEpisode.season !== undefined && subEpisode.season !== undefined) {
      if (videoEpisode.season === subEpisode.season) score += 10;
      else score -= 20;
    }
  }

  const tokens = titleTokens(video);
  if (tokens.length > 0) {
    let hits = 0;
    for (const token of tokens) if (sub.includes(token)) hits += 1;
    score += Math.min(hits, 5) * 5;
  }

  return score + qualityBonus(sub);
}

/**
 * List subtitle files that sit next to the video, best match first.
 * Falls back to a local directory scan when the OpenList call fails but the
 * path happens to exist on disk (local playback).
 */
export async function listSiblingSubtitles(openlistPath: string, cfg: BridgeConfig): Promise<SubtitleCandidate[]> {
  const { dir, name } = splitPath(openlistPath);
  const videoBase = stripExtension(name);

  let entries: OpenListEntry[];
  const local = localDirEntries(dir);
  if (local && local.length > 0) {
    entries = local;
  } else {
    try {
      entries = await apiList(dir, cfg);
    } catch (err) {
      if (!local) throw err;
      entries = local;
    }
  }

  const candidates = entries
    .filter((entry) => {
      if (entry.is_dir) return false;
      const lower = entry.name.toLowerCase();
      return SUBTITLE_EXTS.some((ext) => lower.endsWith(ext));
    })
    .map((entry) => ({
      name: entry.name,
      size: entry.size,
      format: entry.name.match(/\.([^./\\]+)$/)?.[1].toLowerCase() ?? '',
      score: scoreSubtitle(videoBase, entry.name),
    }))
    .sort((a, b) => b.score - a.score);

  // Source language decides which file to read: a bilingual subtitle renders
  // without a single model call, an English-only one needs translation, and a
  // Chinese-only one is useless as the English source. Filename marks are free,
  // so every candidate gets them; only the strongest candidates are then
  // sniffed in base order, stopping as soon as no remaining file can catch up.
  for (const candidate of candidates) {
    candidate.score += nameLanguageScore(candidate.name) ?? 0;
  }
  candidates.sort((a, b) => b.score - a.score);

  const probeDeadline = Date.now() + PROBE_BUDGET_MS;
  let bestSettled = Number.NEGATIVE_INFINITY;
  let probed = 0;
  for (const candidate of candidates) {
    if (probed >= PROBE_LIMIT || candidate.score + MAX_CONTENT_SCORE < bestSettled) break;
    if (probed > 0 && Date.now() > probeDeadline) break;
    probed += 1;
    const path = join(dir, candidate.name);
    const cacheKey = `${path}|${candidate.size}`;
    const cached = languageCache.get(cacheKey);
    if (cached !== undefined) {
      candidate.score += cached;
    } else {
      const content = contentLanguageScore(localHeadBytes(path) ?? (await remoteHeadBytes(path, cfg)));
      if (languageCache.size >= LANGUAGE_CACHE_LIMIT) languageCache.clear();
      languageCache.set(cacheKey, content);
      candidate.score += content;
    }
    if (candidate.score > bestSettled) bestSettled = candidate.score;
  }

  const videoLower = videoBase.toLowerCase().trim();
  return candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const exactDelta =
      (stripExtension(b.name).toLowerCase().trim() === videoLower ? 1 : 0) -
      (stripExtension(a.name).toLowerCase().trim() === videoLower ? 1 : 0);
    return exactDelta || a.name.localeCompare(b.name);
  });
}

/**
 * Download a subtitle file's raw bytes.
 * Tries the direct `/d/<path>` endpoint first, then resolves a signed URL via
 * `/api/fs/get`. Local files are read from disk.
 */
export async function downloadSubtitle(
  openlistPath: string,
  name: string,
  cfg: BridgeConfig
): Promise<Uint8Array> {
  const { dir } = splitPath(openlistPath);
  const fileName = splitPath(name).name;
  if (!fileName) throw new Error('Invalid subtitle file name');

  const targetPath = `${dir === '/' ? '' : dir}/${fileName}`;

  const local = localFileBytes(targetPath);
  if (local) return local;

  const base = baseUrlOf(cfg);
  const encodedPath = targetPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const directRes = await fetchWithTimeout(`${base}/d${encodedPath}`, {
    headers: authHeaders(cfg),
  });
  if (directRes.ok) return new Uint8Array(await directRes.arrayBuffer());

  let info: FileInfo;
  try {
    info = await apiFileInfo(targetPath, cfg);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`OpenList subtitle download failed (direct HTTP ${directRes.status}); ${detail}`);
  }

  // Signed instances reject the bare /d/ path, so every attempt below carries
  // the signature from /api/fs/get.
  const signedPath = info.sign ? `?sign=${encodeURIComponent(info.sign)}` : '';
  const attempts: Array<{ url: string; headers: Record<string, string> }> = [];
  if (info.sign) {
    attempts.push({ url: `${base}/d${encodedPath}${signedPath}`, headers: { ...info.headers, ...authHeaders(cfg) } });
  }
  if (info.rawUrl) {
    const rawAbsolute = info.rawUrl.startsWith('http') ? info.rawUrl : `${base}${info.rawUrl}`;
    attempts.push({ url: rawAbsolute, headers: info.headers });
    if (info.sign) {
      const separator = rawAbsolute.includes('?') ? '&' : '?';
      attempts.push({
        url: `${rawAbsolute}${separator}sign=${encodeURIComponent(info.sign)}`,
        headers: { ...info.headers, ...authHeaders(cfg) },
      });
    }
  }
  if (attempts.length === 0) {
    throw new Error(`OpenList did not return a download URL for "${fileName}" (direct HTTP ${directRes.status})`);
  }

  const failures = [`direct HTTP ${directRes.status}`];
  for (const attempt of attempts) {
    const res = await fetchWithTimeout(attempt.url, { headers: attempt.headers });
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
    failures.push(`HTTP ${res.status}`);
  }
  throw new Error(`OpenList subtitle download failed for "${fileName}": ${failures.join(', ')}`);
}
