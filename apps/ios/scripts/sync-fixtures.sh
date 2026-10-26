#!/usr/bin/env bash
# Copies the shared JSON fixtures (packages/core/fixtures/*.json) into the FlintCore test bundle.
#   sync-fixtures.sh            copy, removing stale files
#   sync-fixtures.sh --check    change nothing; exit 1 when the copy is stale, incomplete or has extra files (CI)
# Never hand-edit the copies: change the TypeScript source and its fixture, then run this.
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
src="$root/packages/core/fixtures"
dst="$root/apps/ios/Packages/FlintCore/Tests/FlintCoreTests/Fixtures"

node "$root/scripts/fixtures/validate.mjs"

case "${1:-}" in
  "")
    mkdir -p "$dst"
    find "$dst" -maxdepth 1 -name '*.json' -delete
    cp "$src"/*.json "$dst"/
    echo "synced $(ls "$src"/*.json | wc -l | tr -d ' ') fixtures to ${dst#"$root/"}"
    ;;
  --check)
    stale=0
    for f in "$src"/*.json; do
      cmp -s "$f" "$dst/$(basename "$f")" || { echo "stale or missing: $(basename "$f")" >&2; stale=1; }
    done
    for f in "$dst"/*.json; do
      [ -e "$src/$(basename "$f")" ] || { echo "extra: $(basename "$f")" >&2; stale=1; }
    done
    if [ "$stale" -ne 0 ]; then echo "fixtures are stale: run apps/ios/scripts/sync-fixtures.sh" >&2; exit 1; fi
    echo "fixtures in sync"
    ;;
  *) echo "usage: sync-fixtures.sh [--check]" >&2; exit 2 ;;
esac
