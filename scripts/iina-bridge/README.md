# Glean IINA Bridge

本机常驻的桥接服务：让 IINA 播放 OpenList（Alist）里的视频时，拿到 Glean 的双语字幕能力——同目录英文字幕 + AI 精翻中文，输出为原生 ASS 字幕轨。

```
IINA 插件 ──HTTP──▶ 127.0.0.1:7788 ──▶ OpenList (127.0.0.1:5244)
                          └──────────▶ LLM (openai / google / deepseek / anthropic)
```

## 启动

推荐用 launchd 常驻（开机自启、崩溃自动重启，不受终端会话影响）：

```bash
./scripts/iina-bridge/install-launchd.sh          # 安装并启动
./scripts/iina-bridge/install-launchd.sh status   # 查看状态（pid / 上次退出码）
./scripts/iina-bridge/install-launchd.sh stop     # 停止（plist 保留，下次登录仍会自动起）
./scripts/iina-bridge/install-launchd.sh remove   # 停止并删除 plist
```

日志写在 `~/.glean-iina/bridge.log`；plist 在 `~/Library/LaunchAgents/top.defiy.glean-bridge.plist`。

只想前台跑一次也行：

```bash
cd /path/to/Glean
bun run scripts/iina-bridge/server.ts
```

## 控制台 `http://127.0.0.1:7788/`

bridge 没有窗口，浏览器里打开这个地址就是它的图形界面（页面自包含，无外部资源）：

| 控件 | 作用 |
|---|---|
| 总开关 | 写 `config.json` 的 `enabled`。关闭后 `/api/subtitles` 返回空候选，IINA 从此不再自动挂载字幕轨；立即生效，无需重启 |
| 字幕模式 | `混合`（单行 + 行内中文注释）/ `双行`（英文一行、中文一行），写 `subtitleMode` |
| 清空缓存 | 删除 `~/.glean-iina/cache/` 下已生成的字幕，下次播放重新生成 |
| 状态区 | OpenList 是否可达、模型是否已配置、缓存文件数与体积、当前模式 |

对应 API：`GET /api/console/state`、`POST /api/console/state`（`{"enabled":false}` / `{"mode":"bilingual"}`）、`POST /api/console/cache`。
`/api/health` 里也会带 `enabled` 字段，便于脚本判断。

## 配置文件 `~/.glean-iina/config.json`

```json
{
  "port": 7788,
  "openlist": {
    "baseUrl": "http://127.0.0.1:5244",
    "token": "<OpenList JWT，直接可用 Authorization: <token>>",
    "cookie": "<可选>"
  },
  "llm": {
    "apiKey": "<LLM API Key>",
    "provider": "openai",
    "model": "gemini-3.8-flash-high",
    "baseUrl": "https://cpa.defiy.top/v1"
  },
  "targetLang": "zh",
  "translate": true,
  "subtitleFontSize": 54,
  "subtitleMode": "bilingual"
}
```

| 字段 | 说明 |
|---|---|
| `port` | 监听端口，默认 7788；环境变量 `GLEAN_IINA_PORT` 可覆盖 |
| `openlist.baseUrl` | OpenList 地址，**不要带结尾斜杠** |
| `openlist.token` | OpenList 登录后拿到的 JWT。该实例禁用了 guest，缺 token 时 `/api/health` 的 `openlist.reachable` 为 `false` |
| `openlist.cookie` | 可选，需要额外 cookie 的部署才填 |
| `llm.*` | 翻译模型配置；`apiKey` 为空时 `translate=1` 会退化为未翻译字幕（不会报错） |
| `targetLang` | 译文语言，默认 `zh` |
| `translate` | 默认是否翻译（请求里的 `translate=` 参数优先） |
| `subtitleFontSize` | ASS 中文字号（1080p 画布参考值），默认 54 |
| `subtitleMode` | 可选，`bilingual`（双行：英文上、中文下，默认）或 `mixed`（单行：英文 + 关键短语后的行内 `（中文）`）。请求里的 `mode=` 参数优先 |
| `enabled` | 可选，默认 `true`。设为 `false` 即关闭字幕服务（控制台的总开关写的就是它） |

