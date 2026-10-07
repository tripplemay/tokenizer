#!/usr/bin/env bash
set -u

readonly AUTH_SECRET_MIN_LENGTH=32
readonly HISTORICAL_AUTH_SECRET="dev-placeholder-set-AUTH_SECRET-in-production"
readonly ADMIN_TOKEN_MIN_LENGTH=32
readonly HISTORICAL_ADMIN_TOKEN="change-me"

auth_secret="${AUTH_SECRET:-}"
trimmed_secret="${auth_secret#"${auth_secret%%[![:space:]]*}"}"
trimmed_secret="${trimmed_secret%"${trimmed_secret##*[![:space:]]}"}"
status=0

if [[ ${#trimmed_secret} -lt $AUTH_SECRET_MIN_LENGTH || "$trimmed_secret" == "$HISTORICAL_AUTH_SECRET" ]]; then
  echo "::error::AUTH_SECRET must be configured with at least ${AUTH_SECRET_MIN_LENGTH} characters for production deployment" >&2
  status=1
fi

admin_token="${ADMIN_TOKEN:-}"
trimmed_admin_token="${admin_token#"${admin_token%%[![:space:]]*}"}"
trimmed_admin_token="${trimmed_admin_token%"${trimmed_admin_token##*[![:space:]]}"}"
if [[ ${#admin_token} -lt $ADMIN_TOKEN_MIN_LENGTH || "$admin_token" != "$trimmed_admin_token" || "$admin_token" == "$HISTORICAL_ADMIN_TOKEN" ]]; then
  echo "::error::ADMIN_TOKEN must be configured with at least ${ADMIN_TOKEN_MIN_LENGTH} non-whitespace-padded characters for production deployment" >&2
  status=1
fi

resend_key="${AUTH_RESEND_KEY:-}"
trimmed_resend_key="${resend_key#"${resend_key%%[![:space:]]*}"}"
trimmed_resend_key="${trimmed_resend_key%"${trimmed_resend_key##*[![:space:]]}"}"
if [[ -z "$trimmed_resend_key" ]]; then
  echo "::error::AUTH_RESEND_KEY secret is required for production magic-link login" >&2
  status=1
fi

if [[ -z "${HARNESS_CONSOLE_SIGNING_KEY:-}" ]]; then
  echo "::warning::HARNESS_CONSOLE_SIGNING_KEY secret not set; harness gate approvals will return 503" >&2
fi

exit "$status"
