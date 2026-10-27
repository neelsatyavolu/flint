# Wave 3 review

Independent review of the Wave 3 UI (`apps/ios/App`, branch `ios`, at `fc4cc85`) against PLAN.md "Acceptance (Wave 3)", DESIGN-NOTES.md (section 5 reader security, section 6 setup and settings map) and QA-CHECKLIST.md, with the desktop app (`apps/desktop`) as the reference for behaviour. No code was changed.

## What was run

- `xcodebuild build-for-testing`, generic iOS Simulator: builds. 65 warnings, none serious (deprecated `Text +`, one `UIWindow(frame:)`, test-only isolation warnings).
- `FlintTests` on a temporary iPhone 17 Pro (iOS 26.5): 257 tests in 49 suites pass.
- `FlintUITests` minus `EndToEndTests` on the iPhone: 42 tests, 1 skipped, 1 failed (`AccessibilityAuditTests.testInboxPaper`, 6 contrast failures, failed again on a rerun). Screenshots in Graphite, Paper and AX3 were read.
- On a temporary iPad Pro 13-inch: `AccessibilityAuditTests` (8 tests) plus `ScreenTourTests.testPadColumns` and `testGraphiteMail`. 1 failure (`testComposer`, contrast).
- A host benchmark of `QuotedText` (the file copied into a scratch program, built with `-O`).
- GreenMail end to end (`EndToEndTests`) and `swift test` for FlintCore were not run. Both simulators were deleted afterwards.

Findings are ranked by how much a user would notice them and how badly. Each one gives file:line and a concrete failure.

## High

### 1. The "Require Face ID" lock does nothing
`App/Features/Settings/PrivacyAboutPages.swift:36-38, 51-67`; `App/Shell/FlintApp.swift:16-22`.
The toggle asks for Face ID, then saves `flint.privacy.faceIDLock` to UserDefaults. Nothing else in the app reads that key: no lock screen, no check on `scenePhase == .active`, no cover in the app switcher.
Failure: a person turns on "Require Face ID" (the copy says "Ask for Face ID or your passcode when you open Flint"), hands over the unlocked phone, and anyone can open Flint and read all of the mail. This is a security promise the app does not keep. Either build the lock, or hide the row until it exists. QA 8.8 marks it "device (O5)", so nobody has seen it fail yet.
**Status:** Fixed in 7be8330. Not verified: real Face ID prompt, real app-switcher snapshot; VoiceOver isolation of the cover is unverified (XCUITest still sees rows behind it).

### 2. Image-heavy HTML mail freezes the main thread for seconds to minutes
`App/Features/Thread/QuotedText.swift:48` (fourth `htmlMarkers` pattern) and `:50` (`wroteTail`), called from `MessageBodyView.swift:39` inside `body`.
`<(?:div|p|span)\b[^>]*>\s*(?:<[^>]+>\s*)*On\s...` re-scans the whole following run of tags from every `<div>`, `<p>` and `<span>`. On markup with long runs of tags and no text between them (image-only promotions, layout tables), the cost grows with the square of the size. Measured on the host with `-O`: 66 KB took 0.26 s, 199 KB 2.3 s, 398 KB 9.1 s and 1.3 MB 102 s. A normal text newsletter of 342 KB took 0.03 s. The split runs in a SwiftUI `body`, so it runs again on every re-render of the message (a verdict, the Original/Adapted toggle, expanding a card).
Failure: opening a 300 KB promotional mail locks the UI for several seconds, and each toggle locks it again. A big one looks like a hang, and the watchdog can kill the app. Fix: run the split once per message off the main actor and cache it, and bound the pattern (atomic groups, or scan the text near each candidate instead of the whole tag run).
**Status:** Fixed in cebe80b. The split is linear, runs once per message off the main actor, and is cached.

### 3. No iPad hardware-keyboard shortcuts (a Wave 3 acceptance item)
`App/Features/Composer/ComposerRoot.swift:122,128` and `ComposerEditor.swift:132` are the only `keyboardShortcut` uses in the app. There is no `.commands`, `UIKeyCommand` or `.keyboardShortcut` for compose, reply, archive, next/previous or search.
Failure: on an iPad with a Magic Keyboard, Cmd-N, Cmd-R, E, J/K and Cmd-F do nothing, and the Cmd-hold overlay is empty apart from Send. PLAN.md requires "hardware-keyboard shortcuts for the DESIGN/SPEC subset (compose, reply, archive, next/previous, search)". QA 6.11 lists Cmd-N and Cmd-R as if they existed.
**Status:** Fixed in 7be8330. Logic and a UI test cover it; a real Magic Keyboard is unverified. E, J, K and arrows are off while the composer panel is open.

