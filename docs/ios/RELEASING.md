# Releasing Flint for iOS to TestFlight

Everything runs from `apps/ios` on the owner's Mac. Credentials are read from 1Password when the script runs and live only in a temporary folder and keychain that are deleted on exit. Nothing secret is printed, logged or committed (no `.p8`, no `.p12`).

## Identity

| Item | Value |
|---|---|
| Bundle id | `co.xanom.flint` |
| Team | `VTQW687WBQ` (individual account) |
| Scheme | `Flint` |
| Profile | "Flint App Store" (made fresh on every run through the App Store Connect API, type `IOS_APP_STORE`) |
| Signing | Manual, Apple Distribution certificate from 1Password |
| Capabilities | none beyond Background Modes (no push, iCloud or App Group), so the App ID needs no capabilities |
| Xcode | `/Applications/Xcode.app` (release Xcode, not the beta) |

## Owner items

- **O3, App Store Connect record and export compliance.** The account holder does this once on appstoreconnect.apple.com:
  1. Register the App ID `co.xanom.flint` (Certificates, Identifiers & Profiles > Identifiers > iOS) if `scripts/testflight.sh` stops with "the App ID co.xanom.flint is not registered". No capabilities.
  2. My Apps > New app: platform iOS, name Flint, bundle id `co.xanom.flint`, primary language English, any SKU. The API key cannot create app records on an individual account, and agents do not create them.
  3. Export compliance: the build sets `ITSAppUsesNonExemptEncryption` to `false`. That answer holds only while the app uses OS cryptography (TLS, CryptoKit, Keychain) and nothing custom. Confirm it when the first build asks.
  4. App Privacy answers: the owner chose to declare the receipts data (REVIEW.md, M3, option A). Enter exactly this, and keep it in step with `App/Resources/PrivacyInfo.xcprivacy` (a unit test checks the manifest):
     - Privacy policy URL: `https://flint.xanom.co/privacy`.
     - "Do you or your third-party partners collect data from this app?" Yes.
     - Data types to select, and only these two:

       | Data type | Used for | Linked to the user's identity | Used for tracking |
       |---|---|---|---|
       | Identifiers > Device ID | App Functionality | No | No |
       | Usage Data > Product Interaction | App Functionality | No | No |

     - For each of the two, answer the follow-up questions: purpose App Functionality only (not Analytics, Product Personalization, Advertising, or Other); "Is this data linked to the user's identity?" No; "Do you or your partners use this data for tracking purposes?" No.
     - Leave every other data type unticked (Contact Info, Contacts, User Content, Location, Browsing and Search History, Diagnostics, Purchases, Financial, Health, Sensitive Info).
     - Tracking: no. The manifest has `NSPrivacyTracking` false and no tracking domains.

     What the two answers stand for: the iPhone only talks to the receipts service (`flintr.xanom.co`) when the person has turned receipts on, and then it sends a random install ID, a random message ref and one random token per tracked recipient. The service keeps those plus an HMAC of the sender's IP. No mail content, address or name leaves the phone. Mail servers, Google sign-in, Mozilla's ISPDB, DNS lookups and one-click unsubscribe requests go straight to services the person chose and are not developer collection.
- **O4, 1Password approval.** Run the script with the owner at the Mac. `op` uses the desktop app integration on the Proton account (user id `E3OXZANXQRDOBNXQMPXZ6YBHTY`, not the email). 1Password must be unlocked and the owner approves the CLI prompt. If the run says `authorization timeout` or `account is not signed in`, nobody approved the prompt in time: unlock 1Password and run again.

## One-time setup

```bash
cd apps/ios
cp scripts/testflight.local.sh.example scripts/testflight.local.sh   # gitignored; names and ids only
```

The example already holds the 1Password account id and the two item ids (API key item, distribution certificate item, vault Private). Python 3 needs the `cryptography` module for `scripts/asc.py`.

## Steps

```bash
cd apps/ios
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
scripts/testflight.sh --no-upload   # dry run: signed .ipa at .derived/testflight/export/Flint.ipa
scripts/testflight.sh               # same, then uploads with altool
```

