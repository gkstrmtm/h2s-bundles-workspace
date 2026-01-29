#!/usr/bin/env bash
set -euo pipefail

# Fixes: "unable to get local issuer certificate" for Node-based CLIs (Vercel, npm, etc)
# on macOS networks that do TLS interception (Zscaler/Charles/corp proxy) by making Node
# trust the system/login Keychain certificates.
#
# Usage:
#   ./scripts/vercel-safe.sh --prod
#   ./scripts/vercel-safe.sh --refresh-ca --prod

refresh=false
if [[ "${1:-}" == "--refresh-ca" ]]; then
  refresh=true
  shift
fi

cache_root="${XDG_CACHE_HOME:-$HOME/.cache}/h2s"
mkdir -p "$cache_root"

ca_file="$cache_root/macos-keychain-certs.pem"

if $refresh || [[ ! -s "$ca_file" ]]; then
  tmp="$(mktemp)"
  # System keychains (these calls can fail on some macOS setups; ignore and keep going).
  security find-certificate -a -p /System/Library/Keychains/SystemRootCertificates.keychain >"$tmp" 2>/dev/null || true
  security find-certificate -a -p /Library/Keychains/System.keychain >>"$tmp" 2>/dev/null || true
  # Login keychain (where many corp/proxy roots are installed).
  security find-certificate -a -p "$HOME/Library/Keychains/login.keychain-db" >>"$tmp" 2>/dev/null || true

  if [[ ! -s "$tmp" ]]; then
    echo "[vercel-safe] Could not export any certificates from Keychain." >&2
    echo "[vercel-safe] Try running: security find-certificate -a -p /Library/Keychains/System.keychain" >&2
    exit 2
  fi

  mv "$tmp" "$ca_file"
fi

export NODE_EXTRA_CA_CERTS="$ca_file"

# Helpful visibility without being noisy.
echo "[vercel-safe] Using NODE_EXTRA_CA_CERTS=$NODE_EXTRA_CA_CERTS" >&2

exec vercel "$@"
