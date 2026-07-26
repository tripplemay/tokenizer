#!/usr/bin/env bash
# PostToolUse hook — 状态机 JSON 写入即时校验（harness-rules.md 铁律 11 的机制化实现）
# 拦截：progress.json / features.json / backlog.json 被 Write/Edit 写坏时当场报错，
#      不等到 commit（pre-commit hook 是离线兜底，本 hook 是第一道门）。
# 来源：MVP commit b44b79d — progress.json 缺一个 `}` 进入 main 持续数小时未发现。

INPUT=$(cat)

FILE_PATH=$(printf '%s' "$INPUT" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    print(data.get('tool_input', {}).get('file_path', ''))
except Exception:
    pass
")

case "$(basename "$FILE_PATH" 2>/dev/null)" in
  progress.json|features.json|backlog.json)
    if ! python3 -c "import json; json.load(open('$FILE_PATH'))" 2>/tmp/state-json-err; then
      echo "❌ 状态机文件 $FILE_PATH 不是合法 JSON（harness 铁律 11）：" >&2
      head -3 /tmp/state-json-err >&2
      echo "请立即修复该文件后再继续。常见原因：中文弯引号 / 缺逗号 / 缺右括号。" >&2
      exit 2
    fi
    ;;
esac

exit 0
