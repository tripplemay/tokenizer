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
import contextlib
import datetime as dt
import errno
import fcntl
import hashlib
import hmac
import http.client
import http.server
import ipaddress
import io
import json
import os
import pwd
import re
import select
import secrets
import socket
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
from typing import Any, Iterator, Mapping


CONFIG_VERSION = "harness/vm-v1-provider-config/1"
ATTESTATION_VERSION = "harness/external-bridge-provider-attestation/1"
CONTRACT_VERSION = "harness/external-bridge-provider/1"
PROVIDER_ID = "harness-vm-v1"
PROVIDER_KIND = "vm-v1"
LIMA_RUNTIME_KIND = "lima-vz-plain-v1"
WORKER_USER = "harnessvm"
MAX_EXTERNAL_TIMEOUT_SECONDS = 180
CATALOG_ATTESTATION_TTL_SECONDS = 300
LAUNCH_LOCK_WAIT_SECONDS = 30
MAX_SOURCE_ARCHIVE_BYTES = 128 * 1024 * 1024
MAX_SOURCE_ARCHIVE_ENTRIES = 10_000
MAX_SOURCE_UNPACKED_BYTES = 128 * 1024 * 1024
MAX_COPYIN_ARCHIVE_BYTES = 400 * 1024 * 1024
MAX_ENVELOPE_BYTES = 1 * 1024 * 1024
MAX_TARGET_BYTES = 1 * 1024 * 1024
# The verified Linux ARM64 Kimi executable is roughly 144 MiB. Keep a
# generous but finite compressed-bundle ceiling, and stream copy-in so this
# allowance never becomes a monolithic host-memory allocation.
MAX_CLI_BUNDLE_BYTES = 256 * 1024 * 1024
MAX_RUNNER_BYTES = 2 * 1024 * 1024
MAX_COPYOUT_FILES = 10_000
MAX_COPYOUT_BYTES = 64 * 1024 * 1024
MAX_BROKER_REQUEST_BYTES = 16 * 1024 * 1024
MAX_BROKER_RESPONSE_BYTES = 32 * 1024 * 1024
MAX_BROKER_REQUESTS = 256
MAX_BROKER_CONCURRENT_CONNECTIONS = 8
BROKER_CLIENT_TIMEOUT_SECONDS = 10
BROKER_UPSTREAM_TIMEOUT_SECONDS = 30
# A broker remains alive through the longest vendor turn, bounded copy-out,
# one in-flight upstream request, and a shutdown margin. Refuse a token that
# cannot cover that complete capability lifetime before opening the lease.
GUEST_COPYOUT_TIMEOUT_SECONDS = 120
LAUNCH_ATTESTATION_COMPLETION_MARGIN_SECONDS = 60
LAUNCH_ATTESTATION_TTL_SECONDS = (
    MAX_EXTERNAL_TIMEOUT_SECONDS
    + GUEST_COPYOUT_TIMEOUT_SECONDS
    + BROKER_UPSTREAM_TIMEOUT_SECONDS
    + LAUNCH_ATTESTATION_COMPLETION_MARGIN_SECONDS
)
BROKER_CREDENTIAL_EXPIRY_MARGIN_SECONDS = 60
MIN_BROKER_CREDENTIAL_LIFETIME_SECONDS = (
    MAX_EXTERNAL_TIMEOUT_SECONDS
    + GUEST_COPYOUT_TIMEOUT_SECONDS
    + BROKER_UPSTREAM_TIMEOUT_SECONDS
    + BROKER_CREDENTIAL_EXPIRY_MARGIN_SECONDS
)
MAX_BROKER_JSON_DEPTH = 32
MAX_BROKER_JSON_OBJECT_ENTRIES = 256
MAX_BROKER_JSON_ARRAY_ITEMS = 1_024
MAX_BROKER_JSON_STRING_BYTES = 4 * 1024 * 1024
MAX_BROKER_MESSAGES = 512
MAX_BROKER_TOOLS = 64
LIMA_GUEST_GATEWAY = "192.168.5.2"
BROKER_LISTEN_HOST = "127.0.0.1"
KIMI_CODE_OAUTH_UPSTREAM = "https://api.kimi.com/coding/v1"
KIMI_CHAT_COMPLETIONS_PATH = "/chat/completions"
SHA256 = re.compile(r"^[0-9a-f]{64}$")
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
SAFE_ARTIFACT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$")
SAFE_GUEST_ROOT = re.compile(r"^/var/lib/harness-vm-v1/jobs/[0-9a-f]{32}$")
KIMI_VERSION = re.compile(r"^[0-9]+(?:\.[0-9]+){2}(?:[-+][A-Za-z0-9.-]+)?$")
RUNNER_NAMES = ("session-bridge.py", "session_bridge_kimi.py", "vm-bridge-worker.py")

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
    "image_location",
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


def _lima_environment() -> dict[str, str]:
    """Return the minimal fixed host environment required by Lima itself.

    Lima derives its profile location from ``HOME`` even when every runtime
    path is already content-addressed in the provider configuration.  Do not
    inherit a caller HOME: use only the effective account's passwd-derived
    home alongside the fixed command locale and search path.
    """
    return {
        "HOME": str(_home_directory()),
        "PATH": "/usr/bin:/bin",
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
    }


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


def _snapshot_regular_file(
    source: Path,
    destination: Path,
    label: str,
    *,
    expected_sha256: str | None = None,
    maximum_bytes: int | None = None,
) -> str:
    """Copy one checked file into provider-private storage through stable fds.

    The returned digest names the exact bytes later staged into the guest. The
    source can change after this function returns without changing a launch.
    """
    _secure_regular_file(source, label)
    _secure_directory(destination.parent, "provider input snapshot parent")
    if maximum_bytes is not None and (
        not isinstance(maximum_bytes, int) or maximum_bytes < 1
    ):
        raise ProviderError(f"{label} snapshot limit is invalid")
    try:
        initial = source.lstat()
        if maximum_bytes is not None and initial.st_size > maximum_bytes:
            raise ProviderError(f"{label} exceeds its snapshot size limit")
        source_fd = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError as exc:
        raise ProviderError(f"{label} cannot be snapshotted") from exc

    destination_fd: int | None = None
    succeeded = False
    try:
        opened = os.fstat(source_fd)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_dev != initial.st_dev
            or opened.st_ino != initial.st_ino
        ):
            raise ProviderError(f"{label} changed while it was being snapshotted")
        destination_fd = os.open(
            destination,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
        os.fchmod(destination_fd, 0o600)
        digest = hashlib.sha256()
        total = 0
        while True:
            block = os.read(source_fd, 1024 * 1024)
            if not block:
                break
            total += len(block)
            if maximum_bytes is not None and total > maximum_bytes:
                raise ProviderError(f"{label} exceeds its snapshot size limit")
            digest.update(block)
            view = memoryview(block)
            while view:
                written = os.write(destination_fd, view)
                if written <= 0:
                    raise OSError("snapshot write made no progress")
                view = view[written:]
        os.fsync(destination_fd)
        observed = digest.hexdigest()
        if expected_sha256 is not None and not hmac.compare_digest(observed, expected_sha256):
            raise ProviderError(f"{label} digest drifted before its launch snapshot")
        succeeded = True
        return observed
    except OSError as exc:
        raise ProviderError(f"{label} cannot be snapshotted") from exc
    finally:
        try:
            os.close(source_fd)
        finally:
            if destination_fd is not None:
                os.close(destination_fd)
            if not succeeded:
                try:
                    destination.unlink(missing_ok=True)
                except OSError:
                    pass


def _read_regular_file_capped(path: Path, label: str, maximum_bytes: int) -> bytes:
    """Read a stable private file only after enforcing a hard byte ceiling."""
    if not isinstance(maximum_bytes, int) or maximum_bytes < 1:
        raise ProviderError(f"{label} size limit is invalid")
    _secure_regular_file(path, label)
    try:
        initial = path.lstat()
        if initial.st_size > maximum_bytes:
            raise ProviderError(f"{label} exceeds its size limit")
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError as exc:
        raise ProviderError(f"{label} is unreadable") from exc
    try:
        opened = os.fstat(descriptor)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_dev != initial.st_dev
            or opened.st_ino != initial.st_ino
            or opened.st_size > maximum_bytes
        ):
            raise ProviderError(f"{label} changed while it was being read")
        chunks: list[bytes] = []
        total = 0
        while True:
            block = os.read(descriptor, 1024 * 1024)
            if not block:
                break
            total += len(block)
            if total > maximum_bytes:
                raise ProviderError(f"{label} exceeds its size limit")
            chunks.append(block)
        return b"".join(chunks)
    except OSError as exc:
        raise ProviderError(f"{label} is unreadable") from exc
    finally:
        os.close(descriptor)


