#!/usr/bin/env bash
set -u

readonly AUTH_SECRET_MIN_LENGTH=32
readonly HISTORICAL_AUTH_SECRET="dev-placeholder-set-AUTH_SECRET-in-production"

auth_secret="${AUTH_SECRET:-}"
trimmed_secret="${auth_secret#"${auth_secret%%[![:space:]]*}"}"
trimmed_secret="${trimmed_secret%"${trimmed_secret##*[![:space:]]}"}"
status=0

if [[ ${#trimmed_secret} -lt $AUTH_SECRET_MIN_LENGTH || "$trimmed_secret" == "$HISTORICAL_AUTH_SECRET" ]]; then
  echo "::error::AUTH_SECRET must be configured with at least ${AUTH_SECRET_MIN_LENGTH} characters for production deployment" >&2
  status=1
fi

if [[ -z "${AUTH_RESEND_KEY:-}" ]]; then
  echo "::warning::AUTH_RESEND_KEY secret not set; magic-link emails will not send" >&2
fi

if [[ -z "${HARNESS_CONSOLE_SIGNING_KEY:-}" ]]; then
  echo "::warning::HARNESS_CONSOLE_SIGNING_KEY secret not set; harness gate approvals will return 503" >&2
fi

exit "$status"
