# Wave 4 review

Independent read-only review of the Wave 4 merge (`98769dd feat(ios): wave 4 integrated` and its five track commits) against PLAN.md Wave 4 acceptance, DESIGN-NOTES.md sections 7 to 9, QA-CHECKLIST.md sections 11 to 15 and the desktop code. No code was changed.

## What was run

| Check | Result |
|---|---|
| `swift test --filter Pairing` (FlintCore, macOS host) | 48 tests in 5 suites passed |
| `npx vitest run src/pairing` (packages/core) | 67 tests in 5 files passed |
| `apps/ios/scripts/pairing-e2e.sh` (Swift client against the real TS listener on loopback) | happy, deny, expired passed |
| `xcodebuild test -only-testing:FlintTests` on a temporary `flint-rev4-sim` (iPhone 17 Pro, iOS 26.5; created and deleted for this review) | 510 tests in 90 suites passed |

Not run: UI tests, the BGTaskScheduler simulated launch, anything on a device (O5).

The tests pass, but most findings below sit in paths the tests do not exercise: a warm process woken in the background, the preview setting combined with non-mail alerts, a second pairing, a `flint://` link from somewhere other than the Mac.

## Findings, ranked

### High

**H1. A code alert shows the code on the lock screen when previews are Hidden, alerts are off, or the account is muted.**
`App/Features/Notifications/NotificationPolicy.swift:56-57`, called from `NotificationCoordinator.swift:94`.
`codeAlert` checks only `codes.enabled && codes.notify`. The desktop (`packages/core/src/service/codes.ts:65-67`) also requires `notifications.preview != "none"` and `alertsAllowed` (alerts on, scope not none, account not in `disabledAccounts`). Its comment says: "With previews off a code must not appear in a notification."
Failure: the user sets Settings > Notifications > Preview to Hidden, or turns off "Alert me to new mail", or turns alerts off for one account. A bank code then arrives in the background, and iOS posts "Chase code 530331" on the lock screen.
Fix: port `alertsAllowed` and the preview check into `codeAlert`, and add policy tests for all three settings.

*Status: Fixed in 1e5797b. Code alerts follow previews, alerts, scope and muted-account settings; auto-copy follows previews and muted accounts.*

**H2. A snooze wake-up shows the sender and subject whatever the preview setting, and it replaces 4D's content-free version.**
`App/Features/Notifications/DueNotificationPlanner.swift:27-37` (gated only on `settings.enabled` at :15) and `App/Features/Scheduling/LocalNotice.swift:72-77`.
4D schedules `snooze.<threadId>` with the body "A conversation you snoozed is due" and keeps subjects off the lock screen on purpose (LocalNotice.swift:47-48). 4B's reconcile posts the same identifier with the body "Ann: Contract for review". The 4B request replaces the 4D one, and the planner never reads `preview`, `scope` or `disabledAccounts`. `sendAlert` (:42-44) and `reminderAlert` (NotificationPolicy.swift:105-109) also name the recipient whatever the preview setting is.
Failure: with Preview set to Hidden, the user snoozes a thread. At wake-up the lock screen shows the sender and subject.
Fix: use one owner and one content builder per identifier. With preview Hidden, use a generic title and body, and skip accounts that are muted.

*Status: Fixed in 1e5797b. The snooze wake-up uses Scheduling's content-free text; muted accounts and alerts-off skip it.*

**H3. Background runs in a warm process never detect codes, so code alerts depend on iOS having killed the app first.**
`App/Shell/Background.swift:201, 215`, `App/Shell/BackgroundSends.swift` (`sceneEnteredBackground` calls `stop:`), `Packages/FlintCore/Sources/FlintService/FlintService.swift:50-56`, `Runtime.swift:59-63`.
`service.stop()` drops the bus subscriptions from `wireListeners()`: code detection (`detectCodes` on `.newMail`) and reply watching. Leaving the app stops the service. In the same process, `runBackground` then calls `bootstrap()`, which does nothing because the bootstrap task has already run, and then `syncNow()`. `start()` is never called again, so new mail arrives but no `.code` event is emitted.
Failure: the user reads mail, locks the phone and asks a site for a sign-in code. iOS wakes the suspended (not killed) process for `co.xanom.flint.refresh`, and the run records new mail. If the scope allows, a "New mail" alert may appear, but the "KAYAK code 530331" alert never does and the Codes strip is empty. Only a cold background launch runs `performBootstrap`, which calls `start()`. `BackgroundRunTests` passes because the run there starts from a fresh model.
Fix: subscribe the listeners independently of the sync start and stop, or call an explicit "listeners only" start in `runBackground`. Add a test that runs a background pass after `stop()`.

