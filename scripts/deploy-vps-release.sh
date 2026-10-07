#!/usr/bin/env bash
set -euo pipefail

expected="${EXPECTED_SHA:-}"
if [[ ! "$expected" =~ ^[0-9a-f]{40}$ ]]; then
  echo "EXPECTED_SHA must be a 40-character lowercase commit SHA" >&2
  exit 2
fi
if [[ ! -f .env ]] || ! grep -Fxq "GIT_COMMIT=$expected" .env; then
  echo "deployment .env commit does not match EXPECTED_SHA" >&2
  exit 1
fi
for required in '^ADMIN_TOKEN=.{32,}$' '^AUTH_SECRET=.{32,}$' '^AUTH_RESEND_KEY=.+$' '^NEXT_PUBLIC_APP_URL=https://[^[:space:]]+$' '^POSTGRES_PASSWORD=[A-Za-z0-9._~-]+$'; do
  if ! grep -Eq "$required" .env; then
    echo "deployment .env is missing a required production setting" >&2
    exit 1
  fi
done
# Shell variables outrank Compose's .env. Use only the reviewed file, not
# ambient SSH/session overrides that could make the app and database disagree.
unset GIT_COMMIT POSTGRES_PASSWORD ADMIN_TOKEN NEXT_PUBLIC_APP_URL APP_HOST_PORT \
  AUTH_SECRET AUTH_TRUST_HOST AUTH_URL AUTH_RESEND_KEY AUTH_EMAIL_FROM \
  HARNESS_CONSOLE_SIGNING_KEY PRICING_AUTO_ENABLED LITELLM_PRICES_URL \
  OPENROUTER_MODELS_URL PRICING_LLM_BASE_URL PRICING_LLM_KEY PRICING_LLM_MODEL
docker compose config --quiet

# The build is still on the VPS in this slice. SHA-tagged images, revision
# labels, and checked image IDs make re-build drift visible and retain the old
# image for an operator-controlled app rollback. This is not DB rollback.
app_image="tokenizer-app:$expected"
migrate_image="tokenizer-migrate:$expected"
mkdir -p .releases
chmod 700 .releases
manifest=".releases/$expected.manifest"
if [[ ! -e "$manifest" ]]; then
  docker compose build
fi
app_id="$(bash scripts/verify-release-image.sh "$app_image" "$expected")"
migrate_id="$(bash scripts/verify-release-image.sh "$migrate_image" "$expected")"
record="$(printf 'commit=%s\napp_image=%s\napp_id=%s\nmigrate_image=%s\nmigrate_id=%s' \
  "$expected" "$app_image" "$app_id" "$migrate_image" "$migrate_id")"
if [[ -e "$manifest" ]]; then
  if [[ "$(cat "$manifest")" != "$record" ]]; then
    echo "release image IDs changed for an existing commit; refusing mutable rebuild" >&2
    exit 1
  fi
else
  (umask 077; printf '%s\n' "$record" > "$manifest")
fi

previous_container="$(docker compose ps -q app)"
if [[ -n "$previous_container" ]]; then
  previous_id="$(docker inspect --format '{{.Image}}' "$previous_container")"
  if [[ "$previous_id" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    (umask 077; printf '%s\n' "$previous_id" > ".releases/$expected.previous-app-id")
  fi
fi

docker compose up -d postgres
docker compose run --rm migrate
docker compose up --no-deps -d app

for _ in {1..15}; do
  if response="$(curl -fsS --max-time 3 http://127.0.0.1:3010/api/health)" &&
     [[ "$response" == *'"ok":true'* && "$response" == *'"code":"ready"'* && "$response" == *"\"commit\":\"$expected\""* ]]; then
    (umask 077; printf 'commit=%s\napp_id=%s\n' "$expected" "$app_id" > ".releases/$expected.activated")
    echo "readiness and expected commit confirmed: $expected"
    exit 0
  fi
  sleep 2
done

echo "readiness or commit check failed after 30s; image rollback requires schema compatibility review" >&2
exit 1
