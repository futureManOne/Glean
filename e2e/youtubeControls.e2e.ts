import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';

// Load the real MV3 extension against a deterministic YouTube-shaped watch page.
// No external video, AI credentials or gateway are needed for these UI regressions.
const fixture = `<!doctype html><html><head><meta charset="utf-8"><title>Player controls regression - YouTube</title>
<style>html{font-size:10px}body{margin:0;background:#0f0f0f;color:white;font:16px sans-serif}main{display:flex;gap:24px;padding:72px 24px}
#movie_player{position:relative;width:800px;height:450px;background:#333}video{width:800px;height:450px}
.ytp-chrome-bottom{position:absolute;bottom:0;right:0;height:48px;background:#1118}.ytp-right-controls{height:48px;display:flex;align-items:center}
#secondary{width:390px;height:1000px}button{cursor:pointer}</style></head><body><main>
<div id="movie_player" class="html5-video-player"><video class="html5-main-video"></video>
<div class="ytp-chrome-bottom"><div class="ytp-right-controls"><button>原生设置</button><button>全屏</button></div></div></div>
<div id="secondary"><p>推荐视频占位</p></div></main></body></html>`;
let context: BrowserContext;

test.beforeEach(async () => {
  const extension = path.resolve('.output/chrome-mv3');
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true, viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  await context.route('https://www.youtube.com/**', route => route.request().isNavigationRequest()
    ? route.fulfill({ contentType: 'text/html', body: fixture })
    : route.fulfill({ contentType: 'application/json', body: '{}' }));
});
test.afterEach(async () => { await context?.close(); });

test('YouTube never displays a floating top toolbar while enabled', async () => {
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/watch?v=FgatKxfAACY');
  await expect(page.getByRole('button', { name: '打开 Glean 拾句 设置' })).toBeVisible();
  await expect(page.locator('button[title="单句循环跟读模式"]')).toHaveCount(0);
  await expect(page.locator('.ytp-right-controls').getByRole('button', { name: '打开 Glean 拾句 设置' })).toBeVisible();
  await page.screenshot({ path: 'test-results/youtube-controls.png' });
});

test('settings language switch updates modal labels in all three languages', async () => {
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/watch?v=FgatKxfAACY');
  await page.getByRole('button', { name: '打开 Glean 拾句 设置' }).click();
  const languageButtons = page.locator('[role="dialog"] button').filter({ hasText: /简体中文|English|日本語/ });
  await languageButtons.filter({ hasText: 'English' }).click();
  await expect(page.getByRole('heading', { name: 'Glean Settings' })).toBeVisible();
  await expect(page.getByText('UI Language', { exact: true })).toBeVisible();
  await languageButtons.filter({ hasText: '日本語' }).click();
  await expect(page.getByRole('heading', { name: 'Glean（拾句）設定' })).toBeVisible();
  await expect(page.getByText('表示言語', { exact: true })).toBeVisible();
  await languageButtons.filter({ hasText: '简体中文' }).click();
  await expect(page.getByRole('heading', { name: 'Glean 拾句 设置' })).toBeVisible();
});

test('off then on restores the transcript automatically and controls survive replacement', async () => {
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/watch?v=FgatKxfAACY');
  const tab = page.getByRole('button', { name: '字幕列表', exact: true });
  await expect(tab).toBeVisible();
  await expect(page.locator('#secondary [data-vocabframe-transcript]')).toBeVisible();
  await expect(page.locator('[data-vocabframe-transcript]')).toHaveCSS('position', 'relative');
  await expect(page.getByText('推荐视频占位', { exact: true })).toBeHidden();
  for (let index = 0; index < 3; index++) {
    await page.getByRole('switch', { name: '关闭 Glean 拾句', exact: true }).click();
    await expect(tab).toHaveCount(0);
    await expect(page.locator('#secondary')).toHaveCSS('visibility', 'visible');
    await expect(page.getByText('推荐视频占位', { exact: true })).toBeVisible();
    await page.getByRole('switch', { name: '开启 Glean 拾句', exact: true }).click();
    await expect(tab).toBeVisible();
    await expect(page.locator('#secondary [data-vocabframe-transcript]')).toBeVisible();
  }
  await page.evaluate(() => {
    const secondary = document.querySelector('#secondary')!;
    const replacement = document.createElement('div');
    replacement.id = 'secondary';
    replacement.innerHTML = '<p>推荐视频占位</p>';
    secondary.replaceWith(replacement);
  });
  await expect(page.locator('#secondary [data-vocabframe-transcript]')).toBeVisible();
  await page.evaluate(() => {
    const controls = document.querySelector('.ytp-right-controls')!;
    const replacement = document.createElement('div');
    replacement.className = 'ytp-right-controls';
    controls.replaceWith(replacement);
  });
  await expect(page.getByRole('button', { name: '打开 Glean 拾句 设置' })).toHaveCount(1);
  await page.getByRole('button', { name: '打开 Glean 拾句 设置' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '切换台词侧边栏', exact: true }).click();
  await expect(page.locator('#secondary [data-vocabframe-transcript]')).toHaveCount(0);
  await page.getByRole('button', { name: '切换台词侧边栏', exact: true }).click();
  await expect(page.locator('#secondary [data-vocabframe-transcript]')).toHaveCount(1);
});

