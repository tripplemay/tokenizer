#!/usr/bin/env bash
# Accept one validated Generator handoff into the Coordinator's main checkout.
# The external runner only returns an uncommitted sandbox diff; this command
# makes the return path auditable and deliberately requires --apply before it
# can modify the main checkout. A subagent return is eligible only when the
# framework VM provider has attested the exact copied-out artifact.
#
# The Coordinator must run the spec-lock critic before invoking this command.
# This command then verifies the exact envelope/handoff/run-meta tuple, checks
# the sandbox diff against files_touched, reruns caller-supplied L1 commands in
# the sandbox, and only then can apply+commit the one commissioned feature plus
# the exact handoff JSON as its durable audit artifact.

set -euo pipefail

DISPATCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HANDOFF=""
ENVELOPE=""
RUN_META=""
L1_COMMANDS=""
APPLY=false
PROGRESS="progress.json"
REGISTRY=".agents-registry.json"
ADAPTERS=""
PUB=""
PROGRESS_EXPLICIT=false

usage() {
  cat >&2 <<'EOF'
Usage:
  accept-generator-handoff.sh --handoff <path> --envelope <path> --run-meta <path> \
    --l1-commands <commands.json> [--apply] [--progress progress.json] \
    [--registry .agents-registry.json] [--adapters adapters-dir] [--pub console.pub]

commands.json is a strict harness-l1/1 document:
{"version":"harness-l1/1","commands":[
  {"name":"lint","argv":["npm","run","lint"]},
  {"name":"typecheck","argv":["npm","run","typecheck"]},
  {"name":"test","argv":["npm","test"]}
]}

Without --apply the command performs every return check and emits
READY_TO_APPLY without changing the main checkout. --apply applies the exact
sandbox diff, preserves the validated handoff JSON under docs/test-reports/, and
creates feat(<batch>-<feature>): accept external generator handoff.
EOF
}

die() { echo "[generator-accept] $1" >&2; exit 2; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --handoff) [ "$#" -ge 2 ] || die "missing --handoff value"; HANDOFF="$2"; shift 2 ;;
    --envelope) [ "$#" -ge 2 ] || die "missing --envelope value"; ENVELOPE="$2"; shift 2 ;;
    --run-meta) [ "$#" -ge 2 ] || die "missing --run-meta value"; RUN_META="$2"; shift 2 ;;
    --l1-commands) [ "$#" -ge 2 ] || die "missing --l1-commands value"; L1_COMMANDS="$2"; shift 2 ;;
    --progress) [ "$#" -ge 2 ] || die "missing --progress value"; PROGRESS="$2"; PROGRESS_EXPLICIT=true; shift 2 ;;
    --registry) [ "$#" -ge 2 ] || die "missing --registry value"; REGISTRY="$2"; shift 2 ;;
    --adapters) [ "$#" -ge 2 ] || die "missing --adapters value"; ADAPTERS="$2"; shift 2 ;;
    --pub) [ "$#" -ge 2 ] || die "missing --pub value"; PUB="$2"; shift 2 ;;
    --apply) APPLY=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; die "unknown argument: $1" ;;
  esac
done

[ -f "$HANDOFF" ] || die "handoff does not exist: $HANDOFF"
[ -f "$ENVELOPE" ] || die "envelope does not exist: $ENVELOPE"
[ -f "$RUN_META" ] || die "run metadata does not exist: $RUN_META"
[ -f "$L1_COMMANDS" ] || die "L1 commands document does not exist: $L1_COMMANDS"
[ -f "$DISPATCH_DIR/validate-dispatch.sh" ] || die "validate-dispatch.sh is missing"
[ -f "$DISPATCH_DIR/validate-generator-handoff.sh" ] || die "validate-generator-handoff.sh is missing"
[ -f "$DISPATCH_DIR/validate-external-bridge-receipt.py" ] || \
  die "validate-external-bridge-receipt.py is missing"
[ -f "$DISPATCH_DIR/validate-active-return-route.py" ] || \
  die "validate-active-return-route.py is missing"

