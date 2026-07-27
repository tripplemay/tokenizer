#!/usr/bin/env bash
# Validate a staged, signed harness.json project.mode_defaults intent at /plan.
#
# Usage: validate-mode-intent.sh [harness.json] [.agents-registry.json] [console.pub]
# Exit 0 means the complete intent is signed, unexpired, repository-bound, and
# compatible with the registry. This validator intentionally does not compare
# expected_head_sha with repository HEAD: that check belongs only to the device
# agent immediately before its atomic harness.json staging commit.

set -euo pipefail

HARNESS="${1:-harness.json}"
REGISTRY="${2:-.agents-registry.json}"
PUB="${3:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/console.pub}"

fail() { echo "[mode-intent] ⛔ $1" >&2; exit 2; }

[ -f "$HARNESS" ] || fail "harness.json 不存在：$HARNESS"
[ -f "$PUB" ] || fail "console.pub 不存在；签名模式意图必须用项目内公钥验签"
command -v python3 >/dev/null 2>&1 || fail "python3 不可用"
command -v git >/dev/null 2>&1 || fail "git 不可用，无法验证 repo_key"

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
cleanup() { rm -f "$PAYLOAD" "$SIG"; }
trap cleanup EXIT

python3 - "$HARNESS" "$REGISTRY" "$PAYLOAD" "$SIG" <<'PY'
import base64
import datetime
import json
import math
import os
import re
import subprocess
import sys

harness_path, registry_path, payload_path, sig_path = sys.argv[1:5]


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


def load_json(path, label):
    try:
        with open(path, encoding="utf-8") as stream:
            return json.load(stream, object_pairs_hook=reject_duplicate_keys)
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


harness = load_json(harness_path, "harness.json")
project = harness.get("project")
if not isinstance(project, dict) or "mode_defaults" not in project:
    reject("harness.json project.mode_defaults 不存在（无意图时继续本机手工路径）")

mode_defaults = project["mode_defaults"]
exact_keys(mode_defaults, ("intent", "staged_at"), label="project.mode_defaults")
utc_timestamp(mode_defaults["staged_at"], "project.mode_defaults.staged_at")

intent = mode_defaults["intent"]
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
if intent_expiry <= now:
    reject(f"模式意图已于 {intent['intent_expires_at']} 过期")
if intent_expiry <= issued_at:
    reject("intent_expires_at 必须晚于 issued_at")

# Repo identity remains stable across staging/state commits. This is the only
# Git fact /plan checks; expected_head_sha is deliberately treated as signed
# audit metadata after the device's one-time pre-staging check.
harness_dir = os.path.dirname(os.path.abspath(harness_path)) or "."
try:
    origin = subprocess.check_output(
        ["git", "-C", harness_dir, "remote", "get-url", "origin"],
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
exact_keys(execution, ("profile", "role_assignments"), label="desired.execution")
profile = execution["profile"]
if profile not in ("fast", "heterogeneous", "slow"):
    reject(f"desired.execution.profile 非法：{profile!r}")

assignments = execution["role_assignments"]
if profile == "fast":
    if assignments is not None:
        reject("profile=fast 时 role_assignments 必须为 null")
else:
    exact_keys(assignments, ("generator", "evaluator"), label="role_assignments")
    for role in ("generator", "evaluator"):
        nonempty(assignments[role], f"role_assignments.{role}")
    if assignments["generator"] == assignments["evaluator"]:
        reject("generator 与 evaluator 不得是同一 agent")

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
    if autonomy_expiry <= now:
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
    integer(budget["max_wakes"], "budget.max_wakes", 1, 1000)
    integer(budget["max_fix_rounds"], "budget.max_fix_rounds", 0, 5)

    if "wake_interval_s" in autonomy:
        intervals = autonomy["wake_interval_s"]
        if not isinstance(intervals, dict):
            reject("autonomy.wake_interval_s 必须是 object")
        for phase, seconds in intervals.items():
            nonempty(phase, "autonomy.wake_interval_s phase")
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

if profile != "fast":
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
        if "a2a" in transports or "local-cli" not in transports:
            reject("profile=heterogeneous 要求无 a2a 且至少一个 local-cli")
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
PY

if ! "$OPENSSL_BIN" pkeyutl -verify -pubin -inkey "$PUB" -rawin \
    -in "$PAYLOAD" -sigfile "$SIG" >/dev/null 2>&1; then
  fail "Ed25519 签名无效；意图被篡改或非持私钥者签发"
fi

PROFILE="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['project']['mode_defaults']['intent']['desired']['execution']['profile'])" "$HARNESS")"
echo "[mode-intent] ✓ 签名意图合法且未过期（profile=${PROFILE}；expected_head_sha 仅作已完成 staging 的审计元数据）"
