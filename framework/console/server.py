#!/usr/bin/env python3
"""harness console —— 自托管多项目控制台（console-mode.md）。

定位（红线）：**控制台不是编排者。**
harness 是 hub 形态、状态机唯一持有者、git 是唯一真相源。控制台若变成 hub，就会撞上
「点对点委托无全局工作流概念，链式转委托无人持有全局真相」。所以它只做三件事：
  ① 观测面   —— 读各项目 git 里的 progress.json / features.json，只读镜像，不是真相源
  ② 人闸门 UI —— 展示 pending_gate，人批准后**提交一个 commit**；机器侧 pull 到才生效
  ③ 注册中心 —— （P4）机器与 runner 的注册、心跳、路由；本文件暂只做 ①②

传输就是 git。控制台在本机维护各项目的克隆，定时 `git pull`；批准时写 `pending_gate.decision`
并 commit+push。不依赖 GitHub API，任何 remote 都能用；也不引入第二个真相源。

安全：
- 绑非 loopback 必须设 HARNESS_CONSOLE_TOKEN，否则拒绝启动（fail-closed）
- 只读取仓库内 docs/ 下的取证文件，路径穿越一律拒
- 控制台**只写 `pending_gate.decision` 一个字段**，不碰 status/features——推进键仍在机器侧
- ⚠️ 若日后开启全量日志上报（P3），本机将持久化含凭据片段的日志正文，
  须按「持有密钥的系统」对待：磁盘加密、访问控制、留存期限

用法：
  export HARNESS_CONSOLE_TOKEN=<token>        # 绑非 loopback 时必需
  python3 console/server.py --config console/console.config.json [--host 127.0.0.1] [--port 41300]
"""

import argparse, json, os, subprocess, sys, threading, time, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UI = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ui.html")


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def git(repo, *args, check=False):
    r = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True)
    if check and r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} 失败：{r.stderr.strip()}")
    return r


def read_json(path):
    try:
        return json.load(open(path))
    except Exception:
        return None


# ─────────────────────────── 项目状态读取（只读镜像）───────────────────────────

class Projects:
    def __init__(self, cfg):
        self.cfg = cfg
        self.cache = {}
        self.lock = threading.Lock()

    def _read_one(self, p):
        repo = p["path"]
        out = {"name": p["name"], "path": repo, "ok": True, "error": None,
               "read_at": now()}
        if not os.path.isdir(os.path.join(repo, ".git")):
            out.update(ok=False, error=f"不是 git 仓库：{repo}")
            return out
        prog = read_json(os.path.join(repo, "progress.json"))
        feats = read_json(os.path.join(repo, "features.json"))
        if prog is None:
            out.update(ok=False, error="progress.json 不可读或非法")
            return out
        gate = prog.get("pending_gate")
        auton = prog.get("autonomy") or {}
        flist = (feats or {}).get("features") or prog.get("features") or []
        done = sum(1 for f in flist if f.get("status") == "completed")
        head = git(repo, "rev-parse", "--short", "HEAD").stdout.strip()
        out.update(
            status=prog.get("status"),
            batch=prog.get("current_sprint"),
            fix_rounds=prog.get("fix_rounds", 0),
            completed=done, total=len(flist),
            signoff=(prog.get("docs") or {}).get("signoff"),
            dashboard_url=prog.get("dashboard_url"),
            autonomy_status=auton.get("status"),
            last_halt=auton.get("last_halt"),
            head=head,
            features=[{k: f.get(k) for k in ("id", "title", "status", "executor")} for f in flist],
            gate=gate,
            role_assignments=prog.get("role_assignments"),
        )
        return out

    def refresh(self, pull=True):
        res = []
        for p in self.cfg["projects"]:
            try:
                if pull and p.get("pull", True):
                    git(p["path"], "pull", "--ff-only")
                res.append(self._read_one(p))
            except Exception as e:
                res.append({"name": p["name"], "ok": False, "error": str(e), "read_at": now()})
        with self.lock:
            self.cache = {"projects": res, "refreshed_at": now()}
        return self.cache

    def get(self):
        with self.lock:
            return dict(self.cache) if self.cache else {"projects": [], "refreshed_at": None}

    def find(self, name):
        return next((p for p in self.cfg["projects"] if p["name"] == name), None)


