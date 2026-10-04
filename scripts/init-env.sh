#!/usr/bin/env bash
# Creates .env from .env.example on first run and fills in locally generated
# secrets. Safe to run repeatedly: existing non-empty values are preserved.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "init-env: created .env from .env.example"
fi

set_if_empty() {
  local key="$1" value="$2"
  # A key added to .env.example after .env was created: append it.
  if ! grep -qE "^${key}=" .env; then
    echo "${key}=" >> .env
  fi
  if grep -qE "^${key}=$" .env; then
    # Use a delimiter that cannot appear in base64/hex values.
    sed -i.bak "s|^${key}=$|${key}=${value}|" .env && rm -f .env.bak
    echo "init-env: generated ${key}"
  fi
}

rand_b64() { openssl rand -base64 "$1" | tr -d '\n'; }
rand_hex() { openssl rand -hex "$1"; }

if grep -qE '^AUTH_JWT_PRIVATE_KEY_B64=$' .env; then
  tmp="$(mktemp -d)"
  openssl genpkey -algorithm ed25519 -out "$tmp/private.pem" 2>/dev/null
  openssl pkey -in "$tmp/private.pem" -pubout -out "$tmp/public.pem" 2>/dev/null
  set_if_empty AUTH_JWT_PRIVATE_KEY_B64 "$(base64 < "$tmp/private.pem" | tr -d '\n')"
  set_if_empty AUTH_JWT_PUBLIC_KEY_B64 "$(base64 < "$tmp/public.pem" | tr -d '\n')"
  rm -rf "$tmp"
fi
set_if_empty INTERNAL_SERVICE_TOKEN "$(rand_hex 32)"
set_if_empty IP_HASH_SECRET "$(rand_hex 32)"
set_if_empty MFA_ENCRYPTION_KEY_B64 "$(rand_b64 32)"
set_if_empty DECK_ENCRYPTION_KEY_B64 "$(rand_b64 32)"
