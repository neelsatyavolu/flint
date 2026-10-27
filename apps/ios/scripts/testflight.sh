#!/bin/bash
# Usage: scripts/testflight.sh [--no-upload]
# Builds a signed App Store archive of Flint and, unless --no-upload, uploads it to TestFlight. Credentials come from
# 1Password at run time and live only in a temporary folder and keychain that are deleted on exit; nothing secret is
# printed. Set these (or put them in the gitignored scripts/testflight.local.sh, see testflight.local.sh.example):
#   OP_ACCOUNT  1Password account (user id)
#   ASC_ITEM    item holding the App Store Connect API key (fields "Key ID", "issuer id", file AuthKey_<id>.p8)
#   CERT_ITEM   item holding the Apple Distribution certificate (AppleDistribution_<team>.p12, "password",
#               "Apple Certificate ID")
#   OP_VAULT    vault of both items (default Private)
# BUILD_NUMBER overrides the build number (default: UTC timestamp, always increasing).
# OUT_DIR overrides where the archive, the .ipa and the logs go (default .derived/testflight).
set -euo pipefail
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
cd "$(dirname "$0")/.."

LOCAL=scripts/testflight.local.sh
[[ -f "$LOCAL" ]] && source "$LOCAL"
: "${OP_ACCOUNT:?set OP_ACCOUNT (see the header of this script)}"
: "${ASC_ITEM:?set ASC_ITEM (see the header of this script)}"
: "${CERT_ITEM:?set CERT_ITEM (see the header of this script)}"
OP_VAULT="${OP_VAULT:-Private}"
OP=(op --account "$OP_ACCOUNT")
BUNDLE_ID=co.xanom.flint
PROFILE_NAME="Flint App Store"
SCHEME=Flint
TEAM_ID=VTQW687WBQ
BUILD_NUMBER="${BUILD_NUMBER:-$(date -u +%Y%m%d%H%M)}"
OUT_DIR="${OUT_DIR:-.derived/testflight}"
UPLOAD=1
for arg in "$@"; do
  case "$arg" in
    --no-upload) UPLOAD=0 ;;
    *) echo "usage: scripts/testflight.sh [--no-upload]" >&2; exit 2 ;;
  esac
done

