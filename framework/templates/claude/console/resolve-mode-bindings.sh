#!/usr/bin/env bash
# Resolve a signed v2 mode intent into the concrete local dispatch agents.
#
# The resolver repeats full validation itself before it reads bindings or the
# registry. It consumes the validator's sealed snapshot, never harness.json
# after verification, so a file swap cannot redirect a signed selection.
# A project may keep verified adapters outside the framework default; pass the
# same directory used by consumption and active-role validation with --adapters.

set -euo pipefail

CONSOLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADAPTERS=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --adapters)
      [ "$#" -ge 2 ] || { echo "[mode-bindings] ⛔ --adapters 缺值" >&2; exit 2; }
      ADAPTERS="$2"
      shift 2
      ;;
    -h|--help)
      echo "usage: resolve-mode-bindings.sh [--adapters adapters-dir] [harness.json] [.agents-registry.json] [console.pub]" >&2
      exit 0
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "[mode-bindings] ⛔ 未知参数：$1" >&2
      exit 2
      ;;
    *) break ;;
  esac
done

[ "$#" -le 3 ] || { echo "[mode-bindings] ⛔ 用法：resolve-mode-bindings.sh [--adapters adapters-dir] [harness.json] [.agents-registry.json] [console.pub]" >&2; exit 2; }
HARNESS="${1:-harness.json}"
REGISTRY="${2:-.agents-registry.json}"
PUB="${3:-$CONSOLE_DIR/console.pub}"
TOOL_CATALOG="$CONSOLE_DIR/../dispatch/tool-catalog.py"
VALIDATOR="$CONSOLE_DIR/validate-mode-intent.sh"
BINDINGS="$(mktemp)"
SEALED_INPUT="$(mktemp)"
cleanup() { rm -f "$BINDINGS" "$SEALED_INPUT"; }
trap cleanup EXIT

die() { echo "[mode-bindings] ⛔ $1" >&2; exit 2; }
[ -f "$HARNESS" ] || die "harness.json 不存在：$HARNESS"
[ -f "$TOOL_CATALOG" ] || die "框架缺少 tool-catalog.py；请升级 harness"
[ -f "$VALIDATOR" ] || die "框架缺少 validate-mode-intent.sh；不能安全解析 bindings"
[ -z "$ADAPTERS" ] || [ -d "$ADAPTERS" ] || die "adapter 目录不存在：$ADAPTERS"

# Resolution is an authority-bearing operation even before a checkpoint has
# been persisted. Derive its root from the staged harness document, then pin
# the target catalog to that project's regular registry file.
PROJECT_DIR="$(cd "$(dirname "$HARNESS")" && pwd)"
PROJECT_ROOT="$(git -C "$PROJECT_DIR" rev-parse --show-toplevel 2>/dev/null)" \
  || die "无法从 harness.json 所在目录确定 git 项目根"
REGISTRY="$(cd "$PROJECT_ROOT" && python3 "$CONSOLE_DIR/../dispatch/dispatch_common.py" project-registry \
  --project-root "$PROJECT_ROOT" --registry "$REGISTRY")" \
  || die "注册表必须是项目根的非符号链接 .agents-registry.json"

# This validates the mutable source exactly once and emits the resulting
# signed snapshot. Do not redirect stdout: it is the only trusted input to the
# parser below; diagnostics remain on stderr.
VALIDATOR_ARGS=(--emit-resolution-input)
[ -z "$ADAPTERS" ] || VALIDATOR_ARGS+=(--adapters "$ADAPTERS")
VALIDATOR_ARGS+=("$HARNESS" "$REGISTRY" "$PUB")
bash "$VALIDATOR" "${VALIDATOR_ARGS[@]}" > "$SEALED_INPUT" \
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
fields = {
    "agent_id", "tool", "invocation", "model_family", "priority",
    "execution_provenance_sha256",
}
safe_id = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
safe_tool = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}\Z")
sha256 = re.compile(r"[0-9a-f]{64}\Z")
if not isinstance(resolution, dict) or set(resolution) != set(roles):
    raise SystemExit("[mode-bindings] ⛔ 已验签解析结果必须恰含三角色")
for role in roles:
    item = resolution[role]
    if role == "planner" and item is None:
        continue
    if not isinstance(item, dict) or set(item) != fields:
        raise SystemExit(f"[mode-bindings] ⛔ resolution.{role} 必须恰含六个审计字段（含 execution_provenance_sha256）")
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
    if not isinstance(item["execution_provenance_sha256"], str) or not sha256.fullmatch(item["execution_provenance_sha256"]):
        raise SystemExit(f"[mode-bindings] ⛔ resolution.{role}.execution_provenance_sha256 必须是小写 SHA-256")
json.dump(resolution, open(bindings_path, "w", encoding="utf-8"),
          sort_keys=True, separators=(",", ":"), ensure_ascii=False)
PY

cat "$BINDINGS"
