#!/usr/bin/env bash
# Link this folder into IINA's plugin directory as a development plugin.
set -euo pipefail

PLUGIN_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$HOME/Library/Application Support/com.colliderli.iina/plugins"
LINK_PATH="$PLUGIN_DIR/glean-iina.iinaplugin-dev"

if [ ! -f "$PLUGIN_SRC/Info.json" ] || [ ! -f "$PLUGIN_SRC/main.js" ]; then
  echo "错误: 未在 $PLUGIN_SRC 找到 Info.json / main.js，请在本插件目录内运行。" >&2
  exit 1
fi

mkdir -p "$PLUGIN_DIR"

if [ -L "$LINK_PATH" ]; then
  rm "$LINK_PATH"
elif [ -e "$LINK_PATH" ]; then
  echo "错误: $LINK_PATH 已存在且不是符号链接，请先手动移除后重试。" >&2
  exit 1
fi

ln -s "$PLUGIN_SRC" "$LINK_PATH"

# IINA discovers a new plugin into PluginOrder but keeps it DISABLED, so a fresh install stays
# invisible in the Plugins menu and in Subtitles > Find Online Subtitles until it is toggled on.
# `defaults` treats dotted keys as key paths, so write the flag through PlistBuddy instead.
PLIST="$HOME/Library/Preferences/com.colliderli.iina.plist"
if pgrep -x IINA >/dev/null 2>&1; then
  echo "提示: IINA 正在运行，请退出后重新执行本脚本，或手动在 插件 菜单中启用 Glean Subtitle。"
else
  /usr/libexec/PlistBuddy -c "Add :PluginEnabled.top.defiy.glean-iina integer 1" "$PLIST" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Set :PluginEnabled.top.defiy.glean-iina 1" "$PLIST" 2>/dev/null
  killall cfprefsd 2>/dev/null || true
  echo "已写入启用标记: PluginEnabled.top.defiy.glean-iina = 1"
fi

echo "已链接:"
echo "  $LINK_PATH"
echo "    -> $PLUGIN_SRC"
echo
echo "下一步:"
echo "  1. 重启 IINA，插件会在启动时自动加载。"
echo "  2. 启动 Glean bridge: bun scripts/iina-bridge/server.ts"
echo "  3. 播放 OpenList 视频后，字幕自动载入；也可用"
echo "     字幕 > 查找在线字幕 > Glean 双语 (OpenList) 手动搜索。"
