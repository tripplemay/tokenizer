#!/usr/bin/env python3
"""dispatch-mode.md `a2a` transport —— 自建 A2A runner（把一次性 CLI 包成 A2A 服务端）。

为什么要它：Claude Code / Codex / Gemini CLI 都是一次性进程，不是 HTTP 服务。
A2A 的三项独有能力（真异步长任务 / taskId 重订阅 / 服务端推送）必须有个长驻进程承载。
本 runner 就是那层壳：收 A2A 请求 → 后台跑机件 #7 沙箱 → 任务状态落盘 → 供轮询或 SSE 订阅。

⚠️ 这是 **A2A 形状的子集**，不是通过一致性认证的 A2A 实现：
   只做 JSON-RPC 绑定（不做 gRPC/REST）、不做扩展协商、不做签名 Card、不做 OAuth/mTLS。
   不要假设它能直接对接任意第三方 A2A agent。

安全模型：
- runner 在**自己所在的机器**上调本地 `sandbox-profile.sh` → 机件 #7 四道锁原封不动生效。
  （dispatch-mode.md 的 R4「沙箱在 a2a 下失效」只适用于我们不控制的第三方对端。）
- 绑非 loopback 地址时**强制要求 Bearer token**，否则拒绝启动（fail-closed）。
- runner 报告的 state 只是**参考**；权威判定是客户端拿到产物后在本地重跑
  `validate-dispatch.sh receipt`——我们校验实际收到的东西，不采信远端的自述。

用法：
  export HARNESS_A2A_TOKEN=<token>          # 绑非 loopback 时必需
  a2a-runner.py --registry .agents-registry.json --agent reviewer-codex \\
                [--host 127.0.0.1] [--port 41241] [--state .harness-dispatch/a2a] \\
                [--workroot ../.harness-dispatch]

端点：
  GET  /.well-known/a2a-agent-card     Agent Card（由 descriptor 生成）
  POST /                               JSON-RPC 2.0：SendMessage / GetTask / ListTasks /
                                       CancelTask / SubscribeToTask（SSE）
  GET  /health                         存活探针
"""

import argparse, json, os, re, shutil, signal, subprocess, sys, threading, time, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ─────────────────────────── 任务存储（落盘，活过重启）───────────────────────────
# taskId 重订阅只有在 task store 持久化时才是真的——进程重启后仍能凭 id 取回结果。

