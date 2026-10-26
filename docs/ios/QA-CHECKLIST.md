# Flint for iOS: QA checklist (Wave 3)

The lead's manual script for the Wave 3 build. Each step is marked:

- **auto**: covered by a test that runs without a person (`swift test`, `FlintTests`, `FlintUITests`).
- **sim**: checked by hand or by screenshot on a simulator during integration; repeat on a simulator before each release.
- **device (O5)**: needs a real iPhone or iPad and the owner. Agents cannot do these.

Never run these steps against the owner's real accounts on a simulator. Use the demo mailbox (`-FlintSeed demo`) or GreenMail.

## Setup

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
cd apps/ios && xcodegen generate
D=/private/tmp/flint-qa
SIM=$(xcrun simctl create flint-qa com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro com.apple.CoreSimulator.SimRuntime.iOS-26-5)
xcodebuild -project Flint.xcodeproj -scheme Flint -destination "id=$SIM" -derivedDataPath $D/dd build-for-testing
T="-parallel-testing-enabled NO -disable-concurrent-destination-testing -maximum-concurrent-test-simulator-destinations 1"
xcodebuild test-without-building -project Flint.xcodeproj -scheme Flint -destination "id=$SIM" -derivedDataPath $D/dd $T -only-testing:FlintTests
xcodebuild test-without-building -project Flint.xcodeproj -scheme Flint -destination "id=$SIM" -derivedDataPath $D/dd $T -only-testing:FlintUITests -skip-testing:FlintUITests/EndToEndTests
scripts/e2e-greenmail.sh $SIM $D/dd            # GreenMail end to end, see below
TEST_RUNNER_FLINT_SHOT_DIR=$D/shots xcodebuild test-without-building ... -only-testing:FlintUITests/ScreenTourTests   # screenshots
xcrun simctl delete $SIM                         # always
swift test --package-path Packages/FlintCore     # engine, on the Mac
```

## 1. Build and launch

| # | Step | Expected | Mark |
|---|---|---|---|
| 1.1 | Build for an iPhone and an iPad simulator | Builds with no errors | auto |
| 1.2 | `swift test` in `Packages/FlintCore` | All suites pass | auto |
| 1.3 | `FlintTests` (unit tests in the app host) | All pass | auto |
| 1.4 | Launch with `-FlintSeed demo` | Inbox with three accounts and about 40 conversations | auto (`ShellTests`) |
| 1.5 | Launch on a real iPhone from Xcode | Same, signed with team VTQW687WBQ | device (O5) |

## 2. Onboarding (3A)

| # | Step | Expected | Mark |
|---|---|---|---|
| 2.1 | Fresh install, no accounts | Onboarding opens by itself and cannot be swiped away | auto (`EndToEndTests`) |
| 2.2 | Welcome shows Continue with Google, Other email, Set up from your Mac (disabled) and "Mail stays on this phone" | Mac row is dimmed and does nothing | auto (`OnboardingTests`), sim |
| 2.3 | Other email: type a Gmail address | Google instead button and the app password hint appear; Add stays off until there is a password | auto |
| 2.4 | Other email: `sam@example.org` | "Looking up servers", then a summary with Edit | sim |
| 2.5 | Other email: a `proton.me` address | Red Proton Bridge notice, no Add button | auto (view model), not seen on screen |
| 2.6 | Other email: an `outlook.com` address | Amber Microsoft notice; the form stays usable | auto (view model) |
| 2.7 | Test connection with a wrong password (GreenMail) | Incoming line says the sign-in failed, in plain words | not yet run |
| 2.8 | Add a GreenMail account (see section 9) | Choices screen, then the inbox fills | auto (`EndToEndTests`) |
| 2.9 | Choices: Smart inbox off, then Done | The inbox shows all mail, no bundles | not yet run |
| 2.10 | Notifications toggle on the choices screen | Does nothing yet (wave 4) | n/a |

### Google sign-in (owner only, O2 done, O5)

1. On a real iPhone with a fresh install, tap **Continue with Google**.
2. The system sign-in sheet opens on accounts.google.com (not a web view inside Flint). Pick the owner's account.
3. Click through "Google hasn't verified this app" (Advanced, then Go to Flint) and allow access to mail.
4. Expect the choices screen, then the inbox with the Gmail account and its labels as folders in the sidebar.
5. Settings > the Gmail account: status is "Up to date"; Re-authenticate opens the same sheet with the address filled in.
6. Close the app for a day and open it: no "Sign in again" banner (the refresh token works).
7. Repeat Other email with a Gmail address and tap **Sign in with Google instead**: same flow with the address as login hint.
8. Record in `docs/ios/spikes/S5-google-oauth.md` how long the refresh token lives (day 1, 3, 7, 8).

## 3. Sidebar (3B)

| # | Step | Expected | Mark |
|---|---|---|---|
| 3.1 | iPhone: tap the menu button | Sheet with All inboxes and each account (avatar, address, unread count), Pins, Drafts, Sent, Scheduled, Snoozed, Archive, Trash, folders, Settings | auto (`SidebarTests`), sim |
| 3.2 | Tap an account | The sheet closes and the list shows that account's inbox | auto |
| 3.3 | Collapse the per-account rows | They fold under All inboxes | auto |
| 3.4 | iPad: sidebar is the first column; the menu button hides and shows it | Three flat columns, hairlines, no floating glass sidebar. Under 1000 pt wide the sidebar opens over the list | sim (`ScreenTourTests.testPadColumns`, 13-inch only) |
| 3.5 | Sync line, offline and sign-in banners | Plain text under the accounts | auto (logic only); not seen on screen |

## 4. Inbox (3C)

| # | Step | Expected | Mark |
|---|---|---|---|
| 4.1 | Smart inbox: people first, Notifications and Newsletters bundle rows | Bundles show counts and the newest sender | auto (`InboxTests`), sim |
| 4.2 | Date group labels in Geist Mono caps (Today, Yesterday, ...) | | sim |
| 4.3 | Open the Newsletters bundle, then Back | Bundle list, then the inbox again | auto |
| 4.4 | Filter All / Unread | Unread hides bundles and read rows | auto |
| 4.5 | Swipe left: Archive, then Undo in the toast | Row leaves, toast "Archived" with Undo, row returns | auto |
| 4.6 | Swipe right: Read and Pin | Unread dot toggles; the pin mark shows | not yet run by hand |
| 4.7 | Settings > Inbox > Swipe right / Swipe left | The chosen action is the first one on that side of the row | auto (logic) |
| 4.8 | More > Select, pick rows, batch Archive | Batch bar, toast with Undo | auto |
| 4.9 | Snooze from the swipe, pick Tomorrow | Row leaves; it appears under Snoozed | auto (`EndToEndTests`) |
| 4.10 | Pull to refresh | Sync line updates; no duplicate rows | sim |
| 4.11 | Verification code row chip (`482913`) | Chip shows the code; tap copies | not seen on screen |
| 4.12 | VoiceOver on a row with a live code | The code is spoken; the "Copy code" action copies it | auto (spoken text); VoiceOver by hand not run |
| 4.12 | Skeleton rows on a cold launch | Grey bars until the first page | not seen on screen |
| 4.13 | Empty list (Spam in the demo) | Plain empty state with the Flint mark | sim |
| 4.14 | VoiceOver on a row | Reads sender, subject, time, unread | auto (audit), device (O5) for the full pass |

## 5. Thread (3D)

| # | Step | Expected | Mark |
|---|---|---|---|
| 5.1 | Open "Q4 roadmap notes" (plain text, quoted replies) | Header, 12 px cards, older messages collapsed, quoted text folded | auto (`ThreadTests`), sim |
| 5.2 | Open "Engineering Digest" (HTML) in Graphite | Dark-adapted HTML; Original/Adapted toggle | sim |
| 5.3 | Same in Paper | Original HTML on a light sheet | sim |
| 5.4 | Open "Quarterly Maker" (remote images, tracker) | "Load images" banner and tracker count; nothing loads until tapped | sim |
| 5.5 | Tap a link whose text and target differ | Alert names the real host before opening | not yet run |
| 5.6 | Open an attachment | Quick Look | not yet run |
| 5.7 | Reply from the dock | Composer with the quote; after Send, a queued card with Undo until it goes | auto (`EndToEndTests` sends it) |
| 5.8 | Archive, Trash, Pin, More menu | Each acts and toasts like the list | partly auto |
| 5.8a | Snooze (clock) and Move to folder (More) from the open thread | Thread-owned sheets; the thread closes with a toast | auto (UI, iPhone and iPad) |
| 5.8b | Open a thread from search, tap Back | Returns to the same search and results | auto (`testSearchResultKeepsTheSearch`) |
| 5.9 | Receipt row on a tracked sent message | "Opened" / "Not opened yet" honestly | not seen on screen |

## 6. Composer (3E)

| # | Step | Expected | Mark |
|---|---|---|---|
| 6.1 | New message, type "daniel" in To | Contact suggestion; picking it makes a chip | auto (`ComposerTests`) |
| 6.2 | Subject, body, Bold | Body keeps the formatting; HTML and text are both sent | auto |
| 6.3 | Send | Toast "Sending in 10s" with Undo and a draining bar; after the window it goes | auto (toast text), sim |
| 6.4 | Undo inside the window | The composer reopens with the draft | auto (`AppModelTests`) |
| 6.5 | Send without a recipient | "Add at least one recipient." | auto |
| 6.6 | Send later: schedule sheet with presets | Toast "Scheduled for ..."; row under Scheduled | auto (sheet opens) |
| 6.7 | Discard asks first | Alert with Keep draft / Discard | auto |
| 6.7a | Insert template from the composer menu | Inserted at the cursor; fills an empty subject | auto (logic); not seen on screen |
| 6.7b | Open a server draft with tables or images | Body read only with a note; "Edit as plain text" flattens only on request | auto (logic); not seen on screen |
| 6.8 | iPad: the composer is a floating panel at the bottom right; the list stays usable | Panel shrinks to fit above the keyboard | sim (screenshot); keyboard overlap not checked with a hardware keyboard |
| 6.9 | Attach from Photos, Files and camera | Attachment rows with sizes | device (O5) for the camera; Photos and Files not yet run |
| 6.10 | Autosave to the server Drafts folder (GreenMail) | Draft appears in Drafts on the server | not yet run |
| 6.11 | iPad hardware keyboard: Cmd-N compose, Cmd-R reply, Shift-Cmd-R reply all, E archive, J/K or Down/Up next and previous, Cmd-F search, Cmd-Return send | Each does its action; letter and arrow keys are off while a sheet or the composer panel is up; the Cmd-hold overlay lists them | auto on iPad simulator (`ShellFixTests`: Cmd-N, Cmd-R, Cmd-F, E, J, Up); Shift-Cmd-R and K by logic only; device (O5) for a real Magic Keyboard |

## 7. Search (3F)

| # | Step | Expected | Mark |
|---|---|---|---|
| 7.1 | Open search, type "roadmap" | Results as conversations | auto (`SearchTests`) |
| 7.2 | Tap the `is:unread` chip | Adds the operator to the field | auto |
| 7.3 | No local match | "Search the server" button | auto |
| 7.4 | Server search on GreenMail | Results from the server | not yet run |
| 7.5 | Recents | Last queries listed; Clear empties them | auto (model) |
| 7.6 | Search a GreenMail account | Finds the delivered message | auto (`EndToEndTests`) |

## 8. Settings (3G)

| # | Step | Expected | Mark |
|---|---|---|---|
| 8.1 | Root lists accounts and every page | Accounts, Appearance, Inbox, Composing, Signatures, Rules, Notifications, Privacy, Read receipts, About | auto (`SettingsTests`), sim |
| 8.2 | Account detail: colour, show in unified inbox | Sticks after leaving the page | auto |
| 8.3 | New signature | Appears in the list | auto |
| 8.4 | Undo send 30 seconds | Value sticks; the next send counts down from 30 | auto (value) |
| 8.5 | Rule without a name | "Name the rule." | auto |
| 8.6 | Appearance: Graphite / Paper / System | Whole app switches | sim |
| 8.7 | Re-authenticate and Remove account (GreenMail) | Remove asks first; mail of that account goes | not yet run |
| 8.8 | Privacy: Face ID lock | Flat lock screen on launch and on return from background; flat cover (no mail) in the app switcher; Unlock asks Face ID or passcode; a cancelled prompt stays locked | state machine auto; lock screen sim (`-FlintFakeAuth`); real Face ID and app switcher device (O5) |
| 8.9 | About: version and licenses | | sim |
| 8.9a | Licenses | 24 bundled projects, each with copyright line and full license text | auto (logic); not seen on screen |

## 9. End to end on GreenMail

`scripts/e2e-greenmail.sh <sim udid> <derived data>` starts GreenMail with its IMAP proxy on 127.0.0.1 (IMAP 3144 through the proxy, SMTP 3025), delivers two messages from bob to alice, uninstalls Flint from the simulator, runs `EndToEndTests` and then reads bob's inbox to confirm the reply arrived.

| # | Step | Expected | Mark |
|---|---|---|---|
| 9.1 | Add Other email `alice@test.local`, servers 127.0.0.1, ports 3144 and 3025, TLS off, user `alice`, password `secret` | Choices, then the inbox | auto |
| 9.2 | Read "Lantern check ..." | Thread opens with the body | auto |
| 9.3 | Reply and send | "Sending in 10s", then bob receives "Re: Lantern check ..." | auto |
| 9.4 | Archive with Undo | Row leaves and comes back | auto |
| 9.5 | Snooze "Kettle note ..." until tomorrow | Row leaves the inbox | auto |
| 9.6 | Search "Lantern" | The conversation is found | auto |

## 10. Cross-cutting

| # | Step | Expected | Mark |
|---|---|---|---|
| 10.1 | Every main screen in Graphite and Paper, iPhone and iPad | Flat chrome, no system glass, no shadows, one blue accent | sim (`ScreenTourTests` screenshots) |
| 10.2 | Dynamic Type AX3 on inbox, thread, composer | No clipped rows or fields | sim (`ScreenTourTests.testLargeText`) |
| 10.3 | Accessibility audit on the main screens | No failures beyond the exceptions listed in the test header | auto (`AccessibilityAuditTests`, iPhone and iPad) |
| 10.4 | Full VoiceOver pass | Every row and action has a label | device (O5) |
| 10.5 | iPad rotation and Split View sizes | Columns collapse cleanly | sim (13-inch portrait and landscape); 11-inch portrait run (list and reader, sidebar on demand: decided, see HANDOFF); Split View and Stage Manager not run |
| 10.6 | Background refresh, local network prompt, notifications | Wave 4 | device (O5) |
