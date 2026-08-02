#!/usr/bin/env python3
"""Framework-owned ``vm-v1`` external same-session bridge provider.

The catalog invokes ``catalog-attest`` through this exact sibling file.  The
provider deliberately has no registry, PATH, device-report, or environment
discovery path: its single local configuration location is derived from the
effective account's passwd entry, and every executable/artifact it uses is
named by an absolute, non-symlinked, content-addressed configuration record.

The installed runtime is intentionally fail-closed.  A missing, malformed, or
drifted VM/broker bundle returns an unavailable observation; it never falls
back to the historical same-UID sandbox route.
"""

from __future__ import annotations

import argparse
import copy
import datetime as dt
import hashlib
import hmac
import http.client
import http.server
import io
import json
import os
import pwd
import re
import secrets
import stat
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Any


CONFIG_VERSION = "harness/vm-v1-provider-config/1"
ATTESTATION_VERSION = "harness/external-bridge-provider-attestation/1"
CONTRACT_VERSION = "harness/external-bridge-provider/1"
PROVIDER_ID = "harness-vm-v1"
PROVIDER_KIND = "vm-v1"
LIMA_RUNTIME_KIND = "lima-vz-plain-v1"
WORKER_USER = "harnessvm"
MAX_TTL_SECONDS = 300
MAX_COPYOUT_FILES = 10_000
MAX_COPYOUT_BYTES = 64 * 1024 * 1024
SHA256 = re.compile(r"^[0-9a-f]{64}$")
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
SAFE_ARTIFACT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$")
SAFE_GUEST_ROOT = re.compile(r"^/var/lib/harness-vm-v1/jobs/[0-9a-f]{32}$")

CONTRACT_FIELDS = {
    "contract_version",
    "provider_id",
    "provider_kind",
    "same_session_bridge",
    "isolation_principal",
    "workspace_transport",
    "host_filesystem",
    "coordinator_paths_hidden",
    "launch_binding",
    "credential_flow",
    "network_egress",
    "lifecycle",
    "result_channel",
    "attestation",
}
CONFIG_FIELDS = {"version", "enabled", "contract", "runtime", "broker"}
RUNTIME_FIELDS = {
    "kind",
    "executable",
    "executable_sha256",
    "profile",
    "profile_config",
    "profile_config_sha256",
    "image",
    "image_sha256",
    "cli_bundle",
    "cli_bundle_sha256",
}
BROKER_FIELDS = {"policy", "policy_sha256"}
BROKER_POLICY_VERSION = "harness/vm-broker-policy/1"
CLI_BUNDLE_MANIFEST_VERSION = "harness/vm-cli-bundle/1"
BROKER_POLICY_FIELDS = {
    "version",
    "guest_broker_host",
    "upstream_base_url",
    "credential_source",
}


class ProviderError(ValueError):
    """The strict VM provider cannot make a trustworthy observation."""


def _canonical_sha256(domain: str, value: Any) -> str:
    encoded = json.dumps(
        value, ensure_ascii=True, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode("utf-8")
    return hashlib.sha256(domain.encode("ascii") + b"\0" + encoded).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _utc_text(value: dt.datetime) -> str:
    return value.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _home_directory() -> Path:
    try:
        home = pwd.getpwuid(os.geteuid()).pw_dir
    except (KeyError, OSError) as exc:
        raise ProviderError("cannot determine the provider account home") from exc
    candidate = Path(home)
    if not candidate.is_absolute():
        raise ProviderError("provider account home is not absolute")
    return candidate


def provider_config_path() -> Path:
    """Return the one framework-defined provider configuration path.

    ``HOME`` is deliberately not consulted. A dispatched CLI may set HOME for
    its own sandbox, but that must never select the bridge provider.
    """
    return _home_directory() / ".tokenizer" / "harness" / "vm-v1" / "provider.json"


def provider_runtime_root() -> Path:
    """Return the provider-owned root for transient source and result data.

    Callers may choose a project-local state directory for the small run-meta
    pointer consumed by dispatch.  They must never choose where a privileged
    provider stages a Git checkout or evaluates a returned archive.
    """
    return _home_directory() / ".tokenizer" / "harness" / "vm-v1" / "runs"


def _load_json_no_duplicates(path: Path, label: str) -> dict[str, Any]:
    def reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        value: dict[str, Any] = {}
        for key, item in pairs:
            if key in value:
                raise ValueError(f"duplicate JSON key {key!r}")
            value[key] = item
        return value

    try:
        value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicates)
    except (OSError, ValueError) as exc:
        raise ProviderError(f"{label} is unreadable") from exc
    if not isinstance(value, dict):
        raise ProviderError(f"{label} must be an object")
    return value


def _secure_regular_file(path: Path, label: str, *, require_private: bool = False) -> None:
    try:
        entry = path.lstat()
    except OSError as exc:
        raise ProviderError(f"{label} is unavailable") from exc
    if stat.S_ISLNK(entry.st_mode) or not stat.S_ISREG(entry.st_mode):
        raise ProviderError(f"{label} must be a regular non-symlink file")
    if require_private and entry.st_mode & (stat.S_IWGRP | stat.S_IWOTH | stat.S_IRGRP | stat.S_IROTH):
        raise ProviderError(f"{label} must not be group/world accessible")


def _absolute_hashed_file(value: Any, digest: Any, label: str) -> tuple[Path, str]:
    if not isinstance(value, str):
        raise ProviderError(f"{label} path is invalid")
    path = Path(value)
    if not path.is_absolute():
        raise ProviderError(f"{label} path must be absolute")
    if not isinstance(digest, str) or SHA256.fullmatch(digest) is None:
        raise ProviderError(f"{label} digest is invalid")
    _secure_regular_file(path, label)
    observed = _sha256_file(path)
    if not hmac.compare_digest(observed, digest):
        raise ProviderError(f"{label} digest drifted")
    return path, observed


