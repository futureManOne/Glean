// Glean Subtitle for IINA
//
// Bridges IINA to the local Glean bridge (default http://127.0.0.1:7788) so that
// videos streamed through OpenList get Glean's bilingual ASS subtitles
// (English line + AI Chinese translation) as a native external subtitle track.
//
// The plugin sandbox exposes only IINA's own APIs: there is no browser fetch,
// no CommonJS module loader and no Node runtime. All network and file I/O goes
// through the documented IINA modules: iina.http, iina.file, iina.utils.

const BRIDGE_BASE = 'http://127.0.0.1:7788';
const PROVIDER_ID = 'glean-openlist';
const AUTO_LOAD_DELAY_MS = 800;
const ASS_FILE_PREFIX = 'glean-';
// The bridge answers /api/cues immediately with a placeholder while a cold
// episode is generated in the background, so the plugin polls /api/job until
// the cached ASS exists and then swaps the placeholder track out.
const JOB_POLL_INTERVAL_MS = 4000;
const JOB_POLL_MAX_ATTEMPTS = 45;
const MENU_TITLE = 'Glean: 重新生成双语字幕';
const MENU_MODE_TITLE = 'Glean: 字幕模式（双行/混合）';

// Subtitle layout asked of the bridge on every request:
//   'auto'      — send no mode override, so the bridge's ~/.glean-iina/config.json
//                 (subtitleMode) decides. This is the default: one source of truth.
//   'bilingual' — two lines per cue (English above, Chinese below)
//   'mixed'     — one line per cue, key phrases followed by inline （中文）
// Not persisted: the menu toggle only affects requests made afterwards.
let subtitleMode = 'auto';

function modeLabel() {
  if (subtitleMode === 'auto') return '跟随 bridge 配置';
  return subtitleMode === 'mixed' ? '混合（单行行内注释）' : '双行（英/中）';
}

function modeShortLabel() {
  if (subtitleMode === 'auto') return '';
  return subtitleMode === 'mixed' ? '混合' : '双语';
}

// MARK: - Logging

function log(message) {
  if (iina && iina.console && typeof iina.console.log === 'function') {
    iina.console.log('[glean-iina] ' + message);
  }
}

function describeError(err) {
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  if (typeof err.reason === 'string' && err.reason) return err.reason;
  if (typeof err.message === 'string' && err.message) return err.message;
  return String(err);
}

// MARK: - Bridge access

function bridgeUrl(pathAndQuery) {
  return BRIDGE_BASE + pathAndQuery;
}