## Medium

### 4. The thread has no Snooze and no Move to folder
`App/Features/Thread/ThreadToolbar.swift:13-25, 32-53`.
The desktop `ReaderToolbar.tsx:74-75` has Move to folder (v) and Snooze (h) next to Archive and Trash. The iOS toolbar and its More menu have Archive/Move to Inbox, Trash, Pin, Mark unread, Mute, Spam, Category and Block, but neither of those two.
Failure: a person reads a mail and wants to snooze it until tomorrow. They have to go back to the list and swipe, which only works if Snooze is still one of their swipe actions. "Snooze works end to end" is in the acceptance, and from the reader it does not.
**Status:** Fixed in cebe80b.

### 5. On iPad, opening any conversation closes the composer panel
`App/Shell/AppModel+Navigation.swift:12-14` (`.thread` sets `presented = nil`, and so do `.search` and `.settings`); `App/Shell/RootView.swift:41-44` (the panel exists only while `presented == .compose`).
QA 6.8 says "the list stays usable" behind the floating panel. It does take touches, but tapping a row calls `navigate(to: .thread)`, which clears `presented`, and the panel disappears. The draft is saved by `onDisappear`, but it is gone from the screen.
Failure: while writing a reply on iPad, the person taps another mail to copy a detail from it, and the composer vanishes. They have to find it again under Drafts. On the desktop, the composer stays open while you read.
**Status:** Fixed in 7be8330. The composer is parked while a thread, search or settings opens.

### 6. Swipe actions changed in Settings don't apply until relaunch
`App/Features/Inbox/InboxViewModel.swift:46,56` reads `SwipeConfiguration` once, in `init`. `App/Features/Settings/PreferencePages.swift:111-115` writes the new value to UserDefaults, but the inbox's live `viewModel.swipe` never reloads (`InboxScreen` keeps one `@State` model for the session).
Failure: Settings > Inbox > Swipe left is set to Trash and the sheet is closed. Swiping left on a row still archives. QA 4.7 is "auto (logic)" only, so no test catches this. The inbox's own swipe sheet does update, because it writes to the view model directly.
**Status:** Fixed in fa2c703.

### 7. Opening a search result throws the search away
`App/Features/Search/SearchRoot.swift:57-60` together with `AppModel+Navigation.swift:13`.
`navigate(to: .thread)` sets `presented = nil`, which closes the search sheet and its view model.
Failure: the person searches "invoice", opens the third result and taps Back. They land on the inbox, not the results, and have to search again for the fourth result. The same thing happens on iPad. On the desktop, results stay in the list pane.
**Status:** Fixed in 7be8330. Verified on iPhone (Back) and iPad (Search again).

