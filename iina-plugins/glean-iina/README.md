# Glean Subtitle for IINA

把 Glean 的双语字幕能力带进 IINA：播放 OpenList 本地代理视频时，插件从本地 Glean bridge 取字幕，
生成 **英文原句 + AI 中文精翻** 的原生 ASS 字幕轨，并自动载入播放器。

- 视频地址、字幕文件都通过本机 bridge（默认 `http://127.0.0.1:7788`）中转，插件不直接访问 OpenList 或大模型。
- bridge 未运行时插件静默跳过自动载入，不会弹错、不会打断播放。

## 一、安装

1. 确认 IINA 版本 ≥ 1.4（本项目在 1.5.0 上验证）。
2. 进入插件目录并执行安装脚本（创建 `.iinaplugin-dev` 软链）：

   ```sh
   cd iina-plugins/glean-iina
   ./install.sh
   ```

   脚本会把当前目录链接到：

   ```
   ~/Library/Application Support/com.colliderli.iina/plugins/glean-iina.iinaplugin-dev
   ```

3. **重启 IINA**。启动时插件会被加载；修改 `main.js` 后同样需要重启 IINA 生效。
4. 在 IINA 偏好设置 → 插件中确认 "Glean Subtitle" 已启用，并允许其请求的权限
   （`network-request` / `file-system` / `show-osd`）。

## 二、启动 bridge

bridge 负责：解析 OpenList 路径 → 找同目录字幕 → 调 LLM 精翻 → 输出 ASS。

1. 首次运行前准备配置文件 `~/.glean-iina/config.json`（bridge 首次启动会按默认值生成一份可编辑的骨架）：

   ```json
   {
     "port": 7788,
     "openlist": {
       "baseUrl": "http://127.0.0.1:5244",
       "token": "你的 OpenList token"
     },
     "llm": {
       "apiKey": "你的模型 API Key",
       "provider": "google",
       "model": "gemini-2.5-flash",
       "baseUrl": ""
     },
     "targetLang": "zh-CN",
     "translate": true,
     "subtitleFontSize": 22
   }
   ```

   - `openlist.token` 必填：OpenList 的匿名（guest）访问若被关闭，无 token 会返回 401。
   - `llm.apiKey` 为空时仍可生成字幕，但只有英文原文（插件会按 `/api/health` 的
     `llm.configured` 自动请求 `translate=0`）。

2. 在 Glean 仓库根目录启动 bridge：

   ```sh
   bun scripts/iina-bridge/server.ts
   ```

3. 自检：

   ```sh
   curl -s http://127.0.0.1:7788/api/health
   # {"ok":true,"version":"...","openlist":{"baseUrl":"http://127.0.0.1:5244","reachable":true},"llm":{"configured":true}}
   ```

> 注意：端口在插件里固定为 `7788`。若修改了 `config.json` 的 `port`，需要同步修改
> `main.js` 顶部的 `BRIDGE_BASE`。

## 三、在 IINA 里用字幕

**自动载入**：打开任意 OpenList 视频（`http://127.0.0.1:5244/d/...` 这类地址）后，插件等 800 ms 让
播放器稳定，然后向 bridge 查询同目录字幕并自动把生成的 ASS 挂为一条字幕轨。

**手动选择**：菜单 **字幕 → 查找在线字幕**，在来源列表中选择
**Glean 双语 (OpenList)**，挑一条结果即可下载并载入。

**重新生成**：菜单栏 **插件 → Glean: 重新生成双语字幕**。
（重新生成前会移除上一次由 Glean 生成的字幕轨，避免轨道重复。）

**切换字幕模式**：菜单栏 **插件 → Glean: 字幕模式（跟随配置/双行/混合）**，点一次循环三态，
OSD 会提示当前模式，并立即为当前视频重新生成字幕：

| 状态 | 行为 |
|---|---|
| `跟随 bridge 配置`（默认） | 不向 bridge 传 `mode`，由 `~/.glean-iina/config.json` 的 `subtitleMode` 决定 |
| `双行` | 英文一行、AI 中文译文一行 |
| `混合` | 单行，英文为主，关键短语后面跟行内 `（中文）` 小号暖色注释 |

切换只影响之后的请求（不写回配置），插件重启后回到「跟随 bridge 配置」。要长期用混合模式，
在控制台点一下 `混合`，或把 `~/.glean-iina/config.json` 的 `subtitleMode` 设为 `"mixed"` 并重启 bridge。

**关闭这个功能**（三种粒度，从轻到重）：

| 位置 | 效果 |
|---|---|
| **控制台** `http://127.0.0.1:7788/` → 总开关 | 立即生效、无需重启：IINA 之后打开的任何视频都不再自动挂载字幕轨 |
| **插件菜单** → `Glean: 字幕模式` / 手动切走字幕轨 | 只影响当前这个视频 |
| **IINA 设置 → 插件** → 关掉 `Glean Subtitle` | 整个插件停用（provider 从「查找在线字幕」里消失） |

