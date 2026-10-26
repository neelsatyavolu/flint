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

### 2. Image-heavy HTML mail freezes the main thread for seconds to minutes
`App/Features/Thread/QuotedText.swift:48` (fourth `htmlMarkers` pattern) and `:50` (`wroteTail`), called from `MessageBodyView.swift:39` inside `body`.
`<(?:div|p|span)\b[^>]*>\s*(?:<[^>]+>\s*)*On\s...` re-scans the whole following run of tags from every `<div>`, `<p>` and `<span>`. On markup with long runs of tags and no text between them (image-only promotions, layout tables), the cost grows with the square of the size. Measured on the host with `-O`: 66 KB took 0.26 s, 199 KB 2.3 s, 398 KB 9.1 s and 1.3 MB 102 s. A normal text newsletter of 342 KB took 0.03 s. The split runs in a SwiftUI `body`, so it runs again on every re-render of the message (a verdict, the Original/Adapted toggle, expanding a card).
Failure: opening a 300 KB promotional mail locks the UI for several seconds, and each toggle locks it again. A big one looks like a hang, and the watchdog can kill the app. Fix: run the split once per message off the main actor and cache it, and bound the pattern (atomic groups, or scan the text near each candidate instead of the whole tag run).

### 3. No iPad hardware-keyboard shortcuts (a Wave 3 acceptance item)
`App/Features/Composer/ComposerRoot.swift:122,128` and `ComposerEditor.swift:132` are the only `keyboardShortcut` uses in the app. There is no `.commands`, `UIKeyCommand` or `.keyboardShortcut` for compose, reply, archive, next/previous or search.
Failure: on an iPad with a Magic Keyboard, Cmd-N, Cmd-R, E, J/K and Cmd-F do nothing, and the Cmd-hold overlay is empty apart from Send. PLAN.md requires "hardware-keyboard shortcuts for the DESIGN/SPEC subset (compose, reply, archive, next/previous, search)". QA 6.11 lists Cmd-N and Cmd-R as if they existed.

## Medium

### 4. The thread has no Snooze and no Move to folder
`App/Features/Thread/ThreadToolbar.swift:13-25, 32-53`.
The desktop `ReaderToolbar.tsx:74-75` has Move to folder (v) and Snooze (h) next to Archive and Trash. The iOS toolbar and its More menu have Archive/Move to Inbox, Trash, Pin, Mark unread, Mute, Spam, Category and Block, but neither of those two.
Failure: a person reads a mail and wants to snooze it until tomorrow. They have to go back to the list and swipe, which only works if Snooze is still one of their swipe actions. "Snooze works end to end" is in the acceptance, and from the reader it does not.

### 5. On iPad, opening any conversation closes the composer panel
`App/Shell/AppModel+Navigation.swift:12-14` (`.thread` sets `presented = nil`, and so do `.search` and `.settings`); `App/Shell/RootView.swift:41-44` (the panel exists only while `presented == .compose`).
QA 6.8 says "the list stays usable" behind the floating panel. It does take touches, but tapping a row calls `navigate(to: .thread)`, which clears `presented`, and the panel disappears. The draft is saved by `onDisappear`, but it is gone from the screen.
Failure: while writing a reply on iPad, the person taps another mail to copy a detail from it, and the composer vanishes. They have to find it again under Drafts. On the desktop, the composer stays open while you read.

### 6. Swipe actions changed in Settings don't apply until relaunch
`App/Features/Inbox/InboxViewModel.swift:46,56` reads `SwipeConfiguration` once, in `init`. `App/Features/Settings/PreferencePages.swift:111-115` writes the new value to UserDefaults, but the inbox's live `viewModel.swipe` never reloads (`InboxScreen` keeps one `@State` model for the session).
Failure: Settings > Inbox > Swipe left is set to Trash and the sheet is closed. Swiping left on a row still archives. QA 4.7 is "auto (logic)" only, so no test catches this. The inbox's own swipe sheet does update, because it writes to the view model directly.

### 7. Opening a search result throws the search away
`App/Features/Search/SearchRoot.swift:57-60` together with `AppModel+Navigation.swift:13`.
`navigate(to: .thread)` sets `presented = nil`, which closes the search sheet and its view model.
Failure: the person searches "invoice", opens the third result and taps Back. They land on the inbox, not the results, and have to search again for the fourth result. The same thing happens on iPad. On the desktop, results stay in the list pane.

