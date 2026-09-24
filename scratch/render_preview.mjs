import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';

const outputDir = path.resolve('scratch/logo_preview');
const previewPath = path.join(outputDir, 'preview.html');

console.log('Launching Chromium via Node.js...');
const browser = await chromium.launch({ headless: true });
console.log('Browser launched. Rendering preview.html...');

const page = await browser.newPage({
  viewport: { width: 1200, height: 950 },
  deviceScaleFactor: 2
});

await page.goto('file:///' + previewPath.replace(/\\/g, '/'));
await page.waitForTimeout(300);

const screenshotPath = path.join(outputDir, 'comparison_preview.png');
await page.screenshot({ path: screenshotPath, fullPage: true });
console.log('Saved comparison preview image to:', screenshotPath);
await page.close();

// Render Candidate 1 to multi-size PNGs
const cand1SvgPath = path.join(outputDir, 'candidate1.svg');
const cand1SvgContent = fs.readFileSync(cand1SvgPath, 'utf8');

for (const size of [128, 96, 48, 32, 16]) {
  const iconPage = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1
  });
  await iconPage.setContent(`
    <!DOCTYPE html>
    <html>
    <head><style>*{margin:0;padding:0;overflow:hidden;background:transparent;}</style></head>
    <body>
      <div style="width:${size}px;height:${size}px;display:flex;">
        ${cand1SvgContent}
      </div>
    </body>
    </html>
  `);
  const iconPngPath = path.join(outputDir, `candidate1_${size}.png`);
  await iconPage.screenshot({ path: iconPngPath, omitBackground: true });
  console.log(`Rendered candidate1_${size}.png`);
  await iconPage.close();
}

await browser.close();
console.log('All rendering finished successfully!');
