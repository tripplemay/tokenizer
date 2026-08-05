#!/usr/bin/env bash
# Dispatch the Generator selected by progress.role_assignments.generator for a
# manual /build invocation. This wrapper only creates a fixed envelope and
# validates the returned handoff. It never applies a diff, writes project
# state, or commits; those operations remain the Coordinator's post-return
# duties after scope review, spec-lock review, and local L1 verification.
#
# Usage:
#   dispatch-generator-handoff.sh --task-id <safe-id> [--feature <F001> ...]
#     [--progress progress.json] [--features features.json]
#     [--registry .agents-registry.json] [--state .harness-dispatch]
#     [--workroot ../.harness-dispatch] [--adapters <dir>] [--deadline-s <n>]

set -euo pipefail

DISPATCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE_ADAPTERS="$DISPATCH_DIR/resolve-mode-adapters.sh"
PROGRESS="progress.json"
PROGRESS_EXPLICIT=false
FEATURES="features.json"
REGISTRY=".agents-registry.json"
STATE=".harness-dispatch"
WORKROOT="../.harness-dispatch"
ADAPTERS=""
PUB=""
DEADLINE=""
TASK_ID=""
REQUESTED_FEATURES=()
CONTEXT=""

usage() {
  cat >&2 <<'EOF'
usage:
  dispatch-generator-handoff.sh --task-id <safe-id> [--feature <F001> ...]
    [--progress progress.json] [--features features.json]
    [--registry .agents-registry.json] [--state .harness-dispatch]
    [--workroot ../.harness-dispatch] [--adapters <dir>] [--pub console.pub] [--deadline-s <n>]
EOF
}

die() { echo "[generator-dispatch] $1" >&2; exit 2; }
route_stop() { echo "[generator-dispatch] $1" >&2; exit 3; }
cleanup() { [ -z "$CONTEXT" ] || rm -f "$CONTEXT"; }
trap cleanup EXIT

while [ "$#" -gt 0 ]; do
  case "$1" in
    --task-id) [ "$#" -ge 2 ] || die "missing --task-id value"; TASK_ID="$2"; shift 2 ;;
    --feature) [ "$#" -ge 2 ] || die "missing --feature value"; REQUESTED_FEATURES+=("$2"); shift 2 ;;
    --progress) [ "$#" -ge 2 ] || die "missing --progress value"; PROGRESS="$2"; PROGRESS_EXPLICIT=true; shift 2 ;;
    --features) [ "$#" -ge 2 ] || die "missing --features value"; FEATURES="$2"; shift 2 ;;
    --registry) [ "$#" -ge 2 ] || die "missing --registry value"; REGISTRY="$2"; shift 2 ;;
    --state) [ "$#" -ge 2 ] || die "missing --state value"; STATE="$2"; shift 2 ;;
    --workroot) [ "$#" -ge 2 ] || die "missing --workroot value"; WORKROOT="$2"; shift 2 ;;
    --adapters) [ "$#" -ge 2 ] || die "missing --adapters value"; ADAPTERS="$2"; shift 2 ;;
    --pub) [ "$#" -ge 2 ] || die "missing --pub value"; PUB="$2"; shift 2 ;;
    --deadline-s) [ "$#" -ge 2 ] || die "missing --deadline-s value"; DEADLINE="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[generator-dispatch] unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