class TaskStore:
    TERMINAL = {"COMPLETED", "FAILED", "CANCELED", "REJECTED"}
    INTERRUPT = {"INPUT_REQUIRED", "AUTH_REQUIRED"}

    def __init__(self, root):
        self.root = root
        os.makedirs(root, exist_ok=True)
        self._lock = threading.Lock()
        self._subs = {}          # task_id -> [threading.Event, ...] 唤醒等待中的 SSE

    def _p(self, tid, suffix="json"):
        safe = re.sub(r"[^A-Za-z0-9._-]", "_", tid)
        return os.path.join(self.root, f"{safe}.{suffix}")

    def create(self, tid, rec):
        with self._lock:
            if os.path.exists(self._p(tid)):
                return json.load(open(self._p(tid)))      # 幂等：同 task_id 不重跑
            self._write(tid, rec)
            open(self._p(tid, "events.jsonl"), "w").close()
            return rec

    def get(self, tid):
        try:
            return json.load(open(self._p(tid)))
        except Exception:
            return None

    def list(self):
        out = []
        for f in sorted(os.listdir(self.root)):
            if f.endswith(".json"):
                try: out.append(json.load(open(os.path.join(self.root, f))))
                except Exception: pass
        return out

    def _write(self, tid, rec):
        tmp = self._p(tid) + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(rec, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, self._p(tid))                      # 原子替换，防半写

    def update(self, tid, **kw):
        with self._lock:
            rec = self.get(tid) or {}
            rec.update(kw)
            self._write(tid, rec)
        return rec

    def emit(self, tid, kind, payload):
        """追加事件到 jsonl（带单调 seq，供 SSE Last-Event-ID 断线重放）"""
        with self._lock:
            path = self._p(tid, "events.jsonl")
            seq = sum(1 for _ in open(path)) + 1 if os.path.exists(path) else 1
            ev = {"seq": seq, "kind": kind, "ts": _now(), "payload": payload}
            with open(path, "a") as fh:
                fh.write(json.dumps(ev, ensure_ascii=False) + "\n")
            for e in self._subs.get(tid, []):
                e.set()
            return ev

    def events_since(self, tid, last_seq):
        path = self._p(tid, "events.jsonl")
        if not os.path.exists(path):
            return []
        out = []
        for line in open(path):
            try: ev = json.loads(line)
            except Exception: continue
            if ev.get("seq", 0) > last_seq:
                out.append(ev)
        return out

    def finish(self, tid):
        """标记该任务的事件已全部发完并唤醒订阅者。

        必须与 state 分开：执行侧是「先写终态记录、再发 artifact/status 事件」，
        若 SSE 以 state 为收流判据，会在最后一个 status 事件写盘前就发 done —— 订阅者
        永远收不到终态事件（实测：直播缺 #4，重放才看得到）。以本标志为准即无此窗口。
        """
        with self._lock:
            rec = self.get(tid) or {}
            rec["events_complete"] = True
            self._write(tid, rec)
            for e in self._subs.get(tid, []):
                e.set()

    def subscribe(self, tid):
        ev = threading.Event()
        with self._lock:
            self._subs.setdefault(tid, []).append(ev)
        return ev

    def unsubscribe(self, tid, ev):
        with self._lock:
            if tid in self._subs and ev in self._subs[tid]:
                self._subs[tid].remove(ev)


def _now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# ─────────────────────────── 执行：后台跑机件 #7 沙箱 ───────────────────────────

