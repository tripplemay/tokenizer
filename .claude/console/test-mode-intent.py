#!/usr/bin/env python3
"""Repeatable signed fixtures for validate-mode-intent.sh."""

import base64
import copy
import datetime
import json
import os
import pathlib
import subprocess
import sys
import tempfile


HERE = pathlib.Path(__file__).resolve().parent
VALIDATOR = HERE / "validate-mode-intent.sh"
SCHEMA = HERE / "mode-intent.schema.json"
REPO_KEY = "github.com/acme/mode-fixture"
HEAD_AT_STAGING = "0123456789abcdef0123456789abcdef01234567"


def canonical(intent):
    payload = {key: value for key, value in intent.items() if key != "sig"}
    return json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def iso_after(**delta):
    value = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(**delta)
    return value.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def base_autonomy(enabled=True):
    if not enabled:
        return {"enabled": False}
    return {
        "enabled": True,
        "expires_at": iso_after(hours=12),
        "auto_cross": ["B", "A"],
        "budget": {
            "max_wakes": 8,
            "max_tokens": 50000,
            "max_fix_rounds": 2,
            "max_cost_usd": 10.0,
        },
        "wake_interval_s": {"verifying": 120, "building": 60},
        "notify_on": ["done", "halt"],
    }


def base_intent(profile="fast", autonomy=True):
    assignments = None
    if profile == "heterogeneous":
        assignments = {"evaluator": "reviewer-codex", "generator": "main-claude"}
    elif profile == "slow":
        assignments = {"evaluator": "remote-reviewer", "generator": "local-builder"}
    return {
        "intent_id": "intent-fixture-001",
        "repo_key": REPO_KEY,
        "expected_head_sha": HEAD_AT_STAGING,
        "desired": {
            "autonomy": base_autonomy(autonomy),
            "execution": {"role_assignments": assignments, "profile": profile},
        },
        "issued_by": "human@example.invalid",
        "issued_at": iso_after(minutes=-1),
        "intent_expires_at": iso_after(days=1),
    }


REGISTRY = {
    "version": "dispatch/1",
    "agents": [
        {
            "id": "main-claude",
            "roles": ["planner", "generator"],
            "transport": "subagent",
            "model_family": "claude",
        },
        {
            "id": "reviewer-codex",
            "roles": ["evaluator"],
            "transport": "local-cli",
            "model_family": "codex",
        },
        {
            "id": "local-builder",
            "roles": ["generator"],
            "transport": "local-cli",
            "model_family": "codex",
        },
        {
            "id": "remote-reviewer",
            "roles": ["evaluator"],
            "transport": "a2a",
            "model_family": "kimi",
        },
    ],
}


def find_openssl():
    for candidate in (
        os.environ.get("HARNESS_OPENSSL"),
        "/opt/homebrew/bin/openssl",
        "/usr/local/bin/openssl",
        "openssl",
    ):
        if not candidate:
            continue
        try:
            probe = subprocess.run(
                [candidate, "list", "-public-key-algorithms"],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
            )
        except FileNotFoundError:
            continue
        if probe.returncode == 0 and "ED25519" in probe.stdout.upper():
            return candidate
    raise SystemExit("test requires an Ed25519-capable OpenSSL 3")


