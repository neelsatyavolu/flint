# Flint for iOS: design notes

Status: design only, nothing built. Written 2026-10-25 on branch `ios`. Companion: [PLAN.md](PLAN.md).
"Verified" below means I ran it or read the primary source on that date. "Unverified" means a spike in PLAN.md must settle it.

## 1. Scope and stance

- Native Swift/SwiftUI app, iPhone and iPad, iOS 26 minimum (same floor as Sheafnote, Swift 6). Local-first like desktop: IMAP/SMTP straight from the device, SQLite cache, no Flint server, no Flint account.
- The TypeScript engine does not run on iOS. We port the logic and keep it honest with shared JSON fixtures (section 5). The one exception is the dark-mode HTML adapter, which is DOM code and runs unchanged inside WKWebView.
- Visual system is the project `DESIGN.md` ("Graphite & Spark"), not the personal one: warm planes, one blue accent, Geist / Geist Mono / Newsreader, radius 0/4/12, no shadows, gradients or blur.
- v1 needs no iCloud, no App Group, no push entitlement. Only Keychain, Background Modes (fetch, processing) and Local Network (pairing). That keeps signing to what the ASC API key can do alone (section 11).
- Not on iOS: Proton Bridge, agent API/CLI, browser extension, Accessibility autofill, Home photo scene, Spark signature import (comes over from the Mac instead), Microsoft sign-in (a desktop non-goal too).

## 2. Mail engine decision: SwiftMail behind our own protocol