def _exact_object(value: Any, fields: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != fields:
        raise ProviderError(f"{label} has an invalid shape")
    return value


def _validated_contract(value: Any) -> dict[str, Any]:
    contract = _exact_object(value, CONTRACT_FIELDS, "provider contract")
    expected = {
        "contract_version": CONTRACT_VERSION,
        "provider_id": PROVIDER_ID,
        "provider_kind": PROVIDER_KIND,
        "same_session_bridge": True,
        "isolation_principal": "vm",
        "workspace_transport": "copy-in-copy-out",
        "host_filesystem": "deny-by-default",
        "coordinator_paths_hidden": True,
        "launch_binding": "staged-sha256-v1",
        "credential_flow": "brokered-no-raw-secret-v1",
        "network_egress": "brokered-only-v1",
        "lifecycle": "provider-job-reap-v1",
        "result_channel": "supervisor-pipe-v1",
        "attestation": "nonce-bound-v1",
    }
    if contract != expected:
        raise ProviderError("provider contract does not satisfy vm-v1 requirements")
    return contract


@dataclass(frozen=True)
class ProviderConfiguration:
    contract: dict[str, Any]
    contract_sha256: str
    executable: Path
    profile: str
    profile_config: Path
    image: Path
    image_sha256: str
    cli_bundle: Path
    cli_bundle_sha256: str
    broker_policy: Path
    broker_policy_sha256: str


@dataclass(frozen=True)
class BrokerPolicy:
    guest_broker_host: str
    upstream_base_url: str
    credential_source: dict[str, str]


def load_provider_configuration() -> ProviderConfiguration:
    path = provider_config_path()
    _secure_regular_file(path, "provider configuration", require_private=True)
    root = _exact_object(_load_json_no_duplicates(path, "provider configuration"), CONFIG_FIELDS, "provider configuration")
    if root.get("version") != CONFIG_VERSION or root.get("enabled") is not True:
        raise ProviderError("provider is not enabled")
    contract = _validated_contract(root.get("contract"))
    runtime = _exact_object(root.get("runtime"), RUNTIME_FIELDS, "provider runtime")
    if runtime.get("kind") != LIMA_RUNTIME_KIND:
        raise ProviderError("provider runtime kind is not published")
    executable, _ = _absolute_hashed_file(
        runtime.get("executable"), runtime.get("executable_sha256"), "provider runtime executable"
    )
    profile = runtime.get("profile")
    if not isinstance(profile, str) or profile != "harness-vm-v1" or SAFE_ID.fullmatch(profile) is None:
        raise ProviderError("provider runtime profile is invalid")
    profile_config, _ = _absolute_hashed_file(
        runtime.get("profile_config"), runtime.get("profile_config_sha256"), "provider VM profile"
    )
    expected_profile = _home_directory() / ".lima" / profile / "lima.yaml"
    if profile_config != expected_profile:
        raise ProviderError("provider VM profile path is not the fixed Lima instance")
    image, image_sha256 = _absolute_hashed_file(
        runtime.get("image"), runtime.get("image_sha256"), "provider VM image"
    )
    cli_bundle, cli_bundle_sha256 = _absolute_hashed_file(
        runtime.get("cli_bundle"), runtime.get("cli_bundle_sha256"), "provider CLI bundle"
    )
    broker = _exact_object(root.get("broker"), BROKER_FIELDS, "provider broker")
    broker_policy, broker_policy_sha256 = _absolute_hashed_file(
        broker.get("policy"), broker.get("policy_sha256"), "provider broker policy"
    )
    return ProviderConfiguration(
        contract=contract,
        contract_sha256=_canonical_sha256(CONTRACT_VERSION, contract),
        executable=executable,
        profile=profile,
        profile_config=profile_config,
        image=image,
        image_sha256=image_sha256,
        cli_bundle=cli_bundle,
        cli_bundle_sha256=cli_bundle_sha256,
        broker_policy=broker_policy,
        broker_policy_sha256=broker_policy_sha256,
    )


def _broker_policy(configuration: ProviderConfiguration) -> BrokerPolicy:
    policy = _exact_object(
        _load_json_no_duplicates(configuration.broker_policy, "provider broker policy"),
        BROKER_POLICY_FIELDS,
        "provider broker policy",
    )
    if policy.get("version") != BROKER_POLICY_VERSION:
        raise ProviderError("provider broker policy version is invalid")
    guest_host = policy.get("guest_broker_host")
    if not isinstance(guest_host, str):
        raise ProviderError("provider broker guest host is invalid")
    try:
        # The guest is allowed to address only a literal provider-controlled
        # gateway, never a DNS name that can be rebound by a child.
        import ipaddress

        address = ipaddress.ip_address(guest_host)
    except ValueError as exc:
        raise ProviderError("provider broker guest host must be an IP address") from exc
    if not address.is_private:
        raise ProviderError("provider broker guest host must be private")
    upstream = policy.get("upstream_base_url")
    if not isinstance(upstream, str) or len(upstream) > 512:
        raise ProviderError("provider broker upstream is invalid")
    parsed = urllib.parse.urlsplit(upstream)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise ProviderError("provider broker upstream must be an HTTPS origin/path")
    source = policy.get("credential_source")
    if not isinstance(source, dict):
        raise ProviderError("provider broker credential source is invalid")
    kind = source.get("kind")
    if kind == "kimi-code-oauth-file-v1":
        if set(source) != {"kind"}:
            raise ProviderError("Kimi OAuth credential source has an invalid shape")
        credential_source = {"kind": kind}
    elif kind == "macos-keychain-generic-password-v1":
        if set(source) != {"kind", "service", "account"}:
            raise ProviderError("Keychain credential source has an invalid shape")
        service = source.get("service")
        account = source.get("account")
        if not isinstance(service, str) or not service or len(service) > 128:
            raise ProviderError("Keychain credential service is invalid")
        if not isinstance(account, str) or not account or len(account) > 128:
            raise ProviderError("Keychain credential account is invalid")
        credential_source = {"kind": kind, "service": service, "account": account}
    else:
        raise ProviderError("provider broker credential source is not published")
    return BrokerPolicy(
        guest_broker_host=guest_host,
        upstream_base_url=upstream.rstrip("/"),
        credential_source=credential_source,
    )


def _read_broker_credential(policy: BrokerPolicy) -> str:
    """Read one credential into broker memory without exposing it to a VM.

    The Kimi OAuth source is deliberately fixed to the account's standard
    credential path; configuration cannot redirect it to an arbitrary file.
    It is read by the trusted host provider only and never copied, logged, or
    encoded into an attestation/receipt.
    """
    kind = policy.credential_source["kind"]
    if kind == "kimi-code-oauth-file-v1":
        source = _home_directory() / ".kimi-code" / "credentials" / "kimi-code.json"
        _secure_regular_file(source, "Kimi OAuth credential", require_private=True)
        value = _load_json_no_duplicates(source, "Kimi OAuth credential")
        token = value.get("access_token")
        expires_at = value.get("expires_at")
        if not isinstance(token, str) or not token or len(token) > 16_384:
            raise ProviderError("Kimi OAuth credential has no usable access token")
        if not isinstance(expires_at, (int, float)) or isinstance(expires_at, bool):
            raise ProviderError("Kimi OAuth credential has no expiry")
        # Kimi stores Unix milliseconds in current releases. Accept seconds
        # too so an older credential file fails only when genuinely expired.
        expiry_seconds = float(expires_at) / (1000 if float(expires_at) > 10_000_000_000 else 1)
        if expiry_seconds <= _utc_now().timestamp() + 60:
            raise ProviderError("Kimi OAuth credential expires too soon")
        return token
    if kind == "macos-keychain-generic-password-v1":
        command = [
            "/usr/bin/security",
            "find-generic-password",
            "-s",
            policy.credential_source["service"],
            "-a",
            policy.credential_source["account"],
            "-w",
        ]
        try:
            result = subprocess.run(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                timeout=5,
                env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"},
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ProviderError("Keychain credential is unavailable") from exc
        token = result.stdout.rstrip("\r\n") if result.returncode == 0 else ""
        if not token or len(token) > 16_384 or "\x00" in token:
            raise ProviderError("Keychain credential is unavailable")
        return token
    raise ProviderError("provider broker credential source is not published")


class _BrokerServer(http.server.ThreadingHTTPServer):
    # The process owns this server and joins it before discarding the raw
    # credential. No request logs are emitted because request targets may carry
    # task-derived data.
    daemon_threads = True
    allow_reuse_address = False

    def __init__(
        self,
        address: tuple[str, int],
        policy: BrokerPolicy,
        lease: str,
        credential: str,
    ) -> None:
        self.policy = policy
        self.lease = lease
        self.credential = credential
        super().__init__(address, _BrokerHandler)


class _BrokerHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server: _BrokerServer

    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def _reject(self, code: int) -> None:
        self.send_response(code)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802 - HTTP server API spelling
        self._proxy()

    def do_POST(self) -> None:  # noqa: N802 - HTTP server API spelling
        self._proxy()

    def _proxy(self) -> None:
        if self.command not in {"GET", "POST"}:
            self._reject(405)
            return
        authorization = self.headers.get("Authorization", "")
        if not hmac.compare_digest(authorization, f"Bearer {self.server.lease}"):
            self._reject(403)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._reject(400)
            return
        if length < 0 or length > 32 * 1024 * 1024:
            self._reject(413)
            return
        try:
            body = self.rfile.read(length) if length else b""
        except OSError:
            self._reject(400)
            return
        upstream = urllib.parse.urlsplit(self.server.policy.upstream_base_url)
        request_path = urllib.parse.urlsplit(self.path)
        if request_path.scheme or request_path.netloc or not request_path.path.startswith("/"):
            self._reject(400)
            return
        upstream_path = (upstream.path.rstrip("/") + request_path.path) or "/"
        if request_path.query:
            upstream_path += "?" + request_path.query
        headers: dict[str, str] = {
            "Host": upstream.netloc,
            "Authorization": f"Bearer {self.server.credential}",
            "Accept": self.headers.get("Accept", "application/json"),
            "Content-Type": self.headers.get("Content-Type", "application/json"),
            "User-Agent": self.headers.get("User-Agent", "harness-vm-v1"),
            "Content-Length": str(len(body)),
        }
        if self.headers.get("Accept-Encoding"):
            headers["Accept-Encoding"] = self.headers["Accept-Encoding"]
        try:
            connection = http.client.HTTPSConnection(
                upstream.hostname,
                upstream.port or 443,
                timeout=60,
            )
            connection.request(self.command, upstream_path, body=body, headers=headers)
            response = connection.getresponse()
            response_body = response.read(32 * 1024 * 1024 + 1)
            if len(response_body) > 32 * 1024 * 1024:
                raise ProviderError("broker upstream response exceeds its limit")
        except (OSError, http.client.HTTPException, ProviderError):
            self._reject(502)
            return
        finally:
            try:
                connection.close()
            except (UnboundLocalError, OSError):
                pass
        self.send_response(response.status)
        for key, value in response.getheaders():
            lowered = key.lower()
            if lowered in {
                "connection",
                "content-length",
                "keep-alive",
                "proxy-authenticate",
                "proxy-authorization",
                "te",
                "trailer",
                "transfer-encoding",
                "upgrade",
            }:
                continue
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(response_body)))
        self.end_headers()
        try:
            self.wfile.write(response_body)
        except OSError:
            return


class BrokerLease:
    """Own one loopback-to-guest broker lifetime and short-lived capability."""

    def __init__(self, policy: BrokerPolicy) -> None:
        self.policy = policy
        self._credential: str | None = None
        self._server: _BrokerServer | None = None
        self._thread: threading.Thread | None = None
        self.lease: str | None = None
        self.port: int | None = None

    def __enter__(self) -> "BrokerLease":
        self._credential = _read_broker_credential(self.policy)
        self.lease = secrets.token_urlsafe(48)
        # Lima's usernet gateway is not loopback from the guest. The per-run
        # lease is the application-layer capability; the VM firewall is added
        # before the worker starts and permits only this gateway+port route.
        self._server = _BrokerServer(("0.0.0.0", 0), self.policy, self.lease, self._credential)
        self.port = int(self._server.server_address[1])
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        return self

    @property
    def guest_base_url(self) -> str:
        if self.port is None:
            raise ProviderError("broker has not started")
        return f"http://{self.policy.guest_broker_host}:{self.port}"

    def __exit__(self, _exc_type: Any, _exc: Any, _traceback: Any) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
        if self._thread is not None:
            self._thread.join(timeout=2)
        self._credential = None
        self.lease = None
        self.port = None


