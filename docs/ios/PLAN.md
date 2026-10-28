# Flint for iOS: build plan

Read [DESIGN-NOTES.md](DESIGN-NOTES.md) first; section numbers below refer to it. Branch `ios`. Nothing here is built yet.

## Ground rules for every agent

- Work only in the paths your track owns. If you need a change in a file another track owns, add a short note to `docs/ios/HANDOFF.md` (one line: file, change, why) instead of editing it.
- Interfaces first. Wave 1 freezes `FlintModel` types and the `MailTransport`, `Store` and `SecretStore` protocols. Changing a frozen file needs the wave lead's sign-off and a note in HANDOFF.md.
- Default verification is `swift test --package-path apps/ios/Packages/FlintCore` on the Mac host (one target: `--filter <Suite>`). Do not run Xcode or simulators unless the track says so (section 11).
- Core code is pure Swift: no UIKit, no SwiftUI. Immutable value types, small files (target 200 to 400 lines, 800 max), functions under 50 lines.
- Tests first for anything under `Packages/FlintCore`. 80% line coverage on logic modules.
- Never log or print bodies, tokens, passwords, or 1Password values. No secrets in files.
- Ported logic changes its shared fixture in the same change as the TS source (section 5). Do not hand-edit Swift fixture copies; run `scripts/sync-fixtures.sh`.
- User-facing text follows DESIGN.md section 8 (plain, sentence case, no exclamation marks, no emoji).

## Owner gates (only the owner can do these)

| # | Gate | Needed by | Notes |
|---|---|---|---|
| O1 | Confirm bundle id `co.xanom.flint` (fallback `co.xanom.flint.ios`) after the Wave 1 portal check | before O2 | Google client is bound to it |
| O2 | In Google Cloud (same project as the desktop client): create an **iOS** OAuth client with the bundle id, add the owner as test user, then publish "In production" (unverified) so tokens do not expire in 7 days. Hand the client id (not a secret) to the agents | Wave 1 spike G1, Wave 3 Google sign-in | Team ID field optional, leave App Check off in v1 |
| O3 | Register the App ID (if the ASC API key cannot) and create the **App Store Connect app record** (account holder only), answer export compliance | Wave 5 TestFlight | Individual account rule from `APPLE_SIGNING.md` |
| O4 | `op` sign-in on the Proton account (user id `E3OXZANXQRDOBNXQMPXZ6YBHTY`) when `testflight.sh` runs | Wave 5 | Keep `scripts/testflight.local.sh` gitignored |
| O5 | Device testing on a real iPhone (and iPad if available): background refresh cadence, local-network prompt, Google sign-in, Face ID | Waves 4 and 5 | Agents cannot do these; say so in reports instead of claiming them tested |
| O6 | Decide: AI in v1 (default no), invite card scope, and whether simulator UI runs are allowed (section 11) | before Wave 4 | |
| O7 | Optional later: APNs key and push entitlement if the relay is ever built | post-v1 | Account holder |

## Wave 1: skeleton and spikes

Goal: an app that launches on the simulator with the Flint theme, an empty `FlintCore` that builds on macOS and iOS, frozen interfaces, fixtures exported from TS, and answers to the open questions.

