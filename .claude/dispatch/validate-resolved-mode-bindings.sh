#!/usr/bin/env bash
# Re-resolve a consumed v2 mode intent from its complete signed checkpoint.
# Mutable progress audit fields never select the binding; they are compared
# against a fresh result derived from the re-verified signed object.

set -euo pipefail
umask 077

DISPATCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONSOLE_DIR="$(cd "$DISPATCH_DIR/../console" && pwd)"
VALIDATOR="$CONSOLE_DIR/validate-mode-intent.sh"
PROGRESS="progress.json"
REGISTRY=".agents-registry.json"
DEFAULT_ADAPTERS="$DISPATCH_DIR/transports/adapters"
ADAPTERS=""
MODE_ADAPTERS="$DISPATCH_DIR/resolve-mode-adapters.sh"
PUB="$CONSOLE_DIR/console.pub"
CHECKPOINT="$(mktemp)"
AUDIT="$(mktemp)"
CURRENT="$(mktemp)"
cleanup() { rm -f "$CHECKPOINT" "$AUDIT" "$CURRENT"; }
trap cleanup EXIT

die() { echo "[resolved-bindings] ⛔ $1" >&2; exit 2; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --progress) [ "$#" -ge 2 ] || die "--progress 缺值"; PROGRESS="$2"; shift 2 ;;
    --registry) [ "$#" -ge 2 ] || die "--registry 缺值"; REGISTRY="$2"; shift 2 ;;
    --adapters) [ "$#" -ge 2 ] || die "--adapters 缺值"; ADAPTERS="$2"; shift 2 ;;
    --pub) [ "$#" -ge 2 ] || die "--pub 缺值"; PUB="$2"; shift 2 ;;
    -h|--help)
      echo "usage: validate-resolved-mode-bindings.sh [--progress progress.json] [--registry .agents-registry.json] [--adapters adapters-dir] [--pub console.pub]" >&2
      exit 0
      ;;
    *) die "未知参数：$1" ;;
  esac
done

[ -f "$PROGRESS" ] || die "progress 不存在：$PROGRESS"
[ -x "$MODE_ADAPTERS" ] || die "resolve-mode-adapters.sh 不存在或不可执行"

# Replaying a checkpoint is a project-bound operation, not a generic catalog
# lookup. Pin registry authority before any resolver or signed-binding replay
# reads it; use the progress file's repository rather than the caller's CWD.
PROJECT_DIR="$(cd "$(dirname "$PROGRESS")" && pwd)"
PROJECT_ROOT="$(git -C "$PROJECT_DIR" rev-parse --show-toplevel 2>/dev/null)" \
  || die "无法从 progress 所在目录确定 git 项目根；不能复验 checkpoint repo_key"
REGISTRY="$(cd "$PROJECT_ROOT" && python3 "$DISPATCH_DIR/dispatch_common.py" project-registry \
  --project-root "$PROJECT_ROOT" --registry "$REGISTRY")" \
  || die "registry 必须是项目根的非符号链接 .agents-registry.json"

# A v2 checkpoint may own an explicit project-local adapter directory. Resolve
# it before either registry preflight or signed-binding replay; an explicit
# caller override is accepted only when it names that same durable directory.
ADAPTER_ARGS=(--progress "$PROGRESS" --default "$DEFAULT_ADAPTERS")
[ -z "$ADAPTERS" ] || ADAPTER_ARGS+=(--adapters "$ADAPTERS")
ADAPTERS="$(bash "$MODE_ADAPTERS" "${ADAPTER_ARGS[@]}")" \
  || die "无法恢复 active mode 的 adapter 目录"

# Freeze the progress facts once. Old v1/v2-fast records intentionally have no
# checkpoint and preserve the historical {} path. A partial checkpoint fails
# closed rather than silently falling back.
if ! MODE="$(python3 - "$PROGRESS" "$CHECKPOINT" "$AUDIT" <<'PY'
import json
import re
import sys

progress_path, checkpoint_path, audit_path = sys.argv[1:4]
ROLES = ("planner", "generator", "evaluator")
RECORD_FIELDS = {
    "agent_id", "tool", "invocation", "model_family", "priority",
    "execution_provenance_sha256",
}
SAFE_BATCH = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
SAFE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
SAFE_TOOL = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}\Z")
SAFE_SHA256 = re.compile(r"[0-9a-f]{64}\Z")


def fail(message):
    print(f"[resolved-bindings] ⛔ {message}", file=sys.stderr)
    raise SystemExit(2)


def no_duplicates(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f"重复 JSON 键 {key!r}")
        value[key] = item
    return value


try:
    with open(progress_path, encoding="utf-8") as stream:
        progress = json.load(stream, object_pairs_hook=no_duplicates)