def _absolute_path(value: Any, label: str) -> Path:
    """Normalize a caller path lexically without resolving any symlink."""
    try:
        raw = os.fspath(value)
    except TypeError as exc:
        raise ProviderError(f"{label} path is invalid") from exc
    if not isinstance(raw, str) or not raw:
        raise ProviderError(f"{label} path is invalid")
    return Path(os.path.abspath(raw))


def _absolute_non_symlink_input(value: Any, label: str) -> Path:
    """Return an existing input path after refusing every symlink hop."""
    path = _absolute_path(value, label)
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current = current / part
        try:
            entry = current.lstat()
        except OSError as exc:
            raise ProviderError(f"{label} is unavailable") from exc
        if stat.S_ISLNK(entry.st_mode):
            raise ProviderError(f"{label} must not traverse a symlink")
    return path


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


def _image_location(value: Any) -> str:
    """Validate the immutable source URL that Lima must report for the VM image."""
    if not isinstance(value, str) or not value or len(value) > 2_048:
        raise ProviderError("provider VM image location is invalid")
    parsed = urllib.parse.urlsplit(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
    ):
        raise ProviderError("provider VM image location must be an HTTPS URL")
    return value


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
    image_location: str
    cli_bundle: Path
    cli_bundle_sha256: str
    broker_policy: Path
    broker_policy_sha256: str


@dataclass(frozen=True)
class BrokerPolicy:
    guest_broker_host: str
    upstream_base_url: str
    credential_source: dict[str, str]


@dataclass(frozen=True)
class KimiClientIdentity:
    """Immutable client identity published by the hashed Kimi CLI bundle."""

    user_agent: str
    x_msh_platform: str
    x_msh_version: str


@dataclass(frozen=True)
class CliBundleManifest:
    protocol_commands: dict[str, tuple[str, ...]]
    kimi_identity: KimiClientIdentity


@dataclass(frozen=True)
class LaunchInputSnapshots:
    """Provider-private copies of every mutable input staged to a guest."""

    envelope: Path
    envelope_sha256: str
    target: Path
    cli_bundle: Path
    cli_bundle_sha256: str
    runners: Mapping[str, Path]
    runner_sha256: str


def _require_fixed_kimi_broker_policy(policy: BrokerPolicy) -> None:
    """Defend the broker boundary even when called outside config loading."""
    if (
        not isinstance(policy, BrokerPolicy)
        or policy.guest_broker_host != LIMA_GUEST_GATEWAY
        or policy.upstream_base_url != KIMI_CODE_OAUTH_UPSTREAM
        or policy.credential_source != {"kind": "kimi-code-oauth-file-v1"}
    ):
        raise ProviderError("provider broker policy is not the fixed Kimi OAuth route")


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
    image_location = _image_location(runtime.get("image_location"))
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
        image_location=image_location,
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
        # The guest is allowed to address only the immutable plain-Lima
        # usernet gateway, never a DNS name that a child can rebind.
        address = ipaddress.ip_address(guest_host)
    except ValueError as exc:
        raise ProviderError("provider broker guest host must be an IP address") from exc
    if not address.is_private or guest_host != LIMA_GUEST_GATEWAY:
        raise ProviderError("provider broker guest host is not the plain-Lima gateway")
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
    if source != {"kind": "kimi-code-oauth-file-v1"}:
        raise ProviderError("provider broker credential source is not the fixed Kimi OAuth source")
    if upstream.rstrip("/") != KIMI_CODE_OAUTH_UPSTREAM:
        raise ProviderError("Kimi OAuth broker upstream is not the fixed Kimi Code endpoint")
    return BrokerPolicy(
        guest_broker_host=guest_host,
        upstream_base_url=KIMI_CODE_OAUTH_UPSTREAM,
        credential_source={"kind": "kimi-code-oauth-file-v1"},
    )


def _read_broker_credential(policy: BrokerPolicy) -> str:
    """Read one credential into broker memory without exposing it to a VM.

    The Kimi OAuth source is deliberately fixed to the account's standard
    credential path; configuration cannot redirect it to an arbitrary file.
    It is read by the trusted host provider only and never copied, logged, or
    encoded into an attestation/receipt.
    """
    _require_fixed_kimi_broker_policy(policy)
    source = _home_directory() / ".kimi-code" / "credentials" / "kimi-code.json"
    _secure_regular_file(source, "Kimi OAuth credential", require_private=True)
    value = _load_json_no_duplicates(source, "Kimi OAuth credential")
    token = value.get("access_token")
    expires_at = value.get("expires_at")
    if not isinstance(token, str) or not token or len(token) > 16_384:
        raise ProviderError("Kimi OAuth credential has no usable access token")
    if not isinstance(expires_at, (int, float)) or isinstance(expires_at, bool):
        raise ProviderError("Kimi OAuth credential has no expiry")
    # Kimi releases have used both Unix-second and Unix-millisecond expiry
    # values. Accept either representation, but reserve enough remaining life
    # for the complete bounded broker capability rather than only its startup.
    expiry_seconds = float(expires_at) / (1000 if float(expires_at) > 10_000_000_000 else 1)
    if expiry_seconds <= _utc_now().timestamp() + MIN_BROKER_CREDENTIAL_LIFETIME_SECONDS:
        raise ProviderError("Kimi OAuth credential lacks a full broker lease lifetime")
    return token


class _BrokerServer(http.server.ThreadingHTTPServer):
    # The process owns this server and joins it before discarding the raw
    # credential. No request logs are emitted because request targets may carry
    # task-derived data.
    daemon_threads = False
    block_on_close = True
    allow_reuse_address = False

    def __init__(
        self,
        address: tuple[str, int],
        policy: BrokerPolicy,
        lease: str,
        credential: str,
        identity: KimiClientIdentity,
    ) -> None:
        _require_fixed_kimi_broker_policy(policy)
        if not isinstance(credential, str) or not credential:
            raise ProviderError("broker credential is unavailable")
        self.policy = policy
        self.lease: str | None = lease
        self.credential: str | None = credential
        self.identity = identity
        self._request_count = 0
        self._state_lock = threading.Lock()
        self._accepting = True
        self._connection_slots = threading.BoundedSemaphore(MAX_BROKER_CONCURRENT_CONNECTIONS)
        self._active_sockets: set[socket.socket] = set()
        self._active_upstreams: set[http.client.HTTPSConnection] = set()
        super().__init__(address, _BrokerHandler)

    def get_request(self) -> tuple[socket.socket, tuple[str, int]]:
        request, address = super().get_request()
        request.settimeout(BROKER_CLIENT_TIMEOUT_SECONDS)
        return request, address

    @staticmethod
    def _close_request_socket(request: socket.socket, *, saturated: bool) -> None:
        try:
            request.settimeout(1)
            if saturated:
                request.sendall(
                    b"HTTP/1.1 429 Too Many Requests\r\n"
                    b"Connection: close\r\nContent-Length: 0\r\n\r\n"
                )
        except OSError:
            pass
        finally:
            try:
                request.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                request.close()
            except OSError:
                pass

    def process_request(self, request: socket.socket, client_address: tuple[str, int]) -> None:
        # Reserve capacity before a handler thread can block on incomplete
        # headers or bodies. Saturated peers receive no credential-bearing work.
        if not self._connection_slots.acquire(blocking=False):
            self._close_request_socket(request, saturated=True)
            return
        registered = False
        try:
            with self._state_lock:
                if self._accepting:
                    self._active_sockets.add(request)
                    registered = True
            if not registered:
                self._close_request_socket(request, saturated=False)
                self._connection_slots.release()
                return
            super().process_request(request, client_address)
        except BaseException:
            if registered:
                with self._state_lock:
                    self._active_sockets.discard(request)
            self._connection_slots.release()
            raise

    def process_request_thread(self, request: socket.socket, client_address: tuple[str, int]) -> None:
        try:
            super().process_request_thread(request, client_address)
        finally:
            with self._state_lock:
                self._active_sockets.discard(request)
            self._connection_slots.release()

    def reserve_request(self) -> bool:
        """Consume one broker request from this short-lived lease budget."""
        with self._state_lock:
            if not self._accepting or self._request_count >= MAX_BROKER_REQUESTS:
                return False
            self._request_count += 1
            return True

    def authorize_lease(self, authorization: str) -> bool:
        with self._state_lock:
            return bool(
                self._accepting
                and self.lease is not None
                and hmac.compare_digest(authorization, f"Bearer {self.lease}")
            )

    def credential_for_request(self) -> str | None:
        with self._state_lock:
            if not self._accepting or self.credential is None:
                return None
            return self.credential

    def register_upstream(self, connection: http.client.HTTPSConnection) -> bool:
        with self._state_lock:
            if not self._accepting:
                return False
            self._active_upstreams.add(connection)
            return True

    def unregister_upstream(self, connection: http.client.HTTPSConnection) -> None:
        with self._state_lock:
            self._active_upstreams.discard(connection)

    def revoke(self) -> None:
        """Stop accepting and close all in-flight credential-bearing channels."""
        with self._state_lock:
            self._accepting = False
            self.lease = None
            self.credential = None
            sockets = tuple(self._active_sockets)
            upstreams = tuple(self._active_upstreams)
        for connection in upstreams:
            try:
                connection.close()
            except OSError:
                pass
        for request in sockets:
            self._close_request_socket(request, saturated=False)