class Executor:
    """把一次派活跑在本机沙箱里。runner 与沙箱同机 ⇒ 四道锁完整生效。"""

    def __init__(self, cfg, store):
        self.cfg, self.store = cfg, store
        self.procs = {}                                   # task_id -> Popen

    def start(self, tid, envelope):
        threading.Thread(target=self._run, args=(tid, envelope), daemon=True).start()

    def _run(self, tid, envelope):
        cfg, store = self.cfg, self.store
        env_path = os.path.join(cfg.state, f"envelope-{re.sub(r'[^A-Za-z0-9._-]','_',tid)}.json")
        with open(env_path, "w") as fh:
            json.dump(envelope, fh, ensure_ascii=False)

        # 信封字段白名单校验（铁律 12 的机械强制）——不合规直接 REJECTED，不派活
        rc = subprocess.run(["bash", cfg.validator, "envelope", env_path],
                            capture_output=True, text=True)
        if rc.returncode != 0:
            store.update(tid, state="REJECTED", error=rc.stdout.strip() or rc.stderr.strip(),
                         finished_at=_now())
            store.emit(tid, "status", {"state": "REJECTED"})
            store.finish(tid)
            return

        store.update(tid, state="WORKING", started_at=_now())
        store.emit(tid, "status", {"state": "WORKING"})

        cmd = ["bash", cfg.sandbox, "--agent", cfg.agent, "--envelope", env_path,
               "--registry", cfg.registry, "--adapters", cfg.adapters, "--workroot", cfg.workroot]
        t0 = time.time()
        try:
            p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 text=True, start_new_session=True)
            self.procs[tid] = p
            out, err = p.communicate()
            code = p.returncode
        except Exception as e:
            store.update(tid, state="FAILED", error=f"沙箱启动失败：{e}", finished_at=_now())
            store.emit(tid, "status", {"state": "FAILED"})
            store.finish(tid)
            return
        finally:
            self.procs.pop(tid, None)

        dur = int(time.time() - t0)
        if store.get(tid).get("state") == "CANCELED":     # 期间被取消
            store.emit(tid, "status", {"state": "CANCELED"})
            store.finish(tid)
            return

        run_meta = None
        for line in (out or "").splitlines():             # stdout 只有 run-meta JSON（沙箱契约）
            line = line.strip()
            if line.startswith("{"):
                try: run_meta = json.loads(line)
                except Exception: pass
        if run_meta is None:
            store.update(tid, state="FAILED", exit_code=code, duration_s=dur,
                         error=(err or "沙箱未产出 run-meta")[-2000:], finished_at=_now())
            store.emit(tid, "status", {"state": "FAILED"})
            store.finish(tid)
            return

        # 产物内联进任务记录 —— 跨机器时客户端读不到 runner 的文件系统，必须随响应回传
        artifact_obj, artifact_err = None, None
        ap = run_meta.get("artifact")
        if ap and os.path.isfile(ap):
            try: artifact_obj = json.load(open(ap))
            except Exception as e: artifact_err = f"产物 JSON 非法：{e}"
        else:
            artifact_err = "产物缺失"

        # 语义判定复用 validate-dispatch.sh receipt（单一真相源，不在此另写一套推断）
        meta_path = os.path.join(cfg.state, f"run-meta-{re.sub(r'[^A-Za-z0-9._-]','_',tid)}.json")
        with open(meta_path, "w") as fh:
            json.dump(run_meta, fh, ensure_ascii=False)
        rr = subprocess.run(["bash", cfg.validator, "receipt", meta_path],
                            capture_output=True, text=True)
        receipt = {}
        for line in (rr.stdout or "").splitlines():
            if line.strip().startswith("{"):
                try: receipt = json.loads(line)
                except Exception: pass
        state = {                                          # 回执 6 态 → A2A 态
            "COMPLETED": "COMPLETED", "AUTH_REQUIRED": "AUTH_REQUIRED",
            "INPUT_REQUIRED": "INPUT_REQUIRED", "FAILED": "FAILED",
            "CANCELED": "CANCELED", "ARTIFACT_INVALID": "FAILED",
        }.get(receipt.get("state"), "FAILED")

        store.update(tid, state=state, exit_code=code, duration_s=dur,
                     run_meta=run_meta, artifact=artifact_obj, artifact_error=artifact_err,
                     receipt_advisory=receipt, log_tail=(err or "")[-2000:], finished_at=_now())
        if artifact_obj is not None:
            store.emit(tid, "artifact", {"artifact": artifact_obj})
        store.emit(tid, "status", {"state": state})
        store.finish(tid)

    def cancel(self, tid):
        p = self.procs.get(tid)
        if p and p.poll() is None:
            try: os.killpg(os.getpgid(p.pid), signal.SIGTERM)
            except Exception: pass
            return True
        return False


# ─────────────────────────── HTTP / JSON-RPC ───────────────────────────

