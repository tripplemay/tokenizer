#!/usr/bin/env bash
# harness.sh —— 框架版本化 CLI（framework-versioning.md）
#
# 解决的问题：bootstrap 是**一次性复制**，项目从此冻结在当天的框架版本。没有版本号、
# 没有对账、升级只能手工重铺——而手工重铺会静默盖掉你对框架文件的本地改动。
#
# 形态：**物化文件 + 清单 + 校验和**。文件必须真实存在于固定路径（Claude Code 要能直接
# 看见 `.claude/hooks/*.sh` 与根目录的角色文件，submodule / 软链都做不到），所以版本化
# 落在「清单 + 对账 + 可升级」上，而不是把文件挪进包里。
#
#   harness.json   项目声明：框架来源 + 版本 + commit
#   harness.lock   受管文件清单，每个文件记**两个** sha256：
#                    sha256   —— 项目里这个文件上次对齐时的内容
#                    upstream —— 它当时对齐到的**上游原文**
#                  两者不等 = 有意的本地定制。只记一个 sha 的话，冲突解决后文件仍然
#                  既异于基准线又异于上游，sync 会永远判冲突——没有出口（实现时踩到）。
#
# 用法：
#   harness.sh init    --from <源树>            铺框架 + 生成 harness.json / harness.lock
#   harness.sh status                           版本与漂移概览
#   harness.sh verify  [--from <源树>]          逐文件对账（给了源树才能判「落后于新版」）
#   harness.sh sync    --from <源树> [--dry-run] 升级；本地改过的文件绝不静默覆盖
#   harness.sh resolve --from <源树> <文件>...   冲突已人工合并，把它重新对齐到目标版本
#   harness.sh adopt   --from <源树> [--as <版本>]  存量项目补建 harness.json / harness.lock
#
# `--from` 可以是本地框架仓库路径，也可以省略并配 `--ref <tag|branch|sha>` 从 remote 取。
# 离线可用是硬要求（console-mode.md 红线 5 的同一条精神：不依赖网络与控制台）。

set -euo pipefail

ALL_ARGS=("$@")          # 原样保存，供自我覆盖防护时重新 exec
CMD="${1:-}"; shift || true
SRC=""; REF=""; AS_VERSION=""; DRY_RUN=0
PROJECT="$(pwd)"
FILES=()

while [ $# -gt 0 ]; do
  case "$1" in
    --from)    SRC="$2"; shift 2 ;;
    --ref)     REF="$2"; shift 2 ;;
    --as)      AS_VERSION="$2"; shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -*) echo "[harness] ⛔ 未知参数：$1" >&2; exit 2 ;;
    *) FILES+=("$1"); shift ;;          # resolve 的文件列表
  esac
done