### 8. Editing a draft written elsewhere flattens its HTML
`App/Features/Composer/ComposerViewModel.swift:140` (`RichTextHTML.attributed(fromHTML:)`) and `:165-171` (`bodyChanged` pushes the editor's HTML). `RichTextHTML.swift:137-153` keeps only b/i/a/br/li and the block breaks.
Failure: the person opens a server draft written on the Mac (tables, inline images, colours, font sizes) from Drafts and types one character. The autosave replaces the draft's HTML on the device and on the server Drafts folder with plain divs, and the formatting and inline images are lost. Opening it without editing is safe. Warn before editing such a draft, or keep the original HTML when the editor cannot represent it.
**Status:** Fixed in fa2c703. A draft the editor cannot hold stays read only until the person chooses 'Edit as plain text'.

### 9. The accessibility audit fails on two main screens
`AppUITests/AccessibilityAuditTests.swift:29`.
- iPhone, Paper inbox (`testInboxPaper`): 6 "Contrast failed" issues the audit cannot place on an element. It failed twice in a row. The likely source is white initials on the light avatar tints (for example "CO" on light blue) or the blue "6 new" counts on the Paper plane.
- iPad, composer (`testComposer`): "Contrast failed" on the note "Read receipts need a receipts address in Settings. This message won't be tracked." (`ComposerForm.swift:106`), which is grey Geist Mono on the panel.
QA 10.3 says "No failures beyond the exceptions listed". The suite also skips `textClipped` for every screen, so the audit never checks the acceptance item "AX3 does not clip list rows or the composer" (see 16).
**Status:** Partly, in fa2c703 and 5efcb81. The Paper inbox failures were the avatar initials and are fixed; the iPad composer note uses the fg token. textClipped is now audited on the inbox (both themes) and Settings; the bundle rows' one-line sender and subject summary is reported twice, once placed (skipped by identifier) and once with no element (skipped on the inbox only). Still skipped: textClipped on Search and Thread, the inbox.section date labels (contrast fails with fg-2 and fg-3 although the screenshots read clearly), and the iPad mono-label contrast (without it the ALL and ATTACHMENTS chips fail). The Thread ORIGINAL toggle also fails the iPad contrast audit.

### 10. Inline images can crash the reader when a message closes mid-load (plausible)
`App/Features/Thread/AttachmentSchemeHandler.swift:31-45`.
After `webView(_:stop:)`, the task is cancelled, but `didFailWithError` still runs if `load` throws anything other than `CancellationError`. That happens if the IMAP fetch fails, or if the service wraps the cancellation in a `FlintError`. WebKit raises an Objective-C exception when a stopped `WKURLSchemeTask` is messaged.
Failure: the person opens a mail with a large `cid:` image that is not cached yet, then collapses the card or leaves the thread before the image arrives. The fetch then fails or times out, and the app crashes. Guard every `didReceive`/`didFinish`/`didFail` with a "stopped" set, checked on the main actor.
**Status:** Fixed in cebe80b. Tested with a recording scheme task.

### 11. The rule-list backstop is switched off for mail where the sanitizer found no remote images
`Packages/FlintCore/Sources/FlintService/Reading.swift:139` (`remoteImages = allow || !hasRemoteImages ? .allowed : .blocked`), `App/Features/Thread/MessageBodyView.swift:31`, `MailFrameView.swift:44,70`.
DESIGN-NOTES section 5.3 says the content rule list blocks images by default and that "Load images" removes the image rule for that message only. In practice, every message where the SwiftSoup pass found no remote image is marked `.allowed`, so it gets the `remote-images` list, which lets http(s) images through. The rule list was meant to be the second layer behind the sanitizer, and here it trusts the sanitizer's own verdict.
Failure: a remote image vector the sanitizer misses (a future CSS or markup trick) loads its pixel on open, because the backstop was already lifted. Use the image-blocking list unless the person or the policy allowed images, not when nothing was detected.
**Status:** Fixed in cebe80b.

### 12. Privacy copy claims more than the app does, and says "iPhone" on iPad
`App/Features/Settings/PrivacyAboutPages.swift:45, 96`; `AccountDetailView.swift:70`.
"Flint talks only to your mail provider" and "Flint talks to your mail provider and nothing else" are not true. Setup sends the email domain to `https://autoconfig.thunderbird.net` (`FlintMail/Autoconfig/Autoconfig.swift:95`), and tracked sends talk to the receipts service. On iPad the same pages, and the Remove account dialog, say "stored on this iPhone".
Failure: a reader who trusts the privacy page is misled about third-party contact, and an iPad owner reads copy that is plainly wrong for their device. Given the owner's stance on verified privacy claims, the wording should match what the app does.
**Status:** Fixed in fa2c703.

### 13. Sends queued inside the undo window wait while the app is in the background
`App/Shell/FlintApp.swift:20` → `AppModel.swift:94` (`service.stop()` stops the scheduler pump).
Failure: the person taps Send, sees "Sending in 10s" and locks the phone. The message does not go until Flint is opened again, which could be hours later. `beginBackgroundTask` around sends is Wave 4 (4B), but until then the toast promises something the app cannot do. Consider at least a background task covering the undo window now, because it is small and the failure is silent.
**Status:** Partly, in 7be8330. Sends run for up to about 25 s of background time. Longer undo windows and scheduled sends wait for the Wave 4B BGProcessingTask.

## Low

### 14. Templates can be edited but not used
`App/Features/Settings/SignaturesViews.swift:23-26, 116` has a full templates editor. Nothing in `Features/Composer` reads templates. The desktop composer inserts them (`features/compose/ComposerBar.tsx`, `ReplyToolbar.tsx`).
Failure: the person writes a template in Settings, then finds no way to insert it while composing.
**Status:** Fixed in fa2c703.

### 15. The inbox's verification-code chip is out of reach for VoiceOver and UI tests
`App/Features/Inbox/InboxRow.swift:49-54` (`.accessibilityElement(children: .ignore)`) and `:104-108` (the chip's `onTapGesture`). No custom action is added for it.
Failure: a VoiceOver user cannot copy `482913` from the list. They have to open the thread and use the banner. `inbox.code.<id>` is also hidden from XCUITest, which is why QA 4.11 is "not seen on screen". Add an `accessibilityAction(named: "Copy code")`.
**Status:** Fixed in 5efcb81. The chip is a separate button (`inbox.code.<id>`) laid over the row, reachable by VoiceOver and XCUITest (`testVerificationCodeChipCopiesTheCode`). It replaces the old 'Copy code' row action. Real VoiceOver unverified.

### 16. AX3 still clips text that carries information
Seen on the iPhone AX3 screenshots. The message header date reads "Oct 26, 2026, 3:…" with the time cut off (`MessageCardView.swift:76`, `lineLimit(1)`). The composer title reads "New…", and From shows "maya.okafor@exam…".
Failure: at AX3 the time a message arrived cannot be read at all. The acceptance says AX3 must not clip the composer, and the audit cannot catch this because `textClipped` is skipped.
**Status:** Fixed in fa2c703 (composer) and cebe80b (message card date). The From address in the AX3 composer wraps mid-address, which is readable.

### 17. Plain-text quote detection is quadratic on long blank runs
`App/Features/Thread/QuotedText.swift:35`: for every line, `nextFilled` scans forward. 20,000 blank lines took 3.1 s on the host, and this also runs in `body`.
Failure: a log dump or a badly generated mail with big gaps stalls the thread view.
**Status:** Fixed in cebe80b.

### 18. "Block trackers" off still blocks trackers in the reader
`App/Features/Thread/ReaderRuleStore.swift:18` always attaches `ContentRuleLists.trackers()`. The setting reaches only the sanitizer (`Reading.swift:133`).
Failure: someone who turns tracker blocking off to see a broken newsletter's images still finds them blocked after "Load images", with no explanation. This fails safe, so it is low priority, but the switch does less than its label says.
**Status:** Fixed in cebe80b.

### 19. Compiled rule lists build up on disk and recompile on every launch
`App/Features/Thread/ReaderRuleStore.swift:21` names the receipts list with `abs(endpoint.hashValue)`. Swift's hash seed changes on every launch, so each launch compiles and stores a new list in `WKContentRuleListStore.default()` and never removes the old ones. `:31-37` also compiles the tracker list on first use in each launch instead of looking up the stored copy, which delays the first HTML message.
Fix: use a stable digest of the host, call `lookUpContentRuleList` before compiling, and remove stale identifiers.
**Status:** Fixed in cebe80b.

### 20. iPad 11-inch portrait has two columns, not three
`App/Shell/Shells.swift:10,17`: `wideWidth = 1000`, and an 11-inch iPad in portrait is 834 pt wide.
The acceptance says three columns in landscape and portrait. The deliberate fallback (the sidebar over the list) is reasonable but differs from the text. QA 10.5 notes that 11-inch was not run.
**Status:** Decided in 7be8330: two visible columns kept on the 11-inch in portrait (three would leave the reader under 200 pt). Recorded in HANDOFF and QA 10.5.

### 21. The Archive button follows the current list, not where the conversation is
`App/Features/Thread/ThreadRoot.swift:53` (`leavesInbox(model.mailbox)`).
Failure: with Archive selected in the sidebar, the person searches and opens a conversation that is in the Inbox. The toolbar offers "Move to Inbox" instead of Archive.
**Status:** Fixed in cebe80b.

### 22. Plan items missing from 3A and 3B
- The onboarding choices screen has no signature choice (DESIGN-NOTES 6.5 lists notifications, Smart inbox and signature). `App/Features/Onboarding/ChoicesStep.swift`.
- The sidebar has no Recents (PLAN 3B). `App/Features/Sidebar/SidebarRoot.swift:4-5`.
- Account detail has no sync window or per-account alerts (DESIGN-NOTES 6 settings map). `AccountDetailView.swift`.
**Status:** Partly, in fa2c703. Done: onboarding signature box, sidebar Recents, sync window row. Open: per-account alerts (notifications are Wave 4) and importing the signature from the Mac (needs Wave 4 pairing).

### 23. The Licenses page names the packages but includes no license text
`App/Features/Settings/PrivacyAboutPages.swift:113-121`. BSD-2, MIT and Apache-2.0 require the copyright and licence notice to ship with binaries. This is tracked for 5D (`THIRD-PARTY.md`), but the in-app page should show or link to the texts before TestFlight.
**Status:** Fixed in fa2c703. The Licenses page lists 24 bundled projects with copyright lines and full license text.

### 24. Small test-tooling nits
- On iPad, `ScreenTourTests` saves its screenshots with a `phone-` prefix (`phone-columns-portrait-dark.png` and so on).
- The landscape iPad shots from `testPadColumns` come out rotated 90 degrees and clipped, with the content running off the image and a black band. It could not be settled from the images whether that is the capture or the app laying out wrongly after rotation. Someone should rotate a simulator by hand once and look.
**Status:** Fixed in fa2c703.

## Checked and fine

- Reader security matches DESIGN-NOTES 5 in the parts that were checked:
  - non-persistent data store, content JavaScript off, data detectors off, link previews off, `isInspectable = false`;
  - `loadHTMLString(_, baseURL: nil)`, with the content rule lists attached before the first load and a plain-text fallback when they fail to compile;
  - every navigation except the initial `about:` load cancelled, and link taps routed through `LinkPolicy`;
  - http(s) opened in `SFSafariViewController`, with a confirmation when the text and the target hosts differ, and `mailto:` opening the composer;
  - the `flint-attachment://` handler serving only `image/*` of the message's own attachments;
  - receipts host and trackers blocked as separate lists, so they win over "Load images".
- Thread actions close the open thread, toast with Undo and refresh through the live streams; the inbox list updates after actions; selection is trimmed when rows leave.
- Draft autosave serialises saves, batches edits made mid-save and retries; discarding asks first; undo send reopens the draft.
- Graphite and Paper screenshots show flat chrome with no system glass or shadows, and iPad portrait shows three flat columns with hairlines.

## Recheck

Independent recheck of the findings marked Fixed or Partly, at `a809dba` (fix commits 7be8330, cebe80b, fa2c703, 5efcb81). No app code was changed.

What was run: `FlintTests` once on a temporary iPhone 17 Pro (iOS 26.5) simulator, `flint-recheck-sim`, serial (`-parallel-testing-enabled NO`, one destination, `-jobs 4`). 312 tests in 60 suites passed. The simulator was deleted afterwards. UI tests, GreenMail and `swift test` were not run, so the UI-only parts of the fixes (lock cover, panel parking, audit results) were checked by reading the code only.

### Fixes that hold

For each of these, the failure scenario from the review can no longer happen as described: 2, 4, 5, 6, 7, 8, 10, 11, 12, 14, 15, 16, 17, 18, 19, 21, 23. Notes:
- 2: the HTML split is linear (the tag run is walked back from each "On ... wrote:" candidate). It runs in a detached task, and its result is cached per message and HTML. Toggling Original/Adapted recomputes it off the main actor, because the cache keeps one HTML per message.
- 11: `Reading.swift:149` now gives `.allowed` only when the policy or the person allowed images. A message with no detected images gets the image-blocking list.
- 19: the stale-list cleanup cannot remove the images list by mistake. `co.xanom.flint.reader.remote-images.<digest>` does not start with `co.xanom.flint.reader.remote.`.
- 1: the lock covers launch, the app switcher and backgrounding. The Face ID prompt's own inactive/active cycle is handled in both orders. Still unverified, as the status says: VoiceOver isolation. `accessibilityHidden` sits on `RootView`, so a sheet that was open (Settings, Search, the iPhone composer) is outside that subtree. That leaves only `accessibilityViewIsModal` on the lock window between VoiceOver and the sheet.
- 3: the shortcuts exist, but two of them misbehave. See new problems 2 and 3.
- 13 (Partly): see new problem 1, which the fix introduced.

### New problems introduced by the fixes

1. **Coming back during the send drain stops sync in the foreground (Medium).** `App/Shell/BackgroundSends.swift:61-76`, `App/Shell/AppModel.swift:104-107`. `sceneEnteredBackground` waits for the drain, which runs for up to 25 s while something falls due. Then it calls `service.stop()` unconditionally. `sceneBecameActive` does not cancel `drainTask`.
   Scenario: the person taps Send ("Sending in 10s"), switches to Photos and comes back 3 s later. `start()` runs, the drain sends the message about 7 s later, and then `stop()` tears down sync, the scheduler pump and the listeners while Flint is on screen. No new mail arrives, and the next message sent waits for the next background/foreground cycle. Fix: cancel the drain in `sceneBecameActive`, and skip `stop()` when the scene is active again.
2. **Overlapping background cycles end the newer background task (Low).** Same file, `:63-64` and `:76`. A second `sceneEnteredBackground` (background, active, background within the drain) begins task B. Then the first call's drain finishes, and its trailing `endBackgroundTask()` ends B, because `backgroundTaskId` is shared. The second drain then runs without background time and can be suspended before the send goes out.
3. **E (archive) does not follow fix 21 (Low).** `App/Shell/AppModel+Keyboard.swift:15` still uses `ThreadLogic.leavesInbox(mailbox)`. The toolbar now uses `detail.place`.
   Scenario: Archive is selected in the sidebar. The person searches and opens a conversation that is in the Inbox. The toolbar shows Archive, but E does nothing. The other way round: with the Inbox selected, E on a conversation already in Archive (opened from search) runs archive, closes the thread and shows an Archived toast. Meanwhile the toolbar offered Move to Inbox.
4. **J/K step through a different list from the one on screen (Low).** `App/Shell/AppModel+Keyboard.swift:21`. `stepThread` runs a fresh `threadQuery(for: mailbox)` with the default limit of 50. It ignores the inbox's quick filter (`InboxViewModel.filter`), an opened bundle (`category`) and rows loaded past 50.
   Scenario: with the Unread filter on, J opens the next conversation of the unfiltered inbox. When the open conversation is row 60 (loaded by scrolling), J jumps to the first row.
5. **Single-key shortcuts stay on under the thread's own sheets (Low, plausible).** `App/Shell/AppModel+Navigation.swift:75` checks only `presented` and the composer panel. The Snooze and Move sheets are local to `ThreadToolbar.swift:34`. With a hardware keyboard, J under the Snooze sheet opens the next conversation behind it. The sheet's content closure is then re-evaluated with the new `detail.id`, so the chosen snooze applies to a conversation the person did not pick.
6. **Shortcuts work behind the lock cover (Low, plausible).** `App/Shell/FlintCommands.swift:9-11` does not check `AppLock`. `allowsHitTesting(false)` on the root does not stop menu commands. On a locked iPad with a keyboard, E archives the conversation that was open and Cmd-N opens a composer, with nothing on screen. No mail is shown, so this is not a disclosure.
7. **Templates inserted into a locked draft are invisible (Low).** `App/Features/Composer/ComposerViewModel.swift:194-199`. In a locked draft, `insert(_:)` appends the template to `keptBodyHTML` and leaves the read-only `body` as it was.
   Scenario: the person picks a template, sees no change and picks it again. The sent mail has it twice. If they then tap "Edit as plain text", the flattened `body` replaces the kept HTML and both copies are dropped without notice.
8. **The inbox audit skip is wider than its purpose (Low, test only).** `AppUITests/AccessibilityAuditTests.swift:45-47` skips every text-clipped issue on the inbox that has no element, not only the bundle summary's duplicate. Any future unplaced clipping on the inbox passes the audit. The status of 9 mentions this skip, but not how wide it is.

### Still open (from the statuses, unchanged)

9 (textClipped on Search and Thread, date-label and iPad mono-label contrast, the Thread ORIGINAL toggle), 13 (longer undo windows and scheduled sends, Wave 4B), 20 (decided: two columns), 22 (per-account alerts, signature import from the Mac), and the device-only checks in 1, 3 and 15.
