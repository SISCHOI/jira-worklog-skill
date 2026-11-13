#!/usr/bin/env bash
# jira-worklog 安装（Linux / macOS）
#
#   bash install.sh                  # 装到所有宿主
#   bash install.sh --target=dsh     # 只装 DSH
#   bash install.sh --target=claude  # 只装 Claude Code
#   bash install.sh --target=codex   # 只装 Codex
#   bash install.sh --add-to-path    # 顺便打印 PATH 建议
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
SKILL_NAME="jira-worklog"
TARGET="all"
ADD_TO_PATH=0

for arg in "$@"; do
  case "$arg" in
    --target=*) TARGET="${arg#*=}" ;;
    --add-to-path) ADD_TO_PATH=1 ;;
    *) echo "未知参数: $arg" >&2; exit 2 ;;
  esac
done

case "$TARGET" in
  all|dsh|claude|codex) ;;
  *) echo "--target 只能是 all|dsh|claude|codex" >&2; exit 2 ;;
esac

install_skill() {
  local dest="$1"
  rm -rf "$dest"
  mkdir -p "$dest"
  cp "$REPO/SKILL.md" "$dest/"
  cp -r "$REPO/lib" "$REPO/commands" "$REPO/scripts" "$dest/"
  echo "  installed -> $dest ($(find "$dest" -type f | wc -l) files)"
}

echo "安装 $SKILL_NAME（目标: $TARGET）"
[ "$TARGET" = all ] || [ "$TARGET" = dsh ]    && install_skill "$HOME/.dsh/skills/$SKILL_NAME"
[ "$TARGET" = all ] || [ "$TARGET" = claude ] && install_skill "$HOME/.claude/skills/$SKILL_NAME"
[ "$TARGET" = all ] || [ "$TARGET" = codex ]  && install_skill "$HOME/.codex/skills/$SKILL_NAME"

if [ "$TARGET" = all ] || [ "$TARGET" = dsh ]; then
  if [ ! -f "$HOME/.jira-worklog.json" ]; then
    cp "$REPO/config.example.json" "$HOME/.jira-worklog.json"
    echo "  配置模板 -> $HOME/.jira-worklog.json"
  fi
fi

if [ "$ADD_TO_PATH" = 1 ]; then
  echo "  把下面这行加进 ~/.bashrc 或 ~/.zshrc 后可直接用 wl："
  echo "    export PATH=\"$REPO/scripts:\$PATH\""
fi

echo
echo "验证："
echo "  node \"$HOME/.dsh/skills/$SKILL_NAME/scripts/wl.js\" hours --check"
echo "  node \"$HOME/.dsh/skills/$SKILL_NAME/scripts/wl.js\" verify"
