#!/bin/zsh
# End-to-end pairing test on this Mac, no simulator: the Swift side (FlintPairing, a macOS test run) talks to the real
# TypeScript listener (packages/core/src/pairing) over loopback. Synthetic data only; nothing from ~/Library or a real account.
#   scripts/pairing-e2e.sh            run happy, deny and expired scenarios
# Scenarios: happy (code matches, bundle arrives, ack recorded, second connection closed), deny (Mac refuses the code),
# expired (session ran out before the phone joined).
set -u
HERE="${0:A:h}"
ROOT="${HERE:h:h:h}"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
OUT="$ROOT/packages/core/.cache/pairing-e2e"
mkdir -p "$OUT"

ESBUILD="${ESBUILD:-}"
if [ -z "$ESBUILD" ]; then
  for c in "$ROOT/node_modules/.bin/esbuild" "$ROOT/node_modules/.pnpm/node_modules/.bin/esbuild"; do [ -x "$c" ] && { ESBUILD="$c"; break; }; done
fi
[ -n "$ESBUILD" ] || { echo "esbuild not found: run pnpm install or set ESBUILD" >&2; exit 2; }
"$ESBUILD" "$ROOT/packages/core/src/pairing/e2e-listener.ts" --bundle --platform=node --format=esm --packages=external \
  --outfile="$OUT/listener.mjs" --log-level=warning || exit 2

fail=0
for scenario in happy deny expired; do
  EVENTS="$OUT/$scenario.events"
  : > "$EVENTS"
  (cd "$ROOT/packages/core" && node "$OUT/listener.mjs" "$scenario" > "$EVENTS" 2> "$OUT/$scenario.err") &
  NODE=$!
  URL=""
  for _ in {1..100}; do
    URL=$(python3 -I -c 'import json,sys
for l in open(sys.argv[1]):
    try: o=json.loads(l)
    except Exception: continue
    if o.get("type")=="listening": print(o["url"]); break' "$EVENTS")
    [ -n "$URL" ] && break
    sleep 0.1
  done
  [ -n "$URL" ] || { echo "listener did not start ($scenario)" >&2; kill $NODE 2>/dev/null; fail=1; continue; }

  echo "== pairing e2e: $scenario"
  FLINT_PAIRING_URL="$URL" FLINT_PAIRING_EVENTS="$EVENTS" FLINT_PAIRING_SCENARIO="$scenario" \
    swift test --package-path "$ROOT/apps/ios/Packages/FlintCore" --filter PairingE2ETests 2>&1 | grep -E "✔|✘|error:|Test run|Issue" 
  rc=${pipestatus[1]}
  [ "$rc" -eq 0 ] || fail=1
  wait $NODE 2>/dev/null; node_rc=$?
  case "$scenario" in
    happy) [ "$node_rc" -eq 0 ] || { echo "listener exited $node_rc" >&2; fail=1; } ;;
    *) [ "$node_rc" -eq 0 ] || { echo "listener exited $node_rc" >&2; fail=1; } ;;
  esac
  echo "events: $(python3 -I -c 'import json,sys
print(" ".join(json.loads(l)["type"] + (":" + json.loads(l).get("reason","") if json.loads(l)["type"]=="closed" else "") for l in open(sys.argv[1]) if l.strip()))' "$EVENTS")"
done
[ "$fail" -eq 0 ] && echo "pairing e2e passed" || { echo "pairing e2e FAILED" >&2; exit 1; }
