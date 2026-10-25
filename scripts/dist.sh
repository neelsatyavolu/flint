#!/usr/bin/env bash
# Build Flint for macOS (electron-builder) into apps/desktop/release/.
#
#   scripts/dist.sh            unsigned (local only)
#   scripts/dist.sh --sign     Developer ID signature from 1Password, no notarization
#   scripts/dist.sh --apple    Developer ID + notarize + staple (installable download)
#
# Credentials: ~/Documents/GitHub/APPLE_SIGNING.md (1Password, proton.me account, Private vault).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="unsigned"
case "${1:-}" in
  --sign) MODE="sign" ;;
  --apple|--release) MODE="apple" ;;
  ""|--unsigned) ;;
  -h|--help) sed -n 2,8p "$0"; exit 0 ;;
  *) echo "Unknown option: $1" >&2; exit 1 ;;
esac

cleanup() {
  if [ "$(type -t flint_cleanup_apple_creds 2>/dev/null || true)" = "function" ]; then flint_cleanup_apple_creds; fi
}
trap cleanup EXIT

if [ "$MODE" != "unsigned" ]; then
  # shellcheck disable=SC1091
  source "$ROOT/scripts/load-apple-creds.sh"
  if [ "${AGMUX_APPLE_CERT_EXPIRED:-0}" = "1" ]; then echo "error: the Developer ID certificate has expired" >&2; exit 1; fi
  export FLINT_SIGN=1
  if [ "$MODE" = "apple" ]; then
    if [ -z "${APPLE_API_KEY_PATH:-}${APPLE_API_KEY:-}" ] || [ -z "${APPLE_API_ISSUER:-}" ]; then
      echo "error: notarization needs the Key ID, issuer and AuthKey_*.p8 from 'Xanom Apple Dev Creds'" >&2; exit 1
    fi
    export FLINT_NOTARIZE=1
    echo "==> Developer ID sign + notarize"
  else
    flint_disable_notarization_env
    export FLINT_NOTARIZE=0
    echo "==> Developer ID sign only"
  fi
else
  export FLINT_SIGN=0 FLINT_NOTARIZE=0
  echo "==> Unsigned build"
fi

cd "$ROOT"
pnpm --filter @flint/cli build
cd "$ROOT/apps/desktop"
rm -rf release
pnpm exec electron-vite build
pnpm exec electron-builder --mac --config electron-builder.config.cjs --publish never

APP="$(find release -maxdepth 2 -name 'Flint.app' -type d | head -1 || true)"
if [ -n "$APP" ]; then
  codesign -dv --verbose=2 "$APP" 2>&1 | grep -E '^(Authority|TeamIdentifier|Identifier)=' || true
  [ "$MODE" = "apple" ] && { spctl --assess --type execute --verbose "$APP" 2>&1 || true; xcrun stapler validate "$APP" 2>&1 | tail -1 || true; }
fi

# electron-builder notarizes the app (inside both the zip and the DMG); the DMG itself is notarized here
# so the download opens without a Gatekeeper warning. Updates use the zips, so latest-mac.yml stays valid.
if [ "$MODE" = "apple" ]; then
  for dmg in release/*.dmg; do
    echo "==> Notarizing $dmg"
    xcrun notarytool submit "$dmg" --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" --wait
    xcrun stapler staple "$dmg"
    spctl --assess --type install --verbose "$dmg"
  done
fi
ls -lh release/*.dmg release/*.zip 2>/dev/null || true