What the script does, in order: loads the API key and certificate from 1Password into a temp folder, imports the certificate into a temporary keychain (the .p12 password is passed to OpenSSL through a file in the temp folder, never on a command line, and the temporary keychain is added to the front of your keychain search list, which is put back exactly on exit), looks up the App ID, deletes any old "Flint App Store" profile and makes a new one, runs `scripts/gen-project.sh` (XcodeGen, then the package pins below), archives Release with `-onlyUsePackageVersionsFromResolvedFile` with manual signing, exports for `app-store-connect`, and (without `--no-upload`) uploads with `xcrun altool --upload-app`.

Options through the environment: `BUILD_NUMBER` (default is the UTC timestamp `yyyymmddHHMM`, which always increases), `OUT_DIR` (archive, export and logs; default `.derived/testflight`, gitignored), `OP_VAULT`. The marketing version comes from `MARKETING_VERSION` in `apps/ios/project.yml`; bump it there for a new release train.

## Package versions

The generated `Flint.xcodeproj` is gitignored, so the app build would otherwise resolve the newest packages the manifests allow. `scripts/gen-project.sh` runs `xcodegen generate` and then copies `Packages/FlintCore/Package.resolved` into `Flint.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/`. `testflight.sh` and `verify.sh` call it and build with `-onlyUsePackageVersionsFromResolvedFile`, so the archive uses exactly the versions `swift test` ran against and THIRD-PARTY.md lists, and a mismatch fails the build. Run `scripts/gen-project.sh` instead of a bare `xcodegen generate`. To update a dependency: `swift package update` in `Packages/FlintCore`, run the tests, regenerate THIRD-PARTY.md, commit `Package.resolved`.

## Test-only launch flags

`-FlintSeed`, `-FlintRoute`, `-FlintFakeAuth`, `-FlintFakeNotifications`, `-FlintSystemNotifications`, `-FlintThemeGallery`, `-FlintAppearance`, `-FlintPerfReport` and `-FlintPairingExisting` exist only in Debug builds (`#if DEBUG`), so a Release or App Store build ignores them whatever its preferences hold. `scripts/perf-launch.sh` needs three of them (`-FlintSeed perf50k`, `-FlintPerfReport`, `-FlintFakeAuth`) in a Release build: build that one with `SWIFT_ACTIVE_COMPILATION_CONDITIONS=FLINT_PERF` (see the script header). Never pass that to an archive.

## Before a build

- `swift test` in `apps/ios/Packages/FlintCore` and the app unit tests are green.
- `python3 -I scripts/gen-third-party.py --check` passes (regenerate `THIRD-PARTY.md` without `--check` when a dependency changes; the check also fails when the catalog lacks the BoringSSL licence texts that swift-nio-ssl needs, or names a version other than `Package.resolved`; the same catalog feeds Settings > About > Licenses).
- Third-party privacy manifests: GRDB, NIOPosix and NIOSSL ship their own and land in the app bundle. The app's own `App/Resources/PrivacyInfo.xcprivacy` declares UserDefaults (CA92.1), no tracking, and the two collected data types from O3 step 4 (Device ID, Product Interaction; App Functionality, not linked, not tracking).

## After upload

Apple processes the build for a few minutes, then it appears in TestFlight. Add the owner as an internal tester. The owner then installs on a device (O5) and checks: add a Google account, send a tracked mail, receive a code notification, pair from the Mac. Agents cannot do these.

## Troubleshooting

| Message | Cause and fix |
|---|---|
| `authorization timeout`, `account is not signed in` | 1Password prompt not approved. See O4. |
| `the App ID co.xanom.flint is not registered` | Register it (O3 step 1). |
| `profile not created` with an error body | Usually the certificate id in the item is stale, or the certificate is not an Apple Distribution one. |
| Archive fails with `error:` lines | Full log at `$OUT_DIR/archive.log`; export problems in `$OUT_DIR/export.log`. |
| Upload says the app record does not exist | O3 step 2 is not done. |
