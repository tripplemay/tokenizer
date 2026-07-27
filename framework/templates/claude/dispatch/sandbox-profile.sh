#!/usr/bin/env bash
# dispatch-mode.md 机件 #7「外部 CLI 沙箱契约」——local-cli transport 的开车前置条件。
#
# 为什么需要它：autonomous-mode.md §6 的 deny-list 写在 .claude/settings.json 里，
# 只约束 Claude Code 自己的工具调用。一旦编排者拉起外部 CLI 子进程（codex/gemini/...），
# 那个进程有自己的权限模型、自己的工具集、自己的 shell —— deny-list 一条都拦不住，
# 闸门分类器更看不见（那是阶段内部的工具调用）。工具层拦不住，就在进程层拦。
#
# 四道锁：env 白名单（没凭据就花不了钱）· 独立 worktree · 禁 push · wall-clock 封顶。
#
# 用法：
#   sandbox-profile.sh --agent <agent-id> --envelope <envelope.json> [--ref <sha>]
#                      [--registry .agents-registry.json] [--adapters <dir>] [--workroot <dir>]
#
# 输出：stdout **只有** run-meta JSON（outcome / exit_code / artifact / worktree / duration_s），
#       供编排者机械解析；一切进度与告警走 stderr，不得污染 stdout；
#       同一份落盘到 <worktree>/../run-meta-<task_id>.json 供编排者与取证使用。
# 退出码：0 = 子进程正常结束（outcome 仍可能是 ARTIFACT_MISSING，判定归编排者）
#         2 = 沙箱前置断言失败（fail-closed，未派活）
#         124 = 超时
#
# 本脚本不判 PASS/FAIL、不判 waiting、不写状态机文件——它只负责「安全地把活派出去并取回原始产物」。
# 语义判定归 validate-dispatch.sh + 编排者（铁律 12：结论原样落盘，运输层不参与评估）。

set -euo pipefail

REGISTRY=".agents-registry.json"
ADAPTERS=".claude/dispatch/transports/adapters"
WORKROOT="../.harness-dispatch"
AGENT_ID=""
ENVELOPE=""
REF=""

while [ $# -gt 0 ]; do
  case "$1" in
    --agent)    AGENT_ID="$2"; shift 2 ;;
    --envelope) ENVELOPE="$2"; shift 2 ;;
    --ref)      REF="$2"; shift 2 ;;
    --registry) REGISTRY="$2"; shift 2 ;;
    --adapters) ADAPTERS="$2"; shift 2 ;;
    --workroot) WORKROOT="$2"; shift 2 ;;
    *) echo "[sandbox] ⛔ 未知参数：$1" >&2; exit 2 ;;
  esac
done

die() { echo "[sandbox] ⛔ $1" >&2; exit 2; }

# ── 0. 前置断言（fail-closed：任一不满足即不派活）─────────────────────────
[ -n "$AGENT_ID" ]   || die "缺 --agent"
[ -n "$ENVELOPE" ]   || die "缺 --envelope"
[ -f "$ENVELOPE" ]   || die "信封文件不存在：$ENVELOPE"
[ -f "$REGISTRY" ]   || die "注册表不存在：${REGISTRY}（机件未装，不许开车）"
command -v python3 >/dev/null 2>&1 || die "python3 不可用"
command -v git     >/dev/null 2>&1 || die "git 不可用"

# ── 1. 解析 descriptor + adapter（合并为一份 shell 变量清单）───────────────
eval "$(python3 - "$REGISTRY" "$AGENT_ID" "$ADAPTERS" "$ENVELOPE" <<'PY'
import json, sys, shlex, os
reg_path, agent_id, adapters_dir, env_path = sys.argv[1:5]

def fail(msg):
    print(f'echo "[sandbox] ⛔ {msg}" >&2; exit 2'); sys.exit(0)

try:
    reg = json.load(open(reg_path))
except Exception as e:
    fail(f"注册表 JSON 非法：{e}")

d = next((a for a in reg.get("agents", []) if a.get("id") == agent_id), None)
if d is None:
    fail(f"注册表中无此 agent：{agent_id}")
if d.get("transport") != "local-cli":
    fail(f"{agent_id} 的 transport={d.get('transport')}，本脚本只处理 local-cli")

