#!/usr/bin/env python3
"""Fast deterministic dispatch deadline and A2A lifecycle regression matrix."""

import importlib.util
import hashlib
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path
from unittest import mock


DISPATCH = Path(__file__).resolve().parent
RUNNER = DISPATCH / "transports" / "a2a-runner.py"
CLIENT = DISPATCH / "transports" / "a2a-client.py"
TIMEOUT = DISPATCH / "process-timeout.py"
VALIDATOR = DISPATCH / "validate-dispatch.sh"
TIMEOUT_SPEC = importlib.util.spec_from_file_location("dispatch_process_timeout", TIMEOUT)
if TIMEOUT_SPEC is None or TIMEOUT_SPEC.loader is None:
    raise RuntimeError("could not load process-timeout helper")
timeout_helper = importlib.util.module_from_spec(TIMEOUT_SPEC)
sys.modules[TIMEOUT_SPEC.name] = timeout_helper
TIMEOUT_SPEC.loader.exec_module(timeout_helper)
sys.path.insert(0, str(DISPATCH))
from dispatch_common import (  # noqa: E402
    DispatchContractError,
    MAX_TIMEOUT_S,
    MIN_TIMEOUT_S,
    effective_timeout,
)


def wait_until(predicate, timeout=4.0, interval=0.02):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(interval)
    return None


def pid_alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


def assert_pids_gone(testcase, pids, timeout=3.0):
    remaining = wait_until(
        lambda: all(not pid_alive(pid) for pid in pids), timeout=timeout
    )
    testcase.assertTrue(remaining, f"processes still alive: {[p for p in pids if pid_alive(p)]}")


def write_executable(path, text):
    Path(path).write_text(text, encoding="utf-8")
    os.chmod(path, 0o755)


class DeadlineAndPreflightTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.repo = self.root / "project"
        self.repo.mkdir()
        subprocess.run(["git", "-C", str(self.repo), "init", "-q"], check=True)
        subprocess.run(
            ["git", "-C", str(self.repo), "config", "user.email", "fixture@example.invalid"],
            check=True,
        )
        subprocess.run(
            ["git", "-C", str(self.repo), "config", "user.name", "fixture"], check=True
        )
        (self.repo / "README.md").write_text("fixture\n", encoding="utf-8")
        subprocess.run(["git", "-C", str(self.repo), "add", "README.md"], check=True)
        subprocess.run(["git", "-C", str(self.repo), "commit", "-qm", "fixture"], check=True)
        self.ref = subprocess.check_output(
            ["git", "-C", str(self.repo), "rev-parse", "HEAD"], text=True
        ).strip()

    def tearDown(self):
        self.temp.cleanup()

    def envelope(self, repo_url=None, deadline_marker="missing"):
        envelope = {
            "task_id": "lifecycle-fixture",
            "contract_version": "harness/1.1",
            "batch": "BL-LIFECYCLE-FIXTURE",
            "role": "evaluator",
            "repo": {"url": str(repo_url or self.repo), "ref": self.ref},
            "l2_authorized": False,
            "contract": "Deterministic fixture contract with enough detail for validation.",
            "deliverable": {
                "artifact": "docs/test-reports/BL-LIFECYCLE-FIXTURE-verdict.json",
                "schema": ".claude/autonomous/verdict-artifact.schema.json",
                "commit_to": None,
            },
        }
        if deadline_marker != "missing":
            envelope["deadline_s"] = deadline_marker
        return envelope

    def validate(self, envelope):
        path = self.root / "envelope.json"
        path.write_text(json.dumps(envelope), encoding="utf-8")
        return subprocess.run(
            ["bash", str(VALIDATOR), "envelope", str(path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

    def test_deadline_schema_manual_and_effective_timeout_agree(self):
        schema = json.loads((DISPATCH / "dispatch-envelope.schema.json").read_text())
        deadline_schema = schema["properties"]["deadline_s"]
        self.assertEqual(deadline_schema["type"], "integer")
        self.assertEqual(deadline_schema["minimum"], MIN_TIMEOUT_S)
        self.assertEqual(deadline_schema["maximum"], MAX_TIMEOUT_S)

        for value in ("missing", MIN_TIMEOUT_S, 90, MAX_TIMEOUT_S):
            self.assertEqual(self.validate(self.envelope(deadline_marker=value)).returncode, 0)
        for value in (True, 60.0, "60", MIN_TIMEOUT_S - 1, -1, MAX_TIMEOUT_S + 1):
            self.assertEqual(
                self.validate(self.envelope(deadline_marker=value)).returncode,
                2,
                repr(value),
            )

        self.assertEqual(effective_timeout(None, 90), 90)
        self.assertEqual(effective_timeout(60, 90), 60)
        self.assertEqual(effective_timeout(90, 90), 90)
        self.assertEqual(effective_timeout(120, 90), 90)
        for value in (True, 60.0, "60", 59, -1, MAX_TIMEOUT_S + 1):
            with self.assertRaises(DispatchContractError):
                effective_timeout(value, 90)

    def test_envelope_path_components_reject_traversal_absolute_and_backslash(self):
        schema = json.loads((DISPATCH / "dispatch-envelope.schema.json").read_text())
        self.assertIn("pattern", schema["properties"]["task_id"])
        self.assertIn("pattern", schema["properties"]["batch"])
        self.assertIn("pattern", schema["properties"]["deliverable"]["properties"]["artifact"])
        cases = [
            ("task_id", "../escape-task-001"),
            ("task_id", "/absolute-task-001"),
            ("task_id", r"task\\escape-001"),
            ("batch", "../escape"),
            ("batch", "/absolute"),
            ("batch", r"batch\\escape"),
            ("batch", ""),
            ("artifact", "../escaped.json"),
            ("artifact", "/tmp/escaped.json"),
            ("artifact", r"docs\\escaped.json"),
            ("artifact", "docs//escaped.json"),
            ("artifact", ""),
        ]
        for field, value in cases:
            envelope = self.envelope()
            if field == "artifact":
                envelope["deliverable"]["artifact"] = value
            else:
                envelope[field] = value
            with self.subTest(field=field, value=value):
                self.assertEqual(self.validate(envelope).returncode, 2)

    def _sandbox_inputs(self, repo_url):
        adapters = self.root / "adapters"
        adapters.mkdir(exist_ok=True)
        fake = self.root / "fake-cli.sh"
        write_executable(
            fake,
            "#!/usr/bin/env bash\n"
            "set -euo pipefail\n"
            "mkdir -p \"$(dirname \"$HARNESS_ARTIFACT\")\"\n"
            "printf '{\"waiting\":null}\\n' > \"$HARNESS_ARTIFACT\"\n",
        )
        (adapters / "fixture.json").write_text(json.dumps({
            "name": "fixture",
            "model_family": "fixture",
            "argv": ["bash", str(fake)],
            "envelope_delivery": "stdin",
            "_verified": True,
            "artifact_relpath": "artifact.json",
        }), encoding="utf-8")
        safe_home = self.root / "safe-home"
        safe_home.mkdir(exist_ok=True)
        registry = self.repo / ".agents-registry.json"
        registry.write_text(json.dumps({
            "version": "dispatch/1",
            "agents": [{
                "id": "fixture-agent",
                "roles": ["evaluator"],
                "transport": "local-cli",
                "adapter": "fixture",
                "model_family": "fixture",
                "constraints": {"l2": False, "write_src": False, "push": False},
                "sandbox": {"home_dir": str(safe_home), "env_allow": []},
                "timeout_s": 90,
            }],
        }), encoding="utf-8")
        envelope = self.repo / "envelope.json"
        envelope.write_text(json.dumps(self.envelope(repo_url, 60)), encoding="utf-8")
        return registry, envelope, adapters

    def _codex_sandbox_inputs(self, argv_extra, config_toml):
        """codex 适配器 + 一份受控的 $CODEX_HOME/config.toml。

        CODEX_HOME 必须由测试显式提供：否则前置会去读开发机真实的 ~/.codex/config.toml，
        测试结果就取决于跑测试的人装了什么 —— 那是最难查的一类不稳定。
        """
        adapters = self.root / "codex-adapters"
        adapters.mkdir(exist_ok=True)
        fake = self.root / "fake-codex.sh"
        write_executable(fake, "#!/usr/bin/env bash\nexit 0\n")
        (adapters / "codex.json").write_text(json.dumps({
            "name": "codex",
            "model_family": "codex",
            "argv": ["bash", str(fake), "--ignore-user-config"] + list(argv_extra),
            "envelope_delivery": "stdin",
            "_verified": True,
            "artifact_relpath": "artifact.json",
        }), encoding="utf-8")
        safe_home = self.root / "codex-safe-home"
        safe_home.mkdir(exist_ok=True)
        codex_home = self.root / "codex-home"
        codex_home.mkdir(exist_ok=True)
        (codex_home / "config.toml").write_text(config_toml, encoding="utf-8")
        registry = self.repo / ".agents-registry.json"
        registry.write_text(json.dumps({
            "version": "dispatch/1",
            "agents": [{
                "id": "codex-agent",
                "roles": ["evaluator"],
                "transport": "local-cli",
                "adapter": "codex",
                "model_family": "codex",
                "constraints": {"l2": False, "write_src": False, "push": False},
                "sandbox": {"home_dir": str(safe_home), "env_allow": []},
                "timeout_s": 90,
            }],
        }), encoding="utf-8")
        envelope = self.repo / "envelope.json"
        envelope.write_text(json.dumps(self.envelope(self.repo, 60)), encoding="utf-8")
        return registry, envelope, adapters, codex_home

    def _run_codex_sandbox(self, argv_extra, config_toml, tag):
        registry, envelope, adapters, codex_home = self._codex_sandbox_inputs(
            argv_extra, config_toml
        )
        workroot = self.root / f"work-{tag}"
        state = self.root / f"state-{tag}"
        env = dict(os.environ)
        env["CODEX_HOME"] = str(codex_home)
        result = subprocess.run([
            "bash", str(DISPATCH / "sandbox-profile.sh"),
            "--agent", "codex-agent",
            "--envelope", str(envelope),
            "--registry", str(registry),
            "--adapters", str(adapters),
            "--workroot", str(workroot),
            "--state", str(state),
        ], cwd=self.repo, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
        return result, workroot, state

    # 前置拦截那条消息独有的话；--ignore-user-config 一词在非阻断的模型提醒里也出现，
    # 拿它做断言会把两条消息混为一谈（本测试第一版就踩了这个）。
    BLOCK_MARK = "已在派活前拦下"

    # 自定义 provider × --ignore-user-config：派活前拦下，别让它烧完额度再 401。
    # 真因见 harness/dispatch-mode.md §5.2.1 与 transports/local-cli.md §8。
    CUSTOM_PROVIDER_CONFIG = (
        'model_provider = "Relay"\n'
        'model = "some-model"\n'
        "\n"
        "[model_providers.Relay]\n"
        'name = "Relay"\n'
        'base_url = "https://relay.example.invalid/v1"\n'
        'wire_api = "responses"\n'
    )

    def test_sandbox_rejects_codex_custom_provider_without_c_override(self):
        result, workroot, state = self._run_codex_sandbox(
            [], self.CUSTOM_PROVIDER_CONFIG, "codex-blocked"
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn(self.BLOCK_MARK, result.stderr)
        self.assertIn("Relay", result.stderr)
        # 报错必须把用户自己的 base_url 填进修法里，否则「可复制」是空话
        self.assertIn("https://relay.example.invalid/v1", result.stderr)
        self.assertIn("model_providers.Relay=", result.stderr)
        # fail-closed：拦下就不该留下任何半成品
        self.assertFalse(workroot.exists())
        self.assertFalse(state.exists())

    def test_sandbox_allows_codex_custom_provider_with_c_override(self):
        override = (
            'model_providers.Relay={name="Relay",'
            'base_url="https://relay.example.invalid/v1",wire_api="responses"}'
        )
        result, _, _ = self._run_codex_sandbox(
            ["-c", override, "-c", "model=some-model"],
            self.CUSTOM_PROVIDER_CONFIG,
            "codex-allowed",
        )
        self.assertNotIn(self.BLOCK_MARK, result.stderr)

    def test_sandbox_allows_codex_when_config_uses_builtin_provider(self):
        result, _, _ = self._run_codex_sandbox(
            [], 'model_provider = "openai"\nmodel = "some-model"\n', "codex-builtin"
        )
        self.assertNotIn(self.BLOCK_MARK, result.stderr)

    def test_sandbox_warns_when_codex_model_is_not_pinned(self):
        override = (
            'model_providers.Relay={name="Relay",'
            'base_url="https://relay.example.invalid/v1",wire_api="responses"}'
        )
        result, _, _ = self._run_codex_sandbox(
            ["-c", override], self.CUSTOM_PROVIDER_CONFIG, "codex-unpinned"
        )
        # 不阻断，但必须出现在 stderr —— 静默换模型是比失败更坏的结果
        self.assertIn("默认模型", result.stderr)

    def test_repo_mismatch_and_non_git_leave_no_partial_sandbox(self):
        other = self.root / "other"
        other.mkdir()
        subprocess.run(["git", "-C", str(other), "init", "-q"], check=True)
        nongit = self.root / "not-a-repository"
        nongit.mkdir()
        for repo_url in (other, nongit):
            registry, envelope, adapters = self._sandbox_inputs(repo_url)
            workroot = self.root / f"work-{repo_url.name}"
            state = self.root / f"state-{repo_url.name}"
            result = subprocess.run([
                "bash", str(DISPATCH / "sandbox-profile.sh"),
                "--agent", "fixture-agent",
                "--envelope", str(envelope),
                "--registry", str(registry),
                "--adapters", str(adapters),
                "--workroot", str(workroot),
                "--state", str(state),
            ], cwd=self.repo, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertIn(str(self.repo.resolve()), result.stderr)
            self.assertIn(str(repo_url.resolve()), result.stderr)
            self.assertFalse(workroot.exists())
            self.assertFalse(state.exists())

    def test_direct_sandbox_rejects_unsafe_envelope_before_creating_paths(self):
        registry, envelope_path, adapters = self._sandbox_inputs(self.repo)
        unsafe = [
            ("task_id", "../escape-task-001"),
            ("batch", "../escape"),
            ("artifact", "../escaped.json"),
        ]
        for field, value in unsafe:
            envelope = self.envelope(self.repo, 60)
            if field == "artifact":
                envelope["deliverable"]["artifact"] = value
            else:
                envelope[field] = value
            envelope_path.write_text(json.dumps(envelope), encoding="utf-8")
            workroot = self.root / f"unsafe-work-{field}"
            state = self.root / f"unsafe-state-{field}"
            result = subprocess.run([
                "bash", str(DISPATCH / "sandbox-profile.sh"),
                "--agent", "fixture-agent",
                "--envelope", str(envelope_path),
                "--registry", str(registry),
                "--adapters", str(adapters),
                "--workroot", str(workroot),
                "--state", str(state),
            ], cwd=self.repo, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            with self.subTest(field=field):
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertFalse(workroot.exists())
                self.assertFalse(state.exists())

    def test_sandbox_rejects_external_same_session_target_before_creating_runtime(self):
        """No stale Kimi bridge target may reach the old Seatbelt path."""
        registry = self.repo / ".agents-registry.json"
        registry.write_text(
            json.dumps(
                {
                    "version": "tool-integrations/1",
                    "integrations": [
                        {
                            "id": "kimi",
                            "tool": "kimi",
                            "model_family": "kimi",
                            "local_cli": {
                                "adapter": "kimi",
                                "sandbox": {"home_dir": str(self.root / "safe-kimi-home")},
                                "timeout_s": 60,
                            },
                            "subagent": {"bridge": "kimi-acp-native-agent"},
                        }
                    ],
                    "a2a_targets": [],
                }
            ),
            encoding="utf-8",
        )
        envelope = self.root / "bridge-envelope.json"
        envelope.write_text(json.dumps(self.envelope(self.repo, 60)), encoding="utf-8")
        workroot = self.root / "unavailable-bridge-work"
        state = self.root / "unavailable-bridge-state"
        result = subprocess.run(
            [
                "bash",
                str(DISPATCH / "sandbox-profile.sh"),
                "--agent",
                "subagent--kimi--evaluator",
                "--envelope",
                str(envelope),
                "--registry",
                str(registry),
                "--workroot",
                str(workroot),
                "--state",
                str(state),
            ],
            cwd=self.repo,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("target id is not registered", result.stderr)
        self.assertFalse(workroot.exists())
        self.assertFalse(state.exists())

    def test_execution_entries_pin_registry_to_project_root_before_creating_paths(self):
        registry, envelope, adapters = self._sandbox_inputs(self.repo)
        outside_dir = self.root / "outside"
        outside_dir.mkdir()
        outside = outside_dir / ".agents-registry.json"
        outside.write_text(registry.read_text(encoding="utf-8"), encoding="utf-8")

        def run_entry(entry, requested_registry, suffix):
            workroot = self.root / f"registry-{entry}-{suffix}-work"
            state = self.root / f"registry-{entry}-{suffix}-state"
            command = [
                "bash",
                str(DISPATCH / ("sandbox-profile.sh" if entry == "sandbox" else "dispatch-run.sh")),
                "--agent", "fixture-agent",
                "--envelope", str(envelope),
                "--registry", str(requested_registry),
                "--adapters", str(adapters),
                "--workroot", str(workroot),
                "--state", str(state),
            ]
            result = subprocess.run(
                command,
                cwd=self.repo,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIn("registry", result.stderr.lower())
            self.assertFalse(workroot.exists(), result.stderr)
            self.assertFalse(state.exists(), result.stderr)

        for entry in ("sandbox", "dispatch"):
            with self.subTest(entry=entry, case="outside"):
                run_entry(entry, outside, "outside")

        registry.unlink()
        os.symlink(outside, registry)
        for entry in ("sandbox", "dispatch"):
            with self.subTest(entry=entry, case="symlink"):
                run_entry(entry, registry, "symlink")

    def test_post_tool_hook_pins_registry_to_project_root_and_rejects_links(self):
        """The immediate configuration hook must match runtime registry pinning."""
        registry = self.repo / ".agents-registry.json"
        registry.write_text(
            json.dumps(
                {
                    "version": "dispatch/1",
                    "agents": [
                        {
                            "id": "fixture-planner",
                            "roles": ["planner"],
                            "transport": "subagent",
                            "agent_type": "planner-proposal",
                            "model_family": "fixture",
                            "constraints": {"write_src": False, "push": False},
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        progress = self.repo / "progress.json"
        progress.write_text("{}\n", encoding="utf-8")

        def hook(path):
            return subprocess.run(
                ["bash", str(VALIDATOR), "hook"],
                cwd=self.repo,
                input=json.dumps({"tool_input": {"file_path": str(path)}}),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )

        self.assertEqual(hook(registry).returncode, 0)
        self.assertEqual(hook(progress).returncode, 0)

        progress.write_text(
            json.dumps({"role_assignments": {"generator": "fixture-planner"}}),
            encoding="utf-8",
        )
        incompatible_assignment = hook(registry)
        self.assertEqual(incompatible_assignment.returncode, 2)
        self.assertIn("不含 generator", incompatible_assignment.stdout)

        progress.write_text(
            json.dumps({"mode_intent": {"signed_intent": {}, "resolution": {}}}),
            encoding="utf-8",
        )
        malformed_checkpoint = hook(registry)
        self.assertEqual(malformed_checkpoint.returncode, 2)
        self.assertIn("v2 mode_intent checkpoint", malformed_checkpoint.stderr)

        progress.write_text("{}\n", encoding="utf-8")

        outside_dir = self.root / "hook-outside"
        outside_dir.mkdir()
        outside = outside_dir / ".agents-registry.json"
        outside.write_text(registry.read_text(encoding="utf-8"), encoding="utf-8")
        outside_result = hook(outside)
        self.assertEqual(outside_result.returncode, 2)
        self.assertIn("project-root", outside_result.stderr)

        registry.unlink()
        registry.symlink_to(outside)
        for path in (registry, progress):
            with self.subTest(path=path.name, link="valid"):
                result = hook(path)
                self.assertEqual(result.returncode, 2)
                self.assertIn("symbolic link", result.stderr)

        registry.unlink()
        registry.symlink_to(self.root / "missing-registry.json")
        for path in (registry, progress):
            with self.subTest(path=path.name, link="dangling"):
                result = hook(path)
                self.assertEqual(result.returncode, 2)
                self.assertIn("symbolic link", result.stderr)

    def test_direct_sandbox_enforces_expected_provenance_before_creating_paths(self):
        registry, envelope, adapters = self._sandbox_inputs(self.repo)
        target = subprocess.run(
            [
                sys.executable, str(DISPATCH / "tool-catalog.py"), "target",
                "--registry", str(registry), "--adapters", str(adapters),
                "--target-id", "fixture-agent",
            ],
            cwd=self.repo,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        self.assertEqual(target.returncode, 0, target.stderr)
        provenance = json.loads(target.stdout)["execution_provenance_sha256"]

        rejected_workroot = self.root / "provenance-rejected-work"
        rejected_state = self.root / "provenance-rejected-state"
        rejected = subprocess.run(
            [
                "bash", str(DISPATCH / "sandbox-profile.sh"),
                "--agent", "fixture-agent", "--envelope", str(envelope),
                "--registry", str(registry), "--adapters", str(adapters),
                "--expected-provenance", "0" * 64,
                "--workroot", str(rejected_workroot), "--state", str(rejected_state),
            ],
            cwd=self.repo,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        self.assertEqual(rejected.returncode, 2, rejected.stderr)
        self.assertIn("provenance", rejected.stderr)
        self.assertFalse(rejected_workroot.exists(), rejected.stderr)
        self.assertFalse(rejected_state.exists(), rejected.stderr)

        accepted_workroot = self.root / "provenance-accepted-work"
        accepted_state = self.root / "provenance-accepted-state"
        accepted = subprocess.run(
            [
                "bash", str(DISPATCH / "sandbox-profile.sh"),
                "--agent", "fixture-agent", "--envelope", str(envelope),
                "--registry", str(registry), "--adapters", str(adapters),
                "--expected-provenance", provenance,
                "--workroot", str(accepted_workroot), "--state", str(accepted_state),
            ],
            cwd=self.repo,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        self.assertEqual(accepted.returncode, 0, accepted.stderr)
        self.assertEqual(json.loads(accepted.stdout)["outcome"], "RETURNED")

    def test_direct_sandbox_active_checkpoint_rejects_wrong_agent_and_provenance_early(self):
        registry, envelope, adapters = self._sandbox_inputs(self.repo)
        installed = self.root / "active-checkpoint-dispatch"
        shutil.copytree(DISPATCH, installed)
        resolver = installed / "resolve-active-mode-role.sh"
        write_executable(
            resolver,
            "#!/usr/bin/env bash\n"
            "set -euo pipefail\n"
            "expected=''\n"
            "while [ \"$#\" -gt 0 ]; do\n"
            "  case \"$1\" in\n"
            "    --expected-agent) expected=\"$2\"; shift 2 ;;\n"
            "    *) shift ;;\n"
            "  esac\n"
            "done\n"
            "if [ \"$expected\" != \"${HARNESS_ACTIVE_AGENT:?}\" ]; then\n"
            "  echo '[fixture active resolver] expected agent mismatch' >&2\n"
            "  exit 2\n"
            "fi\n"
            "printf '{\\\"execution_provenance_sha256\\\":\\\"%s\\\"}\\n' \"${HARNESS_ACTIVE_PROVENANCE:?}\"\n",
        )
        # The copied resolver is the trusted active-checkpoint boundary here;
        # a real signed v2 record is covered by its own resolver tests.  Its
        # presence exercises the sandbox's direct-entry recovery path.
        (self.repo / "progress.json").write_text(
            json.dumps({"mode_intent": {"signed_intent": {}, "resolution": {}}}),
            encoding="utf-8",
        )
        environment = {
            **os.environ,
            "HARNESS_ACTIVE_AGENT": "fixture-agent",
            "HARNESS_ACTIVE_PROVENANCE": "0" * 64,
        }

        wrong_agent_workroot = self.root / "active-wrong-agent-work"
        wrong_agent_state = self.root / "active-wrong-agent-state"
        wrong_agent = subprocess.run(
            [
                "bash", str(installed / "sandbox-profile.sh"),
                "--agent", "other-agent", "--envelope", str(envelope),
                "--registry", str(registry), "--adapters", str(adapters),
                "--workroot", str(wrong_agent_workroot), "--state", str(wrong_agent_state),
            ],
            cwd=self.repo,
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        self.assertEqual(wrong_agent.returncode, 2, wrong_agent.stderr)
        self.assertIn("expected agent mismatch", wrong_agent.stderr)
        self.assertFalse(wrong_agent_workroot.exists(), wrong_agent.stderr)
        self.assertFalse(wrong_agent_state.exists(), wrong_agent.stderr)

        provenance_workroot = self.root / "active-provenance-work"
        provenance_state = self.root / "active-provenance-state"
        provenance = subprocess.run(
            [
                "bash", str(installed / "sandbox-profile.sh"),
                "--agent", "fixture-agent", "--envelope", str(envelope),
                "--registry", str(registry), "--adapters", str(adapters),
                "--workroot", str(provenance_workroot), "--state", str(provenance_state),
            ],
            cwd=self.repo,
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        self.assertEqual(provenance.returncode, 2, provenance.stderr)
        self.assertIn("provenance", provenance.stderr)
        self.assertFalse(provenance_workroot.exists(), provenance.stderr)
        self.assertFalse(provenance_state.exists(), provenance.stderr)

    def test_direct_sandbox_rejects_catalog_to_adapter_drift_before_creating_paths(self):
        registry, envelope, adapters = self._sandbox_inputs(self.repo)
        installed = self.root / "adapter-drift-dispatch"
        shutil.copytree(DISPATCH, installed)
        real_catalog = installed / "tool_catalog_real.py"
        shutil.copy2(installed / "tool-catalog.py", real_catalog)
        catalog_wrapper = installed / "tool-catalog.py"
        catalog_wrapper.write_text(
            "import importlib.util\n"
            "import json\n"
            "import os\n"
            "import sys\n"
            "from pathlib import Path\n"
            "\n"
            "_real = Path(__file__).with_name('tool_catalog_real.py')\n"
            "_spec = importlib.util.spec_from_file_location('_fixture_real_catalog', _real)\n"
            "assert _spec is not None and _spec.loader is not None\n"
            "_module = importlib.util.module_from_spec(_spec)\n"
            "sys.modules[_spec.name] = _module\n"
            "_spec.loader.exec_module(_module)\n"
            "adapter_execution_contract_sha256 = _module.adapter_execution_contract_sha256\n"
            "\n"
            "if __name__ == '__main__':\n"
            "    exit_code = _module.main()\n"
            "    if exit_code == 0 and len(sys.argv) > 1 and sys.argv[1] == 'target':\n"
            "        adapter = Path(os.environ['HARNESS_DRIFT_ADAPTER'])\n"
            "        data = json.loads(adapter.read_text(encoding='utf-8'))\n"
            "        data['argv'] = ['bash', os.environ['HARNESS_DRIFT_EXECUTABLE'], '--drift']\n"
            "        adapter.write_text(json.dumps(data), encoding='utf-8')\n"
            "        Path(os.environ['HARNESS_DRIFT_MARKER']).write_text('changed', encoding='utf-8')\n"
            "    raise SystemExit(exit_code)\n",
            encoding="utf-8",
        )
        marker = self.root / "adapter-drift-marker"
        workroot = self.root / "adapter-drift-work"
        state = self.root / "adapter-drift-state"
        result = subprocess.run(
            [
                "bash", str(installed / "sandbox-profile.sh"),
                "--agent", "fixture-agent", "--envelope", str(envelope),
                "--registry", str(registry), "--adapters", str(adapters),
                "--workroot", str(workroot), "--state", str(state),
            ],
            cwd=self.repo,
            env={
                **os.environ,
                "HARNESS_DRIFT_ADAPTER": str(adapters / "fixture.json"),
                "HARNESS_DRIFT_EXECUTABLE": str(self.root / "fake-cli.sh"),
                "HARNESS_DRIFT_MARKER": str(marker),
            },
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertTrue(marker.exists(), result.stderr)
        self.assertIn("execution contract", result.stderr)
        self.assertFalse(workroot.exists(), result.stderr)
        self.assertFalse(state.exists(), result.stderr)

    def test_integration_sandbox_run_meta_uses_generated_target_id(self):
        registry, envelope, adapters = self._sandbox_inputs(self.repo)
        registry.write_text(json.dumps({
            "version": "tool-integrations/1",
            "integrations": [{
                "id": "fixture",
                "tool": "fixture",
                "label": "Fixture",
                "model_family": "fixture",
                "priority": 100,
                "capabilities": [],
                "local_cli": {
                    "adapter": "fixture",
                    "sandbox": {
                        "home_dir": str(self.root / "safe-home"),
                        "env_allow": [],
                    },
                    "timeout_s": 90,
                },
            }],
            "a2a_targets": [],
        }), encoding="utf-8")
        workroot = self.root / "integration-work"
        state = self.root / "integration-state"
        result = subprocess.run([
            "bash", str(DISPATCH / "sandbox-profile.sh"),
            "--integration", "fixture",
            "--envelope", str(envelope),
            "--registry", str(registry),
            "--adapters", str(adapters),
            "--workroot", str(workroot),
            "--state", str(state),
        ], cwd=self.repo, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        meta = json.loads(result.stdout)
        self.assertEqual(meta["agent_id"], "local-cli--fixture--evaluator")
        persisted = json.loads((state / "run-meta-lifecycle-fixture.json").read_text())
        self.assertEqual(persisted["agent_id"], meta["agent_id"])

    def test_integration_sandbox_active_checkpoint_rejects_derived_target_bypass_early(self):
        registry, envelope, adapters = self._sandbox_inputs(self.repo)
        registry.write_text(json.dumps({
            "version": "tool-integrations/1",
            "integrations": [{
                "id": "fixture",
                "tool": "fixture",
                "model_family": "fixture",
                "local_cli": {
                    "adapter": "fixture",
                    "sandbox": {"home_dir": str(self.root / "safe-home"), "env_allow": []},
                    "timeout_s": 90,
                },
            }],
            "a2a_targets": [],
        }), encoding="utf-8")
        installed = self.root / "integration-active-dispatch"
        shutil.copytree(DISPATCH, installed)
        write_executable(
            installed / "resolve-active-mode-role.sh",
            "#!/usr/bin/env bash\n"
            "set -euo pipefail\n"
            "expected=''\n"
            "while [ \"$#\" -gt 0 ]; do\n"
            "  case \"$1\" in\n"
            "    --expected-agent) expected=\"$2\"; shift 2 ;;\n"
            "    *) shift ;;\n"
            "  esac\n"
            "done\n"
            "if [ \"$expected\" != \"${HARNESS_ACTIVE_AGENT:?}\" ]; then\n"
            "  echo '[fixture active resolver] expected agent mismatch' >&2\n"
            "  exit 2\n"
            "fi\n"
            "printf '{\\\"execution_provenance_sha256\\\":\\\"%s\\\"}\\n' \"${HARNESS_ACTIVE_PROVENANCE:?}\"\n",
        )
        (self.repo / "progress.json").write_text(
            json.dumps({"mode_intent": {"signed_intent": {}, "resolution": {}}}),
            encoding="utf-8",
        )

        def invoke(suffix, environment):
            workroot = self.root / f"integration-active-{suffix}-work"
            state = self.root / f"integration-active-{suffix}-state"
            result = subprocess.run(
                [
                    "bash", str(installed / "sandbox-profile.sh"),
                    "--integration", "fixture", "--envelope", str(envelope),
                    "--registry", str(registry), "--adapters", str(adapters),
                    "--workroot", str(workroot), "--state", str(state),
                ],
                cwd=self.repo,
                env=environment,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertFalse(workroot.exists(), result.stderr)
            self.assertFalse(state.exists(), result.stderr)
            return result

        wrong_target = invoke("wrong-target", {
            **os.environ,
            "HARNESS_ACTIVE_AGENT": "local-cli--other--evaluator",
            "HARNESS_ACTIVE_PROVENANCE": "0" * 64,
        })
        self.assertIn("expected agent mismatch", wrong_target.stderr)

        wrong_provenance = invoke("wrong-provenance", {
            **os.environ,
            "HARNESS_ACTIVE_AGENT": "local-cli--fixture--evaluator",
            "HARNESS_ACTIVE_PROVENANCE": "0" * 64,
        })
        self.assertIn("provenance", wrong_provenance.stderr)

    def test_assignments_accept_canonical_targets_and_coordinator_planner(self):
        adapters = self.root / "assignment-adapters"
        adapters.mkdir()
        safe_home = self.root / "assignment-home"
        safe_home.mkdir()
        for name, family in (("generator", "generator-family"), ("evaluator", "evaluator-family")):
            (adapters / f"{name}.json").write_text(json.dumps({
                "name": name,
                "tool": f"{name}-cli",
                "model_family": family,
                "argv": ["true"],
                "envelope_delivery": "stdin",
                "_verified": True,
            }), encoding="utf-8")
        registry = self.root / "assignments-registry.json"
        registry.write_text(json.dumps({
            "version": "tool-integrations/1",
            "integrations": [
                {
                    "id": "generator",
                    "tool": "generator-cli",
                    "model_family": "generator-family",
                    "local_cli": {
                        "adapter": "generator",
                        "sandbox": {"home_dir": str(safe_home)},
                    },
                },
                {
                    "id": "evaluator",
                    "tool": "evaluator-cli",
                    "model_family": "evaluator-family",
                    "local_cli": {
                        "adapter": "evaluator",
                        "sandbox": {"home_dir": str(safe_home)},
                    },
                },
            ],
            "a2a_targets": [{
                "id": "evaluator-remote",
                "integration_id": "evaluator",
                "remote_runner_id": "evaluator-runner",
                "endpoint": "https://evaluator.invalid/a2a",
            }],
        }), encoding="utf-8")
        progress = self.root / "assignments-progress.json"
        progress.write_text(json.dumps({
            "role_assignments": {
                "planner": None,
                "generator": "local-cli--generator--generator",
                "evaluator": "a2a--evaluator-remote--evaluator",
            },
        }), encoding="utf-8")
        result = subprocess.run([
            "bash", str(VALIDATOR), "assignments", str(progress), str(registry),
            "--adapters", str(adapters),
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("family 互斥成立", result.stdout)

        data = json.loads(registry.read_text(encoding="utf-8"))
        data["integrations"][1]["model_family"] = "generator-family"
        (adapters / "evaluator.json").write_text(json.dumps({
            **json.loads((adapters / "evaluator.json").read_text(encoding="utf-8")),
            "model_family": "generator-family",
        }), encoding="utf-8")
        registry.write_text(json.dumps(data), encoding="utf-8")
        invalid = subprocess.run([
            "bash", str(VALIDATOR), "assignments", str(progress), str(registry),
            "--adapters", str(adapters),
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.assertEqual(invalid.returncode, 2)
        self.assertIn("同为", invalid.stdout)

    def test_direct_sandbox_malicious_agent_and_registry_text_never_execute_shell(self):
        registry, envelope, adapters = self._sandbox_inputs(self.repo)
        marker = self.root / "sandbox-eval-injection-marker"
        malicious_agent = f'fixture-agent"; touch {marker}; #'
        result = subprocess.run([
            "bash", str(DISPATCH / "sandbox-profile.sh"),
            "--agent", malicious_agent,
            "--envelope", str(envelope),
            "--registry", str(registry),
            "--adapters", str(adapters),
        ], cwd=self.repo, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertFalse(marker.exists(), result.stderr)

        data = json.loads(registry.read_text(encoding="utf-8"))
        data["agents"][0]["transport"] = f'local-cli"; touch {marker}; #'
        registry.write_text(json.dumps(data), encoding="utf-8")
        result = subprocess.run([
            "bash", str(DISPATCH / "sandbox-profile.sh"),
            "--agent", "fixture-agent",
            "--envelope", str(envelope),
            "--registry", str(registry),
            "--adapters", str(adapters),
        ], cwd=self.repo, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertFalse(marker.exists(), result.stderr)

    def test_repo_match_and_script_relative_defaults_work_cross_cwd(self):
        installed = self.root / "installed-dispatch"
        shutil.copytree(DISPATCH, installed)
        registry, envelope, _unused = self._sandbox_inputs(self.repo)
        fake = self.root / "fake-cli.sh"
        adapters = installed / "transports" / "adapters"
        (adapters / "fixture.json").write_text(json.dumps({
            "name": "fixture",
            "model_family": "fixture",
            "argv": ["bash", str(fake)],
            "envelope_delivery": "stdin",
            "_verified": True,
            "artifact_relpath": "artifact.json",
        }), encoding="utf-8")
        workroot = self.root / "work-match"
        state = self.root / "state-match"
        result = subprocess.run([
            "bash", str(installed / "dispatch-run.sh"),
            "--agent", "fixture-agent",
            "--envelope", str(envelope),
            "--registry", str(registry),
            "--workroot", str(workroot),
            "--state", str(state),
        ], cwd=self.repo, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        meta = json.loads(result.stdout)
        self.assertEqual(meta["outcome"], "RETURNED")
        self.assertEqual(meta["effective_timeout_s"], 60)
        self.assertEqual(meta["descriptor_timeout_s"], 90)

    def test_direct_sandbox_term_is_external_cancel_and_reaps_tree(self):
        registry, envelope, adapters = self._sandbox_inputs(self.repo)
        pids_path = self.root / "sandbox-cancel-pids.json"
        tree = self.root / "sandbox-tree.py"
        tree.write_text(
            "import json, os, signal, subprocess, sys, time\n"
            "if sys.argv[1] == 'child':\n"
            " signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
            " while True: time.sleep(1)\n"
            "signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
            "child = subprocess.Popen([sys.executable, __file__, 'child', sys.argv[2]])\n"
            "open(sys.argv[2], 'w').write(json.dumps([os.getpid(), child.pid]))\n"
            "while True: time.sleep(1)\n",
            encoding="utf-8",
        )
        (adapters / "fixture.json").write_text(json.dumps({
            "name": "fixture",
            "model_family": "fixture",
            "argv": [sys.executable, str(tree), "parent", str(pids_path)],
            "envelope_delivery": "stdin",
            "_verified": True,
            "artifact_relpath": "artifact.json",
        }), encoding="utf-8")
        workroot = self.root / "cancel-work"
        state = self.root / "cancel-state"
        proc = subprocess.Popen([
            "bash", str(DISPATCH / "sandbox-profile.sh"),
            "--agent", "fixture-agent",
            "--envelope", str(envelope),
            "--registry", str(registry),
            "--adapters", str(adapters),
            "--workroot", str(workroot),
            "--state", str(state),
        ], cwd=self.repo, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.assertTrue(wait_until(pids_path.exists))
        pids = json.loads(pids_path.read_text())
        proc.send_signal(signal.SIGTERM)
        stdout, stderr = proc.communicate(timeout=7)
        self.assertEqual(proc.returncode, 143, stderr)
        meta = json.loads(stdout)
        self.assertEqual(meta["outcome"], "CANCELED")
        self.assertEqual(meta["termination_reason"], "external_signal")
        assert_pids_gone(self, pids)

    @unittest.skip(
        "strict external same-session execution is unavailable until a VM/ephemeral-principal provider is integrated"
    )
    def test_subagent_bridge_term_reaps_the_outer_acp_process_group(self):
        """The trusted timeout group must reap a contained ACP child tree."""
        registry, envelope, _unused_adapters = self._sandbox_inputs(self.repo)
        fake_bin = self.root / "fake-kimi-bin"
        fake_bin.mkdir()
        workroot = self.root / "kimi-cancel-work"
        pids_filename = "kimi-acp-pids.json"
        # The contained fake vendor may publish test PIDs only in its current
        # task worktree, never in the shared coordinator workroot.
        fake_kimi = fake_bin / "kimi"
        write_executable(
            fake_kimi,
            "#!/usr/bin/env python3\n"
            "import json, os, signal, subprocess, sys, time\n"
            "if sys.argv[1:] != ['acp']:\n"
            " raise SystemExit(64)\n"
            "child = subprocess.Popen([sys.executable, '-c', "
            "'import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); "
            "\\nwhile True: time.sleep(1)'])\n"
            f"open({pids_filename!r}, 'w').write(json.dumps([os.getpid(), child.pid]))\n"
            "request = json.loads(sys.stdin.readline())\n"
            "print(json.dumps({'jsonrpc':'2.0','id':request['id'],"
            "'result':{'protocolVersion':1}}), flush=True)\n"
            "while True: time.sleep(1)\n",
        )
        registry.write_text(json.dumps({
            "version": "tool-integrations/1",
            "integrations": [{
                "id": "kimi",
                "tool": "kimi",
                "model_family": "kimi",
                "local_cli": {
                    "adapter": "kimi",
                    "sandbox": {"home_dir": str(self.root / "safe-home"), "env_allow": []},
                    "timeout_s": 60,
                },
                "subagent": {"bridge": "kimi-acp-native-agent"},
            }],
            "a2a_targets": [],
        }), encoding="utf-8")
        state = self.root / "kimi-cancel-state"
        proc = subprocess.Popen([
            "bash", str(DISPATCH / "sandbox-profile.sh"),
            "--agent", "subagent--kimi--evaluator",
            "--envelope", str(envelope),
            "--registry", str(registry),
            "--workroot", str(workroot),
            "--state", str(state),
        ], cwd=self.repo, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env={
            **os.environ,
            "PATH": str(fake_bin) + os.pathsep + os.environ.get("PATH", ""),
        })
        pids: list[int] = []
        try:
            pids_path = wait_until(
                lambda: next(workroot.glob(f"*/{pids_filename}"), None)
            )
            self.assertIsNotNone(pids_path)
            assert pids_path is not None
            pids = json.loads(pids_path.read_text())
            proc.send_signal(signal.SIGTERM)
            stdout, stderr = proc.communicate(timeout=7)
            self.assertEqual(proc.returncode, 143, stderr)
            meta = json.loads(stdout)
            self.assertEqual(meta["outcome"], "CANCELED")
            self.assertEqual(meta["termination_reason"], "external_signal")
            assert_pids_gone(self, pids)
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait(timeout=2)
            # Keep a failing regression self-cleaning while never addressing
            # anything except PIDs created by this exact fixture.
            for pid in pids:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass

    @unittest.skip(
        "strict external same-session execution is unavailable until a VM/ephemeral-principal provider is integrated"
    )
    def test_subagent_bridge_persists_only_a_child_receipt_and_blocks_checkout_writes(self):
        """A contained bridge cannot write the main checkout or retain raw ACP state."""
        registry, envelope, _unused_adapters = self._sandbox_inputs(self.repo)
        fake_bin = self.root / "private-kimi-bin"
        fake_bin.mkdir()
        source_kimi_home = self.root / "source-kimi-home"
        (source_kimi_home / "credentials").mkdir(parents=True)
        (source_kimi_home / "credentials" / "token.json").write_text('{"token":"fixture"}', encoding="utf-8")
        (source_kimi_home / "sessions").mkdir()
        fake_kimi = fake_bin / "kimi"
        raw_child_call_id = "vendor child call id"
        escape_marker = self.repo / "seatbelt-escape-marker.txt"
        workroot = self.root / "private-kimi-work"
        sibling_marker = workroot / "seatbelt-sibling-marker.txt"
        write_executable(
            fake_kimi,
            "#!/usr/bin/env python3\n"
            "import json, os, pathlib, re, subprocess, sys\n"
            f"RAW_ID = {raw_child_call_id!r}\n"
            "for line in sys.stdin:\n"
            " request = json.loads(line); method = request.get('method'); ident = request['id']\n"
            " if method == 'initialize':\n"
            "  result = {'protocolVersion': 1}\n"
            " elif method == 'session/new':\n"
            "  result = {'sessionId': 'session-fixture'}\n"
            " elif method == 'session/set_config_option':\n"
            "  result = {}\n"
            " elif method == 'session/prompt':\n"
            "  prompt = request['params']['prompt'][0]['text']\n"
            "  nonce = re.search(r'harness-child:([0-9a-f]{32})', prompt).group(1)\n"
            "  state = pathlib.Path(os.environ['KIMI_CODE_HOME'])\n"
            "  (state / 'raw-acp-id.log').write_text(RAW_ID, encoding='utf-8')\n"
            f"  escape_marker = pathlib.Path({str(escape_marker)!r})\n"
            "  try:\n"
            "   escape_marker.write_text('must be denied', encoding='utf-8')\n"
            "  except OSError:\n"
            "   pass\n"
            f"  sibling_marker = pathlib.Path({str(sibling_marker)!r})\n"
            "  try:\n"
            "   sibling_marker.write_text('must be denied', encoding='utf-8')\n"
            "  except OSError:\n"
            "   pass\n"
            "  try:\n"
            f"   subprocess.run(['git', '-C', {str(self.repo)!r}, 'config', 'harness.seatbelt_escape', 'must-be-denied'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)\n"
            "  except OSError:\n"
            "   pass\n"
            "  escape_link = pathlib.Path.cwd() / 'bridge-escape-link'\n"
            "  try:\n"
            "   escape_link.unlink(missing_ok=True)\n"
            "   escape_link.symlink_to(escape_marker)\n"
            "   escape_link.write_text('must also be denied', encoding='utf-8')\n"
            "  except OSError:\n"
            "   pass\n"
            "  finally:\n"
            "   escape_link.unlink(missing_ok=True)\n"
            "  artifact = pathlib.Path(os.environ['HARNESS_ARTIFACT'])\n"
            "  artifact.parent.mkdir(parents=True, exist_ok=True); artifact.write_text('{\\\"ok\\\":true}\\n', encoding='utf-8')\n"
            "  updates = [\n"
            "   {'sessionUpdate':'tool_call','toolCallId':RAW_ID,'status':'pending','title':'Agent'},\n"
            "   {'sessionUpdate':'tool_call_update','toolCallId':RAW_ID,'status':'in_progress','rawInput':{'description':'harness-child:' + nonce,'subagent_type':'coder'}},\n"
            "   {'sessionUpdate':'tool_call_update','toolCallId':RAW_ID,'status':'completed'}]\n"
            "  for update in updates: print(json.dumps({'jsonrpc':'2.0','method':'session/update','params':{'sessionId':'session-fixture','update':update}}), flush=True)\n"
            "  result = {'stopReason': 'end_turn'}\n"
            " else: raise SystemExit(64)\n"
            " print(json.dumps({'jsonrpc':'2.0','id':ident,'result':result}), flush=True)\n"
            " if method == 'session/prompt': break\n",
        )
        registry.write_text(json.dumps({
            "version": "tool-integrations/1",
            "integrations": [{
                "id": "kimi",
                "tool": "kimi",
                "model_family": "kimi",
                "local_cli": {
                    "adapter": "kimi",
                    "sandbox": {
                        "home_dir": str(self.root / "safe-home"),
                        "env_set": {"KIMI_CODE_HOME": str(source_kimi_home)},
                        "env_allow": [],
                    },
                    "timeout_s": 60,
                },
                "subagent": {"bridge": "kimi-acp-native-agent"},
            }],
            "a2a_targets": [],
        }), encoding="utf-8")
        state = self.root / "private-kimi-state"
        main_status_before = subprocess.check_output(
            ["git", "-C", str(self.repo), "status", "--porcelain=v1"], text=True
        )
        main_head_before = subprocess.check_output(
            ["git", "-C", str(self.repo), "rev-parse", "HEAD"], text=True
        ).strip()
        result = subprocess.run([
            "bash", str(DISPATCH / "sandbox-profile.sh"),
            "--agent", "subagent--kimi--evaluator",
            "--envelope", str(envelope),
            "--registry", str(registry),
            "--workroot", str(workroot),
            "--state", str(state),
        ], cwd=self.repo, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env={
            **os.environ,
            "PATH": str(fake_bin) + os.pathsep + os.environ.get("PATH", ""),
        })
        self.assertEqual(result.returncode, 0, result.stderr)
        meta = json.loads(result.stdout)
        expected_token = hashlib.sha256(raw_child_call_id.encode("utf-8")).hexdigest()
        self.assertEqual(meta["outcome"], "RETURNED")
        self.assertEqual(meta["bridge"]["child_call_id"], expected_token)
        run_meta = (state / "run-meta-lifecycle-fixture.json").read_text(encoding="utf-8")
        log = Path(meta["log"]).read_text(encoding="utf-8")
        self.assertNotIn(raw_child_call_id, run_meta)
        self.assertNotIn(raw_child_call_id, log)
        self.assertFalse((state / "bridge-lifecycle-fixture.json").exists())
        self.assertFalse((source_kimi_home / "raw-acp-id.log").exists())
        self.assertEqual(list(state.glob("bridge-state-*")), [])
        self.assertEqual(list(workroot.glob(".bridge-runtime-lifecycle-fixture.*")), [])
        self.assertFalse(escape_marker.exists())
        self.assertFalse(sibling_marker.exists())
        self.assertNotEqual(
            subprocess.run(
                ["git", "-C", str(self.repo), "config", "--local", "--get", "harness.seatbelt_escape"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            ).returncode,
            0,
        )
        self.assertEqual(
            subprocess.check_output(
                ["git", "-C", str(self.repo), "status", "--porcelain=v1"], text=True
            ),
            main_status_before,
        )
        self.assertEqual(
            subprocess.check_output(
                ["git", "-C", str(self.repo), "rev-parse", "HEAD"], text=True
            ).strip(),
            main_head_before,
        )


class ProcessTimeoutTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.fixture = self.root / "tree.py"
        self.fixture.write_text(
            "import json, os, signal, subprocess, sys, time\n"
            "mode, path = sys.argv[1:3]\n"
            "if mode == 'child':\n"
            "    signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
            "    while True: time.sleep(1)\n"
            "signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
            "child = subprocess.Popen([sys.executable, __file__, 'child', path])\n"
            "open(path, 'w').write(json.dumps([os.getpid(), child.pid]))\n"
            "while True: time.sleep(1)\n",
            encoding="utf-8",
        )

    def tearDown(self):
        self.temp.cleanup()

    def _tree_command(self, pids):
        return [sys.executable, str(self.fixture), "parent", str(pids)]

    def test_normal_exit_is_propagated(self):
        status = self.root / "normal-status.json"
        result = subprocess.run([
            sys.executable, str(TIMEOUT), "--timeout", "2", "--status-file", str(status), "--",
            sys.executable, "-c", "raise SystemExit(7)",
        ])
        self.assertEqual(result.returncode, 7)
        self.assertEqual(json.loads(status.read_text())["reason"], "process_exit")

        child_124 = self.root / "child-124-status.json"
        result = subprocess.run([
            sys.executable, str(TIMEOUT), "--timeout", "2",
            "--status-file", str(child_124), "--",
            sys.executable, "-c", "raise SystemExit(124)",
        ])
        self.assertEqual(result.returncode, 124)
        self.assertEqual(json.loads(child_124.read_text())["reason"], "process_exit")

    def test_timeout_reaps_parent_and_grandchild(self):
        pids_path = self.root / "timeout-pids.json"
        result = subprocess.run([
            sys.executable, str(TIMEOUT), "--timeout", "1", "--term-grace", "0.1", "--",
            *self._tree_command(pids_path),
        ])
        self.assertEqual(result.returncode, 124)
        pids = json.loads(pids_path.read_text())
        assert_pids_gone(self, pids)

    @unittest.skipUnless(os.name == "posix", "requires POSIX process inspection")
    def test_descendant_reaper_never_resolves_ps_from_path_or_cwd(self):
        """A vendor-controlled worktree or PATH cannot replace the reaper's ps."""
        fake_bin = self.root / "fake-bin"
        fake_bin.mkdir()
        marker = self.root / "fake-ps-ran"
        fake_ps = fake_bin / "ps"
        write_executable(
            fake_ps,
            "#!/bin/sh\n"
            f"printf forged > {str(marker)!r}\n",
        )
        prior_cwd = os.getcwd()
        try:
            os.chdir(fake_bin)
            with mock.patch.dict(
                os.environ,
                {"PATH": "." + os.pathsep + str(fake_bin)},
                clear=False,
            ):
                groups = timeout_helper._separate_descendant_groups(os.getpid())
        finally:
            os.chdir(prior_cwd)
        self.assertIsInstance(groups, set)
        self.assertFalse(marker.exists(), "process-timeout must use an absolute trusted ps")

    def test_timeout_rejects_a_missing_trusted_working_directory(self):
        result = subprocess.run(
            [
                sys.executable,
                str(TIMEOUT),
                "--timeout",
                "2",
                "--cwd",
                str(self.root / "missing-cwd"),
                "--",
                sys.executable,
                "-c",
                "pass",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("--cwd must name an existing directory", result.stderr)

    def test_external_term_is_not_reported_as_timeout(self):
        pids_path = self.root / "external-pids.json"
        proc = subprocess.Popen([
            sys.executable, str(TIMEOUT), "--timeout", "30", "--term-grace", "0.1", "--",
            *self._tree_command(pids_path),
        ])
        self.assertTrue(wait_until(pids_path.exists))
        pids = json.loads(pids_path.read_text())
        proc.send_signal(signal.SIGTERM)
        self.assertEqual(proc.wait(timeout=4), 143)
        assert_pids_gone(self, pids)

    @unittest.skipUnless(os.name == "posix", "requires POSIX process groups")
    def test_external_cancel_reaps_a_descendant_that_started_its_own_session(self):
        pids_path = self.root / "detached-pids.json"
        detached = self.root / "detached-tree.py"
        detached.write_text(
            "import json, os, signal, subprocess, sys, time\n"
            "if sys.argv[1] == 'child':\n"
            " signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
            " while True: time.sleep(1)\n"
            "signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
            "child = subprocess.Popen([sys.executable, __file__, 'child'], start_new_session=True)\n"
            "open(sys.argv[2], 'w').write(json.dumps([os.getpid(), child.pid]))\n"
            "while True: time.sleep(1)\n",
            encoding="utf-8",
        )
        proc = subprocess.Popen([
            sys.executable, str(TIMEOUT), "--timeout", "60", "--term-grace", "0.1", "--",
            sys.executable, str(detached), "parent", str(pids_path),
        ])
        pids: list[int] = []
        try:
            self.assertTrue(wait_until(pids_path.exists))
            pids = json.loads(pids_path.read_text())
            proc.send_signal(signal.SIGTERM)
            self.assertEqual(proc.wait(timeout=4), 143)
            assert_pids_gone(self, pids)
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait(timeout=2)
            # A failed regression must only clean exact fixture PIDs.
            for pid in pids:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass

    def test_injected_wall_clock_simulates_suspend_gap(self):
        pids_path = self.root / "clock-pids.json"
        clock = self.root / "clock"
        clock.write_text("100\n")
        proc = subprocess.Popen([
            sys.executable, str(TIMEOUT), "--timeout", "60", "--term-grace", "0.1",
            "--clock-file", str(clock), "--", *self._tree_command(pids_path),
        ])
        self.assertTrue(wait_until(pids_path.exists))
        pids = json.loads(pids_path.read_text())
        clock.write_text("160\n")
        self.assertEqual(proc.wait(timeout=4), 124)
        assert_pids_gone(self, pids)


class RunnerFixture:
    def __init__(self, testcase, *, idle_exit=0.0, seed_working=False):
        probe = socket.socket()
        try:
            probe.bind(("127.0.0.1", 0))
        except PermissionError:
            probe.close()
            testcase.skipTest("managed sandbox denies loopback binds; runner-core tests remain active")
        finally:
            probe.close()
        self.testcase = testcase
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.state = self.root / "state"
        self.workroot = self.root / "work"
        self.registry = self.root / ".agents-registry.json"
        self.registry.write_text(json.dumps({
            "version": "dispatch/1",
            "agents": [{
                "id": "fixture-agent",
                "roles": ["evaluator"],
                "transport": "local-cli",
                "adapter": "fixture",
                "model_family": "fixture",
                "constraints": {"l2": False, "write_src": False, "push": False},
                "sandbox": {"home_dir": str(self.root / "home")},
                "timeout_s": 60,
            }],
        }), encoding="utf-8")
        self.validator = self.root / "validator.sh"
        write_executable(
            self.validator,
            "#!/usr/bin/env bash\n"
            "if [ \"${1:-}\" = receipt ]; then printf '{\"state\":\"COMPLETED\"}\\n'; fi\n"
            "exit 0\n",
        )
        self.slow_child = self.root / "slow-child.py"
        self.slow_child.write_text(
            "import signal, time\n"
            "signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
            "while True: time.sleep(1)\n",
            encoding="utf-8",
        )
        self.fake_python = self.root / "fake-sandbox.py"
        self.fake_python.write_text(
            "import json, os, signal, subprocess, sys, time\n"
            "args = sys.argv[1:]\n"
            "env_path = args[args.index('--envelope') + 1]\n"
            "root = sys.argv[0].rsplit('/', 1)[0]\n"
            "env = json.load(open(env_path))\n"
            "tid = env['task_id']\n"
            "open(os.path.join(root, 'count-' + tid), 'a').write('1\\n')\n"
            "if env.get('contract') == 'slow':\n"
            "    signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
            "    child = subprocess.Popen([sys.executable, os.path.join(root, 'slow-child.py')])\n"
            "    open(os.path.join(root, 'pids-' + tid + '.json'), 'w').write(json.dumps([os.getpid(), child.pid]))\n"
            "    while True: time.sleep(1)\n"
            "artifact = os.path.join(root, 'artifact-' + tid + '.json')\n"
            "json.dump({'waiting': None, 'task': tid}, open(artifact, 'w'))\n"
            "print(json.dumps({'task_id': tid, 'agent_id': 'fixture-agent', 'adapter': 'fixture', "
            "'model_family': 'fixture', 'batch': env['batch'], 'ref': env['repo']['ref'], "
            "'worktree': root, 'artifact': artifact, 'log': '', 'outcome': 'RETURNED', "
            "'exit_code': 0, 'duration_s': 0}))\n",
            encoding="utf-8",
        )
        self.sandbox = self.root / "sandbox.sh"
        write_executable(
            self.sandbox,
            f"#!/usr/bin/env bash\nexec {sys.executable!r} {str(self.fake_python)!r} \"$@\"\n",
        )
        (self.root / "adapters").mkdir()
        if seed_working:
            tasks = self.state / "tasks"
            tasks.mkdir(parents=True)
            (tasks / "restart-task.json").write_text(json.dumps({
                "taskId": "restart-task",
                "state": "WORKING",
                "agent": "fixture-agent",
                "batch": "BL-FIXTURE",
                "role": "evaluator",
                "submitted_at": "2026-07-27T00:00:00Z",
                "started_at": "2026-07-27T00:00:01Z",
            }), encoding="utf-8")
            (tasks / "restart-task.events.jsonl").write_text(
                json.dumps({"seq": 1, "kind": "status", "payload": {"state": "SUBMITTED"}}) + "\n"
                + json.dumps({"seq": 2, "kind": "status", "payload": {"state": "WORKING"}}) + "\n",
                encoding="utf-8",
            )
        command = [
            sys.executable, str(RUNNER),
            "--registry", str(self.registry),
            "--project-root", str(self.root),
            "--agent", "fixture-agent",
            "--port", "0",
            "--state", str(self.state),
            "--workroot", str(self.workroot),
            "--sandbox", str(self.sandbox),
            "--validator", str(self.validator),
            "--adapters", str(self.root / "adapters"),
            "--sse-heartbeat", "0.05",
            "--sse-timeout", "5",
            "--cancel-grace", "2.25",
            "--shutdown-timeout", "5",
            "--drain-timeout", "0.4",
            "--idle-exit", str(idle_exit),
        ]
        self.proc = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,
        )
        pidfile = self.state / "runner.pid"
        ready = wait_until(lambda: pidfile.exists() and pidfile.stat().st_size > 0)
        if not ready:
            out, err = self.proc.communicate(timeout=1)
            testcase.fail(f"runner did not start: {out} {err}")
        self.pid_record = json.loads(pidfile.read_text())
        self.port = self.pid_record["port"]

    def envelope(self, tid, contract="normal"):
        return {
            "task_id": tid,
            "contract_version": "harness/1.1",
            "batch": "BL-FIXTURE",
            "role": "evaluator",
            "repo": {"url": str(self.root), "ref": "1234567"},
            "l2_authorized": False,
            "contract": contract,
            "deliverable": {"artifact": "artifact.json", "schema": "schema.json"},
        }

    def rpc(self, method, params, timeout=3.0):
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/",
            data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method,
                             "params": params}).encode(),
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            result = json.loads(response.read())
        if "error" in result:
            raise RuntimeError(result["error"])
        return result["result"]

    def send(self, tid, contract="normal"):
        return self.rpc("SendMessage", {"envelope": self.envelope(tid, contract)})

    def wait_terminal(self, tid):
        return wait_until(
            lambda: (lambda rec: rec if rec.get("state") in {
                "COMPLETED", "FAILED", "CANCELED", "REJECTED",
            } else None)(self.rpc("GetTask", {"taskId": tid})),
            timeout=4,
        )

    def events(self, tid):
        path = self.state / "tasks" / f"{tid}.events.jsonl"
        return [json.loads(line) for line in path.read_text().splitlines()]

    def sse(self, tid, last=0):
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/",
            data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "SubscribeToTask",
                             "params": {"taskId": tid}}).encode(),
            method="POST",
            headers={"Content-Type": "application/json", "Accept": "text/event-stream",
                     "Last-Event-ID": str(last)},
        )
        with urllib.request.urlopen(request, timeout=3) as response:
            return response.read().decode()

    def close(self):
        if self.proc.poll() is None:
            self.proc.send_signal(signal.SIGTERM)
            try:
                self.proc.wait(timeout=4)
            except subprocess.TimeoutExpired:
                os.killpg(self.proc.pid, signal.SIGKILL)
                self.proc.wait(timeout=2)
        self.proc.communicate()
        self.temp.cleanup()


class A2ALifecycleTests(unittest.TestCase):
    def setUp(self):
        self.runner = RunnerFixture(self)

    def tearDown(self):
        self.runner.close()

    def test_terminal_order_sse_replay_and_task_id_dedupe(self):
        self.runner.send("normal-task")
        record = self.runner.wait_terminal("normal-task")
        self.assertEqual(record["state"], "COMPLETED")
        self.assertTrue(record["events_complete"])
        self.assertTrue(record.get("finished_at"))
        events = self.runner.events("normal-task")
        self.assertEqual(
            [(event["kind"], event["payload"].get("state")) for event in events],
            [("status", "SUBMITTED"), ("status", "WORKING"),
             ("artifact", None), ("status", "COMPLETED")],
        )
        replay = self.runner.sse("normal-task", last=2)
        self.assertNotIn("id: 1\n", replay)
        self.assertNotIn("id: 2\n", replay)
        self.assertIn("id: 3\n", replay)
        self.assertIn("id: 4\n", replay)
        self.assertIn("event: done", replay)

        duplicate = self.runner.send("normal-task")
        self.assertTrue(duplicate["deduplicated"])
        count = (self.runner.root / "count-normal-task").read_text().splitlines()
        self.assertEqual(len(count), 1)

    def test_runner_rejects_a2a_generator_before_sandbox_execution(self):
        envelope = self.runner.envelope("generator-task")
        envelope["role"] = "generator"
        with self.assertRaisesRegex(RuntimeError, "a2a generator is disabled"):
            self.runner.rpc("SendMessage", {"envelope": envelope})
        self.assertFalse((self.runner.root / "count-generator-task").exists())

    def test_cancel_and_duplicate_cancel_are_one_terminal_sequence(self):
        self.runner.send("cancel-task", "slow")
        pids_path = self.runner.root / "pids-cancel-task.json"
        self.assertTrue(wait_until(pids_path.exists))
        pids = json.loads(pids_path.read_text())
        first = self.runner.rpc("CancelTask", {"taskId": "cancel-task"})
        second = self.runner.rpc("CancelTask", {"taskId": "cancel-task"})
        self.assertEqual(first["state"], "CANCELED")
        self.assertEqual(second["state"], "CANCELED")
        self.assertEqual(first["finished_at"], second["finished_at"])
        self.assertTrue(second["deduplicated"])
        states = [event["payload"].get("state") for event in self.runner.events("cancel-task")]
        self.assertEqual(states.count("CANCELED"), 1)
        self.assertEqual(states, ["SUBMITTED", "WORKING", "CANCELED"])
        assert_pids_gone(self, pids)

    def test_active_stop_persists_cancel_during_drain_and_cleans_pidfile(self):
        self.runner.send("stop-task", "slow")
        pids_path = self.runner.root / "pids-stop-task.json"
        self.assertTrue(wait_until(pids_path.exists))
        pids = json.loads(pids_path.read_text())
        stop = subprocess.Popen([
            sys.executable, str(RUNNER),
            "--agent", "fixture-agent",
            "--state", str(self.runner.state),
            "--shutdown-timeout", "2",
            "--drain-timeout", "0.4",
            "--stop",
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

        observed = None
        # The runner deliberately gives the sandbox 2.25s to forward TERM and
        # reap its nested CLI group before publishing CANCELED.
        deadline = time.monotonic() + 3.5
        while time.monotonic() < deadline and stop.poll() is None:
            try:
                candidate = self.runner.rpc("GetTask", {"taskId": "stop-task"}, timeout=0.2)
                if candidate.get("state") == "CANCELED":
                    observed = candidate
                    break
            except Exception:
                pass
            time.sleep(0.02)
        self.assertIsNotNone(observed, "terminal state was not fetchable during drain")
        self.assertTrue(observed["events_complete"])
        stop_out, stop_err = stop.communicate(timeout=5)
        self.assertEqual(stop.returncode, 0, stop_out + stop_err)
        self.assertEqual(self.runner.proc.wait(timeout=2), 0)
        self.assertFalse((self.runner.state / "runner.pid").exists())
        states = [event["payload"].get("state") for event in self.runner.events("stop-task")]
        self.assertEqual(states.count("CANCELED"), 1)
        assert_pids_gone(self, pids)

    def test_runner_restart_recovers_working_and_idle_exit_removes_pidfile(self):
        self.runner.close()
        self.runner = RunnerFixture(self, idle_exit=0.3, seed_working=True)
        record = self.runner.rpc("GetTask", {"taskId": "restart-task"})
        self.assertEqual(record["state"], "FAILED")
        self.assertEqual(record["termination_reason"], "runner_restart")
        self.assertTrue(record["events_complete"])
        states = [event["payload"].get("state") for event in self.runner.events("restart-task")]
        self.assertEqual(states, ["SUBMITTED", "WORKING", "FAILED"])
        self.assertEqual(self.runner.proc.wait(timeout=3), 0)
        self.assertFalse((self.runner.state / "runner.pid").exists())


class A2AClientTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("a2a_client", CLIENT)
        cls.client = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.client)

    @staticmethod
    def commissioned_envelope(task_id="remote-artifact-001", artifact="docs/test-reports/BL-FIXTURE-verdict.json"):
        return {
            "task_id": task_id,
            "contract_version": "harness/1.1",
            "batch": "BL-FIXTURE",
            "role": "evaluator",
            "repo": {"url": ".", "ref": "a" * 40},
            "l2_authorized": False,
            "contract": "Deterministic remote fixture contract with enough detail for validation.",
            "deliverable": {
                "artifact": artifact,
                "schema": ".claude/autonomous/verdict-artifact.schema.json",
                "commit_to": None,
            },
        }

    @staticmethod
    def integration_registry():
        return {
            "version": "tool-integrations/1",
            "integrations": [{
                "id": "codex",
                "tool": "codex",
                "label": "Codex",
                "model_family": "codex",
                "priority": 100,
                "capabilities": ["plan", "verify"],
                "local_cli": {
                    "adapter": "codex",
                    "sandbox": {"home_dir": "/tmp/harness-codex"},
                    "timeout_s": 2400,
                },
            }],
            "a2a_targets": [{
                "id": "codex-remote",
                "integration_id": "codex",
                "endpoint": "https://codex.example.invalid/a2a",
                "remote_runner_id": "codex-remote-runner",
                "priority": 100,
                "auth": {"type": "bearer", "env": "REMOTE_A2A_CODEX"},
                "capabilities": ["remote-verify"],
            }],
        }

    def commission(self, root, envelope):
        root.mkdir(parents=True, exist_ok=True)
        if not (root / ".git").exists():
            subprocess.run(["git", "-C", str(root), "init", "-q"], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.email", "fixture@example.invalid"], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.name", "fixture"], check=True)
            (root / ".a2a-fixture").write_text("fixture\n", encoding="utf-8")
            subprocess.run(["git", "-C", str(root), "add", ".a2a-fixture"], check=True)
            subprocess.run(["git", "-C", str(root), "commit", "-qm", "fixture"], check=True)
        envelope_path = root / "envelope.json"
        envelope_path.write_text(json.dumps(envelope), encoding="utf-8")
        return self.client.commission_from_envelope(
            envelope, str(envelope_path), project_root=str(root)
        )

    def test_a2a_auth_rejects_unsafe_configuration_before_network(self):
        base = {
            "id": "remote",
            "roles": ["evaluator"],
            "transport": "a2a",
            "endpoint": "http://127.0.0.1:1",
            "model_family": "fixture",
        }
        self.assertEqual(self.client.auth_header(base), {})
        self.assertEqual(
            self.client.auth_header({**base, "auth": {"type": "none"}}), {}
        )
        with mock.patch.dict(os.environ, {"REMOTE_A2A_TOKEN": "fixture-token"}, clear=False):
            self.assertEqual(
                self.client.auth_header(
                    {**base, "auth": {"type": "bearer", "env": "REMOTE_A2A_TOKEN"}}
                ),
                {"Authorization": "Bearer fixture-token"},
            )

        for auth, error in (
            (None, "must be an object"),
            ({}, "must be 'none' or 'bearer'"),
            ({"type": "none", "env": "REMOTE_A2A_TOKEN"}, "must contain exactly"),
            ({"type": "bearer"}, "must contain exactly"),
            ({"type": "bearer", "env": "GIT_TERMINAL_PROMPT"}, "protected"),
            ({"type": "bearer", "env": "OPENAI_API_KEY"}, "REMOTE_A2A_"),
        ):
            with self.subTest(auth=auth), self.assertRaisesRegex(self.client.ClientError, error):
                self.client.auth_header({**base, "auth": auth})

        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(self.client.ClientError, "REMOTE_A2A_TOKEN is empty"):
                self.client.auth_header(
                    {**base, "auth": {"type": "bearer", "env": "REMOTE_A2A_TOKEN"}}
                )

        with mock.patch.object(urllib.request, "urlopen") as urlopen:
            for env_name, error in (("GIT_ASKPASS", "protected"), ("OPENAI_API_KEY", "REMOTE_A2A_")):
                with self.subTest(env_name=env_name), self.assertRaisesRegex(self.client.ClientError, error):
                    self.client.rpc(
                        {**base, "auth": {"type": "bearer", "env": env_name}},
                        "GetTask",
                        {"taskId": "fixture-task"},
                    )
            urlopen.assert_not_called()

        with tempfile.TemporaryDirectory() as raw:
            registry = Path(raw) / "registry.json"
            registry.write_text(
                json.dumps({"version": "dispatch/1", "agents": [{
                    **base, "auth": {"type": "bearer", "env": "HARNESS_A2A_TOKEN"}
                }]}),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(self.client.ClientError, "protected"):
                self.client.load_descriptor(str(registry), "remote")

    def test_client_pins_project_registry_before_descriptor_or_network(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw) / "project"
            root.mkdir()
            outside = Path(raw) / "outside-registry.json"
            outside.write_text("{}", encoding="utf-8")
            expected = root / ".agents-registry.json"
            cases = [("outside", outside)]

            os.symlink(outside, expected)
            cases.append(("symlink", expected))

            for label, requested_registry in cases:
                with self.subTest(case=label), mock.patch.object(
                    self.client, "load_descriptor"
                ) as load_descriptor, mock.patch.object(
                    self.client, "fetch_agent_card"
                ) as fetch_agent_card, mock.patch.object(
                    urllib.request, "urlopen"
                ) as urlopen, mock.patch.object(self.client, "log") as log:
                    argv = [
                        str(CLIENT), "card", "--agent", "remote",
                        "--registry", str(requested_registry),
                        "--project-root", str(root),
                    ]
                    with mock.patch.object(sys, "argv", argv), self.assertRaises(
                        SystemExit
                    ) as raised:
                        self.client.main()
                    self.assertEqual(raised.exception.code, 2)
                    self.assertIn("registry", log.call_args.args[0].lower())
                    load_descriptor.assert_not_called()
                    fetch_agent_card.assert_not_called()
                    urlopen.assert_not_called()

    def test_client_expected_provenance_rejects_before_descriptor_or_network(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw) / "project"
            root.mkdir()
            registry = root / ".agents-registry.json"
            registry.write_text(json.dumps(self.integration_registry()), encoding="utf-8")
            adapters = root / "adapters"
            adapters.mkdir()
            shutil.copy2(
                DISPATCH / "transports" / "adapters" / "codex.json",
                adapters / "codex.json",
            )

            target = subprocess.run(
                [
                    sys.executable, str(DISPATCH / "tool-catalog.py"), "target",
                    "--registry", str(registry), "--adapters", str(adapters),
                    "--target-id", "a2a--codex-remote--evaluator",
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                check=False,
            )
            self.assertEqual(target.returncode, 0, target.stderr)
            expected = json.loads(target.stdout)["execution_provenance_sha256"]
            self.client.verify_expected_execution_provenance(
                str(registry), "a2a--codex-remote--evaluator", str(adapters), expected
            )
            with self.assertRaisesRegex(self.client.ClientError, "semantics drifted"):
                self.client.verify_expected_execution_provenance(
                    str(registry), "a2a--codex-remote--evaluator", str(adapters), "0" * 64
                )

            argv = [
                str(CLIENT), "card", "--agent", "a2a--codex-remote--evaluator",
                "--registry", str(registry), "--project-root", str(root),
                "--adapters", str(adapters), "--expected-provenance", "0" * 64,
            ]
            with mock.patch.object(self.client, "load_descriptor") as load_descriptor, \
                    mock.patch.object(self.client, "fetch_agent_card") as fetch_agent_card, \
                    mock.patch.object(urllib.request, "urlopen") as urlopen, \
                    mock.patch.object(self.client, "log") as log, \
                    mock.patch.object(sys, "argv", argv), self.assertRaises(SystemExit) as raised:
                self.client.main()
            self.assertEqual(raised.exception.code, 2)
            self.assertIn("semantics drifted", log.call_args.args[0])
            load_descriptor.assert_not_called()
            fetch_agent_card.assert_not_called()
            urlopen.assert_not_called()

    def test_client_expected_provenance_uses_catalog_snapshot_after_registry_swap(self):
        """A verified target must remain the sole source of remote authority."""
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw) / "project"
            root.mkdir()
            registry = root / ".agents-registry.json"
            original = self.integration_registry()
            registry.write_text(json.dumps(original), encoding="utf-8")
            adapters = root / "adapters"
            adapters.mkdir()
            shutil.copy2(
                DISPATCH / "transports" / "adapters" / "codex.json",
                adapters / "codex.json",
            )

            catalog = subprocess.run(
                [
                    sys.executable, str(DISPATCH / "tool-catalog.py"), "target",
                    "--registry", str(registry), "--adapters", str(adapters),
                    "--target-id", "a2a--codex-remote--evaluator",
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                check=False,
            )
            self.assertEqual(catalog.returncode, 0, catalog.stderr)
            expected = json.loads(catalog.stdout)["execution_provenance_sha256"]

            swapped = self.integration_registry()
            swapped["a2a_targets"][0]["endpoint"] = "http://127.0.0.1:9/attacker"
            swapped["a2a_targets"][0]["auth"] = {
                "type": "bearer", "env": "REMOTE_A2A_ATTACKER"
            }
            real_verify = self.client.verify_expected_execution_provenance
            captured = {}

            def verify_then_swap(*args, **kwargs):
                target = real_verify(*args, **kwargs)
                registry.write_text(json.dumps(swapped), encoding="utf-8")
                return target

            def observe_card(descriptor):
                captured.update(descriptor)
                return {"name": "catalog-snapshot"}

            argv = [
                str(CLIENT), "card", "--agent", "a2a--codex-remote--evaluator",
                "--registry", str(registry), "--project-root", str(root),
                "--adapters", str(adapters), "--expected-provenance", expected,
            ]
            with mock.patch.object(
                self.client,
                "verify_expected_execution_provenance",
                side_effect=verify_then_swap,
            ), mock.patch.object(
                self.client,
                "load_descriptor",
                side_effect=AssertionError("expected provenance must not reopen registry"),
            ) as load_descriptor, mock.patch.object(
                self.client, "fetch_agent_card", side_effect=observe_card
            ), mock.patch("builtins.print"), mock.patch.object(sys, "argv", argv):
                self.assertEqual(self.client.main(), 0)

            load_descriptor.assert_not_called()
            self.assertEqual(captured["endpoint"], original["a2a_targets"][0]["endpoint"])
            self.assertEqual(
                captured["auth"], {"type": "bearer", "env": "REMOTE_A2A_CODEX"}
            )
            self.assertEqual(captured["timeout_s"], 2400)
            self.assertEqual(
                json.loads(registry.read_text(encoding="utf-8"))["a2a_targets"][0]["endpoint"],
                swapped["a2a_targets"][0]["endpoint"],
            )

    def test_direct_a2a_active_checkpoint_guards_every_network_command(self):
        """The direct client must not let any command bypass active v2 binding."""
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw) / "project"
            root.mkdir()
            registry = root / ".agents-registry.json"
            remote = self.integration_registry()
            remote["a2a_targets"][0]["endpoint"] = "http://127.0.0.1:9/a2a"
            registry.write_text(json.dumps(remote), encoding="utf-8")
            adapters = root / "adapters"
            adapters.mkdir()
            shutil.copy2(
                DISPATCH / "transports" / "adapters" / "codex.json",
                adapters / "codex.json",
            )
            envelope = root / "envelope.json"
            envelope.write_text(json.dumps({"role": "evaluator"}), encoding="utf-8")
            (root / "progress.json").write_text(
                json.dumps({"mode_intent": {"signed_intent": {}, "resolution": {}}}),
                encoding="utf-8",
            )

            installed = Path(raw) / "framework"
            shutil.copytree(DISPATCH, installed)
            write_executable(
                installed / "resolve-active-mode-role.sh",
                "#!/usr/bin/env bash\n"
                "set -euo pipefail\n"
                "role=''\n"
                "expected=''\n"
                "while [ \"$#\" -gt 0 ]; do\n"
                "  case \"$1\" in\n"
                "    --role) role=\"$2\"; shift 2 ;;\n"
                "    --expected-agent) expected=\"$2\"; shift 2 ;;\n"
                "    *) shift ;;\n"
                "  esac\n"
                "done\n"
                "if [ \"$role\" != \"evaluator\" ]; then\n"
                "  echo '[fixture active resolver] role mismatch' >&2\n"
                "  exit 2\n"
                "fi\n"
                "if [ \"$expected\" != \"${HARNESS_ACTIVE_AGENT:?}\" ]; then\n"
                "  echo '[fixture active resolver] expected agent mismatch' >&2\n"
                "  exit 2\n"
                "fi\n"
                "printf '{\"agent_id\":\"%s\",\"tool\":\"codex\",\"invocation\":\"a2a\","
                "\"model_family\":\"codex\",\"priority\":100,"
                "\"execution_provenance_sha256\":\"%s\"}\\n' \\\n"
                "  \"$expected\" \"${HARNESS_ACTIVE_PROVENANCE:?}\"\n",
            )

            client = installed / "transports" / "a2a-client.py"
            common = [
                "--registry", str(registry), "--project-root", str(root),
                "--adapters", str(adapters),
            ]
            environment = {
                **os.environ,
                "HARNESS_ACTIVE_AGENT": "a2a--codex-remote--evaluator",
                "HARNESS_ACTIVE_PROVENANCE": "0" * 64,
            }

            def invoke(command, *, agent, with_envelope=False, task=False):
                args = [sys.executable, str(client), command, "--agent", agent]
                if with_envelope:
                    args.extend(["--envelope", str(envelope)])
                if task:
                    args.extend(["--task", "fixture-task"])
                return subprocess.run(
                    [*args, *common],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    env=environment,
                    timeout=10,
                )

            # Commands carrying an envelope derive its role, then force the
            # resolver to reject a target that is not the active assignment.
            for command in ("run", "send", "get", "subscribe"):
                with self.subTest(command=command):
                    result = invoke(
                        command,
                        agent="a2a--other-remote--evaluator",
                        with_envelope=True,
                        task=command in ("get", "subscribe"),
                    )
                    self.assertEqual(result.returncode, 2, result.stderr)
                    self.assertIn("expected agent mismatch", result.stderr)

            # No-envelope network commands require a role when callers use a
            # compatibility target id that does not encode one.
            for command in ("card", "ls", "cancel"):
                with self.subTest(command=command):
                    result = invoke(
                        command,
                        agent="codex-remote",
                        task=command == "cancel",
                    )
                    self.assertEqual(result.returncode, 2, result.stderr)
                    self.assertIn("requires --role", result.stderr)

            # A generated target supplies its role, so its active provenance
            # still has to agree with the fresh catalog before any endpoint is
            # parsed or contacted.
            result = invoke("card", agent="a2a--codex-remote--evaluator")
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIn("semantics drifted", result.stderr)

    def test_tool_integration_target_resolves_per_role_and_rejects_generator(self):
        with tempfile.TemporaryDirectory() as raw:
            registry = Path(raw) / "tool-integrations.json"
            registry.write_text(json.dumps(self.integration_registry()), encoding="utf-8")

            planner = self.client.load_descriptor(
                str(registry), "a2a--codex-remote--planner"
            )
            evaluator = self.client.load_descriptor(
                str(registry), "a2a--codex-remote--evaluator"
            )
            compatibility = self.client.load_descriptor(str(registry), "codex-remote")

            self.assertEqual(planner["id"], "a2a--codex-remote--planner")
            self.assertEqual(planner["roles"], ["planner"])
            self.assertEqual(evaluator["roles"], ["evaluator"])
            self.assertEqual(compatibility["roles"], ["planner", "evaluator"])
            self.assertEqual(planner["integration_id"], "codex")
            self.assertEqual(planner["remote_runner_id"], "codex-remote-runner")
            self.assertEqual(planner["tool"], "codex")
            self.assertEqual(planner["model_family"], "codex")
            self.assertEqual(planner["capabilities"], ["plan", "remote-verify", "verify"])
            self.assertTrue(planner["remote_card_required"])
            with self.assertRaisesRegex(self.client.ClientError, "does not support generator"):
                self.client.load_descriptor(
                    str(registry), "a2a--codex-remote--generator"
                )

            with self.assertRaisesRegex(self.client.ClientError, "does not support generator"):
                self.client.validate_dispatchable_role(planner, {"role": "generator"})

    def test_canonical_target_preflight_rejects_unverified_adapter_before_network(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            registry = root / ".agents-registry.json"
            registry.write_text(json.dumps(self.integration_registry()), encoding="utf-8")
            adapters = root / "adapters"
            adapters.mkdir()
            adapter = json.loads(
                (DISPATCH / "transports" / "adapters" / "codex.json").read_text(
                    encoding="utf-8"
                )
            )
            adapter["_verified"] = False
            (adapters / "codex.json").write_text(json.dumps(adapter), encoding="utf-8")

            with mock.patch.object(urllib.request, "urlopen") as urlopen:
                with self.assertRaisesRegex(self.client.ClientError, "not verified"):
                    self.client.load_descriptor(
                        str(registry),
                        "a2a--codex-remote--planner",
                        adapters=str(adapters),
                    )
                urlopen.assert_not_called()

                argv = [
                    str(CLIENT), "card", "--agent", "a2a--codex-remote--planner",
                    "--registry", str(registry), "--project-root", str(root),
                    "--adapters", str(adapters),
                ]
                with mock.patch.object(sys, "argv", argv), self.assertRaises(SystemExit):
                    self.client.main()
                urlopen.assert_not_called()

    def test_tool_integration_target_requires_matching_remote_card(self):
        with tempfile.TemporaryDirectory() as raw:
            registry = Path(raw) / "tool-integrations.json"
            registry.write_text(json.dumps(self.integration_registry()), encoding="utf-8")
            descriptor = self.client.load_descriptor(
                str(registry), "a2a--codex-remote--planner"
            )
            card = {
                "name": "codex-remote-runner",
                "provider": {"modelFamily": "codex"},
                "roles": ["planner", "evaluator"],
                "x-harness": {
                    "contract_version": "harness/1.1",
                    "sandboxed": True,
                    "tool": "codex",
                    "integration_id": "codex",
                },
            }
            with mock.patch.object(self.client, "fetch_agent_card", return_value=card):
                self.client.validate_remote_card(descriptor, "planner")

            mismatches = {
                "name": {**card, "name": "kimi-remote-runner"},
                "family": {**card, "provider": {"modelFamily": "kimi"}},
                "role": {**card, "roles": ["evaluator"]},
                "tool": {**card, "x-harness": {**card["x-harness"], "tool": "kimi"}},
                "integration": {
                    **card,
                    "x-harness": {**card["x-harness"], "integration_id": "kimi"},
                },
            }
            for label, bad_card in mismatches.items():
                with self.subTest(label=label), mock.patch.object(
                    self.client, "fetch_agent_card", return_value=bad_card
                ), self.assertRaises(self.client.ClientError):
                    self.client.validate_remote_card(descriptor, "planner")

    def test_remote_card_verification_is_bounded_by_the_task_deadline(self):
        descriptor = {"id": "remote", "endpoint": "http://127.0.0.1:1"}
        with mock.patch.object(self.client, "validate_remote_card") as validate, mock.patch.object(
            self.client.time, "time", side_effect=[100.0, 100.25]
        ):
            self.client.validate_remote_card_before_deadline(
                descriptor, "evaluator", 100.5
            )
        validate.assert_called_once_with(descriptor, "evaluator", timeout=0.5)

        with mock.patch.object(self.client, "validate_remote_card") as validate, mock.patch.object(
            self.client.time, "time", side_effect=[100.0, 100.51]
        ), self.assertRaisesRegex(self.client.ClientError, "during Agent Card"):
            self.client.validate_remote_card_before_deadline(
                descriptor, "evaluator", 100.5
            )
        validate.assert_called_once_with(descriptor, "evaluator", timeout=0.5)

    def test_confirmed_deadline_cancel_survives_final_get_failure(self):
        descriptor = {
            "id": "remote",
            "endpoint": "http://127.0.0.1:1",
            "model_family": "fixture",
        }
        responses = [
            {"taskId": "task-1", "state": "CANCELED", "events_complete": True,
             "finished_at": "2026-07-27T00:00:00Z"},
            self.client.ClientError("connection refused"),
        ]

        def fake_rpc(*_args, **_kwargs):
            value = responses.pop(0)
            if isinstance(value, Exception):
                raise value
            return value

        with mock.patch.object(self.client, "rpc", side_effect=fake_rpc):
            record = self.client.cancel_at_deadline(
                descriptor, "task-1", 0.1,
                {"taskId": "task-1", "batch": "BL-FIXTURE"},
            )
        self.assertEqual(record["state"], "CANCELED")
        self.assertEqual(record["termination_reason"], "client_deadline")
        self.assertTrue(record["events_complete"])
        self.assertEqual(self.client.deadline_exit_code(record), 124)

    def test_deadline_preserves_an_existing_runner_cancel(self):
        descriptor = {
            "id": "remote",
            "endpoint": "http://127.0.0.1:1",
            "model_family": "fixture",
        }
        responses = [
            {"taskId": "task-1", "state": "CANCELED", "events_complete": True,
             "termination_reason": "runner_stop", "deduplicated": True},
            {"taskId": "task-1", "state": "CANCELED", "events_complete": True,
             "termination_reason": "runner_stop"},
        ]

        with mock.patch.object(self.client, "rpc", side_effect=responses):
            record = self.client.cancel_at_deadline(
                descriptor, "task-1", 0.1,
                {"taskId": "task-1", "batch": "BL-FIXTURE"},
            )
        self.assertEqual(record["termination_reason"], "runner_stop")
        self.assertEqual(self.client.deadline_exit_code(record), 0)

    def test_completion_race_at_deadline_is_not_reported_as_timeout(self):
        descriptor = {
            "id": "remote",
            "endpoint": "http://127.0.0.1:1",
            "model_family": "fixture",
        }
        responses = [
            {"taskId": "task-1", "state": "COMPLETED", "events_complete": True,
             "deduplicated": True},
            {"taskId": "task-1", "state": "COMPLETED", "events_complete": True,
             "termination_reason": "process_exit", "artifact": {"waiting": None}},
        ]

        with mock.patch.object(self.client, "rpc", side_effect=responses):
            record = self.client.cancel_at_deadline(
                descriptor, "task-1", 0.1,
                {"taskId": "task-1", "batch": "BL-FIXTURE"},
            )
        self.assertEqual(record["state"], "COMPLETED")
        self.assertEqual(self.client.deadline_exit_code(record), 0)

    def test_inlined_a2a_artifact_receipt_pointer_is_absolute(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            state = root / "state"
            envelope = self.commissioned_envelope(
                artifact="docs/test-reports/BL-FIXTURE-verdict.json"
            )
            commission = self.commission(root, envelope)
            previous_cwd = os.getcwd()
            try:
                os.chdir(root)
                with mock.patch("builtins.print"):
                    meta = self.client.synth_run_meta(
                        {
                            "id": "remote",
                            "endpoint": "http://127.0.0.1:1",
                            "model_family": "fixture",
                        },
                        {
                            "taskId": envelope["task_id"],
                            "agent": "remote",
                            "model_family": "fixture",
                            "batch": envelope["batch"],
                            "role": envelope["role"],
                            "deliverable": envelope["deliverable"],
                            "artifact": {"waiting": None},
                            "state": "COMPLETED",
                        },
                        str(state),
                        commission=commission,
                    )
            finally:
                os.chdir(previous_cwd)

            expected = state / "a2a-artifacts" / "remote-artifact-001" / "BL-FIXTURE-verdict.json"
            self.assertTrue(Path(meta["artifact"]).is_absolute())
            self.assertEqual(Path(meta["artifact"]).resolve(), expected.resolve())
            self.assertTrue(expected.is_file())
            self.assertEqual(
                Path(json.loads((state / "run-meta-remote-artifact-001.json").read_text())["artifact"]).resolve(),
                expected.resolve(),
            )
            self.assertFalse((root / "docs" / "test-reports" / "BL-FIXTURE-verdict.json").exists())

    def test_terminal_binding_mismatch_never_writes_remote_artifact_path(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            project = root / "project"
            project.mkdir()
            envelope = self.commissioned_envelope(
                artifact="docs/test-reports/BL-FIXTURE-verdict.json"
            )
            commission = self.commission(project, envelope)
            remote = {
                "taskId": envelope["task_id"],
                "batch": envelope["batch"],
                "role": envelope["role"],
                # A remote path must never choose a local write destination.
                "deliverable": {
                    "artifact": "../escaped.json",
                    "schema": ".claude/autonomous/verdict-artifact.schema.json",
                    "commit_to": None,
                },
                "artifact": {"waiting": None},
                "state": "COMPLETED",
            }
            previous_cwd = os.getcwd()
            try:
                os.chdir(project)
                with self.assertRaisesRegex(self.client.ClientError, "deliverable"):
                    self.client.synth_run_meta(
                        {"id": "remote", "endpoint": "http://127.0.0.1:1"},
                        remote,
                        str(project / "state"),
                        commission=commission,
                    )
            finally:
                os.chdir(previous_cwd)

            self.assertFalse((root / "escaped.json").exists())
            self.assertFalse((project / "docs" / "test-reports" / "BL-FIXTURE-verdict.json").exists())
            self.assertFalse((project / "state").exists())

    def test_terminal_record_fields_must_exactly_match_commission(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            envelope = self.commissioned_envelope()
            commission = self.commission(root, envelope)
            base = {
                "taskId": envelope["task_id"],
                "batch": envelope["batch"],
                "role": envelope["role"],
                "deliverable": envelope["deliverable"],
                "state": "COMPLETED",
            }
            mutations = {
                "taskId": "other-task-001",
                "batch": "BL-OTHER",
                "role": "planner",
                "deliverable": {"artifact": "docs/test-reports/other.json", "schema": ".claude/autonomous/verdict-artifact.schema.json", "commit_to": None},
            }
            for field, value in mutations.items():
                record = dict(base)
                record[field] = value
                with self.subTest(field=field), self.assertRaisesRegex(self.client.ClientError, field):
                    self.client.synth_run_meta(
                        {"id": "remote", "endpoint": "http://127.0.0.1:1"},
                        record,
                        str(root / "state"),
                        commission=commission,
                    )
            self.assertFalse((root / "state").exists())
            self.assertFalse((root / "docs" / "test-reports" / "BL-FIXTURE-verdict.json").exists())

    def test_failed_a2a_terminal_with_artifact_is_not_returned(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            envelope = self.commissioned_envelope()
            commission = self.commission(root, envelope)
            meta = self.client.synth_run_meta(
                {"id": "remote", "endpoint": "http://127.0.0.1:1", "model_family": "fixture"},
                {
                    "taskId": envelope["task_id"],
                    "batch": envelope["batch"],
                    "role": envelope["role"],
                    "deliverable": envelope["deliverable"],
                    "state": "FAILED",
                    "artifact": {"waiting": None},
                },
                str(root / "state"),
                commission=commission,
            )
            self.assertEqual(meta["outcome"], "FAILED")
            self.assertTrue(Path(meta["artifact"]).is_file())


class RunnerCoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("a2a_runner", RUNNER)
        cls.runner_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.runner_module)

    def setUp(self):
        from types import SimpleNamespace

        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.state = self.root / "state"
        self.state.mkdir()
        self.validator = self.root / "validator.sh"
        write_executable(
            self.validator,
            "#!/usr/bin/env bash\n"
            "if [ \"${1:-}\" = receipt ]; then printf '{\"state\":\"COMPLETED\"}\\n'; fi\n"
            "exit 0\n",
        )
        child = self.root / "child.py"
        child.write_text(
            "import signal, time\n"
            "signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
            "while True: time.sleep(1)\n",
            encoding="utf-8",
        )
        fake = self.root / "fake.py"
        fake.write_text(
            "import json, os, signal, subprocess, sys, time\n"
            "args = sys.argv[1:]\n"
            "env = json.load(open(args[args.index('--envelope') + 1]))\n"
            "root = os.path.dirname(__file__); tid = env['task_id']\n"
            "json.dump(args, open(os.path.join(root, 'args-' + tid + '.json'), 'w'))\n"
            "if env.get('contract') == 'slow':\n"
            " signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
            " child = subprocess.Popen([sys.executable, os.path.join(root, 'child.py')])\n"
            " open(os.path.join(root, 'pids-' + tid), 'w').write(json.dumps([os.getpid(), child.pid]))\n"
            " while True: time.sleep(1)\n"
            "artifact = os.path.join(root, 'artifact-' + tid)\n"
            "json.dump({'waiting': None}, open(artifact, 'w'))\n"
            "print(json.dumps({'task_id': tid, 'artifact': artifact, 'outcome': 'RETURNED', 'exit_code': 0}))\n",
            encoding="utf-8",
        )
        self.sandbox = self.root / "sandbox.sh"
        write_executable(
            self.sandbox,
            f"#!/usr/bin/env bash\nexec {sys.executable!r} {str(fake)!r} \"$@\"\n",
        )
        self.cfg = SimpleNamespace(
            state=str(self.state),
            validator=str(self.validator),
            sandbox=str(self.sandbox),
            agent="fixture-agent",
            integration=None,
            runner_id="fixture-agent",
            registry=str(self.root / ".agents-registry.json"),
            adapters=str(self.root / "adapters"),
            workroot=str(self.root / "work"),
            cancel_grace=0.1,
            shutdown_timeout=2.0,
        )
        Path(self.cfg.registry).write_text("{}", encoding="utf-8")
        Path(self.cfg.adapters).mkdir()
        self.store = self.runner_module.TaskStore(str(self.state / "tasks"))
        self.executor = self.runner_module.Executor(self.cfg, self.store)

    def tearDown(self):
        self.executor.shutdown_all("test_cleanup")
        self.temp.cleanup()

    def envelope(self, tid, contract="normal"):
        return {
            "task_id": tid,
            "batch": "BL-FIXTURE",
            "role": "evaluator",
            "repo": {"url": str(self.root), "ref": "1234567"},
            "contract": contract,
            "deliverable": {"artifact": "artifact.json", "schema": "schema.json"},
        }

    def create_and_start(self, tid, contract="normal"):
        envelope = self.envelope(tid, contract)
        self.store.create(tid, {
            "taskId": tid,
            "state": "SUBMITTED",
            "agent": "fixture-agent",
            "batch": "BL-FIXTURE",
            "role": "evaluator",
            "submitted_at": "2026-07-27T00:00:00Z",
            "deliverable": envelope["deliverable"],
        })
        self.assertTrue(self.executor.start(tid, envelope))

    def test_terminal_finalize_is_unique_and_events_replay_in_order(self):
        self.create_and_start("normal-core")
        record = wait_until(
            lambda: (lambda value: value if value.get("state") == "COMPLETED" else None)(
                self.store.get("normal-core")
            )
        )
        self.assertIsNotNone(record)
        events = self.store.events_since("normal-core", 0)
        self.assertEqual(
            [(event["kind"], event["payload"].get("state")) for event in events],
            [("status", "SUBMITTED"), ("status", "WORKING"),
             ("artifact", None), ("status", "COMPLETED")],
        )
        self.assertEqual([event["seq"] for event in self.store.events_since("normal-core", 2)], [3, 4])
        same, changed = self.store.finalize("normal-core", "CANCELED")
        self.assertFalse(changed)
        self.assertEqual(same["state"], "COMPLETED")
        self.assertEqual(len(self.store.events_since("normal-core", 0)), 4)

    def test_integration_runner_profile_is_role_limited_and_passes_integration_selector(self):
        registry = {
            "version": "tool-integrations/1",
            "integrations": [{
                "id": "codex",
                "tool": "codex",
                "label": "Codex",
                "model_family": "codex",
                "priority": 100,
                "capabilities": ["plan", "verify"],
                "local_cli": {
                    "adapter": "codex",
                    "sandbox": {"home_dir": "/tmp/harness-codex"},
                    "timeout_s": 2400,
                },
            }],
            "a2a_targets": [],
        }
        Path(self.cfg.registry).write_text(json.dumps(registry), encoding="utf-8")
        adapter = {
            "name": "codex",
            "tool": "codex",
            "model_family": "codex",
            "argv": ["codex", "exec"],
            "envelope_delivery": "stdin",
            "_verified": True,
        }
        adapter_path = Path(self.cfg.adapters) / "codex.json"
        adapter_path.write_text(json.dumps(adapter), encoding="utf-8")
        descriptor = self.runner_module.load_execution_descriptor(
            self.cfg.registry, integration="codex"
        )
        self.assertEqual(descriptor["id"], "local-cli--codex")
        self.assertEqual(descriptor["roles"], ["planner", "evaluator"])
        self.assertEqual(descriptor["tool"], "codex")
        self.assertEqual(descriptor["model_family"], "codex")
        self.assertEqual(descriptor["constraints"], {
            "l2": False, "write_src": False, "push": False,
        })
        self.runner_module.validate_integration_preflight(
            str(DISPATCH / "tool-catalog.py"),
            self.cfg.registry,
            self.cfg.adapters,
            descriptor,
        )

        self.cfg.integration = "codex"
        self.cfg.agent = None
        self.cfg.runner_id = descriptor["id"]
        self.create_and_start("integration-core")
        record = wait_until(
            lambda: (lambda value: value if value.get("state") == "COMPLETED" else None)(
                self.store.get("integration-core")
            )
        )
        self.assertIsNotNone(record)
        args = json.loads((self.root / "args-integration-core.json").read_text())
        self.assertIn("--integration", args)
        self.assertEqual(args[args.index("--integration") + 1], "codex")

        from types import SimpleNamespace
        card = self.runner_module.agent_card(
            SimpleNamespace(
                runner_id="codex-remote-runner",
                advertise="127.0.0.1",
                port=41241,
                token="",
            ),
            {**descriptor, "id": "codex-remote-runner"},
        )
        self.assertEqual(card["name"], "codex-remote-runner")
        self.assertEqual(card["roles"], ["planner", "evaluator"])
        self.assertEqual(card["x-harness"]["tool"], "codex")
        self.assertEqual(card["x-harness"]["integration_id"], "codex")

    def test_integration_preflight_rejects_unverified_adapter_before_listening(self):
        registry = {
            "version": "tool-integrations/1",
            "integrations": [{
                "id": "codex",
                "tool": "codex",
                "label": "Codex",
                "model_family": "codex",
                "priority": 100,
                "capabilities": ["plan", "verify"],
                "local_cli": {
                    "adapter": "codex",
                    "sandbox": {"home_dir": "/tmp/harness-codex"},
                    "timeout_s": 2400,
                },
            }],
            "a2a_targets": [],
        }
        Path(self.cfg.registry).write_text(json.dumps(registry), encoding="utf-8")
        (Path(self.cfg.adapters) / "codex.json").write_text(json.dumps({
            "name": "codex",
            "tool": "codex",
            "model_family": "codex",
            "argv": ["codex", "exec"],
            "envelope_delivery": "stdin",
            "_verified": False,
        }), encoding="utf-8")
        state = self.root / "preflight-state"
        argv = [
            str(RUNNER),
            "--registry", self.cfg.registry,
            "--project-root", str(self.root),
            "--integration", "codex",
            "--state", str(state),
            "--sandbox", self.cfg.sandbox,
            "--validator", self.cfg.validator,
            "--adapters", self.cfg.adapters,
        ]
        with mock.patch.object(sys, "argv", argv), mock.patch.object(
            self.runner_module, "ThreadingHTTPServer"
        ) as server:
            with self.assertRaises(SystemExit) as raised:
                self.runner_module.main()
        self.assertIn("not verified", str(raised.exception))
        server.assert_not_called()
        self.assertFalse(state.exists())

    def test_runner_pins_project_registry_before_descriptor_or_listening(self):
        outside = self.root / "outside-registry.json"
        outside.write_text("{}", encoding="utf-8")
        expected = self.root / ".agents-registry.json"
        cases = [("outside", outside)]

        expected.unlink()
        os.symlink(outside, expected)
        cases.append(("symlink", expected))

        for label, requested_registry in cases:
            state = self.root / f"registry-pin-{label}-state"
            argv = [
                str(RUNNER),
                "--agent", "fixture-agent",
                "--registry", str(requested_registry),
                "--project-root", str(self.root),
                "--state", str(state),
            ]
            with self.subTest(case=label), mock.patch.object(
                sys, "argv", argv
            ), mock.patch.object(
                self.runner_module, "load_execution_descriptor"
            ) as load_descriptor, mock.patch.object(
                self.runner_module, "ThreadingHTTPServer"
            ) as server:
                with self.assertRaises(SystemExit) as raised:
                    self.runner_module.main()
            self.assertIn("registry", str(raised.exception).lower())
            load_descriptor.assert_not_called()
            server.assert_not_called()
            self.assertFalse(state.exists())

    def test_runner_stop_does_not_require_project_registry(self):
        no_registry_root = self.root / "no-registry-project"
        no_registry_root.mkdir()
        state = no_registry_root / "state"
        result = subprocess.run(
            [
                sys.executable, str(RUNNER),
                "--agent", "fixture-agent",
                "--registry", str(no_registry_root / "missing-registry.json"),
                "--state", str(state),
                "--stop",
            ],
            cwd=no_registry_root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("no valid pidfile", result.stdout)
        self.assertFalse(state.exists())

    def test_runner_uses_catalog_timeout_default_and_accepts_legacy_long_id(self):
        integration_registry = {
            "version": "tool-integrations/1",
            "integrations": [{
                "id": "codex",
                "tool": "codex",
                "label": "Codex",
                "model_family": "codex",
                "priority": 100,
                "capabilities": ["plan", "verify"],
                "local_cli": {
                    "adapter": "codex",
                    "sandbox": {"home_dir": "/tmp/harness-codex"},
                },
            }],
            "a2a_targets": [],
        }
        Path(self.cfg.registry).write_text(json.dumps(integration_registry), encoding="utf-8")
        (Path(self.cfg.adapters) / "codex.json").write_text(json.dumps({
            "name": "codex",
            "tool": "codex",
            "model_family": "codex",
            "argv": ["codex", "exec"],
            "envelope_delivery": "stdin",
            "_verified": True,
        }), encoding="utf-8")
        descriptor = self.runner_module.load_execution_descriptor(
            self.cfg.registry, integration="codex"
        )
        self.assertEqual(descriptor["timeout_s"], 3600)
        self.runner_module.validate_integration_preflight(
            str(DISPATCH / "tool-catalog.py"),
            self.cfg.registry,
            self.cfg.adapters,
            descriptor,
        )

        legacy_id = "legacy-" + "x" * 80
        Path(self.cfg.registry).write_text(json.dumps({
            "version": "dispatch/1",
            "agents": [{
                "id": legacy_id,
                "roles": ["evaluator"],
                "transport": "local-cli",
                "adapter": "codex",
                "model_family": "codex",
            }],
        }), encoding="utf-8")
        legacy = self.runner_module.load_execution_descriptor(
            self.cfg.registry, agent=legacy_id
        )
        self.assertEqual(legacy["id"], legacy_id)

        Path(self.cfg.registry).write_text(json.dumps({
            "version": "dispatch/1",
            "agents": [{
                "id": legacy_id,
                "roles": ["generator"],
                "transport": "local-cli",
                "adapter": "codex",
                "model_family": "codex",
            }],
        }), encoding="utf-8")
        with self.assertRaisesRegex(self.runner_module.RunnerConfigError, "source-handoff"):
            self.runner_module.load_execution_descriptor(self.cfg.registry, agent=legacy_id)

    def test_cancel_race_and_shutdown_reap_complete_process_groups(self):
        self.create_and_start("race-core", "slow")
        # Cancel may arrive while validation is still running or just after process registration.
        canceled = self.executor.cancel("race-core", "cancel_task")
        self.assertEqual(canceled["state"], "CANCELED")
        self.assertTrue(canceled["events_complete"])
        race_states = [
            event["payload"].get("state")
            for event in self.store.events_since("race-core", 0)
        ]
        self.assertEqual(race_states.count("CANCELED"), 1)

        self.create_and_start("shutdown-core", "slow")
        pids_path = self.root / "pids-shutdown-core"
        self.assertTrue(wait_until(pids_path.exists))
        pids = json.loads(pids_path.read_text())
        self.executor.shutdown_all("runner_stop")
        record = self.store.get("shutdown-core")
        self.assertEqual(record["state"], "CANCELED")
        self.assertTrue(record["finished_at"])
        self.assertTrue(record["events_complete"])
        states = [
            event["payload"].get("state")
            for event in self.store.events_since("shutdown-core", 0)
        ]
        self.assertEqual(states.count("CANCELED"), 1)
        assert_pids_gone(self, pids)

    def test_restart_recovery_terminal_is_durable(self):
        self.store.create("restart-core", {
            "taskId": "restart-core",
            "state": "SUBMITTED",
            "agent": "fixture-agent",
            "submitted_at": "2026-07-27T00:00:00Z",
        })
        self.assertTrue(self.store.transition_working("restart-core"))
        record, changed = self.store.finalize(
            "restart-core",
            "FAILED",
            termination_reason="runner_restart",
            error="execution process was lost",
        )
        self.assertTrue(changed)
        self.assertEqual(record["state"], "FAILED")
        reloaded = self.runner_module.TaskStore(str(self.state / "tasks"))
        self.assertEqual(reloaded.get("restart-core")["termination_reason"], "runner_restart")
        self.assertEqual(
            [event["payload"].get("state") for event in reloaded.events_since("restart-core", 0)],
            ["SUBMITTED", "WORKING", "FAILED"],
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
