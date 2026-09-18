# myLanguageReactor 开发规范与工程准则 (Workspace Rules)

本文件定义了 myLanguageReactor 项目的核心架构原则、媒体播放器逆向及字幕嗅探规范、UI/UX 规范与自动化构建标准。

---

## 1. 媒体播放器与字幕嗅探原则 (Subtitle Sniffing & Media Player)

### 1.1 四层字幕防御体系 (Four-Layer Sniffing Architecture)
在任何视频平台（YouTube、夸克网盘、Bilibili 等）中嗅探台词时，必须遵循以下优先级与多层防护：
1. **层级 1：HTML5 原生 TextTrack (最高优先级)**
   - 优先检查 `video.textTracks`。当 `track.cues.length > 1` 且多于当前台词数时，判定为权威完整字幕，应全量提取起止时间与台词并同步至 Store。
   - 若 `track.mode === 'disabled'`，应主动设为 `'hidden'` 以促使浏览器内核解析 cues，同时避免与插件自定义双语字幕层重叠。
2. **层级 2：动态 Track 标签与 Blob 监听**
   - 必须通过 `video.textTracks.addEventListener('addtrack')` 监听用户在页面加载后动态添加的字幕轨道；
   - 必须对 `<video>` 节点建立 `MutationObserver`，一旦捕获新增的 `<track src="blob:...">` 或外部链接，立即异步 `fetch(src).then(r => r.text())` 读取原始 SRT/VTT 并调用 `loadSubtitleFileContent`。
3. **层级 3：主世界网络拦截 (Main World Network Hook)**
   - 在页面上下文中注入小型 Hook 脚本，拦截 `fetch` 与 `XMLHttpRequest` 中携带 `.srt`、`.vtt`、`.ass`、`subtitle` 等特征的网络响应，捕获后通过 `window.postMessage` 传递给插件。
4. **层级 4：实时 DOM 兜底与隔离**
   - 仅在没有加载完整字幕源（如 `cues.length <= 5`）时，才允许 DOM 实时变化捕获台词；一旦已加载完整台词库，立即屏蔽 DOM 碎片写入，防止污染。

### 1.2 严防状态死锁与假台词污染 (Anti-Deadlock & Filtering)
- **严禁使用泛通配选择器**：禁止使用类似 `[class*="subtitle"]`、`[class*="caption"]` 等未经排除的选择器。必须排除所有播放器控制条、工具栏、按钮：
  `el.closest('button, [role="button"], [class*="Toolbar"], [class*="toolbar"], [class*="Control"], [class*="control"], [class*="menu"], [class*="setting"], [class*="tips"]')`。
- **严防状态锁死 (Deadlock Guard)**：严禁使用 `if (cues.length === 0)` 作为阻止扫描 `TextTrack` 的永久拦截条件。若因首帧或误抓导致条数为 1，必须允许真实 `track.cues.length > 1` 的大批量字幕覆盖更新。
- **播放器功能词黑名单**：台词校验函数 `isValidSubtitleText()` 必须过滤：`字幕`、`选集`、`倍速`、`画质`、`全屏`、`设置`、`清晰度`、`弹幕`、`画中画`、`高清` 等常用 UI 按钮文本。
- **保护正常富文本修饰**：不得因为字幕包含 `<i>`、`</b>`、`</font>` 等正常样式标签而误判整句台词无效。

### 1.3 跨视频生命周期与状态严格隔离 (Cross-Video Isolation & Ad Lifecycle)
- **视频 ID 强绑定与安全清空**：字幕抓取、全片精翻及缓存必须与当前宿主 `videoId` 强绑定。一旦检测到视频切换（SPA 路由切换或全页刷新），必须立即清空前序视频的台词、当前播放时间及 AI 翻译状态，严禁前序视频的字幕或已精翻数据泄漏至新视频中。
- **广告生命周期隔离与正片还原**：YouTube 等平台播放贴片广告（Pre-roll / Mid-roll）时，必须暂存正片主字幕与标题，临时显示广告台词；待广告播放完毕（`isAdPlaying: false`），必须无缝恢复真实视频的原有字幕与标题，严禁将广告词持久化写入正片缓存。

---

## 2. Chrome MV3 插件与 Shadow DOM 隔离规范