*Status: Fixed in 1e5797b. `FlintService.startListeners()` runs in `runBackground`; a warm-process test failed before and passes now.*

**H4. A `flint://pair` link from any source connects at once to any host, which makes the "Mac" whoever wrote the link.**
`Packages/FlintCore/Sources/FlintPairing/PairingOffer.swift:36` (addrs are checked only for being non-empty and at most 45 characters), `NetworkConnector.swift:45` (`NWEndpoint.Host(host)` resolves hostnames), `App/Features/Pairing/PairingFlow.swift:19` and `PairingModel.swift:59` (a pending link connects with no tap), `App/Shell/AppModel+Navigation.swift:88-90`.
The QR pins the Mac's key only if the QR really came from the user's Mac. A link on a web page or in a mail (`flint://pair#…` with `addrs:["pair.evil.example"]`) carries the attacker's own key, so the SAS matches: both ends belong to the attacker. The phone connects over the internet and shows a code. The user then sees a review screen of accounts whose IMAP and SMTP servers the attacker controls, with passwords the attacker chose so that "Add" succeeds. "Copy settings" is on by default and silently sets `receipts.endpoint` (see M4). The Mac side only ever offers private IPv4 addresses (`addresses.ts:6-12`), so the phone loses nothing by requiring the same.
Fix: accept only IPv4 literals in 10/8, 172.16/12 and 192.168/16 in `PairingOffer.parse`. Make a pending link stop at a confirm step ("Pair with the Mac showing this code?") instead of connecting. Show server hosts on the review rows.

*Status: Fixed in d4bd5d4. Private and local hosts only; a link stops at a confirm step showing the host. Not tested from a cold launch by link, nor with the real Local Network prompt.*

**H5. Pairing twice duplicates every signature, template and rule.**
`Packages/FlintCore/Sources/FlintPairing/BundleImporter.swift:37-39`.
`library()` returns `ImportLibrary(accounts:)` only, so `ImportPlan.make` sees empty phone signatures, templates, rules and blocked senders. `alreadyHere` is then always zero, and every item is saved again with `id: 0`. The unit test `planDropsLibraryItemsTheIPhoneAlreadyHas` builds the library by hand, so it never covers this path.
Failure: the user pairs, adds a Mac signature later and pairs again. The phone now has two copies of each signature and template, and each rule runs twice. DESIGN-NOTES section 7 promises "a merge … never silently overwriting"; duplicates break the same promise.
Fix: fill the library from `listSignatures`, `listTemplates`, `listRules` and `listBlocked`, and test `BundleImporter.library()` against a target that holds items.

*Status: Fixed in d4bd5d4. Signatures, templates, rules and blocked patterns are now part of the import target; pairing twice does not duplicate (tested).*

### Medium

**M1. Every send later produces two "Ready to send" notifications.**
`DueNotificationPlanner.swift:21-22` (`send.<id>`) and `Scheduling/SchedulingCoordinator.swift:19-20` (`send-later.<id>`). HANDOFF confirms that "neither removes the other's requests".
Failure: the user schedules a mail for 9:00 and closes Flint. At 9:00 two banners fire: "Ready to send to Carla" (4B) and "Ready to send to Carla" with a different body (4D). Pick one owner.

*Status: Fixed in 1e5797b. The old planner no longer plans scheduled sends; old `send.` notifications are removed on the next reconcile.*

**M2. A failed cold bootstrap in the background stops all later background runs.**
`App/Shell/Background.swift:202-206`.
When `service` is nil, the failure path records the run and returns without `scheduleBackgroundWork`. The `.failed` phase also persists for the life of the process.
Failure: a cold background launch during a migration error or a transient open failure (for example before first unlock, if the system ever launches the app then) means no refresh is scheduled until the user opens the app. Fix: reschedule on that path too.

*Status: Partly fixed in 1e5797b. A failed background bootstrap now schedules the next runs. Open: the app model stays in the failed phase for the life of the process, so later warm runs keep failing until relaunch. No test, since a bootstrap failure cannot be forced safely.*

