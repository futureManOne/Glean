import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright-core';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const candASvg = fs.readFileSync('scratch/logo_preview/refined_a.svg', 'utf8');

  for (const size of [16, 32, 48, 96, 128]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<!DOCTYPE html><html><body style="margin:0;overflow:hidden;background:transparent;"><div style="width:${size}px;height:${size}px;">${candASvg}</div></body></html>`);
    await page.screenshot({ path: `scratch/logo_preview/test_${size}.png`, omitBackground: true });
    await page.close();
  }

  const b64_16 = fs.readFileSync('scratch/logo_preview/test_16.png').toString('base64');
  const b64_32 = fs.readFileSync('scratch/logo_preview/test_32.png').toString('base64');
  const b64_48 = fs.readFileSync('scratch/logo_preview/test_48.png').toString('base64');

  const page = await browser.newPage({ viewport: { width: 900, height: 350 }, deviceScaleFactor: 2 });
  await page.setContent(`<!DOCTYPE html><html><body style="background:#202124;color:#f1f5f9;font-family:sans-serif;padding:32px;">
    <h3 style="font-size:16px;margin-bottom:20px;color:#38bdf8;">微小尺寸在 Chrome 暗色模式 (#202124) 下的像素与边缘表现</h3>
    <div style="display:flex;gap:36px;align-items:flex-end;margin-top:20px;">
      <div>
        <div style="font-size:12px;color:#94a3b8;margin-bottom:8px;">16px 原大 (1x):</div>
        <img src="data:image/png;base64,${b64_16}" style="width:16px;height:16px;" />
      </div>
      <div>
        <div style="font-size:12px;color:#94a3b8;margin-bottom:8px;">16px 放大 6倍:</div>
        <img src="data:image/png;base64,${b64_16}" style="width:96px;height:96px;image-rendering:pixelated;" />
      </div>
      <div>
        <div style="font-size:12px;color:#94a3b8;margin-bottom:8px;">32px 原大 (1x):</div>
        <img src="data:image/png;base64,${b64_32}" style="width:32px;height:32px;" />
      </div>
      <div>
        <div style="font-size:12px;color:#94a3b8;margin-bottom:8px;">32px 放大 3倍:</div>
        <img src="data:image/png;base64,${b64_32}" style="width:96px;height:96px;image-rendering:pixelated;" />
      </div>
      <div>
        <div style="font-size:12px;color:#94a3b8;margin-bottom:8px;">48px 原大 (1x):</div>
        <img src="data:image/png;base64,${b64_48}" style="width:48px;height:48px;" />
      </div>
    </div>
  </body></html>`);
  await page.screenshot({ path: 'scratch/logo_preview/zoom_inspection.png' });
  await page.close();
  await browser.close();
  console.log('Zoom inspection updated successfully.');
})();
