#!/usr/bin/env python3
"""Focused boundary tests for the framework-owned vm-v1 bridge provider."""

from __future__ import annotations

import importlib.util
import io
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path


HERE = Path(__file__).resolve().parent
PROVIDER_PATH = HERE / "transports" / "vm-bridge-provider.py"
WORKER_PATH = HERE / "transports" / "vm-bridge-worker.py"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


provider = load_module("vm_bridge_provider_test", PROVIDER_PATH)


def write_file(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def copyout_payload(
    files: dict[str, bytes], *, link: bool = False, mode: int = 0o600
) -> bytes:
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as archive:
        for name, contents in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(contents)
            info.mode = mode
            archive.addfile(info, io.BytesIO(contents))
        if link:
            info = tarfile.TarInfo("source/escape")
            info.type = tarfile.SYMTYPE
            info.linkname = "/tmp/outside"
            archive.addfile(info)
    return output.getvalue()


class VmBridgeProviderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="vm-bridge-provider-")
        self.root = Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_target_resolution_interpreter_can_run_the_real_catalog(self) -> None:
        """The launch re-resolution argv must execute tool-catalog.py itself.

        Guards the escape found in reverify round 1: `python3 -I` severed the
        catalog's dispatch_common sibling import, so every launch died with
        "bridge target cannot be re-resolved" while all mock tests stayed
        green. Run the production interpreter flags against the real catalog
        and a minimal registry; import failures surface as a non-zero exit.
        """
        import json

        registry = self.root / "registry.json"
        adapters = self.root / "adapters"
        adapters.mkdir()
        write_file(
            adapters / "probe-cli.json",
            json.dumps({
                "name": "probe-cli",
                "model_family": "probe",
                "argv": ["probe-cli"],
                "envelope_delivery": "stdin",
                "_verified": True,
            }),
        )
        registry.write_text(
            json.dumps({
                "version": "tool-integrations/1",
                "integrations": [{
                    "id": "probe",
                    "tool": "probe-cli",
                    "model_family": "probe",
                    "local_cli": {
                        "adapter": "probe-cli",
                        "sandbox": {"home_dir": str(self.root / "probe-home")},
                    },
                }],
                "a2a_targets": [],
            }),
            encoding="utf-8",
        )
        resolved = subprocess.run(
            [
                *provider.TARGET_RESOLUTION_PYTHON,
                str(HERE / "tool-catalog.py"),
                "target",
                "--registry",
                str(registry),
                "--adapters",
                str(adapters),
                "--target-id",
                "local-cli--probe--generator",
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=30,
            env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"},
            check=False,
            text=True,
        )
        self.assertEqual(resolved.returncode, 0, resolved.stderr)
        target = json.loads(resolved.stdout)
        self.assertEqual(target.get("integration_id"), "probe")
        self.assertRegex(target.get("execution_provenance_sha256", ""), r"^[0-9a-f]{64}$")

    def test_bundle_command_is_bound_to_the_hashed_bundle_manifest(self) -> None:
        bundle = self.root / "kimi.tar.gz"
        manifest = b'{"protocol_commands":{"acp-native-agent/v1":["kimi","acp"]},"version":"harness/vm-cli-bundle/1"}'
        with tarfile.open(bundle, mode="w:gz") as archive:
            info = tarfile.TarInfo("harness-vm-bundle.json")
            info.size = len(manifest)
            archive.addfile(info, io.BytesIO(manifest))
            executable = tarfile.TarInfo("bin/kimi")
            executable.size = 1
            executable.mode = 0o755
            archive.addfile(executable, io.BytesIO(b"x"))
        self.assertEqual(
            provider._bundle_protocol_commands(bundle),
            {"acp-native-agent/v1": ("kimi", "acp")},
        )

    def test_copyout_rejects_link_entries_before_extracting(self) -> None:
        destination = self.root / "pipe"
        destination.mkdir()
        payload = copyout_payload({"state/bridge-result.json": b"{}"}, link=True)
        with self.assertRaises(provider.ProviderError):
            provider._extract_copyout(payload, destination)

    def test_copyout_rejects_non_normalized_file_mode(self) -> None:
        destination = self.root / "pipe"
        destination.mkdir()
        payload = copyout_payload(
            {"state/bridge-result.json": b"{}"}, mode=0o644
        )
        with self.assertRaisesRegex(provider.ProviderError, "unsafe entry"):
            provider._extract_copyout(payload, destination)

    def test_caller_state_root_rejects_symlink(self) -> None:
        project = self.root / "project"
        outside = self.root / "outside"
        project.mkdir()
        outside.mkdir()
        state = project / ".harness-dispatch"
        os.symlink(outside, state)

        with self.assertRaisesRegex(provider.ProviderError, "must not be a symlink"):
            provider._validated_caller_state_root(state, project)

    def test_generator_reconciliation_rejects_protected_return_paths(self) -> None:
        for protected_path in (".gitattributes", ".circleci/config.yml"):
            with self.subTest(protected_path=protected_path):
                name = protected_path.replace("/", "-")
                baseline = self.root / f"baseline-{name}"
                returned = self.root / f"returned-{name}"
                staging = self.root / f"staging-{name}"
                for directory in (baseline, returned, staging):
                    directory.mkdir()
                write_file(returned / protected_path, "untrusted\n")
                write_file(returned / "docs" / "test-reports" / "handoff.json", "{}\n")

                with self.assertRaisesRegex(provider.ProviderError, "control-plane path"):
                    provider._reconcile_returned_source(
                        returned_root=returned,
                        baseline_root=baseline,
                        staging=staging,
                        role="generator",
                        artifact="docs/test-reports/handoff.json",
                    )

    def test_generator_reconciliation_preserves_returned_executable_mode(self) -> None:
        baseline = self.root / "baseline"
        returned = self.root / "returned"
        staging = self.root / "staging"
        for directory in (baseline, returned, staging):
            directory.mkdir()
        baseline_source = baseline / "src" / "run.sh"
        returned_source = returned / "src" / "run.sh"
        staging_source = staging / "src" / "run.sh"
        write_file(baseline_source, "before\n")
        write_file(returned_source, "after\n")
        write_file(staging_source, "before\n")
        os.chmod(baseline_source, 0o600)
        os.chmod(returned_source, 0o700)
        os.chmod(staging_source, 0o600)
        write_file(returned / "docs" / "test-reports" / "handoff.json", "{}\n")

        _artifact, changed = provider._reconcile_returned_source(
            returned_root=returned,
            baseline_root=baseline,
            staging=staging,
            role="generator",
            artifact="docs/test-reports/handoff.json",
        )

        self.assertEqual(changed, ("src/run.sh",))
        self.assertEqual(staging_source.read_text(encoding="utf-8"), "after\n")
        self.assertEqual(staging_source.stat().st_mode & 0o777, 0o700)

    def test_commissioned_artifact_may_overwrite_its_baseline_path(self) -> None:
        """FIX2 #2:A — the declared artifact path is a legal write point.

        A read-only role updating an already-tracked verdict file must be
        reconciled (and recorded) instead of failing after a full bridge run.
        """
        baseline = self.root / "baseline"
        returned = self.root / "returned"
        staging = self.root / "staging"
        for directory in (baseline, returned, staging):
            directory.mkdir()
        artifact = "docs/test-reports/batch-verdict.json"
        write_file(baseline / artifact, '{"round": 1}\n')
        write_file(returned / artifact, '{"round": 2}\n')

        staged, changed = provider._reconcile_returned_source(
            returned_root=returned,
            baseline_root=baseline,
            staging=staging,
            role="evaluator",
            artifact=artifact,
        )

        self.assertEqual(changed, (artifact,))
        self.assertEqual(staged.read_text(encoding="utf-8"), '{"round": 2}\n')

        # An identical returned artifact is an overwrite without a change.
        identical_staging = self.root / "staging-identical"
        identical_staging.mkdir()
        write_file(returned / artifact, '{"round": 1}\n')
        _, unchanged = provider._reconcile_returned_source(
            returned_root=returned,
            baseline_root=baseline,
            staging=identical_staging,
            role="evaluator",
            artifact=artifact,
        )
        self.assertEqual(unchanged, ())

    def test_generator_reconciliation_counts_executable_bit_change(self) -> None:
        baseline = self.root / "baseline"
        returned = self.root / "returned"
        staging = self.root / "staging"
        for directory in (baseline, returned, staging):
            directory.mkdir()
        baseline_source = baseline / "src" / "run.sh"
        returned_source = returned / "src" / "run.sh"
        staging_source = staging / "src" / "run.sh"
        write_file(baseline_source, "same\n")
        write_file(returned_source, "same\n")
        write_file(staging_source, "same\n")
        os.chmod(baseline_source, 0o600)
        os.chmod(returned_source, 0o700)
        os.chmod(staging_source, 0o600)
        write_file(returned / "docs" / "test-reports" / "handoff.json", "{}\n")

        _artifact, changed = provider._reconcile_returned_source(
            returned_root=returned,
            baseline_root=baseline,
            staging=staging,
            role="generator",
            artifact="docs/test-reports/handoff.json",
        )

        self.assertEqual(changed, ("src/run.sh",))
        self.assertEqual(staging_source.stat().st_mode & 0o777, 0o700)

    def test_generator_reconciliation_applies_only_ordinary_changed_source(self) -> None:
        baseline = self.root / "baseline"
        returned = self.root / "returned"
        staging = self.root / "staging"
        for directory in (baseline, returned, staging):
            directory.mkdir()
        write_file(baseline / "src" / "same.txt", "same\n")
        write_file(baseline / "src" / "changed.txt", "before\n")
        write_file(returned / "src" / "same.txt", "same\n")
        write_file(returned / "src" / "changed.txt", "after\n")
        write_file(returned / "docs" / "test-reports" / "handoff.json", "{}\n")
        write_file(staging / "src" / "same.txt", "same\n")
        write_file(staging / "src" / "changed.txt", "before\n")

        artifact, changed = provider._reconcile_returned_source(
            returned_root=returned,
            baseline_root=baseline,
            staging=staging,
            role="generator",
            artifact="docs/test-reports/handoff.json",
        )

        self.assertEqual(changed, ("src/changed.txt",))
        self.assertEqual((staging / "src" / "changed.txt").read_text(encoding="utf-8"), "after\n")
        self.assertEqual(artifact.read_text(encoding="utf-8"), "{}\n")

    def test_read_only_reconciliation_rejects_any_source_delta(self) -> None:
        baseline = self.root / "baseline"
        returned = self.root / "returned"
        staging = self.root / "staging"
        for directory in (baseline, returned, staging):
            directory.mkdir()
        write_file(baseline / "src" / "value.txt", "before\n")
        write_file(returned / "src" / "value.txt", "after\n")
        write_file(returned / "docs" / "test-reports" / "handoff.json", "{}\n")
        write_file(staging / "src" / "value.txt", "before\n")

        with self.assertRaises(provider.ProviderError):
            provider._reconcile_returned_source(
                returned_root=returned,
                baseline_root=baseline,
                staging=staging,
                role="evaluator",
                artifact="docs/test-reports/handoff.json",
            )

    def test_staging_parent_symlink_is_never_followed(self) -> None:
        baseline = self.root / "baseline"
        returned = self.root / "returned"
        staging = self.root / "staging"
        outside = self.root / "outside"
        for directory in (baseline, returned, staging, outside):
            directory.mkdir()
        write_file(returned / "docs" / "test-reports" / "handoff.json", "{}\n")
        os.symlink(outside, staging / "docs")

        with self.assertRaises(provider.ProviderError):
            provider._reconcile_returned_source(
                returned_root=returned,
                baseline_root=baseline,
                staging=staging,
                role="evaluator",
                artifact="docs/test-reports/handoff.json",
            )
        self.assertFalse((outside / "test-reports" / "handoff.json").exists())

    def test_guest_copyout_runner_rejects_worker_symlink(self) -> None:
        source = self.root / "source"
        state = self.root / "state"
        source.mkdir()
        state.mkdir()
        write_file(state / "bridge-result.json", "{}\n")
        write_file(source / "docs" / "test-reports" / "handoff.json", "{}\n")
        os.symlink(self.root / "outside", source / "escape")

        result = subprocess.run(
            [
                sys.executable,
                str(WORKER_PATH),
                "copyout",
                "--worktree",
                str(source),
                "--worker-state-root",
                str(state),
                "--artifact",
                "docs/test-reports/handoff.json",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, b"")


if __name__ == "__main__":
    unittest.main(verbosity=2)