die() { echo "[harness] ⛔ $1" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || die "需要 python3"

# ── 🔴 自我覆盖防护（v1.4.6）────────────────────────────────────────────────
# sync 会更新 `.claude/harness.sh` **自己**，而 bash 是边读边执行的：文件在运行中被替换后，
# 它会按旧的字节偏移继续读新内容。实测表现是 `syntax error near unexpected token`（升级本身
# 已完成，报错发生在收尾阶段）；换一个偏移就可能执行到半条语句，后果不可预期。
# 故：先把自己复制到临时文件再 exec 过去，磁盘上那份随便被覆盖。
if [ "$CMD" = "sync" ] && [ -z "${HARNESS_SELF_EXEC:-}" ]; then
  _self="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  _tmp_self="$(mktemp)"
  cat "$_self" > "$_tmp_self"
  HARNESS_SELF_EXEC=1 exec bash "$_tmp_self" ${ALL_ARGS[@]+"${ALL_ARGS[@]}"}
fi

SNAPSHOT=""
cleanup() {
  [ -n "$SNAPSHOT" ] && rm -rf "$SNAPSHOT"
  # 自我覆盖防护留下的临时副本由它自己收尾（$0 即那份副本）
  [ -n "${HARNESS_SELF_EXEC:-}" ] && rm -f "$0"
  true
}
trap cleanup EXIT

# 源树一律先快照到临时目录再操作。存量项目的源就是自己的 framework/，不快照就会
# 出现「从自己复制到自己」的自噬——init 铺 framework/ 时尤其致命。
resolve_source() {
  [ -n "$SRC" ] || [ -n "$REF" ] || die "缺 --from <源树>（或 --ref <版本> 从 remote 取）"
  SNAPSHOT="$(mktemp -d)"
  if [ -n "$SRC" ]; then
    [ -d "$SRC" ] || die "源树不存在：${SRC}"
    ( cd "$SRC" && tar cf - --exclude .git --exclude .obsidian --exclude .DS_Store . ) | ( cd "$SNAPSHOT" && tar xf - )
  else
    local url
    url="$(python3 -c "
import json,sys
try: print(json.load(open('harness.json'))['framework']['source_url'])
except Exception: print('')" 2>/dev/null)"
    [ -n "$url" ] || die "harness.json 里没有 framework.source_url，无法按 --ref 取源"
    git clone --depth 1 --branch "$REF" "$url" "$SNAPSHOT" >/dev/null 2>&1 \
      || die "拉取失败：${url}@${REF}"
    rm -rf "$SNAPSHOT/.git"
  fi
  [ -d "$SNAPSHOT/harness" ] && [ -d "$SNAPSHOT/templates" ] \
    || die "源树不像框架仓库（缺 harness/ 或 templates/）：${SRC:-$REF}"
}

# ── 清单规则：init 与 sync **共用同一张表**，否则两者迟早对不上 ──────────────
# managed  框架拥有，升级时同步（本地改过则报冲突，绝不静默覆盖）
# seeded   只在 init 铺一次，之后归项目所有，升级永不触碰
PY_MANIFEST=$(cat <<'PY'
import hashlib, json, os, sys

SRC, PROJECT = sys.argv[1], sys.argv[2]

MANAGED_FILES = [
    ("harness/harness-rules.md",          "harness-rules.md"),
    ("harness/planner.md",                "planner.md"),
    ("harness/generator.md",              "generator.md"),
    ("harness/evaluator.md",              "evaluator.md"),
    ("harness/orchestration-patterns.md", "orchestration-patterns.md"),
]
MANAGED_DIRS = [("templates/claude", ".claude")]
# framework/ 是源树的物化镜像：patterns 与三份 mode 文档要在**离线**时读得到，
# 不能指望需要时再去网上取（红线 5 的同一条精神）。
FRAMEWORK_MIRROR = ["harness", "memory", "templates", "patterns", "console", "docs"]
FRAMEWORK_FILES  = ["CHANGELOG.md", "README.md", "VERSION", "bootstrap.sh", "cowork-constraint-design.md"]
SEEDED = [
    ("templates/CLAUDE.md",       "CLAUDE.md"),
    ("templates/AGENTS.md",       "AGENTS.md"),
    ("harness/progress.init.json", "progress.json"),
    ("INIT.md",                   "INIT.md"),
    ("proposed-learnings.md",     "framework/proposed-learnings.md"),
]
SEEDED_DIRS = [("memory", ".auto-memory")]
EXEC_SUFFIX = (".sh", ".py")

def walk(root):
    for base, _dirs, files in os.walk(root):
        for f in sorted(files):
            if f == ".DS_Store":
                continue
            p = os.path.join(base, f)
            yield os.path.relpath(p, root)

def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

def entries():
    managed, seeded = {}, {}
    for src, dst in MANAGED_FILES:
        if os.path.isfile(os.path.join(SRC, src)):
            managed[dst] = src
    for src_dir, dst_dir in MANAGED_DIRS:
        base = os.path.join(SRC, src_dir)
        if os.path.isdir(base):
            for rel in walk(base):
                managed[os.path.join(dst_dir, rel)] = os.path.join(src_dir, rel)
    for d in FRAMEWORK_MIRROR:
        base = os.path.join(SRC, d)
        if os.path.isdir(base):
            for rel in walk(base):
                managed[os.path.join("framework", d, rel)] = os.path.join(d, rel)
    for f in FRAMEWORK_FILES:
        if os.path.isfile(os.path.join(SRC, f)):
            managed[os.path.join("framework", f)] = f
    for src, dst in SEEDED:
        if os.path.isfile(os.path.join(SRC, src)):
            seeded[dst] = src
    for src_dir, dst_dir in SEEDED_DIRS:
        base = os.path.join(SRC, src_dir)
        if os.path.isdir(base):
            for rel in walk(base):
                seeded[os.path.join(dst_dir, rel)] = os.path.join(src_dir, rel)
    # seeded 优先：同一目标路径若两边都产出（如 framework/proposed-learnings.md），归项目所有
    for k in seeded:
        managed.pop(k, None)
    return managed, seeded

def is_exec(path):
    return path.endswith(EXEC_SUFFIX)
PY
)

src_version() {
  if [ -n "$SNAPSHOT" ] && [ -f "$SNAPSHOT/VERSION" ]; then tr -d '\n' < "$SNAPSHOT/VERSION"; else echo -n "unknown"; fi
}
src_commit() {
  if [ -n "$SRC" ] && [ -d "$SRC/.git" ]; then
    ( cd "$SRC" && git rev-parse --short HEAD 2>/dev/null ) || echo "unknown"
  else
    echo "${REF:-unknown}"
  fi
}


# ── 部署触发自检（v1.4.5）────────────────────────────────────────────────────
# 装 harness 会给项目带来一个**持续的副作用**：状态机每推进一个阶段就提交一次
# progress.json。若该项目的 CI 是「push main 即部署」且没有 paths 过滤，那么**每一次
# 状态推进都会重建镜像并部署生产**。tokenizer 与 grandtianfu 都是这形态，都是撞上了才发现
# （joyce 的一次账本提交已经白跑过一次镜像构建）。
# 这里只警告、不代改：改别人的 CI 触发条件是有后果的决定，得由人来做。
check_deploy_trigger() {
  local wf="$PROJECT/.github/workflows"
  [ -d "$wf" ] || return 0
  local hits
  hits="$(python3 - "$wf" <<'PY'
import os, re, sys
d = sys.argv[1]
bad = []
for f in sorted(os.listdir(d)):
    if not f.endswith((".yml", ".yaml")):
        continue
    txt = open(os.path.join(d, f), encoding="utf-8", errors="replace").read()
    head = txt.split("jobs:")[0]
    if not re.search(r"^on:", head, re.M):
        continue
    if "push" not in head or not re.search(r"branches:\s*\[?\s*-?\s*(main|master)", head):
        continue
    if "paths-ignore" in head or re.search(r"^\s+paths:", head, re.M):
        continue          # 有过滤就不吵；是否覆盖 harness 路径由人自己核
    bad.append(f)
print("\n".join(bad))
PY
)"
  [ -n "$hits" ] || return 0
  echo ""
  echo "⚠️  ============ 装 harness 带来的副作用，先看这个 ============"
  echo "以下 workflow 是「push 到 main 即触发」且**没有 paths 过滤**："
  echo "$hits" | sed 's/^/      /'
  echo ""
  echo "harness 的状态机每推进一个阶段就会提交一次 progress.json —— 上面每个 workflow"
  echo "都会因此被触发一次。若其中含部署动作，就是**每次状态推进都部署一次生产**。"
  echo ""
  echo "建议把这些路径加进它们的 paths-ignore（改与不改由你决定，本脚本不代改）："
  for p in ".auto-memory/**" ".claude/**" "framework/**" "progress.json" "features.json" \
           "backlog.json" "harness.json" "harness.lock" "harness-rules.md" "planner.md" \
           "generator.md" "evaluator.md" "orchestration-patterns.md"; do
    echo "      - \"$p\""
  done
  echo "⚠️  =========================================================="
  echo ""
}