[ -n "$TASK_ID" ] || die "missing --task-id"
[[ "$TASK_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ ]] || \
  die "task_id must match ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$"
if [ -n "$DEADLINE" ] && ! [[ "$DEADLINE" =~ ^[0-9]+$ ]]; then
  die "--deadline-s must be an integer"
fi

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || \
  die "must be invoked inside a git repository"
cd "$PROJECT_ROOT"
# Legacy /build deliberately permits an absent registry when no external
# Generator is assigned. Once a registry exists, however, it is dispatch
# authority and must be the project's own regular file before any resolver or
# catalog reads it. Include dangling symlinks so they fail closed too.
REGISTRY_AVAILABLE=false
if [ -e "$REGISTRY" ] || [ -L "$REGISTRY" ]; then
  REGISTRY="$(python3 "$DISPATCH_DIR/dispatch_common.py" project-registry \
    --project-root "$PROJECT_ROOT" --registry "$REGISTRY")" \
    || die "registry must be the project-root non-symlink .agents-registry.json"
  REGISTRY_AVAILABLE=true
fi
CANONICAL_PROGRESS="$PROJECT_ROOT/progress.json"
if [ -f "$CANONICAL_PROGRESS" ]; then
  if [ "$PROGRESS_EXPLICIT" = true ]; then
    PROVIDED_PROGRESS="$(python3 - "$PROGRESS" <<'PY'
import os
import sys
print(os.path.realpath(sys.argv[1]))
PY
)"
    [ "$PROVIDED_PROGRESS" = "$CANONICAL_PROGRESS" ] || die "--progress 必须是项目根 canonical progress.json"
  fi
  PROGRESS="$CANONICAL_PROGRESS"
else
  die "progress file does not exist: $CANONICAL_PROGRESS"
fi
[ -x "$MODE_ADAPTERS" ] || die "resolve-mode-adapters.sh is missing or not executable"
MODE_ADAPTER_ARGS=(--progress "$PROGRESS" --default "$DISPATCH_DIR/transports/adapters")
[ -z "$ADAPTERS" ] || MODE_ADAPTER_ARGS+=(--adapters "$ADAPTERS")
ADAPTERS="$(bash "$MODE_ADAPTERS" "${MODE_ADAPTER_ARGS[@]}")" \
  || die "cannot restore the active mode adapter directory"
[ -f "$FEATURES" ] || die "features file does not exist: $FEATURES"
[ -f "$DISPATCH_DIR/dispatch-run.sh" ] || die "dispatch-run.sh is missing"
[ -f "$DISPATCH_DIR/validate-dispatch.sh" ] || die "validate-dispatch.sh is missing"
[ -f "$DISPATCH_DIR/validate-generator-handoff.sh" ] || \
  die "validate-generator-handoff.sh is missing"
[ -f "$DISPATCH_DIR/validate-external-bridge-receipt.py" ] || \
  die "validate-external-bridge-receipt.py is missing"

# A v2 non-fast batch has a signed role checkpoint. Resolve it before touching
# progress.role_assignments: the latter is audit state, not an authorization
# source. Legacy projects without a registry retain the historical local path.
ACTIVE_AGENT=""
ACTIVE_MODE_PRESENT="$(python3 - "$PROGRESS" <<'PY'
import json
import sys
try:
    progress = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception as exc:
    raise SystemExit(f"[generator-dispatch] cannot read progress: {exc}")
mode = progress.get("mode_intent") if isinstance(progress, dict) else None
print("yes" if isinstance(mode, dict) and ("signed_intent" in mode or "resolution" in mode) else "no")
PY
)" || die "cannot inspect mode checkpoint"
if [ "$REGISTRY_AVAILABLE" = true ]; then
  ACTIVE_ARGS=(--role generator --progress "$PROGRESS" --registry "$REGISTRY")
  ACTIVE_ARGS+=(--adapters "$ADAPTERS")
  [ -z "$PUB" ] || ACTIVE_ARGS+=(--pub "$PUB")
  ACTIVE_ROLE="$(bash "$DISPATCH_DIR/resolve-active-mode-role.sh" "${ACTIVE_ARGS[@]}")" \
    || die "active Generator mode role 复验失败"
  ACTIVE_AGENT="$(python3 - "$ACTIVE_ROLE" <<'PY'
import json
import sys
value = json.loads(sys.argv[1])
print(value.get("agent_id") if isinstance(value, dict) and value else "")
PY
)" || die "cannot parse active Generator mode role"
elif [ "$ACTIVE_MODE_PRESENT" = yes ]; then
  die "v2 active mode checkpoint requires a registry for Generator role revalidation"
fi

# Fast/default builds intentionally do not require a registry at all. Once a
# concrete runtime Generator is assigned, however, validate the full registry
# before reading its descriptor; manual /build must not bypass /plan's normal
# registry gate.
ASSIGNMENT_ROUTE="$(python3 - "$PROGRESS" "$ACTIVE_AGENT" <<'PY'
import json
import sys

