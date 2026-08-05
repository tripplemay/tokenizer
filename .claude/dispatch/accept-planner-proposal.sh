#!/usr/bin/env bash
# Accept a proposal returned by the isolated Planner subagent.
#
# The Coordinator owns starting the host-native subagent. This script accepts
# only that returned JSON, then writes the audit artifact and a synthetic
# host-native run-meta record. External Planner bridges must return their
# provider-attested run-meta through dispatch-planner-proposal.sh instead.

set -euo pipefail

DISPATCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE_ADAPTERS="$DISPATCH_DIR/resolve-mode-adapters.sh"
AGENT=""
ENVELOPE=""
PROPOSAL_FILE=""
REGISTRY=".agents-registry.json"
STATE=".harness-dispatch"
PROGRESS="progress.json"
ADAPTERS=""
PUB=""
PROGRESS_EXPLICIT=false

usage() {
  cat >&2 <<'EOF'
用法:
  accept-planner-proposal.sh --agent <resolved-planner-id> --envelope <prepared-envelope.json> \
    --proposal-file <raw-proposal.json> [--registry .agents-registry.json] \
    [--state .harness-dispatch] [--progress progress.json] [--adapters adapters-dir] [--pub console.pub]
EOF
}

die() { echo "[planner-accept] ⛔ $1" >&2; exit 2; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --agent) [ "$#" -ge 2 ] || die "缺 --agent 值"; AGENT="$2"; shift 2 ;;
    --envelope) [ "$#" -ge 2 ] || die "缺 --envelope 值"; ENVELOPE="$2"; shift 2 ;;
    --proposal-file) [ "$#" -ge 2 ] || die "缺 --proposal-file 值"; PROPOSAL_FILE="$2"; shift 2 ;;
    --registry) [ "$#" -ge 2 ] || die "缺 --registry 值"; REGISTRY="$2"; shift 2 ;;
    --state) [ "$#" -ge 2 ] || die "缺 --state 值"; STATE="$2"; shift 2 ;;
    --progress) [ "$#" -ge 2 ] || die "缺 --progress 值"; PROGRESS="$2"; PROGRESS_EXPLICIT=true; shift 2 ;;
    --adapters) [ "$#" -ge 2 ] || die "缺 --adapters 值"; ADAPTERS="$2"; shift 2 ;;
    --pub) [ "$#" -ge 2 ] || die "缺 --pub 值"; PUB="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[planner-accept] ⛔ 未知参数：$1" >&2; usage; exit 2 ;;
  esac
done

[ -n "$AGENT" ] || die "缺 --agent"
[ -f "$ENVELOPE" ] || die "prepared envelope 不存在：$ENVELOPE"
[ -f "$PROPOSAL_FILE" ] || die "proposal file 不存在：$PROPOSAL_FILE"
[ -s "$PROPOSAL_FILE" ] || die "proposal file 不能为空"

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" \
  || die "必须从 git 项目内调用"
cd "$PROJECT_ROOT"
REGISTRY="$(python3 "$DISPATCH_DIR/dispatch_common.py" project-registry \
  --project-root "$PROJECT_ROOT" --registry "$REGISTRY")" \
  || die "注册表必须是项目根的非符号链接 .agents-registry.json"

CANONICAL_PROGRESS="$PROJECT_ROOT/progress.json"
if [ -f "$CANONICAL_PROGRESS" ]; then
  PROVIDED_PROGRESS="$(python3 - "$PROGRESS" <<'PY'
import os
import sys
print(os.path.realpath(sys.argv[1]))
PY
)"
  [ "$PROVIDED_PROGRESS" = "$CANONICAL_PROGRESS" ] || die "--progress 必须是项目根 canonical progress.json"
  [ -x "$MODE_ADAPTERS" ] || die "resolve-mode-adapters.sh 不存在或不可执行"
  MODE_ADAPTER_ARGS=(--progress "$CANONICAL_PROGRESS" --default "$DISPATCH_DIR/transports/adapters")
  [ -z "$ADAPTERS" ] || MODE_ADAPTER_ARGS+=(--adapters "$ADAPTERS")
  ADAPTERS="$(bash "$MODE_ADAPTERS" "${MODE_ADAPTER_ARGS[@]}")" \
    || die "无法恢复 active mode 的 adapter 目录"
  bash "$DISPATCH_DIR/validate-dispatch.sh" registry "$REGISTRY" \
    --progress "$CANONICAL_PROGRESS" --adapters "$ADAPTERS" >&2 \
    || die "注册表校验未通过，不能接收 Planner proposal"
  ACTIVE_ARGS=(--role planner --expected-agent "$AGENT" --progress "$CANONICAL_PROGRESS" --registry "$REGISTRY")
  ACTIVE_ARGS+=(--adapters "$ADAPTERS")
  [ -z "$PUB" ] || ACTIVE_ARGS+=(--pub "$PUB")
  bash "$DISPATCH_DIR/resolve-active-mode-role.sh" "${ACTIVE_ARGS[@]}" >/dev/null \
    || die "active Planner mode role 复验失败"
