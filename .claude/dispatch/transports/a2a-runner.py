#!/usr/bin/env python3
"""Durable A2A-shaped runner for harness dispatch (stdlib-only JSON-RPC + SSE)."""

import argparse
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


DISPATCH_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, DISPATCH_DIR)
from dispatch_common import DispatchContractError, project_registry_path  # noqa: E402


MIN_CANCEL_GRACE_S = 2.25  # sandbox helper uses a 2s TERM grace before killing its CLI group
DEFAULT_TIMEOUT_S = 3600
TOOL_INTEGRATIONS_VERSION = "tool-integrations/1"
LOCAL_CLI_PREFIX = "local-cli--"
A2A_ROLES = ("planner", "evaluator")
SAFE_CONFIG_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
SAFE_TOOL_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}\Z")
SAFE_CAPABILITY = re.compile(r"[A-Za-z0-9._-]{1,64}\Z")
CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f\x7f]")


class RunnerConfigError(RuntimeError):
    pass


def _safe_config_id(value, label):
    if not isinstance(value, str) or not SAFE_CONFIG_ID.fullmatch(value):
        raise RunnerConfigError(f"{label} must be a safe stable id")
    return value


def _safe_tool_id(value, label):
    if not isinstance(value, str) or not SAFE_TOOL_ID.fullmatch(value):
        raise RunnerConfigError(f"{label} must be a safe stable tool id")
    return value


def _nonempty_string(value, label):
    if not isinstance(value, str) or not value.strip():
        raise RunnerConfigError(f"{label} must be a non-empty string")
    return value


def _bounded_text(value, label, maximum):
    normalized = _nonempty_string(value, label).strip()
    if len(normalized) > maximum or CONTROL_CHARACTERS.search(value):
        raise RunnerConfigError(
            f"{label} must be a non-empty string of at most {maximum} characters "
            "without control characters"
        )
    return normalized


def _capabilities(value, label):
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 64:
        raise RunnerConfigError(f"{label} must be a string array")
    parsed = []
    for index, item in enumerate(value):
        capability = _bounded_text(item, f"{label}[{index}]", 64)
        if not SAFE_CAPABILITY.fullmatch(capability):
            raise RunnerConfigError(
                f"{label}[{index}] must match {SAFE_CAPABILITY.pattern!r}"
            )
        parsed.append(capability)
    return sorted(set(parsed))


def _lookup_id(items, item_id, label, *, id_validator=_safe_tool_id):
    if not isinstance(items, list):
        raise RunnerConfigError(f"{label} must be an array")
    matches = []
    for item in items:
        if not isinstance(item, dict):
            raise RunnerConfigError(f"{label} entries must be objects")
        if id_validator(item.get("id"), f"{label}.id") == item_id:
            matches.append(item)
    if len(matches) != 1:
        if not matches:
            raise RunnerConfigError(f"{label} id not found: {item_id}")
        raise RunnerConfigError(f"{label} id is duplicated: {item_id}")
    return matches[0]


def _valid_timeout(value, label):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not 60 <= value <= 86400:
        raise RunnerConfigError(f"{label} must be an integer in 60..86400")
    return value


