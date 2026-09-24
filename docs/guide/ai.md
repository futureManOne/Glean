# AI 双语精翻与 Seek 抢占

Glean (拾句) 支持接入主流大语言模型，将生硬死板的机器字幕转化为地道、符合中文表达习惯的高质量双语精翻。

---

## ⚡ 独创技术：Seek 抢占优先队列

传统双语插件在处理全片字幕翻译时，往往按顺序逐句提交。当视频较长时，前几分钟还在排队，用户快进到关键段落时根本无法获得翻译。

Glean 独创了 **时间感知优先级队列 (`PriorityBatchQueue`)**：
1. **当前帧秒级抢占**：队列首个批次必定调度包含当前播放时间（`currentTime`）的句子及随后的视窗；
2. **快进快退实时打断 (Seek Preemption)**：用户拖拽视频进度条时，后台调度器立即响应时间变更，打断当前等待延时，并将跳转后的新视窗立即插队到下一批次优先翻译。

---

## 🤖 支持的模型预设

在设置面板中可自由选择：

- **Google Gemini**：`https://generativelanguage.googleapis.com/v1beta/openai`（默认 `gemini-2.5-flash`，免费额度大）
- **DeepSeek**：`https://api.deepseek.com/v1`（`deepseek-chat`，性价比极高，中文表达极度地道）
- **OpenAI**：`https://api.openai.com/v1`（`gpt-4o-mini`）
- **自定义网关**：可填入任意兼容 OpenAI 的 Base URL 与模型名称。