COORDINATOR_ENV=(env -i "PATH=${PATH:-/usr/bin:/bin}" "LANG=${LANG:-C.UTF-8}" "LC_ALL=${LC_ALL:-C.UTF-8}" "HOME=${HOME:-/tmp}" GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0)
PROJECT_ROOT="$("${COORDINATOR_ENV[@]}" git rev-parse --show-toplevel 2>/dev/null)" || die "must be invoked inside the Coordinator main checkout"
cd "$PROJECT_ROOT"

# In a project with progress state, acceptance is bound to the canonical root
# file. An alternate/missing --progress cannot be used to evade an active v2
# checkpoint. Standalone return-validation fixtures without progress preserve
# legacy compatibility.
CANONICAL_PROGRESS="$PROJECT_ROOT/progress.json"
if [ -f "$CANONICAL_PROGRESS" ]; then
  PROVIDED_PROGRESS="$(python3 - "$PROGRESS" <<'PY'
import os
import sys
print(os.path.realpath(sys.argv[1]))
PY
)"
  [ "$PROVIDED_PROGRESS" = "$CANONICAL_PROGRESS" ] || die "--progress 必须是项目根 canonical progress.json"
  PROGRESS="$CANONICAL_PROGRESS"
elif [ "$PROGRESS_EXPLICIT" = true ]; then
  die "显式 --progress 不存在：$PROGRESS"
fi

ACTIVE_AGENT=""
ACTIVE_ROLE="{}"
if [ -f "$CANONICAL_PROGRESS" ]; then
  REGISTRY="$(python3 "$DISPATCH_DIR/dispatch_common.py" project-registry \
    --project-root "$PROJECT_ROOT" --registry "$REGISTRY")" \
    || die "active mode checkpoint requires the project-root non-symlink .agents-registry.json"
  ACTIVE_ARGS=(--role generator --progress "$PROGRESS" --registry "$REGISTRY")
  [ -z "$ADAPTERS" ] || ACTIVE_ARGS+=(--adapters "$ADAPTERS")
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
fi

bash "$DISPATCH_DIR/validate-dispatch.sh" envelope "$ENVELOPE" >&2 || \
  die "Generator envelope failed validation"
bash "$DISPATCH_DIR/validate-generator-handoff.sh" "$HANDOFF" --envelope "$ENVELOPE" >&2 || \
  die "Generator handoff failed validation"

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
ACTIVE_TARGET_JSON="{}"
ACTIVE_RETURN_ROUTE="legacy"
if [ -n "$ACTIVE_AGENT" ]; then
    TARGET_ADAPTERS="$ADAPTERS"
    if [ -z "$TARGET_ADAPTERS" ]; then
      [ -x "$DISPATCH_DIR/resolve-mode-adapters.sh" ] || \
        die "resolve-mode-adapters.sh is missing"
      TARGET_ADAPTERS="$(bash "$DISPATCH_DIR/resolve-mode-adapters.sh" \
        --progress "$PROGRESS" --default "$DISPATCH_DIR/transports/adapters")" \
        || die "cannot restore the active mode adapter directory"
    fi
    TARGET_ARGS=(python3 "$DISPATCH_DIR/tool-catalog.py" target --registry "$REGISTRY" --target-id "$ACTIVE_AGENT")
    TARGET_ARGS+=(--adapters "$TARGET_ADAPTERS")
    ACTIVE_TARGET_JSON="$("${TARGET_ARGS[@]}")" || \
      die "cannot re-resolve the active Generator target"
    ACTIVE_RETURN_ROUTE_JSON="$(python3 "$DISPATCH_DIR/validate-active-return-route.py" \
      --run-meta "$RUN_META" --active-role-json "$ACTIVE_ROLE" \
      --active-target-json "$ACTIVE_TARGET_JSON")" || \
      die "run metadata transport does not match the re-verified active Generator target"
    ACTIVE_RETURN_ROUTE="$(printf '%s' "$ACTIVE_RETURN_ROUTE_JSON" | python3 -c \
      "import json,sys; print(json.load(sys.stdin).get('route') or '')")"