def _run_vm(
    configuration: ProviderConfiguration,
    command: list[str],
    *,
    input_bytes: bytes | None = None,
    timeout: int = 90,
) -> subprocess.CompletedProcess[bytes]:
    """Run one fixed plain-Lima guest command without caller environment."""
    argv = [
        str(configuration.executable),
        "shell",
        "--workdir=/",
        configuration.profile,
        *command,
    ]
    try:
        return subprocess.run(
            argv,
            input=input_bytes,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=timeout,
            env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"},
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ProviderError("VM provider command is unavailable") from exc


def _validated_lima_status(configuration: ProviderConfiguration) -> dict[str, Any]:
    """Read the fixed instance status and prove the no-host-input contract."""
    try:
        status = subprocess.run(
            [str(configuration.executable), "list", configuration.profile, "--json"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=15,
            env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"},
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ProviderError("VM provider profile is unavailable") from exc
    if status.returncode != 0:
        raise ProviderError("VM provider profile is not running")
    try:
        observed = json.loads(status.stdout)
    except (TypeError, ValueError) as exc:
        raise ProviderError("VM provider status is malformed") from exc
    if not isinstance(observed, dict):
        raise ProviderError("VM provider status is malformed")
    if (
        observed.get("name") != configuration.profile
        or observed.get("status") != "Running"
        or observed.get("vmType") != "vz"
        or observed.get("arch") != "aarch64"
    ):
        raise ProviderError("VM provider profile does not satisfy the fixed Lima runtime")
    runtime = observed.get("config")
    if not isinstance(runtime, dict):
        raise ProviderError("VM provider runtime configuration is malformed")
    ssh = runtime.get("ssh")
    resolver = runtime.get("hostResolver")
    containerd = runtime.get("containerd")
    if (
        runtime.get("vmType") != "vz"
        or runtime.get("plain") is not True
        or runtime.get("propagateProxyEnv") is not False
        or runtime.get("mounts") not in (None, [])
        or runtime.get("portForwards") not in (None, [])
        or runtime.get("networks") not in (None, [])
        or not isinstance(ssh, dict)
        or any(ssh.get(key) is not False for key in (
            "loadDotSSHPubKeys", "forwardAgent", "forwardX11", "forwardX11Trusted"
        ))
        or not isinstance(resolver, dict)
        or resolver.get("enabled") is not False
        or not isinstance(containerd, dict)
        or containerd.get("system") is not False
        or containerd.get("user") is not False
    ):
        raise ProviderError("VM provider runtime no-host-input contract drifted")
    return observed


def _assert_vm_ready(configuration: ProviderConfiguration) -> None:
    """Confirm the fixed profile and guest filesystem boundaries are live."""
    _validated_lima_status(configuration)
    guest = _run_vm(
        configuration,
        [
            "sudo",
            "-n",
            "sh",
            "-ec",
            f"id {WORKER_USER} >/dev/null; "
            f"! sudo -n -u {WORKER_USER} -- sudo -n true; "
            "command -v systemd-run >/dev/null; command -v systemctl >/dev/null; "
            "awk 'BEGIN { bad=0 } { pairs=split($0, pair, \" - \" ); "
            "if (pairs != 2) { bad=1; next } "
            "split(pair[2], fields, \" \" ); typ=fields[1]; point=$5; "
            "if (typ ~ /^(virtiofs|9p|sshfs|fuse(\\..*)?|cifs|nfs|smb3)$/) bad=1; "
            "if (typ == \"iso9660\" && point != \"/mnt/lima-cidata\") bad=1 } "
            "END { exit bad }' /proc/self/mountinfo; "
            "test -d /mnt/lima-cidata; test \"$(findmnt -n -o FSTYPE --target /mnt/lima-cidata)\" = iso9660; "
            "test \"$(stat -c %U:%a /mnt/lima-cidata)\" = root:700",
        ],
        timeout=30,
    )
    if guest.returncode != 0:
        raise ProviderError("VM provider guest mount boundary is not proven")


def _set_guest_egress_policy(
    configuration: ProviderConfiguration,
    policy: BrokerPolicy,
    broker_port: int,
) -> None:
    if not isinstance(broker_port, int) or not 1 <= broker_port <= 65535:
        raise ProviderError("broker port is invalid")
    # The dedicated VM profile has no child workload before this command. Keep
    # SSH control traffic alive, drop all new egress, and then allow only the
    # provider's private gateway/short-lived broker port.
    script = " ".join(
        (
            "set -eu;",
            "sudo -n iptables -w -F OUTPUT;",
            "sudo -n iptables -w -P OUTPUT DROP;",
            "sudo -n iptables -w -A OUTPUT -o lo -j ACCEPT;",
            "sudo -n iptables -w -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT;",
            f"sudo -n iptables -w -A OUTPUT -d {policy.guest_broker_host} -p tcp --dport {broker_port} -j ACCEPT;",
        )
    )
    result = _run_vm(configuration, ["sh", "-ec", script], timeout=30)
    if result.returncode != 0:
        raise ProviderError("VM provider could not install broker-only egress policy")


def _safe_artifact_relative(envelope: dict[str, Any]) -> str:
    deliverable = envelope.get("deliverable")
    artifact = deliverable.get("artifact") if isinstance(deliverable, dict) else None
    if not isinstance(artifact, str) or SAFE_ARTIFACT.fullmatch(artifact) is None:
        raise ProviderError("bridge envelope artifact is invalid")
    if any(part in {"", ".", ".."} for part in artifact.split("/")):
        raise ProviderError("bridge envelope artifact is invalid")
    return artifact


def _load_launch_target(path: Path, expected_provenance: str) -> dict[str, Any]:
    target = _load_json_no_duplicates(path, "bridge target")
    if target.get("invocation") != "subagent" or target.get("session_scope") != "same-session":
        raise ProviderError("bridge target is not an external same-session route")
    if target.get("bridge_provider_id") != PROVIDER_ID or target.get("bridge_provider_kind") != PROVIDER_KIND:
        raise ProviderError("bridge target provider binding is invalid")
    if target.get("execution_provenance_sha256") != expected_provenance:
        raise ProviderError("bridge target provenance drifted")
    for key in ("bridge_provider_contract_sha256", "execution_provenance_sha256"):
        value = target.get(key)
        if not isinstance(value, str) or SHA256.fullmatch(value) is None:
            raise ProviderError(f"bridge target {key} is invalid")
    protocol = target.get("bridge_protocol")
    if not isinstance(protocol, dict) or set(protocol) != {
        "kind", "command", "request_delivery", "response_format"
    }:
        raise ProviderError("bridge target protocol is invalid")
    if (
        protocol.get("kind") != "acp-native-agent/v1"
        or protocol.get("request_delivery") != "stdin"
        or protocol.get("response_format") != "json"
        or not isinstance(protocol.get("command"), list)
        or not protocol["command"]
        or len(protocol["command"]) > 64
        or any(
            not isinstance(item, str)
            or not item
            or len(item) > 4096
            or "\x00" in item
            or "\n" in item
            for item in protocol["command"]
        )
    ):
        raise ProviderError("bridge target protocol is invalid")
    return target


def _bundle_protocol_commands(bundle: Path) -> dict[str, tuple[str, ...]]:
    """Read the signed command table embedded in the staged CLI bundle.

    Project manifests can describe a compatible bridge, but they cannot select
    an executable.  The command is bound to the hashed provider bundle so a
    future CLI joins declaratively only after its released bundle adds the
    matching published protocol entry.
    """
    _secure_regular_file(bundle, "provider CLI bundle")
    found: bytes | None = None
    entries: dict[str, tarfile.TarInfo] = {}
    bundle_total = 0
    try:
        with tarfile.open(bundle, mode="r:gz") as archive:
            for member in archive.getmembers():
                if (
                    member.name.startswith("/")
                    or any(part in {"", ".", ".."} for part in member.name.split("/"))
                    or member.name in entries
                    or member.issym()
                    or member.islnk()
                    or not (member.isfile() or member.isdir())
                ):
                    raise ProviderError("provider CLI bundle contains an unsafe entry")
                entries[member.name] = member
                bundle_total += member.size
                if bundle_total > 512 * 1024 * 1024:
                    raise ProviderError("provider CLI bundle exceeds its size limit")
                if member.name != "harness-vm-bundle.json":
                    continue
                if found is not None or not member.isfile():
                    raise ProviderError("provider CLI bundle manifest is invalid")
                source = archive.extractfile(member)
                if source is None:
                    raise ProviderError("provider CLI bundle manifest is unreadable")
                with source:
                    found = source.read(64 * 1024 + 1)
    except (OSError, tarfile.TarError) as exc:
        raise ProviderError("provider CLI bundle is unreadable") from exc
    if found is None or len(found) > 64 * 1024:
        raise ProviderError("provider CLI bundle lacks a valid manifest")
    try:
        value = json.loads(found.decode("utf-8"), object_pairs_hook=lambda pairs: _reject_duplicate_pairs(pairs))
    except (UnicodeDecodeError, ValueError) as exc:
        raise ProviderError("provider CLI bundle manifest is invalid") from exc
    if not isinstance(value, dict) or set(value) != {"version", "protocol_commands"}:
        raise ProviderError("provider CLI bundle manifest has an invalid shape")
    if value.get("version") != CLI_BUNDLE_MANIFEST_VERSION:
        raise ProviderError("provider CLI bundle manifest version is invalid")
    raw_commands = value.get("protocol_commands")
    if not isinstance(raw_commands, dict) or not raw_commands:
        raise ProviderError("provider CLI bundle command table is invalid")
    result: dict[str, tuple[str, ...]] = {}
    for protocol, command in raw_commands.items():
        if protocol != "acp-native-agent/v1" or not isinstance(command, list) or not command or len(command) > 64:
            raise ProviderError("provider CLI bundle command table is invalid")
        parsed: list[str] = []
        for item in command:
            if (
                not isinstance(item, str)
                or not item
                or len(item) > 4096
                or "\x00" in item
                or "\n" in item
                or item.startswith("/")
                or "\\" in item
            ):
                raise ProviderError("provider CLI bundle command table is invalid")
            if not parsed and SAFE_ID.fullmatch(item) is None:
                raise ProviderError("provider CLI bundle command executable is invalid")
            parsed.append(item)
        result[protocol] = tuple(parsed)
    for command in result.values():
        executable = entries.get(f"bin/{command[0]}")
        if executable is None or not executable.isfile() or not executable.mode & 0o111:
            raise ProviderError("provider CLI bundle lacks a command executable")
    return result


def _reject_duplicate_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _validate_target_bundle_command(
    configuration: ProviderConfiguration, target: dict[str, Any]
) -> tuple[str, ...]:
    protocol = target.get("bridge_protocol")
    if not isinstance(protocol, dict):
        raise ProviderError("bridge target protocol is invalid")
    commands = _bundle_protocol_commands(configuration.cli_bundle)
    expected = commands.get(protocol.get("kind"))
    command = protocol.get("command")
    if expected is None or not isinstance(command, list) or tuple(command) != expected:
        raise ProviderError("bridge target command is not bound to the provider CLI bundle")
    return expected


def _create_copyin_archive(
    *,
    project_root: Path,
    ref: str,
    envelope: Path,
    target: Path,
    cli_bundle: Path,
    destination: Path,
) -> None:
    """Create a source-only VM input archive without a checkout or `.git`."""
    try:
        archived = subprocess.run(
            ["git", "-C", str(project_root), "archive", "--format=tar", ref],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=60,
            env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull},
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ProviderError("cannot snapshot the commissioned source") from exc
    if archived.returncode != 0 or not archived.stdout:
        raise ProviderError("cannot snapshot the commissioned source")
    try:
        with tarfile.open(fileobj=io.BytesIO(archived.stdout), mode="r:") as source, tarfile.open(
            destination, mode="w:gz", format=tarfile.PAX_FORMAT
        ) as output:
            for member in source.getmembers():
                if (
                    member.name == ".git"
                    or member.name.startswith(".git/")
                    or member.name.startswith("/")
                    or any(piece in {"", ".", ".."} for piece in member.name.split("/"))
                    or member.issym()
                    or member.islnk()
                    or not (member.isfile() or member.isdir())
                ):
                    raise ProviderError("source snapshot contains an unsafe entry")
                source_file = source.extractfile(member) if member.isfile() else None
                copied = copy.copy(member)
                copied.name = f"source/{member.name}"
                output.addfile(copied, source_file)
            output.add(str(envelope), arcname=".harness-envelope.json", recursive=False)
            output.add(str(target), arcname=".harness-target.json", recursive=False)
            _secure_regular_file(cli_bundle, "provider CLI bundle")
            output.add(str(cli_bundle), arcname=".harness-cli-bundle.tar.gz", recursive=False)
            transports = Path(__file__).resolve().parent
            for name in ("session-bridge.py", "session_bridge_kimi.py", "vm-bridge-worker.py"):
                runner = transports / name
                _secure_regular_file(runner, f"framework VM runner {name}")
                output.add(str(runner), arcname=f".harness-runner/{name}", recursive=False)
    except (OSError, tarfile.TarError) as exc:
        raise ProviderError("cannot create VM copy-in archive") from exc


def _copy_archive_to_guest(
    configuration: ProviderConfiguration,
    archive: Path,
    guest_root: str,
    cli_executables: tuple[str, ...],
) -> None:
    try:
        payload = archive.read_bytes()
    except OSError as exc:
        raise ProviderError("VM copy-in archive is unreadable") from exc
    if not cli_executables or any(SAFE_ID.fullmatch(name) is None for name in cli_executables):
        raise ProviderError("provider CLI executable set is invalid")
    executable_checks = " ".join(
        f"test -x {guest_root}/cli/bin/{name};" for name in sorted(set(cli_executables))
    )
    command = [
        "sudo",
        "-n",
        "sh",
        "-ec",
        f"umask 077; rm -rf {guest_root}; mkdir -p {guest_root}; tar -xzf - -C {guest_root}; "
        f"mkdir -p {guest_root}/cli {guest_root}/state; "
        f"tar -xzf {guest_root}/.harness-cli-bundle.tar.gz -C {guest_root}/cli; "
        f"rm -f {guest_root}/.harness-cli-bundle.tar.gz; test ! -e {guest_root}/source/.git; "
        f"{executable_checks} "
        f"chown -R root:root {guest_root}/cli {guest_root}/.harness-runner; "
        f"chmod -R a-w {guest_root}/cli {guest_root}/.harness-runner; "
        f"chmod 444 {guest_root}/.harness-envelope.json {guest_root}/.harness-target.json; "
        f"chown -R {WORKER_USER}:{WORKER_USER} {guest_root}/source {guest_root}/state; "
        f"chmod 700 {guest_root}/source {guest_root}/state; "
        f"chmod 711 {guest_root}",
    ]
    # `guest_root` is provider-generated hex only; it is never task input.
    result = _run_vm(configuration, command, input_bytes=payload, timeout=120)
    if result.returncode != 0:
        raise ProviderError("VM copy-in failed")


def _validate_guest_root(guest_root: str) -> None:
    if SAFE_GUEST_ROOT.fullmatch(guest_root) is None:
        raise ProviderError("provider guest job path is invalid")


def _guest_restricted_unit(
    configuration: ProviderConfiguration,
    *,
    guest_root: str,
    unit: str,
    timeout: int,
    environment: dict[str, str],
    program: list[str],
    network_host: str | None,
) -> subprocess.CompletedProcess[bytes]:
    """Run an owned runner in a fresh, fully reaped worker cgroup.

    Every process that can inspect worker-controlled source is placed in this
    boundary.  In particular, copy-out does not use a root SSH shell or Git;
    child-controlled repository files are never interpreted outside the unit.
    """
    _validate_guest_root(guest_root)
    if SAFE_ID.fullmatch(unit) is None:
        raise ProviderError("provider guest unit is invalid")
    if not isinstance(timeout, int) or timeout < 1 or timeout > 90_000:
        raise ProviderError("provider guest timeout is invalid")
    if not program or any(not isinstance(item, str) or not item or "\x00" in item for item in program):
        raise ProviderError("provider guest program is invalid")
    for key, value in environment.items():
        if not re.fullmatch(r"[A-Z_][A-Z0-9_]{0,127}", key) or not isinstance(value, str) or not value or "\x00" in value or "\n" in value:
            raise ProviderError("provider guest environment is invalid")

    command = [
        "sudo",
        "-n",
        "systemd-run",
        "--quiet",
        "--wait",
        "--collect",
        "--pipe",
        f"--unit={unit}",
        f"--uid={WORKER_USER}",
        "--property=KillMode=control-group",
        "--property=TimeoutStopSec=5s",
        "--property=NoNewPrivileges=yes",
        "--property=PrivateTmp=yes",
        "--property=PrivateDevices=yes",
        "--property=ProtectHome=yes",
        "--property=ProtectSystem=strict",
        "--property=ProtectKernelTunables=yes",
        "--property=ProtectKernelModules=yes",
        "--property=ProtectControlGroups=yes",
        "--property=CapabilityBoundingSet=",
        "--property=RestrictSUIDSGID=yes",
        "--property=RestrictNamespaces=yes",
        "--property=LockPersonality=yes",
        "--property=UMask=0077",
        "--property=RemoveIPC=yes",
        f"--property=ReadWritePaths={guest_root}/source {guest_root}/state",
    ]
    if network_host is None:
        command.extend(("--property=IPAddressDeny=any", "--property=RestrictAddressFamilies=AF_UNIX"))
    else:
        try:
            import ipaddress

            address = ipaddress.ip_address(network_host)
        except ValueError as exc:
            raise ProviderError("provider guest network host is invalid") from exc
        if not address.is_private:
            raise ProviderError("provider guest network host is invalid")
        command.extend(("--property=IPAddressDeny=any", f"--property=IPAddressAllow={network_host}"))
    command.extend(f"--setenv={key}={value}" for key, value in sorted(environment.items()))
    command.extend(("--", *program))
    result = _run_vm(configuration, command, timeout=timeout)
    if result.returncode != 0:
        raise ProviderError("VM restricted provider unit failed")
    return result


def _run_guest_worker(
    configuration: ProviderConfiguration,
    *,
    guest_root: str,
    unit: str,
    timeout_s: int,
    launch_nonce: str,
    launch_attestation_sha256: str,
    broker: BrokerLease,
) -> None:
    if broker.lease is None:
        raise ProviderError("broker lease is unavailable")
    environment = {
        "PATH": f"{guest_root}/cli/bin:/usr/bin:/bin",
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "HARNESS_PROVIDER_LAUNCH_NONCE": launch_nonce,
        "HARNESS_PROVIDER_LAUNCH_ATTESTATION_SHA256": launch_attestation_sha256,
        "HARNESS_PROVIDER_BROKER_BASE_URL": broker.guest_base_url,
        "HARNESS_PROVIDER_BROKER_LEASE": broker.lease,
    }
    _guest_restricted_unit(
        configuration,
        guest_root=guest_root,
        unit=unit,
        timeout=timeout_s + 60,
        environment=environment,
        network_host=broker.policy.guest_broker_host,
        program=[
            "/usr/bin/python3",
            f"{guest_root}/.harness-runner/vm-bridge-worker.py",
            "run",
            "--target",
            f"{guest_root}/.harness-target.json",
            "--envelope",
            f"{guest_root}/.harness-envelope.json",
            "--worktree",
            f"{guest_root}/source",
            "--worker-state-root",
            f"{guest_root}/state",
            "--result",
            f"{guest_root}/state/bridge-result.json",
            "--timeout-s",
            str(timeout_s),
        ],
    )


def _guest_copyout(
    configuration: ProviderConfiguration,
    *,
    guest_root: str,
    artifact: str,
    unit: str,
) -> bytes:
    copyout_unit = f"{unit}-copyout"
    result = _guest_restricted_unit(
        configuration,
        guest_root=guest_root,
        unit=copyout_unit,
        timeout=120,
        environment={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"},
        network_host=None,
        program=[
            "/usr/bin/python3",
            f"{guest_root}/.harness-runner/vm-bridge-worker.py",
            "copyout",
            "--worktree",
            f"{guest_root}/source",
            "--worker-state-root",
            f"{guest_root}/state",
            "--artifact",
            artifact,
        ],
    )
    if not result.stdout:
        raise ProviderError("VM bridge copy-out failed")
    return result.stdout


def _cleanup_guest_job(
    configuration: ProviderConfiguration,
    guest_root: str,
    *units: str,
) -> None:
    # All path/unit values are provider-generated fixed grammar. Cleanup is
    # best effort after systemd has been asked to kill the full cgroup, never a
    # PID read from a worker-controlled file.
    _validate_guest_root(guest_root)
    if not units or any(SAFE_ID.fullmatch(unit) is None for unit in units):
        return
    stop_units = " ".join(
        f"sudo -n systemctl kill --kill-whom=all {unit} >/dev/null 2>&1 || true; "
        f"sudo -n systemctl reset-failed {unit} >/dev/null 2>&1 || true;"
        for unit in units
    )
    command = [
        "sh",
        "-ec",
        f"{stop_units} "
        f"sudo -n rm -rf {guest_root}",
    ]
    try:
        _run_vm(configuration, command, timeout=30)
    except ProviderError:
        return


def _safe_relative_parts(value: str, label: str) -> tuple[str, ...]:
    if not isinstance(value, str) or not value or value.startswith("/") or "\\" in value:
        raise ProviderError(f"{label} is invalid")
    parts = tuple(value.split("/"))
    if any(not part or part in {".", ".."} or "\x00" in part for part in parts):
        raise ProviderError(f"{label} is invalid")
    return parts


def _secure_directory(path: Path, label: str) -> None:
    try:
        entry = path.lstat()
    except OSError as exc:
        raise ProviderError(f"{label} is unavailable") from exc
    if stat.S_ISLNK(entry.st_mode) or not stat.S_ISDIR(entry.st_mode):
        raise ProviderError(f"{label} must be a non-symlink directory")


def _safe_parent(root: Path, parts: tuple[str, ...], *, create: bool) -> Path:
    """Walk a provider-owned tree without allowing a base-tree symlink hop."""
    _secure_directory(root, "provider destination root")
    root_real = root.resolve()
    current = root
    for part in parts:
        candidate = current / part
        try:
            entry = candidate.lstat()
        except FileNotFoundError:
            if not create:
                raise ProviderError("provider destination parent is missing")
            try:
                candidate.mkdir(mode=0o700)
            except OSError as exc:
                raise ProviderError("provider destination parent cannot be created") from exc
            try:
                entry = candidate.lstat()
            except OSError as exc:
                raise ProviderError("provider destination parent is unavailable") from exc
        except OSError as exc:
            raise ProviderError("provider destination parent is unavailable") from exc
        if stat.S_ISLNK(entry.st_mode) or not stat.S_ISDIR(entry.st_mode):
            raise ProviderError("provider destination parent is not a regular directory")
        try:
            candidate.resolve().relative_to(root_real)
        except ValueError as exc:
            raise ProviderError("provider destination parent escapes its root") from exc
        current = candidate
    return current


def _safe_leaf(root: Path, relative: str, *, create_parent: bool) -> Path:
    parts = _safe_relative_parts(relative, "provider destination path")
    parent = _safe_parent(root, parts[:-1], create=create_parent)
    destination = parent / parts[-1]
    try:
        entry = destination.lstat()
    except FileNotFoundError:
        return destination
    except OSError as exc:
        raise ProviderError("provider destination is unavailable") from exc
    if stat.S_ISLNK(entry.st_mode):
        raise ProviderError("provider destination may not be a symlink")
    return destination


def _normalized_return_mode(mode: int) -> int:
    """Retain only Git-visible executable state from an untrusted tree."""
    return 0o700 if mode & 0o111 else 0o600


def _write_stream_exclusive(
    destination: Path,
    source: Any,
    *,
    maximum: int,
    total: list[int],
    mode: int,
) -> None:
    normalized_mode = _normalized_return_mode(mode)
    try:
        descriptor = os.open(
            destination,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
            normalized_mode,
        )
    except OSError as exc:
        raise ProviderError("provider destination cannot be created") from exc
    try:
        os.fchmod(descriptor, normalized_mode)
        with os.fdopen(descriptor, "wb", closefd=False) as output:
            current = 0
            while block := source.read(1024 * 1024):
                current += len(block)
                total[0] += len(block)
                if current > maximum or total[0] > MAX_COPYOUT_BYTES:
                    raise ProviderError("VM copy-out exceeds its size limit")
                output.write(block)
    except OSError as exc:
        raise ProviderError("provider destination cannot be written") from exc
    finally:
        os.close(descriptor)


def _extract_copyout(payload: bytes, destination: Path) -> dict[str, Path]:
    """Extract a normalized supervisor stream without tar link semantics."""
    _secure_directory(destination, "provider copy-out directory")
    extracted: dict[str, Path] = {}
    total = [0]
    entries = 0
    try:
        with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
            for member in archive.getmembers():
                entries += 1
                if entries > MAX_COPYOUT_FILES + 1:
                    raise ProviderError("VM copy-out exceeds its file limit")
                if (
                    not member.isfile()
                    or member.issym()
                    or member.islnk()
                    or member.name.startswith("/")
                    or any(piece in {"", ".", ".."} for piece in member.name.split("/"))
                    or member.mode & ~0o777
                    or member.mode & 0o777 not in {0o600, 0o700}
                ):
                    raise ProviderError("VM copy-out contains an unsafe entry")
                if member.name != "state/bridge-result.json" and not member.name.startswith("source/"):
                    raise ProviderError("VM copy-out contains an uncommissioned entry")
                if member.name in extracted:
                    raise ProviderError("VM copy-out contains a duplicate entry")
                target = _safe_leaf(destination, member.name, create_parent=True)
                try:
                    source = archive.extractfile(member)
                except (OSError, tarfile.TarError) as exc:
                    raise ProviderError("VM copy-out entry is unreadable") from exc
                if source is None:
                    raise ProviderError("VM copy-out entry is unreadable")
                with source:
                    _write_stream_exclusive(
                        target,
                        source,
                        maximum=MAX_COPYOUT_BYTES,
                        total=total,
                        mode=member.mode,
                    )
                extracted[member.name] = target
    except (OSError, tarfile.TarError) as exc:
        raise ProviderError("VM copy-out is unreadable") from exc
    if "state/bridge-result.json" not in extracted:
        raise ProviderError("VM copy-out lacks its bridge receipt")
    return extracted


def _sha256_path(path: Path) -> str:
    _secure_regular_file(path, "provider copy-out artifact")
    return _sha256_file(path)


def _tree_regular_files(root: Path, label: str) -> dict[str, Path]:
    """Return a stable ordinary-file view without following a returned link."""
    _secure_directory(root, label)
    result: dict[str, Path] = {}

    def visit(directory: Path, prefix: str) -> None:
        try:
            children = sorted(os.scandir(directory), key=lambda item: item.name)
        except OSError as exc:
            raise ProviderError(f"{label} is unreadable") from exc
        for child in children:
            name = child.name
            if not name or name in {".", ".."} or "/" in name or "\\" in name or "\x00" in name:
                raise ProviderError(f"{label} contains an unsafe path")
            relative = f"{prefix}/{name}" if prefix else name
            _safe_relative_parts(relative, label)
            path = Path(child.path)
            try:
                entry = path.lstat()
            except OSError as exc:
                raise ProviderError(f"{label} entry is unavailable") from exc
            if stat.S_ISLNK(entry.st_mode):
                raise ProviderError(f"{label} may not contain symlinks")
            if stat.S_ISDIR(entry.st_mode):
                visit(path, relative)
                continue
            if not stat.S_ISREG(entry.st_mode) or entry.st_nlink != 1:
                raise ProviderError(f"{label} contains an unsupported file")
            if relative in result or len(result) >= MAX_COPYOUT_FILES:
                raise ProviderError(f"{label} exceeds its file limit")
            result[relative] = path

    visit(root, "")
    return result


def _validate_bridge_receipt(
    path: Path,
    *,
    target: dict[str, Any],
    launch_nonce: str,
    launch_attestation_sha256: str,
    artifact_sha256: str,
) -> dict[str, Any]:
    receipt = _load_json_no_duplicates(path, "VM bridge receipt")
    expected_fields = {
        "bridge_id",
        "bridge_strategy",
        "bridge_kind",
        "session_scope",
        "session_id_sha256",
        "nonce_sha256",
        "child_call_id_sha256",
        "subagent_type",
        "terminal_status",
        "provider_launch_attestation_sha256",
        "artifact_sha256",
    }
    if set(receipt) != expected_fields:
        raise ProviderError("VM bridge receipt shape is invalid")
    protocol = target.get("bridge_protocol")
    if not isinstance(protocol, dict):
        raise ProviderError("bridge target protocol is invalid")
    for receipt_key, target_key in (
        ("bridge_id", "bridge_id"),
        ("bridge_strategy", "bridge_strategy"),
    ):
        if receipt.get(receipt_key) != target.get(target_key):
            raise ProviderError("VM bridge receipt target binding is invalid")
    if receipt.get("bridge_kind") != protocol.get("kind") or receipt.get("session_scope") != "same-session":
        raise ProviderError("VM bridge receipt protocol binding is invalid")
    if receipt.get("subagent_type") != target.get("native_agent_type"):
        raise ProviderError("VM bridge receipt native type is invalid")
    if receipt.get("terminal_status") != "completed":
        raise ProviderError("VM bridge receipt is not terminal")
    if receipt.get("nonce_sha256") != hashlib.sha256(launch_nonce.encode("ascii")).hexdigest():
        raise ProviderError("VM bridge receipt nonce binding is invalid")
    if receipt.get("provider_launch_attestation_sha256") != launch_attestation_sha256:
        raise ProviderError("VM bridge receipt launch attestation binding is invalid")
    if receipt.get("artifact_sha256") != artifact_sha256:
        raise ProviderError("VM bridge receipt artifact binding is invalid")
    for name in ("session_id_sha256", "nonce_sha256", "child_call_id_sha256", "provider_launch_attestation_sha256", "artifact_sha256"):
        value = receipt.get(name)
        if not isinstance(value, str) or SHA256.fullmatch(value) is None:
            raise ProviderError("VM bridge receipt contains an invalid digest")
    # Use a fresh dict so a caller cannot retain the JSON parser object or add
    # a raw protocol payload later in the launch path.
    return dict(receipt)


def _provider_private_runs_root() -> Path:
    """Create the fixed private staging root without following a symlink."""
    home = _home_directory()
    root = provider_runtime_root()
    try:
        parts = root.relative_to(home).parts
    except ValueError as exc:
        raise ProviderError("provider runtime root escapes the provider account") from exc
    if parts != (".tokenizer", "harness", "vm-v1", "runs"):
        raise ProviderError("provider runtime root is not fixed")
    current = home
    for index, part in enumerate(parts):
        candidate = current / part
        try:
            entry = candidate.lstat()
        except FileNotFoundError:
            try:
                candidate.mkdir(mode=0o700)
            except OSError as exc:
                raise ProviderError("provider runtime directory cannot be created") from exc
            try:
                entry = candidate.lstat()
            except OSError as exc:
                raise ProviderError("provider runtime directory is unavailable") from exc
        except OSError as exc:
            raise ProviderError("provider runtime directory is unavailable") from exc
        if (
            stat.S_ISLNK(entry.st_mode)
            or not stat.S_ISDIR(entry.st_mode)
            or entry.st_uid != os.geteuid()
            or entry.st_mode & (stat.S_IWGRP | stat.S_IWOTH)
        ):
            raise ProviderError("provider runtime directory is not privately owned")
        # The framework namespace contains source/results after this point and
        # must not disclose them to another local account.
        if index >= 1 and entry.st_mode & (stat.S_IRWXG | stat.S_IRWXO):
            raise ProviderError("provider runtime directory is not private")
        current = candidate
    return current


def _validated_caller_state_root(path: Path, project_root: Path) -> Path:
    """Permit a project state pointer directory, never provider staging."""
    if not path.is_absolute():
        raise ProviderError("provider state path must be absolute")
    try:
        relative = path.relative_to(project_root)
    except ValueError as exc:
        raise ProviderError("provider state path escapes the project") from exc
    if not relative.parts or any(part in {"", ".", ".."} for part in relative.parts):
        raise ProviderError("provider state path is invalid")
    current = project_root
    _secure_directory(current, "provider project root")
    for part in relative.parts:
        candidate = current / part
        try:
            entry = candidate.lstat()
        except FileNotFoundError:
            try:
                candidate.mkdir(mode=0o700)
            except OSError as exc:
                raise ProviderError("provider state directory cannot be created") from exc
            try:
                entry = candidate.lstat()
            except OSError as exc:
                raise ProviderError("provider state directory is unavailable") from exc
        except OSError as exc:
            raise ProviderError("provider state directory is unavailable") from exc
        if stat.S_ISLNK(entry.st_mode) or not stat.S_ISDIR(entry.st_mode):
            raise ProviderError("provider state directory must not be a symlink")
        current = candidate
    return current


def _create_copyout_staging(project_root: Path, ref: str, destination: Path) -> None:
    try:
        cloned = subprocess.run(
            ["git", "clone", "--shared", "--no-checkout", str(project_root), str(destination)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=90,
            env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull},
            check=False,
        )
        checked_out = subprocess.run(
            ["git", "-C", str(destination), "checkout", "--detach", ref],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=60,
            env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull},
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ProviderError("provider copy-out staging is unavailable") from exc
    if cloned.returncode != 0 or checked_out.returncode != 0:
        raise ProviderError("provider copy-out staging is unavailable")


def _reject_control_return_path(path: str) -> None:
    exact = {
        ".agent-id",
        ".agents-registry.json",
        ".gitattributes",
        ".gitlab-ci.yml",
        ".npmrc",
        ".pypirc",
        ".travis.yml",
        "Jenkinsfile",
        "autonomy-policy.json",
        "azure-pipelines.yml",
        "bitbucket-pipelines.yml",
        "features.json",
        "harness.json",
        "harness.lock",
        "package.json",
        "progress.json",
    }
    prefixes = (
        ".aws/",
        ".buildkite/",
        ".circleci/",
        ".claude/",
        ".git/",
        ".github/",
        ".husky/",
        ".ssh/",
        "hooks/",
    )
    if path in exact or path.startswith(prefixes):
        raise ProviderError("VM generator patch modifies a control-plane path")
    name = Path(path).name
    if name == ".env" or name.startswith(".env.") or name.endswith(
        (".key", ".pem", ".p12", ".pfx", ".crt")
    ):
        raise ProviderError("VM generator patch modifies a credential path")


def _copy_regular_file_to_tree(
    source: Path,
    root: Path,
    relative: str,
    *,
    overwrite: bool,
) -> Path:
    """Copy a verified result file through a non-symlinked staging path."""
    _secure_regular_file(source, "VM returned file")
    source_entry = source.stat()
    if source_entry.st_nlink != 1:
        raise ProviderError("VM returned file must not have multiple links")
    source_mode = _normalized_return_mode(source_entry.st_mode)
    destination = _safe_leaf(root, relative, create_parent=True)
    try:
        existing = destination.lstat()
    except FileNotFoundError:
        existing = None
    except OSError as exc:
        raise ProviderError("provider staging destination is unavailable") from exc
    if existing is not None:
        if not overwrite or stat.S_ISLNK(existing.st_mode) or not stat.S_ISREG(existing.st_mode) or existing.st_nlink != 1:
            raise ProviderError("VM returned file conflicts with the base source")
        try:
            destination.unlink()
        except OSError as exc:
            raise ProviderError("provider staging destination cannot be replaced") from exc
    input_fd: int | None = None
    output_fd: int | None = None
    try:
        input_fd = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        output_fd = os.open(
            destination,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
            source_mode,
        )
    except OSError as exc:
        raise ProviderError("VM returned file cannot be copied") from exc
    try:
        assert input_fd is not None and output_fd is not None
        source_opened = os.fstat(input_fd)
        if (
            not stat.S_ISREG(source_opened.st_mode)
            or source_opened.st_nlink != 1
            or source_opened.st_size != source_entry.st_size
            or _normalized_return_mode(source_opened.st_mode) != source_mode
        ):
            raise ProviderError("VM returned file changed during copy")
        os.fchmod(output_fd, source_mode)
        with os.fdopen(input_fd, "rb", closefd=False) as reader, os.fdopen(output_fd, "wb", closefd=False) as writer:
            while block := reader.read(1024 * 1024):
                writer.write(block)
    except OSError as exc:
        raise ProviderError("VM returned file cannot be copied") from exc
    finally:
        if input_fd is not None:
            os.close(input_fd)
        if output_fd is not None:
            os.close(output_fd)
    return destination


def _remove_regular_file_from_tree(root: Path, relative: str) -> None:
    destination = _safe_leaf(root, relative, create_parent=False)
    try:
        entry = destination.lstat()
    except OSError as exc:
        raise ProviderError("provider staging file is unavailable") from exc
    if stat.S_ISLNK(entry.st_mode) or not stat.S_ISREG(entry.st_mode) or entry.st_nlink != 1:
        raise ProviderError("provider staging file is not removable")
    try:
        destination.unlink()
    except OSError as exc:
        raise ProviderError("provider staging file cannot be removed") from exc


def _create_baseline_source(project_root: Path, ref: str, destination: Path) -> None:
    """Materialize the immutable committed tree for byte-level return checks."""
    try:
        destination.mkdir(mode=0o700)
    except OSError as exc:
        raise ProviderError("provider baseline directory cannot be created") from exc
    _secure_directory(destination, "provider baseline directory")
    try:
        archived = subprocess.run(
            ["git", "-C", str(project_root), "archive", "--format=tar", ref],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=60,
            env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull},
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ProviderError("provider baseline snapshot is unavailable") from exc
    if archived.returncode != 0 or not archived.stdout:
        raise ProviderError("provider baseline snapshot is unavailable")
    total = [0]
    seen: set[str] = set()
    try:
        with tarfile.open(fileobj=io.BytesIO(archived.stdout), mode="r:") as archive:
            for member in archive.getmembers():
                if member.name in seen:
                    raise ProviderError("provider baseline snapshot has duplicate paths")
                seen.add(member.name)
                if member.name.startswith("/") or any(part in {"", ".", ".."} for part in member.name.split("/")):
                    raise ProviderError("provider baseline snapshot has an unsafe path")
                if member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
                    raise ProviderError("provider baseline snapshot contains an unsupported entry")
                if member.isdir():
                    _safe_parent(destination, _safe_relative_parts(member.name, "provider baseline path"), create=True)
                    continue
                target = _safe_leaf(destination, member.name, create_parent=True)
                source = archive.extractfile(member)
                if source is None:
                    raise ProviderError("provider baseline snapshot entry is unreadable")
                with source:
                    _write_stream_exclusive(
                        target,
                        source,
                        maximum=MAX_COPYOUT_BYTES,
                        total=total,
                        mode=member.mode,
                    )
    except (OSError, tarfile.TarError) as exc:
        raise ProviderError("provider baseline snapshot is unreadable") from exc


def _same_file_bytes(left: Path, right: Path) -> bool:
    left_mode = _normalized_return_mode(left.stat().st_mode)
    right_mode = _normalized_return_mode(right.stat().st_mode)
    return left_mode == right_mode and hmac.compare_digest(_sha256_path(left), _sha256_path(right))


def _reconcile_returned_source(
    *,
    returned_root: Path,
    baseline_root: Path,
    staging: Path,
    role: str,
    artifact: str,
) -> tuple[Path, tuple[str, ...]]:
    """Apply only the verified copy-out tree to a host-owned git checkout."""
    returned = _tree_regular_files(returned_root, "VM returned source")
    baseline = _tree_regular_files(baseline_root, "provider baseline source")
    if artifact in baseline or artifact not in returned:
        raise ProviderError("VM returned artifact conflicts with the commissioned base")
    changed: list[str] = []
    for relative in sorted(set(baseline) | set(returned)):
        if relative == artifact:
            continue
        baseline_path = baseline.get(relative)
        returned_path = returned.get(relative)
        if baseline_path is not None and returned_path is not None and _same_file_bytes(baseline_path, returned_path):
            continue
        if role != "generator":
            raise ProviderError("read-only bridge returned a source change")
        _reject_control_return_path(relative)
        changed.append(relative)

    for relative in changed:
        returned_path = returned.get(relative)
        if returned_path is None:
            _remove_regular_file_from_tree(staging, relative)
        else:
            _copy_regular_file_to_tree(
                returned_path,
                staging,
                relative,
                overwrite=relative in baseline,
            )
    staged_artifact = _copy_regular_file_to_tree(
        returned[artifact], staging, artifact, overwrite=False
    )
    return staged_artifact, tuple(changed)


APP_BUNDLE_RELATIVE = Path("framework/templates/claude/dispatch")
APP_RUNTIME_FILES = (
    Path("tool-catalog.py"),
    Path("transports/vm-bridge-provider.py"),
    Path("transports/session-bridge.py"),
    Path("transports/session_bridge_kimi.py"),
    Path("transports/vm-bridge-worker.py"),
)


def _trusted_app_bundle_root() -> Path:
    """Return the non-project app bundle that is allowed to resolve targets."""
    root = _home_directory() / ".tokenizer" / "app"
    provider = root / APP_BUNDLE_RELATIVE / "transports" / "vm-bridge-provider.py"
    if Path(__file__).absolute() != provider:
        raise ProviderError("VM provider was not launched from the installed app bundle")
    current = root
    for part in APP_BUNDLE_RELATIVE.parts:
        if part == ".":
            continue
        try:
            entry = current.lstat()
        except OSError as exc:
            raise ProviderError("installed app bundle is unavailable") from exc
        if (
            stat.S_ISLNK(entry.st_mode)
            or not stat.S_ISDIR(entry.st_mode)
            or entry.st_mode & (stat.S_IWGRP | stat.S_IWOTH)
        ):
            raise ProviderError("installed app bundle is not trusted")
        current = current / part
    try:
        entry = current.lstat()
    except OSError as exc:
        raise ProviderError("installed app bundle is unavailable") from exc
    if (
        stat.S_ISLNK(entry.st_mode)
        or not stat.S_ISDIR(entry.st_mode)
        or entry.st_mode & (stat.S_IWGRP | stat.S_IWOTH)
    ):
        raise ProviderError("installed app bundle is not trusted")
    for relative in APP_RUNTIME_FILES:
        candidate = root / APP_BUNDLE_RELATIVE / relative
        parent = candidate.parent
        while parent != root / APP_BUNDLE_RELATIVE:
            try:
                parent_entry = parent.lstat()
            except OSError as exc:
                raise ProviderError("installed app bundle is unavailable") from exc
            if (
                stat.S_ISLNK(parent_entry.st_mode)
                or not stat.S_ISDIR(parent_entry.st_mode)
                or parent_entry.st_mode & (stat.S_IWGRP | stat.S_IWOTH)
            ):
                raise ProviderError("installed app bundle is not trusted")
            parent = parent.parent
        try:
            entry = candidate.lstat()
        except OSError as exc:
            raise ProviderError("installed app runtime is unavailable") from exc
        if (
            stat.S_ISLNK(entry.st_mode)
            or not stat.S_ISREG(entry.st_mode)
            or entry.st_mode & (stat.S_IWGRP | stat.S_IWOTH)
        ):
            raise ProviderError("installed app runtime is not trusted")
    return root


def _resolve_launch_target(
    *,
    project_root: Path,
    registry: Path,
    adapters: Path,
    target_id: str,
    expected_provenance: str,
) -> dict[str, Any]:
    if SAFE_ID.fullmatch(target_id) is None:
        raise ProviderError("bridge target id is invalid")
    project_registry = project_root / ".agents-registry.json"
    try:
        if registry.resolve() != project_registry.resolve() or registry.is_symlink():
            raise ProviderError("bridge registry is not the project registry")
    except OSError as exc:
        raise ProviderError("bridge registry is unavailable") from exc
    app_root = _trusted_app_bundle_root()
    catalog = app_root / APP_BUNDLE_RELATIVE / "tool-catalog.py"
    try:
        resolved = subprocess.run(
            [
                "/usr/bin/python3",
                "-I",
                str(catalog),
                "target",
                "--registry",
                str(registry),
                "--adapters",
                str(adapters),
                "--target-id",
                target_id,
            ],
            cwd=str(project_root),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=15,
            env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"},
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ProviderError("bridge target cannot be re-resolved") from exc
    if resolved.returncode != 0:
        raise ProviderError("bridge target cannot be re-resolved")
    # Avoid writing target JSON to a worker-visible host path. The VM input
    # archive is the only copy and is staged after this fresh resolution.
    temp = Path(
        tempfile.mkdtemp(prefix="harness-vm-target-", dir=str(_provider_private_runs_root()))
    ) / "target.json"
    try:
        temp.write_text(resolved.stdout, encoding="utf-8")
        return _load_launch_target(temp, expected_provenance)
    finally:
        try:
            temp.unlink(missing_ok=True)
            temp.parent.rmdir()
        except OSError:
            pass


def _write_json_exclusive(path: Path, value: dict[str, Any]) -> None:
    _secure_directory(path.parent, "provider state record parent")
    try:
        existing = path.lstat()
    except FileNotFoundError:
        existing = None
    except OSError as exc:
        raise ProviderError("provider state record is unavailable") from exc
    if existing is not None:
        raise ProviderError("provider state record already exists")
    descriptor: int | None = None
    try:
        descriptor = os.open(
            path,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8", closefd=False) as output:
            json.dump(value, output, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
            output.write("\n")
    except OSError as exc:
        raise ProviderError("provider state record cannot be written") from exc
    finally:
        if descriptor is not None:
            os.close(descriptor)


def launch(args: argparse.Namespace) -> dict[str, Any]:
    """Run one provider-owned VM bridge and return a sanitized run-meta record."""
    project_root = args.project_root.resolve()
    envelope_path = args.envelope.resolve()
    registry = args.registry.resolve()
    adapters = args.adapters.resolve()
    if not project_root.is_dir() or not envelope_path.is_file() or envelope_path.is_symlink():
        raise ProviderError("bridge launch inputs are unavailable")
    envelope = _load_json_no_duplicates(envelope_path, "bridge envelope")
    role = envelope.get("role")
    task_id = envelope.get("task_id")
    batch = envelope.get("batch")
    repo = envelope.get("repo")
    if role not in {"planner", "generator", "evaluator"}:
        raise ProviderError("bridge envelope role is invalid")
    if not isinstance(task_id, str) or SAFE_ID.fullmatch(task_id) is None:
        raise ProviderError("bridge envelope task id is invalid")
    if not isinstance(batch, str) or SAFE_ID.fullmatch(batch) is None:
        raise ProviderError("bridge envelope batch is invalid")
    if not isinstance(repo, dict) or not isinstance(repo.get("ref"), str) or SHA256.fullmatch(repo["ref"]) is None and not re.fullmatch(r"[0-9a-f]{40}", repo["ref"]):
        raise ProviderError("bridge envelope ref is invalid")
    ref = repo["ref"]
    artifact = _safe_artifact_relative(envelope)
    configuration = load_provider_configuration()
    policy = _broker_policy(configuration)
    target = _resolve_launch_target(
        project_root=project_root,
        registry=registry,
        adapters=adapters,
        target_id=args.agent,
        expected_provenance=args.expected_provenance,
    )
    if target.get("bridge_provider_contract_sha256") != configuration.contract_sha256:
        raise ProviderError("bridge target provider contract drifted")
    bridge_command = _validate_target_bundle_command(configuration, target)
    if role not in target.get("roles", []):
        raise ProviderError("bridge target does not allow the envelope role")
    timeout_s = target.get("timeout_s")
    if not isinstance(timeout_s, int) or isinstance(timeout_s, bool) or not 1 <= timeout_s <= 86_400:
        raise ProviderError("bridge target timeout is invalid")
    _assert_vm_ready(configuration)
    launch_proof, launch_nonce = launch_attestation(configuration, args.expected_provenance)
    launch_proof_sha256 = _canonical_sha256(ATTESTATION_VERSION, launch_proof)
    state_root = _validated_caller_state_root(args.state, project_root)
    runs_root = _provider_private_runs_root()
    run_root = runs_root / f"{task_id}-{secrets.token_hex(12)}"
    run_root.mkdir(parents=True, mode=0o700)
    _secure_directory(run_root, "provider private run root")
    staging = run_root / "copyout"
    copyout = run_root / "pipe"
    baseline = run_root / "baseline"
    archive = run_root / "copyin.tar.gz"
    copyout.mkdir(mode=0o700)
    guest_token = secrets.token_hex(16)
    guest_root = f"/var/lib/harness-vm-v1/jobs/{guest_token}"
    unit = f"harness-vm-v1-{guest_token}"
    started = time.monotonic()
    try:
        target_file = run_root / "target.json"
        _write_json_exclusive(target_file, target)
        _create_copyin_archive(
            project_root=project_root,
            ref=ref,
            envelope=envelope_path,
            target=target_file,
            cli_bundle=configuration.cli_bundle,
            destination=archive,
        )
        _create_baseline_source(project_root, ref, baseline)
        _copy_archive_to_guest(configuration, archive, guest_root, (bridge_command[0],))
        with BrokerLease(policy) as broker:
            if broker.port is None:
                raise ProviderError("broker did not allocate a port")
            _set_guest_egress_policy(configuration, policy, broker.port)
            _run_guest_worker(
                configuration,
                guest_root=guest_root,
                unit=unit,
                timeout_s=timeout_s,
                launch_nonce=launch_nonce,
                launch_attestation_sha256=launch_proof_sha256,
                broker=broker,
            )
            payload = _guest_copyout(
                configuration, guest_root=guest_root, artifact=artifact, unit=unit
            )
        extracted = _extract_copyout(payload, copyout)
        artifact_key = f"source/{artifact}"
        returned_artifact = extracted.get(artifact_key)
        if returned_artifact is None:
            raise ProviderError("VM copy-out lacks the commissioned artifact")
        artifact_sha256 = _sha256_path(returned_artifact)
        receipt = _validate_bridge_receipt(
            extracted["state/bridge-result.json"],
            target=target,
            launch_nonce=launch_nonce,
            launch_attestation_sha256=launch_proof_sha256,
            artifact_sha256=artifact_sha256,
        )
        _create_copyout_staging(project_root, ref, staging)
        staged_artifact, source_changes = _reconcile_returned_source(
            returned_root=copyout / "source",
            baseline_root=baseline,
            staging=staging,
            role=role,
            artifact=artifact,
        )
        if returned_artifact != copyout / f"source/{artifact}":
            raise ProviderError("VM returned artifact path is inconsistent")
        if _sha256_path(staged_artifact) != artifact_sha256:
            raise ProviderError("provider artifact copy-out drifted")
        duration = max(0, int(time.monotonic() - started))
        generic_log = run_root / "provider.log"
        generic_log.write_text("vm-v1 supervisor completed\n", encoding="ascii")
        meta = {
            "task_id": task_id,
            "agent_id": args.agent,
            "adapter": target.get("adapter"),
            "model_family": target.get("model_family"),
            "role": role,
            "deliverable": envelope.get("deliverable"),
            "batch": batch,
            "ref": ref,
            "worktree": str(staging),
            "artifact": str(staged_artifact),
            "log": str(generic_log),
            "envelope_path": str(envelope_path),
            "outcome": "RETURNED",
            "exit_code": 0,
            "duration_s": duration,
            "effective_timeout_s": timeout_s,
            "descriptor_timeout_s": timeout_s,
            "termination_reason": "completed",
            "transport": "subagent",
            "bridge": {**receipt, "provider_launch_attestation": launch_proof},
            "source_changes": list(source_changes),
        }
        _write_json_exclusive(state_root / f"run-meta-{task_id}.json", meta)
        return meta
    finally:
        _cleanup_guest_job(configuration, guest_root, unit, f"{unit}-copyout")


def _runner_sha256() -> str:
    """Measure the exact framework runner set that will be staged to a VM."""
    root = Path(__file__).resolve().parent
    names = ("session-bridge.py", "session_bridge_kimi.py", "vm-bridge-worker.py")
    measured: dict[str, str] = {}
    for name in names:
        path = root / name
        _secure_regular_file(path, f"framework VM runner {name}")
        measured[name] = _sha256_file(path)
    return _canonical_sha256("harness/vm-bridge-runner/v1", measured)


def _attestation(
    configuration: ProviderConfiguration,
    *,
    phase: str,
    target_provenance: str | None = None,
    nonce: bytes | None = None,
) -> dict[str, Any]:
    if phase not in {"catalog", "launch"}:
        raise ProviderError("attestation phase is invalid")
    if phase == "launch":
        if not isinstance(target_provenance, str) or SHA256.fullmatch(target_provenance) is None:
            raise ProviderError("launch target provenance is invalid")
    elif target_provenance is not None:
        raise ProviderError("catalog attestation must not bind a target")
    issued = _utc_now()
    nonce = nonce or os.urandom(32)
    value: dict[str, Any] = {
        "version": ATTESTATION_VERSION,
        "provider_id": PROVIDER_ID,
        "provider_kind": PROVIDER_KIND,
        "contract_sha256": configuration.contract_sha256,
        "phase": phase,
        "nonce_sha256": hashlib.sha256(nonce).hexdigest(),
        "issued_at": _utc_text(issued),
        "expires_at": _utc_text(issued + dt.timedelta(seconds=MAX_TTL_SECONDS)),
        "image_sha256": configuration.image_sha256,
        "runner_sha256": _runner_sha256(),
        "cli_bundle_sha256": configuration.cli_bundle_sha256,
        "broker_policy_sha256": configuration.broker_policy_sha256,
    }
    if target_provenance is not None:
        value["target_provenance_sha256"] = target_provenance
    return value


def catalog_attestation() -> dict[str, Any]:
    configuration = load_provider_configuration()
    # A bridge is not selectable merely because its VM image exists. Verify
    # that the broker policy and its host-only credential source are usable
    # before making a signable catalog observation. The token stays in this
    # stack frame and is never placed in the returned object.
    _read_broker_credential(_broker_policy(configuration))
    _bundle_protocol_commands(configuration.cli_bundle)
    _assert_vm_ready(configuration)
    attestation = _attestation(configuration, phase="catalog")
    return {
        "available": True,
        "provider": {
            "id": PROVIDER_ID,
            "kind": PROVIDER_KIND,
            "contract_sha256": configuration.contract_sha256,
        },
        "attestation": attestation,
    }


def launch_attestation(
    configuration: ProviderConfiguration, target_provenance: str
) -> tuple[dict[str, Any], str]:
    """Create a one-shot attestation and retain its raw nonce only in memory."""
    nonce = secrets.token_hex(16)
    return (
        _attestation(
            configuration,
            phase="launch",
            target_provenance=target_provenance,
            nonce=nonce.encode("ascii"),
        ),
        nonce,
    )


def unavailable(reason: str) -> dict[str, Any]:
    # Keep the public result intentionally categorical. Full local paths and
    # broker setup details belong in ``doctor`` and are never emitted to a
    # catalog/device report.
    return {"available": False, "reason": reason}


def doctor() -> dict[str, Any]:
    try:
        result = catalog_attestation()
    except ProviderError as exc:
        return {"available": False, "reason": str(exc)}
    return result


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    sub = root.add_subparsers(dest="command", required=True)
    sub.add_parser("catalog-attest")
    sub.add_parser("doctor")
    launch_parser = sub.add_parser("launch")
    launch_parser.add_argument("--agent", required=True)
    launch_parser.add_argument("--envelope", required=True, type=Path)
    launch_parser.add_argument("--registry", required=True, type=Path)
    launch_parser.add_argument("--adapters", required=True, type=Path)
    launch_parser.add_argument("--project-root", required=True, type=Path)
    launch_parser.add_argument("--state", required=True, type=Path)
    launch_parser.add_argument("--expected-provenance", required=True)
    return root


def main() -> int:
    args = parser().parse_args()
    if args.command == "catalog-attest":
        try:
            result = catalog_attestation()
        except ProviderError as exc:
            result = unavailable(str(exc))
    elif args.command == "doctor":
        result = doctor()
    elif args.command == "launch":
        try:
            result = launch(args)
        except ProviderError as exc:
            print(f"[vm-bridge-provider] {exc}", file=sys.stderr)
            return 2
    else:
        raise AssertionError("unreachable provider command")
    print(json.dumps(result, ensure_ascii=True, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
