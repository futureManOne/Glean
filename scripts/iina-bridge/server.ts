/**
 * Glean ↔ IINA local bridge server.
 *
 * Serves the endpoints the IINA plugin talks to, turning subtitle files
 * (sibling files from OpenList, or an explicit `sub=` path/URL) into native ASS
 * tracks with optional AI refinement.
 *
 * `/api/cues` never waits for the model. A cache miss answers immediately with a
 * *stage-1* track — dictionary-only inline glosses built in memory — tagged
 * `X-Glean-State: pending`, while a background job produces the model-refined
 * track and writes `~/.glean-iina/cache/` (two files per entry, `.ass` + `.json`).
 * The plugin polls `/api/job` and swaps the track once the state settles, so no
 * IINA HTTP timeout can abort a two-minute generation any more.
 *
 * Run as a long-lived process: `bun run scripts/iina-bridge/server.ts`
 */

import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { parseSubtitleContent } from '@/core/subtitle/parser';
import { translateCuesHeadless } from '@/core/ai/headlessTranslator';
import { glossCuesHeadless } from '@/core/ai/headlessMixedGloss';
import { lookupLocalDict } from '@/core/dictionary/ecdictMini';
import {
  CACHE_DIR,
  cacheKeyFor,
  localFileIdentity,
  readCachedAss,
  readCachedJson,
  writeCache,
  type CachedCues,
  type CacheMeta,
} from './cache';
import { CONFIG_PATH, loadConfig } from './config';
import { fastGlossCues } from './fastGloss';
import { jobStatus, startJob, type JobReport } from './jobs';
import {
  authHeaders,
  downloadSubtitle,
  isOpenListReachable,
  listSiblingSubtitles,
  resolveOpenListPath,
  scoreSubtitle,
} from './openlist';
import { cuesToAss } from './assWriter';
import { buildMixedRuns, type MixedRun } from './mixedLayout';
import {
  applyConsoleChange,
  cacheUsage,
  clearCache,
  consoleHtml,
  readChange,
  type ConsoleStatus,
} from './console';
import { isPlainObject, type CueOut, type SubtitleCandidate } from './types';

const BRIDGE_VERSION = '1.0.0';
const FETCH_TIMEOUT_MS = 8000;

/**
 * How long `/api/cues` may spend resolving the subtitle source before it answers
 * with a placeholder and lets the work continue in the background. A cloud-mounted
 * library can take seconds to list one directory on the first touch; the response
 * must not.
 */
// Cap on waiting for the subtitle source (readdir/stat/read + parse) before answering with a
// placeholder. A cold cloud mount (夸克 CloudDrive) took 1.5–5 s just to stat and read one
// subtitle, so the old 800 ms budget answered with a zero-Dialogue track — the exact "no
// subtitles at all" symptom we are fixing. IINA's own HTTP timeout is ~40 s, so we can afford
// to wait for the real file; only the model pass has to stay in the background.
const STAGE1_DEADLINE_MS = 12000;

/** How long a failed entry is served as-is before a request retries generation. */
const FAILED_RETRY_MS = 60_000;

/** Resolved request shapes kept in memory so repeat requests skip resolution. */
const MAX_PREPARED = 16;

/**
 * Subtitle rendering mode. `bilingual` stacks EN over ZH (two Dialogue lines per
 * cue); `mixed` renders one line of EN with inline `（中文）` glosses after the
 * key phrases. Not part of `BridgeConfig` because config.json is only partially
 * loaded — it is read here with a local guard so an absent field stays valid.
 */
type SubtitleMode = 'bilingual' | 'mixed';

/** Generation state shipped back as `X-Glean-State` (and in JSON bodies). */
type GleanState = 'pending' | 'ready' | 'failed' | 'disabled';

const DEFAULT_SUBTITLE_MODE: SubtitleMode = 'bilingual';

const cfg = loadConfig();

/**
 * Both headless generators accept an optional progress hook. Declared here as a
 * spread-in shape so this file compiles against either version of their config
 * interfaces, and passes `done` only — the bridge owns `total` (cue units).
 */
interface ProgressHook {
  onProgress?: (done: number, total: number) => void;
}

function isSubtitleMode(value: unknown): value is SubtitleMode {
  return value === 'bilingual' || value === 'mixed';
}

/** `subtitleMode` in config.json, tolerating a missing field or a wrong type. */
function configSubtitleMode(): SubtitleMode {
  try {
    const parsed: unknown = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    if (!isPlainObject(parsed)) return DEFAULT_SUBTITLE_MODE;
    return isSubtitleMode(parsed.subtitleMode) ? parsed.subtitleMode : DEFAULT_SUBTITLE_MODE;
  } catch {
    return DEFAULT_SUBTITLE_MODE;
  }
}

/**
 * Priority: `mode` query param > config.json > 'bilingual'; an invalid value means
 * bilingual. `/api/job` reuses this so the polled key matches `/api/cues` even
 * when the plugin omits `mode` (its `auto` mode).
 */