def _is_loopback_peer(address: str) -> bool:
    try:
        return ipaddress.ip_address(address).is_loopback
    except ValueError:
        return False


def _reject_json_constant(_value: str) -> None:
    raise ValueError("JSON constants are not accepted")


def _bounded_json(value: Any, depth: int = 0) -> bool:
    """Bound an already-decoded request before it reaches the Kimi endpoint."""
    if depth > MAX_BROKER_JSON_DEPTH:
        return False
    if value is None or isinstance(value, bool):
        return True
    if isinstance(value, int):
        return -(2**53) < value < 2**53
    if isinstance(value, float):
        return value == value and value not in {float("inf"), float("-inf")}
    if isinstance(value, str):
        return len(value.encode("utf-8")) <= MAX_BROKER_JSON_STRING_BYTES
    if isinstance(value, list):
        return len(value) <= MAX_BROKER_JSON_ARRAY_ITEMS and all(
            _bounded_json(item, depth + 1) for item in value
        )
    if isinstance(value, dict):
        return len(value) <= MAX_BROKER_JSON_OBJECT_ENTRIES and all(
            isinstance(key, str)
            and len(key) <= 256
            and _bounded_json(item, depth + 1)
            for key, item in value.items()
        )
    return False


def _validated_kimi_chat_request(body: bytes) -> None:
    """Accept only the version-pinned Kimi Chat Completions wire contract."""
    try:
        value = json.loads(
            body.decode("utf-8"),
            object_pairs_hook=_reject_duplicate_pairs,
            parse_constant=_reject_json_constant,
        )
    except (UnicodeDecodeError, ValueError) as exc:
        raise ProviderError("broker request JSON is invalid") from exc
    fields = {
        "max_completion_tokens",
        "messages",
        "model",
        "prompt_cache_key",
        "stream",
        "stream_options",
        "thinking",
        "tools",
    }
    if not isinstance(value, dict) or set(value) != fields or not _bounded_json(value):
        raise ProviderError("broker request JSON shape is invalid")
    if value.get("model") != "kimi-for-coding" or value.get("stream") is not True:
        raise ProviderError("broker request model contract is invalid")
    completion_tokens = value.get("max_completion_tokens")
    if (
        not isinstance(completion_tokens, int)
        or isinstance(completion_tokens, bool)
        or not 1 <= completion_tokens <= 262_144
    ):
        raise ProviderError("broker request completion budget is invalid")
    messages = value.get("messages")
    if (
        not isinstance(messages, list)
        or not messages
        or len(messages) > MAX_BROKER_MESSAGES
        or any(not isinstance(message, dict) for message in messages)
    ):
        raise ProviderError("broker request messages are invalid")
    tools = value.get("tools")
    if (
        not isinstance(tools, list)
        or len(tools) > MAX_BROKER_TOOLS
        or any(not isinstance(tool, dict) for tool in tools)
    ):
        raise ProviderError("broker request tools are invalid")
    prompt_cache_key = value.get("prompt_cache_key")
    if not isinstance(prompt_cache_key, str) or not prompt_cache_key or len(prompt_cache_key) > 512:
        raise ProviderError("broker request cache key is invalid")
    stream_options = value.get("stream_options")
    if stream_options != {"include_usage": True}:
        raise ProviderError("broker request stream contract is invalid")
    thinking = value.get("thinking")
    if not isinstance(thinking, dict) or set(thinking) - {"type", "keep", "effort"}:
        raise ProviderError("broker request thinking contract is invalid")
    if thinking.get("type") not in {"enabled", "disabled"}:
        raise ProviderError("broker request thinking contract is invalid")
    for key in ("keep", "effort"):
        item = thinking.get(key)
        if item is not None and (not isinstance(item, str) or len(item) > 32):
            raise ProviderError("broker request thinking contract is invalid")


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
        self._reject(405)

    def do_POST(self) -> None:  # noqa: N802 - HTTP server API spelling
        self._proxy()

    def _proxy(self) -> None:
        if self.command != "POST":
            self._reject(405)
            return
        if not _is_loopback_peer(self.client_address[0]):
            self._reject(403)
            return
        if self.path != KIMI_CHAT_COMPLETIONS_PATH:
            self._reject(404)
            return
        authorization_values = self.headers.get_all("Authorization") or []
        if len(authorization_values) != 1:
            self._reject(403)
            return
        authorization = authorization_values[0]
        if not self.server.authorize_lease(authorization):
            self._reject(403)
            return
        content_types = self.headers.get_all("Content-Type") or []
        if content_types != ["application/json"]:
            self._reject(415)
            return
        if self.headers.get_all("Transfer-Encoding") or self.headers.get_all("Content-Encoding"):
            self._reject(400)
            return
        lengths = self.headers.get_all("Content-Length") or []
        if len(lengths) != 1 or re.fullmatch(r"(?:0|[1-9][0-9]{0,7})", lengths[0]) is None:
            self._reject(400)
            return
        try:
            length = int(lengths[0])
        except ValueError:
            self._reject(400)
            return
        if length <= 0 or length > MAX_BROKER_REQUEST_BYTES:
            self._reject(413)
            return
        # Spend the capability before reading an attacker-controlled body so a
        # guest process cannot use malformed requests for unbounded host work.
        if not self.server.reserve_request():
            self._reject(429)
            return
        try:
            body = self.rfile.read(length)
        except OSError:
            self._reject(400)
            return
        if len(body) != length:
            self._reject(400)
            return
        try:
            _validated_kimi_chat_request(body)
        except ProviderError:
            self._reject(400)
            return
        credential = self.server.credential_for_request()
        if credential is None:
            self._reject(503)
            return
        upstream = urllib.parse.urlsplit(self.server.policy.upstream_base_url)
        upstream_path = upstream.path.rstrip("/") + KIMI_CHAT_COMPLETIONS_PATH
        headers: dict[str, str] = {
            "Host": upstream.netloc,
            "Authorization": f"Bearer {credential}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": self.server.identity.user_agent,
            "X-Msh-Platform": self.server.identity.x_msh_platform,
            "X-Msh-Version": self.server.identity.x_msh_version,
            "Content-Length": str(len(body)),
        }
        connection: http.client.HTTPSConnection | None = None
        try:
            connection = http.client.HTTPSConnection(
                upstream.hostname,
                upstream.port or 443,
                timeout=BROKER_UPSTREAM_TIMEOUT_SECONDS,
            )
            if not self.server.register_upstream(connection):
                raise ProviderError("broker lease is no longer available")
            connection.request(self.command, upstream_path, body=body, headers=headers)
            response = connection.getresponse()
            response_body = response.read(MAX_BROKER_RESPONSE_BYTES + 1)
            if len(response_body) > MAX_BROKER_RESPONSE_BYTES:
                raise ProviderError("broker upstream response exceeds its limit")
        except (OSError, http.client.HTTPException, ProviderError):
            self._reject(502)
            return
        finally:
            try:
                if connection is not None:
                    self.server.unregister_upstream(connection)
                    connection.close()
            except OSError:
                pass
            credential = None
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
                "set-cookie",
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

    def __init__(self, policy: BrokerPolicy, identity: KimiClientIdentity) -> None:
        self.policy = policy
        self.identity = identity
        self._credential: str | None = None
        self._server: _BrokerServer | None = None
        self._thread: threading.Thread | None = None
        self.lease: str | None = None
        self.port: int | None = None

    def __enter__(self) -> "BrokerLease":
        self._credential = _read_broker_credential(self.policy)
        self.lease = secrets.token_urlsafe(48)
        # Lima translates its plain-usernet gateway to host loopback. Binding
        # only there keeps the short-lived broker off every LAN interface;
        # guest egress still targets the fixed gateway below.
        self._server = _BrokerServer(
            (BROKER_LISTEN_HOST, 0), self.policy, self.lease, self._credential, self.identity
        )
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
        try:
            if self._server is not None:
                self._server.revoke()
                self._server.shutdown()
                self._server.server_close()
            if self._thread is not None:
                self._thread.join(timeout=BROKER_CLIENT_TIMEOUT_SECONDS + 2)
        finally:
            self._credential = None
            self.lease = None
            self.port = None
            self._server = None
            self._thread = None