| Track | Owns | Tasks |
|---|---|---|
| 1A App shell | `apps/ios/project.yml`, `apps/ios/App/Shell`, `App/Theme`, `App/Resources`, `AppTests`, `AppUITests` (stub), `.gitignore` additions | XcodeGen project (name Flint, bundle id from O1/portal check, team VTQW687WBQ, iOS 26.0, Swift 6, iPhone + iPad, Background Modes: fetch + processing, `NSLocalNetworkUsageDescription`, `NSCameraUsageDescription`, `ITSAppUsesNonExemptEncryption`). Color asset catalog from DESIGN.md tokens (Graphite/Paper), Geist/Geist Mono/Newsreader fonts + `FlintFont` roles with Dynamic Type, Lucide subset, `FlintBar`, `FlintRow`, `FlintAvatar` (eight hashed tints), a Theme gallery screen behind a debug flag. Port `tokens.test.ts` contrast test |
| 1B Core package | `apps/ios/Packages/FlintCore/Package.swift`, `Sources/FlintModel`, protocol files in `FlintMail` (`MailTransport.swift`), `FlintStore` (`Store.swift` protocol only), `FlintService` (empty), `SecretStore.swift` | Package with the seven library targets; SwiftMail dependency **by revision** (`88c45cbd31b347b373f7c87e197be63eb95efbc2`, 1.16.0); GRDB 7.x; SwiftSoup. `FlintModel` mirrors `packages/core/src/types.ts` (Account, Folder, Thread, Message, Address, Category, Settings, FlintEvent, FlintError). Define `MailTransport` (connect, list folders, select, fetch envelopes/flags/bodystructure/parts, store flags, move, append, search, idle stream, send) and the in-memory `FakeMailTransport`. Platforms macOS 15 + iOS 26 so `swift test` runs on the host |
| 1C Fixtures | `packages/core/fixtures/`, `scripts/fixtures/*`, `apps/ios/scripts/sync-fixtures.sh`, edits to `packages/core/src/**/*.test.ts` that only move data into JSON | Export fixtures: categorize, codes, search, threadkey, rules, receipts-status, receipts-pixel, trackers, providers, sanitize, tokens. Change the desktop tests to read them. Add `meta.version`. `sync-fixtures.sh [--check]` copies into `Packages/FlintCore/Tests/FlintCoreTests/Fixtures` |
| 1D Spikes | `docs/ios/spikes/*.md` (results only), throwaway code under `apps/ios/Spikes/` (deleted at end of wave) | S1 SQLite: print `sqlite3_libversion()` and test `CREATE VIRTUAL TABLE ... fts5(... contentless_delete=1)` on iOS 26.5 and 27.0 simulators. S2 SwiftMail probe CLI against GreenMail (script starts it on fixed ports): login, list, select, fetch, flags, MOVE, APPEND, IDLE wakes on delivery, QRESYNC select where GreenMail supports it (it likely does not; record), XOAUTH2 path unit-checked with a stub. S3 Liquid Glass: does `UIDesignRequiresCompatibility` still work on the iOS 27 SDK; screenshot of custom `FlintBar`. S4 Bundle id: `asc.py GET /v1/bundleIds?filter[identifier]=co.xanom.flint` (read-only, no secrets printed). S5 (needs O2) Google: `ASWebAuthenticationSession` round trip with the iOS client, token exchange without a secret, call IMAP XOAUTH2 against imap.gmail.com, record refresh-token behavior. S6 NWListener on loopback while a web auth session is up (the AI sign-in question; unblocks the Wave 6 decision) |

Acceptance (Wave 1):
- `xcodegen generate && xcodebuild -scheme Flint -destination 'generic/platform=iOS Simulator' build` succeeds with `/Applications/Xcode.app`; app launches to the theme gallery in light and dark.
- `swift test` on FlintCore passes with the fixture sync check clean; desktop `pnpm test` still passes after the fixture move.
- Spike reports exist for S1 to S4 and S6 with a go/no-go line each; S5 once O2 is done. Decisions that change DESIGN-NOTES.md are edited into it.
- `FlintModel`, `MailTransport`, `Store`, `SecretStore` committed and marked frozen in a header comment.

## Wave 2: engine

All tracks are pure Swift under `Packages/FlintCore`, parallel after Wave 1. Each ships with tests that load the shared fixtures.