function resolveSubtitleMode(url: URL): SubtitleMode {
  const raw = url.searchParams.get('mode');
  const requested = raw === null ? '' : raw.trim();
  if (!requested) return configSubtitleMode();
  return isSubtitleMode(requested) ? requested : DEFAULT_SUBTITLE_MODE;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const EXPOSED_HEADERS = 'X-Glean-State';

function corsHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': EXPOSED_HEADERS,
    ...extra,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8' }),
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ ok: false, error: message }, status);
}

/** The console page itself: no CORS needed, and never cached so a code change shows up. */
function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function extensionOf(name: string): string {
  const match = name.match(/\.([^./\\]+)$/);
  return match ? match[1].toLowerCase() : '';
}

function fileNameOf(raw: string): string {
  const withoutQuery = raw.split('?')[0].split('#')[0].replace(/[\\/]+$/, '');
  const segment = withoutQuery.split(/[\\/]/).pop() ?? '';
  try {
    return decodeURIComponent(segment) || 'subtitle';
  } catch {
    return segment || 'subtitle';
  }
}

function assResponse(ass: string, state: GleanState, mode: SubtitleMode): Response {
  const fileName = mode === 'mixed' ? 'glean-mixed.ass' : 'glean-bilingual.ass';
  return new Response(ass, {
    headers: corsHeaders({
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'X-Glean-State': state,
    }),
  });
}

/** Valid ASS document with zero Dialogue lines: what a header-only track looks like. */
function placeholderAss(mode: SubtitleMode): string {
  return mode === 'mixed'
    ? cuesToAss([], { fontSize: cfg.subtitleFontSize, mode: 'mixed' })
    : cuesToAss([], { fontSize: cfg.subtitleFontSize });
}