# ── init ────────────────────────────────────────────────────────────────────
cmd_init() {
  resolve_source
  [ -f "$PROJECT/harness.lock" ] && die "harness.lock 已存在——这个项目已被框架管理，升级请用 sync"
  python3 - "$SNAPSHOT" "$PROJECT" "$(src_version)" "$(src_commit)" "${SRC:-}" <<PY
$PY_MANIFEST
import shutil, datetime
version, commit, source_path = sys.argv[3], sys.argv[4], sys.argv[5]
managed, seeded = entries()
lock = {"lock_version": 1, "framework": {"version": version, "commit": commit},
        "managed": {}, "seeded": {}}
kept = []
for dst, src in sorted(managed.items()) + sorted(seeded.items()):
    s, d = os.path.join(SRC, src), os.path.join(PROJECT, dst)
    bucket = "managed" if dst in managed else "seeded"
    # 🔴 seeded 是**项目自有内容**（CLAUDE.md / progress.json / 记忆…）。往一个已有项目里
    # 装 harness 时它们可能已经存在且有真内容——覆盖等于毁掉人家的东西。已存在即保留，
    # 只把它记进 lock。managed 则照铺（框架拥有，本来就该是框架的版本）。
    if bucket == "seeded" and os.path.exists(d):
        kept.append(dst)
        lock[bucket][dst] = {"src": src, "sha256": sha(d), "upstream": sha(s)}
        continue
    os.makedirs(os.path.dirname(d), exist_ok=True)
    shutil.copy2(s, d)
    if is_exec(d):
        os.chmod(d, 0o755)
    h = sha(d)
    lock[bucket][dst] = {"src": src, "sha256": h, "upstream": h}   # 刚装上，两者必然相同
json.dump(lock, open(os.path.join(PROJECT, "harness.lock"), "w"), ensure_ascii=False, indent=2)
open(os.path.join(PROJECT, "harness.lock"), "a").write("\n")
cfg = {"framework": {"source": "harness-template", "source_url": "https://github.com/tripplemay/harness-template.git",
                     "version": version, "commit": commit,
                     "installed_from": source_path or "remote"},
       "project": {"name": os.path.basename(os.path.abspath(PROJECT))}}
json.dump(cfg, open(os.path.join(PROJECT, "harness.json"), "w"), ensure_ascii=False, indent=2)
open(os.path.join(PROJECT, "harness.json"), "a").write("\n")
print(f"[harness] ✓ init 完成：框架 v{version} ({commit})，受管 {len(lock['managed'])} 个文件，"
      f"项目自有 {len(lock['seeded'])} 个")
if kept:
    print(f"   ↳ {len(kept)} 个项目自有文件**已存在，保留原样**（未被模板覆盖）：")
    for k in kept[:10]:
        print(f"      {k}")
    if len(kept) > 10:
        print(f"      …… 另 {len(kept)-10} 个")
PY
  scaffold_project
  check_deploy_trigger
}

