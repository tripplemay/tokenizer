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
REPO_URL="https://github.com/tripplemay/tokenizer.git"
INSTALL_DIR="$HOME/.tokenizer/app"
BIN_DIR="$HOME/.local/bin"
CREDENTIALS_FILE="$HOME/.tokenizer/credentials.json"

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
  [[ "$command" =~ (^|[[:space:]])agent([[:space:]]|$) ]] || return 1
  [[ "$command" == *"$INSTALL_DIR/src/cli/index.ts"* ||
     "$command" == *"$INSTALL_DIR/bin/tokenizer"* ||
     "$command" == *"$BIN_DIR/tokenizer"* ]]
}

agent_pids() {
  # BSD ps truncates command lines to the terminal width unless -ww is given.
  # The Agent argument is after a long absolute install path on macOS.
  ps -axww -o pid= -o command= 2>/dev/null | awk -v install_dir="$INSTALL_DIR" -v bin_dir="$BIN_DIR" '
    {
      command = $0
      is_agent = command ~ /(^|[[:space:]])agent([[:space:]]|$)/
      is_own_wrapper = index(command, install_dir "/bin/tokenizer") || index(command, bin_dir "/tokenizer")
      is_own_child = index(command, install_dir "/src/cli/index.ts")
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
  [ -n "$pids" ] || return

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

if [ "$NEED_ENROLL" = "1" ] && [ -z "$ENROLL_TOKEN" ]; then
  if [ -f "$CREDENTIALS_FILE" ]; then
    echo "--force-enroll requested but no --enroll-token supplied." >&2
  else
    echo "Missing enrollment token. Use --enroll-token <token> (generate one in the dashboard)." >&2
  fi
  exit 1
fi

if [ "$NEED_ENROLL" = "0" ] && [ -n "$ENROLL_TOKEN" ]; then
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
    if [ "$major" -ge 20 ]; then return; fi
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

ensure_node
ensure_git
ensure_build_tools

log "Installing Tokenizer client to $INSTALL_DIR"
mkdir -p "$HOME/.tokenizer" "$BIN_DIR"
# Stop the old service and both of its process layers before replacing the
# checkout. `pkill -f "tokenizer agent"` only hit the wrapper, leaving the
# real Node daemon alive and able to overwrite current diagnostics later.
stop_existing_service
stop_existing_agents
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" fetch --prune origin
  git -C "$INSTALL_DIR" checkout --force origin/main
else
  rm -rf "$INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
npm ci
chmod +x bin/tokenizer
ln -sfn "$INSTALL_DIR/bin/tokenizer" "$BIN_DIR/tokenizer"

export PATH="$BIN_DIR:$PATH"
# macOS ships bash 3.2, where expanding an empty array via "${arr[@]}" under
# `set -u` triggers "unbound variable". Branch on DEVICE_NAME instead of
# accumulating optional flags into an array.
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

mkdir -p "$HOME/.tokenizer/logs"

if [ "$INSTALL_SERVICE" = "1" ]; then
  tokenizer install-service --heartbeat-seconds "$HEARTBEAT_SECONDS" --sync-minutes "$SYNC_MINUTES"
  # install-service may have fallen through to the cron backend (no daemon)
  # on hosts without launchd or user-systemd — common on WSL2. Give the
  # service manager a beat to spawn the daemon, then start one ourselves
  # if nothing is running so heartbeat + quota refresh keep ticking.
  sleep 1
  if [ -z "$(agent_pids || true)" ]; then
    log "Daemon not detected after install-service; starting via nohup..."
    nohup tokenizer agent --heartbeat-seconds "$HEARTBEAT_SECONDS" --sync-minutes "$SYNC_MINUTES" >"$HOME/.tokenizer/logs/agent.log" 2>&1 &
    disown 2>/dev/null || true
  fi
fi

tokenizer run || true
log "Tokenizer installed. Run: tokenizer status"
