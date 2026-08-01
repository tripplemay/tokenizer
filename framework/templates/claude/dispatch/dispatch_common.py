#!/usr/bin/env python3
"""Shared dispatch deadline and repository-target rules (stdlib only)."""

import argparse
import json
import os
import re
import stat
import subprocess
import sys
from urllib.parse import unquote, urlparse


MIN_TIMEOUT_S = 60
MAX_TIMEOUT_S = 86400
DEFAULT_TIMEOUT_S = 3600
CANONICAL_COMMIT_SHA = re.compile(r"(?:[0-9a-f]{40}|[0-9a-f]{64})\Z")
POSIX_ENV_KEY = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")
CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f\x7f]")
_PROTECTED_ENV_KEYS = {
    "BASH_ENV",
    "CDPATH",
    "ENV",
    "HOME",
    "IFS",
    "NODE_OPTIONS",
    "NODE_PATH",
    "PATH",
    "PYTHONHOME",
    "PYTHONPATH",
    "PYTHONSTARTUP",
    "SHELL",
    "ZDOTDIR",
    "ZSH_ENV",
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
}
# Configuration may name credentials to propagate into a constrained process,
# but it may never replace the harness's Git execution contract.  Protect the
# entire GIT_ namespace rather than only GIT_CONFIG_: variables such as
# GIT_TERMINAL_PROMPT and GIT_OPTIONAL_LOCKS can alter the coordinator's
# non-interactive and repository-safety guarantees too.
_PROTECTED_ENV_PREFIXES = ("DYLD_", "GIT_", "HARNESS_", "LD_")
A2A_AUTH_UNSET = object()
A2A_BEARER_ENV_PREFIX = "REMOTE_A2A_"


class DispatchContractError(ValueError):
    pass


def external_environment_key(value, label):
    """Validate a configuration-owned key before it can reach ``env -i``.

    The sandbox owns PATH/HOME/SHELL/HARNESS/Git control variables itself. An
    adapter or descriptor may request tool-specific authentication directories
    such as CODEX_HOME or KIMI_*, but never process/bootstrap control knobs.
    """
    if not isinstance(value, str) or not POSIX_ENV_KEY.fullmatch(value):
        raise DispatchContractError(f"{label} must be a POSIX environment variable name")
    if value in _PROTECTED_ENV_KEYS or value.startswith(_PROTECTED_ENV_PREFIXES):
        raise DispatchContractError(
            f"{label} is protected by the harness process boundary: {value}"
        )
    return value


def external_environment_allowlist(value, label):
    if value is None:
        return []
    if not isinstance(value, list):
        raise DispatchContractError(f"{label} must be an array of environment variable names")
    keys = []
    seen = set()
    for index, key in enumerate(value):
        key = external_environment_key(key, f"{label}[{index}]")
        if key in seen:
            raise DispatchContractError(f"{label} contains duplicate key {key}")
        seen.add(key)
        keys.append(key)
    return keys


def external_environment_set(value, label):
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise DispatchContractError(f"{label} must be an object of string values")
    result = {}
    for key, item in value.items():
        key = external_environment_key(key, f"{label}.{key}")
        if not isinstance(item, str):
            raise DispatchContractError(f"{label}.{key} must be a string")
        if CONTROL_CHARACTERS.search(item):
            raise DispatchContractError(
                f"{label}.{key} must not contain control characters"
            )
        result[key] = item
    return result


def a2a_bearer_environment_key(value, label):
    """Return only a dedicated A2A credential variable name.

    The client sends this value to a remote endpoint.  General host variables
    that happen not to control the sandbox (for example OPENAI_API_KEY) still
    must not become an exfiltration source through descriptor configuration.
    """
    key = external_environment_key(value, label)
    if not key.startswith(A2A_BEARER_ENV_PREFIX) or len(key) == len(A2A_BEARER_ENV_PREFIX):
        raise DispatchContractError(
            f"{label} must use the dedicated {A2A_BEARER_ENV_PREFIX}* namespace"
        )
    return key


def a2a_auth_config(value, label):
    """Validate the only authentication configuration supported by A2A.

    Descriptor JSON is configuration, not an authority to select arbitrary
    process variables.  Keep the validation shared by registry preflight, the
    console catalog, and direct-client use so a descriptor cannot be advertised
    by one layer and rejected only after a task has been commissioned.
    """
    if value is A2A_AUTH_UNSET:
        return {"type": "none"}
    if not isinstance(value, dict):
        raise DispatchContractError(f"{label} must be an object")

    auth_type = value.get("type")
    if auth_type == "none":
        if set(value) != {"type"}:
            raise DispatchContractError(
                f"{label}.type=none must contain exactly the field 'type'"
            )
        return {"type": "none"}
    if auth_type != "bearer":
        raise DispatchContractError(
            f"{label}.type must be 'none' or 'bearer'"
        )

    if set(value) != {"type", "env"}:
        raise DispatchContractError(
            f"{label}.type=bearer must contain exactly the fields 'type' and 'env'"
        )
    return {
        "type": "bearer",
        "env": a2a_bearer_environment_key(value["env"], f"{label}.env"),
    }


def bounded_seconds(value, field, *, default=None):
    if value is None and default is not None:
        value = default
    if isinstance(value, bool) or not isinstance(value, int):
        raise DispatchContractError(f"{field} must be an integer")
    if not MIN_TIMEOUT_S <= value <= MAX_TIMEOUT_S:
        raise DispatchContractError(
            f"{field} must be between {MIN_TIMEOUT_S} and {MAX_TIMEOUT_S} seconds"
        )
    return value