**M3. Expiry: `setTaskCompleted` waits for `service.stop()` and may come too late.**
`Background.swift:172-176, 213-215`.
The expiration handler cancels the work, and the runner returns `.expired` at once. `runBackground` then awaits `service.stop()`, which waits for the pump and `sync.stopAll()`, both possibly stuck on a network read, before it calls `setTaskCompleted`. iOS expects completion right after expiry and kills apps that miss it. That also hurts future scheduling. `bootstrap()` (:201) runs outside the cancellable runner, so a slow open is not cut short either. Fix: call `setTaskCompleted` from the expiration path first, then stop.

*Status: Fixed in 1e5797b. `setTaskCompleted` is called once from the expiration handler before the service stops.*

**M4. Pairing silently changes the receipts endpoint.**
`App/Features/Pairing/PairingReview.swift:72`, `ImportSelection.includeSettings = true` (`ImportPlan.swift:87`).
The "Copy settings" row says "Undo send time, sync window, theme and similar choices". The bundle also carries `receipts.enabled`, `defaultOn` and `endpoint`, plus the notification scope. With H4, this is how an attacker points tracked-send registration at their own server. Even without H4, the user is not told the receipts service changed. List the endpoint host when it differs from the phone's.

*Status: Fixed in d4bd5d4. The receipts block applies only through its own switch on the review screen (off by default, shows the endpoint host).*

**M5. Background refresh does not poll receipts.**
`Background.swift:208-212`.
DESIGN-NOTES section 8 says the iPhone "polls `/v1/events` … on foreground and in background refresh", and section 9 says opened statuses arrive "when the app runs or a refresh happens". `runBackground` syncs mail and runs due work only, and the pump that would poll is stopped. Failure: statuses only move once the app is opened. Add `pollReceipts` to the background job, after mail.

*Status: Fixed in 1e5797b. Background runs poll receipts after mail.*

**M6. A code mail raises two alerts.**
`NotificationCoordinator.swift:72-78`.
The desktop suppresses the ordinary new-mail alert when a code alert covers the thread (`codeAlertCovers`, `codes.ts:56-61`). iOS posts both "KAYAK code 530331" and "KAYAK: Your verification code" for one message.

*Status: Fixed in 1e5797b. A code alert suppresses the ordinary new-mail alert for the same thread for 10 seconds.*

**M7. Wave 4 acceptance items that are not met yet** (the gaps are stated in HANDOFF, but QA marks parts of them as covered):
- Background: the `_simulateLaunchForTaskWithIdentifier` run "within 30 s … and posts a notification" was never verified, because lldb hung (HANDOFF, wave 4 integration). QA 12.4 stays open, and H3 shows the unit coverage misses the realistic path.
- Pairing: acceptance asks that "wrong SAS, expired session, second connection, oversize frame and tampered ciphertext all fail closed" end to end. `pairing-e2e.sh` covers happy, deny and expired only. The rest is covered by TS unit tests against the TS testkit phone and by Swift tests against a fake transport, not cross-implementation. QA 15.2 lists "wrong SAS, replay, tampering" as covered by the script, which is wrong.
- Invites: the REPLY goes out as an `invite.ics` attachment with `method=REPLY` on the attachment type, not as a `text/calendar; method=REPLY` alternative part (RFC 6047 section 2.4; HANDOFF 4C). Whether Gmail, Outlook and Apple Mail apply such a reply has not been tested.
- Pairing: account avatars are decoded but not applied (HANDOFF 4E). The desktop sends up to 64 KB per account for nothing.

*Status: Partly. Invites REPLY is a `text/calendar; method=REPLY` alternative part, fixed in 49d8b29 (built structure tested; not tried against Gmail, Outlook or Apple Mail). Receipts hooks are covered by UI tests in 49d8b29. Open: the simulated BGTask launch (lldb hangs; QA 12.4 stays open), Swift-to-TS e2e for wrong code, replay and tamper (script still runs happy, deny, expired; QA 15.2 wording not corrected), and account avatars (decoded, not applied; the Mac still sends up to 64 KB each).*

**M8. The phone can wait forever at the code screen.**
`Packages/FlintCore/Sources/FlintPairing/PairingClient.swift:63-78`.
`receiveBundle` has no deadline. If the Mac sleeps or Wi-Fi drops without a FIN, `NWConnection.receive` never returns, and the phone shows the code with a spinner indefinitely. The Mac gives up after 180 s, so the phone should time out at the same point (the TTL is not in the QR; a fixed 200 s would do).

