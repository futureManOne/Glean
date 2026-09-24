# 3分钟安装上手

Glean (拾句) 是一个纯正的开源项目，您可以直接在 Chrome 或 Edge 浏览器中以开发者模式加载使用。

---

## 方式一：克隆源码本地构建（推荐）

### 环境要求
- [Bun](https://bun.sh/)（推荐）或 Node.js 18+
- Chromium 内核浏览器（Google Chrome、Microsoft Edge、Brave 等）

### 构建步骤
```bash
# 1. 克隆代码仓库
git clone https://github.com/futureManOne/Glean.git
cd Glean

# 2. 安装依赖并构建
bun install
bun run build
```
构建成功后，将在根目录下生成 `.output/chrome-mv3` 文件夹。

---

## 方式二：加载扩展至浏览器

1. 打开浏览器扩展管理中心：
   - **Chrome**：在地址栏输入 `chrome://extensions/`
   - **Edge**：在地址栏输入 `edge://extensions/`
2. 打开页面右上角的 **【开发者模式】(Developer mode)** 开关；
3. 点击左上角的 **【加载已解压的扩展程序】(Load unpacked)**；
4. 选择本项目目录下的 `.output/chrome-mv3` 文件夹；
5. 加载完成后，打开任意支持的视频页面（如 YouTube、Bilibili 或夸克网盘播放页），即可看到沉浸式双语字幕！🎉
