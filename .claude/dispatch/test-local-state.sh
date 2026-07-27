#!/usr/bin/env bash
# End-to-end fixture: local-cli run-meta is durable under --state while logs
# stay in the disposable --workroot and stdout remains one JSON document.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

REPO="$TMP/project"
WORKROOT="$TMP/disposable-workroot"
STATE="$REPO/.harness-dispatch"
ADAPTERS="$TMP/adapters"
SAFE_HOME="$TMP/sandbox-home"
TASK="local-state-fixture"
mkdir -p "$REPO" "$ADAPTERS" "$SAFE_HOME"

git -C "$REPO" init -q
git -C "$REPO" config user.email fixture@example.invalid
git -C "$REPO" config user.name fixture
printf 'fixture\n' > "$REPO/README.md"
git -C "$REPO" add README.md
git -C "$REPO" commit -qm fixture
REF="$(git -C "$REPO" rev-parse HEAD)"

FAKE="$TMP/fake-cli.sh"
cat > "$FAKE" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$(dirname "$HARNESS_ARTIFACT")"
printf '{"created_at":"2026-07-27T00:00:00Z","waiting":null}\n' > "$HARNESS_ARTIFACT"
echo "fixture child output stays in the local log"
SH
chmod +x "$FAKE"

cat > "$ADAPTERS/fixture.json" <<JSON
{
  "name": "fixture",
  "model_family": "fixture",
  "argv": ["bash", "$FAKE"],
  "envelope_delivery": "stdin",
  "artifact_relpath": "artifact.json"
}
JSON

cat > "$REPO/.agents-registry.json" <<JSON
{
  "version": "dispatch/1",
  "agents": [{
    "id": "fixture-evaluator",
    "roles": ["evaluator"],
    "transport": "local-cli",
    "adapter": "fixture",
    "model_family": "fixture",
    "constraints": {"l2": false, "write_src": false, "push": false},
    "sandbox": {"home_dir": "$SAFE_HOME", "env_allow": []},
    "timeout_s": 60
  }]
}
JSON

cat > "$REPO/envelope.json" <<JSON
{
  "task_id": "$TASK",
  "contract_version": "harness/1.1",
  "batch": "BL-FIXTURE",
  "role": "evaluator",
  "repo": {"url": "$REPO", "ref": "$REF"},
  "l2_authorized": false,
  "contract": "Fixture evaluator contract long enough for the dispatch envelope validator.",
  "deliverable": {"artifact": "artifact.json", "schema": "fixture.schema.json", "commit_to": null}
}
JSON

cd "$REPO"
STDOUT="$(bash "$HERE/dispatch-run.sh" \
  --agent fixture-evaluator \
  --envelope envelope.json \
  --registry .agents-registry.json \
  --adapters "$ADAPTERS" \
  --workroot "$WORKROOT" \
  --state "$STATE")"

META="$STATE/run-meta-${TASK}.json"
[ -f "$META" ] || { echo "not ok - durable run-meta missing: $META" >&2; exit 1; }

python3 - "$STDOUT" "$META" "$WORKROOT" "$STATE" <<'PY'
import glob
import json
import os
import sys

stdout, meta_path, workroot, state = sys.argv[1:5]
printed = json.loads(stdout)
stored = json.load(open(meta_path))
assert printed == stored, "stdout and durable run-meta differ"
assert stored["outcome"] == "RETURNED"
assert os.path.commonpath([stored["log"], workroot]) == os.path.abspath(workroot)
assert os.path.isfile(stored["log"]), "local log missing from workroot"
assert not glob.glob(os.path.join(state, "*.log")), "log leaked into durable state"
print("ok 1 - local-cli stdout remains one run-meta JSON document")
print("ok 2 - local-cli run-meta is durable in project state")
print("ok 3 - local-cli log remains only in disposable workroot")
print("1..3")
PY
