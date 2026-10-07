#!/usr/bin/env bash
set -euo pipefail
expected="${EXPECTED_SHA:-}"
[[ "$expected" =~ ^[0-9a-f]{40}$ ]] || { echo "EXPECTED_SHA must be a lowercase commit SHA" >&2; exit 2; }
if [[ ! -f .env ]] || ! grep -Fxq "GIT_COMMIT=$expected" .env; then echo "deployment commit mismatch" >&2; exit 1; fi
for required in '^ADMIN_TOKEN=.{32,}$' '^AUTH_SECRET=.{32,}$' '^AUTH_RESEND_KEY=.+$' '^NEXT_PUBLIC_APP_URL=https://[^[:space:]]+$' '^POSTGRES_PASSWORD=[A-Za-z0-9._~-]+$'; do
  grep -Eq "$required" .env || { echo "missing production setting" >&2; exit 1; }
done
read_setting() { sed -n "s/^$1=//p" "$2"; }
for key in ADMIN_TOKEN AUTH_SECRET AUTH_RESEND_KEY; do
  value="$(read_setting "$key" .env)"
  if [[ "$value" =~ [[:space:]] || "$value" == *'$'* || "$value" == *"'"* || "$value" == *'"'* || "$value" == *$'\\'* || "$value" == change-me || "$value" == dev-placeholder-set-AUTH_SECRET-in-production ]]; then
    echo "unsafe production setting: $key" >&2; exit 1
  fi
done
valid_image() { [[ "$1" =~ ^[a-z0-9][a-z0-9./:_-]+@sha256:[0-9a-f]{64}$ ]]; }
app_image="$(read_setting APP_IMAGE .env)"
migrate_image="$(read_setting MIGRATE_IMAGE .env)"
if ! valid_image "$app_image" || ! valid_image "$migrate_image"; then echo "OCI digest-pinned images required" >&2; exit 1; fi
unset GIT_COMMIT POSTGRES_PASSWORD ADMIN_TOKEN NEXT_PUBLIC_APP_URL APP_HOST_PORT APP_IMAGE MIGRATE_IMAGE \
  AUTH_SECRET AUTH_TRUST_HOST AUTH_URL AUTH_RESEND_KEY AUTH_EMAIL_FROM \
  HARNESS_CONSOLE_SIGNING_KEY PRICING_AUTO_ENABLED LITELLM_PRICES_URL \
  OPENROUTER_MODELS_URL PRICING_LLM_BASE_URL PRICING_LLM_KEY PRICING_LLM_MODEL
compose=(docker compose -f docker-compose.yml -f docker-compose.release.yml)
"${compose[@]}" config --quiet
mkdir -p .releases
chmod 700 .releases
umask 077
manifest=".releases/$expected.manifest"
record="$(printf 'commit=%s\napp_image=%s\nmigrate_image=%s' "$expected" "$app_image" "$migrate_image")"
if [[ -e "$manifest" && "$(cat "$manifest")" != "$record" ]]; then
  echo "immutable release digest changed for existing commit" >&2; exit 1
fi
printf '%s\n' "$record" > "$manifest"
previous=".releases/$expected.previous-env"
previous_container="$("${compose[@]}" ps -q app)"
if [[ -n "$previous_container" ]]; then
  if [[ ! -f "$previous" ]] || ! valid_image "$(read_setting APP_IMAGE "$previous")" || ! valid_image "$(read_setting MIGRATE_IMAGE "$previous")"; then
    echo "previous digest-pinned release configuration required before replacement" >&2; exit 1
  fi
  previous_ref="$(read_setting APP_IMAGE "$previous")"
  old_id="$(docker image inspect --format '{{.Id}}' "$previous_ref")"
  [[ "$(docker inspect --format '{{.Image}}' "$previous_container")" == "$old_id" ]] || {
    echo "previous running image does not match retained digest" >&2; exit 1;
  }
fi
docker pull "$app_image"
docker pull "$migrate_image"
app_id="$(bash scripts/verify-release-image.sh "$app_image" "$expected")"
bash scripts/verify-release-image.sh "$migrate_image" "$expected" >/dev/null
"${compose[@]}" up -d postgres
# Only disposable containers see the restored DB; the live DB is not restored.
REHEARSAL_MODE=live EXPECTED_SHA="$expected" APP_IMAGE="$app_image" MIGRATE_IMAGE="$migrate_image" \
  PREVIOUS_ENV="$previous" bash scripts/test/rehearse-release.sh
"${compose[@]}" run --rm migrate
started=0
# shellcheck disable=SC2329
contain() {
  status=$?
  trap - EXIT
  if (( status != 0 && started == 1 )); then
    "${compose[@]}" stop app || { echo "failed app containment failed" >&2; exit 2; }
    echo "failed new app stopped; no automatic DB restore" >&2
    if [[ -f ".releases/$expected.rollback-approved" && -f "$previous" ]] && \
       grep -Fxq "app_image=$(read_setting APP_IMAGE "$previous")" ".releases/$expected.rollback-approved"; then
      docker compose --env-file "$previous" -f docker-compose.yml -f docker-compose.release.yml up --no-deps -d app
      old_sha="$(read_setting GIT_COMMIT "$previous")"
      for _ in {1..15}; do
        response="$(curl -fsS --max-time 3 http://127.0.0.1:3010/api/health || true)"
        if [[ "$response" == *'"ok":true'* && "$response" == *"\"commit\":\"$old_sha\""* ]]; then
          printf 'commit=%s\n' "$old_sha" > ".releases/$expected.rolled-back"
          echo "previous digest restored after failed readiness" >&2
          exit "$status"
        fi
        sleep 2
      done
      docker compose --env-file "$previous" -f docker-compose.yml -f docker-compose.release.yml stop app
      echo "rollback readiness failed; app remains stopped" >&2
    fi
  fi
  exit "$status"
}
trap contain EXIT
started=1
"${compose[@]}" up --no-deps -d app
for _ in {1..15}; do
  if response="$(curl -fsS --max-time 3 http://127.0.0.1:3010/api/health)" &&
     [[ "$response" == *'"ok":true'* && "$response" == *'"code":"ready"'* && "$response" == *"\"commit\":\"$expected\""* ]]; then
    printf 'commit=%s\napp_image=%s\napp_id=%s\n' "$expected" "$app_image" "$app_id" > ".releases/$expected.activated"
    echo "readiness and expected commit confirmed: $expected"
    exit 0
  fi
  sleep 2
done
echo "readiness or commit check failed" >&2
exit 1
