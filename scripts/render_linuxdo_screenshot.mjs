import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const htmlContent = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>Glean 拾句 - LINUX DO 介绍</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      padding: 40px;
      display: flex;
      justify-content: center;
    }
    .card {
      width: 800px;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 16px;
      padding: 36px 40px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
    }
    .header {
      border-bottom: 1px solid #334155;
      padding-bottom: 24px;
      margin-bottom: 24px;
    }
    .badge {
      display: inline-block;
      background: #3b82f6;
      color: #ffffff;
      font-size: 13px;
      font-weight: 600;
      padding: 4px 12px;
      border-radius: 9999px;
      margin-bottom: 12px;
    }
    h1 {
      font-size: 28px;
      color: #f8fafc;
      margin-bottom: 12px;
      font-weight: 700;
    }
    .intro {
      font-size: 15px;
      line-height: 1.7;
      color: #cbd5e1;
      margin-bottom: 16px;
    }
    .pain-points {
      background: #0f172a;
      border-left: 4px solid #ef4444;
      padding: 14px 18px;
      border-radius: 0 8px 8px 0;
      margin: 16px 0 20px 0;
      font-size: 14px;
      color: #94a3b8;
      line-height: 1.6;
    }
    .pain-points li { margin-left: 18px; margin-bottom: 6px; }
    h2 {
      font-size: 20px;
      color: #38bdf8;
      margin: 28px 0 16px 0;
      display: flex;
      align-items: center;
      gap: 8px;
      border-bottom: 1px solid #334155;
      padding-bottom: 8px;
    }
    .feature-item {
      margin-bottom: 16px;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 16px;
    }
    .feature-title {
      font-size: 16px;
      font-weight: 600;
      color: #f1f5f9;
      margin-bottom: 8px;
    }
    .feature-desc {
      font-size: 14px;
      line-height: 1.6;
      color: #94a3b8;
    }
    .feature-desc strong {
      color: #e2e8f0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
      font-size: 14px;
    }
    th, td {
      border: 1px solid #334155;
      padding: 10px 14px;
      text-align: left;
    }
    th {
      background: #0f172a;
      color: #38bdf8;
    }
    kbd {
      background: #334155;
      color: #f8fafc;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 12px;
      border: 1px solid #475569;
    }
    .code-box {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 14px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
      color: #38bdf8;
      margin: 12px 0;
      line-height: 1.5;
    }
    .footer-note {
      margin-top: 28px;
      padding-top: 18px;
      border-top: 1px solid #334155;
      text-align: center;
      font-size: 13px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <span class="badge">开源 Chrome 扩展 · MV3</span>
      <h1>Glean (拾句) - 沉浸式双语视频学习神器</h1>
      <p class="intro">
        各位佬友们好！平时经常在 YouTube、B 站看技术公开课，或者在夸克网盘里看生肉美剧。之前用过各类商业字幕扩展，但体验上总有些遗憾：
      </p>
      <div class="pain-points">
        <ul>
          <li>很多进阶功能都要订阅付费（Pro 订阅门槛高）；</li>
          <li>依赖云端黑盒服务，经常抽风，隐私也有顾虑；</li>
          <li>不支持夸克网盘等国内常用网盘网页版的生肉刷剧；</li>
          <li>无法自由接入自己手里现成的 OpenAI / DeepSeek / Gemini 等模型 API Key。</li>
        </ul>
      </div>
      <p class="intro">
        于是自己用 <strong>WXT + React 18 + TypeScript + Zustand + Tailwind</strong> 搓了这款<strong>完全开源、免费、隐私优先</strong>的双语学习扩展。
      </p>
    </div>

    <h2>🌟 核心功能亮点</h2>

    <div class="feature-item">
      <div class="feature-title">🎬 1. 深度适配三大平台（夸克网盘 / YouTube / B 站）</div>
      <div class="feature-desc">
        • <strong>夸克网盘网页版生肉刷剧</strong>：自动探测内嵌与外挂字幕，支持双语/混合批注，网盘直接变身英语学习利器。<br>
        • <strong>YouTube & Bilibili 官方支持</strong>：原生 ASR 自动生成字幕去重对齐、主世界网络拦截，广告期自动隔离。<br>
        • <strong>本地字幕直接拖拽</strong>：没有字幕的视频，直接把本地 .srt / .vtt / .ass 拖进网页即可秒级加载。
      </div>
    </div>

    <div class="feature-item">
      <div class="feature-title">📦 2. 离线优先 & 隐私第一（内置 4.2 万 ECDICT 离线词库）</div>
      <div class="feature-desc">
        • <strong>完全断网也能用</strong>：内置 42,978 条核心词库 + 94,108 条词形还原（动词变形、复数等自动溯源原型），逐词可点即查。<br>
        • <strong>绝对隐私保护</strong>：无注册、无登录、零统计埋点。如果不开启 AI，100% 纯本地运行；开启 AI 后密钥仅存本地 storage。
      </div>
    </div>

    <div class="feature-item">
      <div class="feature-title">🤖 3. 自由接入大模型（OpenAI 兼容 / 自建网关 / Gemini / DeepSeek）</div>
      <div class="feature-desc">
        • <strong>单词语境精析</strong>：结合当前句说话人真实意图、语体色彩与句法角色深入拆解。<br>
        • <strong>单句精讲与语法剖析</strong>：剖析地道语气、主谓宾结构、连读弱读技巧。<br>
        • <strong>播放感知流式全片精翻</strong>：后台翻译全片，但首个批次必定抢占当前播放台词（1秒内秒级替换）；拖动进度条立即插队优先翻译。
      </div>
    </div>

    <div class="feature-item">
      <div class="feature-title">🎚️ 4. 零侵入设计与专业交互</div>
      <div class="feature-desc">
        • <strong>画面零遮挡</strong>：视频内绝无常驻黑条，控件轻量嵌入原生播放器控制栏，随控制栏自然隐藏；Shadow DOM 样式彻底物理隔离。<br>
        • <strong>5 态字幕循环（C 键）</strong>：双语 ➔ 中英混合 ➔ 仅外语 ➔ 仅译文 ➔ 隐藏。<br>
        • <strong>听力磨砂遮罩</strong>：译文默认虚化，鼠标悬停才显示，强制训练先盲听。<br>
        • <strong>跟读与导出</strong>：S 键瞬间重播，Z 键单句死磕循环；支持一键导出 Anki TSV、SRT、PDF、CSV。
      </div>
    </div>

    <h2>⌨️ 常用快捷键</h2>
    <table>
      <thead>
        <tr><th>快捷键</th><th>功能</th><th>说明</th></tr>
      </thead>
      <tbody>
        <tr><td><kbd>A</kbd> / <kbd>D</kbd></td><td>上一句 / 下一句</td><td>快速前后跳转台词</td></tr>
        <tr><td><kbd>S</kbd></td><td>重播当前句</td><td>立刻从头重听当前这句</td></tr>
        <tr><td><kbd>Z</kbd></td><td>单句循环</td><td>锁定当前句无限复读磨耳朵</td></tr>
        <tr><td><kbd>C</kbd></td><td>字幕模式循环</td><td>双语 / 混合 / 仅外语 / 仅译文 / 隐藏</td></tr>
        <tr><td><kbd>V</kbd></td><td>字幕总开关</td><td>一键隐藏 / 恢复全部字幕层</td></tr>
        <tr><td><kbd>E</kbd></td><td>提词侧边栏</td><td>展开或收起右侧实时台词面板</td></tr>
      </tbody>
    </table>

    <h2>🚀 快速开始与构建</h2>
    <div class="code-box">
      git clone https://github.com/futureManOne/Glean.git<br>
      cd Glean<br>
      bun install   # 安装依赖<br>
      bun run build # 构建 Chrome MV3 产物（输出到 .output/chrome-mv3）
    </div>

    <div class="footer-note">
      Glean (拾句) · 开源遵循 MIT License · 欢迎佬友在 GitHub 交流提 Issue 🌟
    </div>
  </div>
</body>
</html>
`;

async function main() {
  const outputPath = path.resolve('docs/screenshots/linuxdo-intro.png');
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  });
  const page = await browser.newPage({
    viewport: { width: 900, height: 1600 },
    deviceScaleFactor: 2 // 2x Retina quality
  });

  await page.setContent(htmlContent, { waitUntil: 'networkidle' });
  const cardElement = await page.$('.card');
  if (cardElement) {
    await cardElement.screenshot({ path: outputPath });
    console.log('Successfully generated screenshot at:', outputPath);
  } else {
    await page.screenshot({ path: outputPath, fullPage: true });
    console.log('Full page screenshot saved at:', outputPath);
  }
  await browser.close();
}

main().catch(err => {
  console.error('Error generating screenshot:', err);
  process.exit(1);
});
