#!/bin/zsh
# Starts GreenMail (IMAP, SMTP) and the FLAGS-fixing IMAP proxy in front of it for the Swift integration suite, and stops both
# when this script ends (Ctrl-C, SIGTERM, or the parent test process killing it).
#
#   scripts/greenmail.sh [--imap 3143] [--proxy 3144] [--smtp 3025] [--api 3080] [--users alice,bob]
#
# Point the suite at the proxy port (IMAP) and the SMTP port. Users are `<name>:secret@test.local`. Needs Java 8+ and python3.
# The jar is the one packages/core's tests download (packages/core/.cache), or the main checkout's copy.
# Run the suite:  FLINT_GREENMAIL=1 swift test --package-path apps/ios/Packages/FlintCore --filter GreenMail
set -u
HERE="${0:A:h}"
IMAP=3143; PROXY=3144; SMTP=3025; API=3080; USERS="alice,bob"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --imap) IMAP="$2"; shift 2 ;;
    --proxy) PROXY="$2"; shift 2 ;;
    --smtp) SMTP="$2"; shift 2 ;;
    --api) API="$2"; shift 2 ;;
    --users) USERS="$2"; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

JAR=""
for candidate in "$HERE/../../../packages/core/.cache/greenmail-standalone-1.6.15.jar" "$HOME/Documents/GitHub/flint/packages/core/.cache/greenmail-standalone-1.6.15.jar"; do
  [[ -f "$candidate" ]] && JAR="$candidate" && break
done
[[ -n "$JAR" ]] || { echo "greenmail jar not found; run pnpm test in packages/core once" >&2; exit 1; }
command -v java >/dev/null || { echo "java is not installed" >&2; exit 1; }

USER_LIST=""
for name in ${(s:,:)USERS}; do USER_LIST+="${USER_LIST:+,}${name}:secret@test.local"; done

java -Dgreenmail.imap.hostname=127.0.0.1 -Dgreenmail.imap.port="$IMAP" \
  -Dgreenmail.smtp.hostname=127.0.0.1 -Dgreenmail.smtp.port="$SMTP" \
  -Dgreenmail.api.hostname=127.0.0.1 -Dgreenmail.api.port="$API" \
  -Dgreenmail.users="$USER_LIST" -jar "$JAR" >/dev/null 2>&1 &
GM=$!
python3 -I "$HERE/greenmail-imap-proxy.py" "$PROXY" "$IMAP" >/dev/null 2>&1 &
PX=$!
trap 'kill $GM $PX 2>/dev/null; wait 2>/dev/null' EXIT INT TERM
# Stop when GreenMail dies or when whoever started this script is gone (a crashed test run must not leave Java behind).
PARENT=$PPID
while kill -0 "$GM" 2>/dev/null && kill -0 "$PARENT" 2>/dev/null; do sleep 0.3; done
