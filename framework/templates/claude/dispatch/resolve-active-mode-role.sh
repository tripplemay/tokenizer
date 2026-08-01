#!/usr/bin/env bash
# Return the only dispatchable descriptor record for an active v2 role.
#
# {} means the batch is legacy/v1/v2-fast and retains its historical route.
# Any v2 non-fast checkpoint is independently re-verified; callers must use
# this result rather than selecting from progress.role_assignments themselves.

set -euo pipefail

DISPATCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VALIDATOR="$DISPATCH_DIR/validate-resolved-mode-bindings.sh"
ROLE=""
EXPECTED_AGENT=""
PROGRESS="progress.json"
REGISTRY=".agents-registry.json"
ADAPTERS=""
PUB=""
RESOLVED="$(mktemp)"
cleanup() { rm -f "$RESOLVED"; }
trap cleanup EXIT

die() { echo "[active-mode-role] ⛔ $1" >&2; exit 2; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --role) [ "$#" -ge 2 ] || die "--role 缺值"; ROLE="$2"; shift 2 ;;
    --expected-agent) [ "$#" -ge 2 ] || die "--expected-agent 缺值"; EXPECTED_AGENT="$2"; shift 2 ;;
    --progress) [ "$#" -ge 2 ] || die "--progress 缺值"; PROGRESS="$2"; shift 2 ;;
    --registry) [ "$#" -ge 2 ] || die "--registry 缺值"; REGISTRY="$2"; shift 2 ;;
    --adapters) [ "$#" -ge 2 ] || die "--adapters 缺值"; ADAPTERS="$2"; shift 2 ;;
    --pub) [ "$#" -ge 2 ] || die "--pub 缺值"; PUB="$2"; shift 2 ;;
    -h|--help)
      echo "usage: resolve-active-mode-role.sh --role planner|generator|evaluator [--expected-agent id] [--progress progress.json] [--registry .agents-registry.json] [--adapters dir] [--pub console.pub]" >&2
      exit 0
      ;;
    *) die "未知参数：$1" ;;
  esac
done

case "$ROLE" in planner|generator|evaluator) ;; *) die "--role 必须是 planner/generator/evaluator" ;; esac
[ -f "$PROGRESS" ] || die "progress 不存在：$PROGRESS"
[ -f "$VALIDATOR" ] || die "validate-resolved-mode-bindings.sh 不存在"

# This public resolver is also a direct entrypoint. Resolve the project from
# the consumed progress file before letting the registry choose a target.
PROJECT_DIR="$(cd "$(dirname "$PROGRESS")" && pwd)"
PROJECT_ROOT="$(git -C "$PROJECT_DIR" rev-parse --show-toplevel 2>/dev/null)" \
  || die "无法从 progress 所在目录确定 git 项目根"
REGISTRY="$(cd "$PROJECT_ROOT" && python3 "$DISPATCH_DIR/dispatch_common.py" project-registry \
  --project-root "$PROJECT_ROOT" --registry "$REGISTRY")" \
  || die "registry 必须是项目根的非符号链接 .agents-registry.json"

ARGS=(--progress "$PROGRESS" --registry "$REGISTRY")
[ -z "$ADAPTERS" ] || ARGS+=(--adapters "$ADAPTERS")
[ -z "$PUB" ] || ARGS+=(--pub "$PUB")
if ! bash "$VALIDATOR" "${ARGS[@]}" > "$RESOLVED"; then
  die "active mode checkpoint 未通过复验"
fi

if ! python3 - "$RESOLVED" "$ROLE" "$EXPECTED_AGENT" <<'PY'
import json
import re
import sys

path, role, expected_agent = sys.argv[1:4]
fields = {
    "agent_id", "tool", "invocation", "model_family", "priority",
    "execution_provenance_sha256",
}
safe_id = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
sha256 = re.compile(r"[0-9a-f]{64}\Z")


def fail(message):
    print(f"[active-mode-role] ⛔ {message}", file=sys.stderr)
    raise SystemExit(2)


try:
    value = json.load(open(path, encoding="utf-8"))
except (OSError, ValueError) as exc:
    fail(f"无法读取 resolved bindings：{exc}")
if value == {}:
    print("{}")
    raise SystemExit(0)
if not isinstance(value, dict) or set(value) != {"planner", "generator", "evaluator"}:
    fail("resolved bindings 必须恰含三角色或为空")
record = value.get(role)
if role == "planner" and record is None:
    if expected_agent:
        fail("已验签 Planner 绑定为 Coordinator，不能断言外部 agent")
    print("{}")
    raise SystemExit(0)
if not isinstance(record, dict) or set(record) != fields:
    fail(f"resolved {role} 必须恰含六字段（含 execution_provenance_sha256）")
if not isinstance(record["agent_id"], str) or not safe_id.fullmatch(record["agent_id"]):
    fail(f"resolved {role}.agent_id 非法")
if not isinstance(record["execution_provenance_sha256"], str) or not sha256.fullmatch(record["execution_provenance_sha256"]):
    fail(f"resolved {role}.execution_provenance_sha256 必须是小写 SHA-256")
if expected_agent and expected_agent != record["agent_id"]:
    fail(
        f"显式 agent {expected_agent!r} 与已验签 active {role} "
        f"{record['agent_id']!r} 不一致"
    )
print(json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
PY
then
  exit 2
fi
