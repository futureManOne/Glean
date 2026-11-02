/**
 * Local web console for the Glean bridge (`http://127.0.0.1:7788/`).
 *
 * The bridge is a daemon with no window, so "turn the subtitles off" would otherwise mean
 * editing `~/.glean-iina/config.json` by hand. This page is the GUI for exactly three things:
 * the master switch, the subtitle layout, and the cache — the rest (mode cycling, regenerating
 * a track) stays in IINA's own plugin menu.
 */

import { existsSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { CONFIG_PATH } from './config';
import { CACHE_DIR } from './cache';

export type SubtitleLayout = 'bilingual' | 'mixed';

export interface ConsoleStatus {
  enabled: boolean;
  mode: SubtitleLayout;
  port: number;
  configPath: string;
  cacheDir: string;
  cacheFiles: number;
  cacheBytes: number;
  openlist: { baseUrl: string; reachable: boolean };
  llm: { configured: boolean; model: string };
}

/** Only these two keys are writable from the page; everything else in the file is preserved. */
export interface ConsoleChange {
  enabled?: boolean;
  mode?: SubtitleLayout;
}

export function readChange(raw: unknown): ConsoleChange {
  if (typeof raw !== 'object' || raw === null) return {};
  const body = raw as Record<string, unknown>;
  const change: ConsoleChange = {};
  if (typeof body.enabled === 'boolean') change.enabled = body.enabled;
  if (body.mode === 'bilingual' || body.mode === 'mixed') change.mode = body.mode;
  return change;
}

/** Atomic read-modify-write: unknown keys (credentials etc.) survive, a crash cannot truncate. */
export function applyConsoleChange(change: ConsoleChange): void {
  let current: Record<string, unknown> = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
      if (typeof parsed === 'object' && parsed !== null) current = parsed as Record<string, unknown>;
    } catch {
      // Unreadable config: keep going and rewrite only the keys we own.
    }
  }
  if (change.enabled !== undefined) current.enabled = change.enabled;
  if (change.mode !== undefined) current.subtitleMode = change.mode;

  const tmp = `${CONFIG_PATH}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
  renameSync(tmp, CONFIG_PATH);
}

export function cacheUsage(): { files: number; bytes: number } {
  if (!existsSync(CACHE_DIR)) return { files: 0, bytes: 0 };
  let files = 0;
  let bytes = 0;
  for (const name of readdirSync(CACHE_DIR)) {
    try {
      const info = statSync(`${CACHE_DIR}/${name}`);
      if (!info.isFile()) continue;
      files += 1;
      bytes += info.size;
    } catch {
      // A file removed mid-scan must not break the page.
    }
  }
  return { files, bytes };
}

export function clearCache(): number {
  if (!existsSync(CACHE_DIR)) return 0;
  let removed = 0;
  for (const name of readdirSync(CACHE_DIR)) {
    try {
      const path = `${CACHE_DIR}/${name}`;
      if (!statSync(path).isFile()) continue;
      unlinkSync(path);
      removed += 1;
    } catch {
      // Ignore files we cannot remove.
    }
  }
  return removed;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(value: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  return value.replace(/[&<>"]/g, (char) => map[char] ?? char);
}

/** Self-contained page: no external assets, so it renders even with no network. */
export function consoleHtml(status: ConsoleStatus): string {
  const { enabled, mode } = status;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Glean 字幕 · 控制台</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 28px; font: 14px/1.6 -apple-system, "PingFang SC", sans-serif;
         background: #14161a; color: #e6e8eb; }
  .wrap { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 19px; margin: 0 0 4px; }
  .sub { color: #8b929c; font-size: 12.5px; margin-bottom: 22px; }
  .card { background: #1c1f26; border: 1px solid #2a2f38; border-radius: 12px; padding: 16px 18px; margin-bottom: 14px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .row + .row { margin-top: 14px; padding-top: 14px; border-top: 1px solid #262b33; }
  .label { font-weight: 600; }
  .hint { color: #8b929c; font-size: 12px; font-weight: 400; margin-top: 2px; }
  .switch { position: relative; width: 52px; height: 28px; flex: 0 0 auto; }
  .switch input { opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
  .track { position: absolute; inset: 0; border-radius: 999px; background: #3a404a; transition: background .16s; pointer-events: none; }
  .knob { position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%;
          background: #fff; transition: left .16s; pointer-events: none; }
  input:checked ~ .track { background: #0f9ba8; }
  input:checked ~ .knob { left: 27px; }
  .seg { display: inline-flex; border: 1px solid #2a2f38; border-radius: 9px; overflow: hidden; }
  .seg button { background: transparent; border: 0; color: #b6bcc6; padding: 7px 16px; font-size: 13px; cursor: pointer; }
  .seg button[aria-pressed="true"] { background: #0f9ba8; color: #fff; }
  .btn { background: #262b33; border: 1px solid #333a45; color: #e6e8eb; border-radius: 9px;
         padding: 7px 14px; font-size: 13px; cursor: pointer; }
  .btn:hover { background: #2f353f; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 7px 18px; margin: 0; font-size: 13px; }
  dt { color: #8b929c; }
  dd { margin: 0; font-variant-numeric: tabular-nums; }
  code { background: #23272e; padding: 1px 6px; border-radius: 5px; font-size: 12px; }
  .ok { color: #4ade80; } .bad { color: #f87171; }
  .foot { color: #6b7280; font-size: 12px; margin-top: 18px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Glean 字幕 · 控制台</h1>
  <div class="sub">本地桥 <code>127.0.0.1:${status.port}</code> · 配置 <code>${escapeHtml(status.configPath)}</code></div>

  <div class="card">
    <div class="row">
      <div>
        <div class="label">总开关</div>
        <div class="hint">关闭后，IINA 打开任何视频都不会再自动挂载 Glean 字幕轨。</div>
      </div>
      <label class="switch">
        <input type="checkbox" id="enabled" ${enabled ? 'checked' : ''}>
        <span class="track"></span><span class="knob"></span>
      </label>
    </div>
    <div class="row">
      <div>
        <div class="label">字幕模式</div>
        <div class="hint">混合 = 单行英文 + 关键短语后的行内中文注释；双行 = 英文一行、中文一行。</div>
      </div>
      <div class="seg" id="mode">
        <button data-mode="mixed" aria-pressed="${mode === 'mixed'}">混合</button>
        <button data-mode="bilingual" aria-pressed="${mode === 'bilingual'}">双行</button>
      </div>
    </div>
    <div class="row">
      <div>
        <div class="label">字幕缓存</div>
        <div class="hint">已生成的字幕会复用；清空后下次播放重新生成。</div>
      </div>
      <div>
        <span id="cacheInfo">${status.cacheFiles} 个文件 · ${formatBytes(status.cacheBytes)}</span>
        <button class="btn" id="clearCache" style="margin-left:10px">清空</button>
      </div>
    </div>
  </div>

  <div class="card">
    <dl>
      <dt>OpenList</dt><dd id="openlist">—</dd>
      <dt>大模型</dt><dd id="llm">—</dd>
      <dt>当前模式</dt><dd id="modeNow">${mode === 'mixed' ? '混合' : '双行'}</dd>
    </dl>
  </div>

  <div class="foot">
    IINA 侧：<b>插件</b>菜单里的「Glean: 字幕模式」可临时切换、「Glean: 重新生成双语字幕」可重载；
    <b>设置 → 插件</b> 里可整体停用 Glean Subtitle 插件。
  </div>
</div>
<script>
const modeSeg = document.getElementById('mode');
const enabledBox = document.getElementById('enabled');
const cacheInfo = document.getElementById('cacheInfo');

function humanBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function paint(state) {
  enabledBox.checked = state.enabled;
  for (const btn of modeSeg.querySelectorAll('button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === state.mode));
  }
  document.getElementById('modeNow').textContent = state.mode === 'mixed' ? '混合' : '双行';
  const ol = document.getElementById('openlist');
  ol.innerHTML = state.openlist.baseUrl + ' · ' + (state.openlist.reachable
    ? '<span class="ok">可达</span>' : '<span class="bad">不可达</span>');
  const llm = document.getElementById('llm');
  llm.innerHTML = state.llm.model
    ? state.llm.model + (state.llm.configured ? ' · <span class="ok">已配置</span>' : ' · <span class="bad">未配置 key</span>')
    : '<span class="bad">未配置</span>';
  cacheInfo.textContent = state.cacheFiles + ' 个文件 · ' + humanBytes(state.cacheBytes);
}

async function refresh() {
  const res = await fetch('/api/console/state');
  if (res.ok) paint(await res.json());
}

async function push(body) {
  const res = await fetch('/api/console/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) paint(await res.json());
}

enabledBox.addEventListener('change', () => push({ enabled: enabledBox.checked }));
for (const btn of modeSeg.querySelectorAll('button')) {
  btn.addEventListener('click', () => push({ mode: btn.dataset.mode }));
}
document.getElementById('clearCache').addEventListener('click', async () => {
  await fetch('/api/console/cache', { method: 'POST' });
  await refresh();
});

refresh();
</script>
</body>
</html>`;
}
