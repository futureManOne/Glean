import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright-core';

const outputDir = path.resolve('scratch/logo_preview');

const masterSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <!-- Background Gradient: Deep Obsidian & Cyber Slate -->
    <linearGradient id="glean-bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#182332" />
      <stop offset="50%" stop-color="#0f1724" />
      <stop offset="100%" stop-color="#070c12" />
    </linearGradient>

    <!-- Chamfer Rim Light: Gives physical edge definition in dark & light browser chrome -->
    <linearGradient id="glean-rim" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="rgba(255, 255, 255, 0.48)" />
      <stop offset="35%" stop-color="rgba(56, 189, 248, 0.35)" />
      <stop offset="70%" stop-color="rgba(16, 185, 129, 0.2)" />
      <stop offset="100%" stop-color="rgba(255, 255, 255, 0.08)" />
    </linearGradient>

    <!-- Viewfinder Brackets: Electric Cyan to Emerald Gradient -->
    <linearGradient id="glean-bracket" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8" />
      <stop offset="45%" stop-color="#22d3ee" />
      <stop offset="100%" stop-color="#34d399" />
    </linearGradient>

    <!-- Inner Ambient Teal Radiance -->
    <radialGradient id="glean-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#06b6d4" stop-opacity="0.30" />
      <stop offset="60%" stop-color="#06b6d4" stop-opacity="0.06" />
      <stop offset="100%" stop-color="#06b6d4" stop-opacity="0" />
    </radialGradient>

    <!-- Glean Spark of Insight Gradient -->
    <linearGradient id="glean-gold" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fef08a" />
      <stop offset="35%" stop-color="#fbbf24" />
      <stop offset="100%" stop-color="#f59e0b" />
    </linearGradient>

    <!-- Spark Bloom Glow -->
    <filter id="glean-spark-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="2.2" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  </defs>

  <!-- Container Squircle with Precision Chamfer Rim -->
  <rect x="3" y="3" width="122" height="122" rx="28" fill="url(#glean-bg)" stroke="url(#glean-rim)" stroke-width="2.5" />
  
  <!-- Subtle Ambient Glow -->
  <circle cx="64" cy="64" r="52" fill="url(#glean-glow)" />

  <!-- High-Precision Viewfinder Brackets -->
  <g fill="none" stroke="url(#glean-bracket)" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">
    <!-- Top-Left -->
    <path d="M 28 42 V 34 C 28 29.5 30.5 27 35 27 H 48" />
    <!-- Top-Right -->
    <path d="M 80 27 H 93 C 97.5 27 100 29.5 100 34 V 42" />
    <!-- Bottom-Left -->
    <path d="M 28 86 V 94 C 28 98.5 30.5 101 35 101 H 48" />
    <!-- Bottom-Right -->
    <path d="M 80 101 H 93 C 97.5 101 100 98.5 100 94 V 86" />
  </g>

  <!-- Bilingual Subtitle Bars (High Contrast & Clear Hierarchy) -->
  <!-- Top Line: Primary Language Subtitle (Pure Luminous White) -->
  <line x1="41" y1="52.5" x2="87" y2="52.5" stroke="#ffffff" stroke-width="9.5" stroke-linecap="round" />
  <!-- Bottom Line: Secondary Translated Subtitle (Soft Luminous Cyan) -->
  <line x1="41" y1="73.5" x2="68" y2="73.5" stroke="#7dd3fc" stroke-width="9.5" stroke-linecap="round" />

  <!-- Glean Spark of Insight (拾句灵感之星) -->
  <g filter="url(#glean-spark-glow)">
    <!-- 4-point Diamond Flare -->
    <path d="M 87 62.5 Q 87 73.5 97 73.5 Q 87 73.5 87 84.5 Q 87 73.5 77 73.5 Q 87 73.5 87 62.5 Z" fill="url(#glean-gold)" />
    <!-- Golden Core for micro-size presence -->
    <circle cx="87" cy="73.5" r="4.8" fill="#fde047" />
    <!-- Center Radiance -->
    <circle cx="87" cy="73.5" r="2.2" fill="#ffffff" />
  </g>
</svg>`;

fs.writeFileSync(path.join(outputDir, 'master.svg'), masterSvg, 'utf8');

const browser = await chromium.launch({ headless: true });

// Render the 5 standard sizes: 16, 32, 48, 96, 128
for (const size of [16, 32, 48, 96, 128]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<!DOCTYPE html><html><body style="margin:0;overflow:hidden;background:transparent;"><div style="width:${size}px;height:${size}px;">${masterSvg}</div></body></html>`);
  await page.screenshot({ path: path.join(outputDir, `master_${size}.png`), omitBackground: true });
  await page.close();
}

// Generate the final presentation image
const finalPage = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 });
const b64_orig = fs.readFileSync(path.join(outputDir, 'original.svg')).toString('base64');
const b64_new_128 = fs.readFileSync(path.join(outputDir, 'master_128.png')).toString('base64');
const b64_new_48 = fs.readFileSync(path.join(outputDir, 'master_48.png')).toString('base64');
const b64_new_32 = fs.readFileSync(path.join(outputDir, 'master_32.png')).toString('base64');
const b64_new_16 = fs.readFileSync(path.join(outputDir, 'master_16.png')).toString('base64');

