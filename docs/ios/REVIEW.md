# Wave 5 review (5D)

Read-only review of branch `ios` at `876d4df feat(ios): wave 5 integrated`. It covers the whole iOS app (`apps/ios/App`, `apps/ios/LazyWeb`) and FlintCore, against PLAN.md Wave 5 (5D), DESIGN-NOTES.md and HANDOFF.md. No app code was changed. Paths below are relative to `apps/ios/` unless they start with `docs/` or `services/`.

Result: no critical or high findings. Three medium findings (a licence gap, unpinned dependency versions in the app build, and privacy declarations that depend on a decision about the receipts service), six low, seven info.

## What was run

| Check | Result |
|---|---|
| `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test` in `Packages/FlintCore` (macOS host, no simulator) | 782 tests in 134 suites passed |
| `python3 -I scripts/gen-third-party.py --check` | Clean: THIRD-PARTY.md matches `ThirdPartyLicenses.json` |
| Font `name` tables of the six bundled TTFs | Copyright and OFL URL present in each, matching THIRD-PARTY.md |
| Contents of the newest Flint.app in DerivedData (a Debug simulator build from 2026-10-25, older than 5C) and `nm` on its debug dylib | Bundles `GRDB_GRDB`, `swift-nio_NIOPosix`, `swift-nio-ssl_NIOSSL`, each with its own `PrivacyInfo.xcprivacy`. CNIOBoringSSL, SwiftSoup, GRDB, NIO and SwiftCross are linked; swift-crypto, NIOHTTP1/2, NIOExtras and NIOFileSystem are not |
| The generated `Flint.xcodeproj/project.pbxproj` | `PrivacyInfo.xcprivacy` is in the app's Resources phase |
| A bash 3.2 script with `trap ... EXIT` killed with TERM and INT | The EXIT trap runs in both cases, so `testflight.sh` cleanup runs on Ctrl-C |

Not run: UI tests, anything on a simulator or device, `testflight.sh` (it needs the owner at the Mac for 1Password, O4), `FLINT_INTEGRATION=1`. Nothing touched the owner's data, Keychain or simulators.

## Wave 4 R1: closed

R1 was: "Use the Mac's details" moved the iPhone's stored password to the bundle's servers without showing them. The fix holds against the code:

- `ServerChange.between` (`Packages/FlintCore/Sources/FlintPairing/ImportPlan.swift:40-46`) sorts an existing password account into `none`, `detailsOnly` (same IMAP and SMTP hosts, case-insensitive) or `hostChanged`.
- `hostChanged` rows are not in `conflictingAccounts` (`ImportPlan.swift:72`), so they have no switch. `BundleImporter.replace` also refuses them (`BundleImporter.swift:112`). The only way to switch is `switchServers` (`:64-66`), which goes through `addAccount` with a password the person types. `AccountService.addAccount` (`FlintMail/Auth/AccountService.swift:61-66`) checks that password against the bundle's servers before it writes the Keychain or the server. The stored password never reaches a new host.
- `detailsOnly` moves the servers only after `storedPasswordWorks` (`AccountService.swift:52-57`) logs in to them. The host is the same, and a remote endpoint with `secure == false` maps to mandatory STARTTLS with full certificate verification (`FlintMail/MailTransportTypes.swift:36-41`, `Transport/SwiftMailTransport.swift:52, 108-114`). A changed port, TLS flag or user name can therefore only send the stored password to the same, verified host. If the check fails, name, color and aliases still apply, the servers stay, and the done screen lists the account (`App/Features/Pairing/PairingReview.swift:228-229`).
- Every review row (ready, pending, conflict) shows both hosts, ports and the TLS flag (`PairingReview.swift:95, 108, 176`; `PairingText.swift:33-40`).
- Tests: `PairingImportTests.swift:218-223` (classification), `:237`, `:268`, `:278` (host change, typed password, wrong typed password).

What is left is by design: on a host change, the password the person types goes to the bundle's servers. The row names those servers. N3 from wave 4 (a link from someone on the same network) is still the way such a bundle would arrive.

## Findings, ranked

### Medium