### 8. Editing a draft written elsewhere flattens its HTML
`App/Features/Composer/ComposerViewModel.swift:140` (`RichTextHTML.attributed(fromHTML:)`) and `:165-171` (`bodyChanged` pushes the editor's HTML). `RichTextHTML.swift:137-153` keeps only b/i/a/br/li and the block breaks.
Failure: the person opens a server draft written on the Mac (tables, inline images, colours, font sizes) from Drafts and types one character. The autosave replaces the draft's HTML on the device and on the server Drafts folder with plain divs, and the formatting and inline images are lost. Opening it without editing is safe. Warn before editing such a draft, or keep the original HTML when the editor cannot represent it.

### 9. The accessibility audit fails on two main screens
`AppUITests/AccessibilityAuditTests.swift:29`.
- iPhone, Paper inbox (`testInboxPaper`): 6 "Contrast failed" issues the audit cannot place on an element. It failed twice in a row. The likely source is white initials on the light avatar tints (for example "CO" on light blue) or the blue "6 new" counts on the Paper plane.
- iPad, composer (`testComposer`): "Contrast failed" on the note "Read receipts need a receipts address in Settings. This message won't be tracked." (`ComposerForm.swift:106`), which is grey Geist Mono on the panel.
QA 10.3 says "No failures beyond the exceptions listed". The suite also skips `textClipped` for every screen, so the audit never checks the acceptance item "AX3 does not clip list rows or the composer" (see 16).

### 10. Inline images can crash the reader when a message closes mid-load (plausible)
`App/Features/Thread/AttachmentSchemeHandler.swift:31-45`.
After `webView(_:stop:)`, the task is cancelled, but `didFailWithError` still runs if `load` throws anything other than `CancellationError`. That happens if the IMAP fetch fails, or if the service wraps the cancellation in a `FlintError`. WebKit raises an Objective-C exception when a stopped `WKURLSchemeTask` is messaged.
Failure: the person opens a mail with a large `cid:` image that is not cached yet, then collapses the card or leaves the thread before the image arrives. The fetch then fails or times out, and the app crashes. Guard every `didReceive`/`didFinish`/`didFail` with a "stopped" set, checked on the main actor.

### 11. The rule-list backstop is switched off for mail where the sanitizer found no remote images
`Packages/FlintCore/Sources/FlintService/Reading.swift:139` (`remoteImages = allow || !hasRemoteImages ? .allowed : .blocked`), `App/Features/Thread/MessageBodyView.swift:31`, `MailFrameView.swift:44,70`.
DESIGN-NOTES section 5.3 says the content rule list blocks images by default and that "Load images" removes the image rule for that message only. In practice, every message where the SwiftSoup pass found no remote image is marked `.allowed`, so it gets the `remote-images` list, which lets http(s) images through. The rule list was meant to be the second layer behind the sanitizer, and here it trusts the sanitizer's own verdict.
Failure: a remote image vector the sanitizer misses (a future CSS or markup trick) loads its pixel on open, because the backstop was already lifted. Use the image-blocking list unless the person or the policy allowed images, not when nothing was detected.

### 12. Privacy copy claims more than the app does, and says "iPhone" on iPad
`App/Features/Settings/PrivacyAboutPages.swift:45, 96`; `AccountDetailView.swift:70`.
"Flint talks only to your mail provider" and "Flint talks to your mail provider and nothing else" are not true. Setup sends the email domain to `https://autoconfig.thunderbird.net` (`FlintMail/Autoconfig/Autoconfig.swift:95`), and tracked sends talk to the receipts service. On iPad the same pages, and the Remove account dialog, say "stored on this iPhone".
Failure: a reader who trusts the privacy page is misled about third-party contact, and an iPad owner reads copy that is plainly wrong for their device. Given the owner's stance on verified privacy claims, the wording should match what the app does.

### 13. Sends queued inside the undo window wait while the app is in the background
`App/Shell/FlintApp.swift:20` → `AppModel.swift:94` (`service.stop()` stops the scheduler pump).
Failure: the person taps Send, sees "Sending in 10s" and locks the phone. The message does not go until Flint is opened again, which could be hours later. `beginBackgroundTask` around sends is Wave 4 (4B), but until then the toast promises something the app cannot do. Consider at least a background task covering the undo window now, because it is small and the failure is silent.

## Low

### 14. Templates can be edited but not used
`App/Features/Settings/SignaturesViews.swift:23-26, 116` has a full templates editor. Nothing in `Features/Composer` reads templates. The desktop composer inserts them (`features/compose/ComposerBar.tsx`, `ReplyToolbar.tsx`).
Failure: the person writes a template in Settings, then finds no way to insert it while composing.

### 15. The inbox's verification-code chip is out of reach for VoiceOver and UI tests
`App/Features/Inbox/InboxRow.swift:49-54` (`.accessibilityElement(children: .ignore)`) and `:104-108` (the chip's `onTapGesture`). No custom action is added for it.
Failure: a VoiceOver user cannot copy `482913` from the list. They have to open the thread and use the banner. `inbox.code.<id>` is also hidden from XCUITest, which is why QA 4.11 is "not seen on screen". Add an `accessibilityAction(named: "Copy code")`.

### 16. AX3 still clips text that carries information
Seen on the iPhone AX3 screenshots. The message header date reads "Oct 26, 2026, 3:…" with the time cut off (`MessageCardView.swift:76`, `lineLimit(1)`). The composer title reads "New…", and From shows "maya.okafor@exam…".
Failure: at AX3 the time a message arrived cannot be read at all. The acceptance says AX3 must not clip the composer, and the audit cannot catch this because `textClipped` is skipped.

### 17. Plain-text quote detection is quadratic on long blank runs
`App/Features/Thread/QuotedText.swift:35`: for every line, `nextFilled` scans forward. 20,000 blank lines took 3.1 s on the host, and this also runs in `body`.
Failure: a log dump or a badly generated mail with big gaps stalls the thread view.

### 18. "Block trackers" off still blocks trackers in the reader
`App/Features/Thread/ReaderRuleStore.swift:18` always attaches `ContentRuleLists.trackers()`. The setting reaches only the sanitizer (`Reading.swift:133`).
Failure: someone who turns tracker blocking off to see a broken newsletter's images still finds them blocked after "Load images", with no explanation. This fails safe, so it is low priority, but the switch does less than its label says.

### 19. Compiled rule lists build up on disk and recompile on every launch
`App/Features/Thread/ReaderRuleStore.swift:21` names the receipts list with `abs(endpoint.hashValue)`. Swift's hash seed changes on every launch, so each launch compiles and stores a new list in `WKContentRuleListStore.default()` and never removes the old ones. `:31-37` also compiles the tracker list on first use in each launch instead of looking up the stored copy, which delays the first HTML message.
Fix: use a stable digest of the host, call `lookUpContentRuleList` before compiling, and remove stale identifiers.

### 20. iPad 11-inch portrait has two columns, not three
`App/Shell/Shells.swift:10,17`: `wideWidth = 1000`, and an 11-inch iPad in portrait is 834 pt wide.
The acceptance says three columns in landscape and portrait. The deliberate fallback (the sidebar over the list) is reasonable but differs from the text. QA 10.5 notes that 11-inch was not run.

### 21. The Archive button follows the current list, not where the conversation is
`App/Features/Thread/ThreadRoot.swift:53` (`leavesInbox(model.mailbox)`).
Failure: with Archive selected in the sidebar, the person searches and opens a conversation that is in the Inbox. The toolbar offers "Move to Inbox" instead of Archive.

### 22. Plan items missing from 3A and 3B
- The onboarding choices screen has no signature choice (DESIGN-NOTES 6.5 lists notifications, Smart inbox and signature). `App/Features/Onboarding/ChoicesStep.swift`.
- The sidebar has no Recents (PLAN 3B). `App/Features/Sidebar/SidebarRoot.swift:4-5`.
- Account detail has no sync window or per-account alerts (DESIGN-NOTES 6 settings map). `AccountDetailView.swift`.

### 23. The Licenses page names the packages but includes no license text
`App/Features/Settings/PrivacyAboutPages.swift:113-121`. BSD-2, MIT and Apache-2.0 require the copyright and licence notice to ship with binaries. This is tracked for 5D (`THIRD-PARTY.md`), but the in-app page should show or link to the texts before TestFlight.

### 24. Small test-tooling nits
- On iPad, `ScreenTourTests` saves its screenshots with a `phone-` prefix (`phone-columns-portrait-dark.png` and so on).
- The landscape iPad shots from `testPadColumns` come out rotated 90 degrees and clipped, with the content running off the image and a black band. It could not be settled from the images whether that is the capture or the app laying out wrongly after rotation. Someone should rotate a simulator by hand once and look.

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
