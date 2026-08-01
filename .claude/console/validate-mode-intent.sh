#!/usr/bin/env bash
# Validate a staged, signed harness.json project.mode_defaults intent at /plan.
#
# Usage: validate-mode-intent.sh [harness.json] [.agents-registry.json] [console.pub]
#        validate-mode-intent.sh --emit-resolution-input [harness.json] [.agents-registry.json] [console.pub]
#        validate-mode-intent.sh --checkpoint <signed-intent.json> [--repo-root <project-root>] [--adapters <dir>] [registry] [console.pub]
# Exit 0 means the complete intent is signed, unexpired, repository-bound, and
# compatible with the registry. This validator intentionally does not compare
# expected_head_sha with repository HEAD: that check belongs only to the device
# agent immediately before its atomic harness.json staging commit.
#
# --checkpoint is deliberately different: it verifies a v2 intent that was
# already consumed at a batch boundary. Its signature, complete shape, repo
# identity, and bindings remain mandatory, but intent_expires_at no longer
# revokes a running batch merely because wall time passed. The live autonomy
# policy retains its own expiry gate.

set -euo pipefail
umask 077

EMIT_RESOLUTION_INPUT=false
CHECKPOINT=""
REPO_ROOT=""
ADAPTERS=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --emit-resolution-input)
      EMIT_RESOLUTION_INPUT=true
      shift
      ;;
    --checkpoint)
      [ "$#" -ge 2 ] || { echo "[mode-intent] ⛔ --checkpoint 缺值" >&2; exit 2; }
      CHECKPOINT="$2"
      shift 2
      ;;
    --repo-root)
      [ "$#" -ge 2 ] || { echo "[mode-intent] ⛔ --repo-root 缺值" >&2; exit 2; }
      REPO_ROOT="$2"
      shift 2
      ;;
    --adapters)
      [ "$#" -ge 2 ] || { echo "[mode-intent] ⛔ --adapters 缺值" >&2; exit 2; }
      ADAPTERS="$2"
      shift 2
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "[mode-intent] ⛔ 未知参数：$1" >&2
      exit 2
      ;;
    *) break ;;
  esac
done

DEFAULT_PUB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/console.pub"
if [ -n "$CHECKPOINT" ]; then
  [ "$#" -le 2 ] || { echo "[mode-intent] ⛔ checkpoint 模式只接受 [registry] [console.pub]" >&2; exit 2; }
  SOURCE="$CHECKPOINT"
  SOURCE_KIND="checkpoint"
  REGISTRY="${1:-.agents-registry.json}"
  PUB="${2:-$DEFAULT_PUB}"
  REPO_ROOT="${REPO_ROOT:-$PWD}"
else
  [ "$#" -le 3 ] || { echo "[mode-intent] ⛔ 用法：validate-mode-intent.sh [harness.json] [.agents-registry.json] [console.pub]" >&2; exit 2; }
  HARNESS="${1:-harness.json}"
  SOURCE="$HARNESS"
  SOURCE_KIND="staged"
  REGISTRY="${2:-.agents-registry.json}"
  PUB="${3:-$DEFAULT_PUB}"
  REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$HARNESS")" && pwd)}"
fi

fail() { echo "[mode-intent] ⛔ $1" >&2; exit 2; }

[ -f "$SOURCE" ] || fail "$([ "$SOURCE_KIND" = checkpoint ] && printf '已消费 checkpoint' || printf 'harness.json') 不存在：$SOURCE"
[ -d "$REPO_ROOT" ] || fail "项目根目录不存在：$REPO_ROOT"
[ -f "$PUB" ] || fail "console.pub 不存在；签名模式意图必须用项目内公钥验签"
command -v python3 >/dev/null 2>&1 || fail "python3 不可用"
command -v git >/dev/null 2>&1 || fail "git 不可用，无法验证 repo_key"
DISPATCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../dispatch" && pwd)"
PROJECT_ROOT="$(git -C "$REPO_ROOT" rev-parse --show-toplevel 2>/dev/null)" \
  || fail "无法从项目根目录确定 git 项目；不能验证 registry 归属"
# Fast/legacy validation may intentionally run before a registry exists. When
# one is supplied, however, every signed or replayed binding must derive from
# the project-owned regular file rather than an arbitrary caller path.
if [ -e "$REGISTRY" ] || [ -L "$REGISTRY" ]; then
  REGISTRY="$(cd "$PROJECT_ROOT" && python3 "$DISPATCH_DIR/dispatch_common.py" project-registry \
    --project-root "$PROJECT_ROOT" --registry "$REGISTRY")" \
    || fail "registry 必须是项目根的非符号链接 .agents-registry.json"
