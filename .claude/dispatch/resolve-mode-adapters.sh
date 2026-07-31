#!/usr/bin/env bash
# Resolve the adapter directory owned by an active v2 mode checkpoint.
#
# A mode intent names tools and invocations, while adapters are project-local
# implementation details.  When a caller explicitly supplies a custom adapter
# directory at consumption time, persist only a checked, repository-relative
# directory.  Every active entrypoint then resolves the same directory here.

set -euo pipefail

PROGRESS="progress.json"
DEFAULT_ADAPTERS=""
EXPLICIT_ADAPTERS=""
PERSIST=false

die() { echo "[mode-adapters] ⛔ $1" >&2; exit 2; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --progress) [ "$#" -ge 2 ] || die "--progress 缺值"; PROGRESS="$2"; shift 2 ;;
    --default) [ "$#" -ge 2 ] || die "--default 缺值"; DEFAULT_ADAPTERS="$2"; shift 2 ;;
    --adapters) [ "$#" -ge 2 ] || die "--adapters 缺值"; EXPLICIT_ADAPTERS="$2"; shift 2 ;;
    --persist) PERSIST=true; shift ;;
    -h|--help)
      echo "usage: resolve-mode-adapters.sh --progress progress.json --default adapters-dir [--adapters adapters-dir] [--persist]" >&2
      exit 0
      ;;
    *) die "未知参数：$1" ;;
  esac
done

[ -f "$PROGRESS" ] || die "progress 不存在：$PROGRESS"
if [ "$PERSIST" = false ]; then
  [ -n "$DEFAULT_ADAPTERS" ] || die "必须提供 --default"
else
  [ -n "$EXPLICIT_ADAPTERS" ] || die "--persist 必须提供 --adapters"
fi

python3 - "$PROGRESS" "$DEFAULT_ADAPTERS" "$EXPLICIT_ADAPTERS" "$PERSIST" <<'PY'
import json
import os
import re
import stat
import subprocess
import sys


progress_path, default_adapters, explicit_adapters, persist_raw = sys.argv[1:5]
persist = persist_raw == "true"
CONTROL = re.compile(r"[\x00-\x1f\x7f]")
SEGMENT = re.compile(r"[A-Za-z0-9._-]+\Z")


def fail(message):
    print(f"[mode-adapters] ⛔ {message}", file=sys.stderr)
    raise SystemExit(2)


def no_duplicates(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f"重复 JSON 键 {key!r}")
        value[key] = item
    return value


def load_progress():
    try:
        with open(progress_path, encoding="utf-8") as stream:
            value = json.load(stream, object_pairs_hook=no_duplicates)
    except (OSError, ValueError) as exc:
        fail(f"progress JSON 非法：{exc}")
    if not isinstance(value, dict):
        fail("progress 根节点必须是 object")
    return value


def project_root():
    try:
        root = subprocess.check_output(
            ["git", "-C", os.path.dirname(os.path.abspath(progress_path)), "rev-parse", "--show-toplevel"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError) as exc:
        fail(f"无法从 progress 所在目录确定 git 项目根：{exc}")
    root = os.path.realpath(root)
    if not os.path.isdir(root):
        fail("git 项目根不是目录")
    return root


def safe_relative(value):
    if not isinstance(value, str) or not value or os.path.isabs(value) or "\\" in value:
        fail("mode_intent.adapter_dir 必须是非空项目内相对路径")
    if CONTROL.search(value):
        fail("mode_intent.adapter_dir 不得包含控制字符")
    parts = value.split("/")
    if any(part in ("", ".", "..") or not SEGMENT.fullmatch(part) for part in parts):
        fail("mode_intent.adapter_dir 包含非法路径段")
    return parts


def inside(root, path):
    try:
        return os.path.commonpath((root, path)) == root
    except ValueError:
        return False


def existing_owned_directory(root, relative):
    parts = safe_relative(relative)
    current = root
    for part in parts:
        current = os.path.join(current, part)
        try:
            mode = os.lstat(current).st_mode
        except OSError as exc:
            fail(f"mode_intent.adapter_dir 不可访问：{exc}")
        if stat.S_ISLNK(mode):
            fail("mode_intent.adapter_dir 不得穿过符号链接")
    resolved = os.path.realpath(current)
    if not inside(root, resolved) or not os.path.isdir(resolved):
        fail("mode_intent.adapter_dir 必须解析为项目内目录")
    return resolved


def explicit_owned_directory(root, raw):
    if not raw:
        fail("--persist 必须提供 --adapters")
    candidate = os.path.realpath(raw)
    if not os.path.isdir(candidate):
        fail(f"adapter 目录不存在：{raw}")
    if not inside(root, candidate) or candidate == root:
        fail("自定义 adapter 目录必须位于项目根内")
    relative = os.path.relpath(candidate, root)
    resolved = existing_owned_directory(root, relative)
    if resolved != candidate:
        fail("自定义 adapter 目录解析不一致")
    return relative


progress = load_progress()
if persist:
    print(explicit_owned_directory(project_root(), explicit_adapters))
    raise SystemExit(0)

mode = progress.get("mode_intent")
persisted = None
if isinstance(mode, dict) and "adapter_dir" in mode:
    if "signed_intent" not in mode or "resolution" not in mode:
        fail("mode_intent.adapter_dir 只能用于 active v2 checkpoint")
    persisted = mode.get("adapter_dir")
    root = project_root()
    resolved = existing_owned_directory(root, persisted)
    if explicit_adapters:
        supplied = os.path.realpath(explicit_adapters)
        if supplied != resolved:
            fail("显式 --adapters 与 active mode checkpoint 不一致")
    print(resolved)
    raise SystemExit(0)

selected = explicit_adapters or default_adapters
if not selected or not os.path.isdir(selected):
    fail(f"adapter 目录不存在：{selected}")
print(os.path.realpath(selected))
PY
