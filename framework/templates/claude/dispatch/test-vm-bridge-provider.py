#!/usr/bin/env python3
"""Focused boundary tests for the framework-owned vm-v1 bridge provider."""

from __future__ import annotations

import hashlib
import http.client
import importlib.util
import io
import json
import datetime as dt
import os
import socket
import subprocess
import sys
import tarfile
import tempfile
import threading
import types
import unittest
from pathlib import Path
from unittest import mock


HERE = Path(__file__).resolve().parent
PROVIDER_PATH = HERE / "transports" / "vm-bridge-provider.py"
WORKER_PATH = HERE / "transports" / "vm-bridge-worker.py"
DISPATCH_RUN_PATH = HERE / "dispatch-run.sh"


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


def dispatch_run_vm_provider_resolver() -> str:
    """Extract the fixed app/project mirror resolver from its shell entrypoint."""
    source = DISPATCH_RUN_PATH.read_text(encoding="utf-8")
    start = source.index("import hashlib\n", source.index("VM_PROVIDER="))
    end = source.index("\nPY\n", start)
    return source[start:end]


def kimi_bundle_manifest(
    *, identity: dict[str, str] | None = None, command: list[str] | None = None
) -> bytes:
    return json.dumps(
        {
            "version": "harness/vm-cli-bundle/1",
            "protocol_commands": {"acp-native-agent/v1": command or ["kimi", "acp"]},
            "kimi_identity": identity
            if identity is not None
            else {
                "user_agent": "kimi-code-cli/0.31.0",
                "x_msh_platform": "kimi_code_cli",
                "x_msh_version": "0.31.0",
            },
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def valid_kimi_request() -> dict[str, object]:
    return {
        "max_completion_tokens": 4096,
        "messages": [
            {"role": "system", "content": "system"},
            {"role": "user", "content": "probe"},
        ],
        "model": "kimi-for-coding",
        "prompt_cache_key": "test-cache-key",
        "stream": True,
        "stream_options": {"include_usage": True},
        "thinking": {"type": "enabled", "keep": "all"},
        "tools": [
            {
                "type": "function",
                "function": {"name": "Read", "parameters": {"type": "object"}},
            }
        ],
    }


class VmBridgeProviderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="vm-bridge-provider-")
        self.root = Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _broker_policy(self) -> provider.BrokerPolicy:
        return provider.BrokerPolicy(
            guest_broker_host=provider.LIMA_GUEST_GATEWAY,
            upstream_base_url=provider.KIMI_CODE_OAUTH_UPSTREAM,
            credential_source={"kind": "kimi-code-oauth-file-v1"},
        )

    def _kimi_identity(self) -> provider.KimiClientIdentity:
        return provider.KimiClientIdentity(
            user_agent="kimi-code-cli/0.31.0",
            x_msh_platform="kimi_code_cli",
            x_msh_version="0.31.0",
        )

    def _start_broker(self) -> provider._BrokerServer:
        server = provider._BrokerServer(
            (provider.BROKER_LISTEN_HOST, 0),
            self._broker_policy(),
            "guest-lease",
            "host-credential",
            self._kimi_identity(),
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 2)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server

    def _broker_request(
        self,
        server: provider._BrokerServer,
        *,
        method: str = "POST",
        path: str = "/chat/completions",
        payload: dict[str, object] | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, bytes, dict[str, str]]:
        body = b"" if payload is None else json.dumps(payload, separators=(",", ":")).encode("utf-8")
        request_headers = {
            "Authorization": "Bearer guest-lease",
            "Content-Type": "application/json",
            **(headers or {}),
        }
        connection = http.client.HTTPConnection(provider.BROKER_LISTEN_HOST, server.server_port, timeout=5)
        try:
            connection.request(method, path, body=body if body else None, headers=request_headers)
            response = connection.getresponse()
            return response.status, response.read(), dict(response.getheaders())
        finally:
            connection.close()

    def test_bundle_command_is_bound_to_the_hashed_bundle_manifest(self) -> None:
        bundle = self.root / "kimi.tar.gz"
        manifest = kimi_bundle_manifest()
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
        self.assertEqual(
            provider._catalog_supported_routes(bundle),
            [{
                "tool": "kimi",
                "protocol": {
                    "kind": "acp-native-agent/v1",
                    "command": ["kimi", "acp"],
                    "request_delivery": "stdin",
                    "response_format": "json",
                },
            }],
        )
        self.assertEqual(provider._bundle_kimi_identity(bundle), self._kimi_identity())

    def test_bundle_manifest_rejects_a_non_kimi_acp_command(self) -> None:
        bundle = self.root / "wrong-cli.tar.gz"
        manifest = kimi_bundle_manifest(command=["future-cli", "acp"])
        with tarfile.open(bundle, mode="w:gz") as archive:
            info = tarfile.TarInfo("harness-vm-bundle.json")
            info.size = len(manifest)
            archive.addfile(info, io.BytesIO(manifest))
            executable = tarfile.TarInfo("bin/future-cli")
            executable.size = 1
            executable.mode = 0o755
            archive.addfile(executable, io.BytesIO(b"x"))
        with self.assertRaisesRegex(provider.ProviderError, "fixed Kimi ACP"):
            provider._bundle_protocol_commands(bundle)

    def test_copyin_archive_uses_only_provider_private_snapshots(self) -> None:
        mutable = self.root / "mutable"
        inputs = self.root / "inputs"
        mutable.mkdir()
        inputs.mkdir(mode=0o700)
        runner_inputs = inputs / "runners"
        runner_inputs.mkdir(mode=0o700)

        def snapshot(name: str, contents: bytes, destination: Path) -> Path:
            source = mutable / name
            source.write_bytes(contents)
            provider._snapshot_regular_file(source, destination, name)
            source.write_bytes(b"changed-after-snapshot")
            return source

        envelope = inputs / "envelope.json"
        target = inputs / "target.json"
        bundle = inputs / "cli-bundle.tar.gz"
        snapshot("envelope-source", b'{"before":true}\n', envelope)
        snapshot("target-source", b'{"target":"before"}\n', target)
        snapshot("bundle-source", b"bundle-before", bundle)
        runners: dict[str, Path] = {}
        for name in provider.RUNNER_NAMES:
            runner = runner_inputs / name
            snapshot(f"runner-{name}", f"runner-before:{name}".encode("ascii"), runner)
            runners[name] = runner

        source_tar = io.BytesIO()
        with tarfile.open(fileobj=source_tar, mode="w") as archive:
            for name, contents in (
                ("README.txt", b"source-before\n"),
                ("AGENTS.md", b"untrusted instruction\n"),
                ("nested/AGENTS.md", b"untrusted nested instruction\n"),
                (".kimi-code/credentials.json", b"credential-looking input\n"),
                (".agents/override.json", b"agent override\n"),
            ):
                info = tarfile.TarInfo(name)
                info.size = len(contents)
                archive.addfile(info, io.BytesIO(contents))

        def fake_git_archive(
            _project_root: Path, _ref: str, stream: object, *, label: str
        ) -> None:
            self.assertIn("commissioned source", label)
            assert hasattr(stream, "write")
            stream.write(source_tar.getvalue())

        archive_path = self.root / "copyin.tar.gz"
        with mock.patch.object(provider, "_stream_commissioned_git_archive", side_effect=fake_git_archive):
            provider._create_copyin_archive(
                project_root=self.root,
                ref="a" * 40,
                envelope=envelope,
                target=target,
                cli_bundle=bundle,
                runners=runners,
                destination=archive_path,
            )

        with tarfile.open(archive_path, mode="r:gz") as archive:
            def contents(name: str) -> bytes:
                stream = archive.extractfile(name)
                assert stream is not None
                with stream:
                    return stream.read()

            self.assertEqual(contents("source/README.txt"), b"source-before\n")
            self.assertNotIn("source/AGENTS.md", archive.getnames())
            self.assertNotIn("source/nested/AGENTS.md", archive.getnames())
            self.assertNotIn("source/.kimi-code/credentials.json", archive.getnames())
            self.assertNotIn("source/.agents/override.json", archive.getnames())
            self.assertEqual(contents(".harness-envelope.json"), b'{"before":true}\n')
            self.assertEqual(contents(".harness-target.json"), b'{"target":"before"}\n')
            self.assertEqual(contents(".harness-cli-bundle.tar.gz"), b"bundle-before")
            for name in provider.RUNNER_NAMES:
                self.assertEqual(
                    contents(f".harness-runner/{name}"),
                    f"runner-before:{name}".encode("ascii"),
                )

    def test_snapshot_regular_file_freezes_raw_bytes_and_digest(self) -> None:
        source = self.root / "envelope.json"
        snapshots = self.root / "snapshots"
        snapshots.mkdir(mode=0o700)
        destination = snapshots / "envelope.json"
        original = b'{"task_id":"before"}\n'
        source.write_bytes(original)

        digest = provider._snapshot_regular_file(source, destination, "bridge envelope")
        source.write_bytes(b'{"task_id":"after"}\n')

        self.assertEqual(digest, hashlib.sha256(original).hexdigest())
        self.assertEqual(destination.read_bytes(), original)

    def test_source_archive_and_guest_copyin_have_hard_byte_and_entry_limits(self) -> None:
        raw_archive = io.BytesIO()
        with tarfile.open(fileobj=raw_archive, mode="w") as archive:
            for name in ("one.txt", "two.txt"):
                info = tarfile.TarInfo(name)
                info.size = 1
                archive.addfile(info, io.BytesIO(b"x"))
        raw_archive.seek(0)
        with tarfile.open(fileobj=raw_archive, mode="r:") as archive, mock.patch.object(
            provider, "MAX_SOURCE_ARCHIVE_ENTRIES", 1
        ):
            with self.assertRaisesRegex(provider.ProviderError, "entry limit"):
                list(
                    provider._bounded_source_archive_members(
                        archive, label="test source archive"
                    )
                )

        copyin = self.root / "copyin.tar.gz"
        copyin.write_bytes(b"0123456789")
        os.chmod(copyin, 0o600)
        with mock.patch.object(provider, "MAX_COPYIN_ARCHIVE_BYTES", 9):
            with self.assertRaisesRegex(provider.ProviderError, "size limit"):
                provider._copy_archive_to_guest(
                    types.SimpleNamespace(),
                    copyin,
                    f"/var/lib/harness-vm-v1/jobs/{'a' * 32}",
                    ("kimi",),
                )

        with mock.patch.object(
            provider,
            "_run_vm",
            return_value=subprocess.CompletedProcess([], 0, stdout=b""),
        ) as run_vm:
            provider._copy_archive_to_guest(
                types.SimpleNamespace(),
                copyin,
                f"/var/lib/harness-vm-v1/jobs/{'a' * 32}",
                ("kimi",),
            )
        self.assertEqual(run_vm.call_args.kwargs["input_path"], copyin)
        self.assertNotIn("input_bytes", run_vm.call_args.kwargs)

    def test_baseline_source_snapshot_streams_git_archive_to_private_storage(self) -> None:
        source_tar = io.BytesIO()
        with tarfile.open(fileobj=source_tar, mode="w") as archive:
            for name, contents in (
                ("src/value.txt", b"baseline\n"),
                ("AGENTS.md", b"host instruction\n"),
                (".kimi-code/state.json", b"sensitive state\n"),
                (".agents/role.json", b"role state\n"),
            ):
                info = tarfile.TarInfo(name)
                info.size = len(contents)
                archive.addfile(info, io.BytesIO(contents))

        def fake_git_archive(
            _project_root: Path, _ref: str, stream: object, *, label: str
        ) -> None:
            self.assertIn("baseline", label)
            assert hasattr(stream, "write")
            stream.write(source_tar.getvalue())

        baseline = self.root / "baseline"
        with mock.patch.object(provider, "_stream_commissioned_git_archive", side_effect=fake_git_archive):
            provider._create_baseline_source(self.root, "a" * 40, baseline)

        self.assertEqual((baseline / "src" / "value.txt").read_bytes(), b"baseline\n")
        self.assertFalse((baseline / "AGENTS.md").exists())
        self.assertFalse((baseline / ".kimi-code").exists())
        self.assertFalse((baseline / ".agents").exists())

    def test_launch_attestation_binds_the_raw_envelope_snapshot(self) -> None:
        configuration = types.SimpleNamespace(
            contract_sha256="a" * 64,
            image_sha256="b" * 64,
            broker_policy_sha256="c" * 64,
        )
        attestation, _nonce = provider.launch_attestation(
            configuration,
            "d" * 64,
            envelope_sha256="e" * 64,
            runner_sha256="f" * 64,
            cli_bundle_sha256="0" * 64,
        )

        self.assertEqual(attestation["phase"], "launch")
        self.assertEqual(attestation["target_provenance_sha256"], "d" * 64)
        self.assertEqual(attestation["envelope_sha256"], "e" * 64)
        self.assertEqual(attestation["runner_sha256"], "f" * 64)
        self.assertEqual(attestation["cli_bundle_sha256"], "0" * 64)
        issued_at = dt.datetime.fromisoformat(attestation["issued_at"].replace("Z", "+00:00"))
        expires_at = dt.datetime.fromisoformat(attestation["expires_at"].replace("Z", "+00:00"))
        self.assertEqual(
            (expires_at - issued_at).total_seconds(),
            provider.LAUNCH_ATTESTATION_TTL_SECONDS,
        )

    def test_catalog_attestation_keeps_the_short_discovery_lifetime(self) -> None:
        configuration = types.SimpleNamespace(
            contract_sha256="a" * 64,
            image_sha256="b" * 64,
            broker_policy_sha256="c" * 64,
            cli_bundle_sha256="d" * 64,
        )
        issued = dt.datetime(2026, 8, 2, tzinfo=dt.timezone.utc)
        with mock.patch.object(provider, "_utc_now", return_value=issued), mock.patch.object(
            provider, "_runner_sha256", return_value="e" * 64
        ):
            attestation = provider._attestation(
                configuration,
                phase="catalog",
                supported_routes=[
                    {
                        "tool": "kimi",
                        "protocol": {
                            "kind": "acp-native-agent/v1",
                            "command": ["kimi", "acp"],
                            "request_delivery": "stdin",
                            "response_format": "json",
                        },
                    }
                ],
            )

        expires_at = dt.datetime.fromisoformat(attestation["expires_at"].replace("Z", "+00:00"))
        self.assertEqual(
            (expires_at - issued).total_seconds(),
            provider.CATALOG_ATTESTATION_TTL_SECONDS,
        )
        self.assertEqual(attestation["supported_routes"][0]["tool"], "kimi")
        self.assertNotIn("target_provenance_sha256", attestation)

    def test_external_timeout_is_capped_at_180_seconds(self) -> None:
        self.assertEqual(provider._validated_external_timeout(180), 180)
        for value in (False, 0, 181, None):
            with self.subTest(value=value):
                with self.assertRaises(provider.ProviderError):
                    provider._validated_external_timeout(value)

    def test_live_lima_image_binding_requires_first_aarch64_candidate(self) -> None:
        location = "https://cloud-images.example.invalid/fixed-arm64.img"
        configuration = types.SimpleNamespace(
            image_location=location,
            image_sha256="a" * 64,
        )
        matching = {
            "images": [
                {"arch": "x86_64", "location": "https://example.invalid/x86", "digest": "sha256:b"},
                {"arch": "aarch64", "location": location, "digest": f"sha256:{configuration.image_sha256}"},
            ]
        }
        provider._validate_live_image_binding(matching, configuration)

        fallback_first = {
            "images": [
                {"arch": "aarch64", "location": "https://example.invalid/unpinned", "digest": "sha256:bad"},
                matching["images"][1],
            ]
        }
        with self.assertRaisesRegex(provider.ProviderError, "live image"):
            provider._validate_live_image_binding(fallback_first, configuration)

    def test_lima_commands_receive_only_the_passwd_derived_home(self) -> None:
        configuration = types.SimpleNamespace(
            executable=Path("/fixed/limactl"), profile="harness-vm-v1"
        )
        completed = subprocess.CompletedProcess([], 0, stdout=b"")
        expected_environment = {
            "HOME": "/fixed/provider-home",
            "PATH": "/usr/bin:/bin",
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
        }
        with mock.patch.object(
            provider, "_home_directory", return_value=Path("/fixed/provider-home")
        ), mock.patch.object(
            provider.subprocess, "run", return_value=completed
        ) as run:
            provider._run_vm(configuration, ["true"])
        self.assertEqual(run.call_args.kwargs["env"], expected_environment)

        runtime = {
            "vmType": "vz",
            "plain": True,
            "propagateProxyEnv": False,
            "mounts": [],
            "portForwards": [],
            "networks": [],
            "ssh": {
                "loadDotSSHPubKeys": False,
                "forwardAgent": False,
                "forwardX11": False,
                "forwardX11Trusted": False,
            },
            "hostResolver": {"enabled": False},
            "containerd": {"system": False, "user": False},
            "images": [
                {
                    "arch": "aarch64",
                    "location": "https://cloud-images.example.invalid/fixed-arm64.img",
                    "digest": "sha256:" + "a" * 64,
                }
            ],
        }
        status = {
            "name": "harness-vm-v1",
            "status": "Running",
            "vmType": "vz",
            "arch": "aarch64",
            "config": runtime,
        }
        status_configuration = types.SimpleNamespace(
            executable=Path("/fixed/limactl"),
            profile="harness-vm-v1",
            image_location=runtime["images"][0]["location"],
            image_sha256="a" * 64,
        )
        with mock.patch.object(
            provider, "_home_directory", return_value=Path("/fixed/provider-home")
        ), mock.patch.object(
            provider.subprocess,
            "run",
            return_value=subprocess.CompletedProcess([], 0, stdout=json.dumps(status).encode("utf-8")),
        ) as run:
            provider._validated_lima_status(status_configuration)
        self.assertEqual(run.call_args.kwargs["env"], expected_environment)

    def test_vm_readiness_requires_the_fixed_setpriv_binary(self) -> None:
        configuration = types.SimpleNamespace()
        completed = subprocess.CompletedProcess([], 0, stdout=b"")
        with mock.patch.object(provider, "_validated_lima_status"), mock.patch.object(
            provider, "_run_vm", return_value=completed
        ) as run_vm:
            provider._assert_vm_ready(configuration)
        command = run_vm.call_args.args[1]
        self.assertEqual(command[:4], ["sudo", "-n", "sh", "-ec"])
        script = command[4]
        self.assertIn("test -x /usr/bin/setpriv", script)
        self.assertIn("test ! -L /usr/bin/setpriv", script)

    def test_launch_lock_is_private_and_reports_a_busy_vm(self) -> None:
        runs = self.root / "runs"
        runs.mkdir(mode=0o700)
        with provider._exclusive_provider_launch_lock(runs):
            self.assertTrue((runs / ".launch.lock").is_file())

        busy = BlockingIOError(provider.errno.EAGAIN, "busy")
        with mock.patch.object(provider, "LAUNCH_LOCK_WAIT_SECONDS", 0), mock.patch.object(
            provider.fcntl, "flock", side_effect=busy
        ):
            with self.assertRaisesRegex(provider.ProviderError, "already in progress"):
                with provider._exclusive_provider_launch_lock(runs):
                    pass

    def test_guest_firewall_is_reset_to_the_provider_deny_baseline(self) -> None:
        configuration = types.SimpleNamespace()
        completed = subprocess.CompletedProcess([], 0, stdout=b"")
        with mock.patch.object(provider, "_run_vm", return_value=completed) as run_vm:
            provider._reset_guest_egress_baseline(configuration)

        command = run_vm.call_args.args[1]
        self.assertEqual(command[:2], ["sh", "-ec"])
        script = command[2]
        self.assertIn("iptables -w -F OUTPUT", script)
        self.assertIn("iptables -w -P OUTPUT DROP", script)
        self.assertIn("-A OUTPUT -o lo -j ACCEPT", script)
        self.assertIn("ESTABLISHED,RELATED", script)
        self.assertNotIn("iptables-save", script)
        self.assertNotIn("iptables-restore", script)

    def test_guest_unit_has_hard_resource_limits_and_isolated_python(self) -> None:
        configuration = types.SimpleNamespace()
        token = "a" * 32
        guest_root = f"/var/lib/harness-vm-v1/jobs/{token}"
        unit = f"harness-vm-v1-{token}"
        with mock.patch.object(
            provider,
            "_run_vm",
            return_value=subprocess.CompletedProcess([], 0, stdout=b""),
        ) as run_vm:
            provider._guest_restricted_unit(
                configuration,
                guest_root=guest_root,
                unit=unit,
                timeout=240,
                environment={"PATH": "/usr/bin:/bin"},
                program=["/usr/bin/python3", "-I", "/trusted/runner.py"],
                network_host=None,
                root_supervisor=False,
            )
        command = run_vm.call_args.args[1]
        for property_value in (
            "--property=RuntimeMaxSec=180s",
            "--property=MemoryMax=1G",
            "--property=TasksMax=128",
            "--property=CPUQuota=200%",
            "--property=LimitNOFILE=4096",
            "--uid=root",
            "--property=CapabilityBoundingSet=CAP_DAC_READ_SEARCH",
            "--property=RestrictSUIDSGID=yes",
        ):
            self.assertIn(property_value, command)

        with mock.patch.object(
            provider,
            "_run_vm",
            return_value=subprocess.CompletedProcess([], 0, stdout=b""),
        ) as run_vm:
            provider._guest_restricted_unit(
                configuration,
                guest_root=guest_root,
                unit=unit,
                timeout=240,
                environment={"PATH": "/usr/bin:/bin"},
                program=["/usr/bin/python3", "-I", "/trusted/runner.py"],
                network_host=None,
                root_supervisor=True,
            )
        supervisor_command = run_vm.call_args.args[1]
        self.assertIn(
            "--property=CapabilityBoundingSet="
            "CAP_CHOWN CAP_DAC_OVERRIDE CAP_FOWNER CAP_KILL CAP_SETGID CAP_SETUID",
            supervisor_command,
        )
        self.assertIn(
            "--property=AmbientCapabilities=CAP_SETUID CAP_SETGID",
            supervisor_command,
        )
        self.assertIn("--property=NoNewPrivileges=yes", supervisor_command)
        self.assertIn("--property=UMask=0077", supervisor_command)
        self.assertNotIn("CAP_SETPCAP", " ".join(supervisor_command))
        self.assertNotIn("--property=RestrictSUIDSGID=yes", supervisor_command)

        broker = types.SimpleNamespace(
            lease="lease",
            guest_base_url="http://192.168.5.2:12345",
            policy=types.SimpleNamespace(guest_broker_host=provider.LIMA_GUEST_GATEWAY),
        )
        with mock.patch.object(
            provider,
            "_guest_restricted_unit",
            side_effect=[None, subprocess.CompletedProcess([], 0, stdout=b"copyout")],
        ) as restricted_unit:
            provider._run_guest_worker(
                configuration,
                guest_root=guest_root,
                unit=unit,
                timeout_s=180,
                launch_nonce="nonce",
                launch_attestation_sha256="b" * 64,
                broker=broker,
            )
            self.assertEqual(
                provider._guest_copyout(
                    configuration,
                    guest_root=guest_root,
                    artifact="docs/test-reports/result.json",
                    unit=unit,
                ),
                b"copyout",
            )
        for call in restricted_unit.call_args_list:
            program = call.kwargs["program"]
            self.assertEqual(program[:2], ["/usr/bin/python3", "-I"])
        self.assertTrue(restricted_unit.call_args_list[0].kwargs["root_supervisor"])
        self.assertFalse(restricted_unit.call_args_list[1].kwargs["root_supervisor"])
        supervisor_program = restricted_unit.call_args_list[0].kwargs["program"]
        self.assertIn("--receipt", supervisor_program)
        self.assertNotIn("--result", supervisor_program)
        copyout_program = restricted_unit.call_args_list[1].kwargs["program"]
        self.assertIn("--receipt", copyout_program)
        self.assertNotIn("--worker-state-root", copyout_program)

    def test_cleanup_fails_closed_when_the_guest_root_cannot_be_proven_removed(self) -> None:
        configuration = types.SimpleNamespace()
        guest_root = f"/var/lib/harness-vm-v1/jobs/{'a' * 32}"
        unit = f"harness-vm-v1-{'a' * 32}"
        with mock.patch.object(
            provider,
            "_run_vm",
            return_value=subprocess.CompletedProcess([], 1, stdout=b"", stderr=b""),
        ):
            with self.assertRaisesRegex(provider.ProviderError, "could not prove guest job cleanup"):
                provider._cleanup_guest_job(configuration, guest_root, unit)

    def test_bundle_manifest_rejects_unbound_or_forged_kimi_identity(self) -> None:
        for identity in (
            {},
            {
                "user_agent": "harness-vm-v1",
                "x_msh_platform": "kimi_code_cli",
                "x_msh_version": "0.31.0",
            },
        ):
            with self.subTest(identity=identity):
                bundle = self.root / f"invalid-{len(identity)}.tar.gz"
                manifest = kimi_bundle_manifest(identity=identity)
                with tarfile.open(bundle, mode="w:gz") as archive:
                    info = tarfile.TarInfo("harness-vm-bundle.json")
                    info.size = len(manifest)
                    archive.addfile(info, io.BytesIO(manifest))
                    executable = tarfile.TarInfo("bin/kimi")
                    executable.size = 1
                    executable.mode = 0o755
                    archive.addfile(executable, io.BytesIO(b"x"))
                with self.assertRaisesRegex(provider.ProviderError, "Kimi identity"):
                    provider._bundle_kimi_identity(bundle)

    def test_broker_policy_requires_the_fixed_lima_gateway_kimi_oauth_and_credential_source(self) -> None:
        path = self.root / "broker-policy.json"

        def load_policy(
            *, gateway: str, upstream: str, source: dict[str, str] | None = None
        ) -> provider.BrokerPolicy:
            path.write_text(
                json.dumps(
                    {
                        "version": "harness/vm-broker-policy/1",
                        "guest_broker_host": gateway,
                        "upstream_base_url": upstream,
                        "credential_source": source or {"kind": "kimi-code-oauth-file-v1"},
                    }
                ),
                encoding="utf-8",
            )
            return provider._broker_policy(types.SimpleNamespace(broker_policy=path))

        policy = load_policy(
            gateway="192.168.5.2",
            upstream="https://api.kimi.com/coding/v1/",
        )
        self.assertEqual(policy.guest_broker_host, "192.168.5.2")
        self.assertEqual(policy.upstream_base_url, "https://api.kimi.com/coding/v1")
        with self.assertRaisesRegex(provider.ProviderError, "plain-Lima gateway"):
            load_policy(
                gateway="192.168.5.3",
                upstream="https://api.kimi.com/coding/v1",
            )
        with self.assertRaisesRegex(provider.ProviderError, "fixed Kimi Code endpoint"):
            load_policy(
                gateway="192.168.5.2",
                upstream="https://example.invalid/coding/v1",
            )
        with self.assertRaisesRegex(provider.ProviderError, "fixed Kimi OAuth source"):
            load_policy(
                gateway="192.168.5.2",
                upstream="https://api.kimi.com/coding/v1",
                source={
                    "kind": "macos-keychain-generic-password-v1",
                    "service": "other-service",
                    "account": "other-account",
                },
            )

    def test_broker_credential_reader_rejects_a_non_kimi_policy_before_reading_host_state(self) -> None:
        forged = provider.BrokerPolicy(
            guest_broker_host=provider.LIMA_GUEST_GATEWAY,
            upstream_base_url=provider.KIMI_CODE_OAUTH_UPSTREAM,
            credential_source={"kind": "macos-keychain-generic-password-v1"},
        )
        with self.assertRaisesRegex(provider.ProviderError, "fixed Kimi OAuth"):
            provider._read_broker_credential(forged)

    def test_dispatch_run_resolves_a_byte_identical_dispatch_relative_mirror(self) -> None:
        self.assertIn(Path("validate-active-return-route.py"), provider.APP_RUNTIME_FILES)
        app_root = self.root / "installed-app"
        app_dispatch = app_root / "framework" / "templates" / "claude" / "dispatch"
        project_root = self.root / "project"
        project_dispatch = project_root / ".claude" / "dispatch"
        files = {
            "tool-catalog.py": b"catalog bytes\n",
            "dispatch_common.py": b"common bytes\n",
            "validate-active-return-route.py": b"route bytes\n",
            "transports/vm-bridge-provider.py": b"provider bytes\n",
            "transports/session-bridge.py": b"bridge bytes\n",
            "transports/session_bridge_kimi.py": b"kimi bytes\n",
            "transports/vm-bridge-worker.py": b"worker bytes\n",
        }
        for relative, contents in files.items():
            app_path = app_dispatch / relative
            project_path = project_dispatch / relative
            app_path.parent.mkdir(parents=True, exist_ok=True)
            project_path.parent.mkdir(parents=True, exist_ok=True)
            app_path.write_bytes(contents)
            project_path.write_bytes(contents)

        resolver = dispatch_run_vm_provider_resolver().replace(
            "root = home / \".tokenizer\" / \"app\"",
            "root = Path(sys.argv[2])",
            1,
        )

        def resolve() -> subprocess.CompletedProcess[str]:
            return subprocess.run(
                [sys.executable, "-I", "-", str(project_root), str(app_root)],
                input=resolver,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                check=False,
            )

        resolved = resolve()
        self.assertEqual(resolved.returncode, 0, resolved.stderr)
        self.assertEqual(
            resolved.stdout.strip(),
            str(app_dispatch / "transports" / "vm-bridge-provider.py"),
        )

        (project_dispatch / "transports" / "session_bridge_kimi.py").write_bytes(b"drift\n")
        self.assertEqual(resolve().returncode, 2)

    def test_broker_credential_reader_requires_a_full_broker_lease_lifetime(self) -> None:
        home = self.root / "provider-home"
        credential = home / ".kimi-code" / "credentials" / "kimi-code.json"
        credential.parent.mkdir(parents=True)
        now = dt.datetime(2026, 8, 2, tzinfo=dt.timezone.utc)

        def write_credential(remaining_seconds: int) -> None:
            credential.write_text(
                json.dumps(
                    {
                        "access_token": "host-credential",
                        "expires_at": int(now.timestamp()) + remaining_seconds,
                    }
                ),
                encoding="utf-8",
            )
            credential.chmod(0o600)

        with mock.patch.object(provider, "_home_directory", return_value=home), mock.patch.object(
            provider, "_utc_now", return_value=now
        ):
            write_credential(provider.MIN_BROKER_CREDENTIAL_LIFETIME_SECONDS)
            with self.assertRaisesRegex(provider.ProviderError, "full broker lease lifetime"):
                provider._read_broker_credential(self._broker_policy())

            write_credential(provider.MIN_BROKER_CREDENTIAL_LIFETIME_SECONDS + 1)
            self.assertEqual(
                provider._read_broker_credential(self._broker_policy()), "host-credential"
            )

    def test_broker_binds_to_loopback_and_rejects_non_loopback_peers(self) -> None:
        with mock.patch.object(provider, "_read_broker_credential", return_value="host-credential"):
            with provider.BrokerLease(self._broker_policy(), self._kimi_identity()) as lease:
                assert lease._server is not None
                self.assertEqual(lease._server.server_address[0], provider.BROKER_LISTEN_HOST)
        self.assertTrue(provider._is_loopback_peer("127.0.0.1"))
        self.assertTrue(provider._is_loopback_peer("::1"))
        self.assertFalse(provider._is_loopback_peer("192.168.5.15"))
        self.assertFalse(provider._is_loopback_peer("not-an-address"))

    def test_broker_revoke_clears_credential_and_stops_new_requests(self) -> None:
        server = provider._BrokerServer(
            (provider.BROKER_LISTEN_HOST, 0),
            self._broker_policy(),
            "guest-lease",
            "host-credential",
            self._kimi_identity(),
        )
        self.addCleanup(server.server_close)
        self.assertTrue(server.reserve_request())
        self.assertEqual(server.credential_for_request(), "host-credential")
        self.assertTrue(server.authorize_lease("Bearer guest-lease"))

        server.revoke()

        self.assertIsNone(server.credential_for_request())
        self.assertFalse(server.authorize_lease("Bearer guest-lease"))
        self.assertFalse(server.reserve_request())

    def test_broker_sets_a_timeout_before_a_connection_reaches_a_handler(self) -> None:
        server = provider._BrokerServer(
            (provider.BROKER_LISTEN_HOST, 0),
            self._broker_policy(),
            "guest-lease",
            "host-credential",
            self._kimi_identity(),
        )
        self.addCleanup(server.server_close)
        client = socket.create_connection(server.server_address, timeout=5)
        self.addCleanup(client.close)
        request, _address = server.get_request()
        self.addCleanup(request.close)
        self.assertEqual(request.gettimeout(), provider.BROKER_CLIENT_TIMEOUT_SECONDS)

    def test_broker_only_forwards_the_bound_kimi_chat_contract(self) -> None:
        calls: list[dict[str, object]] = []

        class FakeResponse:
            status = 200

            def read(self, _limit: int) -> bytes:
                return b'{"ok":true}'

            def getheaders(self) -> list[tuple[str, str]]:
                return [("Content-Type", "application/json"), ("Set-Cookie", "must-not-pass")]

        class FakeConnection:
            def __init__(self, host: str, port: int, timeout: int) -> None:
                self.host = host
                self.port = port
                self.timeout = timeout

            def request(self, method: str, path: str, body: bytes, headers: dict[str, str]) -> None:
                calls.append({"method": method, "path": path, "body": body, "headers": headers})

            def getresponse(self) -> FakeResponse:
                return FakeResponse()

            def close(self) -> None:
                return

        server = self._start_broker()
        with mock.patch.object(provider.http.client, "HTTPSConnection", FakeConnection):
            status, body, response_headers = self._broker_request(
                server,
                payload=valid_kimi_request(),
                headers={
                    "Accept": "text/html",
                    "Accept-Encoding": "gzip",
                    "User-Agent": "forged-agent",
                    "X-Msh-Platform": "forged-platform",
                    "X-Msh-Version": "999.0.0",
                },
            )
        self.assertEqual(status, 200)
        self.assertEqual(body, b'{"ok":true}')
        self.assertNotIn("Set-Cookie", response_headers)
        self.assertEqual(len(calls), 1)
        call = calls[0]
        self.assertEqual(call["method"], "POST")
        self.assertEqual(call["path"], "/coding/v1/chat/completions")
        self.assertEqual(json.loads(call["body"]), valid_kimi_request())
        self.assertEqual(
            call["headers"],
            {
                "Host": "api.kimi.com",
                "Authorization": "Bearer host-credential",
                "Accept": "application/json",
                "Content-Type": "application/json",
                "User-Agent": "kimi-code-cli/0.31.0",
                "X-Msh-Platform": "kimi_code_cli",
                "X-Msh-Version": "0.31.0",
                "Content-Length": str(len(call["body"])),
            },
        )

    def test_broker_rejects_other_routes_queries_and_invalid_wire_shape(self) -> None:
        server = self._start_broker()
        status, _body, _headers = self._broker_request(
            server,
            method="GET",
            payload=None,
        )
        self.assertEqual(status, 405)
        status, _body, _headers = self._broker_request(
            server,
            path="/chat/completions?attempt=1",
            payload=valid_kimi_request(),
        )
        self.assertEqual(status, 404)
        invalid = valid_kimi_request()
        invalid["model"] = "other-model"
        status, _body, _headers = self._broker_request(server, payload=invalid)
        self.assertEqual(status, 400)
        status, _body, _headers = self._broker_request(
            server,
            payload=valid_kimi_request(),
            headers={"Content-Type": "text/plain"},
        )
        self.assertEqual(status, 415)

    def test_broker_enforces_its_per_lease_request_budget(self) -> None:
        calls: list[tuple[str, str]] = []

        class FakeResponse:
            status = 200

            def read(self, _limit: int) -> bytes:
                return b"{}"

            def getheaders(self) -> list[tuple[str, str]]:
                return []

        class FakeConnection:
            def __init__(self, _host: str, _port: int, timeout: int) -> None:
                return

            def request(self, method: str, path: str, body: bytes, headers: dict[str, str]) -> None:
                calls.append((method, path))

            def getresponse(self) -> FakeResponse:
                return FakeResponse()

            def close(self) -> None:
                return

        server = self._start_broker()
        with mock.patch.object(provider, "MAX_BROKER_REQUESTS", 1), mock.patch.object(
            provider.http.client, "HTTPSConnection", FakeConnection
        ):
            first, _body, _headers = self._broker_request(server, payload=valid_kimi_request())
            second, _body, _headers = self._broker_request(server, payload=valid_kimi_request())
        self.assertEqual(first, 200)
        self.assertEqual(second, 429)
        self.assertEqual(calls, [("POST", "/coding/v1/chat/completions")])

    def test_copyout_rejects_link_entries_before_extracting(self) -> None:
        destination = self.root / "pipe"
        destination.mkdir()
        payload = copyout_payload({"receipt/bridge-result.json": b"{}"}, link=True)
        with self.assertRaises(provider.ProviderError):
            provider._extract_copyout(payload, destination)

    def test_copyout_rejects_non_normalized_file_mode(self) -> None:
        destination = self.root / "pipe"
        destination.mkdir()
        payload = copyout_payload(
            {"receipt/bridge-result.json": b"{}"}, mode=0o644
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

    def test_generator_reconciliation_rejects_instruction_and_cli_state_paths(self) -> None:
        for protected_path in (
            "AGENTS.md",
            "nested/AGENTS.md",
            ".kimi-code/credentials.json",
            ".agents/role.json",
        ):
            with self.subTest(protected_path=protected_path):
                name = protected_path.replace("/", "-")
                baseline = self.root / f"baseline-control-{name}"
                returned = self.root / f"returned-control-{name}"
                staging = self.root / f"staging-control-{name}"
                for directory in (baseline, returned, staging):
                    directory.mkdir()
                write_file(returned / protected_path, "untrusted\n")
                write_file(returned / "docs" / "test-reports" / "handoff.json", "{}\n")

                with self.assertRaisesRegex(provider.ProviderError, "protected source path"):
                    provider._reconcile_returned_source(
                        returned_root=returned,
                        baseline_root=baseline,
                        staging=staging,
                        role="generator",
                        artifact="docs/test-reports/handoff.json",
                    )

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
        receipt = self.root / "receipt"
        source.mkdir()
        receipt.mkdir()
        write_file(receipt / "bridge-result.json", "{}\n")
        write_file(source / "docs" / "test-reports" / "handoff.json", "{}\n")
        os.symlink(self.root / "outside", source / "escape")

        result = subprocess.run(
            [
                sys.executable,
                str(WORKER_PATH),
                "copyout",
                "--worktree",
                str(source),
                "--receipt",
                str(receipt / "bridge-result.json"),
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
