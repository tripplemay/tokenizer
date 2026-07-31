#!/usr/bin/env bash
# Resolve a signed v2 mode intent into the concrete local dispatch agents.
#
# The resolver repeats full validation itself before it reads bindings or the
# registry. It consumes the validator's sealed snapshot, never harness.json
# after verification, so a file swap cannot redirect a signed selection.

set -euo pipefail

HARNESS="${1:-harness.json}"
REGISTRY="${2:-.agents-registry.json}"
CONSOLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUB="${3:-$CONSOLE_DIR/console.pub}"
TOOL_CATALOG="$CONSOLE_DIR/../dispatch/tool-catalog.py"
VALIDATOR="$CONSOLE_DIR/validate-mode-intent.sh"
BINDINGS="$(mktemp)"
SEALED_INPUT="$(mktemp)"
cleanup() { rm -f "$BINDINGS" "$SEALED_INPUT"; }
trap cleanup EXIT

die() { echo "[mode-bindings] ⛔ $1" >&2; exit 2; }
[ -f "$HARNESS" ] || die "harness.json 不存在：$HARNESS"
[ -f "$REGISTRY" ] || die "注册表不存在：$REGISTRY"
[ -f "$TOOL_CATALOG" ] || die "框架缺少 tool-catalog.py；请升级 harness"
[ -f "$VALIDATOR" ] || die "框架缺少 validate-mode-intent.sh；不能安全解析 bindings"

# This validates the mutable source exactly once and emits the resulting
# signed snapshot. Do not redirect stdout: it is the only trusted input to the
# parser below; diagnostics remain on stderr.
bash "$VALIDATOR" --emit-resolution-input "$HARNESS" "$REGISTRY" "$PUB" > "$SEALED_INPUT" \
  || die "签名 mode intent 未通过完整校验，拒绝解析 bindings"

python3 - "$SEALED_INPUT" "$BINDINGS" <<'PY'
import json
import re
import sys

sealed_path, bindings_path = sys.argv[1:3]
try:
    sealed = json.load(open(sealed_path, encoding="utf-8"))
except (OSError, KeyError, TypeError, ValueError) as exc:
    raise SystemExit(f"[mode-bindings] ⛔ 无法读取已验签 mode intent 快照：{exc}")

if set(sealed) != {
    "execution_version", "profile", "role_bindings", "intent_id", "signed_intent", "resolution"
}:
    raise SystemExit("[mode-bindings] ⛔ 已验签快照 shape 非法")
if sealed.get("execution_version") != "v2":
    raise SystemExit("[mode-bindings] ⛔ 当前 intent 不是 v2 role_bindings；v1 保持原有 role_assignments 路径")
if sealed.get("profile") == "fast" or sealed.get("role_bindings") is None:
    raise SystemExit("[mode-bindings] ⛔ fast 不解析外部 role_bindings；由 Coordinator 走本机默认路径")
bindings = sealed["role_bindings"]
if not isinstance(bindings, dict):
    raise SystemExit("[mode-bindings] ⛔ 已验签 role_bindings 必须是 object")
resolution = sealed["resolution"]
roles = ("planner", "generator", "evaluator")
fields = {"agent_id", "tool", "invocation", "model_family", "priority"}
safe_id = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
safe_tool = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}\Z")
if not isinstance(resolution, dict) or set(resolution) != set(roles):
    raise SystemExit("[mode-bindings] ⛔ 已验签解析结果必须恰含三角色")
for role in roles:
    item = resolution[role]
    if not isinstance(item, dict) or set(item) != fields:
        raise SystemExit(f"[mode-bindings] ⛔ resolution.{role} 必须恰含五个审计字段")
    if not isinstance(item["agent_id"], str) or not safe_id.fullmatch(item["agent_id"]):
        raise SystemExit(f"[mode-bindings] ⛔ resolution.{role}.agent_id 非法")
    if not isinstance(item["tool"], str) or not safe_tool.fullmatch(item["tool"]):
        raise SystemExit(f"[mode-bindings] ⛔ resolution.{role}.tool 非法")
    if item["invocation"] not in ("subagent", "local-cli", "a2a"):
        raise SystemExit(f"[mode-bindings] ⛔ resolution.{role}.invocation 非法")
    if not isinstance(item["model_family"], str) or not item["model_family"]:
        raise SystemExit(f"[mode-bindings] ⛔ resolution.{role}.model_family 非法")
    if isinstance(item["priority"], bool) or not isinstance(item["priority"], int) or item["priority"] < 0:
        raise SystemExit(f"[mode-bindings] ⛔ resolution.{role}.priority 非法")
json.dump(resolution, open(bindings_path, "w", encoding="utf-8"),
          sort_keys=True, separators=(",", ":"), ensure_ascii=False)
PY

cat "$BINDINGS"