try:
    progress = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception as exc:
    raise SystemExit(f"[generator-dispatch] cannot read progress: {exc}")
active_agent = sys.argv[2]

assignments = progress.get("role_assignments") if isinstance(progress, dict) else None
if active_agent:
    print("assigned")
elif assignments is None:
    print("default")
elif not isinstance(assignments, dict):
    print("invalid")
elif assignments.get("generator") is None:
    print("default")
elif isinstance(assignments.get("generator"), str) and assignments["generator"]:
    print("assigned")
else:
    print("invalid")
PY
)" || die "cannot determine Generator assignment"

case "$ASSIGNMENT_ROUTE" in
  default)
    route_stop "no Generator assignment: keep the historical local /build path"
    ;;
  invalid)
    die "progress.role_assignments.generator must be a non-empty string or null"
    ;;
  assigned)
    [ "$REGISTRY_AVAILABLE" = true ] || die "registry does not exist: $REGISTRY"
    bash "$DISPATCH_DIR/validate-dispatch.sh" registry "$REGISTRY" \
      --progress "$PROGRESS" --adapters "$ADAPTERS" >&2 || \
      die "registry preflight failed; fail closed without local fallback"
    ;;
  *)
    die "internal assignment route resolution failed"
    ;;
esac

# Resolve only the runtime assignment already materialized by /plan. The
# Console's signed tool binding is intentionally not reinterpreted here.
CONTEXT="$(mktemp)"
if ! python3 - "$PROGRESS" "$FEATURES" "$REGISTRY" "$PROJECT_ROOT" "$CONTEXT" "$ACTIVE_AGENT" "$DISPATCH_DIR" "$ADAPTERS" \
  ${REQUESTED_FEATURES[@]+"${REQUESTED_FEATURES[@]}"} <<'PY'
import json
import os
import subprocess
import sys

(
    progress_path,
    features_path,
    registry_path,
    project_root,
    output_path,
    verified_agent,
    dispatch_dir,
    adapters_dir,
    *requested,
) = sys.argv[1:]

def fail(message):
    print(f"[generator-dispatch] {message}", file=sys.stderr)
    raise SystemExit(2)

try:
    progress = json.load(open(progress_path, encoding="utf-8"))
    feature_doc = json.load(open(features_path, encoding="utf-8"))
except Exception as exc:
    fail(f"cannot read build state: {exc}")

if not isinstance(progress, dict) or progress.get("status") not in ("building", "fixing"):
    fail("progress.status must be building or fixing before external Generator dispatch")

assignments = progress.get("role_assignments")
if verified_agent:
    agent_id = verified_agent
else:
    if not isinstance(assignments, dict):
        fail("progress.role_assignments 必须是 object")
    agent_id = assignments.get("generator")
    if not isinstance(agent_id, str) or not agent_id:
        fail("progress.role_assignments.generator 必须是非空 string")
