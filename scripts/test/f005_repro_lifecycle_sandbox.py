"""F005 evaluator repro (read-only): reuse test-lifecycle.py's exact fixture to
check the assertions the failing test never reached (lines 321-322):
were the workroot/state runtime dirs created before rejection?
Does the stale kimi subagent target reach the old Seatbelt path?
"""
import importlib.util, json, pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
DISPATCH = ROOT / ".claude" / "dispatch"
spec = importlib.util.spec_from_file_location("lifecycle_mod", DISPATCH / "test-lifecycle.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

tc = mod.DeadlineAndPreflightTests("test_sandbox_rejects_external_same_session_target_before_creating_runtime")
tc.setUp()
try:
    registry = tc.root / "unavailable-bridge-registry.json"
    registry.write_text(json.dumps({
        "version": "tool-integrations/1",
        "integrations": [{
            "id": "kimi", "tool": "kimi", "model_family": "kimi",
            "local_cli": {"adapter": "kimi",
                          "sandbox": {"home_dir": str(tc.root / "safe-kimi-home")},
                          "timeout_s": 60},
            "subagent": {"bridge": "kimi-acp-native-agent"},
        }],
        "a2a_targets": [],
    }), encoding="utf-8")
    envelope = tc.root / "bridge-envelope.json"
    envelope.write_text(json.dumps(tc.envelope(tc.repo, 60)), encoding="utf-8")
    workroot = tc.root / "unavailable-bridge-work"
    state = tc.root / "unavailable-bridge-state"
    r = subprocess.run(
        ["bash", str(DISPATCH / "sandbox-profile.sh"),
         "--agent", "subagent--kimi--evaluator", "--envelope", str(envelope),
         "--registry", str(registry), "--workroot", str(workroot), "--state", str(state)],
        cwd=tc.repo, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    print(json.dumps({
        "exit_code": r.returncode,
        "rejected_fail_closed": r.returncode == 2,
        "stderr_last_line": (r.stderr.strip().splitlines() or [""])[-1],
        "asserted_substring_present": "target id is not registered" in r.stderr,
        "workroot_created": workroot.exists(),
        "state_created": state.exists(),
        "reached_seatbelt": "sandbox-exec" in r.stderr.lower(),
    }, ensure_ascii=False, indent=2))
finally:
    tc.tearDown()
