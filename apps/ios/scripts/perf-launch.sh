#!/bin/zsh
# Launch time and steady memory on the 50,000-message synthetic mailbox (-FlintSeed perf50k), on a temporary simulator.
#   scripts/perf-launch.sh <Flint.app> [runs=5] [device type name, default "iPhone 17 Pro"] [simulator name, default flint-perf-sim] [runtime id]
# The runtime defaults to iOS 26.5. The iOS 27.0 beta runtime spends about 700 ms before main in any app that links PhotosUI, SafariServices
# or AuthenticationServices (measured with an empty SwiftUI app), so do not judge launch time on it.
# Build the .app first (Release is the one to judge). The launch flags this script passes (-FlintSeed, -FlintPerfReport, -FlintFakeAuth)
# are compiled out of Release, so the build needs the FLINT_PERF compile flag. Never set it for an archive or a TestFlight build:
#   xcodebuild -project Flint.xcodeproj -scheme Flint -configuration Release -destination 'generic/platform=iOS Simulator' -derivedDataPath <dd> \
#     SWIFT_ACTIVE_COMPILATION_CONDITIONS=FLINT_PERF build
# Run 0 builds the database (about a minute) and is not counted. Runs 1..N are fresh processes on the built database; each
# reports (from PerfProbe) the time from process start to the first inbox rows and the memory footprint at 1, 3, 6 and 10 s.
# The simulator is created, booted and deleted by this script, even on failure. Budgets: first rows < 400 ms, memory < 200 MB.
set -u
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
APP="${1:?path to Flint.app}"; RUNS="${2:-5}"; TYPE="${3:-iPhone 17 Pro}"; NAME="${4:-flint-perf-sim}"; RUNTIME="${5:-com.apple.CoreSimulator.SimRuntime.iOS-26-5}"
BUNDLE=co.xanom.flint
UDID=$(xcrun simctl create "$NAME" "$TYPE" "$RUNTIME") || exit 1
cleanup() { xcrun simctl shutdown "$UDID" >/dev/null 2>&1; xcrun simctl delete "$UDID" >/dev/null 2>&1; }
trap cleanup EXIT INT TERM
xcrun simctl boot "$UDID" && xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1
xcrun simctl install "$UDID" "$APP" || exit 1
DATA=$(xcrun simctl get_app_container "$UDID" "$BUNDLE" data)
REPORT="$DATA/Library/Caches/flint-perf-report.json"

launch_and_wait() {  # $1 = seconds to wait for the report
  rm -f "$REPORT"
  xcrun simctl launch "$UDID" "$BUNDLE" -FlintSeed perf50k -FlintPerfReport YES -FlintFakeAuth pass >/dev/null
  for _ in $(seq 1 "$1"); do [[ -f "$REPORT" ]] && return 0; sleep 1; done
  return 1
}

echo "run 0 (builds the database, not counted)"
launch_and_wait 400 || { echo "no report from the build run" >&2; exit 1; }
xcrun simctl terminate "$UDID" "$BUNDLE" >/dev/null 2>&1; sleep 2
REPORTS=$(mktemp -t flint-perf-reports)
for run in $(seq 1 "$RUNS"); do
  launch_and_wait 60 || { echo "run $run: no report" >&2; continue; }
  echo "run $run: $(tr -d '\n' < "$REPORT")"
  tr -d '\n' < "$REPORT" >> "$REPORTS"; echo >> "$REPORTS"
  xcrun simctl terminate "$UDID" "$BUNDLE" >/dev/null 2>&1; sleep 2
done
# Medians over the counted runs: first rows, then every stage mark and the memory samples.
python3 - "$REPORTS" <<'PY'
import json, statistics, sys
runs = [json.loads(line) for line in open(sys.argv[1]) if line.strip()]
if runs:
    def med(values): return round(statistics.median(values), 1)
    print(f"median over {len(runs)} runs: firstRowsMs {med([r['firstRowsMs'] for r in runs])}")
    stages = sorted({k for r in runs for k in r.get('stagesMs', {})}, key=lambda k: med([r['stagesMs'][k] for r in runs if k in r['stagesMs']]))
    print("  stages (ms from process start): " + ", ".join(f"{k} {med([r['stagesMs'][k] for r in runs if k in r['stagesMs']])}" for k in stages))
    print("  footprint MB: " + ", ".join(f"{s}s {med([r['footprintMBAtSecond'][s] for r in runs])}" for s in runs[0]['footprintMBAtSecond']))
PY
rm -f "$REPORTS"
