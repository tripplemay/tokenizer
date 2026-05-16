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
REPO_URL="https://github.com/tripplemay/tokenizer.git"
INSTALL_DIR="$HOME/.tokenizer/app"
BIN_DIR="$HOME/.local/bin"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --server-url) SERVER_URL="$2"; shift 2 ;;
    --enroll-token) ENROLL_TOKEN="$2"; shift 2 ;;
    --device-name) DEVICE_NAME="$2"; shift 2 ;;
    --project-root) PROJECT_ROOT="$2"; shift 2 ;;
    --heartbeat-seconds) HEARTBEAT_SECONDS="$2"; shift 2 ;;
    --sync-minutes) SYNC_MINUTES="$2"; shift 2 ;;
    --no-service) INSTALL_SERVICE="0"; shift ;;
    --yes) YES="1"; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$ENROLL_TOKEN" ]; then
  echo "Missing enrollment token. Use --enroll-token <token>." >&2
  exit 1
fi

log() { printf '[tokenizer] %s\n' "$*"; }

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

ensure_node
ensure_git

log "Installing Tokenizer client to $INSTALL_DIR"
mkdir -p "$HOME/.tokenizer" "$BIN_DIR"
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
init_args=()
if [ -n "$DEVICE_NAME" ]; then init_args+=(--device-name "$DEVICE_NAME"); fi
tokenizer init "${init_args[@]}"
tokenizer configure --server-url "$SERVER_URL" --project-root "$PROJECT_ROOT"

enroll_args=(--enroll-token "$ENROLL_TOKEN" --server-url "$SERVER_URL")
if [ -n "$DEVICE_NAME" ]; then enroll_args+=(--device-name "$DEVICE_NAME"); fi
if [ "$YES" = "1" ]; then enroll_args+=(--yes); fi
tokenizer enroll "${enroll_args[@]}"

if [ "$INSTALL_SERVICE" = "1" ]; then
  tokenizer install-service --heartbeat-seconds "$HEARTBEAT_SECONDS" --sync-minutes "$SYNC_MINUTES"
fi

tokenizer run || true
log "Tokenizer installed. Run: tokenizer status"