| Track | Owns | Tasks |
|---|---|---|
| 2A Store | `Sources/FlintStore`, `Tests/.../Store*` | GRDB migrations 1 to 8 ported verbatim in naming; repositories (threads, messages, folders, drafts, signatures, templates, rules, blocked senders, contacts, tracked/receipts, settings, kv_cache, pending_ops); thread-key resolution and merge; rollups; search operator parser to SQL + FTS5 (`from: to: cc: subject: has:attachment is:unread is:read is:pinned is:snoozed in: before: after: account:` quotes, negation, prefix on last word); unified/per-account list queries with category filters |
| 2B Mail engine | `Sources/FlintMail` (except Auth/Autoconfig), `Tests/.../Mail*` | `SwiftMailTransport` (the only file importing SwiftMail); account sync (folders and roles, Gmail All Mail/Spam/Trash with X-GM ids and labels to `message_folders`, generic folder set, initial window newest first in 200-message batches, bodies for recent days, incremental by UID, UIDVALIDITY reset, QRESYNC, Gmail flag window refetch, expunge detection, reconnect backoff 5 s to 5 min, `NWPathMonitor` trigger); optimistic actions + `pending_ops` replay; Gmail archive/trash by MOVE; generic MOVE/create Archive; MIME parse and compose (alternative text+html, inline cid, attachments, References/In-Reply-To), per-recipient tracked copies, clean Sent APPEND; scheduler pieces that do not need UI (undo window, scheduled-send store, reminder store) |
| 2C Accounts and auth | `Sources/FlintMail/Auth`, `Sources/FlintMail/Autoconfig`, `Tests/.../Auth*` | Keychain `SecretStore`; Google OAuth logic (PKCE, auth URL, code exchange, refresh 5 min early, ID-token parse, `auth_error` state) with an injectable HTTP client; autoconfig (presets from `providers.json`, ISPDB, MX via `DNSServiceQueryRecord`, host guesses); `testConnection` (IMAP login + SMTP verify); account add/remove/edit service |
| 2D Classify | `Sources/FlintClassify`, `Tests/.../Classify*` | Categorizer + `rollupCategory`, code detector, rules matching and actions, `needsReply`, `CATEGORIZER_VERSION` handling and `recategorizeAll` plan. Fixture suites must be green, including non-ASCII cases (section 5 regex notes) |
| 2E HTML and receipts | `Sources/FlintHTML`, `Sources/FlintReceipts`, `scripts/gen-maildark.sh`, `App/Resources/mailDark.bundle.js` | SwiftSoup sanitizer pre-pass, tracker matching from `trackers.json`, WKContentRuleList JSON builders (block-all-remote, per-message allow), receipts client (install, register, delete, events with cursor, status derivation, pixel injection, `canonicalAddress`, endpoint normalization). `gen-maildark.sh` esbuilds the desktop adapter and has `--check` |

Then, after 2A to 2E merge: **2F Service facade** (owner of `Sources/FlintService`): composes the above into the `FlintService` API the UI calls (observable streams for threads, folders, sync status; actions; compose/send; settings), plus an event bus matching `FlintEvent`.

Acceptance (Wave 2):
- `swift test` green, 80%+ line coverage on `FlintStore`, `FlintMail`, `FlintClassify`, `FlintReceipts`, `FlintHTML` (`swift test --enable-code-coverage` report in the PR).
- **GreenMail integration suite** (`Tests/FlintCoreTests/Integration`, guarded by `FLINT_GREENMAIL=1`, started by `apps/ios/scripts/greenmail.sh` which reuses `packages/core/.cache/greenmail-standalone-1.6.15.jar` and Java 8): add account, initial sync, new mail via IDLE, mark read, archive, trash, send with a tracked recipient, send to self, Sent copy, reconnect after server restart. Runs on the Mac host through `swift test`, no simulator. Features GreenMail cannot do (X-GM, QRESYNC, CONDSTORE) are covered by recorded-transcript tests on `FakeMailTransport` and by the swift-nio-imap embedded-channel pattern SwiftMail's own tests use.
- A 20k-message synthetic mailbox: first list query under 50 ms, FTS query under 100 ms, on the host.
- One live Gmail smoke (owner account, after S5): initial sync of 90 days, archive via MOVE verified to drop the Inbox label, IDLE push. Run by the owner or an agent given the O2 client; record results in `docs/ios/spikes/gmail-live.md`.

## Wave 3: UI

All SwiftUI under `apps/ios/App/Features/<Name>/`, parallel after 2F. Every interactive view gets an `accessibilityIdentifier`; strings go in `<Name>.xcstrings`. Each feature registers itself in the `FeatureModule` registry (file owned by 1A; features add one line each via HANDOFF.md or a separate registration file per feature).

| Track | Owns | Scope |
|---|---|---|
| 3A Onboarding | `Features/Onboarding` | Welcome, Google, Other email with autoconfig summary and test, first-run choices, empty states. "Set up from your Mac" row is present and disabled until 4E |
| 3B Sidebar and accounts | `Features/Sidebar` | Sheet on iPhone, column on iPad: unified inbox with per-account children (avatar, address, unread), Pins, Drafts, Sent, Scheduled, Snoozed, Trash, Folders/labels, Recents, Settings. Account switching, sync status line |
| 3C Inbox | `Features/Inbox` | Unified and per-account list, date group labels (Geist Mono label style), Smart inbox with Notifications and Newsletters bundle rows, unread dot, pin, avatar, skeleton rows, pull to refresh, multi-select, configurable swipe actions (archive, trash, pin, snooze, read, move), undo toast |
| 3D Thread | `Features/Thread` | Header, message cards (12 px), plain-text and HTML reader per section 5 security list, dark adaptation, Load images, tracker count, attachments (QuickLook), quoted-text collapse, reply dock, inline "Original/Adapted" toggle, receipts row placeholder |
| 3E Composer | `Features/Composer` | New/reply/reply all/forward, recipients with contact suggestions, from-account picker with alias, subject, native rich text (`TextEditor` + `AttributedString`: bold, italic, link, list) converted to HTML + text, signature insertion per account, attachments (Photos, Files, camera), drafts autosave to local and server Drafts, undo send, schedule sheet, read-receipt toggle |
| 3F Search | `Features/Search` | Search field with operator chips and suggestions, results as threads, recents |
| 3G Settings | `Features/Settings` | Everything in the section 6 settings map except Devices/AI; signature and template editors; rules and blocked senders lists; account detail with re-auth and remove; Privacy (images, trackers, Face ID lock); About with licenses |

