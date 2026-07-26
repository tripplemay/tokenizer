#!/usr/bin/env bash
# bootstrap.sh — 新项目初始化入口（v1.4 起是 harness.sh init 的薄封装）
#
# v1.4 之前它自己做复制，于是项目从此**冻结在 bootstrap 当天的框架版本**：没有版本号、
# 没有对账、升级只能手工重铺，而重铺会静默盖掉你对框架文件的本地改动。
# 现在真正干活的是 templates/claude/harness.sh，它会额外产出两份账：
#   harness.json  框架来源 + 版本 + commit
#   harness.lock  受管文件清单 + 双 sha（安装时内容 / 对齐到的上游原文）
# 之后 `bash .claude/harness.sh status | verify | sync` 就能查版本、看漂移、升级。
#
# 运行方式（在 degit 出来的空项目根目录）：
#   bash bootstrap.sh
#
# 存量项目（bootstrap 过但还没有 harness.lock）不要跑这个，跑：
#   bash <框架源树>/templates/claude/harness.sh adopt --from <框架源树> --as <你当时的版本>

set -euo pipefail
TARGET_DIR="$(pwd)"

if [ -f "$TARGET_DIR/harness.lock" ]; then
  echo "✗ 已有 harness.lock —— 这个项目已被框架管理。"
  echo "  升级请用： bash .claude/harness.sh sync --from <框架源树>"
  exit 1
fi
if [ -f "$TARGET_DIR/harness-rules.md" ]; then
  echo "✗ harness-rules.md 已存在但没有 harness.lock —— 这是 v1.4 之前 bootstrap 出来的存量项目。"
  echo "  先补建账本（只记录现状，不改动任何文件）："
  echo "    bash <框架源树>/templates/claude/harness.sh adopt --from <框架源树> --as <当时版本>"
  echo "  再看差多少、要不要升： bash .claude/harness.sh verify --from <框架源树>"
  exit 1
fi

# 源布局：flat（degit 出来的模板仓库，源就在 CWD）vs nested（项目里的 framework/）
if [ -d "$TARGET_DIR/harness" ] && [ -d "$TARGET_DIR/templates" ]; then
  LAYOUT="flat"
elif [ -d "$TARGET_DIR/framework/harness" ]; then
  LAYOUT="nested"
else
  echo "✗ 找不到框架源文件（预期 CWD 下有 harness/ 与 templates/，或 framework/harness/）"
  exit 1
fi

echo "→ Bootstrapping Triad Workflow（布局：${LAYOUT}）"

if [ "$LAYOUT" = "flat" ]; then
  # 源树与目标是同一个目录，直接铺会自噬（init 要把源镜像进 framework/）。
  # 先把源整体搬到临时目录，清空根目录，再从临时目录铺回来。
  SRC_TMP="$(mktemp -d)"
  tar cf - --exclude .git --exclude .obsidian --exclude .DS_Store . | ( cd "$SRC_TMP" && tar xf - )
  for item in harness memory templates patterns console archive docs \
              CHANGELOG.md README.md VERSION INIT.md \
              cowork-constraint-design.md proposed-learnings.md bootstrap.sh; do
    rm -rf "${TARGET_DIR:?}/$item"
  done
  bash "$SRC_TMP/templates/claude/harness.sh" init --from "$SRC_TMP"
  rm -rf "$SRC_TMP"
else
  bash "$TARGET_DIR/framework/templates/claude/harness.sh" init --from "$TARGET_DIR/framework"
fi

cat <<'EOF'

✓ Bootstrap 完成！

  ├── CLAUDE.md / AGENTS.md              （占位符版本，待 Claude 填充）
  ├── harness-rules.md / planner.md / generator.md / evaluator.md
  ├── orchestration-patterns.md
  ├── .claude/                           （hooks + evaluator subagent + 技能 + harness.sh）
  ├── harness.json / harness.lock        （框架版本与受管文件账本 —— v1.4 新增）
  ├── progress.json / features.json / backlog.json
  ├── .auto-memory/                      （T0/T1/T2 分层记忆）
  ├── docs/specs/ / test-cases/ / test-reports/
  └── framework/                         （源模板 + patterns/ 经验库，离线可读）

下一步：
  1. 在本目录打开 Claude CLI
  2. 说：「按 INIT.md 初始化项目」
  3. Claude 会问 6 个问题，自动填好所有占位符

INIT.md 执行完后：
  rm INIT.md
  git remote add origin git@github.com:USERNAME/REPO.git && git push -u origin main

以后要升级框架：
  bash .claude/harness.sh verify --from <框架源树>   # 先看差多少
  bash .claude/harness.sh sync   --from <框架源树>   # 本地改过的文件不会被静默覆盖

EOF
