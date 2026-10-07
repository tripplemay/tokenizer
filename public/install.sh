#!/usr/bin/env bash
set -euo pipefail

SERVER_URL="${TOKENIZER_SERVER_URL:-https://token.vpanel.cc}"
ENROLL_TOKEN="${TOKENIZER_ENROLL_TOKEN:-}"
DEVICE_NAME="${TOKENIZER_DEVICE_NAME:-}"
PROJECT_ROOT="${TOKENIZER_PROJECT_ROOT:-$HOME/project}"
HEARTBEAT_SECONDS="${TOKENIZER_HEARTBEAT_SECONDS:-60}"
SYNC_MINUTES="${TOKENIZER_SYNC_MINUTES:-15}"
INSTALL_SERVICE="1"
YES="0"
FORCE_ENROLL="0"
ROLLBACK="0"
REPO_URL="https://github.com/tripplemay/tokenizer.git"
TOKENIZER_HOME="$HOME/.tokenizer"
INSTALL_DIR="$TOKENIZER_HOME/app"
RELEASES_DIR="$TOKENIZER_HOME/releases"
PREVIOUS_LINK="$TOKENIZER_HOME/previous"
BIN_DIR="$HOME/.local/bin"
CREDENTIALS_FILE="$TOKENIZER_HOME/credentials.json"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --server-url) SERVER_URL="$2"; shift 2 ;;
    --enroll-token) ENROLL_TOKEN="$2"; shift 2 ;;
    --device-name) DEVICE_NAME="$2"; shift 2 ;;
    --project-root) PROJECT_ROOT="$2"; shift 2 ;;
    --heartbeat-seconds) HEARTBEAT_SECONDS="$2"; shift 2 ;;
    --sync-minutes) SYNC_MINUTES="$2"; shift 2 ;;
    --no-service) INSTALL_SERVICE="0"; shift ;;
    --force-enroll) FORCE_ENROLL="1"; shift ;;
    --rollback) ROLLBACK="1"; shift ;;
    --yes) YES="1"; shift ;;
    -h|--help)
      cat <<'USAGE'
Usage: install.sh [options]