fi
case "$ACTIVE_RETURN_ROUTE:$RETURN_TRANSPORT" in
  legacy:local-cli|local-cli:local-cli)
    ;;
  external-bridge-subagent:subagent)
    python3 "$DISPATCH_DIR/validate-external-bridge-receipt.py" \
      --role generator --run-meta "$RUN_META" --handoff "$HANDOFF" \
      --envelope "$ENVELOPE" --project-root "$PROJECT_ROOT" \
      --active-role-json "$ACTIVE_ROLE" --active-target-json "$ACTIVE_TARGET_JSON" >&2 || \
      die "provider-attested external Generator receipt validation failed"
    ;;
  legacy:subagent)
    die "provider-attested subagent Generator requires a re-verified active mode role"
    ;;
  *)
    die "Generator return transport differs from its re-verified active route"
    ;;
esac

python3 - "$PROJECT_ROOT" "$HANDOFF" "$ENVELOPE" "$RUN_META" "$L1_COMMANDS" "$APPLY" "$ACTIVE_AGENT" "$ACTIVE_RETURN_ROUTE" <<'PY'
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Optional


root = Path(sys.argv[1]).resolve()
handoff_path = Path(sys.argv[2]).resolve()
envelope_path = Path(sys.argv[3]).resolve()
meta_path = Path(sys.argv[4]).resolve()
l1_path = Path(sys.argv[5]).resolve()
apply = sys.argv[6] == "true"
active_agent = sys.argv[7]
active_return_route = sys.argv[8]


def fail(message: str) -> None:
    print(f"[generator-accept] {message}", file=sys.stderr)
    raise SystemExit(2)


def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            fail(f"duplicate JSON key {key!r}")
        value[key] = item
    return value


def load_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicate_keys)
    except (OSError, ValueError) as exc:
        fail(f"cannot read {label}: {exc}")
    if not isinstance(value, dict):
        fail(f"{label} must be an object")
    return value


def coordinator_environment() -> dict[str, str]:
    """Minimal environment for Coordinator-side Git operations."""
    return {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
        "LC_ALL": os.environ.get("LC_ALL", "C.UTF-8"),
        "HOME": os.environ.get("HOME", "/tmp"),
        "SHELL": "/bin/sh",
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_TERMINAL_PROMPT": "0",
    }


def run(argv: list[str], *, cwd: Path, env: Optional[dict[str, str]] = None, capture: bool = True) -> str:
    completed = subprocess.run(
        argv,
        cwd=cwd,
        env=coordinator_environment() if env is None else env,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
    )
    if completed.returncode != 0:
        detail = ""
        if capture:
            detail = (completed.stderr or completed.stdout or "").strip()
        fail(f"command failed ({' '.join(argv)}): {detail or 'exit ' + str(completed.returncode)}")
    return (completed.stdout or "") if capture else ""


def clean_main_checkout() -> None:
    status = run(
        ["git", "status", "--porcelain=v1", "--untracked-files=all"], cwd=root, capture=True
    )
    if status:
        fail("Coordinator main checkout must be clean before accepting a sandbox diff")


# Generator source diffs must never gain authority over the Harness control
# plane or a downstream CI/credential execution surface. This applies both to
# the self-declared manifest and the actual Git diff; the latter is decisive.
CONTROL_EXACT = {
    ".gitattributes",
    ".agent-id",
    ".agents-registry.json",
    ".gitlab-ci.yml",
    ".npmrc",
    ".pypirc",
    ".travis.yml",
    "Jenkinsfile",
    "autonomy-policy.json",
    "bitbucket-pipelines.yml",
    "features.json",
    "harness.json",
    "harness.lock",
    "package.json",
    "progress.json",
    "azure-pipelines.yml",
}
CONTROL_PREFIXES = (
    ".aws/",
    ".buildkite/",
    ".circleci/",
    ".claude/",
    ".git/",
    ".github/",
    ".husky/",
    ".ssh/",
    "hooks/",
)
CREDENTIAL_SUFFIXES = (".key", ".pem", ".p12", ".pfx", ".crt")


def forbidden_return_path(path: str) -> Optional[str]:
    if path in CONTROL_EXACT:
        return "Harness, package, or CI control file"
    if path.startswith(CONTROL_PREFIXES):
        return "Harness, Git, CI, hook, or credential directory"
    name = Path(path).name
    if name == ".env" or name.startswith(".env."):
        return "environment credential file"
    if name.endswith(CREDENTIAL_SUFFIXES):
        return "credential material"
    return None


