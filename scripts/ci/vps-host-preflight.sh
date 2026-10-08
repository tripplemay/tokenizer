#!/usr/bin/env bash
set +x
exec 2>/dev/null
set -euo pipefail

# Only query subprocesses are bounded/killed; no container or service is signalled.
query() {
  local value
  value="$(timeout --signal=KILL 5s "$@" 2>/dev/null | head -c 16385)" || return 1
  [[ ${#value} -le 16384 ]] || return 1
  printf '%s' "$value"
}
valid_sha() { [[ "$1" =~ ^[0-9a-f]{40}$ ]]; }
valid_id() { [[ "$1" =~ ^[0-9a-f]{12,64}$ ]]; }
valid_digest() { [[ "$1" =~ ^sha256:[0-9a-f]{64}$ ]]; }
valid_image() { [[ "$1" =~ ^[a-z0-9][a-z0-9./:_-]{1,240}(@sha256:[0-9a-f]{64})?$ ]]; }
regular() { [[ -f "$1" && ! -L "$1" ]]; }

source_sha="${2:-unknown}"
timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
outcome=refused reason=invalid_input baseline=unknown platform=unknown free_kib=unknown
docker_version=unknown compose_version=unknown commit=unknown app_image=unknown migrate_image=unknown host_port=unknown
app_id=unknown app_status=unknown app_health=unknown app_image_id=unknown revision=unknown image_user=unknown uid=unknown
postgres_id=unknown postgres_status=unknown postgres_health=unknown postgres_image_id=unknown
app_network=unknown postgres_network=unknown postgres_volume=unknown
network_driver=unknown volume_driver=unknown
files='{}'
compose_probe_status=not_run compose_pipeline_exit_status=null compose_captured_bytes=null compose_home_present=false
if [[ ${HOME+x} == x ]]; then compose_home_present=true; fi

emit() {
  if ! command -v jq >/dev/null; then
    printf '{"schema_version":1,"operation":"host-preflight","outcome":"refused","reason":"missing_tools"}\n'
    return
  fi
  jq -n --arg source "$source_sha" --arg timestamp "$timestamp" --arg outcome "$outcome" --arg reason "$reason" \
    --arg baseline "$baseline" --arg platform "$platform" --arg free "$free_kib" \
    --arg docker "$docker_version" --arg compose "$compose_version" \
    --arg probe_status "$compose_probe_status" --argjson pipeline_status "$compose_pipeline_exit_status" \
    --argjson captured_bytes "$compose_captured_bytes" --argjson home_present "$compose_home_present" \
    --arg commit "$commit" --arg app_image "$app_image" --arg migrate_image "$migrate_image" --arg host_port "$host_port" \
    --arg app_id "$app_id" --arg app_status "$app_status" --arg app_health "$app_health" --arg app_image_id "$app_image_id" \
    --arg revision "$revision" --arg image_user "$image_user" --arg uid "$uid" --arg app_network "$app_network" \
    --arg postgres_id "$postgres_id" --arg postgres_status "$postgres_status" --arg postgres_health "$postgres_health" \
    --arg postgres_image_id "$postgres_image_id" --arg postgres_network "$postgres_network" --arg postgres_volume "$postgres_volume" \
    --arg network_driver "$network_driver" --arg volume_driver "$volume_driver" --argjson files "$files" \
    '{schema_version:1,operation:"host-preflight",source_sha:$source,timestamp:$timestamp,outcome:$outcome,reason:$reason,
      project:"tokenizer",baseline:$baseline,platform:$platform,free_kib:$free,
      versions:{docker:$docker,compose:$compose},
      compose_probe:{status:$probe_status,pipeline_exit_status:$pipeline_status,captured_bytes:$captured_bytes,home_present:$home_present},
      settings:{GIT_COMMIT:$commit,APP_IMAGE:$app_image,MIGRATE_IMAGE:$migrate_image,APP_HOST_PORT:$host_port},
      app:{id:$app_id,status:$app_status,health:$app_health,image_id:$app_image_id,revision:$revision,user:$image_user,uid:$uid,port:$host_port,network:$app_network},
      postgres:{id:$postgres_id,status:$postgres_status,health:$postgres_health,image_id:$postgres_image_id,network:$postgres_network,volume:$postgres_volume},
      storage:{network:"tokenizer_default",network_driver:$network_driver,volume:"tokenizer_postgres-data",volume_driver:$volume_driver},files:$files}'
}
fail() { reason="$1"; emit; exit 1; }

deploy_path="${1:-}"
if [[ $# != 2 || ! "$deploy_path" =~ ^/[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*$ ||
      "$deploy_path" == */../* || "$deploy_path" == */./* || "$deploy_path" == */.. || "$deploy_path" == */. ||
      ${#deploy_path} -gt 256 ]] || ! valid_sha "$source_sha"; then
  source_sha=unknown
  fail invalid_input
fi
for tool in timeout jq docker curl sha256sum stat head; do command -v "$tool" >/dev/null || fail missing_tools; done
[[ -d "$deploy_path" && ! -L "$deploy_path" ]] || fail invalid_path
cd "$deploy_path" || fail invalid_path
[[ "$(pwd -P)" == "$deploy_path" ]] || fail invalid_path

# Ambient shell overrides must not redirect Docker or the loopback health query.
unset DOCKER_HOST DOCKER_CONTEXT DOCKER_TLS_VERIFY DOCKER_CERT_PATH DOCKER_CONFIG \
  COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_PROFILES COMPOSE_ENV_FILES \
  APP_IMAGE MIGRATE_IMAGE GIT_COMMIT APP_HOST_PORT POSTGRES_PASSWORD \
  HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy

os="$(query uname -s)" || fail platform_unavailable
arch="$(query uname -m)" || fail platform_unavailable
[[ "$os" == Linux && "$arch" =~ ^(x86_64|aarch64|arm64)$ ]] || fail unsupported_platform
platform="$os/$arch"
value="$(query df -Pk -- "$deploy_path")" || fail space_unavailable
value="$(printf '%s\n' "$value" | awk 'END {print $4}')"
[[ "$value" =~ ^[0-9]{1,16}$ ]] || fail space_unavailable
free_kib="$value"
value="$(query docker version --format '{{.Server.Version}}')" || fail docker_unavailable
[[ "$value" =~ ^[0-9]+\.[0-9]+\.[0-9]+([a-zA-Z0-9.+-]{0,32})?$ ]] || fail docker_unavailable
docker_version="$value"
compose_pipeline_exit_status=0
value="$(timeout --signal=KILL 5s docker compose version --short 2>/dev/null | head -c 16385)" || compose_pipeline_exit_status=$?
# Count the retained shell string in bytes, not emitted output or locale characters.
compose_captured_bytes="$(LC_ALL=C; printf '%s' "${#value}")"
if (( compose_captured_bytes > 16384 )); then compose_probe_status=output_bound_exceeded; fail compose_unavailable; fi
if (( compose_pipeline_exit_status != 0 )); then compose_probe_status=command_failed; fail compose_unavailable; fi
if ! [[ "$value" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+([a-zA-Z0-9.+-]{0,32})?$ ]]; then
  compose_probe_status=invalid_version
  fail compose_unavailable
fi
compose_probe_status=ok
compose_version="$value"

metadata() {
  local key="$1" path="$2" size mode hash
  if [[ ! -e "$path" && ! -L "$path" ]]; then
    files="$(jq -c --arg key "$key" '. + {($key):{sha256:"missing",mode:"missing"}}' <<< "$files")"
    return
  fi
  regular "$path" || fail unsafe_config_file
  size="$(query stat -c %s -- "$path")" || fail file_metadata_unavailable
  [[ "$size" =~ ^[0-9]{1,7}$ ]] && (( size <= 1048576 )) || fail oversized_config_file
  mode="$(query stat -c %a -- "$path")" || fail file_metadata_unavailable
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] || fail file_metadata_unavailable
  hash="$(query sha256sum -- "$path")" || fail file_metadata_unavailable
  hash="${hash%% *}"
  [[ "$hash" =~ ^[0-9a-f]{64}$ ]] || fail file_metadata_unavailable
  files="$(jq -c --arg key "$key" --arg mode "$mode" --arg hash "$hash" '. + {($key):{sha256:$hash,mode:$mode}}' <<< "$files")"
}
metadata env .env
metadata compose docker-compose.yml
metadata release_compose docker-compose.release.yml
if [[ -e .releases || -L .releases ]]; then
  [[ -d .releases && ! -L .releases ]] || fail unsafe_release_directory
  value="$(query stat -c %a -- .releases)" || fail file_metadata_unavailable
  [[ "$value" =~ ^[0-7]{3,4}$ ]] || fail file_metadata_unavailable
  files="$(jq -c --arg mode "$value" '. + {releases:{sha256:"directory",mode:$mode}}' <<< "$files")"
else
  files="$(jq -c '. + {releases:{sha256:"missing",mode:"missing"}}' <<< "$files")"
fi
if regular .env; then
  for key in GIT_COMMIT APP_IMAGE MIGRATE_IMAGE APP_HOST_PORT; do
    count="$(grep -c "^$key=" .env || true)"
    [[ "$count" == 0 || "$count" == 1 ]] || fail duplicate_setting
    [[ "$count" == 1 ]] || continue
    value="$(sed -n "s/^$key=//p" .env)"
    case "$key" in
      GIT_COMMIT) valid_sha "$value" || fail invalid_setting; commit="$value" ;;
      APP_IMAGE) valid_image "$value" || fail invalid_setting; app_image="$value" ;;
      MIGRATE_IMAGE) valid_image "$value" || fail invalid_setting; migrate_image="$value" ;;
      APP_HOST_PORT) [[ "$value" == 127.0.0.1:3010 ]] || fail invalid_setting; host_port="$value" ;;
    esac
  done
fi
if valid_sha "$commit"; then
  metadata manifest ".releases/$commit.manifest"
  metadata activation ".releases/$commit.activated"
fi

value="$(query docker ps -a --filter label=com.docker.compose.project=tokenizer --filter label=com.docker.compose.service=app --format '{{.ID}}')" || fail app_query_failed
valid_id "$value" || fail missing_or_multiple_app
app_id="$value"
value="$(query docker inspect --format '{{.State.Running}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{.Image}}' "$app_id")" || fail app_query_failed
[[ "$value" != *$'\n'* ]] || fail app_query_failed
IFS='|' read -r running status health project service image extra <<< "$value"
[[ -z "$extra" && "$running" == true && "$status" == running && "$project" == tokenizer && "$service" == app ]] || fail wrong_serving_app
[[ "$health" == healthy || "$health" == unknown ]] || fail unhealthy_app
valid_digest "$image" || fail wrong_serving_app
app_status="$status" app_health="$health" app_image_id="$image"
if [[ "$app_image" != unknown ]]; then
  value="$(query docker image inspect --format '{{.Id}}' "$app_image")" || fail image_query_failed
  [[ "$value" == "$app_image_id" ]] || fail wrong_image_reference
fi
value="$(query docker port "$app_id" 3000/tcp)" || fail app_query_failed
[[ "$value" == 127.0.0.1:3010 ]] || fail wrong_backend_binding
host_port="$value"
value="$(query docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}|{{.Config.User}}' "$app_image_id")" || fail image_query_failed
[[ "$value" != *$'\n'* ]] || fail image_query_failed
IFS='|' read -r image_revision user extra <<< "$value"
[[ -z "$extra" ]] || fail image_query_failed
if valid_sha "$image_revision"; then revision="$image_revision";
elif [[ -n "$image_revision" && "$image_revision" != '<no value>' && "$image_revision" != unknown ]]; then fail image_query_failed; fi
if [[ -z "$user" ]]; then image_user=root; uid=0;
elif [[ "$user" == node ]]; then image_user=node;
elif [[ "$user" =~ ^[0-9]{1,10}(:[0-9]{1,10})?$ ]]; then image_user="$user"; uid="${user%%:*}";
else fail image_query_failed; fi
value="$(query docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' "$app_id")" || fail app_query_failed
[[ "$value" == tokenizer_default || "$value" == 'tokenizer_default ' ]] || fail wrong_project_network
app_network=tokenizer_default

value="$(query docker ps -a --filter label=com.docker.compose.project=tokenizer --filter label=com.docker.compose.service=postgres --format '{{.ID}}')" || fail postgres_query_failed
if [[ -n "$value" ]]; then
  valid_id "$value" || fail multiple_postgres
  postgres_id="$value"
  value="$(query docker inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{.Image}}' "$postgres_id")" || fail postgres_query_failed
  [[ "$value" != *$'\n'* ]] || fail postgres_query_failed
  IFS='|' read -r status health project service image extra <<< "$value"
  [[ -z "$extra" && "$project" == tokenizer && "$service" == postgres && "$status" =~ ^(running|exited|created|paused|restarting|dead)$ && "$health" =~ ^(healthy|unhealthy|starting|unknown)$ ]] || fail wrong_postgres_identity
  valid_digest "$image" || fail wrong_postgres_identity
  postgres_status="$status" postgres_health="$health" postgres_image_id="$image"
  value="$(query docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' "$postgres_id")" || fail postgres_query_failed
  [[ "$value" == tokenizer_default || "$value" == 'tokenizer_default ' ]] || fail wrong_project_network
  postgres_network=tokenizer_default
  value="$(query docker inspect --format '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}} {{end}}{{end}}' "$postgres_id")" || fail postgres_query_failed
  [[ "$value" == tokenizer_postgres-data || "$value" == 'tokenizer_postgres-data ' ]] || fail wrong_project_volume
  postgres_volume=tokenizer_postgres-data
fi
value="$(query docker network inspect --format '{{index .Labels "com.docker.compose.project"}}|{{.Driver}}' tokenizer_default)" || fail network_query_failed
[[ "$value" == 'tokenizer|bridge' ]] || fail wrong_project_network
network_driver=bridge
if [[ "$postgres_volume" == tokenizer_postgres-data ]]; then
  value="$(query docker volume inspect --format '{{index .Labels "com.docker.compose.project"}}|{{.Driver}}' tokenizer_postgres-data)" || fail volume_query_failed
  [[ "$value" == 'tokenizer|local' ]] || fail wrong_project_volume
  volume_driver=local
fi
value="$(query curl --noproxy '*' -fsS --connect-timeout 2 --max-time 3 --max-filesize 16384 http://127.0.0.1:3010/api/health)" || fail backend_unavailable
health_commit="$(jq -er 'select(.ok == true and ((has("code") | not) or .code == "ready")) | .commit | select(type == "string")' <<< "$value")" || fail backend_unready
valid_sha "$health_commit" || fail backend_unready
[[ "$commit" != unknown || "$revision" != unknown ]] || fail unknown_serving_revision
[[ "$commit" == unknown || "$commit" == "$health_commit" ]] || fail wrong_backend_revision
[[ "$revision" == unknown || "$revision" == "$health_commit" ]] || fail wrong_backend_revision
baseline=legacy_or_unknown
if [[ "$app_image" == *@sha256:* && "$migrate_image" == *@sha256:* && "$commit" != unknown ]] &&
   regular ".releases/$commit.manifest" && regular ".releases/$commit.activated"; then
  if printf 'commit=%s\napp_image=%s\nmigrate_image=%s\n' "$commit" "$app_image" "$migrate_image" | cmp -s - ".releases/$commit.manifest" &&
     printf 'commit=%s\napp_image=%s\napp_id=%s\n' "$commit" "$app_image" "$app_image_id" | cmp -s - ".releases/$commit.activated"; then baseline=digest_activated; fi
fi
outcome=observed reason=none
emit