Options:
  --server-url <url>          Tokenizer server (default: https://token.vpanel.cc)
  --enroll-token <token>      One-time enrollment token. Required for first install;
                              ignored on re-install unless --force-enroll is set.
  --device-name <name>        Human-readable device name
  --project-root <path>       Project root directory (default: $HOME/project)
  --heartbeat-seconds <n>     Agent heartbeat interval (default: 60)
  --sync-minutes <n>          Agent collect/sync interval (default: 15)
  --no-service                Skip installing the background service
  --force-enroll              Re-enroll even if credentials already exist
                              (rotates deviceToken and revokes the previous
                              token for this device)
  --rollback                  Restore the previous installed release
  --yes                       Use the detected device name without prompting
  -h, --help                  Show this help
USAGE
      exit 0
      ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

log() { printf '[tokenizer] %s\n' "$*"; }

# The CLI wrapper and its Node child have different command lines. Match both
# forms against this install's directories so an upgrade never kills an
# unrelated command that merely happens to contain "agent".
agent_command_matches() {
  local command="$1"
  local release_dir="${INSTALL_DIR%/app}/releases"
  [[ "$command" =~ (^|[[:space:]])agent([[:space:]]|$) ]] || return 1
  [[ "$command" == *"$INSTALL_DIR/src/cli/index.ts"* ||
     "$command" == *"$INSTALL_DIR/bin/tokenizer"* ||
     "$command" == *"$release_dir/"*"/src/cli/index.ts"* ||
     "$command" == *"$release_dir/"*"/bin/tokenizer"* ||
     "$command" == *"$BIN_DIR/tokenizer"* ]]
}

agent_pids() {
  # BSD ps truncates command lines to the terminal width unless -ww is given.
  # The Agent argument is after a long absolute install path on macOS.
  ps -axww -o pid= -o command= 2>/dev/null | awk -v install_dir="$INSTALL_DIR" -v release_dir="${INSTALL_DIR%/app}/releases/" -v bin_dir="$BIN_DIR" '
    {
      command = $0
      is_agent = command ~ /(^|[[:space:]])agent([[:space:]]|$)/
      is_own_wrapper = index(command, install_dir "/bin/tokenizer") || index(command, bin_dir "/tokenizer") || (index(command, release_dir) && index(command, "/bin/tokenizer"))
      is_own_child = index(command, install_dir "/src/cli/index.ts") || (index(command, release_dir) && index(command, "/src/cli/index.ts"))
      if (is_agent && (is_own_wrapper || is_own_child)) print $1
    }
  '
}

agent_pid_matches() {
  local pid="$1"
  [ "$pid" != "$$" ] || return 1
  local command
  command="$(ps -ww -p "$pid" -o command= 2>/dev/null || true)"
  agent_command_matches "$command"
}

stop_existing_service() {
  # Disable the service before stopping children. launchd/systemd may restart
  # a just-killed old wrapper otherwise, recreating the version race while the
  # checkout is being updated.
  if [ -x "$BIN_DIR/tokenizer" ]; then
    "$BIN_DIR/tokenizer" uninstall-service >/dev/null 2>&1 || true
  fi
}

stop_existing_agents() {
  local pids pid attempts
  pids="$(agent_pids || true)"
  [ -n "$pids" ] || return 0

  for pid in $pids; do
    if agent_pid_matches "$pid"; then
      log "Stopping existing agent (pid $pid)"
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done

  attempts=0
  while [ "$attempts" -lt 10 ]; do
    pids="$(agent_pids || true)"
    [ -z "$pids" ] && return
    attempts=$((attempts + 1))
    sleep 1
  done

  # A pre-signal-forwarding wrapper can die while leaving its child orphaned.
  # Re-check every PID immediately before the bounded last-resort kill so PID
  # reuse cannot target a process outside this install.
  for pid in $pids; do
    if agent_pid_matches "$pid"; then
      log "Force-stopping unresponsive agent (pid $pid)"
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
  sleep 1
  pids="$(agent_pids || true)"
  if [ -n "$pids" ]; then
    echo "Could not stop the existing Tokenizer agent: $pids" >&2
    exit 1
  fi
}

# Decide whether enrollment is needed BEFORE doing any installation work so we
# fail fast if the caller asked for a fresh install without a token.
NEED_ENROLL="0"
if [ "$FORCE_ENROLL" = "1" ]; then
  NEED_ENROLL="1"
  if [ -f "$CREDENTIALS_FILE" ]; then
    log "--force-enroll set; existing credentials at $CREDENTIALS_FILE will be replaced."
  fi
elif [ ! -f "$CREDENTIALS_FILE" ]; then
  NEED_ENROLL="1"
fi

if [ "$ROLLBACK" = "1" ] && [ "$FORCE_ENROLL" = "1" ]; then
  echo "--rollback and --force-enroll cannot be combined." >&2
  exit 1
fi

if [ "$ROLLBACK" = "0" ] && [ "$NEED_ENROLL" = "1" ] && [ -z "$ENROLL_TOKEN" ]; then
  if [ -f "$CREDENTIALS_FILE" ]; then
    echo "--force-enroll requested but no --enroll-token supplied." >&2
  else
    echo "Missing enrollment token. Use --enroll-token <token> (generate one in the dashboard)." >&2
  fi
  exit 1
fi

if [ "$ROLLBACK" = "0" ] && [ "$NEED_ENROLL" = "0" ] && [ -n "$ENROLL_TOKEN" ]; then
  log "Existing credentials detected; ignoring --enroll-token. Pass --force-enroll to rotate the deviceToken."
  ENROLL_TOKEN=""
fi

is_wsl() { grep -qi microsoft /proc/version 2>/dev/null; }

install_homebrew() {
  if command -v brew >/dev/null 2>&1; then return; fi
  log "Installing Homebrew..."
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [ -x /opt/homebrew/bin/brew ]; then eval "$(/opt/homebrew/bin/brew shellenv)"; fi
  if [ -x /usr/local/bin/brew ]; then eval "$(/usr/local/bin/brew shellenv)"; fi
}

ensure_node() {
  if command -v node >/dev/null 2>&1; then
    major="$(node -v | sed 's/^v//' | cut -d. -f1)"
    if [ "$major" -ge 22 ]; then return; fi
  fi

  case "$(uname -s)" in
    Darwin)
      install_homebrew
      log "Installing Node.js with Homebrew..."
      brew install node@22 || brew install node
      if [ -d /opt/homebrew/opt/node@22/bin ]; then export PATH="/opt/homebrew/opt/node@22/bin:$PATH"; fi
      if [ -d /usr/local/opt/node@22/bin ]; then export PATH="/usr/local/opt/node@22/bin:$PATH"; fi
      ;;
    Linux)
      log "Installing Node.js 22 with NodeSource..."
      curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
      sudo apt-get install -y nodejs git
      ;;
    *)
      echo "Unsupported OS: $(uname -s)" >&2
      exit 1
      ;;
  esac
}

ensure_git() {
  if command -v git >/dev/null 2>&1; then return; fi
  case "$(uname -s)" in
    Darwin) install_homebrew; brew install git ;;
    Linux) sudo apt-get update && sudo apt-get install -y git ;;
  esac
}

