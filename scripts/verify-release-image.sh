#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: verify-release-image.sh IMAGE EXPECTED_COMMIT" >&2
  exit 2
fi

image="$1"
expected="$2"
if [[ ! "$expected" =~ ^[0-9a-f]{40}$ ]]; then
  echo "expected commit must be a 40-character lowercase SHA" >&2
  exit 2
fi

inspected="$(docker image inspect --format '{{.Id}}|{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")"
image_id="${inspected%%|*}"
revision="${inspected#*|}"
if [[ ! "$image_id" =~ ^sha256:[0-9a-f]{64}$ || "$revision" != "$expected" ]]; then
  echo "image ID/revision mismatch for $image" >&2
  exit 1
fi

printf '%s\n' "$image_id"