fi

# macOS /usr/bin/openssl is commonly LibreSSL without Ed25519. Prefer an
# explicit override, then PATH, then standard Homebrew OpenSSL 3 locations.
OPENSSL_BIN=""
for candidate in "${HARNESS_OPENSSL:-}" "$(command -v openssl 2>/dev/null || true)" \
    /opt/homebrew/bin/openssl /usr/local/bin/openssl; do
  [ -n "$candidate" ] && [ -x "$candidate" ] || continue
  if "$candidate" list -public-key-algorithms 2>/dev/null | grep -qi 'ED25519'; then
    OPENSSL_BIN="$candidate"
    break
  fi
done
[ -n "$OPENSSL_BIN" ] || fail "需要支持 Ed25519 的 OpenSSL 3（可用 HARNESS_OPENSSL 指定）"

PAYLOAD="$(mktemp)"
SIG="$(mktemp)"
BINDINGS="$(mktemp)"
SEALED_INTENT="$(mktemp)"
TOOL_CATALOG="$DISPATCH_DIR/tool-catalog.py"
DISPATCH_VALIDATOR="$DISPATCH_DIR/validate-dispatch.sh"
cleanup() { rm -f "$PAYLOAD" "$SIG" "$BINDINGS" "$SEALED_INTENT"; }
trap cleanup EXIT

python3 - "$SOURCE" "$SOURCE_KIND" "$REPO_ROOT" "$REGISTRY" "$PAYLOAD" "$SIG" "$SEALED_INTENT" "$TOOL_CATALOG" <<'PY'
import base64
import datetime
import json
import math
from decimal import Decimal, InvalidOperation
import os
import re
import subprocess
import sys

source_path, source_kind, repo_root, registry_path, payload_path, sig_path, sealed_path, tool_catalog_path = sys.argv[1:9]


def reject(message):
    print(f"[mode-intent] ⛔ {message}", file=sys.stderr)
    raise SystemExit(2)


def reject_duplicate_keys(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f"重复 JSON 键 {key!r}")
        value[key] = item
    return value


class ParsedInt(int):
    def __new__(cls, raw):
        result = int.__new__(cls, raw)
        result.negative_zero = raw.startswith("-") and result == 0
        return result


class ParsedFloat(float):
    def __new__(cls, raw):
        result = float.__new__(cls, raw)
        result.negative_zero = raw.startswith("-") and result == 0
        return result


def load_json(path, label):
    try:
        with open(path, encoding="utf-8") as stream:
            return json.load(
                stream,
                object_pairs_hook=reject_duplicate_keys,
                parse_int=ParsedInt,
                parse_float=ParsedFloat,
            )
    except FileNotFoundError:
        raise
    except Exception as exc:
        reject(f"{label} JSON 非法：{exc}")


def exact_keys(obj, required, optional=(), label="object"):
    if not isinstance(obj, dict):
        reject(f"{label} 必须是 object")
    required = set(required)
    allowed = required | set(optional)
    missing = sorted(required - set(obj))
    extra = sorted(set(obj) - allowed)
    if missing:
        reject(f"{label} 缺必填字段 {missing}")
    if extra:
        reject(f"{label} 含白名单外字段 {extra}")


def nonempty(value, label):
    if not isinstance(value, str) or not value.strip():
        reject(f"{label} 必须是非空 string")


def integer(value, label, minimum, maximum):
    if isinstance(value, bool) or not isinstance(value, int):
        reject(f"{label} 必须是 integer")
    if not minimum <= value <= maximum:
        reject(f"{label} 必须在 {minimum}..{maximum} 内")


UTC_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z")
STABLE_OBJECT_KEY = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}\Z")
RESERVED_OBJECT_KEYS = {"__proto__", "prototype", "constructor"}


def utc_timestamp(value, label):
    if not isinstance(value, str) or not UTC_PATTERN.fullmatch(value):
        reject(f"{label} 必须是带 Z 的绝对 ISO-8601 UTC 时间")
    try:
        parsed = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        reject(f"{label} 日期非法：{value}")
    return parsed