字段缺失或类型不对都会回落到默认值，不会启动失败。

## 端点

所有响应带 `Access-Control-Allow-Origin: *`；OpenList 请求 8 秒超时；字幕下载失败返回 `502` 并附上游状态码。

### `GET /api/health`

```bash
curl 'http://127.0.0.1:7788/api/health'
# {"ok":true,"version":"1.0.0","openlist":{"baseUrl":"http://127.0.0.1:5244","reachable":true},"llm":{"configured":true}}
```

`reachable` 只有在用当前 token 成功列出 OpenList 根目录时才为 `true`。

### `GET /api/subtitles?video=<urlencoded>`

列出与视频同目录的字幕候选，按与视频文件名的相似度降序（同名 100，包含 +60，集数匹配 +40，标题词重合、双语/ASS 格式另有加分）。

```bash
curl -G 'http://127.0.0.1:7788/api/subtitles' \
  --data-urlencode 'video=http://127.0.0.1:5244/d/影视/剧集/S01E02.mkv?sign=xxx'
# {"video":"...","openlistPath":"/影视/剧集/S01E02.mkv",
#  "candidates":[{"name":"S01E02.zh-CN.ass","size":34567,"format":"ass","score":120}]}
```

没有匹配字幕时返回 `candidates: []`（HTTP 200）。

### `GET /api/cues?video=<urlencoded>&translate=0|1&format=json|ass&mode=bilingual|mixed`

| 参数 | 说明 |
|---|---|
| `video` | 播放地址，`/d/...`、`/p/...`、`file://`、绝对本地路径均可 |
| `sub` | 可选，**优先于 `file`**。绝对路径或 `http(s)://` 直链，用于手动投放的字幕 |
| `file` | 可选，指定同目录字幕文件名；缺省时自动取 `/api/subtitles` 最高分项 |
| `translate` | `1` 时调 LLM 翻译；失败会退回未翻译并返回 `translated:false` |
| `format` | `json`（默认）或 `ass` |
| `mode` | 可选，`bilingual`（默认，双行）或 `mixed`（单行，关键短语后带行内 `（中文）`）。优先级 `mode=` > `config.json` 的 `subtitleMode` > `bilingual`；非法值按 `bilingual` 处理 |

```bash
# JSON（自动挑最佳同目录字幕），默认不翻译
curl -G 'http://127.0.0.1:7788/api/cues' \
  --data-urlencode 'video=http://127.0.0.1:5244/d/影视/剧集/S01E02.mkv' \
  --data 'translate=0&format=json'

# 手动指定本地字幕 + AI 翻译，拿 JSON
curl -G 'http://127.0.0.1:7788/api/cues' \
  --data-urlencode 'video=http://127.0.0.1:5244/d/影视/剧集/S01E02.mkv' \
  --data-urlencode 'sub=/Users/me/subs/S01E02.srt' \
  --data 'translate=1&format=json'
# {"video":"...","source":{"name":"S01E02.srt","format":"srt"},
#  "cues":[{"start":1,"end":4,"textEn":"...","textZh":"..."}],"translated":true}

# 生成原生 ASS（IINA 可直接挂载）
curl -G 'http://127.0.0.1:7788/api/cues' \
  --data-urlencode 'video=http://127.0.0.1:5244/d/影视/剧集/S01E02.mkv' \
  --data-urlencode 'sub=http://example.com/S01E02.srt' \
  --data 'translate=1&format=ass' -o glean-bilingual.ass

# 单行混合模式（英文 + 关键短语后的行内中文注释）
curl -G 'http://127.0.0.1:7788/api/cues' \
  --data-urlencode 'video=http://127.0.0.1:5244/d/影视/剧集/S01E02.mkv' \
  --data 'format=ass&mode=mixed' -o glean-mixed.ass
```

