import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  publicDir: '../public',
  modules: ['@wxt-dev/module-react'],
  imports: false,
  manifest: {
    name: 'Glean 拾句 - Bilingual Video Learning',
    description: 'Glean (拾句) - Learn languages with interactive bilingual subtitles on YouTube, Bilibili, and Quark Pan.',
    version: '1.0.0',
    permissions: ['storage', 'activeTab'],
    host_permissions: [
      'https://*.bilibili.com/*',
      'https://pan.quark.cn/*',
      'https://*.quark.cn/*',
      'https://www.youtube.com/*',
      'https://*.youtube.com/*',
      'https://api.openai.com/*',
      'https://api.deepseek.com/*',
      'https://generativelanguage.googleapis.com/*',
      'https://*/*'
    ],
    action: {
      default_title: 'Glean 拾句'
    },
    web_accessible_resources: [
      {
        resources: ['content-scripts/mainWorld.js'],
        matches: ['*://*.youtube.com/*', '*://*.bilibili.com/*']
      }
    ]
  },
  vite: () => ({
    build: {
      target: 'esnext',
      chunkSizeWarningLimit: 8_000
    }
  })
});
