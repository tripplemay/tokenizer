#!/usr/bin/env bash
# Atomically consume a staged signed mode intent at a new batch boundary.
#
# This is the only writer for progress.mode_intent v2 checkpoints. It captures
# the complete signed object (including sig) from validate-mode-intent.sh's
# one-shot verified output, so a later harness.json staging cannot redirect an
# already active batch.

set -euo pipefail
umask 077

CONSOLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VALIDATOR="$CONSOLE_DIR/validate-mode-intent.sh"
MODE_ADAPTERS="$CONSOLE_DIR/../dispatch/resolve-mode-adapters.sh"
PROGRESS="progress.json"
HARNESS="harness.json"
REGISTRY=".agents-registry.json"
PUB="$CONSOLE_DIR/console.pub"
ADAPTERS=""
BATCH=""
SEALED="$(mktemp)"
LOCK=""

cleanup() {
  rm -f "$SEALED"
  [ -z "$LOCK" ] || rmdir "$LOCK" 2>/dev/null || true
}
trap cleanup EXIT

die() { echo "[consume-mode-intent] ⛔ $1" >&2; exit 2; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --progress) [ "$#" -ge 2 ] || die "--progress 缺值"; PROGRESS="$2"; shift 2 ;;
    --harness) [ "$#" -ge 2 ] || die "--harness 缺值"; HARNESS="$2"; shift 2 ;;
    --registry) [ "$#" -ge 2 ] || die "--registry 缺值"; REGISTRY="$2"; shift 2 ;;
    --pub) [ "$#" -ge 2 ] || die "--pub 缺值"; PUB="$2"; shift 2 ;;
    --adapters) [ "$#" -ge 2 ] || die "--adapters 缺值"; ADAPTERS="$2"; shift 2 ;;
    --batch) [ "$#" -ge 2 ] || die "--batch 缺值"; BATCH="$2"; shift 2 ;;
    -h|--help)
      echo "usage: consume-mode-intent.sh --batch <safe-batch-id> [--progress progress.json] [--harness harness.json] [--registry .agents-registry.json] [--pub console.pub] [--adapters adapters-dir]" >&2
      exit 0
      ;;
    *) die "未知参数：$1" ;;
  esac
done

