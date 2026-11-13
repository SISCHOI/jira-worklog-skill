#!/usr/bin/env bash
# Linux 侧验证：装进各宿主技能目录，并检查宿主是否真的能发现/使用技能
# 用法: bash tests/linux-host-check.sh [repo_dir]
set -u

REPO="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
SKILL_NAME="jira-worklog"

install_into() {
  local base="$1"
  local dir="$base/$SKILL_NAME"
  rm -rf "$dir"
  mkdir -p "$dir"
  cp "$REPO/SKILL.md" "$dir/"
  cp -r "$REPO/lib" "$REPO/commands" "$REPO/scripts" "$dir/"
  echo "  installed -> $dir"
}

echo "== 平台 =="
uname -srm
node --version

echo "== 安装到各宿主技能目录 =="
for base in "$HOME/.codex/skills" "$HOME/.dsh/skills" "$HOME/.claude/skills"; do
  mkdir -p "$base"
  install_into "$base"
done

echo "== Codex: prompt-input 是否注入 =="
if command -v codex >/dev/null 2>&1; then
  cd /tmp
  if codex debug prompt-input 2>/dev/null | grep -q "$SKILL_NAME"; then
    echo "  PASS: codex 已把 $SKILL_NAME 注入模型输入"
  else
    echo "  FAIL: codex 未注入 $SKILL_NAME"
  fi
else
  echo "  SKIP: 未安装 codex"
fi

echo "== DSH: 能否起 headless 会话并读到技能 =="
# 注意：DSH 0.1.5-alpha.1 在 Linux 上插件树残缺（@deepseek-ai/dsh-sandbox-local 未发布），
# 必须用 >=0.2.x（本例 0.2.2-rc.1）。凭据从 ~/.dsh/.credentials.yaml 的 DEEPSEEK_API_KEY 取。
if command -v dsh >/dev/null 2>&1; then
  CRED="$HOME/.dsh/.credentials.yaml"
  if [ -f "$CRED" ] && command -v python3 >/dev/null 2>&1; then
    KEY="$(python3 - "$CRED" <<'PY'
import re,sys
t=open(sys.argv[1],encoding='utf-8').read()
m=re.search(r'^\s*DEEPSEEK_API_KEY:\s*(.+)$',t,re.M)
print(m.group(1).strip() if m else '')
PY
)"
    if [ -n "$KEY" ]; then
      OUT="$(cd /tmp && DEEPSEEK_API_KEY="$KEY" timeout 420 dsh --profile headless \
        "使用 $SKILL_NAME 技能回答：它的 daily 子命令需要哪些参数？找不到就只回答 NOT_FOUND" 2>&1 | tail -30)"
      if printf '%s' "$OUT" | grep -q -- '--issue'; then
        echo "  PASS: DSH 会话读到并正确使用了技能（dsh $(dsh --version)）"
      else
        echo "  FAIL: DSH 未读到技能，输出尾部："
        printf '%s\n' "$OUT" | tail -5
      fi
    else
      echo "  SKIP: 凭据里没有 DEEPSEEK_API_KEY"
    fi
  else
    echo "  SKIP: 缺 $CRED 或 python3"
  fi
else
  echo "  SKIP: 未安装 dsh"
fi

echo "== 功能：按安装后的路径跑 CLI =="
node "$HOME/.dsh/skills/$SKILL_NAME/scripts/wl.js" help >/dev/null 2>&1 \
  && echo "  PASS: 从技能目录可直接运行" || echo "  FAIL: 技能目录内无法运行"

echo "== 单元/端到端 =="
node "$REPO/tests/check-skill.js" | tail -2
node "$REPO/tests/e2e.js" | tail -2