def load_execution_descriptor(registry_path, *, agent=None, integration=None, runner_id=None):
    """Load an execution-side local CLI profile from either supported registry.

    The old dispatch/1 registry continues to identify its profile with
    `--agent`. tool-integrations/1 intentionally keeps roles out of a CLI
    integration; a single verified CLI runner can only receive the centrally
    permitted remote roles (Planner/Evaluator), never Generator.
    """
    try:
        with open(registry_path, encoding="utf-8") as fh:
            registry = json.load(fh)
    except Exception as exc:
        raise RunnerConfigError(f"registry unreadable: {exc}") from exc
    if not isinstance(registry, dict):
        raise RunnerConfigError("registry root must be an object")

    if integration is not None:
        integration_id = _safe_tool_id(integration, "integration")
        if registry.get("version") != TOOL_INTEGRATIONS_VERSION:
            raise RunnerConfigError(
                f"--integration requires registry version {TOOL_INTEGRATIONS_VERSION!r}"
            )
        item = _lookup_id(registry.get("integrations"), integration_id, "integrations")
        local_cli = item.get("local_cli")
        if not isinstance(local_cli, dict):
            raise RunnerConfigError(
                f"integration {integration_id!r}.local_cli must be an object"
            )
        adapter = _safe_tool_id(
            local_cli.get("adapter"),
            f"integration {integration_id!r}.local_cli.adapter",
        )
        sandbox = local_cli.get("sandbox")
        if not isinstance(sandbox, dict):
            raise RunnerConfigError(
                f"integration {integration_id!r}.local_cli.sandbox must be an object"
            )
        timeout_s = _valid_timeout(
            local_cli.get("timeout_s"),
            f"integration {integration_id!r}.local_cli.timeout_s",
        ) or DEFAULT_TIMEOUT_S
        tool = _safe_tool_id(item.get("tool"), f"integration {integration_id!r}.tool")
        label = _bounded_text(
            item.get("label", tool), f"integration {integration_id!r}.label", 128
        )
        family = _bounded_text(
            item.get("model_family"), f"integration {integration_id!r}.model_family", 128
        )
        capabilities = _capabilities(
            item.get("capabilities", []), f"integration {integration_id!r}.capabilities"
        )
        notes = item.get("notes")
        if notes is not None:
            notes = _bounded_text(notes, f"integration {integration_id!r}.notes", 4096)
        exposed_id = runner_id or f"{LOCAL_CLI_PREFIX}{integration_id}"
        exposed_id = _safe_config_id(exposed_id, "runner id")
        return {
            "id": exposed_id,
            "integration_id": integration_id,
            "tool": tool,
            "model_family": family,
            "roles": list(A2A_ROLES),
            "capabilities": capabilities,
            "transport": "local-cli",
            "adapter": adapter,
            "sandbox": sandbox,
            "timeout_s": timeout_s,
            "constraints": {"l2": False, "write_src": False, "push": False},
            "notes": label or notes or "",
        }

    agent_id = _safe_config_id(agent, "agent")
    descriptor = _lookup_id(
        registry.get("agents"), agent_id, "agents", id_validator=_safe_config_id
    )
    if descriptor.get("transport") != "local-cli":
        raise RunnerConfigError(
            f"agent {agent_id!r} uses transport={descriptor.get('transport')!r}; "
            "a runner must execute a local-cli profile"
        )
    descriptor = dict(descriptor)
    roles = descriptor.get("roles")
    if isinstance(roles, list) and "generator" in roles:
        raise RunnerConfigError(
            "a2a runner cannot expose generator until a source-handoff protocol exists"
        )
    descriptor["id"] = _safe_config_id(runner_id or agent_id, "runner id")
    if "model_family" in descriptor:
        descriptor["model_family"] = _bounded_text(
            descriptor.get("model_family"), f"agent {agent_id!r}.model_family", 128
        )
    if "capabilities" in descriptor:
        descriptor["capabilities"] = _capabilities(
            descriptor.get("capabilities"), f"agent {agent_id!r}.capabilities"
        )
    if "notes" in descriptor and descriptor["notes"] is not None:
        descriptor["notes"] = _bounded_text(
            descriptor["notes"], f"agent {agent_id!r}.notes", 4096
        )
    descriptor.setdefault("integration_id", None)
    return descriptor


def validate_integration_preflight(catalog_path, registry_path, adapters_dir, descriptor):
    """Fail before listening unless every exposed integration role is executable.

    ``sandbox-profile.sh`` resolves these same generated local-cli targets at
    task time. Exercise the catalog now so a missing, unverified, or divergent
    adapter cannot turn the first remote task into a delayed configuration
    failure after an Agent Card has already been advertised.
    """
    integration_id = descriptor.get("integration_id")
    if integration_id is None:
        return
    integration_id = _safe_tool_id(integration_id, "integration")
    if not os.path.isfile(catalog_path):
        raise RunnerConfigError(f"framework tool catalog missing: {catalog_path}")

    expected = {
        "integration_id": integration_id,
        "invocation": "local-cli",
        "tool": descriptor.get("tool"),
        "model_family": descriptor.get("model_family"),
        "adapter": descriptor.get("adapter"),
        "sandbox": descriptor.get("sandbox"),
        "timeout_s": descriptor.get("timeout_s"),
        "capabilities": descriptor.get("capabilities", []),
    }
    for role in A2A_ROLES:
        target_id = f"{LOCAL_CLI_PREFIX}{integration_id}--{role}"
        command = [
            sys.executable,
            catalog_path,
            "target",
            "--registry",
            registry_path,
            "--adapters",
            adapters_dir,
            "--target-id",
            target_id,
        ]
        try:
            result = subprocess.run(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=15,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise RunnerConfigError(
                f"integration {integration_id!r} preflight could not run for "
                f"{target_id!r}: {exc}"
            ) from exc
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "tool catalog failed").strip()
            raise RunnerConfigError(
                f"integration {integration_id!r} preflight failed for {target_id!r}: "
                f"{detail[:600]}"
            )
        try:
            target = json.loads(result.stdout)
        except (TypeError, ValueError) as exc:
            raise RunnerConfigError(
                f"integration {integration_id!r} preflight returned invalid JSON for "
                f"{target_id!r}: {exc}"
            ) from exc
        if not isinstance(target, dict):
            raise RunnerConfigError(
                f"integration {integration_id!r} preflight returned a non-object for "
                f"{target_id!r}"
            )
        mismatches = [
            key for key, value in expected.items()
            if target.get(key, [] if key == "capabilities" else None) != value
        ]
        if target.get("target_id") != target_id or role not in target.get("roles", []):
            mismatches.extend(["target_id", "roles"])
        if mismatches:
            raise RunnerConfigError(
                f"integration {integration_id!r} preflight descriptor disagrees with "
                f"catalog target {target_id!r}: {', '.join(sorted(set(mismatches)))}"
            )