def effective_timeout(deadline_s, descriptor_timeout_s=None):
    cap = bounded_seconds(
        descriptor_timeout_s, "descriptor timeout_s", default=DEFAULT_TIMEOUT_S
    )
    if deadline_s is None:
        return cap
    return min(bounded_seconds(deadline_s, "envelope deadline_s"), cap)


def _git_top_level(path):
    try:
        proc = subprocess.run(
            ["git", "-C", path, "rev-parse", "--show-toplevel"],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return os.path.realpath(proc.stdout.strip())


def canonical_commit_sha(value):
    if not isinstance(value, str) or not CANONICAL_COMMIT_SHA.fullmatch(value):
        raise DispatchContractError(
            "repo.ref must be a 40- or 64-character lowercase hexadecimal "
            "immutable commit SHA"
        )
    return value


def _verify_commit(repo, ref):
    try:
        resolved = subprocess.check_output(
            ["git", "-C", repo, "rev-parse", "--verify", f"{ref}^{{commit}}"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        raise DispatchContractError(
            f"repo.ref is not an available commit in the invocation repository: {ref}"
        )
    if resolved != ref:
        raise DispatchContractError(
            "repo.ref did not resolve to the exact canonical commit object ID"
        )


def _local_repo_path(url, cwd):
    if not isinstance(url, str) or not url.strip():
        raise DispatchContractError("repo.url is missing")
    url = url.strip()
    parsed = urlparse(url)
    if parsed.scheme == "file":
        if parsed.netloc not in ("", "localhost"):
            return None
        return os.path.realpath(unquote(parsed.path))
    if parsed.scheme:
        return None
    if re.match(r"^[^/]+@[^:]+:", url):
        return None
    return os.path.realpath(os.path.join(cwd, os.path.expanduser(url)))


def verify_invocation_repo(repo_url, cwd, repo_ref):
    repo_ref = canonical_commit_sha(repo_ref)
    invocation = _git_top_level(cwd)
    invocation_identity = invocation or f"<not a git repository: {os.path.realpath(cwd)}>"
    local_path = _local_repo_path(repo_url, cwd)
    if local_path is None:
        if invocation is None:
            raise DispatchContractError(
                "invocation repository is not a git repository: " + invocation_identity
            )
        _verify_commit(invocation, repo_ref)
        return invocation

    target = _git_top_level(local_path)
    target_identity = target or f"<not a git repository: {local_path}>"
    if target is None or invocation is None or target != invocation:
        raise DispatchContractError(
            "local repo.url does not match the invocation repository; "
            f"repo.url identity={target_identity}; invocation identity={invocation_identity}"
        )
    _verify_commit(invocation, repo_ref)
    return invocation


def project_registry_path(project_root, requested_registry):
    """Pin dispatch configuration to the invocation repository's registry.

    Registry contents select transport and external executable metadata.  A
    caller must not be able to replace that authority after the envelope and
    active-mode checkpoint have been checked. The parent directory is
    canonicalized to accommodate platform aliases such as /var; the terminal
    file is deliberately left unresolved and then required to be regular, so a
    symbolic link cannot become an accepted registry spelling.
    """
    if not isinstance(project_root, str) or not project_root:
        raise DispatchContractError("project root is missing")
    if not isinstance(requested_registry, str) or not requested_registry:
        raise DispatchContractError("registry path is missing")

    root = os.path.realpath(project_root)
    if not os.path.isdir(root):
        raise DispatchContractError(f"project root is not a directory: {root}")
    expected = os.path.join(root, ".agents-registry.json")
    requested_raw = os.path.abspath(os.path.expanduser(requested_registry))
    # Canonicalize only the parent directory. macOS commonly aliases /var to
    # /private/var, while resolving the terminal path too would incorrectly
    # accept a registry file that is itself a symbolic link.
    requested = os.path.join(
        os.path.realpath(os.path.dirname(requested_raw)), os.path.basename(requested_raw)
    )
    if requested != expected:
        raise DispatchContractError(
            "registry must be the project-root .agents-registry.json; "
            f"requested={requested}; expected={expected}"
        )
    try:
        file_stat = os.lstat(expected)
    except OSError as exc:
        raise DispatchContractError(
            f"project-root registry is unavailable: {expected}: {exc}"
        ) from exc
    if stat.S_ISLNK(file_stat.st_mode):
        raise DispatchContractError(
            f"project-root registry must not be a symbolic link: {expected}"
        )
    if not stat.S_ISREG(file_stat.st_mode):
        raise DispatchContractError(
            f"project-root registry must be a regular file: {expected}"
        )
    return expected


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    preflight = sub.add_parser("repo-preflight")
    preflight.add_argument("--envelope", required=True)
    preflight.add_argument("--cwd", default=os.getcwd())
    registry = sub.add_parser("project-registry")
    registry.add_argument("--project-root", required=True)
    registry.add_argument("--registry", required=True)
    args = parser.parse_args()

    if args.command == "repo-preflight":
        try:
            with open(args.envelope, encoding="utf-8") as fh:
                envelope = json.load(fh)
            repo = envelope.get("repo") or {}
            print(verify_invocation_repo(repo.get("url"), args.cwd, repo.get("ref")))
        except (OSError, ValueError, DispatchContractError) as exc:
            sys.stderr.write(f"[dispatch] repository preflight failed: {exc}\n")
            raise SystemExit(2)
    elif args.command == "project-registry":
        try:
            print(project_registry_path(args.project_root, args.registry))
        except DispatchContractError as exc:
            sys.stderr.write(f"[dispatch] registry preflight failed: {exc}\n")
            raise SystemExit(2)


if __name__ == "__main__":
    main()