# 项目骨架：状态机初值、docs 目录、.gitignore。**全部只在缺失时创建**——
# 它们属于项目，不进 lock，sync 永不触碰。
scaffold_project() {
  [ -f "$PROJECT/features.json" ] || printf '{\n  "sprint": null,\n  "features": []\n}\n' > "$PROJECT/features.json"
  [ -f "$PROJECT/backlog.json" ]  || echo "[]" > "$PROJECT/backlog.json"
  mkdir -p "$PROJECT/docs/specs" "$PROJECT/docs/test-cases" "$PROJECT/docs/test-reports/user_report" "$PROJECT/docs/dev"
  for d in specs test-cases test-reports/user_report dev; do touch "$PROJECT/docs/$d/.gitkeep"; done
  if [ ! -f "$PROJECT/.gitignore" ]; then
    cat > "$PROJECT/.gitignore" <<'GITIGNORE'
# Harness agent local identity（本机身份，不入 git）
.agent-id

# Dispatch mode 外部 CLI 沙箱 worktree 与运行日志（瞬态，不入 git）
.harness-dispatch/

# 框架升级时的冲突参考文件（合并完就该删）
*.harness-new

# OS / editor
.DS_Store
*.swp
*.swo
GITIGNORE
  else
    for line in '.agent-id' '.harness-dispatch/' '*.harness-new'; do
      grep -qxF "$line" "$PROJECT/.gitignore" || echo "$line" >> "$PROJECT/.gitignore"
    done
  fi
}