# better-sqlite3 ships prebuilds for many Node/platform combos, but on WSL2 the
# libc detection can come back empty and prebuild-install falls back to
# node-gyp build-from-source. That needs make/g++/python3 on the box. macOS
# users already have these through Xcode CLT (a brew install requirement).
ensure_build_tools() {
  case "$(uname -s)" in
    Linux)
      if command -v make >/dev/null 2>&1 && command -v g++ >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then return; fi
      log "Installing build tools (build-essential, python3) for native npm modules..."
      sudo apt-get update
      sudo apt-get install -y build-essential python3
      ;;
  esac
}

atomic_link() {
  local target="$1" link="$2" temporary="${2}.new.$$"
  ln -s "$target" "$temporary"
  # rename(2) replaces a symlink atomically on macOS and Linux. `mv` can
  # follow a symlink to a directory, so it cannot be used for this switch.
  node -e 'require("node:fs").renameSync(process.argv[1], process.argv[2])' "$temporary" "$link"
}

STAGE_DIR=""
OLD_TARGET=""
HAD_OLD="0"
CUTOVER_STARTED="0"
COMMITTED="0"
cleanup() {
  local status="$?"
  trap - EXIT
  set +e
  if [ "$CUTOVER_STARTED" = "1" ] && [ "$COMMITTED" != "1" ]; then
    log "Upgrade failed; restoring the previous Agent. Credentials and queue were not deleted."
    if [ -L "$INSTALL_DIR" ]; then rm -f "$INSTALL_DIR"; fi
    if [ "$HAD_OLD" = "1" ]; then
      if [ -d "$OLD_TARGET" ]; then
        if [ "$OLD_TARGET" = "$INSTALL_DIR" ]; then
          log "Previous checkout is already in place."
        elif [ "$OLD_TARGET" = "$RELEASES_DIR"/legacy-* ]; then
          mv "$OLD_TARGET" "$INSTALL_DIR"
        else
          atomic_link "$OLD_TARGET" "$INSTALL_DIR"
        fi
      elif [ -d "$INSTALL_DIR/.git" ]; then
        log "Previous physical checkout is still in place."
      else
        log "Previous checkout missing at $OLD_TARGET; manual recovery required."
      fi
      if [ "$INSTALL_SERVICE" = "1" ] && [ -x "$BIN_DIR/tokenizer" ]; then
        "$BIN_DIR/tokenizer" install-service --heartbeat-seconds "$HEARTBEAT_SECONDS" --sync-minutes "$SYNC_MINUTES" || log "Old service restart failed; run tokenizer install-service manually."
      fi
    fi
  fi
  if [ -n "$STAGE_DIR" ] && [ -d "$STAGE_DIR" ]; then rm -rf "$STAGE_DIR"; fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

ensure_node
mkdir -p "$TOKENIZER_HOME" "$RELEASES_DIR" "$BIN_DIR" "$TOKENIZER_HOME/logs"
export PATH="$BIN_DIR:$PATH"

if [ "$ROLLBACK" = "1" ]; then
  if [ ! -L "$INSTALL_DIR" ] || [ ! -L "$PREVIOUS_LINK" ]; then
    echo "No previous release available for rollback." >&2
    exit 1
  fi
  OLD_TARGET="$(node -e 'process.stdout.write(require("node:fs").realpathSync(process.argv[1]))' "$INSTALL_DIR")"
  ROLLBACK_TARGET="$(node -e 'process.stdout.write(require("node:fs").realpathSync(process.argv[1]))' "$PREVIOUS_LINK")"
  [ -d "$ROLLBACK_TARGET/.git" ] || { echo "Previous release is not a Git checkout." >&2; exit 1; }
  (cd "$ROLLBACK_TARGET" && node --import tsx src/cli/index.ts --help >/dev/null)
  HAD_OLD="1"
  CUTOVER_STARTED="1"
  stop_existing_service
  stop_existing_agents
  atomic_link "$ROLLBACK_TARGET" "$INSTALL_DIR"
  if [ "$INSTALL_SERVICE" = "1" ]; then
    "$BIN_DIR/tokenizer" install-service --heartbeat-seconds "$HEARTBEAT_SECONDS" --sync-minutes "$SYNC_MINUTES"
  fi
  atomic_link "$OLD_TARGET" "$PREVIOUS_LINK"
  COMMITTED="1"
  log "Rolled back to $(git -C "$INSTALL_DIR" rev-parse HEAD)."
  exit 0
fi

ensure_git
ensure_build_tools

# An old server, offline host, or invalid manifest must not fall back to main.
# Fetch and verify everything while the old service is still running.
SERVER_URL="${SERVER_URL%/}"
node -e '
  const url = new URL(process.argv[1]);
  if (url.username || url.password ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new Error("Agent release manifest requires HTTPS (except loopback testing)");
  }
' "$SERVER_URL"
manifest="$(curl -fsSL --max-time 15 "$SERVER_URL/api/agent/releases")" || {
  echo "Cannot obtain the pinned Agent release; existing installation was not changed." >&2
  exit 1
}
pin="$(printf '%s' "$manifest" | node -e '
  let input = "";
  process.stdin.on("data", chunk => input += chunk);
  process.stdin.on("end", () => {
    const body = JSON.parse(input);
    const release = body?.release;
    if (body?.schema_version !== 1 || !release ||
        !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(release.version) ||
        !/^[0-9a-f]{40}$/.test(release.commit) ||
        release.repository !== "https://github.com/tripplemay/tokenizer.git") {
      throw new Error("invalid Agent release manifest");
    }
    process.stdout.write(`${release.version} ${release.commit}`);
  });
')" || { echo "Invalid Agent release manifest; existing installation was not changed." >&2; exit 1; }
read -r PIN_VERSION PIN_COMMIT <<< "$pin"
log "Preparing Agent $PIN_VERSION ($PIN_COMMIT) in staging"
STAGE_DIR="$(mktemp -d "$TOKENIZER_HOME/.stage.XXXXXXXX")"
git -C "$STAGE_DIR" init -q
git -C "$STAGE_DIR" remote add origin "$REPO_URL"
git -C "$STAGE_DIR" fetch --no-tags --depth=1 origin "$PIN_COMMIT"
git -C "$STAGE_DIR" checkout --detach --force "$PIN_COMMIT"
ACTUAL_COMMIT="$(git -C "$STAGE_DIR" rev-parse --verify HEAD)"
if [ "$ACTUAL_COMMIT" != "$PIN_COMMIT" ]; then
  echo "Agent commit digest mismatch; existing installation was not changed." >&2
  exit 1
fi
(cd "$STAGE_DIR" && npm ci && node --import tsx src/cli/index.ts --help >/dev/null)
chmod +x "$STAGE_DIR/bin/tokenizer"
RELEASE_DIR="$RELEASES_DIR/$PIN_COMMIT-$$"
mv "$STAGE_DIR" "$RELEASE_DIR"
STAGE_DIR=""

if [ -L "$INSTALL_DIR" ]; then
  OLD_TARGET="$(node -e 'process.stdout.write(require("node:fs").realpathSync(process.argv[1]))' "$INSTALL_DIR")"
  HAD_OLD="1"
elif [ -e "$INSTALL_DIR" ]; then
  [ -d "$INSTALL_DIR/.git" ] || { echo "Existing app path is not a Git checkout; refusing to replace it." >&2; exit 1; }
  OLD_TARGET="$RELEASES_DIR/legacy-$(date +%s)-$$"
  HAD_OLD="1"
fi

CUTOVER_STARTED="1"
stop_existing_service
stop_existing_agents
if [ "$HAD_OLD" = "1" ] && [ ! -L "$INSTALL_DIR" ]; then
  mv "$INSTALL_DIR" "$OLD_TARGET"
fi
atomic_link "$RELEASE_DIR" "$INSTALL_DIR"
ln -sfn "$INSTALL_DIR/bin/tokenizer" "$BIN_DIR/tokenizer"

# Shared config, credentials, queue, and cursor live outside releases. Do not
# re-enroll on an ordinary upgrade; --force-enroll remains an explicit action.
if [ -n "$DEVICE_NAME" ]; then
  tokenizer init --device-name "$DEVICE_NAME"
else
  tokenizer init
fi
tokenizer configure --server-url "$SERVER_URL" --project-root "$PROJECT_ROOT"
if [ "$NEED_ENROLL" = "1" ]; then
  enroll_args=(--enroll-token "$ENROLL_TOKEN" --server-url "$SERVER_URL")
  if [ -n "$DEVICE_NAME" ]; then enroll_args+=(--device-name "$DEVICE_NAME"); fi
  if [ "$YES" = "1" ]; then enroll_args+=(--yes); fi
  tokenizer enroll "${enroll_args[@]}"
else
  log "Re-using existing credentials at $CREDENTIALS_FILE."
fi

if [ "$INSTALL_SERVICE" = "1" ]; then
  tokenizer install-service --heartbeat-seconds "$HEARTBEAT_SECONDS" --sync-minutes "$SYNC_MINUTES"
  sleep 1
  if [ -z "$(agent_pids || true)" ]; then
    log "Daemon not detected after install-service; starting via nohup..."
    nohup tokenizer agent --heartbeat-seconds "$HEARTBEAT_SECONDS" --sync-minutes "$SYNC_MINUTES" >"$TOKENIZER_HOME/logs/agent.log" 2>&1 &
    disown 2>/dev/null || true
  fi
fi
if [ "$HAD_OLD" = "1" ]; then atomic_link "$OLD_TARGET" "$PREVIOUS_LINK"; fi
COMMITTED="1"
tokenizer run || true
log "Tokenizer Agent $PIN_VERSION installed at $PIN_COMMIT. Run: tokenizer status"