TMP="$(mktemp -d)"
KC="$TMP/flint-sign.keychain-db"
LOGIN="$HOME/Library/Keychains/login.keychain-db"
cleanup() {
  security list-keychains -d user -s "$LOGIN" >/dev/null 2>&1 || true
  security delete-keychain "$KC" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

asc() { ASC_KEY_DIR="$TMP/asc" python3 -I scripts/asc.py "$@"; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

echo "==> Loading credentials from 1Password"
mkdir -m 700 "$TMP/asc"
KEY_ID="$("${OP[@]}" item get "$ASC_ITEM" --fields 'label=Key ID' --reveal)" \
  || { echo "error: 1Password did not return the API key id. Unlock 1Password, approve the CLI prompt and rerun." >&2; exit 1; }
printf %s "$KEY_ID" > "$TMP/asc/keyid"
"${OP[@]}" item get "$ASC_ITEM" --fields 'label=issuer id' --reveal | tr -d '[:space:]' > "$TMP/asc/issuer"
"${OP[@]}" read "op://$OP_VAULT/$ASC_ITEM/AuthKey_${KEY_ID}.p8" --out-file "$TMP/asc/AuthKey_${KEY_ID}.p8" >/dev/null
CERT_ID="$("${OP[@]}" item get "$CERT_ITEM" --fields 'label=Apple Certificate ID')"
"${OP[@]}" read "op://$OP_VAULT/$CERT_ITEM/AppleDistribution_${TEAM_ID}.p12" --out-file "$TMP/dist.p12" >/dev/null
P12_PASS="$("${OP[@]}" item get "$CERT_ITEM" --fields label=password --reveal)"

echo "==> Importing the distribution certificate into a temporary keychain"
KC_PASS="$(openssl rand -hex 16)"
security create-keychain -p "$KC_PASS" "$KC"
security set-keychain-settings -lut 3600 "$KC"
security unlock-keychain -p "$KC_PASS" "$KC"
security import "$TMP/dist.p12" -k "$KC" -P "$P12_PASS" -T /usr/bin/codesign -T /usr/bin/security >/dev/null
unset P12_PASS
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KC_PASS" "$KC" >/dev/null
security list-keychains -d user -s "$KC" "$LOGIN"   # login holds Apple's WWDR intermediates
IDENTITY="$(security find-identity -v -p codesigning "$KC" | sed -nE 's/.*"(Apple Distribution: [^"]+)".*/\1/p' | head -1)"
[[ -n "$IDENTITY" ]] || { echo "error: no Apple Distribution identity in the certificate item" >&2; exit 1; }

echo "==> Making a fresh App Store provisioning profile"
BUNDLE_RES="$(asc GET "/v1/bundleIds?filter%5Bidentifier%5D=$BUNDLE_ID&fields%5BbundleIds%5D=identifier")"
BUNDLE_REF="$(json "next(iter([b['id'] for b in d['data'].get('data', []) if b['attributes']['identifier']=='$BUNDLE_ID']), '')" <<< "$BUNDLE_RES")"
if [[ -z "$BUNDLE_REF" ]]; then
  echo "error: the App ID $BUNDLE_ID is not registered for team $TEAM_ID (or the API key cannot see it)." >&2
  echo "       Owner: register it on developer.apple.com > Identifiers (iOS), no capabilities needed, then rerun." >&2
  exit 1
fi
# A profile captures the App ID's capabilities when it is made, so replace any old one.
OLD="$(asc GET "/v1/profiles?filter%5Bname%5D=$(python3 -c "import urllib.parse;print(urllib.parse.quote('$PROFILE_NAME'))")" \
  | json "' '.join(p['id'] for p in d['data'].get('data', []))")"
for id in $OLD; do asc DELETE "/v1/profiles/$id" >/dev/null; done
PROFILE_JSON="$(asc POST /v1/profiles "{\"data\":{\"type\":\"profiles\",\"attributes\":{\"name\":\"$PROFILE_NAME\",\"profileType\":\"IOS_APP_STORE\"},\"relationships\":{\"bundleId\":{\"data\":{\"type\":\"bundleIds\",\"id\":\"$BUNDLE_REF\"}},\"certificates\":{\"data\":[{\"type\":\"certificates\",\"id\":\"$CERT_ID\"}]}}}}")"
json "d['status']==201 or sys.exit('error: profile not created: ' + json.dumps(d['data'].get('errors')))" <<< "$PROFILE_JSON" >/dev/null
json "d['data']['data']['attributes']['profileContent']" <<< "$PROFILE_JSON" | base64 -D > "$TMP/profile.mobileprovision"
security cms -D -i "$TMP/profile.mobileprovision" > "$TMP/profile.plist"
PROFILE_UUID="$(/usr/libexec/PlistBuddy -c 'Print :UUID' "$TMP/profile.plist")"
PROFILES_DIR="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
mkdir -p "$PROFILES_DIR"
cp "$TMP/profile.mobileprovision" "$PROFILES_DIR/$PROFILE_UUID.mobileprovision"

echo "==> Archiving build $BUILD_NUMBER"
xcodegen generate >/dev/null
ARCHIVE="$OUT_DIR/Flint.xcarchive"
rm -rf "$ARCHIVE" "$OUT_DIR/export"
mkdir -p "$OUT_DIR"
xcodebuild -project Flint.xcodeproj -scheme "$SCHEME" -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" -derivedDataPath "$OUT_DIR/build" archive -jobs 4 \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="$TEAM_ID" \
  CODE_SIGN_IDENTITY="$IDENTITY" PROVISIONING_PROFILE_SPECIFIER="$PROFILE_UUID" \
  OTHER_CODE_SIGN_FLAGS="--keychain $KC" \
  > "$OUT_DIR/archive.log" 2>&1 || { grep -E "error:" "$OUT_DIR/archive.log" | sort -u >&2; exit 1; }

echo "==> Exporting the .ipa"
cat > "$TMP/export.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>export</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>provisioningProfiles</key><dict><key>$BUNDLE_ID</key><string>$PROFILE_UUID</string></dict>
  <key>uploadSymbols</key><true/>
</dict></plist>
PLIST
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath "$OUT_DIR/export" \
  -exportOptionsPlist "$TMP/export.plist" > "$OUT_DIR/export.log" 2>&1 \
  || { grep -E "error" "$OUT_DIR/export.log" | sort -u >&2; exit 1; }
IPA="$OUT_DIR/export/Flint.ipa"
echo "    $IPA"

if [[ "$UPLOAD" == 1 ]]; then
  echo "==> Uploading to App Store Connect"
  API_PRIVATE_KEYS_DIR="$TMP/asc" xcrun altool --upload-app -f "$IPA" -t ios \
    --apiKey "$KEY_ID" --apiIssuer "$(cat "$TMP/asc/issuer")" --output-format normal
  echo "testflight: uploaded build $BUILD_NUMBER. It shows up in TestFlight once Apple finishes processing it."
else
  echo "testflight: built $IPA (build $BUILD_NUMBER), not uploaded."
fi