/** Fetch an arbitrary subtitle URL with the bridge's standard 8s timeout. */
async function fetchSubtitleBytes(subUrl: string): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = subUrl.startsWith(cfg.openlist.baseUrl) ? authHeaders(cfg) : {};
    const res = await fetch(subUrl, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`下载字幕失败: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`下载字幕超时（${FETCH_TIMEOUT_MS}ms）`);
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a subtitle from disk. Async on purpose: the bridge is on IINA's request
 * path, and a blocking read of a cloud-mounted file would freeze every request.
 */
async function readLocalBytes(path: string): Promise<Uint8Array> {
  try {
    return new Uint8Array(await Bun.file(path).arrayBuffer());
  } catch (err) {
    throw new Error(`读取本地字幕失败 (${path}): ${errorMessage(err)}`);
  }
}

/** `sub=` accepts an absolute filesystem path or an http(s) URL. */
async function readSubtitleSource(sub: string): Promise<{ name: string; bytes: Uint8Array }> {
  const raw = sub.trim();
  const name = fileNameOf(raw);

  if (/^https?:\/\//i.test(raw)) {
    return { name, bytes: await fetchSubtitleBytes(raw) };
  }
  if (!raw.startsWith('/') && !raw.startsWith('file://')) {
    throw new Error(`无法识别的字幕路径: ${raw}`);
  }
  return { name, bytes: await readLocalBytes(raw) };
}

/**
 * Where the cues come from, resolved *without* reading any bytes, so a background
 * job can defer the download and the cacheKey only needs the file's identity.
 */
interface SourceRef {
  /** Display name, e.g. `HHLGB S01E15-EN.srt`. */
  name: string;
  /** Cache-key identity: `name:mtime:size` locally, `name:size` remotely. */
  identity: string;
  /** Deferred read — a job may run it seconds later. */
  load: () => Promise<Uint8Array>;
}

interface ResolvedSource {
  /** Normalized video path; the cacheKey anchor and `CacheMeta.videoPath`. */
  videoPath: string;
  /** `null` when the video has no sibling subtitle at all. */
  source: SourceRef | null;
}

/** Local filesystem path behind a `sub=` value, or `null` for a URL. */
function localPathOfSub(raw: string): string | null {
  if (raw.startsWith('file://')) {
    try {
      return decodeURIComponent(new URL(raw).pathname);
    } catch {
      return null;
    }
  }
  return raw.startsWith('/') ? raw : null;
}

/** Subtitle extensions the bridge will offer, in the order the listing uses them. */
const SUBTITLE_EXTENSIONS = ['.srt', '.ass', '.ssa', '.vtt', '.sub'];

/**
 * Sibling subtitle candidates straight from the local directory, best match first.
 *
 * `listSiblingSubtitles` asks OpenList first and only then scans locally with a
 * blocking `readdirSync` — on a cloud-mounted library that single call can freeze
 * the event loop for seconds. The bridge is on the IINA request path, so it scans
 * asynchronously itself and leaves OpenList as the fallback for unmounted paths.
 * Returns `null` when the directory is not readable locally.
 */
async function localCandidates(videoPath: string): Promise<SubtitleCandidate[] | null> {
  const slash = videoPath.lastIndexOf('/');
  const dir = slash > 0 ? videoPath.slice(0, slash) : '/';
  const base = videoPath.slice(slash + 1).replace(/\.[^./\\]+$/, '');

  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }

  return names
    .filter((name) => SUBTITLE_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext)))
    .map((name) => ({ name, size: 0, format: extensionOf(name), score: scoreSubtitle(base, name) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/**
 * Resolve the video's subtitle source. Throws only when the sibling listing
 * itself fails; a video without any sibling subtitle resolves to `source: null`.
 */
async function resolveSource(video: string, subParam: string, explicitFile: string): Promise<ResolvedSource> {
  if (subParam) {
    const raw = subParam.trim();
    const name = fileNameOf(raw);
    const localSub = localPathOfSub(raw);
    // The key must stay anchored on the *video*; only the subtitle's identity varies.
    const videoPath = resolveOpenListPath(video) ?? video;
    return {
      videoPath,
      source: {
        name,
        identity: localSub ? `${name}:${await localFileIdentity(localSub)}` : `url:${raw}`,
        load: async () => (await readSubtitleSource(raw)).bytes,
      },
    };
  }

  const videoPath = resolveOpenListPath(video);
  if (!videoPath) return { videoPath: video, source: null };

  const candidates =
    (await localCandidates(videoPath)) ?? (await listSiblingSubtitles(videoPath, cfg));
  const fileName = explicitFile || candidates[0]?.name || '';
  if (!fileName) return { videoPath, source: null };

  // The bridge maps the OpenList path onto the video's own absolute path, so a
  // sibling subtitle is usually a local file sitting next to it.
  const dir = videoPath.slice(0, Math.max(0, videoPath.lastIndexOf('/')));
  const localPath = `${dir}/${fileName}`;
  const diskIdentity = await localFileIdentity(localPath);
  const identity =
    diskIdentity === 'absent'
      ? `${fileName}:${candidates.find((candidate) => candidate.name === fileName)?.size ?? 0}`
      : `${fileName}:${diskIdentity}`;

  return {
    videoPath,
    source: {
      name: fileName,
      identity,
      load:
        diskIdentity === 'absent'
          ? () => downloadSubtitle(videoPath, fileName, cfg)
          : () => readLocalBytes(localPath),
    },
  };
}

async function loadCues(source: SourceRef): Promise<CueOut[]> {
  const data = await source.load();
  const parsed = parseSubtitleContent(data);
  const cues: CueOut[] = parsed.map((cue) => ({
    start: cue.start,
    end: cue.end,
    textEn: (cue.textEn ?? '').trim(),
    textZh: (cue.textZh ?? '').trim(),
  }));
  if (cues.length === 0) console.warn(`[bridge] Parsed zero cues from ${source.name}`);
  return cues;
}

/**
 * One `MixedRun[]` per cue for `mode=mixed`, or `null` when the inline gloss
 * generator cannot produce them — the caller then renders the bilingual layout
 * instead of failing the request.
 */
async function mixedRunsFor(cues: CueOut[], report: JobReport): Promise<MixedRun[][] | null> {
  if (cues.length === 0) return null;
  const hook: ProgressHook = { onProgress: (done) => report(done) };
  try {
    const phrases = await glossCuesHeadless(cues, {
      ...hook,
      apiKey: cfg.llm.apiKey,
      provider: cfg.llm.provider,
      model: cfg.llm.model,
      baseUrl: cfg.llm.baseUrl,
      targetLang: cfg.targetLang,
    });
    if (phrases.length !== cues.length) {
      console.warn(`[bridge] Gloss returned ${phrases.length}/${cues.length} cues — falling back to bilingual`);
      return null;
    }
    return cues.map((cue, index) => buildMixedRuns(cue.textEn, phrases[index] ?? []));
  } catch (err) {
    console.warn('[bridge] Inline gloss failed — falling back to bilingual:', errorMessage(err));
    return null;
  }
}

/** Stage-1 mixed runs: dictionary-only glosses, no network, a few ms per episode. */
function fastRunsFor(cues: CueOut[]): MixedRun[][] {
  const phrases = fastGlossCues(cues);
  return cues.map((cue, index) => buildMixedRuns(cue.textEn, phrases[index] ?? []));
}

/** One generated subtitle track, before serialisation. */
interface GeneratedPayload {
  sourceName: string;
  cues: CueOut[];
  runs: MixedRun[][] | null;
  translated: boolean;
}

/**
 * Gloss or translate the cues. Progress is reported in cue units; the first
 * report publishes the cue count so `/api/job` can show `done/total`.
 */
async function refineCues(
  cues: CueOut[],
  mode: SubtitleMode,
  wantTranslate: boolean,
  report: JobReport
): Promise<{ cues: CueOut[]; runs: MixedRun[][] | null; translated: boolean }> {
  report(0, cues.length);
  let refined = cues;
  let translated = cues.some((cue) => cue.textZh.length > 0);

  const runs = mode === 'mixed' ? await mixedRunsFor(cues, report) : null;
  // Mixed mode takes its Chinese from the inline glosses, so a translation pass is
  // only worth the API call when the gloss path failed and we fall back to bilingual.
  const needTranslation = wantTranslate && runs === null;

  if (needTranslation && cues.length > 0) {
    const hook: ProgressHook = { onProgress: (done) => report(done) };
    try {
      const result = await translateCuesHeadless(cues, {
        ...hook,
        apiKey: cfg.llm.apiKey,
        provider: cfg.llm.provider,
        model: cfg.llm.model,
        baseUrl: cfg.llm.baseUrl,
        targetLang: cfg.targetLang,
      });
      if (result.length === cues.length) {
        refined = cues.map((cue, index) => ({ ...cue, textZh: result[index].textZh.trim() || cue.textZh }));
        translated = true;
      } else {
        console.warn(`[bridge] Translation returned ${result.length}/${cues.length} cues — using untranslated cues`);
      }
    } catch (err) {
      console.warn('[bridge] Translation failed — falling back to untranslated cues:', errorMessage(err));
    }
  }
  report(cues.length, cues.length);

  return { cues: refined, runs, translated };
}

function renderAss(payload: GeneratedPayload): string {
  return payload.runs
    ? cuesToAss(payload.cues, { fontSize: cfg.subtitleFontSize, mode: 'mixed', runs: payload.runs })
    : cuesToAss(payload.cues, { fontSize: cfg.subtitleFontSize });
}

/**
 * A request shape that has been resolved and parsed: the cacheKey is known, the
 * cues are in hand, and both the stage-1 answer and the background job can use
 * them without touching the filesystem or the network again.
 */
interface Prepared {
  key: string;
  videoPath: string;
  source: SourceRef;
  cues: CueOut[];
  /** The exact request that produced this shape, for cache bookkeeping. */
  request: PrepareRequest;
}

interface PrepareRequest {
  video: string;
  subParam: string;
  explicitFile: string;
  mode: SubtitleMode;
}

async function prepareRequest(request: PrepareRequest): Promise<Prepared | null> {
  const resolved = await resolveSource(request.video, request.subParam, request.explicitFile);
  const source = resolved.source;
  if (!source) {
    console.warn(`[bridge] No subtitle source for ${request.video}`);
    return null;
  }
  const key = cacheKeyFor({
    videoPath: resolved.videoPath,
    subIdentity: source.identity,
    mode: request.mode,
    model: cfg.llm.model,
    fontSize: cfg.subtitleFontSize,
    targetLang: cfg.targetLang,
  });
  return { key, videoPath: resolved.videoPath, source, cues: await loadCues(source), request };
}

/** Identity of a full request shape (`sub=`/`file=` change which cues are served). */
function requestKeyOf(request: PrepareRequest): string {
  return `${request.mode}|${request.subParam}|${request.explicitFile}|${request.video}`;
}

/** `/api/job` knows only `video` + `mode`; this maps that pair to its cacheKey. */
function aliasOf(video: string, mode: SubtitleMode): string {
  return `${mode}|${video}`;
}

function rememberOldest(map: Map<string, unknown>, cap: number): void {
  if (map.size <= cap) return;
  const oldest = map.keys().next();
  if (!oldest.done) map.delete(oldest.value);
}

/**
 * Resolved request shapes. Repeat `/api/cues` calls for the same shape are served
 * from here, and the `video|mode` alias lets `/api/job` find the very cacheKey the
 * request produced — so the polled key can never drift from the requested one.
 */
const preparedByRequest = new Map<string, Prepared>();
const keyByAlias = new Map<string, string>();
/** In-flight resolutions, so concurrent requests share one listing + parse. */
const preparing = new Map<string, Promise<Prepared | null>>();

function remember(prepared: Prepared): void {
  const requestKey = requestKeyOf(prepared.request);
  preparedByRequest.delete(requestKey);
  preparedByRequest.set(requestKey, prepared);
  rememberOldest(preparedByRequest, MAX_PREPARED);

  const alias = aliasOf(prepared.request.video, prepared.request.mode);
  keyByAlias.delete(alias);
  keyByAlias.set(alias, prepared.key);
  rememberOldest(keyByAlias, MAX_PREPARED * 4);
}

/** Resolve once per request shape; every caller shares the same promise. */
function prepareOnce(request: PrepareRequest): Promise<Prepared | null> {
  const requestKey = requestKeyOf(request);
  const existing = preparing.get(requestKey);
  if (existing) return existing;

  const task = prepareRequest(request)
    .then((prepared) => {
      if (prepared) remember(prepared);
      return prepared;
    })
    .finally(() => {
      preparing.delete(requestKey);
    });
  // A timed-out caller may never await this; keep the rejection handled.
  void task.catch(() => {});
  preparing.set(requestKey, task);
  return task;
}

type Outcome<T> =
  | { status: 'value'; value: T }
  | { status: 'error'; error: unknown }
  | { status: 'timeout' };

/** Settle the promise or give up at `ms`, whichever comes first. */
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<Outcome<T>> {
  const { promise: raced, resolve } = Promise.withResolvers<Outcome<T>>();
  let done = false;
  const finish = (outcome: Outcome<T>): void => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    resolve(outcome);
  };
  const timer = setTimeout(() => finish({ status: 'timeout' }), ms);
  promise.then(
    (value) => finish({ status: 'value', value }),
    (error) => finish({ status: 'error', error })
  );
  return raced;
}

interface GenerateOptions {
  prepared: Prepared;
  mode: SubtitleMode;
  wantTranslate: boolean;
  report: JobReport;
  /** Set when the request cannot be fully honoured (e.g. no API key): forces `failed`. */
  blockedBy?: string;
}

/**
 * Refine + serialise + persist one entry. Subtitle problems degrade instead of
 * throwing: the untranslated track is cached with `failed` metadata, so
 * `/api/cues` can answer 200 with `X-Glean-State: failed` immediately after.
 */
async function generateAndCache(opts: GenerateOptions): Promise<{ failed: boolean; error?: string; total: number }> {
  const { prepared, mode } = opts;
  let payload: GeneratedPayload = {
    sourceName: prepared.source.name,
    cues: prepared.cues,
    runs: null,
    translated: false,
  };
  let failure = opts.blockedBy;

  try {
    const refined = await refineCues(prepared.cues, mode, opts.wantTranslate, opts.report);
    payload = {
      sourceName: prepared.source.name,
      cues: refined.cues,
      runs: refined.runs,
      translated: refined.translated,
    };
  } catch (err) {
    failure = errorMessage(err);
    console.warn(`[bridge] Generation failed for ${prepared.source.name} — caching fallback:`, failure);
  }

  const total = payload.cues.length;
  const meta: CacheMeta = {
    videoPath: prepared.videoPath,
    mode,
    model: cfg.llm.model,
    done: total,
    total,
    createdAt: Date.now(),
    // Recorded even when the gloss/translation degraded: the point is "do not try
    // this key's model pass again", not "did it succeed".
    llmAttempted: cfg.llm.apiKey.trim().length > 0 && (mode === 'mixed' || opts.wantTranslate),
    failed: failure !== undefined,
    ...(failure === undefined ? {} : { error: failure }),
  };

  try {
    writeCache(prepared.key, {
      ass: renderAss(payload),
      json: {
        source: { name: payload.sourceName, format: extensionOf(payload.sourceName) },
        cues: payload.cues,
        ...(payload.runs ? { runs: payload.runs } : {}),
        translated: payload.translated,
        meta,
      },
    });
  } catch (err) {
    // A full disk must not turn into a generation loop; report it as a failure.
    const message = errorMessage(err);
    console.warn('[bridge] Cache write failed:', message);
    return { failed: true, error: failure ?? message, total };
  }

  return failure === undefined ? { failed: false, total } : { failed: true, error: failure, total };
}

/** Serialise a cache entry with its generation state. */
function respondCached(
  key: string,
  video: string,
  cached: CachedCues,
  wantAss: boolean,
  mode: SubtitleMode
): Response {
  const state: GleanState = cached.meta.failed ? 'failed' : 'ready';

  if (wantAss) {
    const ass =
      readCachedAss(key) ??
      renderAss({
        sourceName: cached.source?.name ?? '',
        cues: cached.cues,
        runs: cached.runs ?? null,
        translated: cached.translated,
      });
    return assResponse(ass, state, mode);
  }

  return jsonResponse({
    video,
    source: cached.source,
    cues: cached.cues,
    ...(cached.runs ? { runs: cached.runs } : {}),
    translated: cached.translated,
    pending: false,
    state,
    cacheKey: key,
  });
}

/**
 * `X-Glean-State: pending` body. With a prepared request it is the real stage-1
 * track (dictionary glosses for `mixed`), so the user sees subtitles instantly;
 * without one it is an empty-but-valid document.
 */
function respondPending(
  video: string,
  mode: SubtitleMode,
  wantAss: boolean,
  prepared: Prepared | null
): Response {
  if (!prepared) {
    return wantAss
      ? assResponse(placeholderAss(mode), 'pending', mode)
      : jsonResponse({
          video,
          source: null,
          cues: [],
          runs: [],
          translated: false,
          pending: true,
          state: 'pending',
          cacheKey: '',
        });
  }

  const runs = mode === 'mixed' ? fastRunsFor(prepared.cues) : null;
  if (wantAss) {
    return assResponse(
      renderAss({ sourceName: prepared.source.name, cues: prepared.cues, runs, translated: false }),
      'pending',
      mode
    );
  }
  return jsonResponse({
    video,
    source: { name: prepared.source.name, format: extensionOf(prepared.source.name) },
    cues: prepared.cues,
    runs: runs ?? [],
    translated: false,
    pending: true,
    state: 'pending',
    cacheKey: prepared.key,
  });
}

/**
 * Whether a cached entry must be regenerated for this request.
 *
 * Two bounded reasons only: a `translate=0` entry that a model-backed request can
 * upgrade exactly once, and a broken entry retried at most once a minute. Nothing
 * here can re-trigger generation for an entry that already had its model pass.
 */
function needsUpgrade(cached: CachedCues, needsModel: boolean): boolean {
  if (!needsModel) return false;
  if (cached.meta.failed) return Date.now() - cached.meta.createdAt >= FAILED_RETRY_MS;
  return !cached.meta.llmAttempted;
}

/**
 * Background job body: refine, cache, and log one start/end line with timings
 * (the integration owner uses those to verify the pipeline).
 */
function jobBody(prepared: Prepared, mode: SubtitleMode, wantTranslate: boolean) {
  return async (report: JobReport): Promise<void> => {
    const startedAt = Date.now();
    console.log(`[bridge] job start ${prepared.key} mode=${mode} cues=${prepared.cues.length}`);
    const result = await generateAndCache({ prepared, mode, wantTranslate, report });
    const elapsed = Date.now() - startedAt;
    if (result.failed) {
      console.log(`[bridge] job failed ${prepared.key} mode=${mode} cues=${result.total} elapsed=${elapsed}ms: ${result.error}`);
      throw new Error(result.error ?? '生成失败');
    }
    console.log(`[bridge] job done ${prepared.key} mode=${mode} cues=${result.total} elapsed=${elapsed}ms`);
  };
}

/**
 * Used when resolution outran the deadline: finish in the background so the
 * episode is ready (and `/api/job` flips to `ready`) without a second request.
 */
function generateInBackground(
  prepared: Prepared,
  mode: SubtitleMode,
  needsModel: boolean,
  wantTranslate: boolean
): void {
  const cached = readCachedJson(prepared.key);
  if (cached && !needsUpgrade(cached, needsModel)) return;
  startJob(prepared.key, prepared.cues.length, jobBody(prepared, mode, wantTranslate));
}

async function handleHealth(): Promise<Response> {
  const reachable = await isOpenListReachable(cfg);
  return jsonResponse({
    ok: true,
    version: BRIDGE_VERSION,
    enabled: bridgeEnabled(),
    openlist: { baseUrl: cfg.openlist.baseUrl, reachable },
    llm: { configured: cfg.llm.apiKey.length > 0 },
  });
}

// MARK: - Console

/**
 * The console flips the master switch by rewriting `~/.glean-iina/config.json`; the daemon must
 * honour that without a restart, so the raw flag is re-read on demand (1 s memo so a busy
 * playlist does not stat the file on every request).
 */
let flagCache: { at: number; enabled: boolean } | null = null;

function bridgeEnabled(): boolean {
  const now = Date.now();
  if (flagCache && now - flagCache.at < 1000) return flagCache.enabled;
  let enabled = true;
  try {
    const raw: unknown = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    if (isPlainObject(raw) && typeof raw.enabled === 'boolean') enabled = raw.enabled;
  } catch {
    // Unreadable config keeps the bridge on: a broken file must not silently disable subtitles.
  }
  flagCache = { at: now, enabled };
  return enabled;
}

function subtitleLayout(): 'bilingual' | 'mixed' {
  try {
    const raw: unknown = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    if (isPlainObject(raw) && raw.subtitleMode === 'mixed') return 'mixed';
  } catch {
    // Fall through to the default layout.
  }
  return 'bilingual';
}

async function consoleStatus(): Promise<ConsoleStatus> {
  const usage = cacheUsage();
  const reachable = await isOpenListReachable(cfg);
  return {
    enabled: bridgeEnabled(),
    mode: subtitleLayout(),
    port: cfg.port,
    configPath: CONFIG_PATH,
    cacheDir: CACHE_DIR,
    cacheFiles: usage.files,
    cacheBytes: usage.bytes,
    openlist: { baseUrl: cfg.openlist.baseUrl, reachable },
    llm: { configured: cfg.llm.apiKey.length > 0, model: cfg.llm.model },
  };
}

async function handleConsoleState(req: Request): Promise<Response> {
  if (req.method === 'POST') {
    const change = readChange(await req.json().catch(() => null));
    applyConsoleChange(change);
    flagCache = null;
    console.log(`[bridge] console change: ${JSON.stringify(change)}`);
  }
  const status = await consoleStatus();
  return jsonResponse(status);
}

async function handleConsoleCache(): Promise<Response> {
  const removed = clearCache();
  console.log(`[bridge] console cleared ${removed} cached subtitle file(s)`);
  return jsonResponse({ removed, ...(await consoleStatus()) });
}

async function handleSubtitles(url: URL): Promise<Response> {
  const video = (url.searchParams.get('video') ?? '').trim();
  if (!video) return errorResponse('缺少 video 参数', 400);

  // Master switch off: report no candidates so the plugin silently skips loading a track.
  if (!bridgeEnabled()) {
    return jsonResponse({ video, openlistPath: null, candidates: [] });
  }

  const openlistPath = resolveOpenListPath(video);
  if (!openlistPath) return jsonResponse({ video, openlistPath: null, candidates: [] });

  try {
    const candidates = await listSiblingSubtitles(openlistPath, cfg);
    return jsonResponse({ video, openlistPath, candidates });
  } catch (err) {
    return errorResponse(`列出同目录字幕失败: ${errorMessage(err)}`, 502);
  }
}

async function handleCues(url: URL): Promise<Response> {
  const video = (url.searchParams.get('video') ?? '').trim();
  if (!video) return errorResponse('缺少 video 参数', 400);

  // Master switch off: hand back an empty track instead of generating one.
  if (!bridgeEnabled()) {
    const mode = resolveSubtitleMode(url);
    return url.searchParams.get('format') === 'ass'
      ? assResponse(placeholderAss(mode), 'disabled', mode)
      : jsonResponse({
          video,
          source: null,
          cues: [],
          runs: [],
          translated: false,
          pending: false,
          state: 'disabled',
          cacheKey: '',
        });
  }

  const subParam = (url.searchParams.get('sub') ?? '').trim();
  const explicitFile = (url.searchParams.get('file') ?? '').trim();
  const wantTranslate = url.searchParams.get('translate') === '1';
  const wantAss = url.searchParams.get('format') === 'ass';
  const mode = resolveSubtitleMode(url);
  const hasLlm = cfg.llm.apiKey.trim().length > 0;
  // `mixed` glosses are a model call too, so they must stay off the sync path.
  const needsModel = hasLlm && (wantTranslate || mode === 'mixed');

  const request: PrepareRequest = { video, subParam, explicitFile, mode };
  const requestKey = requestKeyOf(request);

  let prepared = preparedByRequest.get(requestKey) ?? null;
  if (!prepared) {
    const outcome = await withDeadline(prepareOnce(request), STAGE1_DEADLINE_MS);
    if (outcome.status === 'error') {
      // Slow or unreachable source: never a 500, just a failed track.
      console.warn(`[bridge] Source resolution failed for ${video}:`, errorMessage(outcome.error));
      return wantAss
        ? assResponse(placeholderAss(mode), 'failed', mode)
        : jsonResponse({
            video,
            source: null,
            cues: [],
            runs: [],
            translated: false,
            pending: false,
            state: 'failed',
            cacheKey: '',
            error: errorMessage(outcome.error),
          });
    }
    if (outcome.status === 'timeout') {
      // Cloud-mounted library on a cold cache: answer now, finish in the background.
      void prepareOnce(request)
        .then((late) => {
          if (late) generateInBackground(late, mode, needsModel, wantTranslate && hasLlm);
        })
        .catch(() => {});
      return respondPending(video, mode, wantAss, null);
    }
    prepared = outcome.value;
  }

  if (!prepared) {
    // The video has no sibling subtitle at all: nothing will ever be generated.
    return wantAss
      ? assResponse(placeholderAss(mode), 'ready', mode)
      : jsonResponse({
          video,
          source: null,
          cues: [],
          runs: [],
          translated: false,
          pending: false,
          state: 'ready',
          cacheKey: '',
        });
  }

  const cached = readCachedJson(prepared.key);
  if (cached && !needsUpgrade(cached, needsModel)) {
    return respondCached(prepared.key, video, cached, wantAss, mode);
  }

  if (!needsModel) {
    // Fast path: no model involved, so answer synchronously — as it always did.
    const blockedBy = wantTranslate && !hasLlm ? 'llm.apiKey 未配置，无法翻译' : undefined;
    if (blockedBy) {
      console.warn(`[bridge] translate=1 requested but ${blockedBy} — serving untranslated cues`);
    }
    const result = await generateAndCache({
      prepared,
      mode,
      wantTranslate: wantTranslate && hasLlm,
      report: () => {},
      ...(blockedBy ? { blockedBy } : {}),
    });
    const written = readCachedJson(prepared.key);
    if (written) return respondCached(prepared.key, video, written, wantAss, mode);
    return wantAss
      ? assResponse(placeholderAss(mode), result.failed ? 'failed' : 'ready', mode)
      : jsonResponse({
          video,
          source: { name: prepared.source.name, format: extensionOf(prepared.source.name) },
          cues: prepared.cues,
          translated: false,
          pending: false,
          state: result.failed ? 'failed' : 'ready',
          cacheKey: prepared.key,
        });
  }

  startJob(prepared.key, prepared.cues.length, jobBody(prepared, mode, wantTranslate));
  return respondPending(video, mode, wantAss, prepared);
}

async function handleJob(url: URL): Promise<Response> {
  if (!bridgeEnabled()) {
    return jsonResponse({ state: 'disabled', done: 0, total: 0, updatedAt: Date.now(), cacheKey: '' });
  }

  const video = (url.searchParams.get('video') ?? '').trim();
  if (!video) return errorResponse('缺少 video 参数', 400);
  const mode = resolveSubtitleMode(url);

  const key = keyByAlias.get(aliasOf(video, mode)) ?? null;
  if (!key) {
    // Cold poll (the bridge restarted, or `/api/cues` has not run yet): warm the
    // mapping in the background and report pending for now.
    void prepareOnce({ video, subParam: '', explicitFile: '', mode }).catch(() => {});
    return jsonResponse({ state: 'pending', done: 0, total: 0, updatedAt: Date.now(), cacheKey: '' });
  }

  const job = jobStatus(key);
  if (job && job.state === 'pending') return jsonResponse(job);

  const cached = readCachedJson(key);
  if (cached) {
    return jsonResponse({
      state: cached.meta.failed ? 'failed' : 'ready',
      done: cached.meta.done,
      total: cached.meta.total,
      updatedAt: cached.meta.createdAt,
      cacheKey: key,
      ...(cached.meta.error ? { error: cached.meta.error } : {}),
    });
  }
  if (job) return jsonResponse(job);
  return jsonResponse({ state: 'pending', done: 0, total: 0, updatedAt: Date.now(), cacheKey: key });
}

function handleLookup(url: URL): Response {
  const word = (url.searchParams.get('word') ?? '').trim();
  if (!word) return errorResponse('缺少 word 参数', 400);

  const entry = lookupLocalDict(word);
  return jsonResponse({
    word: entry.word || word,
    phonetic: entry.phonetic,
    quickCn: entry.trans,
    cefr: entry.cefr,
    collins: entry.collins,
  });
}

/**
 * Keep the daemon alive on a stray rejection. Every background job and cache
 * write is already handled; a leftover promise must not take the bridge (and the
 * user's subtitle track) down with it.
 */
process.on('unhandledRejection', (reason) => {
  console.warn('[bridge] unhandled rejection:', errorMessage(reason));
});
process.on('uncaughtException', (err) => {
  console.warn('[bridge] uncaught exception:', errorMessage(err));
});

const server = tryServe(cfg.port);

/**
 * A stale bridge already holding the port must fail loudly: launchd restarts on a non-zero
 * exit, while a swallowed exception would leave a zombie that answers nothing.
 */
function tryServe(port: number) {
  try {
    return Bun.serve({
      port,
      hostname: '127.0.0.1',
      async fetch(request: Request): Promise<Response> {
        return await dispatch(request);
      },
    });
  } catch (err) {
    console.error(`[bridge] cannot bind 127.0.0.1:${port}:`, errorMessage(err));
    console.error('[bridge] 另一个 bridge 可能仍在运行：lsof -ti:7788 | xargs kill');
    process.exit(1);
  }
}

async function dispatch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders({
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        }),
      });
    }

    try {
      // The console page and its two write endpoints are the only non-GET surface.
      if (url.pathname === '/' && req.method === 'GET') {
        return htmlResponse(consoleHtml(await consoleStatus()));
      }
      if (url.pathname === '/api/console/state') {
        if (req.method !== 'GET' && req.method !== 'POST') return errorResponse('仅支持 GET/POST', 405);
        return await handleConsoleState(req);
      }
      if (url.pathname === '/api/console/cache') {
        if (req.method !== 'POST') return errorResponse('仅支持 POST', 405);
        return await handleConsoleCache();
      }

      if (req.method !== 'GET') return errorResponse('仅支持 GET 请求', 405);

      switch (url.pathname) {
        case '/api/health':
          return await handleHealth();
        case '/api/subtitles':
          return await handleSubtitles(url);
        case '/api/cues':
          return await handleCues(url);
        case '/api/job':
          return await handleJob(url);
        case '/api/lookup':
          return handleLookup(url);
        default:
          return errorResponse(`未知端点: ${url.pathname}`, 404);
      }
    } catch (err) {
      console.warn(`[bridge] ${url.pathname} failed:`, errorMessage(err));
      return errorResponse(errorMessage(err), 500);
    }
}

console.log(`[bridge] Listening on http://127.0.0.1:${server.port} (config: ${CONFIG_PATH}, cache: ${CACHE_DIR})`);
if (!cfg.openlist.token) {
  console.warn('[bridge] openlist.token is empty — fill ~/.glean-iina/config.json to list subtitles.');
}
if (!cfg.llm.apiKey) {
  console.warn('[bridge] llm.apiKey is empty — translate=1 answers X-Glean-State: failed with untranslated cues.');
}