def _now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


class TaskStore:
    FINAL = {
        "COMPLETED", "FAILED", "CANCELED", "REJECTED",
        "INPUT_REQUIRED", "AUTH_REQUIRED",
    }
    ACTIVE = {"SUBMITTED", "WORKING"}

    def __init__(self, root):
        self.root = root
        os.makedirs(root, exist_ok=True)
        self._lock = threading.RLock()
        self._subs = {}

    def _p(self, tid, suffix="json"):
        safe = re.sub(r"[^A-Za-z0-9._-]", "_", tid)
        return os.path.join(self.root, f"{safe}.{suffix}")

    def _read_unlocked(self, tid):
        try:
            with open(self._p(tid), encoding="utf-8") as fh:
                return json.load(fh)
        except (OSError, ValueError):
            return None

    def _write_unlocked(self, tid, rec):
        tmp = self._p(tid) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(rec, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, self._p(tid))

    def _notify_unlocked(self, tid):
        for waiter in self._subs.get(tid, []):
            waiter.set()

    def _append_event_unlocked(self, tid, kind, payload):
        path = self._p(tid, "events.jsonl")
        seq = 1
        if os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                seq += sum(1 for _ in fh)
        event = {"seq": seq, "kind": kind, "ts": _now(), "payload": payload}
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(event, ensure_ascii=False) + "\n")
        return event

    def create(self, tid, rec):
        with self._lock:
            current = self._read_unlocked(tid)
            if current is not None:
                return current, False
            self._write_unlocked(tid, rec)
            open(self._p(tid, "events.jsonl"), "w").close()
            self._append_event_unlocked(tid, "status", {"state": "SUBMITTED"})
            self._notify_unlocked(tid)
            return rec, True

    def get(self, tid):
        with self._lock:
            return self._read_unlocked(tid)

    def list(self):
        with self._lock:
            records = []
            for name in sorted(os.listdir(self.root)):
                if not name.endswith(".json"):
                    continue
                try:
                    with open(os.path.join(self.root, name), encoding="utf-8") as fh:
                        records.append(json.load(fh))
                except (OSError, ValueError):
                    pass
            return records

    def transition_working(self, tid):
        with self._lock:
            rec = self._read_unlocked(tid)
            if not rec or rec.get("state") != "SUBMITTED" or rec.get("events_complete"):
                return False
            rec.update(state="WORKING", started_at=_now())
            self._write_unlocked(tid, rec)
            self._append_event_unlocked(tid, "status", {"state": "WORKING"})
            self._notify_unlocked(tid)
            return True

    def finalize(self, tid, state, *, artifact_event=None, **updates):
        """Persist one complete terminal sequence while holding the store lock."""
        if state not in self.FINAL:
            raise ValueError(f"not a terminal state: {state}")
        with self._lock:
            rec = self._read_unlocked(tid)
            if rec is None:
                return None, False
            if rec.get("state") in self.FINAL or rec.get("events_complete"):
                return rec, False
            rec.update(updates)
            rec.update(state=state, finished_at=updates.get("finished_at") or _now())
            self._write_unlocked(tid, rec)
            if artifact_event is not None:
                self._append_event_unlocked(tid, "artifact", {"artifact": artifact_event})
            self._append_event_unlocked(tid, "status", {"state": state})
            rec["events_complete"] = True
            self._write_unlocked(tid, rec)
            self._notify_unlocked(tid)
            return rec, True

    def events_since(self, tid, last_seq):
        with self._lock:
            path = self._p(tid, "events.jsonl")
            if not os.path.exists(path):
                return []
            events = []
            with open(path, encoding="utf-8") as fh:
                for line in fh:
                    try:
                        event = json.loads(line)
                    except ValueError:
                        continue
                    if event.get("seq", 0) > last_seq:
                        events.append(event)
            return events

    def subscribe(self, tid):
        waiter = threading.Event()
        with self._lock:
            self._subs.setdefault(tid, []).append(waiter)
        return waiter

    def unsubscribe(self, tid, waiter):
        with self._lock:
            subscribers = self._subs.get(tid, [])
            if waiter in subscribers:
                subscribers.remove(waiter)


class _Slot:
    def __init__(self):
        self.proc = None
        self.proc_ready = threading.Event()
        self.cancel_cleanup = threading.Event()
        self.done = threading.Event()
        self.cancel_requested = False
        self.termination_reason = None


