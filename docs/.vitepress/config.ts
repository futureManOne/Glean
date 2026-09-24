import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Glean 拾句',
  description: '看剧学英语的终极形态 · 开源沉浸式双语视频学习浏览器扩展',
  base: '/Glean/',
  lang: 'zh-CN',
  lastUpdated: true,
  themeConfig: {
    logo: '/icon/128.png',
    siteTitle: 'Glean 拾句',
    nav: [
      { text: '首页', link: '/' },
      { text: '使用指南', link: '/guide/' },
      { text: '平台适配', link: '/guide/platforms' },
      { text: '快捷键', link: '/guide/shortcuts' },
      { text: 'GitHub', link: 'https://github.com/futureManOne/Glean' }
    ],
    sidebar: {
      '/guide/': [
        {
          text: '基础入门',
          items: [
            { text: '项目简介', link: '/guide/' },
            { text: '3分钟安装上手', link: '/guide/installation' }
          ]
        },
        {
          text: '核心功能与平台',
          items: [
            { text: '支持平台（夸克/油管/B站）', link: '/guide/platforms' },
            { text: 'AI 双语精翻与 Seek 抢占', link: '/guide/ai' },
            { text: '单词卡片与 CEFR 分级', link: '/guide/vocabulary' },
            { text: 'Anki 与讲义导出', link: '/guide/export' }
          ]
        },
        {
          text: '进阶与参考',
          items: [
            { text: '全键盘快捷键速查', link: '/guide/shortcuts' },
            { text: '常见问题排查 (FAQ)', link: '/guide/faq' }
          ]
        }
      ]
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/futureManOne/Glean' }
    ],
    footer: {
      message: '基于 MIT 协议开源发布 · 隐私优先 · 纯本地运行',
      copyright: 'Copyright © 2026 futureManOne. All Rights Reserved.'
    },
    search: {
      provider: 'local'
    }
  }
})