elif [ "$PROGRESS_EXPLICIT" = true ]; then
  die "显式 --progress 不存在：$PROGRESS"
else
  ADAPTERS="${ADAPTERS:-$DISPATCH_DIR/transports/adapters}"
  [ -d "$ADAPTERS" ] || die "适配器目录不存在：$ADAPTERS"
  ADAPTERS="$(python3 - "$ADAPTERS" <<'PY'
import os
import sys
print(os.path.realpath(sys.argv[1]))
PY
)"
  bash "$DISPATCH_DIR/validate-dispatch.sh" registry "$REGISTRY" --adapters "$ADAPTERS" >&2 \
    || die "注册表校验未通过，不能接收 Planner proposal"
fi

ENVELOPE="$(cd "$(dirname "$ENVELOPE")" && pwd)/$(basename "$ENVELOPE")"
PROPOSAL_FILE="$(cd "$(dirname "$PROPOSAL_FILE")" && pwd)/$(basename "$PROPOSAL_FILE")"
STATE_ROOT="$(mkdir -p "$STATE" && cd "$STATE" && pwd)"

if ! META="$(python3 - "$ENVELOPE" "$REGISTRY" "$AGENT" "$PROJECT_ROOT" "$DISPATCH_DIR" "$ADAPTERS" <<'PY'
import json
import os
import re
import subprocess
import sys

envelope_path, registry_path, agent_id, project_root, dispatch_dir, adapters_dir = sys.argv[1:7]
try:
    envelope = json.load(open(envelope_path, encoding="utf-8"))
except Exception as exc:
    print(f"[planner-accept] ⛔ JSON 不可读：{exc}", file=sys.stderr)
    raise SystemExit(2)

if envelope.get("role") != "planner":
    print("[planner-accept] ⛔ 信封 role 必须为 planner", file=sys.stderr)
    raise SystemExit(2)
deliverable = envelope.get("deliverable") or {}
artifact_rel = deliverable.get("artifact")
if not isinstance(artifact_rel, str) or not re.fullmatch(
    r"docs/test-reports/planner-proposal-[A-Za-z0-9][A-Za-z0-9._-]{7,127}\.json",
    artifact_rel,
):
    print("[planner-accept] ⛔ 信封的 Planner artifact 路径非法", file=sys.stderr)
    raise SystemExit(2)

command = [
    sys.executable,
    os.path.join(dispatch_dir, "tool-catalog.py"),
    "target",
    "--registry",
    registry_path,
    "--target-id",
    agent_id,
]
if adapters_dir:
    command.extend(["--adapters", adapters_dir])
try:
    resolved = subprocess.run(
        command,
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
except OSError as exc:
    print(f"[planner-accept] ⛔ 无法启动 target resolver：{exc}", file=sys.stderr)
    raise SystemExit(2)
if resolved.returncode != 0:
    print(f"[planner-accept] ⛔ 内部执行目标不可用：{(resolved.stderr or resolved.stdout).strip()[:600]}", file=sys.stderr)
    raise SystemExit(2)
try:
    descriptor = json.loads(resolved.stdout)
except (TypeError, ValueError) as exc:
    print(f"[planner-accept] ⛔ 内部执行目标 JSON 非法：{exc}", file=sys.stderr)
    raise SystemExit(2)
if not isinstance(descriptor, dict) or descriptor.get("invocation") != "subagent":
    print("[planner-accept] ⛔ 只接受已解析的 subagent Planner", file=sys.stderr)
    raise SystemExit(2)
if descriptor.get("agent_type") != "planner-proposal":
    print("[planner-accept] ⛔ subagent Planner persona 必须为 planner-proposal", file=sys.stderr)
    raise SystemExit(2)
if "planner" not in (descriptor.get("roles") or []):
    print("[planner-accept] ⛔ descriptor 没有 planner role", file=sys.stderr)
    raise SystemExit(2)
bridge_id = descriptor.get("bridge_id")
if bridge_id not in (None, "host-native"):
    print(
        "[planner-accept] ⛔ external bridge Planner 必须通过 dispatch-planner-proposal.sh "
        "返回 provider-attested run-meta；不能由本地 proposal 文件伪造",
        file=sys.stderr,
    )
    raise SystemExit(2)

task_id = envelope.get("task_id")
batch = envelope.get("batch")
ref = (envelope.get("repo") or {}).get("ref")
if not all(isinstance(value, str) and value for value in (task_id, batch, ref)):
    print("[planner-accept] ⛔ 信封缺 task_id/batch/ref", file=sys.stderr)
    raise SystemExit(2)

print(json.dumps({
    "artifact_abs": os.path.join(project_root, artifact_rel),
    "batch": batch,
    "deliverable": deliverable,
    "model_family": descriptor.get("model_family"),
    "ref": ref,
    "task_id": task_id,
}, ensure_ascii=False))
PY
)"; then
  die "无法解析 subagent Planner proposal 元数据"
