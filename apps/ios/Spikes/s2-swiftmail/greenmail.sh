#!/bin/zsh
# Spike S2: start GreenMail on fixed ports (IMAP 3143, SMTP 3025) with users alice and bob (password "secret").
# Reuses the jar packages/core tests download; falls back to the main checkout's cache.
set -euo pipefail
HERE="${0:A:h}"
JAR=""
for c in "$HERE/../../../../packages/core/.cache/greenmail-standalone-1.6.15.jar" "$HOME/Documents/GitHub/flint/packages/core/.cache/greenmail-standalone-1.6.15.jar"; do
  [[ -f "$c" ]] && JAR="$c" && break
done
[[ -n "$JAR" ]] || { echo "greenmail jar not found; run pnpm test in packages/core once" >&2; exit 1; }
exec java -Dgreenmail.imap.hostname=127.0.0.1 -Dgreenmail.imap.port=3143 \
  -Dgreenmail.smtp.hostname=127.0.0.1 -Dgreenmail.smtp.port=3025 \
  -Dgreenmail.api.hostname=127.0.0.1 -Dgreenmail.api.port=3080 \
  -Dgreenmail.users=alice:secret@test.local,bob:secret@test.local -jar "$JAR"