# ─────────────────────────── 闸门批准（唯一的写操作）───────────────────────────

def decide(project, gate_id, action, by, note, push=True):
    """写 pending_gate.decision + commit(+push)。**只写这一个字段**。"""
    repo = project["path"]
    prog_path = os.path.join(repo, "progress.json")
    git(repo, "pull", "--ff-only")                     # 先对齐，避免基于陈旧状态批准
    prog = read_json(prog_path)
    if prog is None:
        raise RuntimeError("progress.json 不可读或非法")
    g = prog.get("pending_gate")
    if not g:
        raise RuntimeError("当前无待批闸门（可能已被机器消费）")
    if g.get("id") != gate_id:
        raise RuntimeError(f"闸门已变化：当前 {g.get('id')}，你批的是 {gate_id}——请刷新后重试")
    if g.get("decision"):
        d = g["decision"]
        raise RuntimeError(f"该闸门已有决策（{d['action']} by {d['by']}），不覆盖")
    g["decision"] = {"gate_id": gate_id, "action": action, "by": by,
                     "at": now(), "scope": {"once": True}, **({"note": note} if note else {})}
    with open(prog_path, "w") as fh:
        json.dump(prog, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    # 提交前过一遍项目自己的 schema 校验器（若已装）——控制台不绕过项目的守门
    v = os.path.join(repo, ".claude/console/validate-pending-gate.sh")
    if os.path.isfile(v):
        r = subprocess.run(["bash", v, "schema", prog_path], capture_output=True, text=True)
        if r.returncode != 0:
            git(repo, "checkout", "--", "progress.json")
            raise RuntimeError(f"schema 校验未过，已回滚：{r.stdout.strip()}")

    git(repo, "add", "progress.json", check=True)
    git(repo, "commit", "-m", f"chore(gate): {action} {gate_id} by {by}", check=True)
    pushed = False
    if push:
        r = git(repo, "push")
        pushed = r.returncode == 0
    return {"ok": True, "gate_id": gate_id, "action": action, "by": by,
            "pushed": pushed, "at": now()}


def read_evidence(project, relpath):
    """只读仓库内 docs/ 下的取证文件。路径穿越一律拒。"""
    repo = os.path.realpath(project["path"])
    target = os.path.realpath(os.path.join(repo, relpath))
    docs = os.path.realpath(os.path.join(repo, "docs"))
    if not (target == docs or target.startswith(docs + os.sep)):
        raise RuntimeError("只允许读取仓库内 docs/ 下的文件")
    if not os.path.isfile(target):
        raise RuntimeError("文件不存在")
    if os.path.getsize(target) > 512 * 1024:
        raise RuntimeError("文件过大（>512KB），请到本机查看")
    return open(target, encoding="utf-8", errors="replace").read()


# ─────────────────────────── HTTP ───────────────────────────

def make_handler(cfg, projects):
    token = cfg.get("_token")
    operator = cfg.get("operator") or "console-user"

    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "harness-console/1.0"

        def log_message(self, fmt, *a):
            sys.stderr.write("[console] %s - %s\n" % (self.address_string(), fmt % a))

        def _authed(self):
            if not token:
                return True
            got = self.headers.get("Authorization", "")
            if got.startswith("Bearer ") and got[7:].strip() == token:
                return True
            q = urllib.parse.urlparse(self.path).query
            return urllib.parse.parse_qs(q).get("token", [None])[0] == token

        def _send(self, code, body, ctype="application/json; charset=utf-8"):
            if isinstance(body, (dict, list)):
                body = json.dumps(body, ensure_ascii=False)
            data = body.encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            u = urllib.parse.urlparse(self.path)
            if u.path == "/health":
                return self._send(200, {"ok": True, "ts": now()})
            if not self._authed():
                return self._send(401, {"error": "unauthorized"})
            if u.path in ("/", "/index.html"):
                try:
                    return self._send(200, open(UI, encoding="utf-8").read(),
                                      "text/html; charset=utf-8")
                except Exception as e:
                    return self._send(500, {"error": f"UI 不可读：{e}"})
            if u.path == "/api/state":
                q = urllib.parse.parse_qs(u.query)
                if q.get("refresh", ["0"])[0] == "1":
                    return self._send(200, projects.refresh())
                return self._send(200, projects.get())
            if u.path == "/api/evidence":
                q = urllib.parse.parse_qs(u.query)
                p = projects.find((q.get("project") or [""])[0])
                if not p:
                    return self._send(404, {"error": "未知项目"})
                try:
                    return self._send(200, {"content": read_evidence(p, (q.get("path") or [""])[0])})
                except Exception as e:
                    return self._send(400, {"error": str(e)})
            self._send(404, {"error": "not found"})

        def do_POST(self):
            if not self._authed():
                return self._send(401, {"error": "unauthorized"})
            u = urllib.parse.urlparse(self.path)
            try:
                n = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(n) or b"{}")
            except Exception as e:
                return self._send(400, {"error": f"请求体非法：{e}"})

            if u.path == "/api/gate":
                p = projects.find(body.get("project") or "")
                if not p:
                    return self._send(404, {"error": "未知项目"})
                if body.get("action") not in ("approve", "reject"):
                    return self._send(400, {"error": "action 必须为 approve/reject"})
                by = (body.get("by") or operator).strip()
                if not by:
                    return self._send(400, {"error": "缺 by —— 批准必须可归属"})
                try:
                    r = decide(p, body.get("gate_id") or "", body["action"], by,
                               body.get("note"), push=p.get("push", True))
                    projects.refresh(pull=False)
                    return self._send(200, r)
                except Exception as e:
                    return self._send(409, {"error": str(e)})
            self._send(404, {"error": "not found"})

    return H


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="console/console.config.json")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=41300)  # 与 a2a runner(41241) 同族，避开 8787 等常见占用
    a = ap.parse_args()

    try:
        cfg = json.load(open(a.config))
    except Exception as e:
        sys.exit(f"[console] ⛔ 配置不可读（{a.config}）：{e}")
    if not cfg.get("projects"):
        sys.exit("[console] ⛔ 配置里没有 projects")
    for p in cfg["projects"]:
        if not p.get("name") or not p.get("path"):
            sys.exit(f"[console] ⛔ project 条目缺 name/path：{p}")
        p["path"] = os.path.abspath(os.path.expanduser(p["path"]))

    cfg["_token"] = os.environ.get("HARNESS_CONSOLE_TOKEN", "").strip()
    loopback = a.host in ("127.0.0.1", "::1", "localhost")
    if not loopback and not cfg["_token"]:
        sys.exit("[console] ⛔ 绑定非 loopback 必须设 HARNESS_CONSOLE_TOKEN（fail-closed）")
    if not os.path.isfile(UI):
        sys.exit(f"[console] ⛔ UI 文件缺失：{UI}")

    projects = Projects(cfg)
    projects.refresh()

    interval = int(cfg.get("poll_interval_s", 60))
    def poller():
        while True:
            time.sleep(interval)
            try:
                projects.refresh()
            except Exception as e:
                sys.stderr.write(f"[console] 轮询失败：{e}\n")
    threading.Thread(target=poller, daemon=True).start()

    srv = ThreadingHTTPServer((a.host, a.port), make_handler(cfg, projects))
    srv.daemon_threads = True
    print(f"[console] 监听 http://{a.host}:{a.port}/  项目 {len(cfg['projects'])} 个  "
          f"轮询 {interval}s  鉴权={'Bearer' if cfg['_token'] else '无（仅 loopback）'}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("[console] 停止", flush=True)


if __name__ == "__main__":
    main()