- **样式完全隔离 (Shadow DOM Isolation)**：所有插件 UI（字幕浮层、侧边栏、快捷按钮组、单词弹窗）必须挂载在 `<language-reactor-overlay>` 的 `shadowRoot` 内部，坚决防止宿主网页全局 CSS 污染插件样式。
- **安全拖拽与防脱手交互**：
  - 字幕浮层上下拖动时，需动态激活全屏透明遮罩 (`fixed inset-0 cursor-row-resize z-[999999]`)，彻底隔离底层视频点击、进度条拖拽事件，防止快速拖动脱手；
  - 必须限制拖动边界（如 `3% ~ 80%`），提供双击手柄复位至默认位置（`8%`），并通过 `localStorage` 自动记忆用户拖拽偏好。
- **高对比度视觉质感**：
  - 字幕文本必须应用 `.lr-text-shadow`（`0 0 7px rgba(0,0,0,0.95), 0 0 16px rgba(0,0,0,0.75)`），确保在白色或高动态复杂视频画面下依然字迹锐利。

### 2.1 视频画面零干扰沉浸准则 (Zero Video Clutter & Immersion Principle)
- **严禁在视频画面内部渲染常驻悬浮工具条/状态栏**：
  无论是夸克网盘、YouTube 还是 Bilibili，视频播放画面（包括左上角、右上角、字幕顶部等区域）严禁渲染带有标题、模式切换、导入按钮、字号调节等控件的浮动黑条。
- **清晰的界面分区与职责收敛**：
  1. **视频画面区**：只允许保留纯净的沉浸式双语字幕自身及右侧微型拖拽手柄；
  2. **右侧台词侧边栏 (`TranscriptPanel`)**：承载台词列表、AI 精翻、词汇表、导入字幕、导出 Anki/JSON 以及右上角 `⚙ 设置` 按钮；
  3. **设置模态弹窗 (`BasicSettingsModal`)**：收纳所有全局配置、AI 密钥设置、字幕源选择、导入本地字幕、演示字幕、字号与显示模式切换；
  4. **原生控制栏轻量挂载 (`nativeControl`)**：仅在播放器底部原生控制条（如 YouTube `.ytp-right-controls` 或 Bilibili 右下控制栏）中以极简图标的形式挂载开关与设置入口，随宿主控制栏自然隐藏。

### 2.2 生词查词拓展例句 ESL 深度教学规范 (AI Extended Examples Standard)
- **按需触发与即时回显**：用户在查词弹窗中点击【拓展例句】选项卡时，若未加载过例句则自动触发 AI 生成；若已存在则直接 0ms 瞬间显示。
- **三卡片完整教学结构**：每条拓展例句必须包含：英文原句（目标生词高亮）、整句语音朗读（`AudioButton`）、地道中文译文、深入【📖 词义用法解析】（点明当前语境语义与搭配）和【🔍 语法结构解析】（剖析句法功能与成分）。
- **本地持久缓存与换一批**：生成结果需持久化存入词典本地缓存，并提供「重新生成」按需刷新机制。

### 2.3 播放感知流式翻译优先调度准则 (Playback-Aware Priority Scheduling)
- **当前播放句秒级优先替换**：执行全片 AI 双语精翻或中英混合精翻时，必须接入时间感知优先级队列（`PriorityBatchQueue`），首个批次（Batch 0）必须抢占调度包含当前播放时间（`currentTime`）的句子及紧随视窗，实现 1 秒内优先精翻替换。
- **快进快退实时打断与插队 (Seek Preemption)**：用户拖拽视频进度条快进快退时，后台流式调度器必须立即响应时间变更，打断当前等待延时，并将跳转后的新视窗立即插队到下一批次优先翻译。

---

## 3. 自动化测试与构建验收要求

- **单元测试覆盖**：每次修改字幕解析器、分词词典、时间轴同步引擎或嗅探模块后，必须执行：
  ```bash
  bun test tests/
  ```
  确保所有测试用例（SRT/VTT/ASS 解析、时间戳折算、分词及 CEFR 难度分级、同步二分查找等）100% 通过。
- **构建完整性**：必须执行：
  ```bash
  bun run build
  ```
  确保 Chrome MV3 打包产物（manifest.json、content-scripts、popup、background.js）零警告零报错输出。
