#!/usr/bin/env python3
"""Fast deterministic dispatch deadline and A2A lifecycle regression matrix."""

import importlib.util
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
        self.registry = self.root / "registry.json"
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
            registry = root / "tool-integrations.json"
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
                    "--registry", str(registry), "--adapters", str(adapters),
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
            registry=str(self.root / "registry.json"),
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
