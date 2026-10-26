#!/usr/bin/env bash
# Publish a Flint release to GitHub. Installed copies update themselves from it.
#
#   1. bump "version" in apps/desktop/package.json (and APP_VERSION in AboutSection.tsx), commit
#   2. scripts/release.sh [notes.md]
#
# Builds with scripts/dist.sh --apple (Developer ID + notarization, credentials from 1Password),
# then creates release v<version> with the zips, DMGs, blockmaps and latest-mac.yml (the update feed),
# plus Flint-arm64.dmg / Flint-x64.dmg so releases/latest/download/<name> always points at the newest.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="neelsatyavolu/flint"
NOTES="${1:-}"
cd "$ROOT"

VERSION="$(node -p 'require("./apps/desktop/package.json").version')"
TAG="v$VERSION"
ABOUT="apps/desktop/src/renderer/src/features/settings/sections/AboutSection.tsx"
grep -q "APP_VERSION = \"$VERSION\"" "$ABOUT" || { echo "error: APP_VERSION in $ABOUT doesn't match $VERSION" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "error: commit your changes first" >&2; exit 1; }
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then echo "error: $TAG is already released" >&2; exit 1; fi

pnpm test
scripts/dist.sh --apple

cd apps/desktop/release
[ -f latest-mac.yml ] || { echo "error: electron-builder wrote no latest-mac.yml" >&2; exit 1; }
cp "Flint-$VERSION-arm64.dmg" Flint-arm64.dmg
cp "Flint-$VERSION-x64.dmg" Flint-x64.dmg

git -C "$ROOT" tag -a "$TAG" -m "Flint $VERSION"
git -C "$ROOT" push origin "$TAG"
notes=(--generate-notes)
[ -n "$NOTES" ] && { [[ "$NOTES" = /* ]] || NOTES="$ROOT/$NOTES"; notes=(--notes-file "$NOTES"); }
gh release create "$TAG" --repo "$REPO" --title "Flint $VERSION" --verify-tag "${notes[@]}" \
  latest-mac.yml Flint-*.zip Flint-*.dmg *.blockmap
echo "Released https://github.com/$REPO/releases/tag/$TAG"