[ -n "$BATCH" ] || die "必须提供 --batch"
[[ "$BATCH" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || die "batch 必须是安全稳定标识"
[ -f "$PROGRESS" ] || die "progress 不存在：$PROGRESS"
[ -f "$HARNESS" ] || die "harness.json 不存在：$HARNESS"
[ -f "$PUB" ] || die "console.pub 不存在：$PUB"
[ -z "$ADAPTERS" ] || [ -d "$ADAPTERS" ] || die "adapter 目录不存在：$ADAPTERS"
[ -x "$VALIDATOR" ] || die "validate-mode-intent.sh 不存在或不可执行"

# This command durably writes the active checkpoint. Registry contents select
# its runtime tool bindings, so bind them to the same project that owns
# progress before the checkpoint lock or any persistence work begins.
PROJECT_DIR="$(cd "$(dirname "$PROGRESS")" && pwd)"
PROJECT_ROOT="$(git -C "$PROJECT_DIR" rev-parse --show-toplevel 2>/dev/null)" \
  || die "无法从 progress 所在目录确定 git 项目根"
REGISTRY="$(cd "$PROJECT_ROOT" && python3 "$CONSOLE_DIR/../dispatch/dispatch_common.py" project-registry \
  --project-root "$PROJECT_ROOT" --registry "$REGISTRY")" \
  || die "registry 必须是项目根的非符号链接 .agents-registry.json"

# mkdir is an atomic acquisition primitive. A second planner must not validate
# one intent and then overwrite the first planner's newly consumed checkpoint.
LOCK="${PROGRESS}.mode-intent.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  die "已有 mode intent 消费正在进行：$LOCK"
fi

# This invocation reads harness.json exactly once, verifies it, resolves from
# the same verified snapshot, and writes a data-only handoff. Do not reread the
# staged file below.
VALIDATOR_ARGS=(--emit-resolution-input)
if [ -n "$ADAPTERS" ]; then
  VALIDATOR_ARGS+=(--adapters "$ADAPTERS")
fi
VALIDATOR_ARGS+=("$HARNESS" "$REGISTRY" "$PUB")
bash "$VALIDATOR" "${VALIDATOR_ARGS[@]}" > "$SEALED" \
  || die "签名 mode intent 未通过新批次消费验证"

# A default framework adapter directory is deterministic and remains implicit.
# Only an explicit project-owned override needs durable state so every active
# command reuses the exact directory selected when the signed bindings were
# consumed.
PERSISTED_ADAPTER_DIR=""
if [ -n "$ADAPTERS" ]; then
  PERSIST_ADAPTERS="$(python3 - "$SEALED" <<'PY'
import json
import sys

try:
    sealed = json.load(open(sys.argv[1], encoding="utf-8"))
except (OSError, ValueError) as exc:
    raise SystemExit(f"[consume-mode-intent] ⛔ 无法读取已验签消费快照：{exc}")
print("yes" if sealed.get("execution_version") == "v2" and sealed.get("profile") != "fast" else "no")
PY
)" || die "无法判断已验签 mode intent 的 adapter 持久化条件"
  if [ "$PERSIST_ADAPTERS" = yes ]; then
    [ -x "$MODE_ADAPTERS" ] || die "resolve-mode-adapters.sh 不存在或不可执行"
    PERSISTED_ADAPTER_DIR="$(bash "$MODE_ADAPTERS" --persist --progress "$PROGRESS" --adapters "$ADAPTERS")" \
      || die "自定义 adapter 目录必须是项目内的非链接目录"
  fi
fi

if ! python3 - "$PROGRESS" "$SEALED" "$BATCH" "$PERSISTED_ADAPTER_DIR" <<'PY'
import datetime
import json
import os
import re
import stat
import sys
import tempfile

progress_path, sealed_path, batch, persisted_adapter_dir = sys.argv[1:5]
roles = ("planner", "generator", "evaluator")
stable_id = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
stable_tool = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}\Z")
adapter_segment = re.compile(r"[A-Za-z0-9._-]+\Z")
resolution_fields = {
    "agent_id", "tool", "invocation", "model_family", "priority",
    "execution_provenance_sha256",
}
sha256 = re.compile(r"[0-9a-f]{64}\Z")


def fail(message):
    print(f"[consume-mode-intent] ⛔ {message}", file=sys.stderr)
    raise SystemExit(2)


def no_duplicates(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f"重复 JSON 键 {key!r}")
        value[key] = item
    return value


def load(path, label):
    try:
        with open(path, encoding="utf-8") as stream:
            return json.load(stream, object_pairs_hook=no_duplicates)
    except (OSError, ValueError) as exc:
        fail(f"{label} JSON 非法：{exc}")


progress = load(progress_path, "progress")
sealed = load(sealed_path, "已验签消费快照")
if not isinstance(progress, dict):
    fail("progress 根节点必须是 object")
if progress.get("status") not in ("new", "done"):
    fail("只允许在 status=new 或 done 的新批次边界消费；active batch 不可改写模式")
expected_sealed = {"execution_version", "profile", "role_bindings", "intent_id", "signed_intent", "resolution"}
if set(sealed) != expected_sealed:
    fail("已验签消费快照 shape 非法")
intent = sealed["signed_intent"]
if not isinstance(intent, dict) or intent.get("intent_id") != sealed.get("intent_id"):
    fail("signed_intent 与 intent_id 不一致")
execution = intent.get("desired", {}).get("execution") if isinstance(intent.get("desired"), dict) else None
if not isinstance(execution, dict):
    fail("signed_intent.desired.execution 非法")
if execution.get("profile") != sealed.get("profile"):
    fail("signed_intent profile 与已验签快照不一致")

previous = progress.get("mode_intent")
if isinstance(previous, dict) and previous.get("intent_id") == sealed["intent_id"]:
    fail("该 intent_id 已消费过，不得跨批次重放")