function readJsonBody(res) {
  if (!res) return null;
  if (res.data && typeof res.data === 'object') return res.data;
  const text = typeof res.text === 'string' ? res.text : '';
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

async function getJson(pathAndQuery) {
  let res = null;
  try {
    res = await iina.http.get(bridgeUrl(pathAndQuery));
  } catch (e) {
    log('GET ' + pathAndQuery + ' failed: ' + describeError(e));
    return null;
  }
  return readJsonBody(res);
}

function currentVideoUrl() {
  if (!iina.core || !iina.core.status) return '';
  const url = iina.core.status.url;
  return typeof url === 'string' ? url : '';
}

function searchPath(videoUrl) {
  return '/api/subtitles?video=' + encodeURIComponent(videoUrl);
}

function cuesPath(videoUrl, subtitleName, translate) {
  const modeParam = subtitleMode === 'auto' ? '' : '&mode=' + encodeURIComponent(subtitleMode);
  return (
    '/api/cues?video=' +
    encodeURIComponent(videoUrl) +
    '&file=' +
    encodeURIComponent(subtitleName) +
    '&translate=' +
    translate +
    '&format=ass' +
    modeParam
  );
}

// Status of the background generation for the mode we last asked for. Same mode
// rule as cuesPath: 'auto' sends nothing so the bridge resolves its own config,
// which keeps the polled cacheKey identical to the requested one.
function jobPath(videoUrl) {
  const modeParam = subtitleMode === 'auto' ? '' : '&mode=' + encodeURIComponent(subtitleMode);
  return '/api/job?video=' + encodeURIComponent(videoUrl) + modeParam;
}

// The bridge translates only when an LLM is configured; ask before requesting.
async function translateFlag() {
  const health = await getJson('/api/health');
  if (health && health.llm && health.llm.configured === true) return 1;
  return 0;
}

function bestCandidate(candidates) {
  if (!Array.isArray(candidates)) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    if (!candidate || typeof candidate.name !== 'string' || candidate.name === '') continue;
    const score = typeof candidate.score === 'number' && isFinite(candidate.score) ? candidate.score : 0;
    if (best === null || score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

// MARK: - ASS file handling

function safeAssFileName(subtitleName) {
  const base = String(subtitleName || 'subtitle')
    .replace(/^.*[\\/]/, '')
    .replace(/\.(srt|vtt|ass|ssa|lrc|sub|ttml|xml|json|bcc|txt)$/i, '')
    .replace(/[^0-9A-Za-z\u4e00-\u9fff._-]+/g, '_')
    .slice(0, 80);
  // The mode is part of the name so switching modes never reuses a stale
  // download; removeGleanTracks then drops the previous mode's track.
  return ASS_FILE_PREFIX + (base || 'subtitle') + '-' + subtitleMode + '.ass';
}

// Downloads the ASS for the current subtitle mode into the plugin's @tmp folder.
async function downloadAss(videoUrl, subtitleName) {
  const translate = await translateFlag();
  const tmpPath = '@tmp/' + safeAssFileName(subtitleName);
  try {
    await iina.http.download(bridgeUrl(cuesPath(videoUrl, subtitleName, translate)), tmpPath);
  } catch (e) {
    log('download aborted: ' + describeError(e));
    return null;
  }
  if (!iina.file.exists(tmpPath)) {
    log('download produced no file: ' + tmpPath);
    return null;
  }
  return tmpPath;
}

function realPathOf(tmpPath) {
  try {
    const resolved = iina.utils.resolvePath(tmpPath);
    if (typeof resolved === 'string' && resolved) return resolved;
  } catch (e) {
    log('resolvePath failed: ' + describeError(e));
  }
  return tmpPath;
}

// Drop a previously generated track so regenerating or switching modes does not
// stack duplicates. Matching on our file-name prefix also clears the track from
// the other mode, whose file name differs.
function removeGleanTracks() {
  const trackList = iina.mpv.getNative('track-list');
  if (!Array.isArray(trackList)) return;
  for (const track of trackList) {
    if (!track || track.type !== 'sub') continue;
    const source = track['external-filename'];
    if (typeof source !== 'string') continue;
    const baseName = source.replace(/^.*\//, '');
    if (baseName.indexOf(ASS_FILE_PREFIX) !== 0) continue;
    try {
      iina.mpv.command('sub-remove', [String(track.id)]);
    } catch (e) {
      log('sub-remove failed: ' + describeError(e));
    }
  }
}

// Loads the ASS into IINA. `sub-add ... select` is used first because it selects the new track
// atomically; `core.subtitle.loadTrack` adds the track but leaves `sid` to IINA's own chooser.
function loadAssTrack(tmpPath) {
  removeGleanTracks();
  let added = false;
  try {
    iina.mpv.command('sub-add', [realPathOf(tmpPath), 'select']);
    added = true;
  } catch (e) {
    log('mpv sub-add failed: ' + describeError(e));
  }
  if (!added) {
    try {
      iina.core.subtitle.loadTrack(tmpPath);
      added = true;
    } catch (e) {
      log('core.subtitle.loadTrack failed: ' + describeError(e));
      return false;
    }
  }
  scheduleGleanTrackSelection();
  return true;
}

// IINA runs its own "pick a subtitle" pass shortly after a file loads and overwrites `sid`
// (observed in the logs: `Set property: sid=1` ~1.3 s after our track was added), which leaves
// the episode on the bare SRT. Re-assert at several offsets so we land after that pass whatever
// the mount speed was.
const SELECT_OFFSETS_MS = [0, 1200, 2600, 4200];

function scheduleGleanTrackSelection() {
  for (const delay of SELECT_OFFSETS_MS) {
    if (delay === 0) {
      selectGleanTrack();
      continue;
    }
    setTimeout(selectGleanTrack, delay);
  }
}

function selectGleanTrack() {
  try {
    // Turn off secondary subtitle to prevent duplicate rendering or overlapping embedded tracks
    if (iina.core && iina.core.subtitle) {
      try {
        iina.core.subtitle.secondID = 0;
      } catch (_) {}
    }
    // 1. Try IINA native core.subtitle.tracks
    const coreTracks = (iina.core && iina.core.subtitle && iina.core.subtitle.tracks) || [];
    for (let i = 0; i < coreTracks.length; i++) {
      const track = coreTracks[i];
      if (!track) continue;
      const str = String(track.title || '') + ' ' + String(track.formattedTitle || '');
      if (str.toLowerCase().indexOf('glean') >= 0) {
        iina.core.subtitle.id = Number(track.id);
        try { iina.mpv.set('sid', Number(track.id)); } catch (_) {}
        log(`selected glean track via core.subtitle.id=${track.id}`);
        return;
      }
    }

    // 2. Fallback: inspect mpv native track-list
    const trackList = iina.mpv.getNative('track-list');
    log('raw mpv trackList: ' + JSON.stringify(trackList));
    if (trackList && (Array.isArray(trackList) || typeof trackList.length === 'number')) {
      for (let i = 0; i < trackList.length; i++) {
        const track = trackList[i];
        if (!track) continue;
        const file = String(track['external-filename'] || '');
        const title = String(track.title || '');
        if (file.toLowerCase().indexOf('glean') >= 0 || title.toLowerCase().indexOf('glean') >= 0) {
          const tid = Number(track.id);
          if (iina.core && iina.core.subtitle) {
            try { iina.core.subtitle.id = tid; } catch (_) {}
          }
          try { iina.mpv.set('sid', tid); } catch (_) {}
          log(`selected glean track via mpv track.id=${tid}`);
          return;
        }
      }
    }
  } catch (e) {
    log('select glean track failed: ' + describeError(e));
  }
}

// The placeholder the bridge streams while a cold episode is still being
// generated has no Dialogue lines; a finished ASS always has some. Anything we
// cannot read counts as a placeholder, so a small file API change degrades to
// "reload once when the job says ready" instead of leaving blank subtitles.
function assLooksLikePlaceholder(tmpPath) {
  try {
    if (!iina.file || typeof iina.file.read !== 'function') return true;
    const text = iina.file.read(tmpPath);
    if (typeof text !== 'string' || text === '') return true;
    return text.indexOf('Dialogue:') < 0;
  } catch (e) {
    log('reading ' + tmpPath + ' failed: ' + describeError(e));
    return true;
  }
}

// MARK: - Background generation polling
//
// A cold episode comes back as a placeholder ASS ("X-Glean-State: pending"); the
// real file appears in the bridge cache once the background job finishes. One
// chain per video: starting a new one cancels the previous timer, and a token
// keeps late responses from an abandoned chain from touching the player.

let jobTimer = '';
let jobGeneration = 0;
let jobVideoUrl = '';
let jobSubtitleName = '';
let jobLoadedPlaceholder = false;

function cancelJobPolling() {
  jobGeneration += 1;
  if (jobTimer) {
    clearTimeout(jobTimer);
    jobTimer = '';
  }
  jobVideoUrl = '';
  jobSubtitleName = '';
  jobLoadedPlaceholder = false;
}

// Re-downloads the now-cached ASS and swaps it in for the placeholder track.
async function reloadPolledSubtitle(generation) {
  // Download before removing: if the bridge died between the job check and this
  // request, the placeholder track stays attached instead of vanishing.
  const tmpPath = await downloadAss(jobVideoUrl, jobSubtitleName);
  if (generation !== jobGeneration) return;
  if (!tmpPath) {
    log('cached download produced no file, keeping placeholder track');
    return;
  }
  // Drop the placeholder first: the reload reuses the same file name, and mpv
  // would otherwise dedupe the sub-add against the stale track.
  removeGleanTracks();
  if (loadAssTrack(tmpPath)) {
    iina.core.osd('Glean: 双语字幕已就绪');
    log('swapped in generated ' + (modeShortLabel() || subtitleMode) + ' subtitle: ' + jobSubtitleName);
  } else {
    iina.core.osd('Glean: 双语字幕载入失败，详见日志');
  }
  cancelJobPolling();
}

async function pollJob(generation, attempt) {
  if (generation !== jobGeneration) return;
  const job = await getJson(jobPath(jobVideoUrl));
  if (generation !== jobGeneration) return;
  // Unreachable bridge, an older bridge without /api/job, or a bad body: giving
  // up quietly is right — the placeholder track is already loaded.
  if (!job || typeof job.state !== 'string') {
    log('job status unavailable, stopped polling');
    return;
  }
  if (job.state === 'ready') {
    // A cached episode already lands as the finished ASS, so swapping it for
    // itself would just flash the track and an OSD on every playback.
    if (!jobLoadedPlaceholder) {
      log('job ready, loaded subtitle is already final');
      cancelJobPolling();
      return;
    }
    await reloadPolledSubtitle(generation);
    return;
  }
  if (job.state === 'failed') {
    log('job failed' + (typeof job.error === 'string' && job.error ? ': ' + job.error : ''));
    iina.core.osd('Glean: 字幕生成失败，详情见日志');
    cancelJobPolling();
    return;
  }
  // If the bridge reports pending, whatever was initially loaded was a stage-1
  // placeholder (even if fastGloss emitted real Dialogue lines). The refined track
  // must be swapped in when ready.
  jobLoadedPlaceholder = true;
  const done = typeof job.done === 'number' ? job.done : 0;
  const total = typeof job.total === 'number' ? job.total : 0;
  log('job pending ' + done + '/' + total + ' (poll ' + attempt + '/' + JOB_POLL_MAX_ATTEMPTS + ')');
  if (attempt === 1) iina.core.osd('Glean: 正在生成双语字幕…');
  if (attempt >= JOB_POLL_MAX_ATTEMPTS) {
    log('job polling gave up after ' + attempt + ' attempts');
    cancelJobPolling();
    return;
  }
  jobTimer = setTimeout(() => {
    jobTimer = '';
    pollJob(generation, attempt + 1).catch((e) => log('job poll error: ' + describeError(e)));
  }, JOB_POLL_INTERVAL_MS);
}

// Called right after an ASS download: one /api/job request tells us whether the
// file we just loaded is the final one or a placeholder worth polling for.
// `loadedPlaceholder` defaults to true, the safe side: the worst it costs is one
// redundant reload, the alternative is leaving blank subtitles on screen.
function startJobPolling(videoUrl, subtitleName, loadedPlaceholder) {
  if (!videoUrl) return;
  cancelJobPolling();
  const generation = jobGeneration;
  jobVideoUrl = videoUrl;
  jobSubtitleName = subtitleName || '';
  jobLoadedPlaceholder = loadedPlaceholder !== false;
  pollJob(generation, 1).catch((e) => log('job poll error: ' + describeError(e)));
}

// MARK: - Auto load on file open

// IINA's timers are identified by strings; '' means "nothing to clear".
let autoLoadTimer = '';
let lastAutoLoadUrl = '';

async function autoLoadFor(videoUrl) {
  if (!videoUrl) return;
  const payload = await fetchCandidates(videoUrl);
  if (!payload) {
    log('bridge unreachable, skipped');
    return;
  }
  const candidate = bestCandidate(payload.candidates);
  if (!candidate) {
    log('no subtitle candidate for this video');
    return;
  }
  const tmpPath = await downloadAss(videoUrl, candidate.name);
  if (!tmpPath) return;
  if (loadAssTrack(tmpPath)) {
    const modeTag = modeShortLabel();
    log('auto-loaded ' + (modeTag ? modeTag + ' ' : '') + 'subtitle: ' + candidate.name);
  }
  startJobPolling(videoUrl, candidate.name, assLooksLikePlaceholder(tmpPath));
}

// The bridge can be mid-restart (launchd, a rebuild) exactly when a file finishes loading, and a
// single failed query used to leave the episode with no Glean track until the file was reopened.
// Retry a few times before giving up.
const CANDIDATE_RETRY_DELAYS_MS = [0, 2000, 5000];

async function fetchCandidates(videoUrl) {
  for (let attempt = 0; attempt < CANDIDATE_RETRY_DELAYS_MS.length; attempt++) {
    const delay = CANDIDATE_RETRY_DELAYS_MS[attempt];
    if (delay > 0) await sleep(delay);
    const payload = await getJson(searchPath(videoUrl));
    if (payload && Array.isArray(payload.candidates)) return payload;
    log(`subtitle query attempt ${attempt + 1}/${CANDIDATE_RETRY_DELAYS_MS.length} failed`);
  }
  return null;
}

/** Promise-based delay. Kept as a bare Promise because IINA's JavaScriptCore may predate `Promise.withResolvers`. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scheduleAutoLoad() {
  clearTimeout(autoLoadTimer);
  autoLoadTimer = setTimeout(() => {
    autoLoadTimer = '';
    const videoUrl = currentVideoUrl();
    if (!videoUrl || videoUrl === lastAutoLoadUrl) return;
    lastAutoLoadUrl = videoUrl;
    autoLoadFor(videoUrl).catch((e) => log('auto-load error: ' + describeError(e)));
  }, AUTO_LOAD_DELAY_MS);
}

// MARK: - Menu action

async function regenerateSubtitles() {
  const videoUrl = currentVideoUrl();
  if (!videoUrl) {
    iina.core.osd('Glean: 当前没有正在播放的视频');
    return;
  }
  const payload = await getJson(searchPath(videoUrl));
  if (!payload || !Array.isArray(payload.candidates)) {
    log('bridge unreachable, skipped');
    iina.core.osd('Glean: bridge 未运行（' + BRIDGE_BASE + '）');
    return;
  }
  const candidate = bestCandidate(payload.candidates);
  if (!candidate) {
    iina.core.osd('Glean: 未找到匹配的字幕');
    return;
  }
  const tmpPath = await downloadAss(videoUrl, candidate.name);
  if (!tmpPath) {
    iina.core.osd('Glean: 字幕下载失败，详见日志');
    return;
  }
  const placeholder = assLooksLikePlaceholder(tmpPath);
  if (loadAssTrack(tmpPath)) {
    // A cold episode only has a placeholder now; the poll below swaps the real
    // file in once the bridge finishes generating it.
    iina.core.osd(
      placeholder ? 'Glean: 正在生成双语字幕…' : 'Glean: 已重新生成' + modeShortLabel() + '字幕'
    );
  } else {
    iina.core.osd('Glean: 字幕载入失败，详见日志');
  }
  startJobPolling(videoUrl, candidate.name, placeholder);
}

// MARK: - Subtitle mode

// Cycles the layout for subsequent requests (not persisted) and reloads the
// current video's track so the change is visible immediately.
function toggleSubtitleMode() {
  subtitleMode = subtitleMode === 'auto' ? 'bilingual' : subtitleMode === 'bilingual' ? 'mixed' : 'auto';
  iina.core.osd('Glean: 字幕模式 → ' + modeLabel());
  regenerateSubtitles().catch((e) => log('regenerate error: ' + describeError(e)));
}

// MARK: - Registration

function formatSize(bytes) {
  if (typeof bytes !== 'number' || !(bytes > 0)) return '';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

function describeSubtitle(data) {
  const parts = [];
  if (typeof data.format === 'string' && data.format) parts.push(data.format.toUpperCase());
  const size = formatSize(data.size);
  if (size) parts.push(size);
  return parts.join(' · ') || 'ASS';
}

iina.subtitle.registerProvider(PROVIDER_ID, {
  search: async () => {
    const videoUrl = currentVideoUrl();
    if (!videoUrl) return [];
    const payload = await getJson(searchPath(videoUrl));
    if (!payload || !Array.isArray(payload.candidates)) {
      log('bridge unreachable, skipped');
      return [];
    }
    const items = [];
    for (const candidate of payload.candidates) {
      if (!candidate || typeof candidate.name !== 'string' || candidate.name === '') continue;
      items.push(
        iina.subtitle.item({
          video: videoUrl,
          name: candidate.name,
          format: typeof candidate.format === 'string' ? candidate.format : '',
          size: typeof candidate.size === 'number' ? candidate.size : 0,
          score: typeof candidate.score === 'number' ? candidate.score : 0,
        })
      );
    }
    return items;
  },

  description: (item) => {
    const data = item && item.data ? item.data : {};
    const name = typeof data.name === 'string' && data.name ? data.name : '字幕';
    const score = typeof data.score === 'number' ? Math.round(data.score * 100) : 0;
    return {
      name: 'Glean ' + modeShortLabel() + ' · ' + name,
      left: describeSubtitle(data),
      right: '匹配度 ' + score + '%',
    };
  },

  download: async (item) => {
    const data = item && item.data ? item.data : {};
    const videoUrl = typeof data.video === 'string' && data.video ? data.video : currentVideoUrl();
    const subtitleName = typeof data.name === 'string' ? data.name : '';
    if (!videoUrl || !subtitleName) return [];
    const tmpPath = await downloadAss(videoUrl, subtitleName);
    if (tmpPath) startJobPolling(videoUrl, subtitleName, assLooksLikePlaceholder(tmpPath));
    return tmpPath ? [tmpPath] : [];
  },
});

iina.menu.addItem(
  iina.menu.item(MENU_TITLE, () => {
    regenerateSubtitles().catch((e) => log('regenerate error: ' + describeError(e)));
  })
);

iina.menu.addItem(
  iina.menu.item(MENU_MODE_TITLE, () => {
    toggleSubtitleMode();
  })
);

iina.event.on('iina.file-loaded', () => {
  // A different file invalidates the running chain; the same file keeps it,
  // since IINA can re-emit file-loaded without the job having finished.
  if (currentVideoUrl() !== jobVideoUrl) cancelJobPolling();
  scheduleAutoLoad();
});