def l1_environment(temp_dir: Path) -> dict[str, str]:
    """Run validation commands without Coordinator credentials or loaders."""
    home = temp_dir / "l1-home"
    tmpdir = temp_dir / "l1-tmp"
    home.mkdir(mode=0o700, exist_ok=True)
    tmpdir.mkdir(mode=0o700, exist_ok=True)
    return {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
        "LC_ALL": os.environ.get("LC_ALL", "C.UTF-8"),
        "TMPDIR": str(tmpdir),
        "USER": os.environ.get("USER", "harness"),
        "SHELL": "/bin/sh",
        "HOME": str(home),
    }


def sandbox_git_environment(temp_dir: Path) -> dict[str, str]:
    """Git inspection of an external clone must not inherit Coordinator env."""
    environment = l1_environment(temp_dir)
    environment["GIT_CONFIG_NOSYSTEM"] = "1"
    environment["GIT_TERMINAL_PROMPT"] = "0"
    return environment


envelope = load_json(envelope_path, "envelope")
handoff = load_json(handoff_path, "handoff")
meta = load_json(meta_path, "run metadata")
l1 = load_json(l1_path, "L1 commands")

if envelope.get("role") != "generator":
    fail("envelope role must be generator")
if meta.get("role") != "generator":
    fail("run metadata role must be generator")
if active_agent and meta.get("agent_id") != active_agent:
    fail("run metadata agent_id does not match the re-verified active Generator role")
transport = meta.get("transport")
if transport not in {"local-cli", "subagent"}:
    fail("only local-cli or provider-attested subagent Generator handoffs have a returnable source diff")
expected_transport = {
    "legacy": None,
    "local-cli": "local-cli",
    "external-bridge-subagent": "subagent",
    "host-native-subagent": "subagent",
    "a2a": "a2a",
}.get(active_return_route)
if active_return_route not in {"legacy", "local-cli", "external-bridge-subagent", "host-native-subagent", "a2a"}:
    fail("re-verified active Generator return route is invalid")
if expected_transport is not None and transport != expected_transport:
    fail("run metadata transport does not match the re-verified active Generator route")
if meta.get("outcome") != "RETURNED" or meta.get("exit_code") != 0:
    fail("run metadata must record a successful RETURNED outcome")

task_id = envelope.get("task_id")
batch = envelope.get("batch")
repo = envelope.get("repo")
features = envelope.get("features")
deliverable = envelope.get("deliverable")
if not isinstance(task_id, str) or not task_id:
    fail("envelope task_id is invalid")
if not isinstance(batch, str) or not batch:
    fail("envelope batch is invalid")
if (
    not isinstance(repo, dict)
    or not isinstance(repo.get("ref"), str)
    or not re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", repo["ref"])
):
    fail("envelope repo.ref must be a canonical immutable commit SHA")
ref = repo["ref"]
if not isinstance(features, list) or len(features) != 1 or not isinstance(features[0], str) or not features[0]:
    fail("acceptance requires exactly one commissioned Generator feature")
feature_id = features[0]
if not isinstance(deliverable, dict) or not isinstance(deliverable.get("artifact"), str):
    fail("envelope deliverable artifact is invalid")
artifact_rel = deliverable["artifact"]
artifact_candidate = Path(artifact_rel)
if (
    artifact_candidate.is_absolute()
    or "\\" in artifact_rel
    or any(component in ("", ".", "..") for component in artifact_candidate.parts)
):
    fail("envelope deliverable artifact must be a safe repository-relative path")
audit_path = root / artifact_rel
try:
    audit_path.parent.resolve().relative_to(root)
except ValueError:
    fail("envelope deliverable artifact parent resolves outside the Coordinator checkout")

if meta.get("task_id") != task_id or meta.get("batch") != batch or meta.get("ref") != ref:
    fail("run metadata does not match the commissioning envelope")
if Path(str(meta.get("envelope_path", ""))).resolve() != envelope_path:
    fail("run metadata envelope_path does not match the supplied envelope")
