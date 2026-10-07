#!/usr/bin/env bash
set -euo pipefail
umask 077
expected="${EXPECTED_SHA:-}"
[[ "$expected" =~ ^[0-9a-f]{40}$ ]] || { echo "rehearsal commit required" >&2; exit 2; }
valid_image() { [[ "$1" =~ ^[a-z0-9][a-z0-9./:_-]+@sha256:[0-9a-f]{64}$ ]]; }
if ! valid_image "${APP_IMAGE:-}" || ! valid_image "${MIGRATE_IMAGE:-}"; then echo "rehearsal needs digest-pinned images" >&2; exit 2; fi
mode="${REHEARSAL_MODE:-synthetic}"
[[ "$mode" == live || "$mode" == synthetic ]] || exit 2
previous_app="${PREVIOUS_APP_IMAGE:-}"
previous_migrate="${PREVIOUS_MIGRATE_IMAGE:-}"
previous_sha="${PREVIOUS_SHA:-}"
if [[ "$mode" == live && -f "${PREVIOUS_ENV:-}" ]]; then
  previous_app="$(sed -n 's/^APP_IMAGE=//p' "$PREVIOUS_ENV")"
  previous_migrate="$(sed -n 's/^MIGRATE_IMAGE=//p' "$PREVIOUS_ENV")"
  previous_sha="$(sed -n 's/^GIT_COMMIT=//p' "$PREVIOUS_ENV")"
fi
if [[ -n "$previous_app" ]]; then
  valid_image "$previous_app" && valid_image "$previous_migrate" && [[ "$previous_sha" =~ ^[0-9a-f]{40}$ ]] || exit 2
fi
prefix="tokenizer-rehearsal-$$-$RANDOM"
network="$prefix-net"
db="$prefix-db"
source_db="$prefix-source"
app="$prefix-app"
mkdir -p .releases
chmod 700 .releases
gate=".releases/$expected.rollback-approved"
rm -f "$gate"
dump=".releases/$expected.$prefix.backup.dump"
temp_dump="$dump.tmp"
started="$(date +%s)"
cleanup() {
  status=$?
  trap - EXIT
  docker rm -fv "$app" "$db" "$source_db" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -f "$temp_dump"
  exit "$status"
}
trap cleanup EXIT
docker network create --internal "$network" >/dev/null
start_db() {
  docker run -d --name "$1" --network "$network" \
    -e POSTGRES_PASSWORD=rehearsal-only-password -e POSTGRES_USER=tokenizer -e POSTGRES_DB=tokenizer postgres:16-alpine >/dev/null
  for _ in {1..30}; do
    if docker exec "$1" pg_isready -U tokenizer -d tokenizer >/dev/null 2>&1; then return; fi
    sleep 1
  done
  echo "scratch PostgreSQL did not start" >&2; exit 1
}
db_url() { printf 'postgresql://tokenizer:rehearsal-only-password@%s:5432/tokenizer' "$1"; }
migrate() {
  docker run --rm --network "$network" -e DATABASE_URL="$(db_url "$2")" "$1" ./node_modules/.bin/prisma migrate deploy
}
inventory() {
  docker exec "$1" psql -U tokenizer -d tokenizer -At -v ON_ERROR_STOP=1 -c \
    'SELECT (SELECT count(*) FROM "User"), (SELECT count(*) FROM "Device"), (SELECT count(*) FROM "Project"), (SELECT count(*) FROM "UsageEvent"), (SELECT COALESCE(sum("totalTokens"),0) FROM "UsageEvent");'
}
start_app() {
  image="$1"; revision="$2"; database="$3"
  docker rm -f "$app" >/dev/null 2>&1 || true
  docker run -d --name "$app" --network "$network" -e DATABASE_URL="$(db_url "$database")" \
    -e GIT_COMMIT="$revision" -e HOSTNAME=0.0.0.0 -e AUTH_TRUST_HOST=true \
    -e AUTH_URL="http://$app:3000" -e NEXT_PUBLIC_APP_URL="http://$app:3000" \
    -e AUTH_SECRET=synthetic-auth-secret-at-least-thirty-two-chars \
    -e ADMIN_TOKEN=synthetic-admin-token-at-least-thirty-two-chars -e AUTH_RESEND_KEY=re_synthetic \
    -e AUTH_EMAIL_FROM=release-canary@example.test \
    -e PRICING_AUTO_ENABLED=0 "$image" >/dev/null
  for _ in {1..60}; do
    if docker exec "$app" node -e "fetch('http://127.0.0.1:3000/api/health').then(async r=>{let b=await r.json();process.exit(r.ok&&b.ok&&b.commit==='$revision'?0:1)}).catch(()=>process.exit(1))" >/dev/null 2>&1; then return; fi
    sleep 1
  done
  echo "rehearsal app readiness failed" >&2; exit 1
}
canary() {
  docker run --rm --network "$network" -e DATABASE_URL="$(db_url "$1")" \
    -e CANARY_URL="http://$app:3000" -e CANARY_KEEP="${2:-0}" \
    -v "$PWD/scripts/test:/app/scripts/test:ro" "$MIGRATE_IMAGE" ./node_modules/.bin/tsx scripts/test/release-canary.ts
}
if [[ "$mode" == live ]]; then
  docker compose -f docker-compose.yml -f docker-compose.release.yml exec -T postgres \
    pg_dump -U tokenizer -d tokenizer -Fc --no-owner > "$temp_dump"
