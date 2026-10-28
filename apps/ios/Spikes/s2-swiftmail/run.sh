#!/bin/zsh
# Spike S2: start GreenMail + the FLAGS-rewriting proxy, run the probe, stop both. Prints PASS/FAIL lines only.
set -u
HERE="${0:A:h}"; cd "$HERE"
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
./greenmail.sh >/dev/null 2>&1 & GM=$!
python3 -I imap-proxy.py >/dev/null 2>&1 & PX=$!
trap 'kill $GM $PX 2>/dev/null; pkill -f "greenmail-standalone" 2>/dev/null' EXIT
for i in {1..50}; do nc -z 127.0.0.1 3143 && nc -z 127.0.0.1 3144 && break; sleep 0.2; done
swift build 2>&1 | grep -E "error" ; swift run probe 2>&1 | grep -E '^(PASS|FAIL|SUMMARY)'