def _run_vm(
    configuration: ProviderConfiguration,
    command: list[str],
    *,
    input_bytes: bytes | None = None,
    input_path: Path | None = None,
    timeout: int = 90,
) -> subprocess.CompletedProcess[bytes]:
    """Run one fixed plain-Lima guest command without caller environment."""
    if input_bytes is not None and input_path is not None:
        raise ProviderError("VM provider input source is ambiguous")
    argv = [
        str(configuration.executable),
        "shell",
        "--workdir=/",
        configuration.profile,
        *command,
    ]
    options: dict[str, Any] = {
        "stdout": subprocess.PIPE,
        "stderr": subprocess.DEVNULL,
        "timeout": timeout,
        "env": _lima_environment(),
        "check": False,
    }
    descriptor: int | None = None
    try:
        if input_path is None:
            return subprocess.run(argv, input=input_bytes, **options)
        _secure_regular_file(input_path, "VM provider input", require_private=True)
        initial = input_path.lstat()
        descriptor = os.open(input_path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        opened = os.fstat(descriptor)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_dev != initial.st_dev
            or opened.st_ino != initial.st_ino
            or opened.st_size != initial.st_size
        ):
            raise ProviderError("VM provider input changed before streaming")
        with os.fdopen(descriptor, "rb", closefd=False) as stream:
            result = subprocess.run(argv, stdin=stream, **options)
        final = os.fstat(descriptor)
        if (
            final.st_dev != opened.st_dev
            or final.st_ino != opened.st_ino
            or final.st_size != opened.st_size
        ):
            raise ProviderError("VM provider input changed during streaming")
        return result
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ProviderError("VM provider command is unavailable") from exc
    finally:
        if descriptor is not None:
            os.close(descriptor)


def _validate_live_image_binding(
    runtime: dict[str, Any], configuration: ProviderConfiguration
) -> None:
    """Bind the configured local image hash to Lima's selected guest image.

    Lima reports all candidate images in profile order. The first candidate for
    the running architecture is the one the instance selected, so accepting a
    later matching entry would let an unpinned earlier fallback make the
    attestation lie about the boot image.
    """
    images = runtime.get("images")
    if not isinstance(images, list):
        raise ProviderError("VM provider image configuration is malformed")
    selected: dict[str, Any] | None = None
    for item in images:
        if not isinstance(item, dict):
            raise ProviderError("VM provider image configuration is malformed")
        if item.get("arch") == "aarch64":
            selected = item
            break
    if selected is None:
        raise ProviderError("VM provider has no aarch64 image binding")
    if (
        selected.get("location") != configuration.image_location
        or selected.get("digest") != f"sha256:{configuration.image_sha256}"
    ):
        raise ProviderError("VM provider live image does not match its configured image")


