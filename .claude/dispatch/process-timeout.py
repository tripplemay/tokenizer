#!/usr/bin/env python3
"""Run one command under an absolute wall-clock deadline in its own process group."""

import argparse
import json
import os
import signal
import subprocess
import sys
import time


# This helper is deliberately used outside the vendor containment boundary to
# own cancellation and process reaping.  Never resolve its inspection tool
# through a child-controlled PATH or working directory.
_TRUSTED_PS_CANDIDATES = ("/bin/ps", "/usr/bin/ps")


def _trusted_ps():
    for candidate in _TRUSTED_PS_CANDIDATES:
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None


def _clock(path):
    if not path:
        return time.time()
    with open(path, encoding="ascii") as fh:
        return float(fh.read().strip())


def _group_exists(pgid):
    try:
        os.killpg(pgid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def _signal_group(pgid, sig):
    try:
        os.killpg(pgid, sig)
        return True
    except ProcessLookupError:
        return False


def _separate_descendant_groups(root_pid):
    """Return currently provable descendant session leaders, never broad PGIDs.

    A cooperative child normally remains in the command's process group. Some
    CLIs launch helpers in a new session, though, so cancellation cannot rely
    on ``killpg(root_pid, ...)`` alone. Capture only descendants whose own PID
    is still their process-group leader; that prevents a stale child entry from
    turning into a signal for an unrelated shared process group.
    """
    if os.name != "posix":
        return set()
    ps = _trusted_ps()
    if ps is None:
        return set()
    try:
        listing = subprocess.check_output(
            [ps, "-axo", "pid=,ppid="],
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except (OSError, subprocess.SubprocessError):
        return set()

    children = {}
    for line in listing.splitlines():
        fields = line.split()
        if len(fields) != 2:
            continue
        try:
            pid, parent = (int(field) for field in fields)
        except ValueError:
            continue
        if pid > 0 and parent >= 0:
            children.setdefault(parent, []).append(pid)

    descendants = set()
    pending = list(children.get(root_pid, ()))
    while pending:
        pid = pending.pop()
        if pid in descendants:
            continue
        descendants.add(pid)
        pending.extend(children.get(pid, ()))

    groups = set()
    for pid in descendants:
        try:
            if os.getpgid(pid) == pid and pid != root_pid:
                groups.add(pid)
        except OSError:
            continue
    return groups


def _stop_group(proc, first_signal, grace_s):
    groups = {proc.pid, *_separate_descendant_groups(proc.pid)}
    for pgid in groups:
        _signal_group(pgid, first_signal)
    end = time.monotonic() + grace_s
    while time.monotonic() < end:
        proc.poll()
        if not any(_group_exists(pgid) for pgid in groups):
            break
        time.sleep(0.02)
    for pgid in groups:
        if _group_exists(pgid):
            _signal_group(pgid, signal.SIGKILL)
    try:
        proc.wait(timeout=max(1.0, grace_s))
    except subprocess.TimeoutExpired:
        for pgid in groups:
            _signal_group(pgid, signal.SIGKILL)
        proc.wait()


def _exit_code(returncode):
    return 128 + (-returncode) if returncode < 0 else returncode


def _write_status(path, reason, exit_code):
    if not path:
        return
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"reason": reason, "exit_code": exit_code}, fh)
    os.replace(tmp, path)


def main():
    parser = argparse.ArgumentParser()
    limits = parser.add_mutually_exclusive_group(required=True)
    limits.add_argument("--timeout", type=int)
    limits.add_argument("--deadline-epoch", type=float)
    parser.add_argument("--term-grace", type=float, default=2.0)
    parser.add_argument("--clock-file", help="test hook: file containing the current wall-clock epoch")
    parser.add_argument("--status-file", help="write the termination origin as bounded JSON metadata")
    parser.add_argument("--cwd", help="trusted working directory for the launched command")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command or args.term_grace < 0:
        parser.error("a command and a non-negative --term-grace are required")
    if args.timeout is not None and args.timeout <= 0:
        parser.error("--timeout must be positive")
    if args.cwd is not None and not os.path.isdir(args.cwd):
        parser.error("--cwd must name an existing directory")

    deadline = args.deadline_epoch
    if deadline is None:
        deadline = _clock(args.clock_file) + args.timeout

    pending_signal = [None]

    def on_signal(signum, _frame):
        if pending_signal[0] is None:
            pending_signal[0] = signum

    previous = {}
    for sig in (signal.SIGTERM, signal.SIGINT):
        previous[sig] = signal.signal(sig, on_signal)

    try:
        proc = subprocess.Popen(command, cwd=args.cwd, start_new_session=True)
    except OSError as exc:
        sys.stderr.write(f"[process-timeout] launch failed: {exc}\n")
        _write_status(args.status_file, "launch_failed", 127)
        return 127

    self_timed_out = False
    external_signal = None
    try:
        while proc.poll() is None:
            if pending_signal[0] is not None:
                external_signal = pending_signal[0]
                _stop_group(proc, external_signal, args.term_grace)
                break
            if _clock(args.clock_file) >= deadline:
                self_timed_out = True
                _stop_group(proc, signal.SIGTERM, args.term_grace)
                break
            time.sleep(0.02)

        if proc.poll() is None:
            proc.wait()
        elif _group_exists(proc.pid):
            # A command must not leave background descendants after its leader exits.
            _stop_group(proc, signal.SIGTERM, args.term_grace)
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)

    if self_timed_out:
        _write_status(args.status_file, "deadline", 124)
        return 124
    if external_signal is not None:
        code = 128 + external_signal
        _write_status(args.status_file, "external_signal", code)
        return code
    code = _exit_code(proc.returncode)
    _write_status(args.status_file, "process_exit", code)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
