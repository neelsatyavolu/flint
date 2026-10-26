#!/usr/bin/env bash
# Regenerates the fixture data that is derived from a source file (tracker rules from sanitize/trackers.ts, design
# tokens from tokens.css) by running the suites that own it in update mode. Review the git diff afterwards.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
(cd "$root/packages/core" && FLINT_FIXTURES_UPDATE=1 pnpm exec vitest run src/sanitize/text.test.ts)
(cd "$root/apps/desktop" && FLINT_FIXTURES_UPDATE=1 pnpm exec vitest run src/renderer/src/styles/tokens.test.ts)
node "$root/scripts/fixtures/validate.mjs"
