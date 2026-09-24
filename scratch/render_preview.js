const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

// Run generate_candidates first
require('./generate_candidates.js');

(async () => {
  const outputDir = path.resolve('scratch/logo_preview');
  const previewPath = path.join(outputDir, 'preview.html');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1200, height: 900 },
    deviceScaleFactor: 2 // 2x retina for crisp comparison
  });

  await page.goto('file:///' + previewPath.replace(/\\/g, '/'));
  await page.waitForTimeout(500);

  const screenshotPath = path.join(outputDir, 'comparison_preview.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log('Saved comparison preview image to:', screenshotPath);

  // Render Candidate 1 to multi-size PNGs to test quality
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
      <body style="margin:0;padding:0;background:transparent;overflow:hidden;">
        <div style="width:${size}px;height:${size}px;">
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
  console.log('Rendering complete!');
})();
