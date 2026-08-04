#!/usr/bin/env bash
# F001 reverify: Tokenizer catalog-mirror matrix (Evaluator-owned test artifact).
#
# Builds throw-away project checkouts under a temp dir (the real repository is
# never modified) and runs the *installed* agent mirror against each of them:
#   1. future-cli     — a new CLI with its own verified manifest must appear
#                       without any product-code change (no tool-name whitelist)
#   2. unverified     — `_verified: false` must hide the route
#   3. provider-drift — a project-side provider copy that differs from the
#                       installed bundle must hide every external bridge route
#
# Usage: scripts/test/bl-native-subagent-bridges/f001-mirror-matrix.sh [outdir]
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
APP="${HOME}/.tokenizer/app"
OUT="${1:-/tmp/f001-mirror-matrix}"
PROBE="${REPO}/scripts/test/bl-native-subagent-bridges/f001-installed-mirror-probe.ts"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/f001-mirror-XXXXXX")"
trap 'rm -rf "${WORK}"' EXIT
mkdir -p "${OUT}"

seed_repo() {
  local dest="$1"
  mkdir -p "${dest}"
  cp "${REPO}/.agents-registry.json" "${dest}/.agents-registry.json"
  mkdir -p "${dest}/.claude/dispatch"
  cp -R "${REPO}/.claude/dispatch/transports" "${dest}/.claude/dispatch/transports"
}

probe() {
  local name="$1" repo="$2"
  ( cd "${APP}" && node --import tsx "${PROBE}" "${APP}" "${repo}" ) > "${OUT}/${name}.json"
  python3 - "${OUT}/${name}.json" "${name}" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
routes = sorted(f"{r['tool']}/{r['role']}" for r in data["subagent_routes"])
print(f"{sys.argv[2]}: entries={data['total_entries']} subagent_routes={routes}")
PY
}

# --- case 1: future CLI joins declaratively -------------------------------
FUTURE="${WORK}/future-cli"
seed_repo "${FUTURE}"
python3 - "${FUTURE}" <<'PY'
import json, sys
from pathlib import Path

root = Path(sys.argv[1])
registry = json.loads((root / ".agents-registry.json").read_text())
registry["integrations"].append({
    "id": "futurecli",
    "tool": "futurecli",
    "label": "Future CLI",
    "model_family": "futurefam",
    "priority": 100,
    "capabilities": ["plan", "build", "fix", "verify", "l1_local"],
    "subagent": {"bridge": "future-acp-native-agent"},
    "local_cli": {
        "adapter": "futurecli",
        "sandbox": {"home_dir": "~/.harness-sandbox/futurecli", "env_set": {}, "env_allow": []},
        "timeout_s": 2400,
    },
})
(root / ".agents-registry.json").write_text(json.dumps(registry, indent=2))

transports = root / ".claude" / "dispatch" / "transports"
(transports / "adapters" / "futurecli.json").write_text(json.dumps({
    "name": "futurecli",
    "tool": "futurecli",
    "model_family": "futurefam",
    "envelope_delivery": "argv",
    "argv": ["futurecli", "-p", "{{envelope_json}}"],
    "bridge_commands": {"acp-native-agent/v1": ["futurecli", "acp"]},
    "artifact_relpath": "docs/test-reports/{{batch}}-verdict.json",
    "env_allowlist_extra": [],
    "_verified": True,
}, indent=2))
(transports / "bridges" / "future-acp-native-agent.json").write_text(json.dumps({
    "id": "future-acp-native-agent",
    "_verified": True,
    "session_scope": "same-session",
    "strategy": "session-bridge-v1",
    "protocol": {
        "kind": "acp-native-agent/v1",
        "command": ["futurecli", "acp"],
        "request_delivery": "stdin",
        "response_format": "json",
    },
    "personas": {
        "planner": "planner-proposal",
        "generator": "generator-restricted",
        "evaluator": "evaluator",
    },
    "native_agent_types": {"planner": "plan", "generator": "coder", "evaluator": "explore"},
}, indent=2))
PY
probe future-cli "${FUTURE}"

# --- case 2: unverified manifest ------------------------------------------
UNVERIFIED="${WORK}/unverified"
seed_repo "${UNVERIFIED}"
python3 - "${UNVERIFIED}" <<'PY'
import json, sys
from pathlib import Path
path = Path(sys.argv[1]) / ".claude/dispatch/transports/bridges/kimi-acp-native-agent.json"
manifest = json.loads(path.read_text())
manifest["_verified"] = False
path.write_text(json.dumps(manifest, indent=2))
PY
probe unverified-manifest "${UNVERIFIED}"

# --- case 3: project-side provider drift -----------------------------------
DRIFT="${WORK}/provider-drift"
seed_repo "${DRIFT}"
printf '\n# evaluator drift marker\n' >> "${DRIFT}/.claude/dispatch/transports/vm-bridge-provider.py"
probe provider-drift "${DRIFT}"

# --- case 4: unchanged control checkout ------------------------------------
CONTROL="${WORK}/control"
seed_repo "${CONTROL}"
probe control "${CONTROL}"

echo "evidence written to ${OUT}"
