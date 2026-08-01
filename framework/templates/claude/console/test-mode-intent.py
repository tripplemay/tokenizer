#!/usr/bin/env python3
"""Repeatable signed fixtures for validate-mode-intent.sh."""

import base64
import copy
import datetime
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile


HERE = pathlib.Path(__file__).resolve().parent
VALIDATOR = HERE / "validate-mode-intent.sh"
RESOLVER = HERE / "resolve-mode-bindings.sh"
CONSUMER = HERE / "consume-mode-intent.sh"
RESOLVED_BINDINGS_VALIDATOR = HERE.parent / "dispatch" / "validate-resolved-mode-bindings.sh"
ACTIVE_ROLE_RESOLVER = HERE.parent / "dispatch" / "resolve-active-mode-role.sh"
TOOL_CATALOG = HERE.parent / "dispatch" / "tool-catalog.py"
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


def tool_binding(tool, invocation):
    return {"tool": tool, "invocation": invocation}


def base_tool_intent(profile="heterogeneous", autonomy=True):
    if profile == "fast":
        bindings = None
    elif profile == "heterogeneous":
        bindings = {
            "planner": tool_binding("kimi", "local-cli"),
            "generator": tool_binding("codex", "local-cli"),
            "evaluator": tool_binding("kimi", "local-cli"),
        }
    elif profile == "slow":
        bindings = {
            "planner": tool_binding("kimi", "local-cli"),
            "generator": tool_binding("codex", "local-cli"),
            "evaluator": tool_binding("kimi", "a2a"),
        }
    else:
        raise AssertionError(profile)
    return {
        "intent_id": "intent-tool-fixture-001",
        "repo_key": REPO_KEY,
        "expected_head_sha": HEAD_AT_STAGING,
        "desired": {
            "autonomy": base_autonomy(autonomy),
            "execution": {"role_bindings": bindings, "profile": profile},
        },
        "issued_by": "human@example.invalid",
        "issued_at": iso_after(minutes=-1),
        "intent_expires_at": iso_after(days=1),
    }


REGISTRY = {
    "version": "dispatch/1",
    "agents": [
        {
            "id": "planner-claude",
            "roles": ["planner"],
            "transport": "subagent",
            "agent_type": "planner-proposal",
            "model_family": "claude",
            "constraints": {"l2": False, "write_src": False, "push": False},
        },
        {
            "id": "main-claude",
            "roles": ["generator"],
            "transport": "subagent",
            "agent_type": "generator-restricted",
            "model_family": "claude",
            "constraints": {"l2": False, "write_src": True, "push": True},
        },
        {
            "id": "reviewer-claude",
            "roles": ["evaluator"],
            "transport": "subagent",
            "agent_type": "evaluator",
            "model_family": "claude",
            "constraints": {"l2": False, "write_src": False, "push": False},
        },
        {
            "id": "reviewer-codex",
            "roles": ["evaluator"],
            "transport": "local-cli",
            "adapter": "codex",
            "model_family": "codex",
            "constraints": {"l2": False, "write_src": False, "push": False},
            "sandbox": {"home_dir": "/tmp/mode-intent/reviewer-codex"},
        },
        {
            "id": "local-builder",
            "roles": ["generator"],
            "transport": "local-cli",
            "adapter": "codex",
            "model_family": "codex",
            "constraints": {"l2": False, "write_src": True, "push": False},
            "sandbox": {"home_dir": "/tmp/mode-intent/local-builder"},
        },
        {
            "id": "remote-reviewer",
            "roles": ["evaluator"],
            "transport": "a2a",
            "tool": "kimi",
            "model_family": "kimi",
            "endpoint": "https://example.invalid/a2a",
            "constraints": {"l2": False, "write_src": False, "push": False},
        },
        {
            "id": "planner-kimi",
            "roles": ["planner"],
            "transport": "local-cli",
            "adapter": "kimi",
            "model_family": "kimi",
            "constraints": {"l2": False, "write_src": False, "push": False},
            "sandbox": {"home_dir": "/tmp/mode-intent/planner-kimi"},
        },
        {
            "id": "planner-claude-local",
            "roles": ["planner"],
            "transport": "local-cli",
            "adapter": "claude-code",
            "model_family": "claude",
            "constraints": {"l2": False, "write_src": False, "push": False},
            "sandbox": {"home_dir": "/tmp/mode-intent/planner-claude-local"},
        },
        {
            "id": "reviewer-kimi-local",
            "roles": ["evaluator"],
            "transport": "local-cli",
            "adapter": "kimi",
            "model_family": "kimi",
            "constraints": {"l2": False, "write_src": False, "push": False},
            "sandbox": {"home_dir": "/tmp/mode-intent/reviewer-kimi"},
        },
    ],
}


