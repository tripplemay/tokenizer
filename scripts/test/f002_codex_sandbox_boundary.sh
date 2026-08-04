#!/usr/bin/env bash
# F002 reverify probe: Codex runtime boundary checks (Evaluator-owned artifact).
# Does NOT modify product code. Verifies that:
#   1. No `subagent--codex--*` target can enter the sandbox launch path.
#   2. The Codex local-cli targets resolve with sandbox/credential/timeout pins.
#   3. No workroot/state directories are created on a rejected launch.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DISPATCH="$REPO/.claude/dispatch"
REGISTRY="$REPO/.agents-registry.json"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
pass() { echo "  PASS  $1"; }
bad()  { echo "  FAIL  $1"; fail=$((fail + 1)); }

cat > "$TMP/envelope.json" <<JSON
{
  "task_id": "f002-reverify-probe",
  "contract_version": "harness/1.1",
  "batch": "BL-NATIVE-SUBAGENT-BRIDGES",
  "role": "evaluator",
  "repo": {"url": "$REPO", "ref": "172ed42b5c4d910c7f194a6fab835c8ac74f19e7"},
  "l2_authorized": false,
  "contract": "F002 reverify probe envelope: confirm codex external bridge stays unlaunchable.",
  "deliverable": {
    "artifact": "docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-verdict.json",
    "schema": ".claude/autonomous/verdict-artifact.schema.json",
    "commit_to": null
  }
}
JSON

echo "== [0] the probe envelope itself is valid (so rejections are target-driven) =="
if bash "$DISPATCH/validate-dispatch.sh" envelope "$TMP/envelope.json" >/dev/null 2>&1; then
  pass "probe envelope passes dispatch validation"
else
  bad "probe envelope is invalid — downstream rejections would be inconclusive"
fi
echo

echo "== [1] sandbox refuses every codex external-bridge target =="
for role in planner generator evaluator; do
  target="subagent--codex--$role"
  work="$TMP/work-$role"
  state="$TMP/state-$role"
  err="$(bash "$DISPATCH/sandbox-profile.sh" \
      --agent "$target" \
      --envelope "$TMP/envelope.json" \
      --registry "$REGISTRY" \
      --workroot "$work" \
      --state "$state" 2>&1 >/dev/null)"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    pass "$target rejected (exit $rc)"
  else
    bad "$target was ACCEPTED (exit 0) — external bridge leak"
  fi
  echo "        reason: $(printf '%s' "$err" | tail -1)"
  [ ! -e "$work" ] && pass "$target created no workroot" || bad "$target created workroot"
  [ ! -e "$state" ] && pass "$target created no state dir" || bad "$target created state dir"
done

echo
echo "== [2] codex local-cli targets keep sandbox / credential / timeout pins =="
for role in planner generator evaluator; do
  out="$(PYTHONDONTWRITEBYTECODE=1 python3 "$DISPATCH/tool-catalog.py" target \
        --registry "$REGISTRY" --target-id "local-cli--codex--$role" 2>/dev/null)"
  if [ -z "$out" ]; then
    bad "local-cli--codex--$role did not resolve"
    continue
  fi
  printf '%s' "$out" | python3 -c '
import json, sys
t = json.load(sys.stdin)
role = t["roles"][0]
checks = [
    ("adapter=codex", t.get("adapter") == "codex"),
    ("adapter contract sha", bool(t.get("adapter_execution_contract_sha256"))),
    ("execution provenance sha", bool(t.get("execution_provenance_sha256"))),
    ("timeout_s=2400", t.get("timeout_s") == 2400),
    ("sandbox home_dir pinned", t.get("sandbox", {}).get("home_dir") == "~/.harness-sandbox/codex"),
    ("CODEX_HOME pinned", t.get("sandbox", {}).get("env_set", {}).get("CODEX_HOME") == "~/.codex"),
    ("env_allow empty", t.get("sandbox", {}).get("env_allow") == []),
    ("no bridge provenance", not any(k.startswith("bridge_") or k in ("session_scope","agent_type","native_agent_type") for k in t)),
]
rc = 0
for name, ok in checks:
    print(("  PASS  [%s] %s" if ok else "  FAIL  [%s] %s") % (role, name))
    if not ok:
        rc = 1
sys.exit(rc)
' || fail=$((fail + 1))
done

echo
if [ "$fail" -eq 0 ]; then
  echo "RESULT: PASS (all codex boundary checks green)"
  exit 0
fi
echo "RESULT: FAIL ($fail checks failed)"
exit 1