await finalPage.setContent(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    body { background: #0b0f17; color: #f1f5f9; padding: 40px; }
    .header { margin-bottom: 32px; }
    h1 { font-size: 26px; font-weight: 700; color: #38bdf8; margin-bottom: 8px; }
    p { color: #94a3b8; font-size: 14px; }
    
    .compare-container { display: flex; gap: 32px; margin-bottom: 36px; }
    .compare-card { flex: 1; background: #131c28; border: 1px solid #1e293b; border-radius: 20px; padding: 28px; display: flex; flex-direction: column; align-items: center; }
    .compare-card.new { border-color: #0284c7; box-shadow: 0 0 40px rgba(2, 132, 199, 0.22); background: #142030; }
    
    .tag { font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 12px; margin-bottom: 20px; }
    .tag.old { background: #334155; color: #cbd5e1; }
    .tag.new { background: #0284c7; color: #f0f9ff; }
    
    .icon-view { width: 140px; height: 140px; margin-bottom: 20px; }
    .icon-view img, .icon-view svg { width: 100%; height: 100%; filter: drop-shadow(0 12px 24px rgba(0,0,0,0.6)); }
    
    .title { font-size: 18px; font-weight: 600; margin-bottom: 12px; color: #f8fafc; }
    .features { list-style: none; font-size: 13px; color: #94a3b8; line-height: 1.8; text-align: left; width: 100%; }
    .features li { display: flex; align-items: center; gap: 8px; }
    .features li::before { content: "•"; color: #38bdf8; font-weight: bold; }
    
    .env-row { display: flex; gap: 24px; }
    .env-card { flex: 1; padding: 20px 24px; border-radius: 16px; border: 1px solid #2e384d; }
    .env-dark { background: #202124; }
    .env-light { background: #f1f3f4; color: #202124; }
    .env-title { font-size: 13px; font-weight: 600; margin-bottom: 14px; }
    .env-dark .env-title { color: #e8eaed; }
    .env-sim { display: flex; align-items: center; gap: 24px; padding: 12px 18px; border-radius: 12px; background: rgba(0,0,0,0.25); }
    .env-light .env-sim { background: rgba(255,255,255,0.8); border: 1px solid #dadce0; }
    .env-item { display: flex; flex-direction: column; align-items: center; gap: 8px; font-size: 11px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Glean (拾句) Logo 优化升级设计定稿</h1>
    <p>传承原有取景嗅探框与双语学习内核，打造现代质感极客视觉，全面解决暗色模式融合与微缩辨识度痛点</p>
  </div>

  <div class="compare-container">
    <!-- Old -->
    <div class="compare-card">
      <span class="tag old">原有旧版 (Current)</span>
      <div class="icon-view">
        <img src="data:image/svg+xml;base64,${b64_orig}" />
      </div>
      <div class="title">平涂低对比度设计</div>
      <ul class="features">
        <li>#111719 纯黑背景，在暗色浏览器工具栏几乎无轮廓边界</li>
        <li>90° 生硬折线，缺乏数码精密感与倒角圆润度</li>
        <li>孤立平涂黄色小圆点，在 16px 下模糊如斑点</li>
      </ul>
    </div>

    <!-- New -->
    <div class="compare-card new">
      <span class="tag new">全新升级版 (Master Refinement)</span>
      <div class="icon-view">
        <img src="data:image/png;base64,${b64_new_128}" />
      </div>
      <div class="title">光影高光视窗 + 拾句星芒</div>
      <ul class="features">
        <li><b>超细反差边缘光 (Chamfer Rim)</b>：彻底隔离宿主暗色背景，立体轮廓呼之欲出</li>
        <li><b>电光青绿流体圆角 (Electric Cyan-Emerald)</b>：精密 AI 镜头取景质感</li>
        <li><b>分层双语台词条</b>：纯净皓月白 + 冰川透亮青，学习层级一目了然</li>
        <li><b>拾句灵感四角星芒 (✦)</b>：聚光核心 + 渐变星芒，微缩尺寸闪亮醒目</li>
      </ul>
    </div>
  </div>

  <!-- Real browser mockups -->
  <div class="env-row">
    <div class="env-card env-dark">
      <div class="env-title">Chrome 暗色工具栏 (#202124) 真实表现</div>
      <div class="env-sim">
        <div class="env-item" style="color: #9aa0a6;">
          <img src="data:image/svg+xml;base64,${b64_orig}" style="width:24px;height:24px;" />
          <span>旧版 (融底)</span>
        </div>
        <div style="width:1px;height:32px;background:#3c4043;"></div>
        <div class="env-item" style="color:#38bdf8;font-weight:600;">
          <img src="data:image/png;base64,${b64_new_48}" style="width:24px;height:24px;" />
          <span>全新版 (清晰立体)</span>
        </div>
        <div class="env-item" style="color:#38bdf8;">
          <img src="data:image/png;base64,${b64_new_16}" style="width:16px;height:16px;" />
          <span>16px 极限</span>
        </div>
      </div>
    </div>

    <div class="env-card env-light">
      <div class="env-title">Chrome 浅色工具栏 (#F1F3F4) 真实表现</div>
      <div class="env-sim">
        <div class="env-item" style="color: #5f6368;">
          <img src="data:image/svg+xml;base64,${b64_orig}" style="width:24px;height:24px;" />
          <span>旧版</span>
        </div>
        <div style="width:1px;height:32px;background:#dadce0;"></div>
        <div class="env-item" style="color:#0284c7;font-weight:600;">
          <img src="data:image/png;base64,${b64_new_48}" style="width:24px;height:24px;" />
          <span>全新版</span>
        </div>
        <div class="env-item" style="color:#0284c7;">
          <img src="data:image/png;base64,${b64_new_16}" style="width:16px;height:16px;" />
          <span>16px 极限</span>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`);

const finalPath = path.join(outputDir, 'final_presentation.png');
await finalPage.screenshot({ path: finalPath, fullPage: true });
console.log('Saved final presentation to:', finalPath);

await browser.close();