*Status: Fixed in d4bd5d4. `receiveBundle` times out after 200 s with a `timedOut` error (tested).*

### Low

**L1. The Mac's 5-minute ACK timeout is too short for the phone's review.**
`packages/core/src/pairing/session.ts:15, 96`.
The review includes a Google sign-in per account. Failure: a user with three Google accounts takes over 5 minutes. The Mac shows "The iPhone didn't confirm that it finished…" and records no device, although the import went fine.

*Status: Fixed in d4bd5d4. The Mac ACK timeout is 20 minutes.*

**L2. A large library fails pairing with a generic message.**
`session.ts:93-98` with `frames.ts:52`. Signatures and templates may be 200 KB each (`bundle.ts:64-66`). Past 2 MiB, `chunkBundle` throws and the Mac says "Pairing didn't complete. Nothing was sent…" without naming the cause or offering to leave items out.

*Status: Partly fixed in d4bd5d4. A library over 2 MiB ends with a `too_large` reason that names the cause and sends nothing. Open: the Mac does not offer to leave items out.*

**L3. "Copy code" from a cold start can leave the app open with sync stopped.**
`Background.swift:267-269` (plausible, not reproduced). The action is `.foreground`, but during a cold launch `applicationState` may still be `.inactive` when `perform` returns, so `service.stop()` runs. `sceneBecameActive` was skipped earlier because `phase` was still `.launching` (`FlintApp.swift:32`). The app is then on screen with no IDLE and no listeners until the next background and foreground cycle. Check `isAppActive` only for the background actions.

*Status: Fixed in 1e5797b. Copy code no longer stops the service on a cold launch; Archive and Mark read stop it only when the app is not active.*

**L4. Archive and Mark read work from the lock screen without unlocking.**
`NotificationScheduling.swift:109-110`. The actions have `options: []`, not `.authenticationRequired`. Someone holding a locked phone can archive mail. Apple Mail requires unlock for destructive actions; consider it at least for Archive.

*Status: Fixed in 1e5797b. Archive and Mark read require unlock.*

**L5. A cold background launch does a full foreground start inside a 30 s refresh window.**
`AppModel.swift:117` through `Background.swift:201`. `performBootstrap` calls `service.start()`: IDLE on every account plus `runMaintenance` (recategorize, header refresh over the network). DESIGN-NOTES section 9 puts heavy work in `BGProcessingTask`. This raises the chance of `expired` runs and of the cadence penalty from M3.

*Status: Fixed in 1e5797b. Background launches open the service with listeners only; IDLE and maintenance wait for the foreground start.*

**L6. Overlapping runs mix their diagnostics counts.**
`NotificationCoordinator.swift:126-135`. A refresh, a processing run and "Check now" share one `counting` flag and set, so overlapping runs reset each other's counts.

*Status: Fixed in 1e5797b. Each background run keeps its own count.*

**L7. The Mac's failure texts claim more than the code knows.**
`pairingState.ts:19-20`. "failed" says "Nothing was sent that your iPhone could use", and "connection_lost" says "Nothing was saved on your Mac". Both can fire after the bundle (with passwords) was already delivered, for example a malformed ACK or the phone closing the review sheet. Say "may have been sent" in the post-`sending` cases.

*Status: Fixed in d4bd5d4. The closed event carries `bundleSent`, and the failed and connection_lost texts no longer claim nothing was sent once sending began.*

### Info

- **QA 12.1** says the policy tests cover "quiet hours". There is no quiet-hours setting on either platform; fix the wording.
- **Lock-screen titles on Face ID iPhones.** The default system setting "Show Previews: When Unlocked" hides titles, so the designed "KAYAK code 530331 readable on the lock screen" will not show for many users. Note this in the copy rather than adding `.hiddenPreviewsShowTitle`, which would override the user's system choice.
- **Device name.** The phone always sends "iPhone" or "iPad" (`ThisDevice.name`), so the Mac dialog reads "Pair with iPhone?", not "Neel's iPhone". This is honest, because `UIDevice.name` is generic without an entitlement, but it gives the user no way to tell their phone from an attacker who got in first.
- **`InviteLedger` writes with `.completeFileProtection`** (`InviteLedger.swift:100`). Reads fail while the device is locked, unlike the database (`completeUntilFirstUserAuthentication`). This is fine while only the UI reads the ledger.

