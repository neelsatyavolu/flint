#!/bin/bash
# Tests scripts/keychain-list.sh against a fake `security` that keeps its search list in a file. Touches no real keychain.
#   scripts/tests/keychain-list-test.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir "$WORK/bin"
cat > "$WORK/bin/security" <<'FAKE'
#!/bin/bash
# list-keychains -d user          prints the list, indented and quoted like the real tool
# list-keychains -d user -s ...   replaces the list
[[ "$1" == list-keychains && "$2" == -d && "$3" == user ]] || { echo "unexpected: $*" >&2; exit 1; }
if [[ "${4:-}" == -s ]]; then shift 4; printf '%s\n' "$@" > "$FAKE_LIST"; else sed 's/^/    "/; s/$/"/' "$FAKE_LIST"; fi
FAKE
chmod +x "$WORK/bin/security"
export PATH="$WORK/bin:$PATH" FAKE_LIST="$WORK/list"
source "$HERE/../keychain-list.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
expect_list() { [[ "$(cat "$FAKE_LIST")" == "$1" ]] || fail "$2: got $(tr '\n' '|' < "$FAKE_LIST")"; }

LOGIN="/Users/a b/Library/Keychains/login.keychain-db"
OTHER="/Users/a b/Library/Keychains/work.keychain-db"
TEMP="$WORK/flint sign.keychain-db"

# 1. The person's list has two keychains (one path with a space); after add and restore it is exactly the same.
printf '%s\n%s\n' "$LOGIN" "$OTHER" > "$FAKE_LIST"
SAVED="$(keychain_list_save)"
[[ "$SAVED" == "$LOGIN"$'\n'"$OTHER" ]] || fail "save: $SAVED"
keychain_list_add "$TEMP" "$LOGIN"
expect_list "$TEMP"$'\n'"$LOGIN"$'\n'"$OTHER" "add keeps the other keychains"
keychain_list_restore "$SAVED"
expect_list "$LOGIN"$'\n'"$OTHER" "restore"

# 2. A list without login gets login appended on add, and restore removes it again.
printf '%s\n' "$OTHER" > "$FAKE_LIST"
SAVED="$(keychain_list_save)"
keychain_list_add "$TEMP" "$LOGIN"
expect_list "$TEMP"$'\n'"$OTHER"$'\n'"$LOGIN" "login appended"
keychain_list_restore "$SAVED"
expect_list "$OTHER" "restore without login"

# 3. An empty saved list leaves the search list alone.
printf '%s\n' "$LOGIN" > "$FAKE_LIST"
keychain_list_restore ""
expect_list "$LOGIN" "empty restore"
echo "keychain-list: all passed"