try:
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
    resolved = subprocess.run(
        command,
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
except OSError as exc:
    fail(f"cannot start tool target resolver: {exc}")
if resolved.returncode != 0:
    fail(f"assigned Generator {agent_id!r} is no longer an eligible target: {(resolved.stderr or resolved.stdout).strip()[:600]}")
try:
    descriptor = json.loads(resolved.stdout)
except (TypeError, ValueError) as exc:
    fail(f"target resolver returned invalid JSON: {exc}")
if not isinstance(descriptor, dict) or "generator" not in (descriptor.get("roles") or []):
    fail(f"assigned Generator {agent_id!r} does not permit the generator role")

transport = descriptor.get("invocation")
route = None
agent_type = None
if transport == "subagent":
    agent_type = descriptor.get("agent_type")
    if not isinstance(agent_type, str) or not agent_type:
        fail(f"subagent Generator {agent_id!r} is missing descriptor.agent_type")
    bridge_id = descriptor.get("bridge_id")
    if bridge_id is None or bridge_id == "host-native":
        route = "host-native-subagent"
    elif (
        isinstance(bridge_id, str)
        and isinstance(descriptor.get("bridge_strategy"), str)
        and isinstance(descriptor.get("bridge_protocol"), dict)
        and descriptor.get("session_scope") == "same-session"
    ):
        route = "external-bridge-subagent"
    else:
        fail(f"subagent Generator {agent_id!r} has invalid bridge metadata")
elif transport == "a2a":
    route = "a2a"
elif transport != "local-cli":
    fail(f"assigned Generator {agent_id!r} has unsupported transport {transport!r}")
elif not isinstance(descriptor.get("adapter"), str) or not isinstance(descriptor.get("sandbox"), dict):
    fail(f"local-cli Generator {agent_id!r} lacks its verified adapter or sandbox")
else:
    route = "local-cli"

batch = progress.get("current_sprint")
if not isinstance(batch, str) or not batch.strip():
    fail("progress.current_sprint must be a non-empty string")

docs = progress.get("docs") or {}
spec = docs.get("spec") if isinstance(docs, dict) else None
if spec is not None:
    if not isinstance(spec, str) or not spec.strip():
        fail("progress.docs.spec must be null or a non-empty repository-relative path")
    if os.path.isabs(spec) or "\\" in spec:
        fail("progress.docs.spec must be a safe repository-relative path")
    parts = spec.split("/")
    if any(part in ("", ".", "..") for part in parts):
        fail("progress.docs.spec must not contain empty, '.' or '..' components")
    if not os.path.isfile(os.path.join(project_root, spec)):
        fail(f"progress.docs.spec does not exist: {spec}")

if not isinstance(feature_doc, dict):
    fail("features.json must be an object")
feature_sprint = feature_doc.get("sprint")
if feature_sprint is not None and feature_sprint != batch:
    fail("features.sprint does not match progress.current_sprint")
all_features = feature_doc.get("features")
if not isinstance(all_features, list):
    fail("features.features must be an array")

pending = {}
for feature in all_features:
    if not isinstance(feature, dict):
        fail("features.features contains a non-object entry")
    feature_id = feature.get("id")
    if not isinstance(feature_id, str) or not feature_id.strip():
        fail("every feature must have a non-empty id")
    if feature_id in pending:
        fail(f"feature id is duplicated: {feature_id!r}")
    if feature.get("status") == "pending" and feature.get("executor", "generator") == "generator":
        pending[feature_id] = feature

if len(requested) > 1:
    fail("external Generator handoff accepts exactly one --feature for per-feature commit attribution")
if len(set(requested)) != len(requested):
    fail("--feature may not repeat an id")
if requested:
    unknown = [feature_id for feature_id in requested if feature_id not in pending]
    if unknown:
        fail("requested feature is not a pending generator feature: " + repr(unknown))
    selected_ids = requested
else:
    # One external handoff maps to one feature commit. features.json order is
    # the Coordinator's deterministic queue order; callers can override it
    # explicitly with --feature when a dependency permits that choice.
    selected_ids = [next(iter(pending))] if pending else []
if not selected_ids:
    fail("there are no pending generator features to dispatch")

context = {
    "route": route,
    "agent_id": agent_id,
    "batch": batch,
    "spec": spec,
    "feature_ids": selected_ids,
}
if agent_type is not None:
    context["agent_type"] = agent_type
if route == "external-bridge-subagent":
    # Keep the full catalog target for receipt verification. Its provenance is
    # independently compared with the signed active role after the Provider
    # returns; it is not a new selection input.
    context["active_target"] = descriptor
json.dump(context, open(output_path, "w", encoding="utf-8"), ensure_ascii=True, sort_keys=True)
PY
then
  exit 2
fi

ROUTE="$(python3 - "$CONTEXT" <<'PY'
import json
import sys
print(json.load(open(sys.argv[1], encoding="utf-8")).get("route") or "")
PY
)"
case "$ROUTE" in
  host-native-subagent)
    AGENT_TYPE="$(python3 - "$CONTEXT" <<'PY'
import json
import sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["agent_type"])
PY
)"
    route_stop "assigned Generator uses host-native subagent; launch descriptor.agent_type=$AGENT_TYPE, never implement in the Coordinator"
    ;;
  external-bridge-subagent)
    ;;
  a2a)
    die "assigned Generator uses transport=a2a; manual /build A2A Generator dispatch is not implemented, fail closed without local fallback"
    ;;
  local-cli)
    ;;
  *)
    die "internal route resolution failed"
    ;;