mode = {
    "intent_id": sealed["intent_id"],
    "applied_batch": batch,
    "applied_at": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
}
version = sealed["execution_version"]
profile = sealed["profile"]
if version == "v1":
    assignments = execution.get("role_assignments")
    if profile == "fast":
        if assignments is not None:
            fail("v1 fast 的 role_assignments 必须为 null")
    elif not isinstance(assignments, dict):
        fail("v1 non-fast 的 role_assignments 必须是 object")
    progress["role_assignments"] = assignments
elif version == "v2":
    bindings = execution.get("role_bindings")
    if bindings != sealed["role_bindings"]:
        fail("signed_intent role_bindings 与已验签快照不一致")
    if profile == "fast":
        if bindings is not None or sealed["resolution"] is not None:
            fail("v2 fast 不得带 role_bindings 或 resolution")
        progress["role_assignments"] = None
    else:
        if not isinstance(bindings, dict) or set(bindings) != set(roles):
            fail("v2 non-fast 的已签名 role_bindings 必须恰含三角色")
        resolution = sealed["resolution"]
        if not isinstance(resolution, dict) or set(resolution) != set(roles):
            fail("v2 non-fast 的 resolution 必须恰含三角色")
        assignments = {}
        for role in roles:
            binding = bindings[role]
            record = resolution[role]
            if role == "planner" and binding is None:
                if record is not None:
                    fail("Coordinator Planner 不得拥有外部 resolution")
                assignments[role] = None
                continue
            if not isinstance(binding, dict) or set(binding) != {"tool", "invocation"}:
                fail(f"已签名 role_bindings.{role} shape 非法")
            if not isinstance(record, dict) or set(record) != resolution_fields:
                fail(f"resolution.{role} 必须恰含六个审计字段（含 execution_provenance_sha256）")
            if binding.get("tool") != record.get("tool") or binding.get("invocation") != record.get("invocation"):
                fail(f"resolution.{role} 未绑定到已签名 tool/invocation")
            if not isinstance(record["agent_id"], str) or not stable_id.fullmatch(record["agent_id"]):
                fail(f"resolution.{role}.agent_id 非法")
            if not isinstance(record["tool"], str) or not stable_tool.fullmatch(record["tool"]):
                fail(f"resolution.{role}.tool 非法")
            if record["invocation"] not in ("subagent", "local-cli", "a2a"):
                fail(f"resolution.{role}.invocation 非法")
            if not isinstance(record["model_family"], str) or not record["model_family"]:
                fail(f"resolution.{role}.model_family 非法")
            if isinstance(record["priority"], bool) or not isinstance(record["priority"], int) or record["priority"] < 0:
                fail(f"resolution.{role}.priority 非法")
            if not isinstance(record["execution_provenance_sha256"], str) or not sha256.fullmatch(record["execution_provenance_sha256"]):
                fail(f"resolution.{role}.execution_provenance_sha256 必须是小写 SHA-256")
            assignments[role] = record["agent_id"]
        progress["role_assignments"] = assignments
        # Persist the full signed object, not just the canonical payload: the
        # sig is what lets every active wake independently reject tampering.
        mode["signed_intent"] = intent
        mode["resolution"] = resolution
        if persisted_adapter_dir:
            parts = persisted_adapter_dir.split("/")
            if (
                persisted_adapter_dir.startswith("/")
                or "\\" in persisted_adapter_dir
                or any(part in ("", ".", "..") or not adapter_segment.fullmatch(part) for part in parts)
            ):
                fail("已持久化 adapter_dir 非法")
            mode["adapter_dir"] = persisted_adapter_dir
else:
    fail("已验签 execution_version 非法")

progress["mode_intent"] = mode
target = os.path.abspath(progress_path)
directory = os.path.dirname(target)
try:
    original_mode = stat.S_IMODE(os.stat(target).st_mode)
    fd, temporary = tempfile.mkstemp(prefix=f".{os.path.basename(target)}.mode-intent-", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(progress, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, original_mode)
        os.replace(temporary, target)
        directory_fd = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except Exception:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise
except OSError as exc:
    fail(f"progress 原子写入失败：{exc}")

print(json.dumps({"intent_id": mode["intent_id"], "applied_batch": batch, "execution_version": version, "profile": profile}, ensure_ascii=False, sort_keys=True))
PY
then
  exit 2
fi
