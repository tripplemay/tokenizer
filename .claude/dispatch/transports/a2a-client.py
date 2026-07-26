#!/usr/bin/env python3
"""dispatch-mode.md `a2a` transport —— 编排者侧客户端（hub 形态：我们是 client，对端是 server）。

设计要点：
- **状态机永远在编排者手里。** A2A 是点对点委托、无全局工作流概念；链式转委托会导致
  没人持有全局真相。故本客户端只负责「派出去、拿回来」，不碰 progress.json。
- **远端自述的 state 只是参考，权威判定在本地。** 客户端把产物写到本地后，
  由调用方对本地副本重跑 `validate-dispatch.sh receipt`——我们校验实际收到的东西，
  不采信远端的结论。这也是跨机器场景下唯一诚实的做法。
- **输出与 local-cli 完全同形。** 落盘一份 run-meta JSON，字段与 `sandbox-profile.sh` 一致，
  于是回执推断表、gate-arbiter、/autodrive 一行都不用改。

用法：
  a2a-client.py run       --agent <id> --envelope <f>   # 派活 + 订阅 + 落盘（阻塞，local-cli 的等价物）
  a2a-client.py send      --agent <id> --envelope <f>   # 只派活，立刻返回 taskId（真异步）
  a2a-client.py subscribe --agent <id> --task <id>      # SSE 订阅（支持 --resume-from 断线重放）
  a2a-client.py get       --agent <id> --task <id>      # 轮询一次
  a2a-client.py cancel    --agent <id> --task <id>
  a2a-client.py card      --agent <id>
  a2a-client.py ls        --agent <id>

stdout 只有机器可读 JSON；进度与告警走 stderr。
"""

import argparse, json, os, sys, time, urllib.error, urllib.request

STATE_DIR_DEFAULT = ".harness-dispatch"


def log(msg):
    sys.stderr.write(f"[a2a-client] {msg}\n")


def die(msg, code=2):
    log(f"⛔ {msg}")
    sys.exit(code)


def load_descriptor(registry, agent):
    try:
        reg = json.load(open(registry))
    except Exception as e:
        die(f"注册表不可读（{registry}）：{e}")
    d = next((a for a in reg.get("agents", []) if a.get("id") == agent), None)
    if d is None:
        die(f"注册表中无此 agent：{agent}")
    if d.get("transport") != "a2a":
        die(f"{agent} 的 transport={d.get('transport')}，本客户端只处理 a2a")
    if not d.get("endpoint"):
        die(f"{agent} 未声明 endpoint")
    return d


def auth_header(d):
    a = d.get("auth") or {}
    if a.get("type") != "bearer":
        return {}
    env_name = a.get("env")
    if not env_name:
        die("auth.type=bearer 但未声明 auth.env（持有 token 的环境变量名）")
    tok = os.environ.get(env_name, "").strip()
    if not tok:
        die(f"环境变量 {env_name} 未设置或为空 —— 无法通过对端鉴权")
    return {"Authorization": f"Bearer {tok}"}


def rpc(d, method, params, timeout=30):
    url = d["endpoint"].rstrip("/") + "/"
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method,
                       "params": params}, ensure_ascii=False).encode()
    req = urllib.request.Request(url, data=body, method="POST",
                                 headers={"Content-Type": "application/json", **auth_header(d)})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            out = json.loads(r.read())
    except urllib.error.HTTPError as e:
        die(f"{method} HTTP {e.code}：{e.read()[:300].decode(errors='replace')}")
    except Exception as e:
        die(f"{method} 连接失败：{e}（对端 runner 是否在跑？）")
    if "error" in out:
        die(f"{method} 返回错误：{out['error']}")
    return out.get("result")


def write_artifact_local(rec):
    """把内联产物写到本地 deliverable.artifact 相对路径 —— 与 local-cli 落盘位置一致。"""
    art = rec.get("artifact")
    rel = ((rec.get("deliverable") or {}).get("artifact")
           or f"docs/test-reports/{rec.get('batch')}-verdict.json")
    if art is None:
        return None
    os.makedirs(os.path.dirname(rel) or ".", exist_ok=True)
    with open(rel, "w") as fh:
        json.dump(art, fh, ensure_ascii=False, indent=2)
    log(f"产物已落本地：{rel}")
    return rel


def synth_run_meta(d, rec, state_dir):
    """合成与 sandbox-profile.sh 同形的 run-meta，交给 validate-dispatch.sh receipt 本地判定。

    outcome 只表达**运输层事实**（拿到没拿到、进程怎么结束的），语义（PASS/waiting/空壳）
    一律由本地 receipt 推断表在产物副本上重新得出。
    """
    local_artifact = write_artifact_local(rec)
    st = rec.get("state")
    if local_artifact:
        outcome = "RETURNED"
    elif st == "CANCELED":
        outcome = "TIMEOUT"                       # 回执表把 TIMEOUT 映射为 CANCELED → 幂等重派
    elif st in ("FAILED", "REJECTED") and rec.get("exit_code") in (0, None):
        outcome = "ARTIFACT_MISSING"              # 远端说完成了却没产物 —— exit 0 ≠ 完成
    else:
        outcome = "FAILED"

    rm = rec.get("run_meta") or {}
    meta = {
        "task_id": rec.get("taskId"), "agent_id": rec.get("agent") or d["id"],
        "adapter": rm.get("adapter") or "a2a", "model_family": rec.get("model_family"),
        "batch": rec.get("batch"), "ref": rm.get("ref"),
        "worktree": rm.get("worktree"),           # 远端路径，仅供取证
        "artifact": local_artifact or "",
        "log": rm.get("log") or "", "outcome": outcome,
        "exit_code": rec.get("exit_code") if rec.get("exit_code") is not None else 0,
        "duration_s": rec.get("duration_s") or 0,
        "transport": "a2a", "endpoint": d["endpoint"],
        "remote_state_advisory": st,              # 远端自述，仅参考
    }
    os.makedirs(state_dir, exist_ok=True)
    path = os.path.join(state_dir, f"run-meta-{meta['task_id']}.json")
    with open(path, "w") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)
    log(f"run-meta 已落盘：{path} —— 下一步用 `validate-dispatch.sh receipt {path}` 做权威判定")
    print(json.dumps(meta, ensure_ascii=False))
    return meta