def _group_exists(pgid):
    try:
        os.killpg(pgid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def _terminate_group(proc, grace_s):
    if proc is None:
        return
    pgid = proc.pid
    try:
        os.killpg(pgid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    deadline = time.monotonic() + grace_s
    while time.monotonic() < deadline:
        proc.poll()
        if not _group_exists(pgid):
            return
        time.sleep(0.02)
    try:
        os.killpg(pgid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    deadline = time.monotonic() + max(1.0, grace_s)
    while time.monotonic() < deadline:
        proc.poll()
        if not _group_exists(pgid):
            return
        time.sleep(0.02)


class Executor:
    def __init__(self, cfg, store):
        self.cfg = cfg
        self.store = store
        self._lock = threading.RLock()
        self._slots = {}
        self.shutting_down = False

    def start(self, tid, envelope):
        with self._lock:
            if self.shutting_down or tid in self._slots:
                return False
            slot = _Slot()
            self._slots[tid] = slot
        threading.Thread(target=self._run, args=(tid, envelope, slot), daemon=True).start()
        return True

    def _is_canceled(self, slot):
        with self._lock:
            return slot.cancel_requested

    def _finish_canceled(self, tid, slot):
        slot.cancel_cleanup.wait(self.cfg.shutdown_timeout)
        self.store.finalize(
            tid,
            "CANCELED",
            termination_reason=slot.termination_reason or "cancel_task",
            error="task canceled; sandbox process group terminated",
        )

    def _run(self, tid, envelope, slot):
        cfg = self.cfg
        safe_tid = re.sub(r"[^A-Za-z0-9._-]", "_", tid)
        env_path = os.path.join(cfg.state, f"envelope-{safe_tid}.json")
        try:
            with open(env_path, "w", encoding="utf-8") as fh:
                json.dump(envelope, fh, ensure_ascii=False)

            validation = subprocess.run(
                ["bash", cfg.validator, "envelope", env_path],
                capture_output=True,
                text=True,
                timeout=min(15.0, cfg.shutdown_timeout),
            )
            if self._is_canceled(slot):
                slot.proc_ready.set()
                slot.cancel_cleanup.set()
                self._finish_canceled(tid, slot)
                return
            if validation.returncode != 0:
                self.store.finalize(
                    tid,
                    "REJECTED",
                    error=(validation.stdout.strip() or validation.stderr.strip())[-2000:],
                    termination_reason="validation",
                )
                return
            if not self.store.transition_working(tid):
                slot.proc_ready.set()
                slot.cancel_cleanup.set()
                return

            command = [
                "bash", cfg.sandbox,
                "--envelope", env_path,
                "--registry", cfg.registry,
                "--adapters", cfg.adapters,
                "--workroot", cfg.workroot,
                "--state", cfg.state,
            ]
            if getattr(cfg, "integration", None):
                command.extend(["--integration", cfg.integration])
            else:
                command.extend(["--agent", cfg.agent])
            started = time.time()
            proc = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                start_new_session=True,
            )
            with self._lock:
                slot.proc = proc
                slot.proc_ready.set()
                cancel_now = slot.cancel_requested
            if cancel_now:
                try:
                    os.killpg(proc.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
            out, err = proc.communicate()
            code = proc.returncode
            duration = int(time.time() - started)

            if self._is_canceled(slot):
                if not slot.cancel_cleanup.is_set():
                    _terminate_group(proc, cfg.cancel_grace)
                    slot.cancel_cleanup.set()
                self._finish_canceled(tid, slot)
                return

            run_meta = None
            for line in (out or "").splitlines():
                line = line.strip()
                if not line.startswith("{"):
                    continue
                try:
                    run_meta = json.loads(line)
                except ValueError:
                    pass
            if run_meta is None:
                self.store.finalize(
                    tid,
                    "FAILED",
                    exit_code=code,
                    duration_s=duration,
                    error=(err or "sandbox did not return run-meta")[-2000:],
                    termination_reason="sandbox_failure",
                )
                return

            artifact_obj = None
            artifact_error = None
            artifact_path = run_meta.get("artifact")
            if artifact_path and os.path.isfile(artifact_path):
                try:
                    with open(artifact_path, encoding="utf-8") as fh:
                        artifact_obj = json.load(fh)
                except (OSError, ValueError) as exc:
                    artifact_error = f"artifact JSON invalid: {exc}"
            else:
                artifact_error = "artifact missing"

            meta_path = os.path.join(cfg.state, f"run-meta-{safe_tid}.json")
            with open(meta_path, "w", encoding="utf-8") as fh:
                json.dump(run_meta, fh, ensure_ascii=False)
            receipt_proc = subprocess.run(
                ["bash", cfg.validator, "receipt", meta_path],
                capture_output=True,
                text=True,
                timeout=min(15.0, cfg.shutdown_timeout),
            )
            receipt = {}
            for line in (receipt_proc.stdout or "").splitlines():
                if line.strip().startswith("{"):
                    try:
                        receipt = json.loads(line)
                    except ValueError:
                        pass
            state = {
                "COMPLETED": "COMPLETED",
                "AUTH_REQUIRED": "AUTH_REQUIRED",
                "INPUT_REQUIRED": "INPUT_REQUIRED",
                "FAILED": "FAILED",
                "CANCELED": "CANCELED",
                "ARTIFACT_INVALID": "FAILED",
            }.get(receipt.get("state"), "FAILED")
            reason = "deadline" if state == "CANCELED" else "process_exit"
            self.store.finalize(
                tid,
                state,
                artifact_event=artifact_obj,
                exit_code=code,
                duration_s=duration,
                run_meta=run_meta,
                artifact=artifact_obj,
                artifact_error=artifact_error,
                receipt_advisory=receipt,
                log_tail=(err or "")[-2000:],
                termination_reason=reason,
            )
        except subprocess.TimeoutExpired as exc:
            if self._is_canceled(slot):
                slot.proc_ready.set()
                slot.cancel_cleanup.set()
                self._finish_canceled(tid, slot)
            else:
                self.store.finalize(
                    tid,
                    "FAILED",
                    error=f"trusted lifecycle command exceeded its bound: {exc}",
                    termination_reason="runner_internal_timeout",
                )
        except Exception as exc:
            if self._is_canceled(slot):
                slot.proc_ready.set()
                slot.cancel_cleanup.set()
                self._finish_canceled(tid, slot)
            else:
                self.store.finalize(
                    tid,
                    "FAILED",
                    error=f"sandbox launch failed: {exc}",
                    termination_reason="sandbox_failure",
                )
        finally:
            slot.proc_ready.set()
            slot.done.set()
            with self._lock:
                self._slots.pop(tid, None)

    def cancel(self, tid, reason="cancel_task"):
        rec = self.store.get(tid)
        if rec is None:
            return None
        if rec.get("state") in TaskStore.FINAL:
            return rec

        with self._lock:
            slot = self._slots.get(tid)
            if slot is not None:
                slot.cancel_requested = True
                slot.termination_reason = slot.termination_reason or reason
        if slot is None:
            return self.store.finalize(
                tid,
                "CANCELED",
                termination_reason=reason,
                error="task canceled before a process was registered",
            )[0]

        slot.proc_ready.wait(self.cfg.shutdown_timeout)
        _terminate_group(slot.proc, self.cfg.cancel_grace)
        slot.cancel_cleanup.set()
        if not slot.done.wait(self.cfg.shutdown_timeout):
            self.store.finalize(
                tid,
                "CANCELED",
                termination_reason=reason,
                error="task canceled after bounded process cleanup",
            )
        return self.store.get(tid)

    def begin_shutdown(self):
        with self._lock:
            self.shutting_down = True

    def shutdown_all(self, reason="runner_stop"):
        self.begin_shutdown()
        active = [t["taskId"] for t in self.store.list() if t.get("state") in TaskStore.ACTIVE]
        threads = [
            threading.Thread(target=self.cancel, args=(tid, reason), daemon=True)
            for tid in active
        ]
        for thread in threads:
            thread.start()
        deadline = time.monotonic() + self.cfg.shutdown_timeout
        for thread in threads:
            thread.join(max(0.0, deadline - time.monotonic()))
        # A timed-out cancellation waiter must not let the runner exit with its process group alive.
        with self._lock:
            remaining_slots = [(tid, self._slots.get(tid)) for tid in active]
        for _tid, slot in remaining_slots:
            if slot is not None and not slot.done.is_set():
                _terminate_group(slot.proc, self.cfg.cancel_grace)
                slot.cancel_cleanup.set()
        for thread in threads:
            thread.join(self.cfg.cancel_grace + 0.5)
        for tid in active:
            rec = self.store.get(tid)
            if rec and rec.get("state") in TaskStore.ACTIVE:
                self.store.finalize(
                    tid,
                    "CANCELED",
                    termination_reason=reason,
                    error="runner shutdown reached its bounded drain",
                )


def make_handler(cfg, store, executor, descriptor):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "harness-a2a-runner/1.5.1"

        def log_message(self, fmt, *args):
            sys.stderr.write("[a2a-runner] %s - %s\n" % (self.address_string(), fmt % args))

        def _touch(self):
            self.server.last_request_at = time.time()

        def _authed(self):
            if not cfg.token:
                return True
            value = self.headers.get("Authorization", "")
            return value.startswith("Bearer ") and value[7:].strip() == cfg.token

        def _json(self, code, obj):
            body = json.dumps(obj, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _rpc_error(self, request_id, code, message):
            self._json(
                200,
                {"jsonrpc": "2.0", "id": request_id,
                 "error": {"code": code, "message": message}},
            )

        def do_GET(self):
            self._touch()
            if self.path == "/health":
                return self._json(200, {"ok": True, "agent": cfg.runner_id, "ts": _now()})
            if self.path.rstrip("/") == "/.well-known/a2a-agent-card":
                if not self._authed():
                    return self._json(401, {"error": "unauthorized"})
                return self._json(200, agent_card(cfg, descriptor))
            return self._json(404, {"error": "not found"})

        def do_POST(self):
            self._touch()
            if not self._authed():
                return self._json(401, {"error": "unauthorized"})
            try:
                size = int(self.headers.get("Content-Length") or 0)
                request = json.loads(self.rfile.read(size) or b"{}")
            except Exception as exc:
                return self._rpc_error(None, -32700, f"parse error: {exc}")
            request_id = request.get("id")
            method = request.get("method")
            params = request.get("params") or {}

            if method == "SendMessage":
                if executor.shutting_down:
                    return self._rpc_error(request_id, -32003, "runner is shutting down")
                envelope = params.get("envelope") or {}
                tid = envelope.get("task_id")
                if not tid:
                    return self._rpc_error(request_id, -32602, "envelope.task_id is required")
                role = envelope.get("role")
                if role == "generator":
                    return self._rpc_error(
                        request_id,
                        -32602,
                        "a2a generator is disabled until a source-handoff protocol exists",
                    )
                if role not in (descriptor.get("roles") or []):
                    return self._rpc_error(
                        request_id,
                        -32602,
                        f"agent does not declare envelope role={role!r}",
                    )
                rec = {
                    "taskId": tid,
                    "contextId": params.get("contextId") or str(uuid.uuid4()),
                    "state": "SUBMITTED",
                    "agent": cfg.runner_id,
                    "model_family": descriptor.get("model_family"),
                    "batch": envelope.get("batch"),
                    "role": envelope.get("role"),
                    "deliverable": envelope.get("deliverable"),
                    "submitted_at": _now(),
                }
                stored, created = store.create(tid, rec)
                if not created:
                    result = {"taskId": tid, "state": stored.get("state"), "deduplicated": True}
                else:
                    executor.start(tid, envelope)
                    result = {"taskId": tid, "state": "SUBMITTED", "deduplicated": False}
                return self._json(200, {"jsonrpc": "2.0", "id": request_id, "result": result})

            if method == "GetTask":
                rec = store.get(params.get("taskId") or "")
                if rec is None:
                    return self._rpc_error(request_id, -32001, "task not found")
                return self._json(200, {"jsonrpc": "2.0", "id": request_id, "result": rec})

            if method == "ListTasks":
                tasks = [
                    {key: task.get(key) for key in
                     ("taskId", "state", "batch", "role", "submitted_at", "finished_at")}
                    for task in store.list()
                ]
                return self._json(200, {"jsonrpc": "2.0", "id": request_id,
                                        "result": {"tasks": tasks}})

            if method == "CancelTask":
                tid = params.get("taskId") or ""
                before = store.get(tid)
                if before is None:
                    return self._rpc_error(request_id, -32001, "task not found")
                rec = executor.cancel(tid, "cancel_task")
                result = {
                    "taskId": tid,
                    "state": rec.get("state"),
                    "finished_at": rec.get("finished_at"),
                    "events_complete": rec.get("events_complete", False),
                    "termination_reason": rec.get("termination_reason"),
                    "deduplicated": before.get("state") in TaskStore.FINAL,
                }
                return self._json(200, {"jsonrpc": "2.0", "id": request_id, "result": result})

            if method == "SubscribeToTask":
                return self._sse(params.get("taskId") or "")

            return self._rpc_error(request_id, -32601, f"method not found: {method}")

        def _write_event(self, tid, event):
            name = "artifact" if event["kind"] == "artifact" else "status"
            payload = dict(event["payload"])
            payload["taskId"] = tid
            chunk = (
                f"id: {event['seq']}\nevent: {name}\n"
                f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
            )
            self.wfile.write(chunk.encode())
            self.wfile.flush()

        def _sse(self, tid):
            if store.get(tid) is None:
                return self._json(404, {"error": "task not found"})
            try:
                last = int(self.headers.get("Last-Event-ID") or 0)
            except ValueError:
                last = 0
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            self.end_headers()
            waiter = store.subscribe(tid)
            try:
                deadline = time.time() + cfg.sse_timeout
                while time.time() < deadline:
                    for event in store.events_since(tid, last):
                        last = event["seq"]
                        self._write_event(tid, event)
                    rec = store.get(tid) or {}
                    if rec.get("events_complete"):
                        for event in store.events_since(tid, last):
                            last = event["seq"]
                            self._write_event(tid, event)
                        self.wfile.write(b"event: done\ndata: {}\n\n")
                        self.wfile.flush()
                        return
                    waiter.clear()
                    if not waiter.wait(timeout=cfg.sse_heartbeat):
                        self.wfile.write(b": keepalive\n\n")
                        self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                store.unsubscribe(tid, waiter)

    return Handler


def agent_card(cfg, descriptor):
    return {
        "protocolVersion": "1.0",
        "name": cfg.runner_id,
        "description": descriptor.get("notes") or f"harness dispatch agent {cfg.runner_id}",
        "provider": {"organization": "harness-dispatch",
                     "modelFamily": descriptor.get("model_family")},
        "url": f"http://{cfg.advertise}:{cfg.port}/",
        "capabilities": {"streaming": True, "pushNotifications": False,
                         "extendedAgentCard": False},
        "skills": [{"id": item, "name": item}
                   for item in (descriptor.get("capabilities") or [])],
        "roles": descriptor.get("roles") or [],
        "securitySchemes": ({"bearer": {"type": "http", "scheme": "bearer"}}
                            if cfg.token else {}),
        "x-harness": {
            "contract_version": "harness/1.1",
            "constraints": descriptor.get("constraints") or {},
            "sandboxed": True,
            "tool": descriptor.get("tool"),
            "integration_id": descriptor.get("integration_id"),
            "runner_id": cfg.runner_id,
            "conformance": "subset: JSON-RPC only; no gRPC/REST, extension negotiation, or signed card",
        },
    }


def _process_identity(pid):
    try:
        started = subprocess.check_output(
            ["ps", "-p", str(pid), "-o", "lstart="], text=True, stderr=subprocess.DEVNULL
        ).strip()
        command = subprocess.check_output(
            ["ps", "-p", str(pid), "-o", "command="], text=True, stderr=subprocess.DEVNULL
        ).strip()
        return started, command
    except (OSError, subprocess.CalledProcessError):
        return None, None


def _pid_alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


def stop_runner(cfg):
    pid_path = os.path.join(cfg.state, "runner.pid")
    try:
        with open(pid_path, encoding="utf-8") as fh:
            record = json.load(fh)
        pid = int(record["pid"])
    except Exception:
        print(f"[a2a-runner] no valid pidfile at {pid_path}", flush=True)
        return 0
    started, command = _process_identity(pid)
    valid = (
        os.path.realpath(record.get("state", "")) == cfg.state
        and record.get("process_started") == started
        and command is not None
        and os.path.basename(__file__) in command
    )
    if not valid:
        if not _pid_alive(pid):
            try:
                os.remove(pid_path)
            except OSError:
                pass
            print(f"[a2a-runner] removed stale pidfile for pid={pid}", flush=True)
            return 0
        print(f"[a2a-runner] pidfile does not identify this state runner; refusing pid={pid}", flush=True)
        return 2
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        try:
            os.remove(pid_path)
        except OSError:
            pass
        return 0
    deadline = time.monotonic() + cfg.shutdown_timeout + cfg.drain_timeout + 2.0
    while time.monotonic() < deadline:
        if not _pid_alive(pid) or not os.path.exists(pid_path):
            print(f"[a2a-runner] stopped pid={pid}", flush=True)
            return 0
        time.sleep(0.05)
    print(f"[a2a-runner] timed out waiting for graceful stop pid={pid}", flush=True)
    return 2


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    dispatch_dir = os.path.dirname(script_dir)
    parser = argparse.ArgumentParser()
    parser.add_argument("--registry", default=".agents-registry.json")
    selector = parser.add_mutually_exclusive_group(required=True)
    selector.add_argument("--agent")
    selector.add_argument("--integration")
    parser.add_argument(
        "--runner-id",
        help="Stable remote Agent Card identity; defaults to the legacy agent id or local-cli--<integration>.",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=41241)
    parser.add_argument("--state", default=".harness-dispatch/a2a")
    parser.add_argument(
        "--project-root",
        help="Project root that owns .agents-registry.json; defaults to the invocation directory.",
    )
    parser.add_argument("--workroot", default="../.harness-dispatch")
    parser.add_argument("--sandbox", default=os.path.join(dispatch_dir, "sandbox-profile.sh"))
    parser.add_argument("--validator", default=os.path.join(dispatch_dir, "validate-dispatch.sh"))
    parser.add_argument("--adapters", default=os.path.join(script_dir, "adapters"))
    parser.add_argument("--sse-heartbeat", type=float, default=15.0)
    parser.add_argument("--sse-timeout", type=float, default=86400.0)
    parser.add_argument("--idle-exit", type=float, default=0.0)
    parser.add_argument("--cancel-grace", type=float, default=2.5)
    parser.add_argument("--shutdown-timeout", type=float, default=10.0)
    parser.add_argument("--drain-timeout", type=float, default=1.0)
    parser.add_argument("--stop", action="store_true")
    cfg = parser.parse_args()

    cfg.state = os.path.realpath(cfg.state)
    cfg.workroot = os.path.realpath(cfg.workroot)
    cfg.sandbox = os.path.realpath(cfg.sandbox)
    cfg.validator = os.path.realpath(cfg.validator)
    cfg.adapters = os.path.realpath(cfg.adapters)
    if cfg.stop:
        return stop_runner(cfg)
    if min(cfg.sse_heartbeat, cfg.sse_timeout, cfg.cancel_grace,
           cfg.shutdown_timeout, cfg.drain_timeout) < 0:
        parser.error("lifecycle durations must be non-negative")
    if cfg.cancel_grace < MIN_CANCEL_GRACE_S:
        parser.error(
            f"--cancel-grace must be at least {MIN_CANCEL_GRACE_S}s so the sandbox helper "
            "can finish cleaning its independent CLI process group"
        )

    try:
        root_arg = cfg.project_root if cfg.project_root is not None else os.getcwd()
        cfg.registry = project_registry_path(root_arg, cfg.registry)
        cfg.project_root = os.path.dirname(cfg.registry)
    except DispatchContractError as exc:
        sys.exit(f"[a2a-runner] {exc}")

    try:
        descriptor = load_execution_descriptor(
            cfg.registry,
            agent=cfg.agent,
            integration=cfg.integration,
            runner_id=cfg.runner_id,
        )
    except RunnerConfigError as exc:
        sys.exit(f"[a2a-runner] {exc}")
    cfg.runner_id = descriptor["id"]
    for path in (cfg.sandbox, cfg.validator):
        if not os.path.isfile(path):
            sys.exit(f"[a2a-runner] framework resource missing: {path}")
    if cfg.integration:
        try:
            validate_integration_preflight(
                os.path.join(dispatch_dir, "tool-catalog.py"),
                cfg.registry,
                cfg.adapters,
                descriptor,
            )
        except RunnerConfigError as exc:
            sys.exit(f"[a2a-runner] {exc}")

    cfg.token = os.environ.get("HARNESS_A2A_TOKEN", "").strip()
    loopback = cfg.host in ("127.0.0.1", "::1", "localhost")
    if not loopback and not cfg.token:
        sys.exit("[a2a-runner] non-loopback binding requires HARNESS_A2A_TOKEN")
    cfg.advertise = cfg.host if not loopback else "127.0.0.1"

    os.makedirs(cfg.state, exist_ok=True)
    store = TaskStore(os.path.join(cfg.state, "tasks"))
    executor = Executor(cfg, store)
    for task in store.list():
        if task.get("state") in TaskStore.ACTIVE:
            store.finalize(
                task["taskId"],
                "FAILED",
                error="runner restarted after losing the execution process; retry with the same task id",
                termination_reason="runner_restart",
            )

    server = ThreadingHTTPServer(
        (cfg.host, cfg.port), make_handler(cfg, store, executor, descriptor)
    )
    server.daemon_threads = True
    cfg.port = server.server_address[1]
    server.last_request_at = time.time()

    pid_path = os.path.join(cfg.state, "runner.pid")
    if os.path.exists(pid_path):
        try:
            old = json.load(open(pid_path))
            if _pid_alive(int(old.get("pid", -1))):
                server.server_close()
                sys.exit(f"[a2a-runner] live runner already owns state: {cfg.state}")
        except Exception:
            pass
    process_started, _command = _process_identity(os.getpid())
    with open(pid_path, "w", encoding="utf-8") as fh:
        json.dump({
            "pid": os.getpid(),
            "state": cfg.state,
            "port": cfg.port,
            "runner_id": cfg.runner_id,
            "integration_id": descriptor.get("integration_id"),
            "process_started": process_started,
            "started_at": _now(),
        }, fh, ensure_ascii=False, indent=2)

    shutdown_started = threading.Event()

    def request_shutdown(reason):
        if shutdown_started.is_set():
            return
        shutdown_started.set()
        executor.begin_shutdown()

        def coordinated_shutdown():
            executor.shutdown_all(reason)
            end = time.monotonic() + cfg.drain_timeout
            while time.monotonic() < end:
                time.sleep(min(0.05, end - time.monotonic()))
            server.shutdown()

        threading.Thread(target=coordinated_shutdown, daemon=False).start()

    def on_signal(signum, _frame):
        request_shutdown("runner_stop" if signum == signal.SIGTERM else "runner_interrupt")

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)

    if cfg.idle_exit > 0:
        def idle_watch():
            interval = min(1.0, max(0.05, cfg.idle_exit / 4.0))
            while not shutdown_started.wait(interval):
                busy = any(task.get("state") in TaskStore.ACTIVE for task in store.list())
                if busy:
                    server.last_request_at = time.time()
                elif time.time() - server.last_request_at >= cfg.idle_exit:
                    request_shutdown("idle_exit")
                    return
        threading.Thread(target=idle_watch, daemon=True).start()

    print(
        f"[a2a-runner] {cfg.runner_id} listening on http://{cfg.host}:{cfg.port}/ "
        f"state={cfg.state}",
        flush=True,
    )
    try:
        server.serve_forever()
    finally:
        executor.shutdown_all("runner_exit")
        server.server_close()
        try:
            current = json.load(open(pid_path))
            if int(current.get("pid", -1)) == os.getpid():
                os.remove(pid_path)
        except (OSError, ValueError):
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