Acceptance (Wave 3):
- App builds for iPhone and iPad simulators; the seeded launch (`-FlintSeed demo`, a fixture mailbox loaded by `AppTests` support code) shows every screen with realistic data in Graphite and Paper.
- Add Google account, add GreenMail account, read, reply, send, archive, snooze, search all work end to end (manual script in `docs/ios/QA-CHECKLIST.md`, run by the lead; items needing a device are marked for O5).
- No system glass or shadows on app chrome (checked against S3 result); Dynamic Type through AX3 does not clip list rows or the composer; VoiceOver labels on all rows and actions.
- iPad: three columns in landscape and portrait, hardware-keyboard shortcuts for the DESIGN/SPEC subset (compose, reply, archive, next/previous, search).

## Wave 4: features

Parallel; each depends on 2F and the relevant Wave 3 screen.

| Track | Owns | Scope |
|---|---|---|
| 4A Receipts UI | `Features/Receipts` + hooks in `Features/Composer` (via HANDOFF) | Tracking toggle default, per-recipient status chips (replied > opened > unknowable > sent, "Receipts unavailable for this message"), Read Statuses list, polling on foreground and in refresh, honest copy |
| 4B Codes and notifications | `Features/Notifications`, `Features/Codes`, `App/Shell/Background.swift` | Notification permission flow, categories and actions (Archive, Mark read, Copy code opens app and copies), local notifications for new people mail and codes, grouped summary, `BGAppRefreshTask` + `BGProcessingTask` registration and rescheduling, `beginBackgroundTask` around sends and syncs, snooze/reminder/scheduled-send local notifications, Codes strip, "Check now" and a background-diagnostics screen (last run time, result, count) so cadence can be measured |
| 4C Invites | `Features/Invites` | Only if O6 approves: parse `text/calendar` (METHOD REQUEST), card with title/time/location, Add to Calendar (EventKit write-only), Accept/Decline/Maybe as iTIP REPLY mail |
| 4D Snooze, send later, undo | `Features/Scheduling` | Snooze picker, schedule-send sheet with the "Sends when Flint can run" copy and reminder fallback, follow-up reminders |
| 4E Mac pairing | iOS: `Packages/FlintCore/Sources/FlintPairing`, `Features/Pairing`. Desktop: `packages/core/src/pairing/`, `apps/desktop/src/**/settings/devices/` | Implement section 7 on both sides from the shared `pairing-vectors.json` and `pairing-bundle.json`. TS: listener, QR (`qrcode`), approval dialog, bundle builder with allowlist. Swift: scanner, Local Network handling, handshake, bundle decode and merge import, review screen. Settings > Devices on both sides. Unit tests for crypto vectors, framing limits, expiry, 3-strike close, replay, malformed bundles |
| 4F AI spike (optional, O6) | `docs/ios/spikes/ai-signin.md`, `Packages/FlintCore/Sources/FlintAI` | Only if S6 passed and the owner wants AI: loopback listener sign-in for Codex and Grok or paste fallback, port `ai/stream.ts` and `sse.ts`, summarize thread and quick replies. Otherwise skip |

