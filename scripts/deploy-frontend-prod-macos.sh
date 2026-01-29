#!/usr/bin/env bash
set -euo pipefail

# One-command production deploy for the frontend on macOS with safe TLS.
# This avoids NODE_TLS_REJECT_UNAUTHORIZED=0 by using Keychain-exported CAs.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root/frontend"

if [[ "$#" -gt 0 ]]; then
	exec ./scripts/vercel-safe.sh "$@"
fi

exec ./scripts/vercel-safe.sh --prod --yes