bridge 自身用 launchd 常驻，`./scripts/iina-bridge/install-launchd.sh stop` 可停掉；
关掉 bridge 的效果与关总开关相同，只是插件会多打一行 `bridge unreachable, skipped`。


生成的字幕文件写到插件的 `@tmp` 目录（IINA 退出后清理）；若在 IINA 界面中选择保存字幕，
IINA 会把它移动到视频所在目录。

## 四、排错

| 现象 | 排查 |
| --- | --- |
| 播放后没有字幕轨 | 先 `curl http://127.0.0.1:7788/api/health`。bridge 没起时日志里只有一行 `[glean-iina] bridge unreachable, skipped`，属预期行为。 |
| 字幕列表是空的 | `curl "http://127.0.0.1:7788/api/subtitles?video=<urlencode 视频地址>"`，看 `openlistPath` 与 `candidates`。`candidates` 为空说明视频目录里没有可识别的字幕文件。 |
| 只有英文、没有中文 | `llm.configured` 为 false；补 `llm.apiKey` / `model` 后重启 bridge。 |
| 报错 401 / 403 | `openlist.token` 缺失或过期。 |
| 想看插件日志 | IINA 菜单 **窗口 → 日志查看器**，选择子系统 `player<N> - Glean Subtitle`；插件所有输出都以 `[glean-iina]` 开头。 |
| 改了代码没反应 | 开发插件是软链加载，必须重启 IINA；必要时用 **插件 → 开发者工具** 在插件上下文中手动执行。 |
| 想彻底卸载 | 删除 `~/Library/Application Support/com.colliderli.iina/plugins/glean-iina.iinaplugin-dev` 后重启 IINA。 |

## 五、插件用到的 bridge 接口

| 端点 | 用途 |
| --- | --- |
| `GET /api/health` | 判断 bridge 是否在线、LLM 是否配置 |
| `GET /api/subtitles?video=<urlencoded>` | 搜索同目录字幕候选 |
| `GET /api/cues?video=...&file=...&translate=0\|1&format=ass&mode=bilingual\|mixed` | 下载 ASS 字幕（`mode` 决定双行 / 单行混合） |
| `GET /api/cues?video=...&sub=<绝对路径\|http url>` | 直接指定字幕源（手工放字幕、联调） |
| `GET /api/lookup?word=...` | 词典查询（ECDICT，含音标/CEFR/Collins） |

## 六、实测踩到的坑（本机 IINA 1.5.0 + OpenList 实测结论）

1. **新装插件默认是禁用状态。** IINA 会把它写进 `PluginOrder`，但不会自动启用，此时插件菜单里看不到、`字幕 → 查找在线字幕` 里也没有 provider。启用方式二选一：
   - 偏好设置 → 插件 → 打开 Glean Subtitle 开关；
   - 或退出 IINA 后重跑 `install.sh`（脚本会写入 `PluginEnabled.top.defiy.glean-iina = 1`）。
   > `defaults write com.colliderli.iina "PluginEnabled.top.defiy.glean-iina"` 无效——`defaults` 把点当键路径；必须用 `/usr/libexec/PlistBuddy` 写。
2. **判断插件是否真的在跑，看日志而不是看界面。** 需先开启文件日志（偏好设置 → 高级 → 启用高级设置 + 记录日志），日志在 `~/Library/Logs/com.colliderli.iina/<时间戳>/iina.log`。正常应有：
   ```
   Loaded JS plugin: Glean Subtitle 0.1.0
   [player0 - Glean Subtitle] Attempting to open URL: @tmp/glean-<名字>-bilingual.ass
   [player0 - Glean Subtitle] [glean-iina] auto-loaded 双语 subtitle: <名字>.srt
   ```
3. **从 `file-loaded` 到字幕出现约 8–10 秒**：要现场调大模型翻译整片字幕（20 句/批）。属预期，不是卡顿。
4. **OpenList 库里必须有字幕文件才有东西可翻译。** 实测该实例（夸克 / 阿里云盘 / Google 云盘三挂载，扫 60 个目录）**一个 `.srt/.ass` 都没有**，所以默认候选为空。可行做法：
   - 把英文字幕上传到视频同目录（`listSiblingSubtitles` 会自动匹配、按集数打分）；
   - 或直接用 `sub=` 端点指定任一字幕文件 / URL。
5. **`PingFang SC` 在 IINA 里渲染成豆腐块。** libass 自带的 fontconfig 扫不到 macOS 按需字体资产（`/System/Library/AssetsV2`），因此 ASS 的 `ZH` 样式固定用 `Hiragino Sans GB`（位于 `/System/Library/Fonts`，稳定可解析）。
6. IINA 1.5.0 点击「插件面板」时出现过 `JavascriptAPISidebarView.loadFile` 崩溃 —— 栈来自 **OpenSubtitles 插件**（它调 `sidebar.loadFile`），与本插件无关；本插件不创建 sidebar / overlay。