# ── 对账（status / verify 共用）─────────────────────────────────────────────
# 五种状态，缺一都会让升级变成猜谜：
#   ok        与安装时一致，且新版没动
#   modified  你改过（新版也没动 → 保留）
#   outdated  你没改，新版有更新 → sync 会覆盖
#   conflict  你改过 **且** 新版也改了 → sync 拒绝覆盖，交给你决定
#   missing   文件被删了 → sync 补回
cmd_verify() {
  [ -f "$PROJECT/harness.lock" ] || die "没有 harness.lock —— 存量项目请先跑 adopt"
  local snap="none"
  if [ -n "$SRC" ] || [ -n "$REF" ]; then resolve_source; snap="$SNAPSHOT"; fi
  python3 - "${snap}" "$PROJECT" "$(src_version 2>/dev/null || echo unknown)" <<PY
$PY_MANIFEST
new_version = sys.argv[3]
lock = json.load(open(os.path.join(PROJECT, "harness.lock")))
has_src = SRC != "none" and os.path.isdir(SRC)
new_managed = entries()[0] if has_src else {}

buckets = {"ok": [], "modified": [], "outdated": [], "conflict": [], "missing": [], "new": []}
for dst, meta in sorted(lock.get("managed", {}).items()):
    path = os.path.join(PROJECT, dst)
    if not os.path.exists(path):
        buckets["missing"].append(dst); continue
    base = meta["sha256"]; up = meta.get("upstream", base)
    diverged = sha(path) != base or base != up      # 刚改的，或已登记在册的本地定制
    upstream_changed = False
    if has_src and dst in new_managed:
        sp = os.path.join(SRC, new_managed[dst])
        upstream_changed = os.path.isfile(sp) and sha(sp) != up
    if diverged and upstream_changed: buckets["conflict"].append(dst)
    elif diverged:                    buckets["modified"].append(dst)
    elif upstream_changed:            buckets["outdated"].append(dst)
    else:                             buckets["ok"].append(dst)
if has_src:
    for dst in sorted(new_managed):
        if dst not in lock.get("managed", {}):
            buckets["new"].append(dst)

cur = lock.get("framework", {})
print(f"[harness] 当前框架：v{cur.get('version','?')} ({cur.get('commit','?')})"
      + (f"   目标：v{new_version}" if has_src else "   （未给源树，只做本地对账）"))
LABEL = {"ok": "一致", "modified": "本地改过（新版未动，sync 保留）",
         "outdated": "落后于新版（sync 会覆盖）", "conflict": "🔴 冲突：本地改过且新版也改了",
         "missing": "缺失（sync 补回）", "new": "新版新增（sync 铺入）"}
for k in ("conflict", "missing", "outdated", "new", "modified", "ok"):
    items = buckets[k]
    if not items: continue
    if k == "ok":
        print(f"  ok        {len(items)} 个文件与安装时一致"); continue
    print(f"  {k:9} {len(items)} —— {LABEL[k]}")
    for f in items[:12]: print(f"      {f}")
    if len(items) > 12: print(f"      …… 另 {len(items)-12} 个")
sys.exit(2 if buckets["conflict"] else 0)
PY
}

