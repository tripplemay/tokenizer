#!/usr/bin/env bash
set -euo pipefail
candidate="${REVISION:-}"
[[ "$candidate" =~ ^[0-9a-f]{40}$ ]] || { echo "candidate SHA invalid" >&2; exit 2; }
git cat-file -e "$candidate^{commit}"
hint="${PREVIOUS_HINT:-}"
if [[ -z "$hint" || "$hint" == 0000000000000000000000000000000000000000 ]]; then
  previous="$(git rev-parse --verify 'origin/main^{commit}')"
else
  [[ "$hint" =~ ^[0-9a-f]{40}$ ]] || { echo "predecessor SHA invalid" >&2; exit 2; }
  previous="$(git rev-parse --verify "$hint^{commit}")"
fi
if [[ "$previous" == "$candidate" ]]; then
  if [[ "${BOOTSTRAP_REHEARSAL:-false}" == true && "${RELEASE_EVENT:-}" == workflow_dispatch ]]; then
    echo "explicit bootstrap rehearsal: same SHA does not prove old-version compatibility; deployment disabled" >&2
  else
    echo "distinct predecessor required; refusing same-candidate rollback rehearsal" >&2
    exit 1
  fi
fi
printf '%s\n' "$previous"