INTEGRATION_REGISTRY = {
    "version": "tool-integrations/1",
    "integrations": [
        {
            "id": "codex",
            "tool": "codex",
            "label": "Codex",
            "model_family": "codex",
            "priority": 100,
            "capabilities": ["plan", "build", "verify"],
            "local_cli": {
                "adapter": "codex",
                "sandbox": {"home_dir": "/tmp/mode-intent/codex"},
                "timeout_s": 60,
            },
        },
        {
            "id": "kimi",
            "tool": "kimi",
            "label": "Kimi Code",
            "model_family": "kimi",
            "priority": 100,
            "capabilities": ["plan", "build", "verify"],
            "local_cli": {
                "adapter": "kimi",
                "sandbox": {"home_dir": "/tmp/mode-intent/kimi"},
                "timeout_s": 60,
            },
        },
        {
            "id": "claude-code",
            "tool": "claude-code",
            "label": "Claude Code",
            "model_family": "claude",
            "priority": 100,
            "capabilities": ["plan", "verify"],
            "subagent": True,
        },
    ],
    "a2a_targets": [
        {
            "id": "codex-loopback",
            "integration_id": "codex",
            "remote_runner_id": "codex-loopback",
            "endpoint": "https://example.invalid/codex-a2a",
            "auth": {"type": "none"},
            "priority": 100,
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
    enabled_autonomy = schema["properties"]["intent"]["properties"]["desired"]["properties"]["autonomy"]["oneOf"][1]
    assert enabled_autonomy["properties"]["budget"]["properties"]["max_cost_usd"]["multipleOf"] == 0.01
    assert "propertyNames" in enabled_autonomy["properties"]["wake_interval_s"]
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
            must_contain=None,
            must_not_contain=None,
            adapters=None,
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
            command = ["bash", VALIDATOR]
            if adapters is not None:
                command.extend(["--adapters", adapters])
            command.extend([harness_path, registry_path, public_key if pub is None else pub])
            result = subprocess.run(
                command,
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
            output = result.stdout + result.stderr
            if must_contain is not None and must_contain not in output:
                print(f"not ok - {name}: missing {must_contain!r}", file=sys.stderr)
                print(output, end="", file=sys.stderr)
                raise SystemExit(1)
            if must_not_contain is not None and must_not_contain in output:
                print(f"not ok - {name}: unexpectedly contained {must_not_contain!r}", file=sys.stderr)
                print(output, end="", file=sys.stderr)
                raise SystemExit(1)
            passed += 1
            print(f"ok {passed} - {name}")
            return result

        def run_resolver_case(name, expected, must_contain=None, env=None, adapters=None):
            nonlocal passed
            command = ["bash", RESOLVER]
            if adapters is not None:
                command.extend(["--adapters", adapters])
            command.extend([harness_path, registry_path, public_key])
            result = subprocess.run(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env={**os.environ, "HARNESS_OPENSSL": openssl, **(env or {})},
            )
            ok = result.returncode == 0
            if ok != expected:
                print(f"not ok - {name}")
                print(result.stdout, end="")
                print(result.stderr, end="", file=sys.stderr)
                raise SystemExit(1)
            output = result.stdout + result.stderr
            if must_contain is not None and must_contain not in output:
                print(f"not ok - {name}: missing {must_contain!r}", file=sys.stderr)
                print(output, end="", file=sys.stderr)
                raise SystemExit(1)
            passed += 1
            print(f"ok {passed} - {name}")
            return result

        def resolve_catalog(bindings, adapters=None):
            """Resolve records through the released catalog, including provenance."""
            bindings_path = tmp / "catalog-bindings.json"
            bindings_path.write_text(json.dumps(bindings), encoding="utf-8")
            command = [
                sys.executable,
                str(TOOL_CATALOG),
                "resolve",
                "--registry",
                str(registry_path),
                "--bindings",
                str(bindings_path),
            ]
            if adapters is not None:
                command.extend(["--adapters", str(adapters)])
            result = subprocess.run(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env={**os.environ, "HARNESS_OPENSSL": openssl},
            )
            assert result.returncode == 0, result.stdout + result.stderr
            return json.loads(result.stdout)

        run_case("valid fast profile", base_intent(), True)
        run_case("valid heterogeneous profile", base_intent("heterogeneous"), True)
        run_case(
            "valid slow profile mixes local-cli generator and a2a evaluator",
            base_intent("slow"),
            True,
        )
        run_case(
            "valid v2 heterogeneous bindings resolve a Kimi planner without exposing its agent id",
            base_tool_intent("heterogeneous"),
            True,
        )
        run_resolver_case(
            "direct resolver repeats signature validation before resolving bindings",
            True,
        )
        run_case(
            "valid v2 slow bindings allow a2a on any configured role",
            base_tool_intent("slow"),
            True,
        )
        coordinator_intent = base_tool_intent("slow")
        coordinator_intent["intent_id"] = "intent-tool-coordinator-002"
        coordinator_intent["desired"]["execution"]["role_bindings"] = {
            "planner": None,
            "generator": tool_binding("kimi", "local-cli"),
            "evaluator": tool_binding("codex", "a2a"),
        }
        run_case(
            "v2 integration registry keeps Planner with Coordinator and resolves Codex A2A",
            coordinator_intent,
            True,
            INTEGRATION_REGISTRY,
        )
        coordinator_resolution = run_resolver_case(
            "v2 integration registry resolution records Coordinator Planner as null",
            True,
        )
        resolved = json.loads(coordinator_resolution.stdout)
        assert resolved["planner"] is None
        assert resolved["generator"]["agent_id"] == "local-cli--kimi--generator"
        assert resolved["evaluator"]["agent_id"] == "a2a--codex-loopback--evaluator"

        # A project-owned adapter directory must be supplied uniformly to
        # both validation and direct resolution. Otherwise a future verified
        # CLI integration can be signed at consumption yet become impossible
        # to inspect through the resolver utility.
        custom_adapters = repo / "custom-adapters"
        custom_adapters.mkdir()
        adapters_root = HERE.parent / "dispatch" / "transports" / "adapters"
        for tool in ("codex", "kimi"):
            adapter = json.loads((adapters_root / f"{tool}.json").read_text(encoding="utf-8"))
            adapter["name"] = f"custom-{tool}"
            (custom_adapters / f"custom-{tool}.json").write_text(
                json.dumps(adapter), encoding="utf-8"
            )
        custom_registry = copy.deepcopy(INTEGRATION_REGISTRY)
        for integration in custom_registry["integrations"]:
            if integration["id"] in {"codex", "kimi"}:
                integration["local_cli"]["adapter"] = f"custom-{integration['id']}"
        run_case(
            "v2 integration registry validates project-owned adapters",
            coordinator_intent,
            True,
            custom_registry,
            adapters=custom_adapters,
        )
        custom_resolution = run_resolver_case(
            "direct resolver forwards project-owned adapters",
            True,
            adapters=custom_adapters,
        )
        assert json.loads(custom_resolution.stdout)["planner"] is None
        run_case("valid v2 fast keeps bindings null", base_tool_intent("fast"), True)
        run_case("disabled autonomy is exactly enabled false", base_intent(autonomy=False), True)

        # Cross-runtime fixture: Node generates the canonical JSON bytes and
        # Ed25519 signature; the framework's Python validator must accept it.
        node = shutil.which("node")
        assert node is not None, "Node.js is required for the canonical signature parity fixture"
        node_intent = base_tool_intent("heterogeneous")
        node_intent["desired"]["autonomy"]["budget"]["max_cost_usd"] = 10
        node_intent_path = tmp / "node-intent.json"
        node_intent_path.write_text(json.dumps(node_intent, ensure_ascii=False), encoding="utf-8")
        node_signer = r'''
const crypto = require("node:crypto");
const fs = require("node:fs");
const intent = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}
const payload = Object.fromEntries(Object.entries(intent).filter(([key]) => key !== "sig"));
process.stdout.write(crypto.sign(null, Buffer.from(canonical(payload), "utf8"), fs.readFileSync(process.argv[1])).toString("base64"));
'''
        signed_node = copy.deepcopy(node_intent)
        signed_node["sig"] = subprocess.check_output(
            [node, "-e", node_signer, str(private_key), str(node_intent_path)], text=True
        )
        registry_path.write_text(json.dumps(REGISTRY), encoding="utf-8")
        harness_path.write_text(
            json.dumps(
                {"framework": {}, "project": {"name": "fixture", "mode_defaults": {"intent": signed_node, "staged_at": iso_after(seconds=-1)}}},
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        node_result = subprocess.run(
            ["bash", VALIDATOR, harness_path, registry_path, public_key],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env={**os.environ, "HARNESS_OPENSSL": openssl},
        )
        if node_result.returncode != 0:
            raise AssertionError("Node-produced Ed25519 signature was rejected:\n" + node_result.stdout + node_result.stderr)
        passed += 1
        print(f"ok {passed} - Node canonical payload signature verifies in framework validator")

        # A real file swap between parsing and OpenSSL verification must not
        # change the bindings consumed by the resolver.
        original = sign(base_tool_intent("heterogeneous"))
        original_mode = {"intent": original, "staged_at": iso_after(seconds=-1)}
        harness_path.write_text(
            json.dumps({"framework": {}, "project": {"name": "fixture", "mode_defaults": original_mode}}),
            encoding="utf-8",
        )
        swapped = copy.deepcopy(original_mode)
        swapped["intent"]["desired"]["execution"]["role_bindings"]["planner"] = tool_binding("claude-code", "subagent")
        swap_path = tmp / "harness-swapped.json"
        swap_path.write_text(
            json.dumps({"framework": {}, "project": {"name": "fixture", "mode_defaults": swapped}}),
            encoding="utf-8",
        )
        swap_openssl = tmp / "swap-openssl.sh"
        swap_openssl.write_text(
            "#!/bin/sh\n"
            "if [ \"$1\" = pkeyutl ]; then cp \"$HARNESS_SWAP_SOURCE\" \"$HARNESS_SWAP_TARGET\"; fi\n"
            "exec \"$HARNESS_REAL_OPENSSL\" \"$@\"\n",
            encoding="utf-8",
        )
        swap_openssl.chmod(0o755)
        swapped_result = run_resolver_case(
            "resolver consumes the sealed pre-verification snapshot across a real harness swap",
            True,
            env={
                "HARNESS_OPENSSL": str(swap_openssl),
                "HARNESS_REAL_OPENSSL": openssl,
                "HARNESS_SWAP_SOURCE": str(swap_path),
                "HARNESS_SWAP_TARGET": str(harness_path),
            },
        )
        assert json.loads(swapped_result.stdout)["planner"]["agent_id"] == "planner-kimi"

        # A consumed v2 non-fast batch owns a full signed checkpoint. Later
        # harness staging is deliberately for the next batch only, and cannot
        # replace the active route even if progress audit fields are modified.
        progress_path = repo / "progress.json"
        consume_intent = sign(base_tool_intent("heterogeneous"))
        harness_path.write_text(
            json.dumps(
                {
                    "framework": {},
                    "project": {
                        "name": "fixture",
                        "mode_defaults": {
                            "intent": consume_intent,
                            "staged_at": iso_after(seconds=-1),
                        },
                    },
                }
            ),
            encoding="utf-8",
        )
        progress_path.write_text(
            json.dumps({"status": "new", "role_assignments": None, "mode_intent": None}),
            encoding="utf-8",
        )

        def consume(batch, adapters=None):
            command = [
                "bash", CONSUMER,
                "--batch", batch,
                "--progress", progress_path,
                "--harness", harness_path,
                "--registry", registry_path,
                "--pub", public_key,
            ]
            if adapters is not None:
                command.extend(["--adapters", adapters])
            return subprocess.run(
                command,
                cwd=repo,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env={**os.environ, "HARNESS_OPENSSL": openssl},
            )

        def validate_active_checkpoint(adapters=None):
            command = [
                "bash", RESOLVED_BINDINGS_VALIDATOR,
                "--progress", progress_path,
                "--registry", registry_path,
                "--pub", public_key,
            ]
            if adapters is not None:
                command.extend(["--adapters", adapters])
            return subprocess.run(
                command,
                cwd=repo,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env={**os.environ, "HARNESS_OPENSSL": openssl},
            )

        registry_path.write_text(json.dumps(REGISTRY), encoding="utf-8")
        consumed = consume("BL-CHECKPOINT")
        assert consumed.returncode == 0, consumed.stderr
        active = json.loads(progress_path.read_text(encoding="utf-8"))
        original_resolution = copy.deepcopy(active["mode_intent"]["resolution"])
        assert active["mode_intent"]["signed_intent"] == consume_intent
        assert active["role_assignments"] == {
            role: original_resolution[role]["agent_id"]
            for role in ("planner", "generator", "evaluator")
        }
        active["status"] = "building"
        progress_path.write_text(json.dumps(active), encoding="utf-8")
        passed += 1
        print(f"ok {passed} - v2 consumption atomically persists full signed checkpoint")

        # An explicit project-owned adapter directory must survive consumption.
        # Active validation intentionally receives no --adapters override: it
        # can only pass by recovering the durable checkpoint path.
        custom_consumption_intent = copy.deepcopy(coordinator_intent)
        custom_consumption_intent["intent_id"] = "intent-custom-adapters-003"
        harness_path.write_text(
            json.dumps(
                {
                    "framework": {},
                    "project": {
                        "name": "fixture",
                        "mode_defaults": {
                            "intent": sign(custom_consumption_intent),
                            "staged_at": iso_after(seconds=-1),
                        },
                    },
                }
            ),
            encoding="utf-8",
        )
        progress_path.write_text(
            json.dumps({"status": "new", "role_assignments": None, "mode_intent": None}),
            encoding="utf-8",
        )
        registry_path.write_text(json.dumps(custom_registry), encoding="utf-8")
        custom_consumed = consume("BL-CUSTOM-ADAPTERS", adapters=custom_adapters)
        assert custom_consumed.returncode == 0, custom_consumed.stderr
        custom_active = json.loads(progress_path.read_text(encoding="utf-8"))
        assert custom_active["mode_intent"]["adapter_dir"] == "custom-adapters"
        recovered_custom = validate_active_checkpoint()
        assert recovered_custom.returncode == 0, recovered_custom.stderr
        assert json.loads(recovered_custom.stdout)["planner"] is None
        for command, label in (
            (["bash", HERE.parent / "dispatch" / "validate-dispatch.sh", "registry", registry_path], "registry"),
            (["bash", HERE.parent / "dispatch" / "validate-dispatch.sh", "assignments", progress_path, registry_path], "assignments"),
        ):
            active_preflight = subprocess.run(
                command,
                cwd=repo,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            assert active_preflight.returncode == 0, f"{label}: {active_preflight.stderr}"
        wrong_custom = validate_active_checkpoint(adapters=adapters_root)
        assert wrong_custom.returncode == 2
        assert "adapter" in wrong_custom.stderr
        progress_path.write_text(json.dumps(active), encoding="utf-8")
        registry_path.write_text(json.dumps(REGISTRY), encoding="utf-8")
        passed += 1
        print(f"ok {passed} - custom adapter directory persists and active routes reject drift")

        # A separately valid next-batch intent must not affect the active
        # checkpoint resolver. It selects a different Planner route on purpose.
        next_intent = base_tool_intent("heterogeneous")
        next_intent["intent_id"] = "intent-next-batch-002"
        next_intent["desired"]["execution"]["role_bindings"]["planner"] = tool_binding(
            "claude-code", "local-cli"
        )
        harness_path.write_text(
            json.dumps(
                {
                    "framework": {},
                    "project": {
                        "name": "fixture",
                        "mode_defaults": {
                            "intent": sign(next_intent),
                            "staged_at": iso_after(seconds=-1),
                        },
                    },
                }
            ),
            encoding="utf-8",
        )
        active_result = validate_active_checkpoint()
        assert active_result.returncode == 0, active_result.stderr
        assert json.loads(active_result.stdout) == original_resolution
        passed += 1
        print(f"ok {passed} - active checkpoint ignores later staged harness intent")

        # v2 checkpoints pre-dating execution provenance must not silently
        # retain a route when registry or adapter execution semantics change.
        old_five_field_checkpoint = copy.deepcopy(active)
        for role in ("planner", "generator", "evaluator"):
            old_five_field_checkpoint["mode_intent"]["resolution"][role].pop(
                "execution_provenance_sha256"
            )
        progress_path.write_text(json.dumps(old_five_field_checkpoint), encoding="utf-8")
        old_five_field_result = validate_active_checkpoint()
        assert old_five_field_result.returncode == 2
        assert (
            "execution_provenance_sha256" in old_five_field_result.stderr
            or "六" in old_five_field_result.stderr
        )
        progress_path.write_text(json.dumps(active), encoding="utf-8")
        passed += 1
        print(f"ok {passed} - old five-field active checkpoint fails closed")

        def resolve_active_role(role, expected_agent=None, progress=progress_path):
            command = [
                "bash", ACTIVE_ROLE_RESOLVER,
                "--role", role,
                "--progress", progress,
                "--registry", registry_path,
                "--pub", public_key,
            ]
            if expected_agent is not None:
                command.extend(["--expected-agent", expected_agent])
            return subprocess.run(
                command,
                cwd=repo,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env={**os.environ, "HARNESS_OPENSSL": openssl},
            )

        resolved_role = resolve_active_role("planner", "planner-kimi")
        assert resolved_role.returncode == 0, resolved_role.stderr
        assert json.loads(resolved_role.stdout) == original_resolution["planner"]
        outside_registry = tmp / "outside-registry.json"
        outside_registry.write_text(registry_path.read_text(encoding="utf-8"), encoding="utf-8")
        registry_pinning_commands = (
            (
                "mode intent validator",
                ["bash", VALIDATOR, harness_path, outside_registry, public_key],
            ),
            (
                "mode bindings resolver",
                ["bash", RESOLVER, harness_path, outside_registry, public_key],
            ),
            (
                "mode intent consumer",
                [
                    "bash", CONSUMER, "--batch", "BL-REGISTRY-PIN", "--progress", progress_path,
                    "--harness", harness_path, "--registry", outside_registry, "--pub", public_key,
                ],
            ),
            (
                "resolved bindings validator",
                [
                    "bash", RESOLVED_BINDINGS_VALIDATOR, "--progress", progress_path,
                    "--registry", outside_registry, "--pub", public_key,
                ],
            ),
            (
                "active role resolver",
                [
                    "bash", ACTIVE_ROLE_RESOLVER, "--role", "planner", "--progress", progress_path,
                    "--registry", outside_registry, "--pub", public_key,
                ],
            ),
        )
        for label, command in registry_pinning_commands:
            rejected_registry = subprocess.run(
                command,
                cwd=repo,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env={**os.environ, "HARNESS_OPENSSL": openssl},
            )
            assert rejected_registry.returncode == 2, f"{label}: {rejected_registry.stderr}"
            assert "registry" in rejected_registry.stderr.lower(), f"{label}: {rejected_registry.stderr}"
        passed += 1
        print(f"ok {passed} - signing, consumption, and active-role entries pin registry to project root")
        wrong_agent = resolve_active_role("planner", "planner-claude")
        assert wrong_agent.returncode == 2
        assert "不一致" in wrong_agent.stderr
        route_envelope = repo / "route-check-envelope.json"
        route_envelope.write_text(
            json.dumps(
                {
                    "task_id": "route-check-001",
                    "contract_version": "harness/1.1",
                    "batch": "BL-CHECKPOINT",
                    "role": "planner",
                    "repo": {
                        "url": ".",
                        "ref": subprocess.check_output(
                            ["git", "-C", repo, "rev-parse", "HEAD"], text=True
                        ).strip(),
                    },
                    "spec": None,
                    "features": [],
                    "l2_authorized": False,
                    "contract": "Return only a bounded planner proposal and never modify the project state.",
                    "deliverable": {
                        "artifact": "docs/test-reports/planner-proposal-route-check-001.json",
                        "schema": ".claude/dispatch/planner-proposal.schema.json",
                        "commit_to": None,
                    },
                }
            ),
            encoding="utf-8",
        )
        dispatch_wrong_agent = subprocess.run(
            [
                "bash", HERE.parent / "dispatch" / "dispatch-run.sh",
                "--agent", "planner-claude",
                "--envelope", route_envelope,
                "--registry", registry_path,
                "--progress", progress_path,
                "--pub", public_key,
            ],
            cwd=repo,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env={**os.environ, "HARNESS_OPENSSL": openssl},
        )
        assert dispatch_wrong_agent.returncode == 2
        assert "active mode role" in dispatch_wrong_agent.stderr
        alternate_progress = repo / "alternate-progress.json"
        alternate_progress.write_text(json.dumps({"status": "building"}), encoding="utf-8")
        for unsafe_progress, label in (
            (alternate_progress, "alternate existing progress"),
            (repo / "missing-progress.json", "nonexistent progress"),
        ):
            rejected_progress = subprocess.run(
                [
                    "bash", HERE.parent / "dispatch" / "dispatch-run.sh",
                    "--agent", "planner-kimi",
                    "--envelope", route_envelope,
                    "--registry", registry_path,
                    "--progress", unsafe_progress,
                    "--pub", public_key,
                ],
                cwd=repo,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env={**os.environ, "HARNESS_OPENSSL": openssl},
            )
            assert rejected_progress.returncode == 2, label
            assert "canonical progress" in rejected_progress.stderr, label
        progress_link = repo / "progress-link.json"
        progress_link.symlink_to(progress_path.name)
        symlink_progress = subprocess.run(
            [
                "bash", HERE.parent / "dispatch" / "dispatch-run.sh",
                "--agent", "planner-claude",
                "--envelope", route_envelope,
                "--registry", registry_path,
                "--progress", progress_link,
                "--pub", public_key,
            ],
            cwd=repo,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env={**os.environ, "HARNESS_OPENSSL": openssl},
        )
        assert symlink_progress.returncode == 2
        assert "active mode role" in symlink_progress.stderr
        legacy_progress = repo / "legacy-progress.json"
        legacy_progress.write_text(
            json.dumps(
                {
                    "status": "building",
                    "role_assignments": {"generator": "local-builder", "evaluator": "reviewer-codex"},
                    "mode_intent": {"intent_id": "legacy-intent"},
                }
            ),
            encoding="utf-8",
        )
        legacy_result = resolve_active_role("generator", progress=legacy_progress)
        assert legacy_result.returncode == 0, legacy_result.stderr
        assert json.loads(legacy_result.stdout) == {}
        passed += 1
        print(f"ok {passed} - active role resolver/dispatch reject wrong or alternate progress; symlink and legacy stay compatible")

        # Both mutable audit records can be changed to a catalog-valid
        # descriptor, including its current provenance digest, but the signed
        # original tool/invocation still rejects the swap.
        alternate_resolution = resolve_catalog(
            {
                "planner": tool_binding("claude-code", "local-cli"),
                "generator": tool_binding("codex", "local-cli"),
                "evaluator": tool_binding("kimi", "local-cli"),
            }
        )
        assert alternate_resolution["planner"]["agent_id"] == "planner-claude-local"
        tampered = copy.deepcopy(active)
        tampered["mode_intent"]["resolution"]["planner"] = copy.deepcopy(
            alternate_resolution["planner"]
        )
        tampered["role_assignments"]["planner"] = "planner-claude"
        progress_path.write_text(json.dumps(tampered), encoding="utf-8")
        tampered_result = validate_active_checkpoint()
        assert tampered_result.returncode == 2
        assert "签名" in tampered_result.stderr or "不一致" in tampered_result.stderr
        passed += 1
        print(f"ok {passed} - synchronized resolution and assignment tamper halts")

        # A changed checkpoint sig cannot be made authoritative by preserving
        # the catalog-valid audit record.
        tampered = copy.deepcopy(active)
        tampered["mode_intent"]["signed_intent"]["sig"] = "A" * 88
        progress_path.write_text(json.dumps(tampered), encoding="utf-8")
        signature_result = validate_active_checkpoint()
        assert signature_result.returncode == 2
        assert "sig" in signature_result.stderr or "checkpoint" in signature_result.stderr
        passed += 1
        print(f"ok {passed} - checkpoint signature tamper halts")

        # Changing the signed binding and matching the mutable audit values is
        # still invalid because the entire persisted object, including sig, is
        # reverified before current catalog resolution.
        tampered = copy.deepcopy(active)
        tampered["mode_intent"]["signed_intent"]["desired"]["execution"]["role_bindings"]["planner"] = tool_binding(
            "claude-code", "subagent"
        )
        tampered["mode_intent"]["resolution"]["planner"] = copy.deepcopy(
            alternate_resolution["planner"]
        )
        tampered["role_assignments"]["planner"] = "planner-claude"
        progress_path.write_text(json.dumps(tampered), encoding="utf-8")
        binding_result = validate_active_checkpoint()
        assert binding_result.returncode == 2
        assert "签名" in binding_result.stderr
        passed += 1
        print(f"ok {passed} - checkpoint binding tamper halts")

        # Re-sign an otherwise identical expired object to model a valid human
        # intent whose original consumption window elapsed during the active
        # batch. Checkpoint validation must keep it usable; only /plan rejects
        # this timestamp for a new consumption.
        expired = copy.deepcopy(active)
        expired_intent = copy.deepcopy(expired["mode_intent"]["signed_intent"])
        expired_intent["issued_at"] = iso_after(days=-2)
        expired_intent["intent_expires_at"] = iso_after(days=-1)
        expired["mode_intent"]["signed_intent"] = sign(expired_intent)
        progress_path.write_text(json.dumps(expired), encoding="utf-8")
        expired_result = validate_active_checkpoint()
        assert expired_result.returncode == 0, expired_result.stderr
        assert json.loads(expired_result.stdout) == original_resolution
        passed += 1
        print(f"ok {passed} - expired original intent does not revoke active checkpoint")

        # The consumer itself refuses an active status before it can replace
        # assignments or an active checkpoint.
        active_consume = consume("BL-SECOND-CHECKPOINT")
        assert active_consume.returncode == 2
        assert "active batch" in active_consume.stderr
        passed += 1
        print(f"ok {passed} - consumer rejects active batch replacement")

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

        invalid = base_tool_intent("fast")
        invalid["desired"]["execution"]["role_bindings"] = {
            "planner": tool_binding("claude-code", "subagent"),
            "generator": tool_binding("codex", "local-cli"),
            "evaluator": tool_binding("kimi", "local-cli"),
        }
        run_case("v2 fast keeps bindings null", invalid, False)

        invalid = base_tool_intent("heterogeneous")
        invalid["desired"]["execution"]["role_bindings"]["planner"] = tool_binding("missing-tool", "local-cli")
        run_case("v2 rejects a tool with no local candidate", invalid, False)

        invalid = base_tool_intent("heterogeneous")
        invalid["desired"]["execution"]["role_bindings"]["planner"] = tool_binding(
            "claude-code", "subagent"
        )
        run_case("v2 rejects a legacy host-native subagent tool binding", invalid, False)

        invalid = base_tool_intent("heterogeneous")
        invalid["desired"]["execution"]["role_bindings"]["evaluator"] = tool_binding("codex", "local-cli")
        run_case("v2 rejects generator evaluator same-family pool", invalid, False)

        invalid = base_tool_intent("heterogeneous")
        invalid["desired"]["execution"]["role_bindings"]["planner"] = tool_binding("kimi", "a2a")
        run_case("v2 heterogeneous rejects a2a on planner", invalid, False)

        invalid = base_tool_intent("slow")
        invalid["desired"]["execution"]["role_bindings"]["evaluator"] = tool_binding("claude-code", "subagent")
        run_case("v2 slow requires a2a across all configured roles", invalid, False)

        run_case(
            "v2 tool binding tamper invalidates the human signature",
            base_tool_intent("heterogeneous"),
            False,
            tamper=lambda signed: signed["desired"]["execution"]["role_bindings"]["planner"].__setitem__("tool", "codex"),
        )

        bad_registry = copy.deepcopy(REGISTRY)
        bad_registry["agents"].append(
            {
                "id": "unsafe-remote-generator",
                "roles": ["generator"],
                "transport": "a2a",
                "endpoint": "https://example.invalid/a2a",
                "model_family": "unsafe",
                "constraints": {"l2": False, "write_src": True, "push": False},
            }
        )
        run_case(
            "v2 validates signature before reading an unsafe registry",
            base_tool_intent("heterogeneous"),
            False,
            bad_registry,
            tamper=lambda signed: signed.__setitem__("issued_by", "tampered@example.invalid"),
            must_contain="Ed25519 签名无效",
            must_not_contain="source-handoff protocol",
        )
        run_resolver_case(
            "direct resolver rejects the unsigned intent before registry resolution",
            False,
            must_contain="Ed25519 签名无效",
        )

        bad_registry = copy.deepcopy(REGISTRY)
        next(agent for agent in bad_registry["agents"] if agent["id"] == "planner-kimi")["sandbox"] = {}
        run_case(
            "v2 preflight rejects a selected local-cli tool without dedicated sandbox",
            base_tool_intent("heterogeneous"),
            False,
            bad_registry,
            must_contain="sandbox.home_dir",
        )

        bad_registry = copy.deepcopy(REGISTRY)
        next(agent for agent in bad_registry["agents"] if agent["id"] == "planner-claude")["agent_type"] = "planner"
        run_case(
            "v2 preflight rejects a subagent Planner without proposal persona",
            base_tool_intent("slow"),
            False,
            bad_registry,
            must_contain="planner-proposal",
        )

        bad_registry = copy.deepcopy(REGISTRY)
        bad_registry["agents"].append(
            {
                "id": "unsafe-remote-generator",
                "roles": ["generator"],
                "transport": "a2a",
                "endpoint": "https://example.invalid/a2a",
                "model_family": "unsafe",
                "constraints": {"l2": False, "write_src": True, "push": False},
            }
        )
        run_case(
            "v2 preflight rejects a2a generator without source handoff",
            base_tool_intent("heterogeneous"),
            False,
            bad_registry,
            must_contain="source-handoff protocol",
        )

        invalid = base_intent("heterogeneous")
        invalid["desired"]["execution"]["role_assignments"]["evaluator"] = "missing-agent"
        run_case("missing assigned agent", invalid, False)

        bad_registry = copy.deepcopy(REGISTRY)
        next(agent for agent in bad_registry["agents"] if agent["id"] == "reviewer-codex")["roles"] = ["generator"]
        run_case("role-incompatible agent", base_intent("heterogeneous"), False, bad_registry)

        bad_registry = copy.deepcopy(REGISTRY)
        next(agent for agent in bad_registry["agents"] if agent["id"] == "reviewer-codex")["model_family"] = "claude"
        run_case("same generator evaluator model family", base_intent("heterogeneous"), False, bad_registry)

        bad_registry = copy.deepcopy(REGISTRY)
        next(agent for agent in bad_registry["agents"] if agent["id"] == "reviewer-codex")["transport"] = "a2a"
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

        for value, label in ((-0.0, "negative zero"), (0.001, "fractional cent"), (1e-6, "scientific sub-cent")):
            invalid = base_intent()
            invalid["desired"]["autonomy"]["budget"]["max_cost_usd"] = value
            run_case(f"autonomy rejects {label} cost", invalid, False)

        # Python normally turns the raw JSON token -0 into int(0). Keep this
        # lexical regression separate so it proves parity with Node's -0 guard.
        registry_path.write_text(json.dumps(REGISTRY), encoding="utf-8")
        raw_negative_zero = sign(base_intent())
        raw_harness = json.dumps(
            {"framework": {}, "project": {"name": "fixture", "mode_defaults": {"intent": raw_negative_zero, "staged_at": iso_after(seconds=-1)}}},
            ensure_ascii=False,
        ).replace('"max_cost_usd": 10.0', '"max_cost_usd": -0')
        harness_path.write_text(raw_harness, encoding="utf-8")
        raw_result = subprocess.run(
            ["bash", VALIDATOR, harness_path, registry_path, public_key],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env={**os.environ, "HARNESS_OPENSSL": openssl},
        )
        assert raw_result.returncode == 2 and "负零" in raw_result.stderr
        passed += 1
        print(f"ok {passed} - raw JSON -0 cost is rejected before signature use")

        for phase in ("constructor", "prototype", "__proto__", "invalid space"):
            invalid = base_intent()
            invalid["desired"]["autonomy"]["wake_interval_s"] = {phase: 60}
            run_case(f"autonomy rejects unsafe wake interval key {phase!r}", invalid, False)

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
