#!/usr/bin/env python3
"""Bounded A2A-shaped client for harness dispatch (stdlib-only JSON-RPC + SSE)."""

import argparse
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.request


DISPATCH_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, DISPATCH_DIR)
from dispatch_common import DispatchContractError, effective_timeout  # noqa: E402


STATE_DIR_DEFAULT = ".harness-dispatch"
TRANSPORT_GRACE_S = 5.0
TERMINAL = {
    "COMPLETED", "FAILED", "CANCELED", "REJECTED",
    "INPUT_REQUIRED", "AUTH_REQUIRED",
}


class ClientError(RuntimeError):
    pass


def log(message):
    sys.stderr.write(f"[a2a-client] {message}\n")


def die(message, code=2):
    log(f"error: {message}")
    raise SystemExit(code)


def load_descriptor(registry, agent):
    try:
        with open(registry, encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception as exc:
        raise ClientError(f"registry unreadable ({registry}): {exc}")
    descriptor = next(
        (item for item in data.get("agents", []) if item.get("id") == agent), None
    )
    if descriptor is None:
        raise ClientError(f"agent not found: {agent}")
    if descriptor.get("transport") != "a2a":
        raise ClientError(
            f"{agent} uses transport={descriptor.get('transport')}; a2a is required"
        )
    if not descriptor.get("endpoint"):
        raise ClientError(f"{agent} has no endpoint")
    try:
        effective_timeout(None, descriptor.get("timeout_s"))
    except DispatchContractError as exc:
        raise ClientError(str(exc))
    return descriptor


def auth_header(descriptor):
    auth = descriptor.get("auth") or {}
    if auth.get("type") != "bearer":
        return {}
    env_name = auth.get("env")
    if not env_name:
        raise ClientError("auth.type=bearer requires auth.env")
    token = os.environ.get(env_name, "").strip()
    if not token:
        raise ClientError(f"environment variable {env_name} is empty")
    return {"Authorization": f"Bearer {token}"}


def rpc(descriptor, method, params, timeout=30.0):
    url = descriptor["endpoint"].rstrip("/") + "/"
    body = json.dumps(
        {"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
        ensure_ascii=False,
    ).encode()
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", **auth_header(descriptor)},
    )
    try:
        with urllib.request.urlopen(request, timeout=max(0.05, timeout)) as response:
            result = json.loads(response.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read()[:300].decode(errors="replace")
        raise ClientError(f"{method} HTTP {exc.code}: {detail}")
    except Exception as exc:
        raise ClientError(f"{method} connection failed: {exc}")
    if "error" in result:
        raise ClientError(f"{method} returned error: {result['error']}")
    return result.get("result")


def write_artifact_local(record):
    artifact = record.get("artifact")
    relative = (
        (record.get("deliverable") or {}).get("artifact")
        or f"docs/test-reports/{record.get('batch')}-verdict.json"
    )
    if artifact is None:
        return None
    os.makedirs(os.path.dirname(relative) or ".", exist_ok=True)
    with open(relative, "w", encoding="utf-8") as fh:
        json.dump(artifact, fh, ensure_ascii=False, indent=2)
    log(f"artifact written locally: {relative}")
    return relative


def synth_run_meta(descriptor, record, state_dir, *, effective_timeout_s=None):
    """Write the local authoritative receipt input; remote state remains advisory."""
    local_artifact = write_artifact_local(record)
    state = record.get("state")
    reason = record.get("termination_reason")
    if local_artifact:
        outcome = "RETURNED"
    elif state == "CANCELED" and reason in ("deadline", "client_deadline"):
        outcome = "TIMEOUT"
    elif state == "CANCELED":
        outcome = "CANCELED"
    elif state in ("FAILED", "REJECTED") and record.get("exit_code") in (0, None):
        outcome = "ARTIFACT_MISSING"
    else:
        outcome = "FAILED"

    remote_meta = record.get("run_meta") or {}
    meta = {
        "task_id": record.get("taskId"),
        "agent_id": record.get("agent") or descriptor["id"],
        "adapter": remote_meta.get("adapter") or "a2a",
        "model_family": record.get("model_family") or descriptor.get("model_family"),
        "batch": record.get("batch"),
        "ref": remote_meta.get("ref"),
        "worktree": remote_meta.get("worktree"),
        "artifact": local_artifact or "",
        "log": "",
        "outcome": outcome,
        "exit_code": record.get("exit_code") if record.get("exit_code") is not None else 0,
        "duration_s": record.get("duration_s") or 0,
        "effective_timeout_s": effective_timeout_s,
        "termination_reason": reason or "remote_terminal",
        "transport": "a2a",
        "endpoint": descriptor["endpoint"],
        "remote_state_advisory": state,
    }
    os.makedirs(state_dir, exist_ok=True)
    path = os.path.join(state_dir, f"run-meta-{meta['task_id']}.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)
    log(f"run-meta written: {path}; validate the local receipt next")
    print(json.dumps(meta, ensure_ascii=False))
    return meta


def _event_record(base, event_name, payload):
    if event_name == "status":
        base["state"] = payload.get("state")
    elif event_name == "artifact":
        base["artifact"] = payload.get("artifact")


def _stream_once(descriptor, task_id, last_seq, deadline, advisory):
    remaining = deadline - time.time()
    if remaining <= 0:
        return False, last_seq
    url = descriptor["endpoint"].rstrip("/") + "/"
    body = json.dumps(
        {"jsonrpc": "2.0", "id": 1, "method": "SubscribeToTask",
         "params": {"taskId": task_id}}
    ).encode()
    headers = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        **auth_header(descriptor),
    }
    if last_seq:
        headers["Last-Event-ID"] = str(last_seq)
    request = urllib.request.Request(url, data=body, method="POST", headers=headers)
    timeout = max(0.05, min(20.0, remaining))
    with urllib.request.urlopen(request, timeout=timeout) as response:
        event_id = event_name = data = None
        for raw in response:
            if time.time() >= deadline:
                return False, last_seq
            line = raw.decode("utf-8", "replace").rstrip("\n")
            if line.startswith(":"):
                continue
            if line == "":
                if event_name == "done":
                    return True, last_seq
                if event_name and data is not None:
                    payload = json.loads(data)
                    if event_id:
                        last_seq = int(event_id)
                    _event_record(advisory, event_name, payload)
                    log(f"event #{event_id} {event_name}: {payload.get('state') or 'artifact'}")
                event_id = event_name = data = None
                continue
            if line.startswith("id: "):
                event_id = line[4:].strip()
            elif line.startswith("event: "):
                event_name = line[7:].strip()
            elif line.startswith("data: "):
                data = line[6:]
    return False, last_seq


def wait_for_terminal(
    descriptor,
    task_id,
    deadline,
    *,
    resume_from=0,
    poll_interval=5.0,
    base_record=None,
    max_stream_reconnects=3,
):
    """Return (record, last_seq); all retries are bounded by the absolute deadline."""
    advisory = dict(base_record or {})
    advisory.setdefault("taskId", task_id)
    last_seq = resume_from
    reconnects = 0
    while time.time() < deadline and reconnects <= max_stream_reconnects:
        try:
            done, last_seq = _stream_once(
                descriptor, task_id, last_seq, deadline, advisory
            )
            if done:
                try:
                    remaining = max(0.05, min(5.0, deadline - time.time()))
                    return rpc(descriptor, "GetTask", {"taskId": task_id}, remaining), last_seq
                except ClientError:
                    if advisory.get("state") in TERMINAL:
                        return advisory, last_seq
            reconnects += 1
        except (urllib.error.URLError, socket.timeout, TimeoutError, OSError, ValueError) as exc:
            reconnects += 1
            log(f"stream interrupted ({exc}); resuming after event {last_seq}")

    while time.time() < deadline:
        remaining = deadline - time.time()
        try:
            record = rpc(
                descriptor,
                "GetTask",
                {"taskId": task_id},
                timeout=max(0.05, min(5.0, remaining)),
            )
            if record.get("state") in TERMINAL:
                return record, last_seq
        except ClientError as exc:
            log(f"bounded GetTask retry failed: {exc}")
        time.sleep(max(0.0, min(poll_interval, deadline - time.time())))
    return None, last_seq


def cancel_at_deadline(descriptor, task_id, grace_s, base_record):
    cancel = rpc(
        descriptor,
        "CancelTask",
        {"taskId": task_id},
        timeout=max(0.05, grace_s),
    )
    synthetic = dict(base_record or {})
    synthetic.update(cancel or {})
    cancel_reason = (cancel or {}).get("termination_reason")
    local_reason = (
        cancel_reason
        if (cancel or {}).get("deduplicated") and cancel_reason
        else "client_deadline"
    )
    synthetic.update(
        taskId=task_id,
        agent=synthetic.get("agent") or descriptor["id"],
        state=(cancel or {}).get("state") or "CANCELED",
        termination_reason=local_reason,
        events_complete=(cancel or {}).get("events_complete", True),
    )
    if synthetic.get("state") == "CANCELED":
        try:
            record = rpc(
                descriptor, "GetTask", {"taskId": task_id}, timeout=max(0.05, grace_s)
            )
            record["termination_reason"] = local_reason
            return record
        except ClientError as exc:
            log(f"cancel was confirmed; preserving CANCELED despite final GetTask failure: {exc}")
            return synthetic
    return rpc(
        descriptor, "GetTask", {"taskId": task_id}, timeout=max(0.05, grace_s)
    )


def deadline_exit_code(record):
    return 124 if (
        record.get("state") == "CANCELED"
        and record.get("termination_reason") == "client_deadline"
    ) else 0


def _load_envelope(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as exc:
        raise ClientError(f"envelope unreadable ({path}): {exc}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("cmd", choices=["run", "send", "subscribe", "get", "cancel", "card", "ls"])
    parser.add_argument("--agent", required=True)
    parser.add_argument("--envelope")
    parser.add_argument("--task")
    parser.add_argument("--registry", default=".agents-registry.json")
    parser.add_argument("--state", default=STATE_DIR_DEFAULT)
    parser.add_argument("--resume-from", type=int, default=0)
    parser.add_argument("--poll-interval", type=float, default=5.0)
    parser.add_argument("--transport-grace", type=float, default=TRANSPORT_GRACE_S)
    parser.add_argument("--max-stream-reconnects", type=int, default=3)
    args = parser.parse_args()
    if args.poll_interval < 0 or args.transport_grace <= 0 or args.max_stream_reconnects < 0:
        parser.error("wait controls must be non-negative and transport grace must be positive")

    try:
        descriptor = load_descriptor(args.registry, args.agent)

        if args.cmd == "card":
            url = descriptor["endpoint"].rstrip("/") + "/.well-known/a2a-agent-card"
            request = urllib.request.Request(url, headers=auth_header(descriptor))
            with urllib.request.urlopen(request, timeout=15) as response:
                print(json.dumps(json.loads(response.read()), ensure_ascii=False, indent=2))
            return 0
        if args.cmd == "ls":
            print(json.dumps(rpc(descriptor, "ListTasks", {}), ensure_ascii=False, indent=2))
            return 0

        if args.cmd in ("send", "run"):
            if not args.envelope:
                raise ClientError("--envelope is required")
            envelope = _load_envelope(args.envelope)
            timeout_s = effective_timeout(
                envelope.get("deadline_s"), descriptor.get("timeout_s")
            )
            started = time.time()
            deadline = started + timeout_s + args.transport_grace
            result = rpc(
                descriptor,
                "SendMessage",
                {"envelope": envelope},
                timeout=max(0.05, min(30.0, deadline - time.time())),
            )
            task_id = result["taskId"]
            if result.get("deduplicated"):
                log(f"task {task_id} deduplicated at state={result.get('state')}")
            else:
                log(f"task {task_id} submitted to {descriptor['endpoint']}")
            if args.cmd == "send":
                print(json.dumps({
                    "taskId": task_id,
                    "state": result.get("state"),
                    "agent": args.agent,
                    "endpoint": descriptor["endpoint"],
                }, ensure_ascii=False))
                return 0
            base = {
                "taskId": task_id,
                "agent": args.agent,
                "model_family": descriptor.get("model_family"),
                "batch": envelope.get("batch"),
                "role": envelope.get("role"),
                "deliverable": envelope.get("deliverable"),
            }
            record, _last = wait_for_terminal(
                descriptor,
                task_id,
                deadline,
                resume_from=args.resume_from,
                poll_interval=args.poll_interval,
                base_record=base,
                max_stream_reconnects=args.max_stream_reconnects,
            )
            if record is None:
                record = cancel_at_deadline(descriptor, task_id, args.transport_grace, base)
                synth_run_meta(
                    descriptor, record, args.state, effective_timeout_s=timeout_s
                )
                return deadline_exit_code(record)
            synth_run_meta(descriptor, record, args.state, effective_timeout_s=timeout_s)
            return 0

        if not args.task:
            raise ClientError("--task is required")
        if args.cmd == "cancel":
            print(json.dumps(
                rpc(descriptor, "CancelTask", {"taskId": args.task}), ensure_ascii=False
            ))
            return 0
        if args.cmd == "get":
            record = rpc(descriptor, "GetTask", {"taskId": args.task})
            if record.get("state") in TERMINAL:
                synth_run_meta(descriptor, record, args.state)
            else:
                log(f"task {args.task} remains {record.get('state')}")
                print(json.dumps({key: record.get(key) for key in
                                  ("taskId", "state", "batch", "role",
                                   "submitted_at", "started_at")}, ensure_ascii=False))
            return 0
        if args.cmd == "subscribe":
            envelope = _load_envelope(args.envelope) if args.envelope else None
            timeout_s = effective_timeout(
                envelope.get("deadline_s") if envelope else None,
                descriptor.get("timeout_s"),
            )
            deadline = time.time() + timeout_s + args.transport_grace
            base = {
                "taskId": args.task,
                "agent": args.agent,
                "model_family": descriptor.get("model_family"),
            }
            if envelope:
                base.update(
                    batch=envelope.get("batch"),
                    role=envelope.get("role"),
                    deliverable=envelope.get("deliverable"),
                )
            record, _last = wait_for_terminal(
                descriptor,
                args.task,
                deadline,
                resume_from=args.resume_from,
                poll_interval=args.poll_interval,
                base_record=base,
                max_stream_reconnects=args.max_stream_reconnects,
            )
            if record is None:
                record = cancel_at_deadline(
                    descriptor, args.task, args.transport_grace, base
                )
                synth_run_meta(descriptor, record, args.state, effective_timeout_s=timeout_s)
                return deadline_exit_code(record)
            synth_run_meta(descriptor, record, args.state, effective_timeout_s=timeout_s)
            return 0
    except (ClientError, DispatchContractError, urllib.error.URLError, OSError, ValueError) as exc:
        die(str(exc))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
