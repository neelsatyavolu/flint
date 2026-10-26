#!/bin/zsh
# End-to-end UI test against GreenMail on this Mac (no real accounts):
#   scripts/e2e-greenmail.sh <simulator udid> <derived data path>
# Build first: xcodebuild -project Flint.xcodeproj -scheme Flint -destination "id=<udid>" -derivedDataPath <path> build-for-testing
# Starts GreenMail and its IMAP proxy, delivers two messages from bob to alice, uninstalls Flint from the simulator so it starts
# empty, runs AppUITests/EndToEndTests, then checks bob received alice's reply. Stops GreenMail when it ends.
set -u
HERE="${0:A:h}"
UDID="${1:?simulator udid}"; DERIVED="${2:?derived data path}"
IMAP=3143; PROXY=3144; SMTP=3025; API=3080
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

"$HERE/greenmail.sh" --imap $IMAP --proxy $PROXY --smtp $SMTP --api $API --users alice,bob &
GM=$!
trap 'kill $GM 2>/dev/null; wait 2>/dev/null' EXIT INT TERM
for _ in {1..150}; do
  nc -z 127.0.0.1 $PROXY 2>/dev/null && nc -z 127.0.0.1 $SMTP 2>/dev/null && nc -z 127.0.0.1 $IMAP 2>/dev/null && break
  sleep 0.2
done
nc -z 127.0.0.1 $SMTP || { echo "GreenMail did not start" >&2; exit 1; }

STAMP=$(date +%H%M%S)
SUBJECT="Lantern check $STAMP"
SECOND="Kettle note $STAMP"
python3 -I - "$SMTP" "$SUBJECT" "$SECOND" <<'PY'
import smtplib, sys
from email.message import EmailMessage
port, subjects = int(sys.argv[1]), sys.argv[2:]
for subject in subjects:
    msg = EmailMessage()
    msg["From"] = "Bob <bob@test.local>"
    msg["To"] = "alice@test.local"
    msg["Subject"] = subject
    msg.set_content("Hi Alice,\n\nCan you look at this today?\n\nBob")
    with smtplib.SMTP("127.0.0.1", port) as s:
        s.send_message(msg)
PY

xcrun simctl uninstall "$UDID" co.xanom.flint >/dev/null 2>&1 || true
LOG="${DERIVED:h}/e2e-$STAMP.log"
TEST_RUNNER_FLINT_E2E_SUBJECT="$SUBJECT" TEST_RUNNER_FLINT_E2E_SECOND="$SECOND" TEST_RUNNER_FLINT_E2E_WORD="Lantern" \
TEST_RUNNER_FLINT_E2E_IMAP=$PROXY TEST_RUNNER_FLINT_E2E_SMTP=$SMTP TEST_RUNNER_FLINT_SHOT_DIR="${FLINT_SHOT_DIR:-$DERIVED/../e2e-shots}" \
xcodebuild test-without-building -project "$HERE/../Flint.xcodeproj" -scheme Flint -destination "id=$UDID" \
  -derivedDataPath "$DERIVED" -only-testing:FlintUITests/EndToEndTests \
  -parallel-testing-enabled NO -disable-concurrent-destination-testing -maximum-concurrent-test-simulator-destinations 1 \
  > "$LOG" 2>&1 &
XB=$!
# Xcode 26 can sit idle after the last suite finishes; stop it once the suite has reported and the log is quiet.
LAST=0; IDLE=0
while kill -0 $XB 2>/dev/null; do
  sleep 5
  SIZE=$(stat -f %z "$LOG")
  if [[ $SIZE == $LAST ]]; then IDLE=$((IDLE+5)); else IDLE=0; LAST=$SIZE; fi
  if (( IDLE >= 90 )) && grep -qE "Test Suite '(All|Selected) tests' (passed|failed)" "$LOG"; then kill $XB; break; fi
done
wait $XB 2>/dev/null
grep -qE "Test Suite '(All|Selected) tests' passed" "$LOG"
STATUS=$?
grep -E "Test Case .*(passed|failed|skipped)|error:" "$LOG" | head -20

# The reply goes to bob. Read his inbox straight from GreenMail (the raw port).
python3 -I - "$IMAP" "Re: $SUBJECT" <<'PY'
import imaplib, sys, time
port, wanted = int(sys.argv[1]), sys.argv[2]
for _ in range(20):
    box = imaplib.IMAP4("127.0.0.1", port)
    box.login("bob", "secret")
    box.select("INBOX")
    _, data = box.search(None, "SUBJECT", '"%s"' % wanted)
    box.logout()
    if data and data[0].split():
        print("reply delivered to bob")
        sys.exit(0)
    time.sleep(1)
print("no reply in bob's inbox", file=sys.stderr)
sys.exit(1)
PY
DELIVERED=$?
[[ $STATUS -eq 0 && $DELIVERED -eq 0 ]]
