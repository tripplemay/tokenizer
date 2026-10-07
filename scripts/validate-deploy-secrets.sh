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

if [[ ! "${VPS_HOST:-}" =~ ^[A-Za-z0-9][A-Za-z0-9.:-]*$ || ! "${VPS_USER:-}" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ || -z "${VPS_SSH_KEY:-}" ]]; then
  echo "::error::VPS connection settings are missing or invalid" >&2
  status=1
fi
deploy_path="${VPS_DEPLOY_PATH:-/opt/tokenizer}"
if [[ ! "$deploy_path" =~ ^/[A-Za-z0-9_./-]+$ || "$deploy_path" == *".."* ]]; then
  echo "::error::VPS_DEPLOY_PATH must be an absolute simple path" >&2
  status=1
fi
ssh_port="${VPS_SSH_PORT:-22}"
if [[ ! "$ssh_port" =~ ^[0-9]{1,5}$ ]] || (( 10#$ssh_port < 1 || 10#$ssh_port > 65535 )); then
  echo "::error::VPS_SSH_PORT must be between 1 and 65535" >&2
  status=1
fi

# Compose interpolates unquoted .env values. Reject anything that can add a
# second line, alter interpolation, or be parsed as an inline comment.
# Errors name keys only; secret values must never enter Actions logs.
for name in AUTH_SECRET ADMIN_TOKEN AUTH_RESEND_KEY HARNESS_CONSOLE_SIGNING_KEY POSTGRES_PASSWORD NEXT_PUBLIC_APP_URL PRICING_AUTO_ENABLED PRICING_LLM_KEY LITELLM_PRICES_URL OPENROUTER_MODELS_URL PRICING_LLM_BASE_URL PRICING_LLM_MODEL; do
  value="${!name:-}"
  if [[ "$value" =~ [[:space:]] || "$value" == *'$'* || "$value" == *"'"* || "$value" == *'"'* || "$value" == *$'\\'* ]]; then
    echo "::error::$name contains characters unsafe for a single-line Compose .env value" >&2
    status=1
  fi
done

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

if [[ -z "${POSTGRES_PASSWORD:-}" || ! "${POSTGRES_PASSWORD:-}" =~ ^[A-Za-z0-9._~-]+$ ]]; then
  echo "::error::POSTGRES_PASSWORD must be explicit and URL-unreserved for the existing Compose DATABASE_URL" >&2
  status=1
fi

if [[ ! "${NEXT_PUBLIC_APP_URL:-}" =~ ^https://[^[:space:]]+$ ]]; then
  echo "::error::NEXT_PUBLIC_APP_URL must be an explicit HTTPS URL" >&2
  status=1
fi

if [[ -z "${HARNESS_CONSOLE_SIGNING_KEY:-}" ]]; then
  echo "::warning::HARNESS_CONSOLE_SIGNING_KEY secret not set; harness gate approvals will return 503" >&2
fi

exit "$status"