adapter_name = d.get("adapter") or ""
if not adapter_name:
    fail(f"{agent_id} 未声明 adapter")
ad_path = os.path.join(adapters_dir, adapter_name + ".json")
try:
    ad = json.load(open(ad_path))
except Exception as e:
    fail(f"适配器不可读（{ad_path}）：{e}")

try:
    env = json.load(open(env_path))
except Exception as e:
    fail(f"信封 JSON 非法：{e}")

batch    = env.get("batch") or fail("信封缺 batch")
task_id  = env.get("task_id") or fail("信封缺 task_id（幂等键）")
ref      = (env.get("repo") or {}).get("ref") or ""

sb       = d.get("sandbox") or {}
# 产物路径的优先级：**信封 > 适配器 > 默认约定**。
# 信封是「这一次任务」的契约，适配器只是「这家 CLI」的默认约定 —— 契约必须压过约定。
# 原实现只读适配器（默认 `<batch>-verdict.json`），于是 generator 派活（交 handoff 工件）
# 的产物永远被判 ARTIFACT_MISSING：它按信封写在 handoff.json，沙箱却去找 verdict.json。
# 实测踩到（BL-MODESCMD，Codex 写完代码交了 handoff，回执仍报「产物缺失」）。
_dl = (env.get("deliverable") or {}).get("artifact")
artifact = (_dl or ad.get("artifact_relpath") or "docs/test-reports/{{batch}}-verdict.json").replace("{{batch}}", batch)

def emit(k, v): print(f"{k}={shlex.quote(str(v))}")
emit("D_ADAPTER", adapter_name)
emit("D_FAMILY", d.get("model_family", ""))
emit("D_TIMEOUT", d.get("timeout_s", 3600))
# home_dir 必须展开 ~ 并绝对化。相对/未展开的 HOME 有两层危害（实测踩到）：
# ① 子进程把 HOME 当相对路径 → 在 CWD 下造出字面量 `~/` 垃圾目录；
# ② 下面的 dotfile fail-closed 断言会去检查一个**不存在的相对路径**，
#    于是静默通过、等于没检查 —— L1 的护栏被悄悄削掉。
_home = sb.get("home_dir", "")
if _home:
    # 判据必须在展开**之前**：abspath 会把相对路径也变成绝对路径，放在之后等于没判。
    # 拒相对路径的理由：它会静默地相对「编排者恰好所处的 CWD」解析，结果不确定。
    if not (_home.startswith("/") or _home.startswith("~")):
        fail(f"sandbox.home_dir 必须以 / 或 ~ 开头（当前 {_home!r}）—— 相对路径会随 CWD 漂移")
    _home = os.path.abspath(os.path.expanduser(_home))
emit("D_HOME", _home)
emit("D_ENVELOPE_DELIVERY", ad.get("envelope_delivery", "stdin"))
emit("D_WRITE_SRC", "1" if (d.get("constraints") or {}).get("write_src") else "")
emit("E_BATCH", batch)
emit("E_TASK_ID", task_id)
emit("E_REF", ref)
emit("E_ARTIFACT", artifact)
# argv 模板与 env 白名单以 NUL 安全的换行分隔数组传出
print("D_ARGV_TEMPLATE=(" + " ".join(shlex.quote(x) for x in ad.get("argv", [])) + ")")
allow = ["PATH", "HOME", "LANG", "LC_ALL", "TERM", "TMPDIR", "USER", "SHELL"]
allow += ad.get("env_allowlist_extra", []) + sb.get("env_allow", [])
seen, uniq = set(), []
for k in allow:
    if k not in seen:
        seen.add(k); uniq.append(k)
print("D_ENV_ALLOW=(" + " ".join(shlex.quote(x) for x in uniq) + ")")
# env_set：字面注入的键值（~ 展开）。R1 缓解的正确形态——只注入该 CLI 的认证目录
# （如 CODEX_HOME=~/.codex），而不是把整个真实 HOME 放进白名单连带暴露 ~/.aws 等。
es = sb.get("env_set") or {}
print("D_ENV_SET=(" + " ".join(
    shlex.quote(f"{k}={os.path.expanduser(str(v))}") for k, v in es.items()) + ")")
PY
)"

[ -n "$REF" ] || REF="$E_REF"
[ -n "$REF" ] || REF="$(git rev-parse HEAD)"