def normalize_remote(value):
    if not isinstance(value, str):
        return None
    value = value.strip()
    value = re.sub(r"^ssh://git@", "", value, flags=re.I)
    value = re.sub(r"^git@([^:]+):", r"\1/", value, flags=re.I)
    value = re.sub(r"^https?://", "", value, flags=re.I)
    value = re.sub(r"^git://", "", value, flags=re.I)
    value = re.sub(r"\.git$", "", value, flags=re.I)
    return value.lower() or None


if source_kind == "staged":
    harness = load_json(source_path, "harness.json")
    project = harness.get("project")
    if not isinstance(project, dict) or "mode_defaults" not in project:
        reject("harness.json project.mode_defaults 不存在（无意图时继续本机手工路径）")

    mode_defaults = project["mode_defaults"]
    exact_keys(mode_defaults, ("intent", "staged_at"), label="project.mode_defaults")
    utc_timestamp(mode_defaults["staged_at"], "project.mode_defaults.staged_at")
    intent = mode_defaults["intent"]
elif source_kind == "checkpoint":
    # This is the exact, complete signed object persisted at consumption. It
    # intentionally has no staged_at wrapper: later harness.json staging must
    # not redirect an active batch to a new intent.
    intent = load_json(source_path, "已消费 signed_intent checkpoint")
else:
    reject("内部错误：未知 mode intent source kind")

exact_keys(
    intent,
    (
        "intent_id",
        "repo_key",
        "expected_head_sha",
        "desired",
        "issued_by",
        "issued_at",
        "intent_expires_at",
        "sig",
    ),
    label="project.mode_defaults.intent",
)

for field in ("intent_id", "repo_key", "issued_by"):
    nonempty(intent[field], f"intent.{field}")
if not isinstance(intent["expected_head_sha"], str) or not re.fullmatch(
    r"[0-9a-fA-F]{40}", intent["expected_head_sha"]
):
    reject("intent.expected_head_sha 必须是 40 位十六进制 SHA")

issued_at = utc_timestamp(intent["issued_at"], "intent.issued_at")
intent_expiry = utc_timestamp(intent["intent_expires_at"], "intent.intent_expires_at")
now = datetime.datetime.now(datetime.timezone.utc)
if source_kind == "staged" and intent_expiry <= now:
    reject(f"模式意图已于 {intent['intent_expires_at']} 过期")
if intent_expiry <= issued_at:
    reject("intent_expires_at 必须晚于 issued_at")

# Repo identity remains stable across staging/state commits. This is the only
# Git fact /plan checks; expected_head_sha is deliberately treated as signed
# audit metadata after the device's one-time pre-staging check.
try:
    origin = subprocess.check_output(
        ["git", "-C", repo_root, "remote", "get-url", "origin"],
        text=True,
        stderr=subprocess.DEVNULL,
    ).strip()
except (OSError, subprocess.CalledProcessError):
    reject("无法读取项目 origin，不能验证签名 repo_key")
actual_repo_key = normalize_remote(origin)
signed_repo_key = intent["repo_key"]
if normalize_remote(signed_repo_key) != signed_repo_key:
    reject("intent.repo_key 不是 tokenizer 规范化格式")
if signed_repo_key != actual_repo_key:
    reject(f"intent.repo_key 与当前项目身份不匹配（当前 {actual_repo_key!r}）")

desired = intent["desired"]
exact_keys(desired, ("execution", "autonomy"), label="intent.desired")
execution = desired["execution"]
if not isinstance(execution, dict):
    reject("desired.execution 必须是 object")
execution_keys = set(execution)
if execution_keys == {"profile", "role_assignments"}:
    execution_version = "v1"
elif execution_keys == {"profile", "role_bindings"}:
    execution_version = "v2"
else:
    reject("desired.execution 必须是 v1 的 profile+role_assignments，或 v2 的 profile+role_bindings")
profile = execution["profile"]
if profile not in ("fast", "heterogeneous", "slow"):
    reject(f"desired.execution.profile 非法：{profile!r}")

assignments = execution.get("role_assignments")
bindings = execution.get("role_bindings")
if execution_version == "v1":
    if profile == "fast":
        if assignments is not None:
            reject("profile=fast 时 role_assignments 必须为 null")
    else:
        exact_keys(assignments, ("generator", "evaluator"), label="role_assignments")
        for role in ("generator", "evaluator"):
            nonempty(assignments[role], f"role_assignments.{role}")
        if assignments["generator"] == assignments["evaluator"]:
            reject("generator 与 evaluator 不得是同一 agent")