except (OSError, ValueError) as exc:
    fail(f"progress JSON 非法：{exc}")
if not isinstance(progress, dict):
    fail("progress 根节点必须是 object")
mode = progress.get("mode_intent")
if not isinstance(mode, dict):
    print("none")
    raise SystemExit(0)
if "signed_intent" not in mode and "resolution" not in mode:
    if "adapter_dir" in mode:
        fail("mode_intent.adapter_dir 只能用于 active v2 checkpoint")
    print("none")
    raise SystemExit(0)
required_mode_fields = {"intent_id", "applied_batch", "applied_at", "signed_intent", "resolution"}
allowed_mode_fields = required_mode_fields | {"adapter_dir"}
if not required_mode_fields.issubset(mode) or set(mode) - allowed_mode_fields:
    fail("v2 mode_intent checkpoint 必须包含 intent_id/applied_batch/applied_at/signed_intent/resolution，且只可额外带 adapter_dir")
if "adapter_dir" in mode and (not isinstance(mode["adapter_dir"], str) or not mode["adapter_dir"]):
    fail("mode_intent.adapter_dir 必须是非空字符串")
if not isinstance(mode["intent_id"], str) or not SAFE_ID.fullmatch(mode["intent_id"]):
    fail("mode_intent.intent_id 非法")
if not isinstance(mode["applied_batch"], str) or not SAFE_BATCH.fullmatch(mode["applied_batch"]):
    fail("mode_intent.applied_batch 非法")
intent = mode["signed_intent"]
if not isinstance(intent, dict) or intent.get("intent_id") != mode["intent_id"]:
    fail("mode_intent.signed_intent 与 intent_id 不一致")
desired = intent.get("desired")
execution = desired.get("execution") if isinstance(desired, dict) else None
if not isinstance(execution, dict) or set(execution) != {"profile", "role_bindings"}:
    fail("checkpoint 必须是完整 v2 signed intent")
if execution.get("profile") == "fast":
    fail("v2 fast 不得带 active resolution checkpoint")
bindings = execution.get("role_bindings")
if not isinstance(bindings, dict) or set(bindings) != set(ROLES):
    fail("checkpoint role_bindings 必须恰含三角色")
assignments = progress.get("role_assignments")
resolution = mode["resolution"]
if not isinstance(assignments, dict) or not isinstance(resolution, dict) or set(resolution) != set(ROLES):
    fail("v2 checkpoint 要求 role_assignments 和 resolution 恰含三角色")
for role in ROLES:
    binding = bindings[role]
    record = resolution[role]
    if role == "planner" and binding is None:
        if record is not None or assignments.get(role) is not None:
            fail("Coordinator Planner 不得拥有外部 resolution 或 assignment")
        continue
    if not isinstance(binding, dict) or set(binding) != {"tool", "invocation"}:
        fail(f"checkpoint role_bindings.{role} shape 非法")
    if not isinstance(record, dict) or set(record) != RECORD_FIELDS:
        fail(f"resolution.{role} 必须恰含六个审计字段（含 execution_provenance_sha256）")
    if binding.get("tool") != record.get("tool") or binding.get("invocation") != record.get("invocation"):
        fail(f"resolution.{role} 与已签名 tool/invocation 不一致")
    if not isinstance(record["agent_id"], str) or not SAFE_ID.fullmatch(record["agent_id"]):
        fail(f"resolution.{role}.agent_id 非法")
    if not isinstance(record["tool"], str) or not SAFE_TOOL.fullmatch(record["tool"]):
        fail(f"resolution.{role}.tool 非法")
    if record["invocation"] not in ("subagent", "local-cli", "a2a"):
        fail(f"resolution.{role}.invocation 非法")
    if not isinstance(record["model_family"], str) or not record["model_family"]:
        fail(f"resolution.{role}.model_family 非法")
    if isinstance(record["priority"], bool) or not isinstance(record["priority"], int) or record["priority"] < 0:
        fail(f"resolution.{role}.priority 非法")
    if not isinstance(record["execution_provenance_sha256"], str) or not SAFE_SHA256.fullmatch(record["execution_provenance_sha256"]):
        fail(f"resolution.{role}.execution_provenance_sha256 必须是小写 SHA-256")
    if assignments.get(role) != record["agent_id"]:
        fail(f"role_assignments.{role} 与 resolution agent_id 漂移")