def _validated_lima_status(configuration: ProviderConfiguration) -> dict[str, Any]:
    """Read the fixed instance status and prove the no-host-input contract."""
    try:
        status = subprocess.run(
            [str(configuration.executable), "list", configuration.profile, "--json"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=15,
            env=_lima_environment(),
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
    _validate_live_image_binding(runtime, configuration)
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
            "test -x /usr/bin/setpriv; test ! -L /usr/bin/setpriv; "
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


def _reset_guest_egress_baseline(configuration: ProviderConfiguration) -> None:
    """Install the provider-defined default-deny state for the shared VM.

    A guest-produced ``iptables-save`` payload must never be replayed by the
    host provider. Every launch begins and ends at this fixed baseline.
    """
    script = " ".join(
        (
            "set -eu;",
            "sudo -n iptables -w -F OUTPUT;",
            "sudo -n iptables -w -P OUTPUT DROP;",
            "sudo -n iptables -w -A OUTPUT -o lo -j ACCEPT;",
            "sudo -n iptables -w -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT;",
        )
    )
    result = _run_vm(configuration, ["sh", "-ec", script], timeout=30)
    if result.returncode != 0:
        raise ProviderError("VM provider could not reset its firewall baseline")


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
    if target.get("deliverable_channel") not in {"file", "terminal-message"}:
        raise ProviderError("bridge target deliverable channel is invalid")
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


def _bundle_manifest(bundle: Path) -> CliBundleManifest:
    """Read the signed command table and Kimi identity from the staged bundle.

    Project manifests can describe a compatible bridge, but they cannot select
    an executable or an upstream client identity. Both are bound to the hashed
    provider bundle so a future CLI joins only after a released bundle adds its
    matching command and identity declaration.
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
    if not isinstance(value, dict) or set(value) != {
        "version",
        "protocol_commands",
        "kimi_identity",
    }:
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
    if result != {"acp-native-agent/v1": ("kimi", "acp")}:
        raise ProviderError("provider CLI bundle does not declare the fixed Kimi ACP command")
    raw_identity = value.get("kimi_identity")
    if not isinstance(raw_identity, dict) or set(raw_identity) != {
        "user_agent",
        "x_msh_platform",
        "x_msh_version",
    }:
        raise ProviderError("provider CLI bundle Kimi identity is invalid")
    user_agent = raw_identity.get("user_agent")
    platform = raw_identity.get("x_msh_platform")
    version = raw_identity.get("x_msh_version")
    if (
        not isinstance(user_agent, str)
        or not isinstance(platform, str)
        or not isinstance(version, str)
        or any(
            not value
            or len(value) > 128
            or any(ord(character) < 0x20 or ord(character) > 0x7E for character in value)
            for value in (user_agent, platform, version)
        )
        or platform != "kimi_code_cli"
        or KIMI_VERSION.fullmatch(version) is None
        or user_agent != f"kimi-code-cli/{version}"
    ):
        raise ProviderError("provider CLI bundle Kimi identity is invalid")
    return CliBundleManifest(
        protocol_commands=result,
        kimi_identity=KimiClientIdentity(
            user_agent=user_agent,
            x_msh_platform=platform,
            x_msh_version=version,
        ),
    )


def _bundle_protocol_commands(bundle: Path) -> dict[str, tuple[str, ...]]:
    return _bundle_manifest(bundle).protocol_commands


def _bundle_kimi_identity(bundle: Path) -> KimiClientIdentity:
    return _bundle_manifest(bundle).kimi_identity


def _catalog_supported_routes(bundle: Path) -> list[dict[str, Any]]:
    """Publish only routes executable by this bundle and its Kimi broker."""
    commands = _bundle_protocol_commands(bundle)
    command = commands.get("acp-native-agent/v1")
    if command != ("kimi", "acp"):
        raise ProviderError("provider CLI bundle does not expose a supported Kimi ACP route")
    return [
        {
            "tool": "kimi",
            "protocol": {
                "kind": "acp-native-agent/v1",
                "command": list(command),
                "request_delivery": "stdin",
                "response_format": "json",
            },
        }
    ]


def _reject_duplicate_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _validate_target_bundle_command(
    configuration: ProviderConfiguration,
    target: dict[str, Any],
    *,
    cli_bundle: Path | None = None,
) -> tuple[str, ...]:
    protocol = target.get("bridge_protocol")
    if not isinstance(protocol, dict):
        raise ProviderError("bridge target protocol is invalid")
    commands = _bundle_protocol_commands(cli_bundle or configuration.cli_bundle)
    expected = commands.get(protocol.get("kind"))
    command = protocol.get("command")
    if expected is None or not isinstance(command, list) or tuple(command) != expected:
        raise ProviderError("bridge target command is not bound to the provider CLI bundle")
    return expected


def _excluded_worker_source_path(path: str) -> bool:
    """Keep host-control and CLI state out of every worker-visible tree."""
    parts = tuple(path.split("/"))
    return any(
        part.casefold() in {"agents.md", ".agents", ".kimi-code"}
        for part in parts
    )


def _stream_commissioned_git_archive(
    project_root: Path,
    ref: str,
    output: Any,
    *,
    label: str,
) -> None:
    """Stream a bounded immutable Git tar without materializing it in memory."""
    try:
        process = subprocess.Popen(
            ["git", "-C", str(project_root), "archive", "--format=tar", ref],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env={
                "PATH": "/usr/bin:/bin",
                "LANG": "C.UTF-8",
                "LC_ALL": "C.UTF-8",
                "GIT_CONFIG_NOSYSTEM": "1",
                "GIT_CONFIG_GLOBAL": os.devnull,
            },
        )
    except OSError as exc:
        raise ProviderError(f"{label} is unavailable") from exc

    stream = process.stdout
    if stream is None:
        try:
            process.kill()
            process.wait(timeout=1)
        except OSError:
            pass
        raise ProviderError(f"{label} is unavailable")
    deadline = time.monotonic() + 60
    total = 0
    try:
        descriptor = stream.fileno()
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise subprocess.TimeoutExpired(process.args, 60)
            readable, _unused_writable, _unused_errors = select.select(
                [descriptor], [], [], min(1.0, remaining)
            )
            if not readable:
                continue
            block = os.read(
                descriptor,
                min(1024 * 1024, MAX_SOURCE_ARCHIVE_BYTES - total + 1),
            )
            if not block:
                break
            total += len(block)
            if total > MAX_SOURCE_ARCHIVE_BYTES:
                raise ProviderError(f"{label} exceeds its byte limit")
            if output.write(block) != len(block):
                raise OSError("source archive write made no progress")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise subprocess.TimeoutExpired(process.args, 60)
        if process.wait(timeout=remaining) != 0 or total == 0:
            raise ProviderError(f"{label} is unavailable")
    except ProviderError:
        raise
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ProviderError(f"{label} is unavailable") from exc
    finally:
        try:
            stream.close()
        except OSError:
            pass
        if process.poll() is None:
            try:
                process.kill()
            except OSError:
                pass
            try:
                process.wait(timeout=1)
            except (OSError, subprocess.TimeoutExpired):
                pass


@contextlib.contextmanager
def _commissioned_source_archive(
    project_root: Path,
    ref: str,
    temporary_parent: Path,
    *,
    label: str,
) -> Iterator[Any]:
    """Yield one bounded, private raw Git tar stream positioned at byte zero."""
    _secure_directory(temporary_parent, "provider source archive parent")
    try:
        with tempfile.TemporaryFile(mode="w+b", dir=str(temporary_parent)) as source_stream:
            _stream_commissioned_git_archive(project_root, ref, source_stream, label=label)
            source_stream.seek(0)
            yield source_stream
    except OSError as exc:
        raise ProviderError(f"{label} is unavailable") from exc


def _bounded_source_archive_members(
    archive: tarfile.TarFile,
    *,
    label: str,
) -> Iterator[tarfile.TarInfo]:
    entries = 0
    total = 0
    for member in archive:
        entries += 1
        if entries > MAX_SOURCE_ARCHIVE_ENTRIES:
            raise ProviderError(f"{label} exceeds its entry limit")
        if member.isfile():
            if member.size < 0 or member.size > MAX_SOURCE_UNPACKED_BYTES:
                raise ProviderError(f"{label} contains an oversized entry")
            total += member.size
            if total > MAX_SOURCE_UNPACKED_BYTES:
                raise ProviderError(f"{label} exceeds its unpacked byte limit")
        yield member


def _create_copyin_archive(
    *,
    project_root: Path,
    ref: str,
    envelope: Path,
    target: Path,
    cli_bundle: Path,
    runners: Mapping[str, Path],
    destination: Path,
) -> None:
    """Create a source-only VM input archive from immutable input snapshots."""
    _secure_directory(destination.parent, "provider copy-in archive parent")
    try:
        with _commissioned_source_archive(
            project_root,
            ref,
            destination.parent,
            label="commissioned source snapshot",
        ) as source_stream:
            with tarfile.open(fileobj=source_stream, mode="r:") as source, tarfile.open(
                destination, mode="w:gz", format=tarfile.PAX_FORMAT
            ) as output:
                for member in _bounded_source_archive_members(
                    source, label="commissioned source snapshot"
                ):
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
                    if _excluded_worker_source_path(member.name):
                        continue
                    source_file = source.extractfile(member) if member.isfile() else None
                    copied = copy.copy(member)
                    copied.name = f"source/{member.name}"
                    output.addfile(copied, source_file)
                _secure_regular_file(envelope, "provider envelope snapshot", require_private=True)
                _secure_regular_file(target, "provider target snapshot", require_private=True)
                _secure_regular_file(cli_bundle, "provider CLI bundle snapshot", require_private=True)
                output.add(str(envelope), arcname=".harness-envelope.json", recursive=False)
                output.add(str(target), arcname=".harness-target.json", recursive=False)
                output.add(str(cli_bundle), arcname=".harness-cli-bundle.tar.gz", recursive=False)
                if set(runners) != set(RUNNER_NAMES):
                    raise ProviderError("provider runner snapshot set is invalid")
                for name in RUNNER_NAMES:
                    runner = runners[name]
                    if not isinstance(runner, Path):
                        raise ProviderError("provider runner snapshot set is invalid")
                    _secure_regular_file(runner, f"framework VM runner snapshot {name}", require_private=True)
                    output.add(str(runner), arcname=f".harness-runner/{name}", recursive=False)
        # tarfile.open honours the process umask, so a standard 022 leaves the
        # archive group/world readable and _copy_archive_to_guest's private
        # check rejects it. The archive already lives in a 0700 run root; make
        # the file itself private so the check passes on any umask.
        os.chmod(destination, 0o600)
    except (OSError, tarfile.TarError) as exc:
        raise ProviderError("cannot create VM copy-in archive") from exc


def _copy_archive_to_guest(
    configuration: ProviderConfiguration,
    archive: Path,
    guest_root: str,
    cli_executables: tuple[str, ...],
) -> None:
    _secure_regular_file(archive, "VM copy-in archive", require_private=True)
    try:
        archive_size = archive.lstat().st_size
    except OSError as exc:
        raise ProviderError("VM copy-in archive is unavailable") from exc
    if archive_size > MAX_COPYIN_ARCHIVE_BYTES:
        raise ProviderError("VM copy-in archive exceeds its size limit")
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
        # mkdir -p under umask 077 leaves any parent it creates 700-root, and
        # the worker uid must traverse the full job path on a fresh VM.
        f"umask 077; rm -rf {guest_root}; mkdir -p {guest_root}; "
        f"chmod 711 /var/lib/harness-vm-v1 /var/lib/harness-vm-v1/jobs; "
        # --no-same-owner: root extraction otherwise restores the archive's
        # creator uid (the unprivileged provider account), but the worker
        # requires the staged target/envelope to be root-owned. source/ and
        # state/ are chowned to the worker uid explicitly below.
        f"tar --no-same-owner -xzf - -C {guest_root}; "
        f"mkdir -p {guest_root}/cli {guest_root}/state {guest_root}/receipt; "
        f"tar -xzf {guest_root}/.harness-cli-bundle.tar.gz -C {guest_root}/cli; "
        f"rm -f {guest_root}/.harness-cli-bundle.tar.gz; test ! -e {guest_root}/source/.git; "
        f"{executable_checks} "
        f"chown -R root:root {guest_root}/cli {guest_root}/.harness-runner {guest_root}/receipt; "
        # a+rX before a-w: the root umask-077 extraction leaves these trees
        # unreadable to the worker uid, and read-only alone is not enough.
        f"chmod -R a+rX,a-w {guest_root}/cli {guest_root}/.harness-runner; "
        f"chmod 444 {guest_root}/.harness-envelope.json {guest_root}/.harness-target.json; "
        f"chown -R {WORKER_USER}:{WORKER_USER} {guest_root}/source {guest_root}/state; "
        # The worker requires every commissioned-artifact parent directory to be
        # private (0700). git-archived source dirs come in at 0755, so strip
        # group/world across the whole source tree, not just its top level.
        f"chmod 700 {guest_root}/state {guest_root}/receipt; "
        f"chmod -R go-rwx {guest_root}/source; "
        f"chmod 711 {guest_root}",
    ]
    # `guest_root` is provider-generated hex only; it is never task input.
    result = _run_vm(configuration, command, input_path=archive, timeout=120)
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
    root_supervisor: bool,
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
    if type(root_supervisor) is not bool:
        raise ProviderError("provider guest capability profile is invalid")
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
        "--uid=root",
        "--property=KillMode=control-group",
        "--property=TimeoutStopSec=5s",
        f"--property=RuntimeMaxSec={min(timeout, MAX_EXTERNAL_TIMEOUT_SECONDS)}s",
        "--property=MemoryMax=1G",
        "--property=TasksMax=128",
        "--property=CPUQuota=200%",
        "--property=LimitNOFILE=4096",
        "--property=NoNewPrivileges=yes",
        "--property=PrivateTmp=yes",
        "--property=PrivateDevices=yes",
        "--property=ProtectHome=yes",
        "--property=ProtectSystem=strict",
        "--property=ProtectKernelTunables=yes",
        "--property=ProtectKernelModules=yes",
        "--property=ProtectControlGroups=yes",
        "--property=RestrictNamespaces=yes",
        "--property=LockPersonality=yes",
        "--property=UMask=0077",
        "--property=RemoveIPC=yes",
        f"--property=ReadWritePaths={guest_root}/source {guest_root}/state {guest_root}/receipt",
    ]
    if root_supervisor:
        # The root bridge supervises a harnessvm-owned worktree: it must
        # traverse and bind the commissioned artifact, prepare harnessvm's
        # state subdirectories, drop exactly one vendor child to harnessvm,
        # and reap that mixed-UID process group. Do not grant any broader
        # ambient capability set or let this profile reach general guest state.
        command.append(
            "--property=CapabilityBoundingSet="
            "CAP_CHOWN CAP_DAC_OVERRIDE CAP_FOWNER CAP_KILL CAP_SETGID CAP_SETUID"
        )
        # PrivateDevices drops CAP_SETUID from the effective set on this
        # systemd version even though it remains in the bounding set. Carry
        # only the uid/gid drop capabilities ambiently into the root Python
        # supervisor; the vendor child is then explicitly made harnessvm.
        command.append("--property=AmbientCapabilities=CAP_SETUID CAP_SETGID")
    else:
        # Copy-out only traverses and reads the harnessvm-owned source tree;
        # CAP_DAC_READ_SEARCH is narrower than the supervisor's write-capable
        # override and RestrictSUIDSGID keeps it from changing identities.
        command.extend(
            (
                "--property=CapabilityBoundingSet=CAP_DAC_READ_SEARCH",
                "--property=RestrictSUIDSGID=yes",
            )
        )
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
    _validated_external_timeout(timeout_s)
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
            "-I",
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
            "--receipt",
            f"{guest_root}/receipt/bridge-result.json",
            "--timeout-s",
            str(timeout_s),
        ],
        root_supervisor=True,
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
        timeout=GUEST_COPYOUT_TIMEOUT_SECONDS,
        environment={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"},
        network_host=None,
        program=[
            "/usr/bin/python3",
            "-I",
            f"{guest_root}/.harness-runner/vm-bridge-worker.py",
            "copyout",
            "--worktree",
            f"{guest_root}/source",
            "--receipt",
            f"{guest_root}/receipt/bridge-result.json",
            "--artifact",
            artifact,
        ],
        root_supervisor=False,
    )
    if not result.stdout:
        raise ProviderError("VM bridge copy-out failed")
    return result.stdout


def _cleanup_guest_job(
    configuration: ProviderConfiguration,
    guest_root: str,
    *units: str,
) -> None:
    # All path/unit values are provider-generated fixed grammar. A successful
    # launch must prove its cgroups are inactive and guest root is gone; a
    # best-effort cleanup would leave a credential-capable VM job behind.
    _validate_guest_root(guest_root)
    if not units or any(SAFE_ID.fullmatch(unit) is None for unit in units):
        raise ProviderError("provider guest cleanup units are invalid")

    def cleanup_unit(unit: str) -> str:
        show = f"sudo -n systemctl show --property=ActiveState --value {unit}"
        return " ".join(
            (
                f"if {show} >/dev/null 2>&1; then",
                f"state=$({show});",
                "if [ \"$state\" != inactive ] && [ \"$state\" != failed ]; then",
                f"sudo -n systemctl kill --kill-whom=all {unit} || ! {show} >/dev/null 2>&1;",
                "for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do",
                f"if ! {show} >/dev/null 2>&1; then break; fi;",
                f"state=$({show});",
                "if [ \"$state\" = inactive ] || [ \"$state\" = failed ]; then break; fi;",
                "if [ \"$attempt\" = 20 ]; then exit 1; fi;",
                "sleep 0.25;",
                "done;",
                "fi;",
                f"sudo -n systemctl reset-failed {unit} || ! {show} >/dev/null 2>&1;",
                "fi;",
                f"if {show} >/dev/null 2>&1; then state=$({show}); [ \"$state\" = inactive ]; fi;",
            )
        )

    stop_units = " ".join(cleanup_unit(unit) for unit in units)
    command = [
        "sh",
        "-ec",
        f"{stop_units} "
        f"sudo -n rm -rf {guest_root}; test ! -e {guest_root}",
    ]
    result = _run_vm(configuration, command, timeout=30)
    if result.returncode != 0:
        raise ProviderError("VM provider could not prove guest job cleanup")


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
                if member.name != "receipt/bridge-result.json" and not member.name.startswith("source/"):
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
    if "receipt/bridge-result.json" not in extracted:
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


@contextlib.contextmanager
def _exclusive_provider_launch_lock(runs_root: Path) -> Iterator[None]:
    """Serialize use of the one VM and its process-global firewall policy."""
    _secure_directory(runs_root, "provider runtime directory")
    lock_path = runs_root / ".launch.lock"
    descriptor: int | None = None
    acquired = False
    try:
        descriptor = os.open(
            lock_path,
            os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
        opened = os.fstat(descriptor)
        try:
            named = lock_path.lstat()
        except OSError as exc:
            raise ProviderError("provider launch lock is unavailable") from exc
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_nlink != 1
            or opened.st_uid != os.geteuid()
            or opened.st_mode & (stat.S_IRWXG | stat.S_IRWXO)
            or named.st_dev != opened.st_dev
            or named.st_ino != opened.st_ino
        ):
            raise ProviderError("provider launch lock is not private")
        deadline = time.monotonic() + LAUNCH_LOCK_WAIT_SECONDS
        while True:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
                break
            except OSError as exc:
                if exc.errno not in {errno.EACCES, errno.EAGAIN}:
                    raise ProviderError("provider launch lock is unavailable") from exc
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise ProviderError("provider launch is already in progress")
                time.sleep(min(0.1, remaining))
        yield
    except OSError as exc:
        raise ProviderError("provider launch lock is unavailable") from exc
    finally:
        if descriptor is not None:
            if acquired:
                try:
                    fcntl.flock(descriptor, fcntl.LOCK_UN)
                except OSError:
                    pass
            os.close(descriptor)


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
    if _excluded_worker_source_path(path):
        raise ProviderError("VM generator patch modifies a protected source path")
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
    total = [0]
    seen: set[str] = set()
    try:
        with _commissioned_source_archive(
            project_root,
            ref,
            destination.parent,
            label="provider baseline snapshot",
        ) as source_stream:
            with tarfile.open(fileobj=source_stream, mode="r:") as archive:
                for member in _bounded_source_archive_members(
                    archive, label="provider baseline snapshot"
                ):
                    if member.name in seen:
                        raise ProviderError("provider baseline snapshot has duplicate paths")
                    seen.add(member.name)
                    if member.name.startswith("/") or any(part in {"", ".", ".."} for part in member.name.split("/")):
                        raise ProviderError("provider baseline snapshot has an unsafe path")
                    if member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
                        raise ProviderError("provider baseline snapshot contains an unsupported entry")
                    if _excluded_worker_source_path(member.name):
                        continue
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
    if artifact not in returned:
        raise ProviderError("VM returned artifact conflicts with the commissioned base")
    # The commissioned artifact path is the envelope's declared write point, so
    # a baseline file there is overwritten rather than refused; the overwrite
    # is still recorded and hash-bound (FIX2 adjudication #2:A).
    artifact_in_baseline = artifact in baseline
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
        returned[artifact], staging, artifact, overwrite=artifact_in_baseline
    )
    if artifact_in_baseline and not _same_file_bytes(baseline[artifact], returned[artifact]):
        changed.append(artifact)
    return staged_artifact, tuple(sorted(changed))


APP_BUNDLE_RELATIVE = Path("framework/templates/claude/dispatch")
APP_RUNTIME_FILES = (
    Path("tool-catalog.py"),
    Path("dispatch_common.py"),
    Path("validate-active-return-route.py"),
    Path("transports/vm-bridge-provider.py"),
    Path("transports/session-bridge.py"),
    Path("transports/session_bridge_kimi.py"),
    Path("transports/vm-bridge-worker.py"),
)
# Interpreter for re-resolving a launch target through the app bundle catalog.
# -E -s matches -I's environment/user-site isolation while keeping the script
# directory importable: tool-catalog.py loads its dispatch_common sibling,
# which full isolated mode severs from sys.path.
TARGET_RESOLUTION_PYTHON = ("/usr/bin/python3", "-E", "-s")


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
    if registry != project_registry:
        raise ProviderError("bridge registry is not the project registry")
    _secure_regular_file(registry, "bridge registry")
    _secure_directory(adapters, "bridge adapters")
    app_root = _trusted_app_bundle_root()
    catalog = app_root / APP_BUNDLE_RELATIVE / "tool-catalog.py"
    try:
        resolved = subprocess.run(
            [
                *TARGET_RESOLUTION_PYTHON,
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
    if resolved.returncode != 0 or len(resolved.stdout) > MAX_TARGET_BYTES:
        raise ProviderError("bridge target cannot be re-resolved")
    # Avoid writing target JSON to a worker-visible host path. The VM input
    # archive is the only copy and is staged after this fresh resolution.
    temp = Path(
        tempfile.mkdtemp(prefix="harness-vm-target-", dir=str(_provider_private_runs_root()))
    ) / "target.json"
    try:
        temp.write_bytes(resolved.stdout)
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


def _runner_sha256_from_digests(digests: Mapping[str, str]) -> str:
    if set(digests) != set(RUNNER_NAMES):
        raise ProviderError("provider runner digest set is invalid")
    measured: dict[str, str] = {}
    for name in RUNNER_NAMES:
        value = digests[name]
        if not isinstance(value, str) or SHA256.fullmatch(value) is None:
            raise ProviderError("provider runner digest is invalid")
        measured[name] = value
    return _canonical_sha256("harness/vm-bridge-runner/v1", measured)


def _runner_sha256_from_paths(runners: Mapping[str, Path]) -> str:
    if set(runners) != set(RUNNER_NAMES):
        raise ProviderError("provider runner set is invalid")
    digests: dict[str, str] = {}
    for name in RUNNER_NAMES:
        runner = runners[name]
        if not isinstance(runner, Path):
            raise ProviderError("provider runner set is invalid")
        _secure_regular_file(runner, f"framework VM runner {name}")
        digests[name] = _sha256_file(runner)
    return _runner_sha256_from_digests(digests)


def _snapshot_launch_envelope(run_root: Path, source: Path) -> tuple[Path, Path, str]:
    """Copy the user-facing envelope before any launch semantics consume it."""
    input_root = run_root / "inputs"
    try:
        input_root.mkdir(mode=0o700)
    except OSError as exc:
        raise ProviderError("provider input snapshot directory cannot be created") from exc
    _secure_directory(input_root, "provider input snapshot directory")
    envelope = input_root / "envelope.json"
    return input_root, envelope, _snapshot_regular_file(
        source,
        envelope,
        "bridge envelope",
        maximum_bytes=MAX_ENVELOPE_BYTES,
    )


def _snapshot_launch_inputs(
    configuration: ProviderConfiguration,
    *,
    input_root: Path,
    envelope: Path,
    envelope_sha256: str,
    target: dict[str, Any],
) -> LaunchInputSnapshots:
    """Freeze the target, bundle, and runner set that will enter the VM."""
    _secure_directory(input_root, "provider input snapshot directory")
    _secure_regular_file(envelope, "provider envelope snapshot", require_private=True)
    if SHA256.fullmatch(envelope_sha256) is None:
        raise ProviderError("provider envelope snapshot digest is invalid")
    target_snapshot = input_root / "target.json"
    _write_json_exclusive(target_snapshot, target)
    try:
        target_size = target_snapshot.stat().st_size
    except OSError as exc:
        raise ProviderError("provider target snapshot is unavailable") from exc
    if target_size > MAX_TARGET_BYTES:
        raise ProviderError("provider target snapshot exceeds its size limit")
    cli_bundle = input_root / "cli-bundle.tar.gz"
    cli_bundle_sha256 = _snapshot_regular_file(
        configuration.cli_bundle,
        cli_bundle,
        "provider CLI bundle",
        expected_sha256=configuration.cli_bundle_sha256,
        maximum_bytes=MAX_CLI_BUNDLE_BYTES,
    )
    runner_root = input_root / "runners"
    try:
        runner_root.mkdir(mode=0o700)
    except OSError as exc:
        raise ProviderError("provider runner snapshot directory cannot be created") from exc
    _secure_directory(runner_root, "provider runner snapshot directory")
    source_root = Path(__file__).absolute().parent
    runners: dict[str, Path] = {}
    runner_digests: dict[str, str] = {}
    for name in RUNNER_NAMES:
        snapshot = runner_root / name
        runners[name] = snapshot
        runner_digests[name] = _snapshot_regular_file(
            source_root / name,
            snapshot,
            f"framework VM runner {name}",
            maximum_bytes=MAX_RUNNER_BYTES,
        )
    return LaunchInputSnapshots(
        envelope=envelope,
        envelope_sha256=envelope_sha256,
        target=target_snapshot,
        cli_bundle=cli_bundle,
        cli_bundle_sha256=cli_bundle_sha256,
        runners=runners,
        runner_sha256=_runner_sha256_from_digests(runner_digests),
    )


def _validated_external_timeout(value: Any) -> int:
    if (
        not isinstance(value, int)
        or isinstance(value, bool)
        or not 1 <= value <= MAX_EXTERNAL_TIMEOUT_SECONDS
    ):
        raise ProviderError("bridge target timeout is invalid")
    return value


def launch(args: argparse.Namespace) -> dict[str, Any]:
    """Run one provider-owned VM bridge and return a sanitized run-meta record."""
    project_root = _absolute_non_symlink_input(args.project_root, "bridge project root")
    envelope_path = _absolute_non_symlink_input(args.envelope, "bridge envelope")
    registry = _absolute_non_symlink_input(args.registry, "bridge registry")
    adapters = _absolute_non_symlink_input(args.adapters, "bridge adapters")
    _secure_directory(project_root, "bridge project root")
    _secure_regular_file(envelope_path, "bridge envelope")
    try:
        envelope_size = envelope_path.stat().st_size
    except OSError as exc:
        raise ProviderError("bridge envelope is unavailable") from exc
    if envelope_size > MAX_ENVELOPE_BYTES:
        raise ProviderError("bridge envelope exceeds its size limit")
    _secure_regular_file(registry, "bridge registry")
    _secure_directory(adapters, "bridge adapters")

    # This first read contributes only the run-directory name. Every launch
    # decision below is made from the immutable provider-private copy.
    preliminary = _load_json_no_duplicates(envelope_path, "bridge envelope")
    preliminary_task_id = preliminary.get("task_id")
    if not isinstance(preliminary_task_id, str) or SAFE_ID.fullmatch(preliminary_task_id) is None:
        raise ProviderError("bridge envelope task id is invalid")

    configuration = load_provider_configuration()
    policy = _broker_policy(configuration)
    state_root = _validated_caller_state_root(
        _absolute_path(args.state, "provider state"), project_root
    )
    runs_root = _provider_private_runs_root()
    run_root = runs_root / f"{preliminary_task_id}-{secrets.token_hex(12)}"
    try:
        run_root.mkdir(mode=0o700)
    except OSError as exc:
        raise ProviderError("provider private run root cannot be created") from exc
    _secure_directory(run_root, "provider private run root")
    input_root, envelope_snapshot, envelope_sha256 = _snapshot_launch_envelope(
        run_root, envelope_path
    )
    envelope = _load_json_no_duplicates(envelope_snapshot, "bridge envelope")
    role = envelope.get("role")
    task_id = envelope.get("task_id")
    batch = envelope.get("batch")
    repo = envelope.get("repo")
    if role not in {"planner", "generator", "evaluator"}:
        raise ProviderError("bridge envelope role is invalid")
    if not isinstance(task_id, str) or SAFE_ID.fullmatch(task_id) is None:
        raise ProviderError("bridge envelope task id is invalid")
    if task_id != preliminary_task_id:
        raise ProviderError("bridge envelope changed before its launch snapshot")
    if not isinstance(batch, str) or SAFE_ID.fullmatch(batch) is None:
        raise ProviderError("bridge envelope batch is invalid")
    if (
        not isinstance(repo, dict)
        or not isinstance(repo.get("ref"), str)
        or (
            SHA256.fullmatch(repo["ref"]) is None
            and re.fullmatch(r"[0-9a-f]{40}", repo["ref"]) is None
        )
    ):
        raise ProviderError("bridge envelope ref is invalid")
    ref = repo["ref"]
    artifact = _safe_artifact_relative(envelope)
    target = _resolve_launch_target(
        project_root=project_root,
        registry=registry,
        adapters=adapters,
        target_id=args.agent,
        expected_provenance=args.expected_provenance,
    )
    if target.get("bridge_provider_contract_sha256") != configuration.contract_sha256:
        raise ProviderError("bridge target provider contract drifted")
    snapshots = _snapshot_launch_inputs(
        configuration,
        input_root=input_root,
        envelope=envelope_snapshot,
        envelope_sha256=envelope_sha256,
        target=target,
    )
    target = _load_launch_target(snapshots.target, args.expected_provenance)
    if target.get("bridge_provider_contract_sha256") != configuration.contract_sha256:
        raise ProviderError("bridge target provider contract drifted")
    bridge_command = _validate_target_bundle_command(
        configuration, target, cli_bundle=snapshots.cli_bundle
    )
    kimi_identity = _bundle_kimi_identity(snapshots.cli_bundle)
    if role not in target.get("roles", []):
        raise ProviderError("bridge target does not allow the envelope role")
    timeout_s = _validated_external_timeout(target.get("timeout_s"))

    staging = run_root / "copyout"
    copyout = run_root / "pipe"
    baseline = run_root / "baseline"
    archive = run_root / "copyin.tar.gz"
    try:
        copyout.mkdir(mode=0o700)
    except OSError as exc:
        raise ProviderError("provider copy-out directory cannot be created") from exc
    _secure_directory(copyout, "provider copy-out directory")
    guest_token = secrets.token_hex(16)
    guest_root = f"/var/lib/harness-vm-v1/jobs/{guest_token}"
    unit = f"harness-vm-v1-{guest_token}"
    started = time.monotonic()
    guest_job_touched = False
    firewall_reset_required = False
    with _exclusive_provider_launch_lock(runs_root):
        _assert_vm_ready(configuration)
        try:
            _create_copyin_archive(
                project_root=project_root,
                ref=ref,
                envelope=snapshots.envelope,
                target=snapshots.target,
                cli_bundle=snapshots.cli_bundle,
                runners=snapshots.runners,
                destination=archive,
            )
            _create_baseline_source(project_root, ref, baseline)
            guest_job_touched = True
            _copy_archive_to_guest(configuration, archive, guest_root, (bridge_command[0],))
            # Bind the exact snapshots only after input preparation. Its TTL
            # then covers the bounded worker, copy-out, broker request, and
            # return-validation window rather than elapsed staging time.
            launch_proof, launch_nonce = launch_attestation(
                configuration,
                args.expected_provenance,
                envelope_sha256=snapshots.envelope_sha256,
                runner_sha256=snapshots.runner_sha256,
                cli_bundle_sha256=snapshots.cli_bundle_sha256,
            )
            launch_proof_sha256 = _canonical_sha256(ATTESTATION_VERSION, launch_proof)
            with BrokerLease(policy, kimi_identity) as broker:
                if broker.port is None:
                    raise ProviderError("broker did not allocate a port")
                firewall_reset_required = True
                _reset_guest_egress_baseline(configuration)
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
                extracted["receipt/bridge-result.json"],
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
                # Consumers intentionally compare this original caller path
                # with the envelope they are validating; the attestation binds
                # its raw bytes to the private snapshot staged above.
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
            try:
                if guest_job_touched:
                    _cleanup_guest_job(configuration, guest_root, unit, f"{unit}-copyout")
            finally:
                # Cleanup proof failures must still restore the VM's default
                # deny egress baseline before the launch error is surfaced.
                if firewall_reset_required:
                    _reset_guest_egress_baseline(configuration)


def _runner_sha256() -> str:
    """Measure the exact framework runner set that will be staged to a VM."""
    root = Path(__file__).absolute().parent
    return _runner_sha256_from_paths({name: root / name for name in RUNNER_NAMES})


def _attestation(
    configuration: ProviderConfiguration,
    *,
    phase: str,
    target_provenance: str | None = None,
    nonce: bytes | None = None,
    envelope_sha256: str | None = None,
    runner_sha256: str | None = None,
    cli_bundle_sha256: str | None = None,
    supported_routes: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    if phase not in {"catalog", "launch"}:
        raise ProviderError("attestation phase is invalid")
    if phase == "launch":
        if not isinstance(target_provenance, str) or SHA256.fullmatch(target_provenance) is None:
            raise ProviderError("launch target provenance is invalid")
        for value, label in (
            (envelope_sha256, "launch envelope snapshot"),
            (runner_sha256, "launch runner snapshot"),
            (cli_bundle_sha256, "launch CLI bundle snapshot"),
        ):
            if not isinstance(value, str) or SHA256.fullmatch(value) is None:
                raise ProviderError(f"{label} digest is invalid")
    elif any(
        value is not None
        for value in (target_provenance, envelope_sha256, runner_sha256, cli_bundle_sha256)
    ):
        raise ProviderError("catalog attestation must not bind launch inputs")
    if phase == "catalog":
        if not isinstance(supported_routes, list) or not supported_routes:
            raise ProviderError("catalog attestation lacks provider-supported routes")
    elif supported_routes is not None:
        raise ProviderError("launch attestation must not publish provider-supported routes")
    ttl_seconds = (
        LAUNCH_ATTESTATION_TTL_SECONDS
        if phase == "launch"
        else CATALOG_ATTESTATION_TTL_SECONDS
    )
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
        "expires_at": _utc_text(issued + dt.timedelta(seconds=ttl_seconds)),
        "image_sha256": configuration.image_sha256,
        "runner_sha256": runner_sha256 if phase == "launch" else _runner_sha256(),
        "cli_bundle_sha256": (
            cli_bundle_sha256 if phase == "launch" else configuration.cli_bundle_sha256
        ),
        "broker_policy_sha256": configuration.broker_policy_sha256,
    }
    if phase == "launch":
        assert target_provenance is not None
        assert envelope_sha256 is not None
        value["target_provenance_sha256"] = target_provenance
        # The digest is SHA-256 of the exact raw UTF-8 envelope bytes copied
        # into the provider-private snapshot, not a canonicalized JSON form.
        value["envelope_sha256"] = envelope_sha256
    else:
        assert supported_routes is not None
        value["supported_routes"] = supported_routes
    return value


def catalog_attestation() -> dict[str, Any]:
    configuration = load_provider_configuration()
    # A bridge is not selectable merely because its VM image exists. Verify
    # that the broker policy and its host-only credential source are usable
    # before making a signable catalog observation. The token stays in this
    # stack frame and is never placed in the returned object.
    _read_broker_credential(_broker_policy(configuration))
    supported_routes = _catalog_supported_routes(configuration.cli_bundle)
    _assert_vm_ready(configuration)
    attestation = _attestation(
        configuration, phase="catalog", supported_routes=supported_routes
    )
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
    configuration: ProviderConfiguration,
    target_provenance: str,
    *,
    envelope_sha256: str,
    runner_sha256: str,
    cli_bundle_sha256: str,
) -> tuple[dict[str, Any], str]:
    """Create a one-shot attestation and retain its raw nonce only in memory."""
    nonce = secrets.token_hex(16)
    return (
        _attestation(
            configuration,
            phase="launch",
            target_provenance=target_provenance,
            nonce=nonce.encode("ascii"),
            envelope_sha256=envelope_sha256,
            runner_sha256=runner_sha256,
            cli_bundle_sha256=cli_bundle_sha256,
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
