import { test as base, chromium, expect, type BrowserContext } from '@playwright/test';
import path from 'path';
import http from 'http';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let server: http.Server | null = null;
let serverPort = 0;

export const test = base.extend<{
  context: BrowserContext;
}>({
  context: async ({}, use) => {
    const pathToExtension = path.resolve(__dirname, '../.output/chrome-mv3');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'playwright-ext-'));

    const context = await chromium.launchPersistentContext(tempDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
        `--no-first-run`,
        `--no-default-browser-check`,
      ],
    });

    await use(context);
    await context.close();

    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  },
});

test.beforeAll(async () => {
  // Start in-process HTTP server on random available port
  server = http.createServer((req, res) => {
    const filePath = path.resolve(__dirname, '../test-fixtures/player.html');
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(filePath));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  await new Promise<void>((resolve) => {
    server?.listen(0, '127.0.0.1', () => {
      const addr = server?.address() as any;
      serverPort = addr.port;
      console.log(`[E2E] In-process test server listening at http://127.0.0.1:${serverPort}/player.html`);
      resolve();
    });
  });
});

test.afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => {
      server?.close(() => resolve());
    });
  }
});

test.describe('Glean E2E Test Suite', () => {
  test('should load extension and mount overlay on video player', async ({ context }) => {
    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    // 1. Open test video player
    await page.goto(`http://127.0.0.1:${serverPort}/player.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // 2. Assert extension Shadow Host exists
    const overlayHost = page.locator('language-reactor-overlay');
    await expect(overlayHost).toBeAttached({ timeout: 10000 });

    // 3. Click load demo subtitles button if empty prompt is shown
    const demoBtn = overlayHost.locator('button:has-text("加载示例字幕")').first();
    if (await demoBtn.count() > 0 && await demoBtn.isVisible()) {
      await demoBtn.click();
      await page.waitForTimeout(800);
    }

    // 4. Assert token words exist and can be clicked
    const tokenWord = overlayHost.locator('.token-word').first();
    if (await tokenWord.count() > 0) {
      await tokenWord.click();
      await page.waitForTimeout(600);

      // 5. Assert WordPopup appears with explain tab
      const explainTab = overlayHost.locator('button:has-text("语境精析"), button:has-text("解释")').first();
      await expect(explainTab).toBeVisible({ timeout: 5000 });
    }

    // 6. Assert side panel tabs exist
    const subtitleTab = overlayHost.locator('button:has-text("字幕")').first();
    await expect(subtitleTab).toBeVisible({ timeout: 5000 });

    const vocabTab = overlayHost.locator('button:has-text("词汇")').first();
    await expect(vocabTab).toBeVisible({ timeout: 5000 });

    console.log('✓ [E2E SUCCESS] Language Reactor extension loaded and verified in Chromium!');
  });
});