if Path(str(meta.get("artifact", ""))).resolve() != handoff_path:
    fail("run metadata artifact does not match the supplied handoff")

worktree_raw = meta.get("worktree")
if not isinstance(worktree_raw, str) or not worktree_raw:
    fail("run metadata lacks the sandbox worktree")
worktree = Path(worktree_raw).resolve()
if not worktree.is_dir():
    fail("sandbox worktree no longer exists; preserve it for return validation")
if handoff_path != (worktree / artifact_rel).resolve():
    fail("handoff path does not equal the fixed artifact path inside the sandbox worktree")
try:
    handoff_path.relative_to(worktree)
except ValueError:
    fail("handoff artifact resolves outside the sandbox worktree")
if handoff.get("batch_id") != batch:
    fail("handoff batch_id does not match the envelope")
handoff_features = handoff.get("features")
if not isinstance(handoff_features, list) or len(handoff_features) != 1:
    fail("completed handoff must contain exactly one feature")
handoff_feature = handoff_features[0]
if not isinstance(handoff_feature, dict) or handoff_feature.get("feature_id") != feature_id:
    fail("handoff feature does not match the commissioned feature")
declared_files = handoff_feature.get("files_touched")
if not isinstance(declared_files, list) or not declared_files or any(
    not isinstance(path, str) or not path for path in declared_files
):
    fail("handoff files_touched is invalid")
if len(set(declared_files)) != len(declared_files):
    fail("handoff files_touched contains duplicate paths")
for path in declared_files:
    candidate = Path(path)
    if candidate.is_absolute() or "\\" in path or any(part in ("", ".", "..") for part in candidate.parts):
        fail("handoff files_touched contains an unsafe repository-relative path")
    if path == artifact_rel:
        fail("handoff files_touched must not include its generated audit artifact")
    blocked = forbidden_return_path(path)
    if blocked:
        fail(f"handoff files_touched may not modify {blocked}: {path!r}")

if l1.get("version") != "harness-l1/1":
    fail("L1 commands version must be harness-l1/1")
commands = l1.get("commands")
if not isinstance(commands, list) or not commands:
    fail("L1 commands must be a non-empty array")
seen_commands: set[str] = set()
parsed_commands: list[tuple[str, list[str]]] = []
for index, item in enumerate(commands):
    if not isinstance(item, dict) or set(item) != {"name", "argv"}:
        fail(f"L1 commands[{index}] must contain exactly name and argv")
    name, argv = item.get("name"), item.get("argv")
    if name not in {"lint", "typecheck", "test"} or name in seen_commands:
        fail(f"L1 command name is invalid or duplicate: {name!r}")
    if not isinstance(argv, list) or not argv or any(not isinstance(arg, str) or not arg for arg in argv):
        fail(f"L1 commands[{index}].argv must be a non-empty string array")
    seen_commands.add(name)
    parsed_commands.append((name, argv))
if seen_commands != {"lint", "typecheck", "test"}:
    fail("L1 commands must define lint, typecheck, and test exactly once")

clean_main_checkout()
head = run(["git", "rev-parse", "HEAD"], cwd=root, capture=True).strip()
if head != ref:
    fail("Coordinator HEAD no longer equals envelope repo.ref; do not apply an old sandbox diff")
sandbox_head = run(["git", "rev-parse", "HEAD"], cwd=worktree, capture=True).strip()
if sandbox_head != ref:
    fail("sandbox HEAD no longer equals envelope repo.ref")