cmd_status() {
  [ -f "$PROJECT/harness.json" ] || die "没有 harness.json —— 存量项目请先跑 adopt"
  python3 -c "
import json
cfg=json.load(open('$PROJECT/harness.json'))['framework']
print(f\"[harness] 框架 v{cfg.get('version')} ({cfg.get('commit')})  来源 {cfg.get('source')}\")"
  cmd_verify
}

# ── sync（升级）──────────────────────────────────────────────────────────────
cmd_sync() {
  resolve_source
  [ -f "$PROJECT/harness.lock" ] || die "没有 harness.lock —— 存量项目请先跑 adopt"
  python3 - "$SNAPSHOT" "$PROJECT" "$(src_version)" "$(src_commit)" "$DRY_RUN" <<PY
$PY_MANIFEST
import shutil
new_version, new_commit, dry = sys.argv[3], sys.argv[4], sys.argv[5] == "1"
lock = json.load(open(os.path.join(PROJECT, "harness.lock")))
managed, seeded = entries()
old = lock.get("managed", {})

updated, kept, conflicts, added = [], [], [], []
for dst, src in sorted(managed.items()):
    sp, dp = os.path.join(SRC, src), os.path.join(PROJECT, dst)
    meta = old.get(dst)
    if meta is None:
        added.append((dst, src, sp, dp)); continue
    if not os.path.exists(dp):
        added.append((dst, src, sp, dp)); continue
    base = meta["sha256"]; up = meta.get("upstream", base)
    diverged = sha(dp) != base or base != up
    upstream_changed = sha(sp) != up
    if diverged and upstream_changed: conflicts.append((dst, sp, dp))
    elif diverged:                    kept.append(dst)
    elif upstream_changed:            updated.append((dst, src, sp, dp))

if conflicts and not dry:
    # fail-closed：宁可整次升级不做，也不留半个版本的框架。
    # 半升级状态最难排查——一半文件是新版语义、一半是旧版，而 lock 会声称升级成功。
    print(f"[harness] ⛔ {len(conflicts)} 个文件冲突（你改过且新版也改了），本次升级**整体未执行**：")
    for dst, sp, dp in conflicts:
        ref = dp + ".harness-new"
        shutil.copy2(sp, ref)
        print(f"      {dst}    新版已放在 {os.path.relpath(ref, PROJECT)}")
    print("   逐个处理后重跑 sync：把你的改动并进去（或删掉本地改动让它被覆盖），再删 .harness-new")
    sys.exit(2)

print(f"[harness] {'（dry-run）' if dry else ''}升级 v{lock['framework'].get('version')} → v{new_version}：")
print(f"   更新 {len(updated)} · 新增 {len(added)} · 保留本地改动 {len(kept)} · 冲突 {len(conflicts)}")
for dst in [d for d, *_ in updated][:10]: print(f"      更新 {dst}")
for dst in [d for d, *_ in added][:10]:   print(f"      新增 {dst}")
for dst in kept[:10]:                     print(f"      保留 {dst}（本地改过，新版未动）")
if dry:
    for dst, sp, dp in conflicts: print(f"      🔴 冲突 {dst}")
    sys.exit(2 if conflicts else 0)

for dst, src, sp, dp in updated + added:
    os.makedirs(os.path.dirname(dp), exist_ok=True)
    shutil.copy2(sp, dp)
    if is_exec(dp): os.chmod(dp, 0o755)
    h = sha(dp)
    old[dst] = {"src": src, "sha256": h, "upstream": h}
# 新版已删除的受管文件：从 lock 摘除，但**不删项目里的文件**——
# 万一它已被项目引用，静默删除比留一个孤儿文件危险得多。
orphans = [d for d in list(old) if d not in managed]
for d in orphans: old.pop(d)
lock["managed"] = old
lock["framework"] = {"version": new_version, "commit": new_commit}
json.dump(lock, open(os.path.join(PROJECT, "harness.lock"), "w"), ensure_ascii=False, indent=2)
open(os.path.join(PROJECT, "harness.lock"), "a").write("\n")
cfg_path = os.path.join(PROJECT, "harness.json")
cfg = json.load(open(cfg_path)) if os.path.exists(cfg_path) else {"framework": {}, "project": {}}
cfg["framework"].update({"version": new_version, "commit": new_commit})
json.dump(cfg, open(cfg_path, "w"), ensure_ascii=False, indent=2)
open(cfg_path, "a").write("\n")
if orphans:
    print(f"   ⚠️ {len(orphans)} 个文件在新版已移除，已移出 lock 但**保留在项目里**（需要你确认后手删）：")
    for d in orphans[:10]: print(f"      {d}")
print(f"[harness] ✓ 已升级到 v{new_version} ({new_commit})")
PY
}

# ── adopt（存量项目补建 lock）────────────────────────────────────────────────
cmd_adopt() {
  resolve_source
  [ -f "$PROJECT/harness.lock" ] && die "harness.lock 已存在，无需 adopt"
  [ -f "$PROJECT/harness-rules.md" ] || die "这里不像 harness 项目（缺 harness-rules.md）"
  python3 - "$SNAPSHOT" "$PROJECT" "${AS_VERSION:-$(src_version)}" "$(src_commit)" <<PY
$PY_MANIFEST
as_version, commit = sys.argv[3], sys.argv[4]
managed, seeded = entries()
lock = {"lock_version": 1, "framework": {"version": as_version, "commit": commit},
        "managed": {}, "seeded": {}}
present, missing, differs = 0, [], []
for dst, src in sorted(managed.items()):
    dp, sp = os.path.join(PROJECT, dst), os.path.join(SRC, src)
    if not os.path.exists(dp):
        missing.append(dst); continue
    present += 1
    # sha256 取**项目现状**、upstream 取**参考版本原文**：两者不等就精确地表达了
    # 「这个文件被本地改过」。若都取现状，下一次 sync 会把你的定制当成「落后」而覆盖；
    # 若都取原文，你的定制又会被当成未提交的意外改动。adopt 的语义是如实记录现状与差异。
    lock["managed"][dst] = {"src": src, "sha256": sha(dp), "upstream": sha(sp)}
    if sha(dp) != sha(sp): differs.append(dst)
for dst, src in sorted(seeded.items()):
    dp = os.path.join(PROJECT, dst)
    if os.path.exists(dp):
        lock["seeded"][dst] = {"src": src, "sha256": sha(dp), "upstream": sha(os.path.join(SRC, src))}
json.dump(lock, open(os.path.join(PROJECT, "harness.lock"), "w"), ensure_ascii=False, indent=2)
open(os.path.join(PROJECT, "harness.lock"), "a").write("\n")
cfg_path = os.path.join(PROJECT, "harness.json")
cfg = {"framework": {"source": "harness-template",
                     "source_url": "https://github.com/tripplemay/harness-template.git",
                     "version": as_version, "commit": commit, "adopted": True},
       "project": {"name": os.path.basename(os.path.abspath(PROJECT))}}
json.dump(cfg, open(cfg_path, "w"), ensure_ascii=False, indent=2)
open(cfg_path, "a").write("\n")
shown = as_version if not as_version[:1].isdigit() else f"v{as_version}"   # 别把 unknown 印成 "vunknown"
print(f"[harness] ✓ adopt 完成：记录为 {shown}，受管 {present} 个文件")
if differs:
    print(f"   与 {shown} 原文不同的有 {len(differs)} 个（本地定制或版本落后，已按现状入基准线）：")
    for d in differs[:15]: print(f"      {d}")
    if len(differs) > 15: print(f"      …… 另 {len(differs)-15} 个")
if missing:
    print(f"   ⚠️ 参考版本有、本项目没有的文件 {len(missing)} 个（sync 时会补入）：")
    for d in missing[:10]: print(f"      {d}")
PY
  check_deploy_trigger
}

# ── resolve（冲突已人工合并）──────────────────────────────────────────────────
# 冲突的出口。把该文件重新对齐到目标版本：sha256 = 你合并后的内容，upstream = 新版原文。
# 于是下次 sync 既不会覆盖你的合并结果，也不会再把它判成冲突——直到上游**又**改了它。
cmd_resolve() {
  resolve_source
  [ -f "$PROJECT/harness.lock" ] || die "没有 harness.lock"
  [ ${#FILES[@]} -gt 0 ] || die "缺文件参数：harness.sh resolve --from <源树> <文件>..."
  python3 - "$SNAPSHOT" "$PROJECT" "${FILES[@]}" <<PY
$PY_MANIFEST
files = sys.argv[3:]
lock_path = os.path.join(PROJECT, "harness.lock")
lock = json.load(open(lock_path))
managed = entries()[0]
for f in files:
    rel = os.path.relpath(os.path.abspath(f), os.path.abspath(PROJECT))
    meta = lock.get("managed", {}).get(rel)
    if meta is None: print(f"[harness] ⛔ 不是受管文件：{rel}"); sys.exit(2)
    dp = os.path.join(PROJECT, rel)
    if not os.path.exists(dp): print(f"[harness] ⛔ 文件不存在：{rel}"); sys.exit(2)
    if rel not in managed: print(f"[harness] ⛔ 目标版本里没有这个文件：{rel}"); sys.exit(2)
    meta["sha256"] = sha(dp)
    meta["upstream"] = sha(os.path.join(SRC, managed[rel]))
    print(f"[harness] ✓ 已对齐：{rel}"
          + ("（内容与新版一致）" if meta["sha256"] == meta["upstream"] else "（保留为本地定制）"))
json.dump(lock, open(lock_path, "w"), ensure_ascii=False, indent=2)
open(lock_path, "a").write("\n")
print("[harness] 重跑 sync 继续升级")
PY
}

case "$CMD" in
  init)    cmd_init ;;
  status)  cmd_status ;;
  verify)  cmd_verify ;;
  sync)    cmd_sync ;;
  resolve) cmd_resolve ;;
  adopt)   cmd_adopt ;;
  *) echo "用法: harness.sh {init|status|verify|sync|resolve|adopt} [--from <源树>] [--ref <版本>] [--as <版本>] [--dry-run]" >&2; exit 2 ;;
esac
