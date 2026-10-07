#!/usr/bin/env bash
set -euo pipefail

if [ "$(uname -s)" != "Linux" ]; then
  echo "Linux is required" >&2
  exit 1
fi
if [ "${B04_NATIVE_CONFIRM:-}" != "1" ]; then
  echo "Set B04_NATIVE_CONFIRM=1; this test temporarily owns ~/.tokenizer and tokenizer-agent.service" >&2
  exit 1
fi
if [ -e "$HOME/.tokenizer" ]; then
  echo "Refusing to replace an existing $HOME/.tokenizer" >&2
  exit 1
fi

root="$(pwd)"
work="$(mktemp -d /tmp/tokenizer-b04-native.XXXXXXXX)"
repo="$work/repo"
server_root="$work/server"
installer="$work/install.sh"
port="${B04_NATIVE_PORT:-18764}"
server_pid=""

cleanup() {
  set +e
  if [ -x "$HOME/.local/bin/tokenizer" ]; then
    "$HOME/.local/bin/tokenizer" uninstall-service >/dev/null 2>&1
  fi
  systemctl --user disable --now tokenizer-agent.service >/dev/null 2>&1
  rm -f "$HOME/.config/systemd/user/tokenizer-agent.service"
  systemctl --user daemon-reload >/dev/null 2>&1
  if [ -n "$server_pid" ]; then kill "$server_pid" >/dev/null 2>&1; fi
  rm -rf "$HOME/.tokenizer" "$HOME/.local/bin/tokenizer" "$work"
}
trap cleanup EXIT

mkdir -p "$repo" "$server_root/api/agent" "$HOME/.tokenizer" "$work/projects"
cp -a "$root/." "$repo/"
rm -rf "$repo/.git" "$repo/node_modules"
git -C "$repo" init -q
git -C "$repo" config user.name "B04 native evaluator"
git -C "$repo" config user.email "b04-evaluator@example.invalid"
git -C "$repo" add -A
git -C "$repo" commit -qm "candidate A"
first="$(git -C "$repo" rev-parse HEAD)"
printf 'candidate B\n' > "$repo/B04_NATIVE_REVISION"
git -C "$repo" add B04_NATIVE_REVISION
git -C "$repo" commit -qm "candidate B"
second="$(git -C "$repo" rev-parse HEAD)"

cp "$root/public/install.sh" "$installer"
python3 - "$installer" "$repo" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
path.write_text(path.read_text().replace("https://github.com/tripplemay/tokenizer.git", sys.argv[2]))
PY
chmod +x "$installer"

write_manifest() {
  local commit="$1" tmp="$server_root/api/agent/releases.new"
  printf '{"schema_version":1,"release":{"version":"1.4.0","commit":"%s","repository":"%s"}}\n' "$commit" "$repo" > "$tmp"
  mv "$tmp" "$server_root/api/agent/releases"
}

write_manifest "$first"
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$server_root" >"$work/http.log" 2>&1 &
server_pid="$!"
sleep 1

printf '{"deviceToken":"credential-canary"}\n' > "$HOME/.tokenizer/credentials.json"
printf '%s\n' '{"source":"codex","sourceEventId":"queue-canary","occurredAt":"2026-10-07T00:00:00.000Z","inputTokens":1,"outputTokens":1}' > "$HOME/.tokenizer/queue.jsonl"

"$installer" --server-url "http://127.0.0.1:$port" --project-root "$work/projects" --yes
test "$(git -C "$HOME/.tokenizer/app" rev-parse HEAD)" = "$first"
test "$(systemctl --user is-active tokenizer-agent.service)" = "active"

write_manifest "$second"
"$installer" --server-url "http://127.0.0.1:$port" --project-root "$work/projects" --yes
test "$(git -C "$HOME/.tokenizer/app" rev-parse HEAD)" = "$second"
test "$(systemctl --user is-active tokenizer-agent.service)" = "active"
grep -q credential-canary "$HOME/.tokenizer/credentials.json"
grep -q queue-canary "$HOME/.tokenizer/queue.jsonl"

kill "$server_pid"
wait "$server_pid" 2>/dev/null || true
server_pid=""
"$installer" --rollback --yes
test "$(git -C "$HOME/.tokenizer/app" rev-parse HEAD)" = "$first"
test "$(systemctl --user is-active tokenizer-agent.service)" = "active"
grep -q credential-canary "$HOME/.tokenizer/credentials.json"
grep -q queue-canary "$HOME/.tokenizer/queue.jsonl"

systemctl --user kill --signal=KILL tokenizer-agent.service
sleep 12
test "$(systemctl --user is-active tokenizer-agent.service)" = "active"

echo "B04 Linux native systemd install/upgrade/offline-rollback/restart: PASS"