def sandbox_diff(temp_dir: Path) -> tuple[Path, list[str]]:
    # Use a temporary index so untracked source files are represented in the
    # binary patch without mutating the external runner's index.
    index_path = temp_dir / "sandbox.index"
    environment = sandbox_git_environment(temp_dir)
    environment["GIT_INDEX_FILE"] = str(index_path)
    run(["git", "read-tree", "HEAD"], cwd=worktree, env=environment)
    status = run(
        ["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"],
        cwd=worktree,
        env=environment,
        capture=True,
    )
    untracked: list[str] = []
    records = status.split("\0")
    for record in records:
        if not record:
            continue
        if len(record) < 4:
            fail("sandbox git status returned a malformed record")
        code, path = record[:2], record[3:]
        if code == "??" and path != artifact_rel:
            untracked.append(path)
    if untracked:
        run(["git", "add", "-N", "--", *untracked], cwd=worktree, env=environment)

    paths = run(
        ["git", "diff", "--name-only", "-z", "--no-renames", "--no-textconv", ref, "--", ".", f":(exclude){artifact_rel}"],
        cwd=worktree,
        env=environment,
        capture=True,
    )
    changed = sorted(path for path in paths.split("\0") if path)
    if not changed:
        fail("sandbox contains no returnable source diff")
    for path in changed:
        blocked = forbidden_return_path(path)
        if blocked:
            fail(f"sandbox diff contains forbidden {blocked}: {path!r}")
    if set(changed) != set(declared_files):
        fail(
            "sandbox diff paths must exactly match handoff files_touched; "
            f"actual={changed!r}, declared={sorted(declared_files)!r}"
        )

    patch = temp_dir / "sandbox.diff"
    with patch.open("wb") as output:
        completed = subprocess.run(
            ["git", "diff", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", ref, "--", ".", f":(exclude){artifact_rel}"],
            cwd=worktree,
            env=environment,
            stdout=output,
            stderr=subprocess.PIPE,
        )
    if completed.returncode != 0:
        fail(f"cannot build sandbox diff: {completed.stderr.decode(errors='replace').strip()}")
    if patch.stat().st_size == 0:
        fail("sandbox diff was unexpectedly empty")
    return patch, changed


with tempfile.TemporaryDirectory(prefix="harness-generator-accept-") as temp_raw:
    temp_dir = Path(temp_raw)
    patch, changed = sandbox_diff(temp_dir)

    # L1 is executed on the exact sandbox snapshot. Validate the diff once
    # more afterward because tests/formatters can mutate the worktree.
    l1_env = l1_environment(temp_dir)
    for name, argv in parsed_commands:
        run(argv, cwd=worktree, env=l1_env)
    patch, changed = sandbox_diff(temp_dir)

    if not apply:
        print(json.dumps({
            "state": "READY_TO_APPLY",
            "batch": batch,
            "feature_id": feature_id,
            "files_touched": changed,
            "worktree": str(worktree),
            "source_ref": ref,
        }, ensure_ascii=True))
        raise SystemExit(0)

    clean_main_checkout()
    if run(["git", "rev-parse", "HEAD"], cwd=root, capture=True).strip() != ref:
        fail("Coordinator HEAD changed during return validation")
    run(["git", "apply", "--check", "--index", "--whitespace=error", str(patch)], cwd=root)
    run(["git", "apply", "--index", "--whitespace=error", str(patch)], cwd=root)

    # Preserve the exact validated handoff alongside the accepted source diff.
    # It is deliberately excluded from files_touched: that list proves the
    # source patch scope, while this JSON is the immutable return evidence.
    if audit_path.exists() or audit_path.is_symlink():
        fail("main checkout already contains the Generator audit artifact path")
    audit_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        audit_path.parent.resolve().relative_to(root)
    except ValueError:
        fail("Generator audit artifact parent resolves outside the Coordinator checkout")
    shutil.copyfile(handoff_path, audit_path)
    run(["git", "add", "--", artifact_rel], cwd=root)

    staged = sorted(
        path for path in run(
            ["git", "diff", "--cached", "--name-only", "-z", "--no-renames"], cwd=root, capture=True
        ).split("\0") if path
    )
    if set(staged) != set(declared_files) | {artifact_rel}:
        fail("applied main-checkout diff or audit artifact no longer matches the accepted handoff")
    run(["git", "diff", "--cached", "--check"], cwd=root)
    run(
        ["git", "commit", "-m", f"feat({batch}-{feature_id}): accept external generator handoff"],
        cwd=root,
    )
    commit = run(["git", "rev-parse", "HEAD"], cwd=root, capture=True).strip()
    print(json.dumps({
        "state": "APPLIED",
        "batch": batch,
        "feature_id": feature_id,
        "files_touched": changed,
        "handoff_artifact": artifact_rel,
        "commit": commit,
        "worktree": str(worktree),
        "source_ref": ref,
    }, ensure_ascii=True))
PY