esac

AGENT="$(python3 - "$CONTEXT" <<'PY'
import json
import sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["agent_id"])
PY
)"
ACTIVE_TARGET_JSON="$(python3 - "$CONTEXT" <<'PY'
import json
import sys

context = json.load(open(sys.argv[1], encoding="utf-8"))
target = context.get("active_target", {})
print(json.dumps(target, ensure_ascii=True, sort_keys=True, separators=(",", ":")))
PY
)" || die "cannot recover the active Generator target"
BATCH="$(python3 - "$CONTEXT" <<'PY'
import json
import sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["batch"])
PY
)"
REF="$(git rev-parse --verify HEAD^{commit} 2>/dev/null)" || die "cannot resolve current HEAD as a commit"

mkdir -p "$STATE"
STATE_ROOT="$(cd "$STATE" && pwd)"
ENVELOPE="$STATE_ROOT/envelope-$TASK_ID.json"
RUN_META="$STATE_ROOT/run-meta-$TASK_ID.json"
ARTIFACT_REL="docs/test-reports/generator-handoff-$TASK_ID.json"

[ ! -e "$ENVELOPE" ] || die "task_id already has an envelope: $TASK_ID; use a fresh task_id to retry"
[ ! -e "$RUN_META" ] || die "task_id already has run metadata: $TASK_ID; use a fresh task_id to retry"

python3 - "$ENVELOPE" "$CONTEXT" "$TASK_ID" "$REF" "$ARTIFACT_REL" "$DEADLINE" <<'PY'
import json
import sys

path, context_path, task_id, ref, artifact, deadline = sys.argv[1:7]
context = json.load(open(context_path, encoding="utf-8"))
contract = (
    "You are the selected Generator executor, not the Coordinator or Evaluator. "
    "Work only on the feature ids in envelope.features against the immutable "
    "repository snapshot. Read the spec path when supplied. Do not modify "
    "progress, features, specs, mode configuration, git configuration, or the "
    "main repository. Do not commit, push, deploy, access production, or use "
    "paid external services. If L2 authorization or an adjudication is needed, "
    "stop and write the handoff with waiting='auth' or waiting='adjudication'. "
    "Before returning, write only the generator handoff JSON at "
    "deliverable.artifact. The Coordinator alone validates, returns, and commits "
    "any accepted source diff."
)
envelope = {
    "task_id": task_id,
    "contract_version": "harness/1.1",
    "batch": context["batch"],
    "role": "generator",
    "repo": {"url": ".", "ref": ref},
    "spec": context["spec"],
    "features": context["feature_ids"],
    "l2_authorized": False,
    "contract": contract,
    "deliverable": {
        "artifact": artifact,
        "schema": ".claude/dispatch/generator-handoff.schema.json",
        "commit_to": None,
    },
}
if deadline:
    envelope["deadline_s"] = int(deadline)
json.dump(envelope, open(path, "w", encoding="utf-8"), ensure_ascii=True, separators=(",", ":"))
PY

bash "$DISPATCH_DIR/validate-dispatch.sh" envelope "$ENVELOPE" >&2 || \
  die "fixed Generator envelope failed validation"

DISPATCH_ARGS=(
  --agent "$AGENT" --envelope "$ENVELOPE" --registry "$REGISTRY"
  --workroot "$WORKROOT" --state "$STATE_ROOT"
)
DISPATCH_ARGS+=(--adapters "$ADAPTERS")
[ -z "$PUB" ] || DISPATCH_ARGS+=(--pub "$PUB")
DISPATCH_ARGS+=(--progress "$PROGRESS")

set +e
RUN_OUTPUT="$(bash "$DISPATCH_DIR/dispatch-run.sh" "${DISPATCH_ARGS[@]}")"
RUN_RC=$?
set -e

if [ ! -f "$RUN_META" ]; then
  [ -z "$RUN_OUTPUT" ] || printf '%s\n' "$RUN_OUTPUT"
  exit "$RUN_RC"
fi

set +e
RECEIPT_JSON="$(bash "$DISPATCH_DIR/validate-dispatch.sh" receipt "$RUN_META" \
  --expected-envelope "$ENVELOPE" --active-role-json "$ACTIVE_ROLE" \
  --active-target-json "$ACTIVE_TARGET_JSON" --project-root "$PROJECT_ROOT")"