- Info status: QA 12.1 wording fixed and the Face ID preview note added to Settings > Notifications and QA 12.6 (1e5797b). The SAS now binds both public keys, fixed in d4bd5d4. The phone name stays generic by design, and the Mac dialog now says that only the code tells iPhones apart (d4bd5d4). `InviteLedger` file protection is unchanged (fine while only the UI reads the ledger).

## Security read: pairing crypto and bundle allowlist

Checked and sound, apart from H4:

- **Key agreement and KDF.** These match DESIGN-NOTES section 7 on both sides and reproduce the shared vectors. All-zero (low-order) shared secrets are rejected in both implementations (`crypto.ts:56`, `PairingCrypto.swift:60`).
- **SAS.** The HKDF info for the SAS (`flint-pair/sas`) does not bind A and B, unlike the key info. Because X25519 maps B and B plus a low-order point to the same secret, an on-path attacker can change B without changing the SAS. The keys then differ, so READY fails to open on the phone. The result is a denial of service only, but adding `A || B` to the SAS info in a v2 would make the code commit to both keys. 20 bits with one try per session (Cancel ends the session) is enough.
- **Replay and reordering.** Per-direction counters start at 0, and the opener advances only after a frame verifies (`PairingCrypto.swift:129-147`, `session.ts:162-163`). Keys are fresh per session (ephemeral keys plus a random `sid`), so frames from another session fail. Direction and type are in the AAD, so a frame cannot be reflected or retyped.
- **Downgrade.** There is no negotiation. QR, HELLO and bundle all require `v == 1`. A higher `v` gives "update Flint", anything else is malformed.
- **Framing limits.** The length is checked before buffering on both sides (64 KiB). The bundle is capped at 2 MiB while chunks accumulate (`PairingClient.swift:74`) and again at decode. The Mac counts oversize, silent (10 s) and bad-HELLO connections as strikes, and three strikes close the session. A second connection is refused while one is active, and frames before approval close the session. A LAN host can burn the three strikes and force a new QR; this is denial of service only.
- **Token leakage.** `buildBundle` copies field by field and re-validates through a zod schema that strips unknown keys, even for the `{ ...x }` spread on rule actions. Passwords are added only for `authKind === "password"` with the box ticked. Google OAuth tokens, AI tokens, receipts credentials and the agent token are never read. The Swift `Codable` decode drops unknown keys and has no token field, and the key-set tests exist on both sides (`googleAccountsHaveNoSecretField`, `bundle.test.ts`). The renderer never sees the `sid` or URL (the SVG is rendered in main), IPC is limited to the trusted top frame, and the phone persists only `{name, pairedAt}`. Mac keys are zeroed on finish, but the bundle JSON string with passwords lives on in V8 until garbage collection, which is unavoidable in Node.
- **Listener exposure.** The Mac binds `0.0.0.0` but accepts only when `localAddress` is one of the advertised private IPv4 addresses. Remote addresses are not restricted to the local subnet (for example, a VPN peer routed to that address).

## Notifications vs settings (lock screen)

| Alert | Preview Hidden | Alerts off | Account muted |
|---|---|---|---|
| New mail, single | "New mail", empty body: OK | suppressed: OK | suppressed: OK |
| New mail, summary | "N new messages", empty body: OK | OK | OK |
| Code | **shows service and code (H1)** | **still posts (H1)** | **still posts (H1)** |
| Snooze wake-up (4B content) | **sender and subject (H2)** | suppressed | **still posts** |
| Send later | recipient name in title | suppressed (4B); **4D copy still posts** | n/a |
| Follow-up reminder | "No reply from Ann" body | n/a | n/a |

## Background task registration and rescheduling

- Registration is correct. Both identifiers are in `BGTaskSchedulerPermittedIdentifiers`, and `UIBackgroundModes` has fetch and processing. Handlers are registered in `FlintApp.init` before launch finishes, on the main queue, and skipped when hosting unit tests.
- Rescheduling happens after every completed, failed or expired run and on each trip to the background. The refresh asks for now plus 15 min. The processing task asks for the next due send or snooze (at least 60 s away), otherwise now plus 6 h. The gap is the bootstrap-failure path (M2).
- Completion is `setTaskCompleted(success: result == .completed)`. It is late on expiry (M3).
- The work done does not match what was promised: there is no code detection in warm runs (H3) and no receipts poll (M5).