`format=ass` 返回 `Content-Type: text/plain; charset=utf-8` 与 `Content-Disposition: attachment; filename="glean-bilingual.ass"`（`mode=mixed` 时为 `glean-mixed.ass`）。`bilingual` 每个 cue 两条 `Dialogue`（EN + ZH）；`mixed` 每个 cue 一条 `Dialogue`，样式 `MIX`，英文全字号、注释用 `{\fs<注释字号>}` 缩小并换暖色。视频目录里没有字幕时，JSON 返回 `{"cues":[],"source":null}`（HTTP 200），ASS 返回只有样式、0 条 `Dialogue` 的合法文件。

`mode=mixed` 且 `format=json` 时响应多一个 `runs: [[{text,kind,highlight?}, ...], ...]`（与 `cues` 等长，`kind` 为 `text` 或 `gloss`；被注释的英文片段带 `highlight:true`），供播放器自行渲染同一套行内布局。行内注释由 LLM 结合上下文生成；模型不可用时退回离线词典释义，仍会正常返回（不会 500）。

#### 异步生成与缓存（重要）

整集字幕（300+ 句）走 LLM 需要几十秒，绝不能阻塞播放器请求。所以：

1. 响应头 `X-Glean-State` 表示当前内容的成熟度：

| 值 | 含义 |
|---|---|
| `pending` | 缓存未命中，返回的是**阶段一**结果：`mixed` 用离线词典注释（300 句约 15ms 生成，真实可用），`bilingual` 为未翻译原文。后台已开始生成 |
| `ready` | 缓存命中，AI 精修版（`mixed` 的注释换成上下文义） |
| `failed` | 字幕源不可达/解析失败，返回降级结果（HTTP 仍为 200） |

2. 生成结果落盘到 `~/.glean-iina/cache/<sha1>.ass|.json`，键 = 视频路径 + 字幕 mtime/size + mode + 模型 + 字号 + 目标语言。二次播放直接命中（实测 ~20ms）。
3. 进度用 `GET /api/job` 查询；插件会每 4 秒轮询，就绪后自动换轨。

```bash
# 冷启动：立刻拿到「离线词典注释」版（pending）
time curl -G 'http://127.0.0.1:7788/api/cues' \
  --data-urlencode 'video=file:///path/S01E15.mkv' --data 'format=ass&mode=mixed'
# real 0.043s ；X-Glean-State: pending ；318 条 Dialogue / 230 条注释

# 查后台进度
curl -G 'http://127.0.0.1:7788/api/job' \
  --data-urlencode 'video=file:///path/S01E15.mkv' --data 'mode=mixed'
# {"state":"pending","done":240,"total":318,...} → 约 48s 后 {"state":"ready","done":318,...}

# 再请求同一集：已精修且秒回
# X-Glean-State: ready ；318 条 Dialogue / 297 条注释
```

### `GET /api/job?video=<urlencoded>&mode=bilingual|mixed`

返回该视频当前字幕任务的进度，`mode` 的解析规则与 `/api/cues` 完全一致（含 `config.json` 的 `subtitleMode` 回退，所以插件不必显式传 `mode`）。

| 字段 | 说明 |
|---|---|
| `state` | `pending` / `ready` / `failed` |
| `done` / `total` | 已处理句数 / 总句数（`mixed` 以 cue 计） |
| `cacheKey` | 缓存键，便于对照 `~/.glean-iina/cache/` |
| `error` | 仅 `failed` 时出现 |

### `GET /api/lookup?word=<w>`

本地 ECDICT 离线词典（不联网）。

```bash
curl 'http://127.0.0.1:7788/api/lookup?word=serendipity'
# {"word":"serendipity","phonetic":"/serən'dipiti/","quickCn":"n. 偶然发现珍宝的运气/才能...","cefr":"C1","collins":1}
```

## 排错

| 现象 | 原因 |
|---|---|
| `openlist.reachable: false` | token 为空/过期，或 OpenList 未启动 |
| `/api/subtitles` 返回 `502` + `Guest user is disabled` | token 无效，重新登录 OpenList 取 JWT |
| `/api/cues` 返回 `502` + `HTTP 403` | OpenList 已把请求转给网盘，但网盘直链失效（与桥接无关） |
| `translated:false` 且日志有 `Translation failed` | LLM key/模型/baseUrl 配错，或超时；字幕仍可用 |