# ── 2. 独立 worktree（锁定到 sha，detach，不设 upstream）────────────────────
mkdir -p "$WORKROOT"
WT="$(cd "$WORKROOT" && pwd)/${E_BATCH}-${AGENT_ID}-${E_TASK_ID}"
[ -e "$WT" ] && die "worktree 已存在：${WT}（同 task_id 重复派活？幂等键应去重）"
# 🔴 写代码的角色不能用 worktree。git worktree 把元数据放在**主仓**的
# `.git/worktrees/<name>/`，而外部 CLI 的厂商沙箱（Codex 的 -s workspace-write）只允许
# 写 workspace 目录本身 —— 于是 `git commit` 连 index.lock 都建不出来（实测原话：
# "Operation not permitted"）。四道锁的 L2 与厂商沙箱在这里相互不兼容：外部 generator
# 拿不到任何提交能力，只能交出未提交的改动。
# 改用 `git clone --shared`：.git 落在沙箱目录内（可写），object 仍与主仓共享（不复制体积）。
# 隔离性不降反升 —— 不再与主仓共用 .git，主仓连元数据都不会被碰。
if [ -n "${D_WRITE_SRC:-}" ]; then
  git clone --shared --no-checkout "$(git rev-parse --show-toplevel)" "$WT" >/dev/null 2>&1 \
    || die "沙箱克隆创建失败（ref=${REF}）"
  git -C "$WT" checkout --detach "$REF" >/dev/null 2>&1 \
    || die "沙箱克隆 checkout 失败（ref=${REF}）"
  # origin 指向本机主仓，push 仍被 GIT_CONFIG 层的 pushurl 覆盖挡住（见下）；
  # 另把 fetch url 也断掉，避免子进程从主仓拉到不该看的分支。
  git -C "$WT" remote set-url origin DISABLED_BY_HARNESS_SANDBOX >/dev/null 2>&1 || true
  echo "[sandbox] 独立克隆（write_src=true）: $WT @ ${REF:0:12}" >&2
else
  git worktree add --detach "$WT" "$REF" >/dev/null 2>&1 \
    || die "worktree 创建失败（ref=${REF}）"
  echo "[sandbox] worktree: $WT @ ${REF:0:12}" >&2
fi

ENVELOPE_ABS="$(cd "$(dirname "$ENVELOPE")" && pwd)/$(basename "$ENVELOPE")"
ENVELOPE_JSON="$(cat "$ENVELOPE_ABS")"

# ── 3. env 白名单（构造子进程环境；未列出的一律不传）────────────────────────
# 关键：这是「没凭据就花不了钱」那一招。prod DATABASE_URL / 各家 API key /
# AWS_* / VERCEL_TOKEN 等一律不进白名单 → 子进程拿不到 → 结构上无法触达生产与计费。
ENV_ARGS=()
for k in "${D_ENV_ALLOW[@]}"; do
  if [ -n "${!k+x}" ]; then ENV_ARGS+=("$k=${!k}"); fi
done
# 字面注入（descriptor.sandbox.env_set）——优先于白名单继承，用于精确投喂该 CLI 的认证位置
for kv in ${D_ENV_SET[@]+"${D_ENV_SET[@]}"}; do ENV_ARGS+=("$kv"); done
# 禁 push：env 级 git config 覆盖，只影响子进程，不写磁盘 config
# （worktree 与主仓共享 .git/config，用 `git remote set-url` 会污染主仓——绝不可用）
ENV_ARGS+=("GIT_CONFIG_COUNT=1" "GIT_CONFIG_KEY_0=remote.origin.pushurl" \
           "GIT_CONFIG_VALUE_0=DISABLED_BY_HARNESS_SANDBOX" "GIT_TERMINAL_PROMPT=0")
# 🔴 专用 HOME 是**硬性前置**，不是可选加固。原因（实测，非推演）：
# 外部 CLI 普遍用登录 shell 执行命令（Codex 0.145.0 用 `/bin/zsh -lc`），
# 登录 shell 会 source `~/.zshenv` / `~/.zprofile`——其中任何 `export` 都会把
# env -i 刚剥掉的变量**原样还回子进程**，静默击穿第一道锁。
# 实测：HOME 指向含 `.zshenv` 的目录时，DATABASE_URL / DEPLOY_TOKEN 全部复活。
[ -n "$D_HOME" ] || die "$AGENT_ID 未配 sandbox.home_dir —— 子进程会继承真实 HOME，
   其 .zshenv/.zprofile 中的 export 将绕过 env 白名单还原敏感变量（dispatch-mode.md §5.1 L1）。
   请配置专用 HOME，并用 sandbox.env_set 投喂该 CLI 的认证目录（如 CODEX_HOME）。"