**M1. THIRD-PARTY.md does not carry the BoringSSL licence texts, but the app ships BoringSSL.**
`THIRD-PARTY.md:1306-1311`, generated from `App/Features/Settings/ThirdPartyLicenses.json` by `scripts/gen-third-party.py`.
swift-nio-ssl vendors BoringSSL as `CNIOBoringSSL`, and it is linked into the app (3,926 matching symbols in the built dylib). 323 of its files say "Licensed under the OpenSSL license", and some carry the original SSLeay notice (Eric Young). It also vendors fiat-crypto (`third_party/fiat`). Both licences require the copyright notice and licence text to be reproduced in binary distributions. THIRD-PARTY.md only has swift-nio-ssl's Apache NOTICE, which links to the BoringSSL LICENSE but does not include it.
Scenario: a TestFlight or App Store binary ships BoringSSL without its required notices, and Settings > About > Licenses (the same catalog) has the same gap.
Fix: add a "BoringSSL (in swift-nio-ssl)" item to `ThirdPartyLicenses.json` with the full text of BoringSSL's LICENSE file at the vendored revision (OpenSSL License, SSLeay License, ISC, and the fiat-crypto MIT/Apache/BSD notice), then regenerate. swift-crypto vendors BoringSSL too, but it is not linked today, so listing it is harmless and not required.