else:
    if profile == "fast":
        if bindings is not None:
            reject("profile=fast 时 role_bindings 必须为 null；fast 保留 Coordinator 的本机默认路径")
    else:
        exact_keys(bindings, ("planner", "generator", "evaluator"), label="role_bindings")
        invocation_by_role = {}
        for role in ("planner", "generator", "evaluator"):
            binding = bindings[role]
            if role == "planner" and binding is None:
                # An explicit null is the signed Coordinator route. It is not
                # an unconfigured external role and must not enter catalog
                # resolution or transport-profile checks.
                continue
            exact_keys(binding, ("tool", "invocation"), label=f"role_bindings.{role}")
            tool = binding["tool"]
            if not isinstance(tool, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", tool):
                reject(f"role_bindings.{role}.tool 必须是 1..64 位稳定工具标识")
            invocation = binding["invocation"]
            if invocation not in ("subagent", "local-cli", "a2a"):
                reject(f"role_bindings.{role}.invocation 非法：{invocation!r}")
            invocation_by_role[role] = invocation

        invocations = list(invocation_by_role.values())
        if profile == "heterogeneous":
            if "a2a" in invocations or not any(value in ("local-cli", "subagent") for value in invocations):
                reject("profile=heterogeneous 要求所有外部角色均非 a2a 且至少一方为 local-cli 或已验证同会话 subagent bridge")
        if profile == "slow" and "a2a" not in invocations:
            reject("profile=slow 要求至少一个角色为 a2a")

autonomy = desired["autonomy"]
if not isinstance(autonomy, dict) or not isinstance(autonomy.get("enabled"), bool):
    reject("desired.autonomy.enabled 必须是 boolean")
if autonomy["enabled"] is False:
    exact_keys(autonomy, ("enabled",), label="desired.autonomy")
else:
    exact_keys(
        autonomy,
        ("enabled", "expires_at", "auto_cross", "budget"),
        ("wake_interval_s", "notify_on"),
        "desired.autonomy",
    )
    autonomy_expiry = utc_timestamp(autonomy["expires_at"], "autonomy.expires_at")
    if source_kind == "staged" and autonomy_expiry <= now:
        reject(f"自治授权已于 {autonomy['expires_at']} 过期")

    auto_cross = autonomy["auto_cross"]
    if not isinstance(auto_cross, list) or any(not isinstance(x, str) for x in auto_cross):
        reject("autonomy.auto_cross 必须是 string array")
    if len(auto_cross) != len(set(auto_cross)):
        reject("autonomy.auto_cross 不得重复")
    bad_gates = [x for x in auto_cross if x not in ("A", "B")]
    if bad_gates:
        reject(f"autonomy.auto_cross 含非法类 {bad_gates}；Class C 不可预授权")

    budget = autonomy["budget"]
    exact_keys(
        budget,
        ("max_tokens", "max_cost_usd", "max_wakes", "max_fix_rounds"),
        label="autonomy.budget",
    )
    integer(budget["max_tokens"], "budget.max_tokens", 0, 10_000_000)
    cost = budget["max_cost_usd"]
    if (
        isinstance(cost, bool)
        or not isinstance(cost, (int, float))
        or not math.isfinite(cost)
        or not 0 <= cost <= 10_000
    ):
        reject("budget.max_cost_usd 必须是 0..10000 内的有限 number")
    if getattr(cost, "negative_zero", False) or (
        cost == 0 and math.copysign(1.0, float(cost)) < 0
    ):
        reject("budget.max_cost_usd 不得为负零")
    try:
        cents = Decimal(str(cost)) * Decimal("100")
    except (InvalidOperation, ValueError):
        reject("budget.max_cost_usd 必须以 0.01 USD 为精度")
    if cents != cents.to_integral_value():
        reject("budget.max_cost_usd 必须以 0.01 USD 为精度")
    integer(budget["max_wakes"], "budget.max_wakes", 1, 1000)
    integer(budget["max_fix_rounds"], "budget.max_fix_rounds", 0, 5)

    if "wake_interval_s" in autonomy:
        intervals = autonomy["wake_interval_s"]
        if not isinstance(intervals, dict):
            reject("autonomy.wake_interval_s 必须是 object")
        for phase, seconds in intervals.items():
            if (
                not isinstance(phase, str)
                or not STABLE_OBJECT_KEY.fullmatch(phase)
                or phase in RESERVED_OBJECT_KEYS
            ):
                reject(
                    "autonomy.wake_interval_s phase 必须是非保留的 1..64 位稳定标识"
                )
            integer(seconds, f"wake_interval_s.{phase}", 60, 86400)

    if "notify_on" in autonomy:
        notify = autonomy["notify_on"]
        allowed_notify = {"halt", "done", "budget_80pct", "scope_drift", "ci_red"}
        if not isinstance(notify, list) or any(
            not isinstance(item, str) or item not in allowed_notify for item in notify
        ):
            reject("autonomy.notify_on 含非法值")
        if len(notify) != len(set(notify)):
            reject("autonomy.notify_on 不得重复")

if profile != "fast" and execution_version == "v1":
    try:
        registry = load_json(registry_path, "agent 注册表")
    except FileNotFoundError:
        reject(f"profile={profile} 但 agent 注册表不存在：{registry_path}")
    agents = registry.get("agents")
    if not isinstance(agents, list):
        reject("agent 注册表缺 agents array")
    ids = []
    for agent in agents:
        if not isinstance(agent, dict):
            reject("agent 注册表 descriptor 必须是 object")
        nonempty(agent.get("id"), "agent descriptor id")
        ids.append(agent["id"])
    if len(ids) != len(set(ids)):
        reject("agent 注册表含重复 id")
    by_id = {agent["id"]: agent for agent in agents}
    descriptors = {}
    for role, agent_id in assignments.items():
        descriptor = by_id.get(agent_id)
        if descriptor is None:
            reject(f"role_assignments.{role}={agent_id!r} 在注册表中不存在")
        roles = descriptor.get("roles")
        if not isinstance(roles, list) or role not in roles:
            reject(f"agent {agent_id!r} 的 roles 不含 {role}，属于越权分配")
        nonempty(descriptor.get("model_family"), f"agent {agent_id!r}.model_family")
        if descriptor.get("transport") not in ("subagent", "local-cli", "a2a"):
            reject(f"agent {agent_id!r} 的 transport 非法")
        descriptors[role] = descriptor

    generator_family = descriptors["generator"]["model_family"]
    evaluator_family = descriptors["evaluator"]["model_family"]
    if generator_family == evaluator_family:
        reject(
            f"generator/evaluator 的 model_family 同为 {generator_family!r}；异构独立性不成立"
        )
    transports = [descriptors[role]["transport"] for role in ("generator", "evaluator")]
    if profile == "heterogeneous":
        if "a2a" in transports or not any(value in ("local-cli", "subagent") for value in transports):
            reject("profile=heterogeneous 要求无 a2a 且至少一个 local-cli 或同会话 subagent bridge")
    if profile == "slow" and "a2a" not in transports:
        reject("profile=slow 要求至少一个 a2a；另一角色可为 subagent、local-cli 或 a2a")

sig = intent["sig"]
nonempty(sig, "intent.sig")
try:
    sig_bytes = base64.b64decode(sig, validate=True)
except Exception as exc:
    reject(f"intent.sig 不是合法 base64：{exc}")
if len(sig_bytes) != 64:
    reject("intent.sig 解码后必须是 64-byte Ed25519 signature")

payload = {key: value for key, value in intent.items() if key != "sig"}
canonical = json.dumps(
    payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
).encode("utf-8")
open(payload_path, "wb").write(canonical)
open(sig_path, "wb").write(sig_bytes)
# This is the only parse of the mutable harness file. Later stages use this
# narrow sealed snapshot after signature verification, never harness.json.
json.dump(
    {
        "profile": profile,
        "execution_version": execution_version,
        "role_bindings": bindings if execution_version == "v2" else None,
        "intent_id": intent["intent_id"],
        "signed_intent": intent,
    },
    open(sealed_path, "w", encoding="utf-8"),
    ensure_ascii=False,
    sort_keys=True,
    separators=(",", ":"),
)
PY

if ! "$OPENSSL_BIN" pkeyutl -verify -pubin -inkey "$PUB" -rawin \
    -in "$PAYLOAD" -sigfile "$SIG" >/dev/null 2>&1; then
  fail "Ed25519 签名无效；意图被篡改或非持私钥者签发"
fi

# Only resolve tool bindings after the complete human-signed payload has passed
# Ed25519 verification. Resolution reads local registry/adapter state, but it
# must never be driven by an unauthenticated payload.
MODE_META="$(python3 - "$SEALED_INTENT" "$BINDINGS" <<'PY'
import json, sys

sealed_path, bindings_path = sys.argv[1:3]
try:
    sealed = json.load(open(sealed_path, encoding="utf-8"))
    if set(sealed) != {
        "execution_version", "profile", "role_bindings", "intent_id", "signed_intent"
    }:
        raise ValueError("sealed snapshot shape")
    profile = sealed["profile"]
    execution_version = sealed["execution_version"]
    bindings = sealed["role_bindings"]
except (OSError, TypeError, ValueError, KeyError) as exc:
    raise SystemExit(f"[mode-intent] ⛔ 已验签快照不可读：{exc}")
if profile not in ("fast", "heterogeneous", "slow") or execution_version not in ("v1", "v2"):
    raise SystemExit("[mode-intent] ⛔ 已验签快照字段非法")
if execution_version == "v2" and bindings is not None:
    json.dump(bindings, open(bindings_path, "w", encoding="utf-8"),
              sort_keys=True, separators=(",", ":"), ensure_ascii=False)
print(profile)
print(execution_version)
PY
)"
PROFILE="${MODE_META%%$'\n'*}"
EXECUTION_VERSION="${MODE_META#*$'\n'}"
RESOLUTION='null'
if [ "$EXECUTION_VERSION" = "v2" ] && [ "$PROFILE" != "fast" ]; then
  [ -f "$DISPATCH_VALIDATOR" ] || fail "框架缺少 validate-dispatch.sh，不能预检 v2 注册表；请升级 harness"
  REGISTRY_ARGS=(registry "$REGISTRY")
  if [ -n "$ADAPTERS" ]; then
    [ -d "$ADAPTERS" ] || fail "adapter 目录不存在：$ADAPTERS"
    REGISTRY_ARGS+=(--adapters "$ADAPTERS")
  fi
  REGISTRY_CHECK="$(bash "$DISPATCH_VALIDATOR" "${REGISTRY_ARGS[@]}" 2>&1)" \
    || fail "v2 注册表未满足可安全派发条件：${REGISTRY_CHECK:0:400}"
  [ -f "$TOOL_CATALOG" ] || fail "框架缺少 tool-catalog.py，不能解析 v2 工具绑定；请升级 harness"
  RESOLVE_COMMAND=(python3 "$TOOL_CATALOG" resolve --registry "$REGISTRY" --bindings "$BINDINGS")
  if [ -n "$ADAPTERS" ]; then
    [ -d "$ADAPTERS" ] || fail "adapter 目录不存在：$ADAPTERS"
    RESOLVE_COMMAND+=(--adapters "$ADAPTERS")
  fi
  RESOLUTION="$("${RESOLVE_COMMAND[@]}" 2>&1)" \
    || fail "v2 工具绑定没有满足安全约束的本机候选：${RESOLUTION:0:400}"
