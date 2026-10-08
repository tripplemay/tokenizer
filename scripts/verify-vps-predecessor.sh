#!/usr/bin/env bash
set -euo pipefail

fail() { echo "production predecessor preflight: $1" >&2; exit 1; }
valid_sha() { [[ "$1" =~ ^[0-9a-f]{40}$ ]]; }
valid_image() { [[ "$1" =~ ^[a-z0-9][a-z0-9./:_-]+@sha256:[0-9a-f]{64}$ ]]; }
read_one() {
  local count
  count="$(grep -c "^$1=" "$2" || true)"
  [[ "$count" == 1 ]] || fail "missing or duplicate $1 in predecessor configuration"
  sed -n "s/^$1=//p" "$2"
}
regular_file() { [[ -f "$1" && ! -L "$1" ]]; }

mode="${1:-}"
candidate_sha="${2:-}"
candidate_app="${3:-}"
candidate_migrate="${4:-}"
[[ "$mode" == live || "$mode" == retained ]] || fail "expected live or retained mode"
valid_sha "$candidate_sha" || fail "invalid candidate SHA"
if ! valid_image "$candidate_app" || ! valid_image "$candidate_migrate"; then
  fail "candidate images must be digest-pinned"
fi
command -v jq >/dev/null || fail "jq is required on the VPS"
[[ -d .releases && ! -L .releases ]] || fail "release ledger directory is missing"

if [[ "$mode" == live ]]; then
  baseline=.env
  retained=".releases/$candidate_sha.previous-env"
  regular_file "$baseline" || fail "current production environment is missing"
  if grep -q '^COMPOSE_PROJECT_NAME=' "$baseline"; then
    fail "candidate workflow does not preserve an explicit Compose project override"
  fi
  if [[ -e "$retained" || -L "$retained" ]]; then
    if ! regular_file "$retained" || ! cmp -s "$baseline" "$retained"; then
      fail "candidate previous-env does not match the current baseline"
    fi
  fi
else
  baseline=".releases/$candidate_sha.previous-env"
  regular_file "$baseline" || fail "retained predecessor environment is missing"
fi

old_sha="$(read_one GIT_COMMIT "$baseline")"
old_app="$(read_one APP_IMAGE "$baseline")"
old_migrate="$(read_one MIGRATE_IMAGE "$baseline")"
host_port="$(read_one APP_HOST_PORT "$baseline")"
valid_sha "$old_sha" && [[ "$old_sha" != "$candidate_sha" ]] || fail "distinct predecessor SHA required"
if ! valid_image "$old_app" || ! valid_image "$old_migrate"; then
  fail "predecessor images must be digest-pinned"
fi
[[ "$host_port" == 127.0.0.1:3010 ]] || fail "unexpected predecessor host port"

old_manifest=".releases/$old_sha.manifest"
old_activated=".releases/$old_sha.activated"
if ! regular_file "$old_manifest" || ! regular_file "$old_activated"; then
  fail "activated predecessor ledger is missing"
fi
printf 'commit=%s\napp_image=%s\nmigrate_image=%s\n' "$old_sha" "$old_app" "$old_migrate" |
  cmp -s - "$old_manifest" || fail "predecessor manifest differs from the running configuration"

old_id="$(docker image inspect --format '{{.Id}}' "$old_app")" || fail "predecessor image is unavailable"
[[ "$old_id" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "invalid predecessor image ID"
printf 'commit=%s\napp_image=%s\napp_id=%s\n' "$old_sha" "$old_app" "$old_id" |
  cmp -s - "$old_activated" || fail "predecessor activation ledger differs from the image"

candidate_manifest=".releases/$candidate_sha.manifest"
if [[ -e "$candidate_manifest" || -L "$candidate_manifest" ]]; then
  regular_file "$candidate_manifest" || fail "candidate manifest is not a regular file"
  printf 'commit=%s\napp_image=%s\nmigrate_image=%s\n' "$candidate_sha" "$candidate_app" "$candidate_migrate" |
    cmp -s - "$candidate_manifest" || fail "immutable candidate manifest differs"
fi

# Shell variables override Compose --env-file values, so use only the retained
# baseline when resolving the project and service before any candidate mutation.
unset COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_PROFILES DOCKER_HOST DOCKER_CONTEXT \
  APP_IMAGE MIGRATE_IMAGE GIT_COMMIT APP_HOST_PORT POSTGRES_PASSWORD
compose=(docker compose --env-file "$baseline" -f docker-compose.yml -f docker-compose.release.yml)
"${compose[@]}" config --quiet || fail "predecessor Compose configuration is invalid"
project="$("${compose[@]}" config --format json | jq -er '.name | select(type == "string" and test("^[a-z0-9][a-z0-9_-]*$"))')" ||
  fail "cannot resolve predecessor Compose project"
container="$("${compose[@]}" ps -q app)" || fail "cannot inspect Compose app service"
[[ "$container" =~ ^[0-9a-f]{12,64}$ ]] || fail "exactly one running Compose app is required"
if [[ "$mode" == retained ]]; then
  regular_file .env || fail "candidate environment is missing"
  [[ "$(read_one APP_HOST_PORT .env)" == 127.0.0.1:3010 ]] || fail "candidate backend port differs"
  candidate_compose=(docker compose --env-file .env -f docker-compose.yml -f docker-compose.release.yml)
  "${candidate_compose[@]}" config --quiet || fail "candidate Compose configuration is invalid"
  candidate_project="$("${candidate_compose[@]}" config --format json | jq -er '.name')" ||
    fail "cannot resolve candidate Compose project"
  [[ "$candidate_project" == "$project" && "$("${candidate_compose[@]}" ps -q app)" == "$container" ]] ||
    fail "candidate Compose project does not select the running app"
fi
details="$(docker inspect --format '{{.State.Running}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{.Image}}' "$container")" ||
  fail "cannot inspect running predecessor container"
[[ "$details" == "true|$project|app|$old_id" ]] || fail "running app identity, project, service, or image differs"
[[ "$(docker port "$container" 3000/tcp)" == 127.0.0.1:3010 ]] || fail "running app is not bound to the production backend"
health="$(curl -fsS --max-time 3 http://127.0.0.1:3010/api/health)" || fail "running app readiness is unavailable"
printf '%s' "$health" | jq -e --arg sha "$old_sha" '.ok == true and ((has("code") | not) or .code == "ready") and .commit == $sha' >/dev/null ||
  fail "production backend does not report the activated predecessor"
printf 'production predecessor preflight passed: project=%s commit=%s\n' "$project" "$old_sha"
