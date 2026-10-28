#!/usr/bin/env bash
# Launches the app on a simulator with the demo mailbox and saves a screenshot.
#   scripts/seed-screenshot.sh <simulator udid> <dark|light> <route> <out.png> [derived data path]
# <route> is a -FlintRoute spec: inbox, inbox:1, pinned, drafts, scheduled, snoozed, sent, archive, trash, spam,
# thread:<subject start>, sidebar, search, search:<query>, settings, compose, onboarding.
# Build first: xcodebuild -project Flint.xcodeproj -scheme Flint -destination "id=<udid>" -derivedDataPath <path> build
set -euo pipefail
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
udid="${1:?simulator udid}"; appearance="${2:?dark|light}"; route="${3:?route}"; out="${4:?output png}"
derived="${5:-${TMPDIR:-/tmp}/flint-shots}"
app="$derived/Build/Products/Debug-iphonesimulator/Flint.app"
[ -d "$app" ] || { echo "No build at $app. Build first (see the header of this script)." >&2; exit 1; }

xcrun simctl bootstatus "$udid" -b >/dev/null
xcrun simctl status_bar "$udid" override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3 >/dev/null 2>&1 || true
xcrun simctl install "$udid" "$app"
xcrun simctl terminate "$udid" co.xanom.flint >/dev/null 2>&1 || true
xcrun simctl launch "$udid" co.xanom.flint -FlintSeed demo -FlintAppearance "$appearance" -FlintRoute "$route" >/dev/null
sleep "${FLINT_SHOT_DELAY:-6}"
xcrun simctl io "$udid" screenshot "$out" >/dev/null
echo "$out"
