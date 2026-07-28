#!/usr/bin/env python3
"""Shared dispatch deadline and repository-target rules (stdlib only)."""

import argparse
import json
import os
import re
import subprocess
import sys
from urllib.parse import unquote, urlparse


MIN_TIMEOUT_S = 60
MAX_TIMEOUT_S = 86400
DEFAULT_TIMEOUT_S = 3600


class DispatchContractError(ValueError):
    pass


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


def verify_invocation_repo(repo_url, cwd):
    invocation = _git_top_level(cwd)
    invocation_identity = invocation or f"<not a git repository: {os.path.realpath(cwd)}>"
    local_path = _local_repo_path(repo_url, cwd)
    if local_path is None:
        if invocation is None:
            raise DispatchContractError(
                "invocation repository is not a git repository: " + invocation_identity
            )
        return invocation

    target = _git_top_level(local_path)
    target_identity = target or f"<not a git repository: {local_path}>"
    if target is None or invocation is None or target != invocation:
        raise DispatchContractError(
            "local repo.url does not match the invocation repository; "
            f"repo.url identity={target_identity}; invocation identity={invocation_identity}"
        )
    return invocation


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    preflight = sub.add_parser("repo-preflight")
    preflight.add_argument("--envelope", required=True)
    preflight.add_argument("--cwd", default=os.getcwd())
    args = parser.parse_args()

    if args.command == "repo-preflight":
        try:
            with open(args.envelope, encoding="utf-8") as fh:
                envelope = json.load(fh)
            print(verify_invocation_repo((envelope.get("repo") or {}).get("url"), args.cwd))
        except (OSError, ValueError, DispatchContractError) as exc:
            sys.stderr.write(f"[dispatch] repository preflight failed: {exc}\n")
            raise SystemExit(2)


if __name__ == "__main__":
    main()
