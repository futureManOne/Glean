#!/usr/bin/env bash
# Installs the Glean bridge as a per-user launchd agent so it survives terminal
# sessions, reboots and crashes. Idempotent: re-running reloads it.
#
#   ./scripts/iina-bridge/install-launchd.sh          # install + start
#   ./scripts/iina-bridge/install-launchd.sh status   # show state
#   ./scripts/iina-bridge/install-launchd.sh stop     # unload (keep the plist)
#   ./scripts/iina-bridge/install-launchd.sh remove   # unload + delete plist
set -euo pipefail

LABEL="top.defiy.glean-bridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/.glean-iina"
LOG="$LOG_DIR/bridge.log"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENTRY="$REPO_ROOT/scripts/iina-bridge/server.ts"
BUN_BIN="$(command -v bun || true)"
DOMAIN="gui/$(id -u)"

if [ -z "$BUN_BIN" ]; then
  echo "错误: 找不到 bun，请先安装 Bun (https://bun.sh)。" >&2
  exit 1
fi

case "${1:-install}" in
  status)
    launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -E "state|pid|last exit" || echo "未加载。"
    exit 0
    ;;
  stop)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    echo "已卸载（plist 保留，下次登录会自动加载）。"
    exit 0
    ;;
  remove)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "已卸载并删除 $PLIST"
    exit 0
    ;;
  install) ;;
  *)
    echo "用法: $0 [install|status|stop|remove]" >&2
    exit 1
    ;;
esac

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BUN_BIN</string>
    <string>run</string>
    <string>$ENTRY</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO_ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$(dirname "$BUN_BIN")</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
  </dict>
  <key>ThrottleInterval</key><integer>3</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST_EOF

# Replace any previously loaded copy so the new definition takes effect.
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"

sleep 2
echo "已安装并启动: $LABEL"
echo "  入口   $ENTRY"
echo "  日志   $LOG"
echo "  控制台 http://127.0.0.1:7788/"