TERMINAL = {"COMPLETED", "FAILED", "CANCELED", "REJECTED", "INPUT_REQUIRED", "AUTH_REQUIRED"}


def stream(d, task_id, resume_from=0, idle_timeout=7200):
    """SSE 订阅。返回终态时的 task 记录。断线由调用方重试并用 --resume-from 续。"""
    url = d["endpoint"].rstrip("/") + "/"
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "SubscribeToTask",
                       "params": {"taskId": task_id}}).encode()
    headers = {"Content-Type": "application/json", "Accept": "text/event-stream", **auth_header(d)}
    if resume_from:
        headers["Last-Event-ID"] = str(resume_from)
    req = urllib.request.Request(url, data=body, method="POST", headers=headers)
    last_seq = resume_from
    try:
        with urllib.request.urlopen(req, timeout=idle_timeout) as r:
            ev_id, ev_name, data = None, None, None
            for raw in r:
                line = raw.decode("utf-8", "replace").rstrip("\n")
                if line.startswith(":"):
                    continue                                     # keepalive
                if line == "":
                    if ev_name == "done":
                        break
                    if ev_name and data is not None:
                        if ev_id:
                            last_seq = int(ev_id)
                        payload = json.loads(data)
                        log(f"事件 #{ev_id} {ev_name}: {payload.get('state') or 'artifact'}")
                    ev_id, ev_name, data = None, None, None
                    continue
                if line.startswith("id: "):     ev_id = line[4:].strip()
                elif line.startswith("event: "): ev_name = line[7:].strip()
                elif line.startswith("data: "):  data = line[6:]
    except Exception as e:
        log(f"⚠️ 流中断（{e}）；事件已在对端落盘，可用 --resume-from {last_seq} 续订")
    return rpc(d, "GetTask", {"taskId": task_id})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["run", "send", "subscribe", "get", "cancel", "card", "ls"])
    ap.add_argument("--agent", required=True)
    ap.add_argument("--envelope")
    ap.add_argument("--task")
    ap.add_argument("--registry", default=".agents-registry.json")
    ap.add_argument("--state", default=STATE_DIR_DEFAULT)
    ap.add_argument("--resume-from", type=int, default=0)
    ap.add_argument("--poll-interval", type=float, default=5.0)
    a = ap.parse_args()
    d = load_descriptor(a.registry, a.agent)

    if a.cmd == "card":
        url = d["endpoint"].rstrip("/") + "/.well-known/a2a-agent-card"
        req = urllib.request.Request(url, headers=auth_header(d))
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                print(json.dumps(json.loads(r.read()), ensure_ascii=False, indent=2))
        except Exception as e:
            die(f"取 Agent Card 失败：{e}")
        return

    if a.cmd == "ls":
        print(json.dumps(rpc(d, "ListTasks", {}), ensure_ascii=False, indent=2)); return

    if a.cmd in ("send", "run"):
        if not a.envelope:
            die("缺 --envelope")
        env = json.load(open(a.envelope))
        res = rpc(d, "SendMessage", {"envelope": env})
        tid = res["taskId"]
        if res.get("deduplicated"):
            log(f"幂等命中：task {tid} 已存在（state={res.get('state')}），不重复派活")
        else:
            log(f"已派活 task={tid} → {d['endpoint']}")
        if a.cmd == "send":
            print(json.dumps({"taskId": tid, "state": res.get("state"),
                              "agent": a.agent, "endpoint": d["endpoint"]}, ensure_ascii=False))
            return
        rec = stream(d, tid, a.resume_from)
        return synth_run_meta(d, rec, a.state) and None

    if not a.task:
        die("缺 --task")

    if a.cmd == "cancel":
        print(json.dumps(rpc(d, "CancelTask", {"taskId": a.task}), ensure_ascii=False)); return

    if a.cmd == "subscribe":
        rec = stream(d, a.task, a.resume_from)
        return synth_run_meta(d, rec, a.state) and None

    if a.cmd == "get":
        rec = rpc(d, "GetTask", {"taskId": a.task})
        if rec.get("state") in TERMINAL:
            return synth_run_meta(d, rec, a.state) and None
        log(f"task {a.task} 仍在 {rec.get('state')}，尚无产物")
        print(json.dumps({k: rec.get(k) for k in ("taskId", "state", "batch", "role",
                                                  "submitted_at", "started_at")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