Acceptance (Wave 4):
- Receipts: send a tracked mail to a GreenMail recipient and to a fake receipts service (`FakeReceiptsService` pattern from `receipts/fakeService.ts`); statuses change as events arrive; untracked self/alias path shown correctly.
- Codes: fixture mails produce the expected notification content; Copy code works from a cold start.
- Background: `BGTaskScheduler` simulated launch (`e -l objc -- (void)[[BGTaskScheduler sharedScheduler] _simulateLaunchForTaskWithIdentifier:...]`) runs a sync within 30 s on a seeded account and posts a notification. Real cadence is measured by the owner over a week using the diagnostics screen (O5) and recorded in `docs/ios/spikes/background-cadence.md`.
- Pairing: Node and Swift reproduce every vector in `pairing-vectors.json`; end-to-end test with the Swift side as a macOS test target talking to the TS listener on loopback (`apps/ios/scripts/pairing-e2e.sh`); wrong SAS, expired session, second connection, oversize frame and tampered ciphertext all fail closed. Real-device scan over Wi-Fi is O5. Google accounts import as "Sign in" rows and no token field appears anywhere in the bundle (test asserts the key set).
- Desktop `pnpm test` and typecheck still pass.

## Wave 5: QA and release

| Track | Owns | Scope |
|---|---|---|
| 5A UI tests | `apps/ios/AppUITests`, `apps/ios/scripts/verify.sh` | XCUITest on iPhone 17-class and iPad Air 13-inch simulators (seeded mailbox, no network): onboarding to inbox, open thread, reply and send to local fake transport, archive with undo, search operators, settings changes persist, Graphite and Paper snapshots compared by screenshot attachments (human review, not pixel-diff), `performAccessibilityAudit()` per main screen, Dynamic Type AX3 pass. `verify.sh` creates a temporary simulator, uses `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`, deletes it on exit (pattern from Sheafnote). Opt-in: `verify.sh --ui` |
| 5B Integration and perf | `Tests/FlintCoreTests/Integration`, `apps/ios/scripts/greenmail.sh` | Full GreenMail matrix (section Wave 2) plus flaky-network cases (server restart, TLS failure, auth failure to `auth_error`), long-run IDLE soak (30 min) on the host, launch time and memory on a 50k-message seeded DB (budget: first paint from cache under 400 ms on simulator, steady memory under 200 MB) |
| 5C Release | `apps/ios/scripts/testflight.sh`, `asc.py`, `testflight.local.sh.example`, `docs/ios/RELEASING.md` | Adapt Sheafnote's script (DESIGN-NOTES section 11): `BUNDLE_ID`, `PROFILE_NAME="Flint App Store"`, scheme, no iCloud branches, `BUILD_NUMBER` default UTC timestamp, `--no-upload`. Dry run with `--no-upload` produces a signed `.ipa`; upload only after O3 and with the owner present for O4 |
| 5D Review | read-only, writes findings to `docs/ios/REVIEW.md` | Security pass (Keychain classes, logging, pairing, WKWebView settings, ATS, entitlements), license audit (`THIRD-PARTY.md` for SwiftMail BSD-2, NIO and swift-nio-imap Apache-2.0, GRDB MIT, SwiftSoup MIT, Lucide ISC, Geist/Newsreader OFL, QR lib MIT), privacy manifest (`PrivacyInfo.xcprivacy`: required-reason APIs, no tracking, collected data none) and App Privacy answers |

Acceptance (Wave 5):
- `scripts/verify.sh --ui` green on both device classes; zero audit failures on main screens.
- `swift test` with integration flag green; coverage report at or above 80% for logic modules.
- `testflight.sh --no-upload` yields a signed IPA; after O3/O4 an upload reaches TestFlight processing; owner installs on a device (O5) and completes: add Google account, send a tracked mail, receive a code notification, pair from the Mac.
- `docs/ios/REVIEW.md` has no open critical or high items; `THIRD-PARTY.md` and `PrivacyInfo.xcprivacy` present.

## Wave 6 (optional, after the owner has used v1)

- AI (4F outcome), CHANGEDSINCE upstream PR if profiling asks, push relay (DESIGN-NOTES section 9) only if background cadence is too sparse, widgets and App Group, AirDrop setup file, Home scene.

## Dependency order

```
Wave 1 (1A 1B 1C 1D parallel)
  -> Wave 2 (2A 2B 2C 2D 2E parallel) -> 2F facade
      -> Wave 3 (3A..3G parallel)
          -> Wave 4 (4A..4E parallel, 4F optional)
              -> Wave 5 (5A 5B parallel, then 5C, then 5D)
```
Tracks 2D and 2E need only Wave 1 outputs, so they may start alongside Wave 1 once 1B and 1C land. Track 4E's TypeScript half needs only the fixtures from 1C and can start with Wave 2.