with open(checkpoint_path, "w", encoding="utf-8") as stream:
    json.dump(intent, stream, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
with open(audit_path, "w", encoding="utf-8") as stream:
    json.dump({"intent_id": mode["intent_id"], "resolution": resolution, "role_assignments": assignments}, stream, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
print("v2")
PY
)"; then
  exit 2
fi

if [ "$MODE" = none ]; then
  printf '{}\n'
  exit 0
fi
[ "$MODE" = v2 ] || die "内部错误：未知 checkpoint 模式"
[ -f "$PUB" ] || die "console.pub 不存在：$PUB"
[ -f "$VALIDATOR" ] || die "validate-mode-intent.sh 不存在"
[ -f "$DISPATCH_DIR/tool-catalog.py" ] || die "tool-catalog.py 不存在"

if ! bash "$DISPATCH_DIR/validate-dispatch.sh" registry "$REGISTRY" --adapters "$ADAPTERS" >&2; then
  die "registry 未通过安全预检"
fi

# Checkpoint verification deliberately permits an elapsed intent_expires_at:
# that timestamp gates /plan consumption, whereas active autonomy is gated by
# autonomy-policy.json and the Gate Arbiter.
if ! bash "$VALIDATOR" --emit-resolution-input --checkpoint "$CHECKPOINT" --repo-root "$PROJECT_ROOT" --adapters "$ADAPTERS" "$REGISTRY" "$PUB" > "$CURRENT"; then
  die "已消费 signed_intent checkpoint 未通过独立复验"
fi

if ! python3 - "$AUDIT" "$CURRENT" <<'PY'
import json
import re
import sys

audit_path, current_path = sys.argv[1:3]
ROLES = ("planner", "generator", "evaluator")
FIELDS = {
    "agent_id", "tool", "invocation", "model_family", "priority",
    "execution_provenance_sha256",
}
SHA256 = re.compile(r"[0-9a-f]{64}\Z")


def fail(message):
    print(f"[resolved-bindings] ⛔ {message}", file=sys.stderr)
    raise SystemExit(2)


try:
    audit = json.load(open(audit_path, encoding="utf-8"))
    sealed = json.load(open(current_path, encoding="utf-8"))
except (OSError, ValueError) as exc:
    fail(f"复验快照 JSON 非法：{exc}")
expected = {"execution_version", "profile", "role_bindings", "intent_id", "signed_intent", "resolution"}
if not isinstance(sealed, dict) or set(sealed) != expected:
    fail("复验输出 shape 非法")
if sealed.get("execution_version") != "v2" or sealed.get("profile") == "fast":
    fail("active checkpoint 不再是 v2 non-fast")
if sealed.get("intent_id") != audit.get("intent_id"):
    fail("复验 signed intent_id 与已消费 checkpoint 不一致")
if not isinstance(sealed.get("signed_intent"), dict) or sealed["signed_intent"].get("intent_id") != audit["intent_id"]:
    fail("复验 signed_intent 与 checkpoint 不一致")
bindings = sealed.get("role_bindings")
stored = audit.get("resolution")
current = sealed.get("resolution")
assignments = audit.get("role_assignments")
if not isinstance(bindings, dict) or not isinstance(stored, dict) or not isinstance(current, dict) or not isinstance(assignments, dict):
    fail("复验 bindings/resolution/assignments 非法")
for role in ROLES:
    binding, before, after = bindings.get(role), stored.get(role), current.get(role)
    if role == "planner" and binding is None:
        if before is not None or after is not None or assignments.get(role) is not None:
            fail("Coordinator Planner 的审计记录必须保持 null")
        continue
    if not isinstance(binding, dict) or not isinstance(before, dict) or not isinstance(after, dict):
        fail(f"{role} 复验记录缺失")
    if set(before) != FIELDS or set(after) != FIELDS:
        fail(f"{role} resolution 必须恰含六字段（含 execution_provenance_sha256）")
    if not isinstance(before.get("execution_provenance_sha256"), str) or not SHA256.fullmatch(before["execution_provenance_sha256"]):
        fail(f"{role} 已存 execution_provenance_sha256 非法")
    if not isinstance(after.get("execution_provenance_sha256"), str) or not SHA256.fullmatch(after["execution_provenance_sha256"]):
        fail(f"{role} 当前 execution_provenance_sha256 非法")
    if binding.get("tool") != before.get("tool") or binding.get("invocation") != before.get("invocation"):
        fail(f"{role} 已存 resolution 脱离签名 binding")
    if binding.get("tool") != after.get("tool") or binding.get("invocation") != after.get("invocation"):
        fail(f"{role} 当前解析结果脱离签名 binding")
    if assignments.get(role) != before.get("agent_id"):
        fail(f"role_assignments.{role} 与已存 resolution 漂移")
    if before != after:
        fail(f"当前 {role} 解析结果与已消费审计快照漂移；重新签发/解析后才能派活")
print(json.dumps(current, ensure_ascii=False, sort_keys=True))
PY
then
  exit 2
fi