case "$D_HOME" in /*) ;; *) die "sandbox.home_dir 必须是绝对路径或 ~ 开头（当前解析为 ${D_HOME}）" ;; esac
mkdir -p "$D_HOME"
# 专用 HOME 里若混入 shell 初始化文件，同一个洞照样重开 —— fail-closed
for dotf in .zshenv .zprofile .zlogin .bashrc .bash_profile .profile .envrc; do
  [ -e "$D_HOME/$dotf" ] && die "专用 HOME 内存在 shell 初始化文件 $D_HOME/$dotf —— 它会在登录 shell 下被 source 并绕过 env 白名单。请移除。"
done
ENV_ARGS+=("HOME=$D_HOME")
echo "[sandbox] 专用 HOME: ${D_HOME}（已确认无 shell 初始化文件）" >&2
ENV_ARGS+=("HARNESS_ENVELOPE=$ENVELOPE_ABS")
ENV_ARGS+=("HARNESS_ARTIFACT=$E_ARTIFACT" "HARNESS_BATCH=$E_BATCH" "HARNESS_TASK_ID=$E_TASK_ID")
# 主仓绝对路径：一次性工作目录里没有 node_modules 之类的依赖，而厂商沙箱可能禁网
# （Codex 实测 npm ci 装不了）。与其让对方自己去猜，不如明确告诉它「同 HEAD 的依赖在这儿，
# 只读复用」——实测中 Codex 正是自己摸到主仓 node_modules 才跑通 L1 的，且如实披露了。
# ⚠️ 这不放宽任何权限：四道锁本来就不含文件系统隔离（§5.1），对方读得到主仓是既成事实；
# 明写出来只是把「靠猜」变成「有契约」，并让它知道**不该写**这个路径。
ENV_ARGS+=("HARNESS_MAIN_REPO=$(git rev-parse --show-toplevel)")

# ── 4. 渲染 argv 模板 ──────────────────────────────────────────────────────
ARGV=()
for tok in "${D_ARGV_TEMPLATE[@]}"; do
  tok="${tok//\{\{worktree\}\}/$WT}"
  tok="${tok//\{\{envelope\}\}/$ENVELOPE_ABS}"
  # {{envelope_json}}：内联信封**内容**（不是路径），供只接受 `-p <text>` 的 CLI（如 Kimi）。
  # 作为单个 argv 元素直接 exec，无 shell 解释；信封 ~1KB，远低于 ARG_MAX。
  tok="${tok//\{\{envelope_json\}\}/$ENVELOPE_JSON}"
  tok="${tok//\{\{batch\}\}/$E_BATCH}"
  tok="${tok//\{\{artifact\}\}/$E_ARTIFACT}"
  ARGV+=("$tok")
done
command -v "${ARGV[0]}" >/dev/null 2>&1 || die "适配器可执行文件不在 PATH：${ARGV[0]}"

# ── 5. wall-clock 封顶执行（portable：timeout / gtimeout / bash watchdog）───
run_with_timeout() {
  local secs="$1"; shift
  if command -v timeout >/dev/null 2>&1; then timeout -k 10 "$secs" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then gtimeout -k 10 "$secs" "$@"
  else
    # ⚠️ `<&0` 不可省：无 job control 时，后台命令的 stdin 会被 bash 默认接到 /dev/null，
    # 把 stdin 投递的信封整个吞掉（macOS 无 GNU timeout 时恒命中本分支）。
    # 实测：缺此重定向 → 子进程收到空信封 → 产物写不出 → 回执 ARTIFACT_MISSING。
    #
    # 🔴 watchdog 必须**留下自己开过枪的凭据**，不能靠退出码反推。
    # SIGTERM 杀掉的子进程退出码是 143，而 143 同样来自「外部把整条命令 kill 了」
    # （编排者所在会话超时就是这样）。只看退出码 → 两种情形无法区分：
    # 要么漏判超时（实测：本机无 GNU timeout，超时被判成 FAILED，于是文档承诺的
    # 「TIMEOUT → 凭 task_id 幂等重派」永远不会发生，变成「重派上限 1 次后硬停」），
    # 要么把外部中断误判成超时而去自动重派。故用 marker 文件记录**是我开的枪**。
    local marker; marker="$(mktemp)"
    "$@" <&0 & local pid=$!
    ( sleep "$secs"; kill -TERM "$pid" 2>/dev/null && echo fired > "$marker"; \
      sleep 10; kill -KILL "$pid" 2>/dev/null ) & local wd=$!
    local rc=0; wait "$pid" || rc=$?
    kill "$wd" 2>/dev/null || true
    # 对齐 GNU timeout 的约定：超时一律 124，上层判定逻辑两条分支共用一套判据
    [ -s "$marker" ] && rc=124
    rm -f "$marker"
    return $rc
  fi
}

LOG="$(cd "$WORKROOT" && pwd)/run-${E_TASK_ID}.log"
START=$(date +%s)
set +e
# 子进程一律在 worktree 内启动（子 shell cd，不影响本脚本）。
# 不依赖各家 CLI 的 --cd/-C 是否存在、是否被遵守；Kimi 无此类参数，完全靠这条。
# 封顶对两种投递方式都必须生效——重定向套在 timeout 之外，stdin 透传给子进程，不影响封顶。
if [ "$D_ENVELOPE_DELIVERY" = "stdin" ]; then
  ( cd "$WT" && run_with_timeout "$D_TIMEOUT" env -i "${ENV_ARGS[@]}" "${ARGV[@]}" < "$ENVELOPE_ABS" > "$LOG" 2>&1 )
else
  # argv 投递：信封路径或内容已渲染进 argv，另有 HARNESS_ENVELOPE env 兜底
  ( cd "$WT" && run_with_timeout "$D_TIMEOUT" env -i "${ENV_ARGS[@]}" "${ARGV[@]}" < /dev/null > "$LOG" 2>&1 )
fi
EXIT=$?
set -e
DURATION=$(( $(date +%s) - START ))

# ── 6. 回执原始事实（不做语义判定）─────────────────────────────────────────
ARTIFACT_ABS="$WT/$E_ARTIFACT"
if   [ "$EXIT" -eq 124 ] || [ "$EXIT" -eq 137 ]; then OUTCOME="TIMEOUT"
elif [ "$EXIT" -ne 0 ];                          then OUTCOME="FAILED"
elif [ ! -f "$ARTIFACT_ABS" ];                   then OUTCOME="ARTIFACT_MISSING"
else                                                  OUTCOME="RETURNED"
fi

META="$WORKROOT/run-meta-${E_TASK_ID}.json"
python3 - "$META" "$E_TASK_ID" "$AGENT_ID" "$D_ADAPTER" "$D_FAMILY" "$E_BATCH" \
                  "$WT" "$ARTIFACT_ABS" "$LOG" "$OUTCOME" "$EXIT" "$DURATION" "$REF" <<'PY'
import json, sys
p, task, agent, adapter, family, batch, wt, art, log, outcome, code, dur, ref = sys.argv[1:14]
meta = {"task_id": task, "agent_id": agent, "adapter": adapter, "model_family": family,
        "batch": batch, "ref": ref, "worktree": wt, "artifact": art, "log": log,
        "outcome": outcome, "exit_code": int(code), "duration_s": int(dur)}
json.dump(meta, open(p, "w"), ensure_ascii=False, indent=2)
print(json.dumps(meta, ensure_ascii=False))
PY

echo "[sandbox] outcome=$OUTCOME exit=$EXIT ${DURATION}s · log=$LOG" >&2
# 清理命令按沙箱形态给：克隆是普通目录（worktree remove 对它无效，会报「不是 worktree」）
if [ -n "${D_WRITE_SRC:-}" ]; then
  echo "[sandbox] 取证后清理：rm -rf '$WT'（write_src 用的是独立克隆，不是 worktree）" >&2
else
  echo "[sandbox] 取证后清理：git worktree remove --force '$WT'" >&2
fi
[ "$OUTCOME" = "TIMEOUT" ] && exit 124
exit 0