def main():
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    assert schema["additionalProperties"] is False
    assert schema["required"] == ["intent", "staged_at"]
    assert schema["properties"]["intent"]["additionalProperties"] is False
    openssl = find_openssl()

    with tempfile.TemporaryDirectory(prefix="mode-intent-test-") as raw_tmp:
        tmp = pathlib.Path(raw_tmp)
        repo = tmp / "project"
        repo.mkdir()
        subprocess.run(["git", "init", "-q", repo], check=True)
        subprocess.run(["git", "-C", repo, "config", "user.email", "fixture@example.invalid"], check=True)
        subprocess.run(["git", "-C", repo, "config", "user.name", "fixture"], check=True)
        subprocess.run(
            ["git", "-C", repo, "remote", "add", "origin", "git@github.com:ACME/mode-fixture.git"],
            check=True,
        )
        (repo / "README.md").write_text("later repository state\n", encoding="utf-8")
        subprocess.run(["git", "-C", repo, "add", "README.md"], check=True)
        subprocess.run(["git", "-C", repo, "commit", "-qm", "later state"], check=True)
        later_head = subprocess.check_output(
            ["git", "-C", repo, "rev-parse", "HEAD"], text=True
        ).strip()
        assert later_head != HEAD_AT_STAGING

        private_key = tmp / "console.key"
        public_key = tmp / "console.pub"
        subprocess.run(
            [openssl, "genpkey", "-algorithm", "Ed25519", "-out", private_key],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        subprocess.run(
            [openssl, "pkey", "-in", private_key, "-pubout", "-out", public_key],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        harness_path = repo / "harness.json"
        registry_path = repo / ".agents-registry.json"
        payload_path = tmp / "payload.json"
        signature_path = tmp / "signature.bin"

        def sign(intent):
            signed = copy.deepcopy(intent)
            signed.pop("sig", None)
            payload_path.write_bytes(canonical(signed))
            subprocess.run(
                [
                    openssl,
                    "pkeyutl",
                    "-sign",
                    "-inkey",
                    private_key,
                    "-rawin",
                    "-in",
                    payload_path,
                    "-out",
                    signature_path,
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            signed["sig"] = base64.b64encode(signature_path.read_bytes()).decode("ascii")
            return signed

        passed = 0

        def run_case(
            name,
            intent,
            expected,
            registry=None,
            pub=None,
            tamper=None,
            mode_tamper=None,
        ):
            nonlocal passed
            registry_path.write_text(
                json.dumps(REGISTRY if registry is None else registry), encoding="utf-8"
            )
            signed = sign(intent)
            if tamper:
                tamper(signed)
            mode_defaults = {"intent": signed, "staged_at": iso_after(seconds=-1)}
            if mode_tamper:
                mode_tamper(mode_defaults)
            harness_path.write_text(
                json.dumps(
                    {"framework": {}, "project": {"name": "fixture", "mode_defaults": mode_defaults}},
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            result = subprocess.run(
                [
                    "bash",
                    VALIDATOR,
                    harness_path,
                    registry_path,
                    public_key if pub is None else pub,
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env={**os.environ, "HARNESS_OPENSSL": openssl},
            )
            ok = result.returncode == 0
            if ok != expected:
                print(f"not ok - {name}")
                print(result.stdout, end="")
                print(result.stderr, end="", file=sys.stderr)
                raise SystemExit(1)
            passed += 1
            print(f"ok {passed} - {name}")

        run_case("valid fast profile", base_intent(), True)
        run_case("valid heterogeneous profile", base_intent("heterogeneous"), True)
        run_case(
            "valid slow profile mixes local-cli generator and a2a evaluator",
            base_intent("slow"),
            True,
        )
        run_case("disabled autonomy is exactly enabled false", base_intent(autonomy=False), True)

        run_case(
            "signed expected head may differ from later repository state at plan time",
            {**base_intent(), "expected_head_sha": "f" * 40},
            True,
        )

        invalid = base_intent()
        invalid["expected_head_sha"] = "abc123"
        run_case("invalid expected head shape", invalid, False)

        invalid = base_intent()
        invalid["repo_key"] = "github.com/acme/another-repo"
        run_case("repo identity mismatch", invalid, False)

        run_case(
            "signed identity metadata tamper invalidates signature",
            base_intent(),
            False,
            tamper=lambda signed: signed.__setitem__("issued_by", "attacker@example.invalid"),
        )
        run_case(
            "valid-shape expected head metadata tamper invalidates signature",
            base_intent(),
            False,
            tamper=lambda signed: signed.__setitem__("expected_head_sha", "f" * 40),
        )
        run_case(
            "nested desired tamper invalidates signature",
            base_intent(),
            False,
            tamper=lambda signed: signed["desired"]["autonomy"]["budget"].__setitem__(
                "max_wakes", 9
            ),
        )
        run_case(
            "staging envelope rejects unexpected metadata",
            base_intent(),
            False,
            mode_tamper=lambda mode: mode.__setitem__("staged_commit_sha", "f" * 40),
        )

        invalid = base_intent()
        invalid["desired"]["execution"]["profile"] = "a2a"
        run_case("invalid execution profile", invalid, False)

        invalid = base_intent()
        invalid["desired"]["execution"]["role_assignments"] = {
            "generator": "main-claude",
            "evaluator": "reviewer-codex",
        }
        run_case("fast profile keeps assignments null", invalid, False)

        invalid = base_intent("heterogeneous")
        invalid["desired"]["execution"]["role_assignments"]["evaluator"] = "missing-agent"
        run_case("missing assigned agent", invalid, False)

        bad_registry = copy.deepcopy(REGISTRY)
        bad_registry["agents"][1]["roles"] = ["generator"]
        run_case("role-incompatible agent", base_intent("heterogeneous"), False, bad_registry)

        bad_registry = copy.deepcopy(REGISTRY)
        bad_registry["agents"][1]["model_family"] = "claude"
        run_case("same generator evaluator model family", base_intent("heterogeneous"), False, bad_registry)

        bad_registry = copy.deepcopy(REGISTRY)
        bad_registry["agents"][1]["transport"] = "a2a"
        run_case("heterogeneous rejects a2a", base_intent("heterogeneous"), False, bad_registry)

        invalid = base_intent("slow")
        invalid["desired"]["execution"]["role_assignments"] = {
            "generator": "main-claude",
            "evaluator": "reviewer-codex",
        }
        run_case("slow requires at least one a2a", invalid, False)

        invalid = base_intent()
        invalid["desired"]["autonomy"]["auto_cross"] = ["A", "C"]
        run_case("autonomy Class C rejected", invalid, False)

        invalid = base_intent()
        invalid["desired"]["autonomy"]["auto_cross"] = ["A", "A"]
        run_case("autonomy gates must be unique", invalid, False)

        invalid = base_intent()
        invalid["desired"]["autonomy"]["budget"]["max_tokens"] = 10_000_001
        run_case("autonomy token budget is upper bounded", invalid, False)

        invalid = base_intent()
        del invalid["desired"]["autonomy"]["budget"]["max_cost_usd"]
        run_case("autonomy requires all four budgets", invalid, False)

        invalid = base_intent(autonomy=False)
        invalid["desired"]["autonomy"]["budget"] = {
            "max_tokens": 0,
            "max_cost_usd": 0,
            "max_wakes": 1,
            "max_fix_rounds": 0,
        }
        run_case("disabled autonomy rejects stale policy fields", invalid, False)

        invalid = base_intent()
        invalid["desired"]["autonomy"]["expires_at"] = iso_after(seconds=-1)
        run_case("autonomy has its own future expiry", invalid, False)

        invalid = base_intent()
        invalid["intent_expires_at"] = iso_after(seconds=-1)
        run_case("expired intent", invalid, False)

        invalid = base_intent()
        invalid["issued_at"] = "2026-07-27T10:00:00-07:00"
        run_case("issued timestamp must use UTC Z form", invalid, False)

        run_case(
            "staged timestamp must use UTC Z form",
            base_intent(),
            False,
            mode_tamper=lambda mode: mode.__setitem__(
                "staged_at", "2026-07-27T10:00:00-07:00"
            ),
        )

        invalid = base_intent()
        invalid["issued_by"] = "   "
        run_case("human identity must be nonempty", invalid, False)

        run_case("missing project public key", base_intent(), False, pub=tmp / "missing.pub")

        planner_candidates = []
        for ancestor in HERE.parents:
            planner_candidates.extend((ancestor / "planner.md", ancestor / "harness" / "planner.md"))
        planner_path = next((path for path in planner_candidates if path.is_file()), None)
        assert planner_path is not None, "planner activation instructions are not installed"
        planner = planner_path.read_text(encoding="utf-8")
        for required_instruction in (
            "仅在新批次边界消费签名模式意图",
            "绝对不得要求当前 HEAD 等于 `expected_head_sha`",
            '"applied_batch": "<new batch id>"',
            "删除上一批遗留的 `autonomy-policy.json`",
        ):
            assert required_instruction in planner, required_instruction
        validator_source = VALIDATOR.read_text(encoding="utf-8")
        assert '"rev-parse", "HEAD"' not in validator_source
        passed += 1
        print(f"ok {passed} - planner activation instructions preserve phase and manual-mode rules")

        print(f"1..{passed}")


if __name__ == "__main__":
    main()
