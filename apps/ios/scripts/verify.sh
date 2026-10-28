#!/bin/zsh
# Checks Flint for iOS the way a release does, after Sheafnote's scripts/verify.sh.
#
#   scripts/verify.sh [--ui] [--e2e] [--label name]
#
# Always: xcodegen (pinned to FlintCore's Package.resolved by scripts/gen-project.sh), `swift test` on FlintCore, an iPhone build, then FlintTests on a temporary simulator.
# --ui   also the UI tests (FlintUITests), first on an iPhone, then on an iPad, one simulator at a time.
# --e2e  also scripts/e2e-greenmail.sh on the iPhone (GreenMail on this Mac, needs Java; only with --ui).
# Every simulator is created here and deleted on exit, also on failure or Ctrl-C. Nothing touches real accounts or data: the UI
# tests launch with `-FlintSeed demo` (a throwaway database and an in-memory server).
# Environment: FLINT_VERIFY_SIM_NAME (default flint-verify-<pid>), FLINT_VERIFY_DERIVED (derived data), FLINT_SHOT_DIR (screenshots).
set -u
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
HERE="${0:A:h}"
cd "$HERE/.."

UI=0; E2E=0; LABEL="verify"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ui) UI=1; shift ;;
    --e2e) E2E=1; shift ;;
    --label) LABEL="${2:?--label needs a name}"; shift 2 ;;
    *) echo "usage: scripts/verify.sh [--ui] [--e2e] [--label name]" >&2; exit 2 ;;
  esac
done
if (( E2E && !UI )); then echo "--e2e only runs together with --ui" >&2; exit 2; fi

DERIVED="${FLINT_VERIFY_DERIVED:-$PWD/.derived/$LABEL}"
SIM_NAME="${FLINT_VERIFY_SIM_NAME:-flint-verify-$$}"
RUNTIME="${FLINT_VERIFY_RUNTIME:-com.apple.CoreSimulator.SimRuntime.iOS-26-5}"
PHONE_TYPE="iPhone 17 Pro"
PAD_TYPE="iPad Air 13-inch (M4)"
# One simulator at a time, serial tests: the Mac this runs on is shared and small.
# A UI test that fails is run once more (-retry-tests-on-failure); two known flakes pass on a second run (HANDOFF.md).
RETRY_FLAGS=(-retry-tests-on-failure -test-iterations 2)
MEMORY_FLAGS=(-parallel-testing-enabled NO -disable-concurrent-destination-testing -maximum-concurrent-test-simulator-destinations 1 -jobs 4)
UDID=""
# The test runner only passes variables that start with TEST_RUNNER_ to the tests.
[[ -n "${FLINT_SHOT_DIR:-}" ]] && export TEST_RUNNER_FLINT_SHOT_DIR="$FLINT_SHOT_DIR"
STEP_START=$SECONDS

delete_sim() {
  [[ -n "$UDID" ]] || return 0
  xcrun simctl shutdown "$UDID" >/dev/null 2>&1 || true
  xcrun simctl delete "$UDID" >/dev/null 2>&1 || true
  UDID=""
}
trap 'delete_sim' EXIT
trap 'delete_sim; exit 130' INT TERM

step() { STEP_START=$SECONDS; echo "verify: $*"; }
done_step() { echo "verify: done in $((SECONDS - STEP_START)) s"; }
fail() { echo "verify: FAILED: $*" >&2; exit 1; }

new_sim() {
  delete_sim
  UDID=$(xcrun simctl create "$SIM_NAME" "$1" "$RUNTIME") || fail "could not create a $1 simulator"
  xcrun simctl boot "$UDID" || fail "could not boot the simulator"
  xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1 || true
}

# Runs xcodebuild with its output in a log. Xcode 26 can sit idle after the last suite has reported, so once the summary is in the
# log and nothing has been written for 90 s, it is stopped and the summary decides.
run_tests() {
  local log="$1"; shift
  mkdir -p "${log:h}"
  xcodebuild "$@" > "$log" 2>&1 &
  local pid=$! last=0 idle=0 size killed=0 rc
  while kill -0 $pid 2>/dev/null; do
    sleep 5
    size=$(stat -f %z "$log")
    if [[ $size == $last ]]; then idle=$((idle + 5)); else idle=0; last=$size; fi
    if (( idle >= 90 )) && grep -qE "Test Suite '(All|Selected) tests' (passed|failed)" "$log"; then kill $pid; killed=1; break; fi
  done
  wait $pid 2>/dev/null; rc=$?
  # A normal exit decides by its status (a retried flake still ends green); a stop after the idle wait decides by the summary.
  (( killed )) || return $rc
  # The summary lines cover every iteration, so judge by each test's last result instead: none may end failed.
  awk "/^Test Case .* (passed|failed) \\(/ { k = \$0; sub(/ (passed|failed) \\(.*/, \"\", k); r[k] = \$(NF-2) } END { n = 0; for (t in r) { n++; if (r[t] == \"failed\") exit 1 } exit (n == 0) }" "$log"
}

summarize() {
  local log="$1"
  grep -E "Executed [0-9]+ tests?, with|Test run with [0-9]+ tests" "$log" | tail -2
  grep -E "error:|Test Case .* failed" "$log" | head -20
}

step "xcodegen and package pins"
scripts/gen-project.sh >/dev/null || fail "gen-project.sh"
done_step

step "keychain list helpers"
/bin/bash scripts/tests/keychain-list-test.sh || fail "keychain-list-test.sh"
done_step

step "swift test (FlintCore)"
swift test --package-path Packages/FlintCore || fail "swift test"
done_step

step "build for iOS Simulator"
xcodebuild -project Flint.xcodeproj -scheme Flint -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$DERIVED" -jobs 4 -onlyUsePackageVersionsFromResolvedFile CODE_SIGNING_ALLOWED=NO build-for-testing > "$DERIVED.build.log" 2>&1 \
  || { tail -30 "$DERIVED.build.log"; fail "build"; }
done_step

run_class() {
  local device="$1" only="$2" log="$DERIVED.$3.log" retry=()
  [[ "$only" == FlintUITests ]] && retry=($RETRY_FLAGS)
  step "$only on $device"
  new_sim "$device"
  if run_tests "$log" test-without-building -project Flint.xcodeproj -scheme Flint -destination "id=$UDID" \
      -derivedDataPath "$DERIVED" $MEMORY_FLAGS[@] $retry[@] -only-testing:"$only" CODE_SIGNING_ALLOWED=NO; then
    summarize "$log"; done_step
  else
    summarize "$log"; delete_sim; fail "$only on $device (log: $log)"
  fi
  delete_sim
}

run_class "$PHONE_TYPE" FlintTests unit

if (( UI )); then
  run_class "$PHONE_TYPE" FlintUITests ui-iphone
  if (( E2E )); then
    step "GreenMail end to end on iPhone"
    new_sim "$PHONE_TYPE"
    "$HERE/e2e-greenmail.sh" "$UDID" "$DERIVED" || { delete_sim; fail "e2e-greenmail.sh"; }
    done_step
    delete_sim
  fi
  run_class "$PAD_TYPE" FlintUITests ui-ipad
fi

echo "verify: OK"