**Status:** fixed in 1f57699. The catalog now has a "BoringSSL (in swift-nio-ssl)" item with the LICENSE text of the vendored revision (`817ab07`: OpenSSL License, Original SSLeay License, ISC, and the fiat-crypto MIT notice; the upstream file's Go and Chromium sections cover test and build code that is not compiled into the library, so they are left out). THIRD-PARTY.md is regenerated, and `scripts/gen-third-party.py --check` now also fails when the catalog lacks those texts or names a version other than `Package.resolved`. `AppTests/Settings/LicenseCatalogTests.swift` checks the texts.

**M2. The app build does not pin dependency versions, so a release can ship different packages than the ones tested and listed.**
`.gitignore:2` (`Flint.xcodeproj/`), `scripts/testflight.sh:96-107`.
The only committed `Package.resolved` is FlintCore's. Xcode resolves packages for the generated project and keeps its own resolved file under `Flint.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/`. That folder is gitignored, and no resolved file exists there now. `testflight.sh` runs `xcodegen generate` and archives with a fresh `-derivedDataPath`, so the archive takes the newest versions the manifests allow (`GRDB from: 7.11.1`, `swift-nio from: 2.101.3` through SwiftMail, `swift-nio-ssl from: 2.37.1`, and so on). Today the DerivedData checkouts happen to match FlintCore's pins.
Scenario: a GRDB or swift-nio-ssl release lands between `swift test` and the TestFlight run. The uploaded build contains code that no test ran, and THIRD-PARTY.md names the wrong versions.
Fix: commit a resolved file for the app. For example, have `testflight.sh` and `verify.sh` copy `Packages/FlintCore/Package.resolved` into `Flint.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved` after `xcodegen generate`, and pass `-onlyUsePackageVersionsFromResolvedFile` to `xcodebuild`, so a mismatch fails instead of resolving. Then check that `swift package show-dependencies` and the archive's checkouts agree.

**Status:** fixed in 63a32dd. `scripts/gen-project.sh` runs XcodeGen and copies FlintCore's `Package.resolved` into the generated project's workspace; `testflight.sh` and `verify.sh` use it and build with `-onlyUsePackageVersionsFromResolvedFile`. The Release build for generic iOS resolved swift-nio-ssl 2.37.5, GRDB 7.11.1, swift-nio 2.104.0 and SwiftSoup 2.14.3, the same as `swift test`. See RELEASING.md, "Package versions".

**M3. The privacy manifest and the App Privacy answers say no data is collected, but the owner runs a receipts service that the iPhone can be pointed at.**
`App/Resources/PrivacyInfo.xcprivacy:9-10`; `Packages/FlintCore/Sources/FlintReceipts/ReceiptsClient.swift:103-160`; `services/receipts/wrangler.toml:18-20`; `services/receipts/migrations/0001_init.sql`.
On iOS the receipts endpoint is empty by default (`FlintModel/Settings.swift:59-60`), so a fresh install sends nothing to xanom. But pairing can copy the Mac's endpoint (`flintr.xanom.co` by default on the desktop) behind its own switch, and the person can type it in Settings. From then on, the iPhone sends the owner's server an install ID and secret, a random message ref and one random token per tracked recipient (`ReceiptsWire.swift:10-16`). The server stores the install, registration times and an HMAC of the sender's IP (`sender_fingerprints`), and keeps them past the request. That is collection by the developer under Apple's definition. No message content, addresses or names are sent, which the code confirms.
Scenario: App Review or a user compares the "Data Not Collected" label with the privacy policy at flint.xanom.co/privacy, which describes the receipts service storing tokens and hashed IPs.
Fix: the owner decides (see "App Privacy answers" below). If the iOS app may use flintr.xanom.co, declare Identifiers > Device ID and Usage Data > Product Interaction, both not linked, not tracking, App Functionality, and add matching `NSPrivacyCollectedDataTypes` entries to the manifest. If it may not, block the xanom host in `normalizeEndpoint` on iOS and drop it from the pairing import.

**Status:** fixed in 7809a59 (manifest and test) and in the docs commit that follows it (this file and RELEASING.md). The owner chose option A: declare the data. `PrivacyInfo.xcprivacy` lists Device ID and Product Interaction (App Functionality, not linked, not tracking); `NSPrivacyTracking` stays false with no tracking domains. `AppTests/Settings/PrivacyManifestTests.swift` checks the manifest. The exact App Store Connect answers are in RELEASING.md, O3 step 4. Not verifiable here: the App Store Connect form itself.

### Low

**L1. One-click unsubscribe follows redirects; the desktop does not.**
`Packages/FlintCore/Sources/FlintService/Unsubscribe.swift:86-90`, `FlintMail/Auth/HTTPClient.swift:40-58`.
`oneClick` checks that the URL is public https and that the host resolves only to public addresses, then POSTs with `HTTPClient.live`. That `URLSession` follows redirects with no delegate. The desktop port uses `redirect: "manual"` (`packages/core/src/service/unsubscribe.ts:79`).
Scenario: a hostile newsletter's List-Unsubscribe URL answers 307 to `https://192.168.1.1/apply`. After the person taps Unsubscribe, the iPhone repeats the POST on the home network. iOS allows it because Local Network access was granted for pairing. The body is fixed and there are no cookies (ephemeral session), so the harm is limited to a blind POST to a LAN device with a valid certificate.
Fix: give the one-click POST a session delegate that refuses redirects (`willPerformHTTPRedirection` returning nil). A 3xx then counts as "not accepted" and falls through to mailto or browser, as on the desktop.

**Status:** fixed in be7a78c. `HTTPClient` has `postFormWithoutRedirects`, which refuses redirects through a task delegate, and the one-click POST uses it; a 3xx counts as not accepted and falls through to mailto or the browser. Test: `HTTPClientRedirectTests` (a stubbed 307 to a LAN address is returned and never followed) and `oneClickUsesThePostThatDoesNotFollowRedirects`.

**L2. A crafted List-Unsubscribe header crashes the app when the person taps Unsubscribe.**
`Packages/FlintCore/Sources/FlintService/Unsubscribe.swift:82`, `App/Features/Thread/ThreadRoot.swift:146`, `LazyWeb/LazyWeb.swift:20-23`.
With no http(s) target and a mailto that `parseMailto` rejects (for example `List-Unsubscribe: <mailto:?subject=x>` or `<mailto:%20>`, where the address is empty), `unsubscribe` returns `.browser(URL("mailto:..."))`. ThreadRoot puts it in `safariURL`, and `SFSafariViewController` raises `NSInvalidArgumentException` for any scheme other than http or https.
Scenario: a spam mail with that header, the person taps Unsubscribe, the app crashes. It is a denial of service only, and it repeats each time the person tries.
Fix: return `.browser` only for http(s) URLs in `Unsubscribe.swift:82` (throw the "not usable" error otherwise), and guard the scheme in `LazyWeb.safariController` as well.

**Status:** fixed in be7a78c. `unsubscribe` returns `.browser` only for http(s) addresses and otherwise throws "not usable", so a mailto that cannot be sent is never offered to the browser. `ThreadModel.showInBrowser` and `LazyWeb.safariController` both refuse any other scheme, so the Safari view can no longer be reached with one. Tests: `aHeaderWithNoWebAddressAndNoUsableMailtoIsNotOpenedInTheBrowser` (four headers) and `SafariEntryTests`. A valid mailto still sends from the account, as before; an unusable one now shows the "not usable" error and does not open the composer.

**L3. Pairing adds rules, signatures and blocked senders that the review screen shows only as counts.**
`Packages/FlintCore/Sources/FlintPairing/BundleImporter.swift:139-166`, `App/Features/Pairing/PairingReview.swift:57-67`.
"Add these" is on by default, and the review shows "3 new" per kind. A rule can trash, move, archive or mark read (`FlintModel/Rules.swift:33-41`) for an account on the phone. A signature is HTML that goes into every new mail.
Scenario: the N3 path from wave 4 (a `flint://pair` link to a listener on the same Wi-Fi, confirmed by the person). The bundle adds "From contains bank → Trash, Mark read" and a signature with a remote image. Bank alerts go to the server's Trash on every device, and each sent mail carries the attacker's pixel.
Fix: list rule names with their actions and signature names on the review screen (or behind a "Show" row). Alternatively, import rules disabled when they have a destructive action, and strip remote images from imported signatures.

**Status:** left open. Owner and product decision, as instructed (what the pairing review should show for rules, signatures and blocked senders).

**L4. Release builds honour test-only launch flags, including one that answers the Face ID lock.**
`App/Shell/FlintDebugFlags.swift:16-23`, `App/Shell/AppLock.swift:71-78`; also `App/Seed/DemoSeed.swift:26-27`, `App/Shell/LaunchRoute.swift:39`, `App/Seed/PerfProbe.swift:22`.
`FlintFakeAuth`, `FlintSeed`, `FlintRoute`, `FlintFakeNotifications`, `FlintThemeGallery` and `FlintPerfReport` are read from `UserDefaults.standard`. That reads the persistent app domain as well as launch arguments, and none of these reads is behind `#if DEBUG`. `FlintFakeAuth pass` replaces the Face ID prompt with success.
Scenario: a value written into the app's preferences plist (for example through a modified backup) keeps the app lock open on every launch. This needs the device passcode, so it adds little to an attacker who has it. It is still a security switch that ships in release.
Fix: compile these readers out of Release (`#if DEBUG`), or read them only from `ProcessInfo.processInfo.arguments` in Debug.

**Status:** fixed in ddf41fe. Every reader of `FlintFakeAuth`, `FlintSeed`, `FlintRoute`, `FlintPerfReport`, `FlintFakeNotifications`, `FlintSystemNotifications`, `FlintThemeGallery`, `FlintAppearance` and `-FlintPairingExisting` is inside `#if DEBUG`; the seed, probe and Face ID answer are also available when `FLINT_PERF` is defined, which only `scripts/perf-launch.sh` asks for in its Release build (documented in the script and in RELEASING.md; the archive never sets it). Checked on the Release generic iOS build: `strings` on the app binary finds none of the flag names or `perf50k`. UI tests run in Debug and are unaffected.

**L5. `testflight.sh` puts the .p12 password on a command line and resets the keychain search list to login only.**
`scripts/testflight.sh:67`, `:64`, `:70`, `:42`.
`security import ... -P "$P12_PASS"` and `security create-keychain -p "$KC_PASS"` are visible to `ps` for as long as they run. The keychain password is random and the keychain is deleted at exit, so only the .p12 password matters. `security list-keychains -d user -s "$KC" "$LOGIN"` replaces the user's search list, and cleanup sets it back to login only, so any other keychain the owner had in the list is dropped. Nothing secret is printed or written to the logs: the API key, issuer, .p8, .p12 and profile live in `mktemp -d` (mode 700), cleanup runs on EXIT, INT and TERM, `xcodebuild` logs get only the keychain path, and `asc.py` prints only `{status, data}`.
Scenario: another process run by the same user (or root) on the Mac reads the distribution certificate password from the process list during the import.
Fix: decrypt the .p12 without a password on argv (for example `openssl pkcs12 -passin fd:3 3<<<"$P12_PASS"` to a PEM in `$TMP`, then import that), or accept the risk on a single-user Mac and note it in RELEASING.md. Save the search list first (`security list-keychains -d user`) and restore exactly that list in cleanup.

**Status:** fixed in 63a32dd (same commit as M2). The .p12 password is read into a file in the 700 temp folder and handed to OpenSSL with `-passin file:`; OpenSSL writes a PEM that `security import` takes without a password, and the temporary keychain has an empty password, so no secret is ever an argument. `scripts/keychain-list.sh` saves the user's keychain search list before the run, puts the temporary keychain in front of it, and cleanup restores exactly the saved list. Tests: `scripts/tests/keychain-list-test.sh` (fake `security`, also run by `verify.sh`), and a manual run with a throwaway keychain and self-signed .p12 in a scratch folder (PEM import, partition list and list restore all worked). `testflight.sh` itself was only syntax-checked (`bash -n`).

**L6. `ITSAppUsesNonExemptEncryption` is false, but the app ships its own TLS library.**
`project.yml:95`, `App/Resources/Info.plist:51-52`.
Mail TLS runs through BoringSSL (NIOSSL), not the system TLS stack, and pairing uses X25519, HKDF and ChaCha20-Poly1305 from CryptoKit. App Store Connect's questionnaire treats standard algorithms used "instead of, or in addition to" the OS encryption differently from plain URLSession HTTPS. That usually still means no documents, but it is a separate answer, and France has its own declaration.
Scenario: the plist key skips the export compliance questions on every upload, and the stored answer does not match what the binary does.
Fix: part of O3. The owner answers the questionnaire once for this build (standard algorithms, not proprietary, mass market), then sets the key to the value Apple's flow gives. If the answer stays "exempt", record the reasoning in RELEASING.md.

**Status:** left open. Owner item O3 (export compliance questionnaire), as instructed.

### Info

- **I1. Keychain items outlive the app.** `Packages/FlintCore/Sources/FlintMail/Auth/KeychainSecretStore.swift:73-84`. The class and accessibility are right: generic password, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, not synchronizable, data protection keychain on iOS, and matching the database's `completeUntilFirstUserAuthentication`, so background runs work after the first unlock. Account removal deletes the item (`AccountService.swift:143`). Deleting the app does not, so passwords, refresh tokens and receipts credentials stay in the Keychain after uninstall. Consider clearing service `co.xanom.flint.account` on the first launch that finds no database.
- **I2. The reader page has no CSP, and the remote-load rule leaves one resource type open.** `App/Features/Thread/ReaderDocument.swift:41-44`, `Packages/FlintCore/Sources/FlintHTML/ContentRules.swift:20-21`. The reader is otherwise locked down: page JavaScript off, non-persistent store, `baseURL: nil`, every navigation after the first cancelled, child frames blocked, an allowlist sanitizer (no iframe, form, link, meta or base), links routed through `LinkPolicy` (http, https and mailto only, with a phishing confirm), the attachment scheme serving only `image/*` parts of the same message, `isInspectable = false`, and a plain-text fallback when the rule lists fail to compile. The remote-load rule blocks every resource type except `document` and `other`. Nothing in sanitized HTML should produce an `other` load, but adding `"other"` and a `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: cid: flint-attachment:">` (plus `https:` when images are allowed) would make that a guarantee.
- **I3. "no TLS" overstates the risk for remote servers.** `App/Features/Pairing/PairingText.swift:34`. For a remote host, `secure == false` means mandatory STARTTLS with certificate checks, so the password does not cross the network in the clear. "STARTTLS" would be accurate. Only loopback hosts can be plain.
- **I4. ATS has no exceptions.** That is correct, and every endpoint the core uses is https (Google, ISPDB, receipts; `normalizeEndpoint` allows http only for loopback). One side effect: "Load images" cannot load `http://` images in the reader, because WKWebView loads are subject to ATS. That is good for privacy and differs from the desktop.
- **I5. The mail database is included in device backups.** `Packages/FlintCore/Sources/FlintService/FileProtection.swift:8-12`. Application Support is backed up (encrypted iCloud or Finder backups). Credentials are `ThisDeviceOnly`, so a restored backup has mail but no logins. This is a reasonable default. Excluding the database (`isExcludedFromBackup`) would keep mail off backups, at the cost of a full resync after a restore.
- **I6. Notification previews do not follow the app lock.** `App/Features/Notifications/NotificationPolicy.swift:47-60`. With "Require Face ID" on, alerts still show sender and subject (and codes) on the lock screen unless Preview is set to Hidden. That matches the desktop and the system's own "Show Previews" setting. A hint under the Face ID switch would help. Lock-screen Archive and Mark read require unlock; Copy code opens the app.
- **I7. Open items carried from wave 4 and wave 5.** Swift-to-TS pairing e2e for wrong code, replay and tamper (unit tests cover them, the cross-implementation script does not); account avatars from the Mac decoded but not applied; simulated BGTask launch (QA 12.4); interactive checks of Quick Look and Google sign-in through FlintLazyWeb; App Store export with the embedded FlintLazyWeb.framework; the signed `.ipa` (O4); real-device checks (O5).

## Security areas checked and found sound

- **OAuth.** PKCE S256 with a 32-byte verifier, a random 16-byte `state` checked on return, no client secret, `ASWebAuthenticationSession` with a custom-scheme callback (never a web view), and login CSRF defeated by PKCE. Tokens live only in the Keychain. Refresh is single-flight per account and five minutes early. Token errors map to fixed messages (only Google's `error` code is read). `HTTPClient.live` and the receipts transport use ephemeral sessions with no cache, cookies or credential storage.
- **Logging.** The app and FlintCore have no `print`, `NSLog` or `os_log` calls. The single `os.Logger` is the swift-log bridge in `FlintService/PrivacyLogging.swift`, which keeps only level and logger label at warning and above, drops metadata, and forwards only the IDLE "reconnected" signal, never its text. SwiftMail's sources have no direct logging. `MailCredential` and the HTTP code are commented and written so secrets never reach error text.
- **TLS.** Certificate verification is full except for loopback hosts. A remote non-TLS port must upgrade with STARTTLS or fail.
- **Deep links.** `flint://pair#...` stops at a confirm step that shows the host, and offers must name private, link-local, loopback or `.local` hosts (wave 4). The Google redirect scheme is only kept for a cold launch. The reader never opens `flint://` or other custom schemes from mail.
- **Entitlements.** There is no entitlements file and none is needed: no push, iCloud, App Groups, associated domains or keychain sharing. Background modes (`fetch`, `processing`), both `BGTaskSchedulerPermittedIdentifiers`, and the usage strings (Local Network, Camera, Face ID, Calendars write-only) are all present and accurate. Photos uses the picker, so it needs no permission.
- **Pasteboard.** Codes are written `localOnly` (no Universal Clipboard) with an expiry (`CodeClipboard.swift:17-19`, `InboxList.swift:98-99`, `MessageCardView.swift:136`).
- **App lock.** A separate window at alert level + 100 covers sheets and the keyboard, `accessibilityViewIsModal` is set, the app switcher snapshot is shielded while inactive, and keyboard shortcuts are off while covered.
- **Background.** Wave 4's findings are fixed (listeners in warm runs, completion on expiry, retry after a failed bootstrap), and processing requests require network.
- **Pairing crypto and allowlist.** Wave 4's security read still applies, now with the SAS bound to both public keys. `NetworkConnector` no longer traps on a port above 65535.

## Licences

The table in THIRD-PARTY.md matches `Packages/FlintCore/Package.resolved` for every package the app can link, at the same versions and revisions. It omits swift-argument-parser and swift-dotenv (SwiftMail's CLI demos only, correctly) and lists a few packages that are resolved but not linked (swift-crypto, swift-certificates, swift-asn1, NIO HTTP/2 and extras, http-types, service-lifecycle). Listing extras is harmless.

| Component | Licence | In THIRD-PARTY.md |
|---|---|---|
| SwiftMail 88c45cb | BSD 2-Clause | Yes, full text |
| swift-nio, swift-nio-ssl, swift-nio-imap, swift-log and other Apple packages | Apache 2.0 | Yes, text plus each NOTICE |
| BoringSSL inside swift-nio-ssl | OpenSSL + SSLeay + ISC, fiat-crypto | **No (M1)** |
| GRDB.swift 7.11.1 | MIT | Yes |
| SwiftSoup 2.14.3, SwiftCross 1.2.0 | MIT | Yes |
| Lucide (50 icons) | ISC, MIT for Feather-derived icons | Yes, both texts and the Feather list |
| Geist, Geist Mono, Newsreader (static instances) | SIL OFL 1.1 | Yes. The embedded name tables carry the copyright and OFL URL; neither family declares a Reserved Font Name, so static instances may keep the names |
| QR scanning | VisionKit, no library | Correctly not listed |
| `mailDark.bundle.js` | Flint's own desktop code (no npm imports) | Not needed |

## Privacy manifest

`App/Resources/PrivacyInfo.xcprivacy` declared (at review time) no tracking, no tracking domains, no collected data, and one required-reason API: UserDefaults with `CA92.1`.

- App code: UserDefaults (`@AppStorage`, settings, swipe configuration, diagnostics, paired-Mac record) is the only required-reason category used. There are no file timestamp reads (`DraftFiles` reads only `fileSizeKey` and `isRegularFileKey`), no disk space queries, no `systemUptime` or `mach_absolute_time` (the sync code uses `ContinuousClock`), and no active keyboard queries. `PerfProbe`'s `sysctl(KERN_PROC_PID)` reads the process start time, which is not on Apple's list. `CA92.1` is the right reason.
- Dependencies: NIOPosix, NIOFS and _NIOFileSystem ship manifests declaring FileTimestamp `0A2A.1`; NIOSSL, GRDB and the swift-crypto targets ship manifests declaring no API use. The built app carries the GRDB, NIOPosix and NIOSSL bundles with their manifests. swift-system wraps `stat`, `lstat` and `fstat` without a manifest of its own, but only `_NIOFileSystem` uses it, and that is not linked. SwiftMail, SwiftSoup, SwiftCross, swift-nio-imap and swift-log call none of the listed APIs.
- Collected data: Device ID and Product Interaction are now declared (M3), matching an iPhone that uses the xanom-run receipts service.

## App Privacy answers (for App Store Connect)

**Decision (2026-10-27): the owner chose option A, declare the data.** The privacy manifest has the two entries below (fixed in 7809a59), and the exact entries to make in App Store Connect are in RELEASING.md, O3 step 4. Option B is kept below only as the record of the alternative.

**Tracking:** No. There is no ad SDK, analytics or IDFA, and no data is combined with third-party data.

**Data collection, option A (CHOSEN; pairing can import `flintr.xanom.co`):** "Yes, we collect data."

| Data type | Collected for | Linked to the user | Used for tracking | What it is |
|---|---|---|---|---|
| Identifiers > Device ID | App Functionality | No | No | The receipts install ID (random, made by the service) and an HMAC of the IP the iPhone calls from, used to drop the sender's own opens. No account, email address or name goes with it |
| Usage Data > Product Interaction | App Functionality | No | No | When a tracked message was registered and how many recipient tokens it has. The message ref and tokens are random |

Not collected under option A: Contact Info, Contacts, User Content (mail bodies, subjects and addresses never reach the receipts service), Location (the service derives a city or country for the recipient's open, not for the user), Health, Financial, Browsing or Search History, Diagnostics, Purchases, Sensitive Info. The privacy manifest lists `NSPrivacyCollectedDataTypeDeviceID` and `NSPrivacyCollectedDataTypeProductInteraction`, each with `NSPrivacyCollectedDataTypeLinked` false, `NSPrivacyCollectedDataTypeTracking` false and purpose `NSPrivacyCollectedDataTypePurposeAppFunctionality`.

**Data collection, option B (not chosen; only if the iOS app could never point at a xanom-run service):** "No, we do not collect data from this app." The manifest no longer matches this.

Under either option, these flows are not developer collection, because the data goes straight to services the user chose and xanom has no access to it: IMAP and SMTP to the user's own mail servers; Google sign-in and Gmail; Mozilla's ISPDB (`autoconfig.thunderbird.net`), which receives only the email domain during setup; DNS MX lookups; one-click unsubscribe POSTs to the sender's URL; a self-hosted receipts endpoint. The privacy policy URL (flint.xanom.co/privacy) is required either way and should mention the iPhone app.

## TestFlight script

`scripts/testflight.sh` and `scripts/asc.py` never print or store a secret outside the temporary folder. The API key id, issuer, `.p8`, `.p12` and its password come from 1Password on the Proton account by user id. They live in a `mktemp -d` folder and a temporary keychain that cleanup deletes on exit (also after INT or TERM). The JWT is built in memory and never printed. `testflight.local.sh` is gitignored (`.gitignore:10`, confirmed with `git check-ignore`), and the committed example holds only 1Password item ids. The archive and export logs in `.derived/testflight` contain the temporary keychain path, but no password. The remaining points are L5 (password on argv, keychain search list) and M2 (unpinned packages).