fi

TASK_ID="$(printf '%s' "$META" | python3 -c 'import json,sys; print(json.load(sys.stdin)["task_id"])')"
BATCH="$(printf '%s' "$META" | python3 -c 'import json,sys; print(json.load(sys.stdin)["batch"])')"
REF="$(printf '%s' "$META" | python3 -c 'import json,sys; print(json.load(sys.stdin)["ref"])')"
ARTIFACT_ABS="$(printf '%s' "$META" | python3 -c 'import json,sys; print(json.load(sys.stdin)["artifact_abs"])')"
RUN_META="$STATE_ROOT/run-meta-$TASK_ID.json"

[ ! -e "$ARTIFACT_ABS" ] || die "task_id 已有 proposal audit artifact：$TASK_ID；不得覆盖"
[ ! -e "$RUN_META" ] || die "task_id 已有 run-meta：$TASK_ID；不得覆盖"

bash "$DISPATCH_DIR/validate-dispatch.sh" envelope "$ENVELOPE" >&2 \
  || die "prepared Planner envelope 未通过复验"
bash "$DISPATCH_DIR/validate-planner-proposal.sh" \
  "$PROPOSAL_FILE" "$TASK_ID" "$BATCH" "$REF" >&2 \
  || die "subagent 返回的 proposal 未通过 schema 校验"

mkdir -p "$(dirname "$ARTIFACT_ABS")"
python3 - "$PROPOSAL_FILE" "$ARTIFACT_ABS" <<'PY'
import shutil
import sys

source, destination = sys.argv[1:3]
try:
    with open(source, "rb") as inp, open(destination, "xb") as out:
        shutil.copyfileobj(inp, out)
except FileExistsError:
    raise SystemExit("[planner-accept] ⛔ proposal audit artifact 已存在，拒绝覆盖")
PY

python3 - "$RUN_META" "$META" "$AGENT" "$ARTIFACT_ABS" "$ENVELOPE" <<'PY'
import json
import sys

path, meta_json, agent_id, artifact, envelope_path = sys.argv[1:6]
meta = json.loads(meta_json)
run_meta = {
    "task_id": meta["task_id"],
    "agent_id": agent_id,
    "model_family": meta.get("model_family"),
    "batch": meta["batch"],
    "ref": meta["ref"],
    "role": "planner",
    "deliverable": meta["deliverable"],
    "artifact": artifact,
    "envelope_path": envelope_path,
    "outcome": "RETURNED",
    "exit_code": 0,
    "duration_s": 0,
    "transport": "subagent",
}
try:
    with open(path, "x", encoding="utf-8") as stream:
        json.dump(run_meta, stream, ensure_ascii=False, separators=(",", ":"))
except FileExistsError:
    raise SystemExit("[planner-accept] ⛔ run-meta 已存在，拒绝覆盖")
PY

set +e
RECEIPT_JSON="$(bash "$DISPATCH_DIR/validate-dispatch.sh" receipt "$RUN_META")"
RECEIPT_RC=$?
set -e

if [ "$RECEIPT_RC" -ne 0 ] && [ "$RECEIPT_RC" -ne 3 ]; then
  [ -n "$RECEIPT_JSON" ] && printf '%s\n' "$RECEIPT_JSON"
  exit "$RECEIPT_RC"
fi

python3 - "$RECEIPT_JSON" "$ARTIFACT_ABS" "$RUN_META" <<'PY'
import json
import sys

receipt, proposal_path, run_meta_path = sys.argv[1:4]
print(json.dumps({
    "receipt": json.loads(receipt),
    "proposal_path": proposal_path,
    "run_meta_path": run_meta_path,
    "transport": "subagent",
}, ensure_ascii=False))
PY
exit "$RECEIPT_RC"