fi
if [ "$EMIT_RESOLUTION_INPUT" = true ]; then
  # The one-shot output is the only safe handoff for a consumer: raw
  # harness.json is never reread after validation. Include the resolver result
  # generated from this same signed snapshot and registry preflight.
  python3 - "$SEALED_INTENT" "$RESOLUTION" <<'PY'
import json
import sys

try:
    sealed = json.load(open(sys.argv[1], encoding="utf-8"))
    resolution = json.loads(sys.argv[2])
except (OSError, TypeError, ValueError, json.JSONDecodeError) as exc:
    raise SystemExit(f"[mode-intent] ⛔ 无法构造已验签消费快照：{exc}")
sealed["resolution"] = resolution
print(json.dumps(sealed, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
PY
  # Keep status text on stderr so no later parser can accidentally consume it.
  if [ "$SOURCE_KIND" = checkpoint ]; then
    echo "[mode-intent] ✓ 已消费签名 checkpoint 合法（profile=${PROFILE}；execution=${EXECUTION_VERSION}；intent_expires_at 不撤销 active batch）" >&2
  else
    echo "[mode-intent] ✓ 签名意图合法且未过期（profile=${PROFILE}；execution=${EXECUTION_VERSION}；expected_head_sha 仅作已完成 staging 的审计元数据）" >&2
  fi
else
  if [ "$SOURCE_KIND" = checkpoint ]; then
    echo "[mode-intent] ✓ 已消费签名 checkpoint 合法（profile=${PROFILE}；execution=${EXECUTION_VERSION}；intent_expires_at 不撤销 active batch）"
  else
    echo "[mode-intent] ✓ 签名意图合法且未过期（profile=${PROFILE}；execution=${EXECUTION_VERSION}；expected_head_sha 仅作已完成 staging 的审计元数据）"
  fi
fi