RECEIPT_RC=$?
set -e

if [ "$RECEIPT_RC" -ne 0 ] && [ "$RECEIPT_RC" -ne 3 ]; then
  [ -z "$RECEIPT_JSON" ] || printf '%s\n' "$RECEIPT_JSON"
  exit "$RECEIPT_RC"
fi

HANDOFF_PATH="$(python3 - "$RUN_META" "$ENVELOPE" <<'PY'
import json
import os
import sys

meta_path, envelope_path = sys.argv[1:3]
try:
    meta = json.load(open(meta_path, encoding="utf-8"))
    envelope = json.load(open(envelope_path, encoding="utf-8"))
    worktree = meta["worktree"]
    artifact = meta["artifact"]
    expected_rel = envelope["deliverable"]["artifact"]
except (KeyError, OSError, TypeError, ValueError) as exc:
    raise SystemExit(f"[generator-dispatch] invalid run metadata: {exc}")

if not isinstance(worktree, str) or not isinstance(artifact, str) or not isinstance(expected_rel, str):
    raise SystemExit("[generator-dispatch] run metadata artifact fields are invalid")
worktree_abs = os.path.abspath(worktree)
artifact_abs = os.path.abspath(artifact)
expected_abs = os.path.abspath(os.path.join(worktree_abs, expected_rel))
if artifact_abs != expected_abs:
    raise SystemExit("[generator-dispatch] run metadata artifact differs from the fixed envelope path")
if os.path.commonpath([os.path.realpath(artifact_abs), os.path.realpath(worktree_abs)]) != os.path.realpath(worktree_abs):
    raise SystemExit("[generator-dispatch] handoff artifact resolves outside the sandbox worktree")
print(artifact_abs)
PY
)" || die "cannot locate a sandbox-contained handoff artifact"

bash "$DISPATCH_DIR/validate-generator-handoff.sh" "$HANDOFF_PATH" --envelope "$ENVELOPE" >&2 || {
  printf '%s\n' '{"state":"ARTIFACT_INVALID","reason":"generator handoff failed schema and envelope validation"}'
  exit 4
}

RETURN_TRANSPORT="$(python3 - "$RUN_META" <<'PY'
import json
import sys

try:
    value = json.load(open(sys.argv[1], encoding="utf-8")).get("transport")
except (OSError, ValueError):
    value = None
print(value if isinstance(value, str) else "")
PY
)" || die "cannot read Generator return transport"
case "$ROUTE:$RETURN_TRANSPORT" in
  local-cli:local-cli)
    ;;
  external-bridge-subagent:subagent)
    if ! python3 "$DISPATCH_DIR/validate-external-bridge-receipt.py" \
      --role generator --run-meta "$RUN_META" --handoff "$HANDOFF_PATH" \
      --envelope "$ENVELOPE" --project-root "$PROJECT_ROOT" \
      --active-role-json "$ACTIVE_ROLE" --active-target-json "$ACTIVE_TARGET_JSON" >&2; then
      printf '%s\n' '{"state":"ARTIFACT_INVALID","reason":"provider-attested external Generator receipt validation failed"}'
      exit 4
    fi
    ;;
  *)
    printf '%s\n' '{"state":"ARTIFACT_INVALID","reason":"Generator return transport differs from its commissioned route"}'
    exit 4
    ;;
esac

python3 - "$RECEIPT_JSON" "$HANDOFF_PATH" "$RUN_META" "$ENVELOPE" <<'PY'
import json
import sys

receipt, handoff_path, run_meta_path, envelope_path = sys.argv[1:5]
envelope = json.load(open(envelope_path, encoding="utf-8"))
print(json.dumps({
    "receipt": json.loads(receipt),
    "handoff_path": handoff_path,
    "run_meta_path": run_meta_path,
    "envelope_path": envelope_path,
    "source_ref": envelope["repo"]["ref"],
    "feature_ids": envelope["features"],
    "next_action": "Coordinator must complete return validation before applying or committing any diff.",
}, ensure_ascii=True))
PY
exit "$RECEIPT_RC"