else
  if ! valid_image "$previous_app" || ! valid_image "$previous_migrate"; then echo "synthetic rehearsal requires previous images" >&2; exit 2; fi
  start_db "$source_db"
  migrate "$previous_migrate" "$source_db"
  start_app "$previous_app" "$previous_sha" "$source_db"
  canary "$source_db" 1
  source_inventory="$(inventory "$source_db")"
  docker exec "$source_db" pg_dump -U tokenizer -d tokenizer -Fc --no-owner > "$temp_dump"
fi
[[ -s "$temp_dump" ]] || { echo "empty PostgreSQL backup" >&2; exit 1; }
mv "$temp_dump" "$dump"
sha256sum "$dump" > "$dump.sha256"
sha256sum -c "$dump.sha256" >/dev/null
start_db "$db"
docker exec -i "$db" pg_restore -U tokenizer -d tokenizer --exit-on-error --no-owner < "$dump"
restored_inventory="$(inventory "$db")"
if [[ "$mode" == synthetic && "$source_inventory" != "$restored_inventory" ]]; then
  echo "restored inventory differs from synthetic backup source" >&2; exit 1
fi
migrate "$MIGRATE_IMAGE" "$db"
[[ "$(inventory "$db")" == "$restored_inventory" ]] || { echo "migration changed critical row/token inventory" >&2; exit 1; }
uid="$(docker run --rm --entrypoint id "$APP_IMAGE" -u)"
[[ "$uid" =~ ^[0-9]+$ && "$uid" != 0 ]] || { echo "app runtime must be non-root" >&2; exit 1; }
bash scripts/verify-release-image.sh "$APP_IMAGE" "$expected" >/dev/null
bash scripts/verify-release-image.sh "$MIGRATE_IMAGE" "$expected" >/dev/null
start_app "$APP_IMAGE" "$expected" "$db"
canary "$db"
[[ "$(inventory "$db")" == "$restored_inventory" ]] || { echo "candidate canary cleanup changed inventory" >&2; exit 1; }
rollback=unavailable
if [[ -n "$previous_app" ]]; then
  docker pull "$previous_app" >/dev/null
  bash scripts/verify-release-image.sh "$previous_app" "$previous_sha" >/dev/null
  start_app "$previous_app" "$previous_sha" "$db"
  canary "$db"
  [[ "$(inventory "$db")" == "$restored_inventory" ]] || { echo "rollback canary cleanup changed inventory" >&2; exit 1; }
  printf 'app_image=%s\nprevious_sha=%s\n' "$previous_app" "$previous_sha" > "$gate"
  rollback=passed
fi
printf 'commit=%s\nmode=%s\nbackup_file=%s\nrestore_inventory=%s\nruntime_uid=%s\nrollback=%s\nelapsed_seconds=%s\n' \
  "$expected" "$mode" "$dump" "$restored_inventory" "$uid" "$rollback" "$(( $(date +%s) - started ))" > ".releases/$expected.rehearsal"
echo "backup/restore, exact migrations, runtime UID, and business canary completed; rollback=$rollback"