test('sidebar control re-enables the panel and accepts a subtitle after the plugin is disabled', async () => {
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/watch?v=FgatKxfAACY');
  await expect(page.locator('#secondary [data-vocabframe-transcript]')).toBeVisible();

  await page.getByRole('switch', { name: '关闭 Glean 拾句', exact: true }).click();
  await expect(page.locator('#secondary [data-vocabframe-transcript]')).toHaveCount(0);

  await page.getByRole('button', { name: '打开 Glean 拾句 设置' }).click();
  await page.getByTitle('切换台词侧边栏').click();
  await expect(page.locator('#secondary [data-vocabframe-transcript]')).toBeVisible();

  await page.locator('[data-vocabframe-transcript] input[type="file"]').setInputFiles({
    name: 'sidebar-test.srt',
    mimeType: 'text/plain',
    buffer: Buffer.from('1\n00:00:01,000 --> 00:00:03,000\nSidebar subtitle works.\n')
  });
  await expect(page.locator('#secondary').getByText('Sidebar subtitle works.', { exact: true })).toBeVisible();
});

test('player settings exposes AI configuration, saves and restores it', async () => {
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/watch?v=FgatKxfAACY');
  await page.getByRole('button', { name: '打开 Glean 拾句 设置' }).click();
  await expect(page.getByLabel('API Key', { exact: true })).toBeVisible();
  await page.getByLabel('AI 服务商', { exact: true }).selectOption('openai');
  await page.getByLabel('API Key', { exact: true }).fill('ui-regression-dummy-key');
  await expect(page.getByLabel('API Base URL', { exact: true })).toHaveValue('https://api.openai.com/v1');
  await page.getByLabel('模型名称', { exact: true }).fill('ui-regression-model');
  await page.getByRole('button', { name: '保存 AI 配置', exact: true }).click();
  await expect(page.getByText('AI 配置已保存', { exact: true })).toBeVisible();
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((input, init) => {
      if (String(input) === 'https://api.openai.com/v1/models') {
        return Promise.resolve(new Response(JSON.stringify({ data: [{ id: 'ui-regression-model' }] }), {
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      return realFetch(input, init);
    }) as typeof fetch;
  });
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('连接成功');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '打开 Glean 拾句 设置' }).click();
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('ui-regression-dummy-key');
  await expect(page.getByLabel('AI 服务商', { exact: true })).toHaveValue('openai');
  await expect(page.getByLabel('模型名称', { exact: true })).toHaveValue('ui-regression-model');
  await page.getByLabel('API Key', { exact: true }).fill('');
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(page.getByText('请先填写 API Key', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/youtube-settings.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('switch', { name: '关闭 Glean 拾句', exact: true }).click();
  await page.getByRole('button', { name: '打开 Glean 拾句 设置' }).click();
  await expect(page.getByLabel('API Key', { exact: true })).toBeVisible();
});

test('custom AI services expose the extension permission entry point', async () => {
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/watch?v=FgatKxfAACY');
  await page.getByRole('button', { name: '打开 Glean 拾句 设置' }).click();
  await page.getByLabel('API Key', { exact: true }).fill('ui-regression-dummy-key');
  await page.getByLabel('API Base URL', { exact: true }).fill('https://ai.example.com/v1');
  await page.getByRole('button', { name: '保存 AI 配置', exact: true }).click();
  const permissionEntry = page.getByRole('button', { name: '打开扩展设置授权 AI 服务', exact: true });
  await expect(permissionEntry).toBeVisible();
  const settingsPagePromise = context.waitForEvent('page');
  await permissionEntry.click();
  const settingsPage = await settingsPagePromise;
  await expect(settingsPage).toHaveURL(/^chrome-extension:\/\/[^/]+\/popup.html$/);
});