**Decision.** Use [Cocoanetics/SwiftMail](https://github.com/Cocoanetics/SwiftMail) (BSD-2-Clause) for IMAP and SMTP, wrapped by a `MailTransport` protocol in `FlintMail` so it can be swapped or patched. Depend on it by git revision, not by version (see "Resolver trap").

| | SwiftMail | swift-nio-imap alone | MailCore2 |
|---|---|---|---|
| License | BSD-2-Clause | Apache-2.0 | BSD-style, GitHub reports NOASSERTION |
| Maturity | Created Mar 2025; 1.16.0 on 2026-10-09; releases every 1 to 4 weeks since Aug; commits on 2026-10-25; 2 open issues; one maintainer team (Cocoanetics) | Apple-owned, 0.x tags (0.1 to 0.4), active | 2.7k stars, but last tag 0.6.4 is from Aug 2020; SPM manifest points at a 2020 binary hosted on a third-party fork; 233 open issues |
| What it is | Async/await IMAP + SMTP client, MIME parse/build, on swift-nio-imap | Protocol codec only (parser, encoder, state machines). No client | C++/ObjC library, GCD operations |
| IDLE | Yes, `idle()` returns `AsyncStream<IMAPServerEvent>` | Codec only | Yes |
| QRESYNC | Yes: SELECT with stored UIDVALIDITY + modseq, vanished UIDs, flag replacements | Codec only | Yes (vanished) |
| CONDSTORE `CHANGEDSINCE` flag fetch | Not exposed (README table says no; only mentioned in a strategy doc). Gap | Codec has it | Yes |
| Gmail X-GM | `supportsGmailExtensions`, `fetchGmailAttributes` returns msgid, thrid, labels per UID. No label STORE | Codec has it | Yes |
| XOAUTH2 | IMAP and SMTP | n/a | Yes |
| TLS | swift-nio-ssl (BoringSSL); policies `.implicitTLS`, `.startTLS`, `.plainText`, `noVerification`, min TLS version | n/a | OpenSSL you build |
| Concurrency | Swift 6 actors, `async` | NIO | Callbacks |
| Build | Builds for iOS Simulator Release with Xcode 27 (verified, `xcodebuild`, this machine) | Same | Own build scripts |

Client logic we would write on top:
- SwiftMail: the sync engine (folder state, UIDVALIDITY, windowing, Gmail label mapping, flag deltas, expunge detection, backoff, IDLE supervision, outbox replay, Sent copy). Roughly the port of `packages/core/src/mail/sync` (1.5k lines TS), `actions.ts`, `send.ts`, `compose.ts`, `connect.ts`, `autoconfig.ts`. My estimate: 3k to 4k lines Swift. Unit-testable against a fake `MailTransport`.
- swift-nio-imap alone: all of that plus connection and command correlation, literals, auth, FETCH response assembly, MIME. My estimate: another 3k to 5k lines of protocol plumbing we would own forever. Not worth it for one app.
- MailCore2: less sync-engine code (it has more of the primitives), but we own an OpenSSL/libetpan/cyrus-sasl build, an ObjC bridge and a dependency with no release in six years. Rejected. Its recent default-branch commits (ActiveSync/JMAP experiments, Sept 2026) look like a revival, not a stable base; recheck before the next major decision.

**Resolver trap (verified).** SwiftMail 1.16.0 depends on `swift-nio-imap` by `revision:` (pinned past 0.4.0 for an 8 KiB line-limit fix). SwiftPM refuses a version requirement on it:
`package 'swiftmail' is required using a stable-version but 'swiftmail' depends on an unstable-version package 'swift-nio-imap'`.
`.package(url: ".../SwiftMail", revision: "88c45cbd31b347b373f7c87e197be63eb95efbc2")` (the 1.16.0 commit) resolves and builds. Bump the pin deliberately, with the transport tests as the gate. Revisit when swift-nio-imap tags a release containing that fix.

**Known gaps and how we cover them**
1. No `CHANGEDSINCE`: on QRESYNC servers (iCloud, Dovecot, Fastmail) the QRESYNC SELECT returns flag changes. On Gmail (CONDSTORE, no QRESYNC) we re-fetch `UID FLAGS X-GM-LABELS` for the synced window in chunks, as the desktop spec already allows ("else re-fetch flags"). Upstream a `CHANGEDSINCE` PR to SwiftMail if the cost shows up in profiling (BSD-2, maintainer is responsive).
2. No label STORE: Gmail archive and trash use `MOVE` out of INBOX to `[Gmail]/All Mail` / `[Gmail]/Trash`. This removes the Inbox label the same way Apple Mail does. Unverified against a live Gmail account; spike in Wave 2.
3. The README capability table is stale (it marks Gmail attributes unsupported though `IMAPServer+Gmail.swift` exists). Treat the source and tests as truth; Wave 1 spike writes one probe per capability we depend on.
4. NIO sockets, not Network.framework: no automatic Wi-Fi/cellular handoff. Reconnect logic must handle network path changes (use `NWPathMonitor` to trigger reconnect).
5. `IMAPServer` creates its own event loop group per instance. Keep one `IMAPServer` for commands and one for IDLE per account, as desktop does, and tear both down when the app backgrounds.

**SMTP.** SwiftMail SMTP (PLAIN, LOGIN, XOAUTH2, STARTTLS, 8BITMIME). Message building stays ours (`FlintMail/Compose`), because tracked sends need byte-identical copies that differ only in envelope recipient and pixel (see `send.ts`). Use SwiftMail's MIME types only for parsing.

## 3. Storage: GRDB, desktop schema kept as is

**Decision.** [GRDB.swift](https://github.com/groue/GRDB.swift) 7.x (MIT, v7.11.1, last push 2026-09-29, 8.7k stars) with `DatabasePool` (WAL), `ValueObservation` feeding SwiftUI, FTS5.

- Port `packages/core/src/db/schema.ts` migrations 1 to 8 as GRDB migrations with the same table and column names (`threads.thread_key`, `messages.gm_thrid`, `message_folders`, `pending_ops`, `tracked_*`, `kv_cache`, ...). Same names means shared fixtures, the same SQL for list and search queries, and room for a future DB-level import.
- Why not SwiftData: no FTS5 or contentless tables, little control over indexes and migrations, and a 100k-message mailbox with background writers is exactly where its model-context rules hurt. Search is a core feature.
- FTS5 on iOS: `messages_fts` uses `contentless_delete=1`, which needs SQLite 3.43+. This Mac's `sqlite3` is 3.54; the iOS 26/27 system SQLite version is unverified. Wave 1 prints `sqlite3_libversion()` on both simulators. If it is below 3.43, drop `contentless_delete` and delete FTS rows by rowid with an explicit shadow table, or link a custom SQLite build (GRDB documents this).
- Encryption: iOS Data Protection class `completeUntilFirstUserAuthentication` on the database directory (background refresh must read it while the phone is locked), not `complete`. No SQLCipher in v1: it adds a custom SQLite build and size for little gain over file protection. Revisit if the owner wants it.
- Secrets in Keychain only (section 8). Raw HTML bodies are stored unsanitized like desktop and sanitized on read.
- Attachments: files under `Caches/attachments` (re-downloadable), purged by a processing task.

## 4. Architecture

```
apps/ios/
  project.yml                XcodeGen (never edit the .xcodeproj)
  App/
    Shell/                   bootstrap, FeatureModule registry, scene + URL routing
    Theme/                   tokens, fonts, FlintBar, FlintRow, type roles
    Features/<Name>/         Onboarding, Sidebar, Inbox, Thread, Composer, Search, Settings, Notifications, Pairing, Codes, Invites
    Resources/               colors.xcassets, Fonts/, Icons/, mailDark.bundle.js, trackers.json
  AppTests/ AppUITests/
  Packages/FlintCore/        pure Swift, no UIKit or SwiftUI (Sheafnote convention)
    FlintModel               domain types mirroring types.ts (frozen-contract rule applies)
    FlintStore               GRDB schema, repositories, search parser + FTS, thread-key resolution
    FlintMail                MailTransport, SwiftMailTransport, autoconfig, sync engine, actions/outbox, compose, send, Google token logic
    FlintClassify            categorize, verification codes, rules, needsReply
    FlintReceipts            install/register/delete/events client, pixel, status derivation
    FlintHTML                sanitize pre-pass, tracker rules, WKContentRuleList JSON
    FlintPairing             X25519 session, framing, bundle schema
    FlintService             facade composing the above (the Swift analogue of service/FlintService)
  scripts/                   testflight.sh, asc.py, verify.sh, gen-maildark.sh, sync-fixtures.sh, greenmail.sh
packages/core/fixtures/      shared JSON fixtures (section 5)
packages/core/src/pairing/   Mac side of "Set up from your Mac"
```

- Concurrency: one `AccountSession` actor per account owns its two `IMAPServer`s and the sync loop. Store writes go through GRDB's writer. UI reads via `ValueObservation`. Actions are optimistic, then enqueue a `pending_ops` row replayed on next launch (the desktop's durable outbox, same table).
- Navigation: iPhone is a stack (sidebar sheet, list, thread). iPad and wide iPhone landscape use `NavigationSplitView` with three columns that mirror plane-0/1/2.
- Features register through a `FeatureModule` protocol and live in their own folder, so parallel agents never share a file (PLAN.md ownership).

**Theming from DESIGN.md.**
- Tokens (`--plane-0..3`, `--fg..fg-4`, `--line*`, `--accent*`, `--danger/ok/warn`, avatar tints) become named colors in an asset catalog with Any/Dark variants (Graphite = dark default, Paper = light). A unit test ports `tokens.test.ts` (contrast >= 4.5:1 for `--fg-3` and up on every plane).
- Fonts: bundle Geist, Geist Mono, Newsreader (SIL OFL) and register in `UIAppFonts`. Type roles from DESIGN.md section 3 become a `FlintFont` enum using `Font.custom(_, size:, relativeTo:)` so Dynamic Type works. Bodies of mail follow the "Message" role.
- Icons: the Lucide subset the app uses, as SVGs in the asset catalog (stroke 1.5). SF Symbols only where iOS requires them (share, system chrome).
- Radius 0 planes and rows, 4 controls, 12 cards, no shadows. Motion 120/180 ms, off under Reduce Motion. Increase Contrast and Reduce Transparency mapped as in DESIGN.md.
- Conflict to resolve in Wave 1: iOS 26 draws navigation bars, tab bars and toolbars with Liquid Glass, which DESIGN.md forbids. Plan: custom opaque `FlintBar` views instead of system bars; as a stopgap the Info.plist key `UIDesignRequiresCompatibility`. Whether that key still works with the iOS 27 SDK is unverified; Wave 1 tests it on the iOS 27 simulator.
- Dark mail: see section 5.

## 5. What ports from TypeScript, and how drift is prevented

| Logic | TS source | Swift home | Method |
|---|---|---|---|
| Categorizer | `categorize/index.ts`, `signals.ts` | `FlintClassify` | Port by hand |
| Verification-code detector | `codes/detect.ts` (registrable-domain helper included) | `FlintClassify` | Port by hand |
| Search operator parser | `search/` | `FlintStore` | Port by hand |
| Thread key resolution | `threading/` | `FlintStore` | Port by hand |
| Rules matching | `rules/` | `FlintClassify` | Port by hand |
| Receipts client, pixel, status derivation | `receipts/{client,db,pixel,protocol}.ts` | `FlintReceipts` | Port by hand |
| Tracker rules | `sanitize/trackers.ts` | `trackers.json` shared | Data file generated from TS, read by both |
| Provider presets | `mail/autoconfig.ts` table | `providers.json` shared | Data file read by both |
| Dark-mode HTML adapter | `apps/desktop/.../lib/mailDark` | not ported | esbuild bundle, runs in WKWebView |
| HTML sanitizer | `sanitize/index.ts` (sanitize-html) | `FlintHTML` | Rewritten with SwiftSoup (MIT) + WebKit controls; fixtures |
| AI tasks and prompts | `ai/` | deferred | see section 10 |

**Shared fixtures.** `packages/core/fixtures/*.json`, one file per module, each case `{ name, input, expect }`:
- `categorize.json` (from the inline corpus in `categorize/corpus.test.ts`, 30+ cases), `codes.json` (from `codes/detect.test.ts`), `search.json` (query to parsed operators), `threadkey.json`, `rules.json`, `receipts-status.json` (event sequences to status), `receipts-pixel.json` (canonicalAddress, injectPixel, normalizeEndpoint), `trackers.json` cases, `providers.json` cases (email to config), `sanitize.json`.
- Each file carries `meta: { version }`; categorize ties to `CATEGORIZER_VERSION`. Swift tests assert the same number.
- The desktop vitest suites are changed to read these files (the arrays move out of the `.test.ts`, no behavior change). Swift tests load them from `Tests/FlintCoreTests/Fixtures`, populated by `scripts/sync-fixtures.sh` (copy, plus a `--check` mode CI runs so a stale copy fails the build).
- Rule: any behavior change to a ported TS module edits the fixture in the same commit; the PR is not done until `swift test` is green on the iOS side. Adding a Swift-only case without a TS twin is not allowed.
- Regex drift is the real risk. JS `\w` and `\b` are ASCII-only; ICU (NSRegularExpression) is Unicode-aware. `detect.ts` also uses lookbehind and `[^\S\n]`. In the port, replace `\w` with `[A-Za-z0-9_]` and `\b` with the explicit lookaround form, and add non-ASCII cases to `codes.json` and `categorize.json` (accented names, CJK subjects, full-width digits).
- Escape hatch: because the fixtures are the contract, any module can later be swapped for the same TS compiled into a JavaScriptCore context with no UI change. Not chosen now: a second JS runtime in background tasks and a bundler step for logic that is a few hundred lines.

**Dark mode.** `adaptMailForDark` is pure DOM string-to-string. `scripts/gen-maildark.sh` esbuilds `lib/mailDark/index.ts` into `mailDark.bundle.js` (committed, with a `--check` that rebuilds and diffs). The reader injects it as a `WKUserScript` in an isolated `WKContentWorld`. This works with page JavaScript disabled: WebKit's header states `allowsContentJavaScript = false` blocks only the page's scripts, and app-run `evaluateJavaScript`, `callAsyncJavaScript` and `WKUserScripts` still run (verified in WebKit source). The reader keeps the message at opacity 0 until adaptation finishes, honours the `adaptable: false` verdict (show original on a light sheet, as desktop does), and the same "Original / Adapted" toggle.

**Reader security (WKWebView).**
1. Non-persistent `WKWebsiteDataStore`; `loadHTMLString(_, baseURL: nil)`.
2. `allowsContentJavaScript = false`.
3. A compiled `WKContentRuleList` blocks every load except `data:` and the `cid:` handler; images are blocked by default. "Load images" removes the image rule for that message only (the desktop's per-message behavior). Trackers: from `trackers.json`, counted in the pre-pass and surfaced as "N trackers blocked".
4. SwiftSoup pre-pass: strip script, iframe, object, embed, form, base, meta refresh, event attributes; rewrite remote `<img>` to a sized placeholder and count them; remove anything pointing at the user's own receipts host (anti-goal: never self-trigger a receipt).
5. Link taps cancel navigation and go through our handler (`mailto:` opens the composer; `http(s)` opens `SFSafariViewController`, with a `List-Unsubscribe` affordance).
6. `cid:` images served by a `WKURLSchemeHandler` from the attachment cache.

## 6. Setup flow ("configure things cleanly")

Principles: no Flint account, nothing to configure before the first account works, every choice has a default, one `Settings` model (Codable, versioned, stored in the `settings` table as on desktop), the same JSON shape reused by Mac pairing and by an "Export settings" action (no secrets).

**First run**
1. Welcome. Three rows: *Continue with Google*, *Other email*, *Set up from your Mac*. One line under it: "Mail stays on this phone. Flint has no server."
2. *Google*: `ASWebAuthenticationSession`, then immediate `testConnection` (IMAP login, SMTP XOAUTH2 verify), then straight to the inbox with the sync hairline.
3. *Other email*: email field, then autoconfig (presets, then Mozilla ISPDB, then MX lookup via `dnssd`/`DNSServiceQueryRecord` so no domain leaks to a DoH provider). Show the detected servers as a summary row with "Edit" (host, port, security, username). Password field with a provider-specific hint and link ("Gmail and iCloud need an app password"). Test connection with the DESIGN.md voice for errors ("Couldn't reach imap.example.com. Check the server name or your connection.").
4. *Set up from your Mac*: camera scan, pairing (section 7), then a review screen listing what arrived, with Google accounts as "Sign in" rows.
5. Three skippable choices on one screen: notifications (with the honest copy from section 9), Smart inbox on/off, signature (import from Mac, or write now).
6. Done. Inbox, backfilling 90 days newest first; first screen paints from the first 200-message batch.

**Provider presets.** `providers.json` shared with desktop: Gmail (OAuth or app password), iCloud, Fastmail, Yahoo, Zoho, AOL, generic IMAP. iOS differences: Proton shows "Needs Proton Bridge on a computer" and cannot continue; Outlook/Hotmail/Live show "Microsoft sign-in isn't supported yet" (matches SPEC non-goal) unless the user has an app-password-capable domain.

**Google sign-in on iOS**
- Needs an **iOS-type OAuth client** (bundle id bound), separate from the desktop client; no client secret (public client). Verified in Google's iOS authorization guide: choose "iOS", enter bundle ID (cannot be changed if App Check is enabled), optional Store ID and Team ID.
- Flow is the port of `google-oauth.ts` with a different redirect: PKCE S256, scope `https://mail.google.com/ openid email profile`, `access_type=offline`, `prompt=consent`, `login_hint` when known, redirect `com.googleusercontent.apps.<client-id-prefix>:/oauth2redirect`. `ASWebAuthenticationSession(callback: .customScheme(reversedClientId))`; the scheme needs no Info.plist registration for this API, which also lets a user paste their own client id (Settings > Advanced) the way desktop does. Never use `WKWebView` for sign-in (Google returns `disallowed_useragent`).
- Hand-rolled (about 150 lines) instead of AppAuth-iOS (Apache-2.0, 3.0.0 released 2026-08) or Google Sign-In: the desktop code is the spec and ASWebAuthenticationSession covers it. Fallback to AppAuth if Google starts requiring App Check or DPoP for this scope.
- Unverified: Google's desktop guide now says custom URI schemes are "no longer supported due to the risk of app impersonation", while the iOS guide still documents the iOS client type. Wave 1 does a real token exchange with the owner's client before any UI is built on this.
- **Restricted-scope implications (verified in Google docs).** `https://mail.google.com/` is a restricted scope. An external app in "Testing" gets refresh tokens that expire in 7 days and a 100-test-user cap. In production but unverified: warning screen and a 100-user total cap; Google's pages do not state the refresh-token lifetime for that state, so measure it with the real client. Public distribution to Gmail users needs verification including an annual third-party security assessment, which this free project should not take on. So: owner's own use is fine (publish "In production", unverified, click through the warning); everyone else uses an app password or their own OAuth client. Settings > Advanced exposes the client id field.
- Token handling: access token refreshed 5 minutes before expiry; refresh failure sets account state `auth_error` and shows "Sign in again" (same states as desktop).

**Settings map** (mirrors desktop IA): Accounts (per account: name, color, aliases, signature, show in unified inbox, sync window, alerts), Inbox (Smart inbox, bundles, swipe actions), Notifications (per account, categories, codes), Compose (undo send seconds, default signature, read receipts default and endpoint), Appearance (Graphite / Paper / System, density), Privacy (images: ask / never; tracker blocking; Face ID lock), Devices ("Set up from your Mac", re-pair), About (version, licenses, what runs in the background and when).

## 7. "Set up from your Mac": protocol

Goal: move accounts, signatures, templates, rules, blocked senders and chosen settings from the Mac app to the iPhone over the local network, end to end encrypted with a one-time key, without a server and without moving secrets that the iPhone cannot use.

**What moves, what does not**
- Moves: account records (email, name, servers, auth kind, username, color, aliases, show-in-unified, sort order, avatar up to 64 KB), signatures, templates, rules, blocked senders, an allowlisted subset of settings (undo-send seconds, sync window, categorizer toggles, receipts endpoint, theme, per-category notify defaults). IMAP/SMTP **app passwords** move only if the user ticks "Include passwords" on the Mac approval step (default on, shown with the count).
- Never moves: Google access/refresh tokens (they belong to the desktop OAuth client; the iOS client differs, and a refresh token is bound to the client that issued it). Google accounts arrive as "Sign in" rows with `login_hint=<email>`. AI tokens (Codex/Grok refresh tokens rotate; sharing one would log the Mac out). Receipts install credentials (each install registers its own; sharing would merge fingerprints). Agent token, message bodies and the database (the phone resyncs from IMAP).

**Mac side** (`packages/core/src/pairing/`, UI in Settings > Devices > "Set up iPhone", Electron main). Uses only `node:crypto` (x25519, HKDF, ChaCha20-Poly1305) and the `qrcode` package (MIT) for rendering.
1. Generate `sid` (16 random bytes), ephemeral X25519 keypair `(a, A)`, listen on an ephemeral TCP port on private interfaces only. Expiry 180 s, one successful session, at most 3 failed attempts, then close.
2. QR payload (about 150 bytes): `flint://pair#<base64url(JSON)>` with `{ v:1, sid, pk:A, addrs:["192.168.1.20", ...<=3], port }`. The QR is the authenticated channel: it pins the Mac's key. The Mac does not advertise over Bonjour.

**iPhone side**: scan with `DataScannerViewController` (or the system Camera, which opens the `flint://` URL). Camera permission string required. Local Network permission is requested on first connect (explain before the prompt). Try all `addrs` in parallel, 5 s timeout each.

**Handshake and transport.** Frames are 4-byte big-endian length, then 1 type byte, then body. Max frame 64 KiB.
1. `HELLO` (plaintext) phone to Mac: `{ v:1, sid, pk:B, name:"Neel's iPhone" }`.
2. Both compute `shared = X25519(self_priv, other_pub)`, then `HKDF-SHA256(ikm=shared, salt=sid, info="flint-pair/v1" || A || B, L=64)` giving `k_m2p` (32 B) and `k_p2m` (32 B), and a 6-digit code `sas = HKDF(..., info="flint-pair/sas", L=4) mod 10^6`.
3. Both screens show the code. Mac dialog: "Pair with Neel's iPhone? Code 482 913. [Include passwords for 2 accounts] [Approve] [Cancel]". The user compares the codes. This is what stops someone who photographed the QR from pairing first.
4. On Approve, Mac sends `READY` then `BUNDLE`, each frame AEAD-sealed with ChaCha20-Poly1305 under `k_m2p`; nonce = 4 zero bytes then a 64-bit counter per direction; AAD = `sid || direction || type`. Bundle JSON up to 2 MiB, split into frames.
5. Phone validates against a zod/Codable schema (reject unknown major `v`, cap array sizes), shows the review screen, imports on confirm, then sends `ACK` under `k_p2m` with counts. Mac closes the socket, zeroes keys, and records only `{ deviceName, pairedAt }` in a Devices list.
6. Any failure, cancel, or timeout closes the socket and discards the keys. No state survives a session.

**Bundle JSON v1** (schema lives in `packages/core/src/pairing/bundle.ts` and `FlintPairing/Bundle.swift`, with `pairing-bundle.json` fixtures both sides decode and re-encode):
`{ v, createdAt, device, accounts:[{ email, name, provider, authKind, imap:{host,port,secure}, smtp:{...}, username, color?, aliases[], showInUnified, sortOrder, avatar?, password? }], signatures[], templates[], rules[], blockedSenders[], settings:{...allowlist} }`.
Import is a merge keyed by email, never silently overwriting existing iPhone data (ask on conflict). A summary reads "Added 2 accounts, 1 signature, 12 rules. 2 accounts need Google sign-in."

**Interop test vectors.** `packages/core/fixtures/pairing-vectors.json`: fixed private keys, `sid`, expected shared secret, `k_m2p`, `k_p2m`, SAS, and one sealed frame. Node and CryptoKit (`Curve25519.KeyAgreement`, `HKDF<SHA256>`, `ChaChaPoly`) must both reproduce them.

**Threat notes.** Passive LAN observer: sees ciphertext only. Active LAN attacker without the QR: cannot complete (does not know `A`). Attacker with the QR: needs the Mac user to approve a matching code. Malicious app registering `flint://`: gets only `sid`, the Mac's public key and addresses, nothing it can decrypt. Guest Wi-Fi with client isolation or a VPN will block the connection; the failure screen offers manual setup. Later option: the same bundle as an AirDrop file sealed with a passphrase.

## 8. Secrets and privacy on device

- Keychain generic passwords, service `co.xanom.flint.account`, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, not synchronizable. Holds the app password or `{ accessToken, refreshToken, expiresAt }`. Implements a `SecretStore` like `platform.ts`.
- Optional Face ID lock (LocalAuthentication) in Settings > Privacy, default off. App snapshot is blurred in the task switcher (the lock cover is an opaque plane, not blur).
- Never log bodies, tokens or passwords (same rule as SPEC section 10). Logger writes to `os.Logger` with `.private` interpolation.
- Read receipts: the iPhone registers its own install (`POST /v1/install`), registers each tracked send, polls `/v1/events` with a cursor on foreground and in background refresh. Statuses for mail sent from the Mac appear on the Mac only in v1 (tokens live in each device's DB). Worker is unchanged.

## 9. Background, notifications, send later: what is honestly possible

There is no persistent socket on iOS. Verified from Apple: `BGAppRefreshTask` gives up to about 30 seconds and the system decides when; a force-quit app is not relaunched by it; a push is the documented way to wake an app on server events.

| Need | v1 behavior |
|---|---|
| New mail while app is open | IDLE on INBOX per account (Gmail: IDLE INBOX, then incremental on All Mail). In-app banner, no system alert |
| New mail while backgrounded | `BGAppRefreshTask` `co.xanom.flint.refresh`, `earliestBeginDate` about 15 min, rescheduled every run. Quick incremental sync of INBOX (QRESYNC or flags), then a local notification for new people-category mail and codes. Cadence is the system's: expect irregular, tens of minutes to hours, nothing after force-quit, nothing in Low Power Mode or with Background App Refresh off. The Notifications settings page says so in one line and offers "Check now" |
| Heavy work | `BGProcessingTask` (usually overnight, charging): deep backfill, FTS rebuild, `recategorizeAll` after a `CATEGORIZER_VERSION` bump, attachment cache pruning |
| Snooze wake-up, follow-up reminders | Local notifications with calendar triggers. Reliable without the app running; tapping resurfaces the thread |
| Undo send | In-app window (default 5 s). `beginBackgroundTask` finishes the SMTP send if the user leaves the app |
| Send later | The message is scheduled locally. At the due time a local notification fires ("Ready to send to Carla. Tap to send"), and a refresh task tries to send it silently if iOS grants a slot. Labelled in the UI as "Sends when Flint can run". True unattended send-later needs the Mac app running or a server; SMTP FUTURERELEASE (RFC 4865) is, as far as I know, not offered by Gmail or iCloud (unverified) |
| Verification codes | `detectCode` runs on every newly synced inbox message. Local notification title "KAYAK code 530331" so it is readable on the lock screen; action "Copy code" opens the app and copies (writing the pasteboard from a background action is not dependable). A Codes strip at the top of the inbox shows codes from the last 10 minutes. iOS AutoFill only offers codes from Messages and Apple Mail; no API for third-party mail. Desktop's Accessibility autofill has no iOS equivalent |
| Receipts "opened" alerts | Only when the app runs or a refresh happens |

**Push relay: worth proposing later, not now.** Instant alerts need APNs, and APNs needs a server that watches the mailbox. Sketch for a later opt-in, self-hostable relay (Cloudflare Worker + one Durable Object per mailbox): holds an IMAP IDLE socket (Workers outbound TCP, limits unverified) or a Gmail `users.watch` Pub/Sub subscription, and on new mail sends a content-free alert push with `mutable-content`. A Notification Service Extension on the phone then fetches the message itself over IMAP and rewrites the notification, so the relay never sees sender or subject. Costs: the relay must hold a long-lived mailbox credential (app password or refresh token), which is the real privacy trade; needs a push entitlement, an APNs key from the account holder, an App Group and shared Keychain access group for the extension. Recommendation: build nothing until the owner has lived with v1 for two weeks; if background refresh proves too sparse, build the self-hosted single-user version only, and do not offer it to others because of credential custody. Apple Mail's own push channel for iCloud (`XAPPLEPUSHSERVICE`, visible in iCloud's capability list) has no public API.

## 10. Limits and deferrals

- **Proton Bridge**: binds to 127.0.0.1 on the computer. Not usable from the phone.
- **Microsoft accounts**: out, as on desktop.
- **Invites**: SPEC lists calendar as a non-goal for desktop. iOS Wave 4 adds only a minimal invite card for `text/calendar` parts: show title/time, "Add to Calendar" (EventKit write-only access), and Accept/Decline/Maybe as an iTIP REPLY email. Owner to confirm this scope.
- **AI (summaries, reply, Ask)**: deferred out of v1. `shared-ai-auth` ships CLI client settings: Codex uses client `app_EMoamEEZ73f0CkXaXp7hrann` with redirect `http://localhost:1455/auth/callback`; Grok uses redirect `http://127.0.0.1:56121/callback`. On iOS the redirect is a loopback URL, not a custom scheme, so `ASWebAuthenticationSession` cannot capture it. Options, best first: (1) run a one-shot `NWListener` on that loopback port while the sign-in sheet is up (the app stays foregrounded, so the browser's redirect should reach it; unverified); (2) paste-the-callback-URL, which the desktop already supports; (3) BYO API key stored in Keychain (OpenAI or xAI key), the simplest and the one with no terms-of-service question. Using another vendor's CLI client id inside an App Store app is also an App Review and terms risk; fine for personal TestFlight. Decision: no AI in v1. A Wave 6 spike tests (1), then ports `ai/stream.ts` and `sse.ts` (small) if it works. The local "needs reply" heuristic (no model) can ship in v1 via `needsReply.ts`.
- **Home scene, Agent Activity, CLI, browser extension**: not on iOS.
- **Scheduled actions needing the app**: see section 9.
- **iCloud sync between devices**: out. The Mac and iPhone are independent clients of the same IMAP accounts; pairing is a one-time copy.

## 11. Identity, signing, release

- **Bundle id.** Desktop's electron-builder `appId` is `co.xanom.flint` (Developer ID distribution, no App Store record). Apple allows one explicit App ID to cover iOS and macOS, and a Developer ID app does not need an App ID registered, so I propose **`co.xanom.flint`** for iOS (matches `co.xanom.sheafnote`). Unverified: whether that identifier already exists in the developer portal under the team, and with which platforms. Wave 1 checks with `GET /v1/bundleIds?filter[identifier]=co.xanom.flint` through `scripts/asc.py`; if the identifier is taken in a way that blocks iOS, use `co.xanom.flint.ios`. Decide before creating the Google iOS client, since that client is bound to the bundle id. Side effect to accept: a shared identifier means Universal Purchase if the Mac app ever moves to the Mac App Store.
- **Team** VTQW687WBQ (individual). Per `APPLE_SIGNING.md` and Sheafnote: only the account holder creates ASC app records (and iCloud containers, which v1 does not need). The ASC API key (1Password item `a2ahwayupzf5uuj5u5famnyx4y`, key `U27MTWCKH5`) can make profiles and upload builds. Apple Distribution certificate: item `ud4rlsf6n6izuaebyvqscjhs5m`. No secret values are read in this design.
- **Release script**: copy `sheafnote/scripts/testflight.sh` and `asc.py`, change `BUNDLE_ID`, `PROFILE_NAME` ("Flint App Store"), the project and scheme names, delete the iCloud branches and the `--no-icloud` flag, keep: temp keychain, fresh App Store profile per run, `xcodegen generate`, manual-signing archive, export, `altool --upload-app`. Credentials load through a gitignored `scripts/testflight.local.sh`. `ITSAppUsesNonExemptEncryption: false` is correct only if we use no custom crypto beyond OS APIs and standard TLS/CryptoKit; pairing uses CryptoKit (exempt) but confirm the export-compliance answer when the ASC record is created.
- **Build env**: use `/Applications/Xcode.app` (release), not Xcode-beta. Sheafnote's `verify.sh` notes the beta hangs the simulator test runner.
- **Capabilities in v1**: none beyond Background Modes and Keychain. Adding push, App Group or iCloud later reopens the profile step and, for iCloud, needs the account holder.
- **Project rules**: `.xcodeproj` generated and gitignored; user-facing strings in `.xcstrings` per feature; `accessibilityIdentifier` on every interactive view; core logic lives in `FlintCore` so `swift test` covers it. Sheafnote's AGENTS.md bans Xcode and simulator test runs because cold builds take minutes. This request asks for simulator UI tests, so Wave 5 makes them an explicit, opt-in script (`scripts/verify.sh --ui`) and the default agent check stays `swift test` on the macOS host. Owner to confirm.

## 12. Risks, ranked

1. Google iOS client behavior (custom scheme, token lifetime in unverified production). Spike first.
2. SwiftMail is one maintainer and young. Mitigated by the `MailTransport` seam, a pinned revision and probe tests; worst case we vendor it (BSD-2).
3. Gmail without `CHANGEDSINCE`: window re-fetch cost on large mailboxes. Measure on the owner's account; upstream the command if it matters.
4. Background cadence disappoints. Mitigated by honest copy and the relay option.
5. Regex and Unicode drift in ported heuristics. Mitigated by fixtures with non-ASCII cases.
6. Liquid Glass versus DESIGN.md. Mitigated by custom bars.
7. SQLite version on device for `contentless_delete`. Checked in Wave 1.