def make_handler(cfg, store, executor, descriptor):

    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "harness-a2a-runner/1.0"

        def log_message(self, fmt, *a):
            sys.stderr.write("[a2a-runner] %s - %s\n" % (self.address_string(), fmt % a))

        # ── 鉴权 ──
        def _authed(self):
            if not cfg.token:
                return True                                # 仅 loopback 且未设 token 时
            got = self.headers.get("Authorization", "")
            return got.startswith("Bearer ") and got[7:].strip() == cfg.token

        def _json(self, code, obj, extra=None):
            body = json.dumps(obj, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def _rpc_err(self, rid, code, msg):
            self._json(200, {"jsonrpc": "2.0", "id": rid, "error": {"code": code, "message": msg}})

        def do_GET(self):
            if self.path == "/health":
                return self._json(200, {"ok": True, "agent": cfg.agent, "ts": _now()})
            if self.path.rstrip("/") == "/.well-known/a2a-agent-card":
                if not self._authed():
                    return self._json(401, {"error": "unauthorized"})
                return self._json(200, agent_card(cfg, descriptor))
            self._json(404, {"error": "not found"})

        def do_POST(self):
            if not self._authed():
                return self._json(401, {"error": "unauthorized"})
            try:
                n = int(self.headers.get("Content-Length") or 0)
                req = json.loads(self.rfile.read(n) or b"{}")
            except Exception as e:
                return self._rpc_err(None, -32700, f"parse error: {e}")

            rid, method = req.get("id"), req.get("method")
            params = req.get("params") or {}

            if method == "SendMessage":
                env = params.get("envelope") or {}
                tid = env.get("task_id")
                if not tid:
                    return self._rpc_err(rid, -32602, "envelope.task_id 缺失（幂等键必需）")
                existing = store.get(tid)
                if existing:                               # at-least-once ⇒ 幂等去重
                    return self._json(200, {"jsonrpc": "2.0", "id": rid,
                                            "result": {"taskId": tid, "state": existing.get("state"),
                                                       "deduplicated": True}})
                rec = {"taskId": tid, "contextId": params.get("contextId") or str(uuid.uuid4()),
                       "state": "SUBMITTED", "agent": cfg.agent,
                       "model_family": descriptor.get("model_family"),
                       "batch": env.get("batch"), "role": env.get("role"),
                       # 回传交付路径：客户端据此把产物写到本地同一相对位置，
                       # 使 a2a 与 local-cli 的落盘结果完全一致（下游一个字都不用改）
                       "deliverable": env.get("deliverable"),
                       "submitted_at": _now()}
                store.create(tid, rec)
                store.emit(tid, "status", {"state": "SUBMITTED"})
                executor.start(tid, env)
                return self._json(200, {"jsonrpc": "2.0", "id": rid,
                                        "result": {"taskId": tid, "state": "SUBMITTED"}})

            if method == "GetTask":
                rec = store.get(params.get("taskId") or "")
                if rec is None:
                    return self._rpc_err(rid, -32001, "task not found")
                return self._json(200, {"jsonrpc": "2.0", "id": rid, "result": rec})

            if method == "ListTasks":
                return self._json(200, {"jsonrpc": "2.0", "id": rid,
                                        "result": {"tasks": [
                                            {k: t.get(k) for k in
                                             ("taskId", "state", "batch", "role", "submitted_at", "finished_at")}
                                            for t in store.list()]}})

            if method == "CancelTask":
                tid = params.get("taskId") or ""
                rec = store.get(tid)
                if rec is None:
                    return self._rpc_err(rid, -32001, "task not found")
                if rec.get("state") in TaskStore.TERMINAL:
                    return self._rpc_err(rid, -32002, f"task already {rec['state']}")
                executor.cancel(tid)
                store.update(tid, state="CANCELED", finished_at=_now())
                store.emit(tid, "status", {"state": "CANCELED"})
                store.finish(tid)
                return self._json(200, {"jsonrpc": "2.0", "id": rid,
                                        "result": {"taskId": tid, "state": "CANCELED"}})

            if method == "SubscribeToTask":
                return self._sse(params.get("taskId") or "")

            self._rpc_err(rid, -32601, f"method not found: {method}")

        # ── SSE：TaskStatusUpdateEvent / TaskArtifactUpdateEvent ──
        def _sse(self, tid):
            if store.get(tid) is None:
                return self._json(404, {"error": "task not found"})
            # 断线重连：Last-Event-ID 之后的事件全部重放，不丢事件
            try: last = int(self.headers.get("Last-Event-ID") or 0)
            except ValueError: last = 0

            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            self.end_headers()

            waiter = store.subscribe(tid)
            try:
                deadline = time.time() + cfg.sse_timeout
                while time.time() < deadline:
                    for ev in store.events_since(tid, last):
                        last = ev["seq"]
                        kind = "artifact" if ev["kind"] == "artifact" else "status"
                        payload = dict(ev["payload"]); payload["taskId"] = tid
                        chunk = (f"id: {ev['seq']}\nevent: {kind}\n"
                                 f"data: {json.dumps(payload, ensure_ascii=False)}\n\n")
                        self.wfile.write(chunk.encode()); self.wfile.flush()
                    rec = store.get(tid) or {}
                    if rec.get("events_complete"):
                        for ev in store.events_since(tid, last):     # 最后排空，一个事件都不漏
                            last = ev["seq"]
                            kind = "artifact" if ev["kind"] == "artifact" else "status"
                            payload = dict(ev["payload"]); payload["taskId"] = tid
                            self.wfile.write((f"id: {ev['seq']}\nevent: {kind}\n"
                                              f"data: {json.dumps(payload, ensure_ascii=False)}\n\n").encode())
                        self.wfile.write(b"event: done\ndata: {}\n\n"); self.wfile.flush()
                        return
                    waiter.clear()
                    if not waiter.wait(timeout=cfg.sse_heartbeat):
                        self.wfile.write(b": keepalive\n\n"); self.wfile.flush()   # 防中间盒断连
            except (BrokenPipeError, ConnectionResetError):
                pass                                        # 客户端断开：事件已落盘，可重连重放
            finally:
                store.unsubscribe(tid, waiter)

    return H


def agent_card(cfg, d):
    """A2A Agent Card（子集）。由 descriptor 生成，避免两处维护同一份能力声明。"""
    return {
        "protocolVersion": "1.0",
        "name": cfg.agent,
        "description": d.get("notes") or f"harness dispatch agent {cfg.agent}",
        "provider": {"organization": "harness-dispatch", "modelFamily": d.get("model_family")},
        "url": f"http://{cfg.advertise}:{cfg.port}/",
        "capabilities": {"streaming": True, "pushNotifications": False, "extendedAgentCard": False},
        "skills": [{"id": c, "name": c} for c in (d.get("capabilities") or [])],
        "roles": d.get("roles") or [],
        "securitySchemes": ({"bearer": {"type": "http", "scheme": "bearer"}} if cfg.token else {}),
        "x-harness": {
            "contract_version": "harness/1.1",
            "constraints": d.get("constraints") or {},
            "sandboxed": True,
            "conformance": "subset: JSON-RPC binding only; no gRPC/REST, no extension negotiation, no signed card",
        },
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--registry", default=".agents-registry.json")
    ap.add_argument("--agent", required=True)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=41241)
    ap.add_argument("--state", default=".harness-dispatch/a2a")
    ap.add_argument("--workroot", default="../.harness-dispatch")
    ap.add_argument("--sandbox", default=".claude/dispatch/sandbox-profile.sh")
    ap.add_argument("--validator", default=".claude/dispatch/validate-dispatch.sh")
    ap.add_argument("--adapters", default=".claude/dispatch/transports/adapters")
    ap.add_argument("--sse-heartbeat", type=float, default=15.0)
    ap.add_argument("--sse-timeout", type=float, default=86400.0)
    # 生命周期管理（v1.4.5）。起因：一次演练留下的 runner 在本机挂了**整整两天**没人关，
    # 直到下次要用同一端口才被撞见。runner 是长驻服务，而演练用的 runner 没有任何东西负责收尾。
    ap.add_argument("--idle-exit", type=float, default=0.0,
                    help="空闲这么多秒后自行退出（无 SUBMITTED/WORKING 任务且无新请求）。"
                         "0=永不自退（长驻部署用）。**演练/临时用途请务必设**，如 --idle-exit 1800")
    ap.add_argument("--stop", action="store_true",
                    help="读 <state>/runner.pid 停掉正在跑的 runner 后退出")
    cfg = ap.parse_args()

    reg = json.load(open(cfg.registry))
    d = next((a for a in reg.get("agents", []) if a.get("id") == cfg.agent), None)
    if d is None:
        sys.exit(f"[a2a-runner] ⛔ 注册表中无此 agent：{cfg.agent}")
    if d.get("transport") not in ("local-cli", "a2a"):
        sys.exit(f"[a2a-runner] ⛔ {cfg.agent} 的 transport={d.get('transport')}，runner 只承载可本地执行的 agent")

    cfg.token = os.environ.get("HARNESS_A2A_TOKEN", "").strip()
    loopback = cfg.host in ("127.0.0.1", "::1", "localhost")
    # fail-closed：非 loopback 暴露必须有 token，绝不裸奔上网
    if not loopback and not cfg.token:
        sys.exit("[a2a-runner] ⛔ 绑定非 loopback 地址必须设 HARNESS_A2A_TOKEN（fail-closed）")
    for tool in (cfg.sandbox, cfg.validator):
        if not os.path.isfile(tool):
            sys.exit(f"[a2a-runner] ⛔ 机件缺失：{tool}（机件没装好不许开车）")

    cfg.advertise = cfg.host if not loopback else "127.0.0.1"
    os.makedirs(cfg.state, exist_ok=True)
    store = TaskStore(os.path.join(cfg.state, "tasks"))
    if cfg.stop:
        pid_path = os.path.join(cfg.state, "runner.pid")
        try:
            pid = int(open(pid_path).read().strip())
        except Exception:
            print(f"[a2a-runner] 没有 pidfile（{pid_path}）—— 没有由本 state 目录启动的 runner", flush=True)
            return
        try:
            os.kill(pid, signal.SIGTERM)
            print(f"[a2a-runner] 已停 pid={pid}", flush=True)
        except ProcessLookupError:
            print(f"[a2a-runner] pid={pid} 已不存在，清理 pidfile", flush=True)
        try:
            os.remove(pid_path)
        except OSError:
            pass
        return

    executor = Executor(cfg, store)

    # 重启后把「跑着跑着进程没了」的任务标记出来，而不是让它们永远 WORKING
    for t in store.list():
        if t.get("state") in ("SUBMITTED", "WORKING"):
            store.update(t["taskId"], state="FAILED",
                         error="runner 重启，该任务的执行进程已丢失（凭 task_id 幂等重派）",
                         finished_at=_now())
            store.emit(t["taskId"], "status", {"state": "FAILED"})
            store.finish(t["taskId"])

    # pidfile：让「关掉它」这件事有据可依，不必去 lsof 端口猜是谁
    pid_path = os.path.join(cfg.state, "runner.pid")
    os.makedirs(cfg.state, exist_ok=True)
    with open(pid_path, "w") as fh:
        fh.write(f"{os.getpid()}\n")

    srv = ThreadingHTTPServer((cfg.host, cfg.port), make_handler(cfg, store, executor, d))
    srv.daemon_threads = True
    print(f"[a2a-runner] {cfg.agent} ({d.get('model_family')}) 监听 http://{cfg.host}:{cfg.port}/"
          f"  鉴权={'Bearer' if cfg.token else '无（仅 loopback）'}  state={cfg.state}", flush=True)
    if cfg.idle_exit and cfg.idle_exit > 0:
        # 判据是「没活干」而不是「没请求」：正在跑的任务不能被空闲计时误杀，
        # 而只轮询状态的客户端也不该无限续命。两者都看：有活 → 重置；无活且无请求 → 计时。
        def idle_watch():
            while True:
                time.sleep(min(30.0, cfg.idle_exit / 2))
                busy = any(t.get("state") in ("SUBMITTED", "WORKING") for t in store.list())
                last = getattr(srv, "last_request_at", started_at)
                if busy:
                    srv.last_request_at = time.time()
                    continue
                if time.time() - last >= cfg.idle_exit:
                    print(f"[a2a-runner] 空闲 {cfg.idle_exit:.0f}s 且无在跑任务 → 自行退出", flush=True)
                    os._exit(0)
        started_at = time.time()
        srv.last_request_at = started_at
        threading.Thread(target=idle_watch, daemon=True).start()

    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("[a2a-runner] 停止", flush=True)
    finally:
        try:
            os.remove(pid_path)
        except OSError:
            pass


if __name__ == "__main__":
    main()
