# Wave 3 contract

What every Wave 3 track (3A Onboarding, 3B Sidebar, 3C Inbox, 3D Thread, 3E Composer, 3F Search, 3G Settings) builds on. Read [PLAN.md](PLAN.md) (Ground rules, Wave 3) and [DESIGN-NOTES.md](DESIGN-NOTES.md) first.

## Where things live

| Path | Owner | Notes |
|---|---|---|
| `App/Shell/` | shell (prep) | `AppModel`, `Route`, `RootView`, `Shells`, `FeatureRegistry`, `LaunchRoute`. Request changes in HANDOFF.md |
| `App/Shared/` | shell (prep) | Toasts, skeleton, empty state, error banner, sheet header, dates, formatting, error text |
| `App/Seed/` | shell (prep) | Demo mailbox. Add data through HANDOFF.md |
| `App/Theme/` | theme | `FlintColor`, `FlintFont`, `FlintMetrics`, `FlintRow`, `FlintBar`, `FlintButton`, `FlintAvatar`, `FlintIcon` |
| `App/Features/<Name>/` | the track | `<Name>Module.swift` (keep) and `<Name>Root.swift` (placeholder, replace) plus `<Name>.xcstrings` |
| `AppTests/<Name>/`, `AppUITests/<Name>Tests.swift` | the track | |

A track edits only its own folder and its own test paths. Everything else is requested in `docs/ios/HANDOFF.md` as one line: file, change, why.

## Placeholders each track replaces

| Track | Module id | Replace | Presented as |
|---|---|---|---|
| 3A | `onboarding` | `Features/Onboarding/OnboardingRoot.swift` | sheet for `Route.onboarding`; opens by itself when a live launch has no accounts; a `flint://pair` link waits in `AppModel.pendingLink` |
| 3B | `sidebar` | `Features/Sidebar/SidebarRoot.swift` | first column on iPad, sheet on iPhone (`model.presented == .sidebar`) |
| 3C | `inbox` | `Features/Inbox/InboxRoot.swift` | second column on iPad, first screen on iPhone |
| 3D | `thread` | `Features/Thread/ThreadRoot.swift` | third column on iPad, pushed on iPhone; reads `model.openThread` |
| 3E | `composer` | `Features/Composer/ComposerRoot.swift` | sheet for `Route.compose`; the request is `model.presented` |
| 3F | `search` | `Features/Search/SearchRoot.swift` | sheet for `Route.search` |
| 3G | `settings` | `Features/Settings/SettingsRoot.swift` | sheet for `Route.settings(section)` |

Keep the `<Name>Root` type name and the module file, so the registry needs no edit. Every root draws its own `FlintBar` or `SheetHeader`; the system navigation bar is hidden by the shell. Read the model with `@Environment(AppModel.self)`.

## AppModel (`App/Shell/AppModel*.swift`)

`@MainActor @Observable`. Screens read state, call the async methods, and never import the engine modules for anything the model wraps. For anything it does not wrap, `try model.requireService()` returns the `FlintService`.

**State** (refreshed from the service streams): `phase` (`.launching`, `.ready`, `.failed(text)`), `accounts`, `sidebar: SidebarData?`, `syncStatuses`, `settings`, `codes`, `recentSearches`, `isDemo`, `toasts: ToastCenter`.
**Navigation state**: `mailbox: MailboxSelection`, `openThread: ThreadID?`, `presented: Presented?`, `columnVisibility`, `pendingLink`.

**Navigation**: `navigate(to: Route)`, `toggleSidebar(columns:)`, `handle(url:)`, `handle(link:)`, `takePendingLink()`, `title(for:)`, `accountName(_:)`, `account(_:)`, `threadQuery(for:)`.

**Reading** (throws `FlintError`): `listThreads(_ query)`, `threadPages(_ query)` (stream, first page, refreshes), `loadOlder(_)`, `threadDetail(_)`, `threadStream(_)`, `message(_)`, `allowRemoteImages(messageId:always:)`, `folders(accountId:)`, `attachmentFile(_)`, `suggestContacts(prefix:limit:)`, `drafts()`, `scheduled()`, `search(_:accountId:limit:cursor:)`, `searchServer(_:accountId:)`, `recordSearch(_)`, `clearRecentSearches()`.

**Actions on conversations** (return Bool, toast with Undo as on the desktop, error toast on failure, pin and read are quiet): `archive`, `trash`, `markRead(_:read:)`, `setPinned(_:pinned:)`, `markSpam(_:spam:)`, `move(_:to:)`, `moveToInbox`, `snooze(_:until:)`, `unsnooze`, `setMuted(_:muted:)`, `setCategory(_:_:rememberSender:)`, plus `unsubscribe(messageId:)`, `blockSender(_)`, `undo(token:)`.

**Compose and send**: `startCompose(_ DraftInit)`, `createDraft`, `draft(id:)`, `updateDraft(id:_:)`, `deleteDraft(id:)`, `flushDraft(id:)` (call when the composer closes), `openServerDraft`, `addAttachment`, `removeAttachment`, `sendDraft(id:sendAt:)` (toast "Sent" or "Scheduled for ...", Undo reopens the draft), `undoSend(scheduledId:)`, `rescheduleSend`.

**Settings, accounts, sync**: `updateSettings(patch:)`, `updateSettings(_:)`, `autoconfig`, `autoconfigAdvice`, `testConnection`, `addAccount`, `addGoogleAccount`, `updateAccount`, `removeAccount`, `syncNow(accountId:)`, `syncStatus(for:)`.

**Events**: `model.events()` is the service's `AsyncStream<FlintEvent>` (new mail, sends, receipts). Service toasts already reach `model.toasts`.

**Errors**: `FlintErrorText.message(for:)` gives the sentence to show; `ErrorBanner(error:retry:)` shows it. `model.report(error)` toasts it. Never show `error.localizedDescription`.

## Route and selections

```
Route: .mailbox(MailboxSelection) .thread(ThreadID) .compose(ComposeRequest) .search(String?) .settings(SettingsSection)
       .onboarding .sidebar .dismiss
MailboxSelection: .inbox(AccountID?) .pinned .drafts .scheduled .snoozed .sent .archive .trash .spam .folder(AccountID, FolderID)
ComposeRequest: .start(DraftInit) | .resume(draftId:)
SettingsSection: root accounts appearance inbox compose signatures rules notifications privacy receipts about
Presented (the sheet): .sidebar .compose .search .settings .onboarding
```

`.scheduled` is a list of `ScheduledSend` (`model.scheduled()`), not threads; the others have `selection.threadQuery()`. `navigate(to: .mailbox)` closes the sidebar sheet and any open thread. `.dismiss` closes the sheet, else the open thread. Deep links: `flint://pair#...` opens onboarding with the payload in `pendingLink`; a Google redirect waits in `pendingLink`. New `DeepLink` cases (for example `flint://thread/<id>` for notifications) are a HANDOFF request.

## Shared UI (`App/Shared`)

`ToastCenter` + `ToastHost` (5 s, one at a time, Undo), `SkeletonRows`, `FlintEmptyState`, `ErrorBanner`, `SheetHeader`, `FlintTime` (`listTime`, `ago`, `fullDate`, `dateGroupLabel`, ported from `lib/format.ts`), `SnoozePresets` (`resolve`, `formatTime`, from `lib/time.ts`), `FlintFormat` (`participants`, `displayName`, `address`, `recipients`, `fileSize`, `plural`), `FlintErrorText`. Theme pieces stay in `App/Theme`.

## Conventions

- Accessibility identifiers are `feature.element`, lower camel after the dot: `inbox.row.<threadId>`, `inbox.search`, `thread.back`, `composer.send`, `settings.account.<id>`. Shell ids: `shell.root`, `shell.pad`, `shell.phone`, `toast.root`, `toast.undo`. Every interactive view has one.
- Strings go in `Features/<Name>/<Name>.xcstrings` and are used as `String(localized: "...", table: "<Name>")` or `Text("...", tableName: "<Name>")`. Plain sentence case, no exclamation marks, no emoji. Shared and shell strings live in `Shared.xcstrings` and `Shell.xcstrings`.
- Flat, opaque chrome: no system glass, no shadows, 12 px message cards, 4 px controls, Geist Mono labels, one accent.
- Swift 6 strict concurrency, small files (800 max), functions under 50 lines, immutable value types.

## The demo mailbox

`-FlintSeed demo` opens a fresh temporary database and fills it through the real sync path from in-memory servers (`FakeMailTransport`). No network, no Keychain, nothing of the owner's. Three accounts: `maya.okafor@example.com` (Google sign-in, Gmail labels), `maya@northwind.example` (IMAP, work) and `hello@mayaokafor.example` (IMAP, personal). About 40 conversations: people (quoted replies up to four messages, attachments, a forwarded mail, a calendar invite with `invite.ics`), notifications (code review, statement, shipping, tracker, security alert), newsletters (one long HTML with remote images and a tracking pixel), a verification code (`482913`, detected as new mail), two pinned, one snoozed to tomorrow 08:00, two drafts, one scheduled send (tomorrow 09:00), two tracked sends (one opened by Tomas and replied by Sam, one only sent), an archived and two trashed threads.

From tests: `let app = try await SeededApp.make()` (`AppTests/Support/SeededApp.swift`) gives a booted `AppModel`; `await app.tearDown()` at the end. From UI tests: `ShellTests.launchSeeded(appearance:route:)`. In code: `DemoSeed.make()`, or `AppModel(mode: .demo)`.

`-FlintRoute <spec>` opens a screen after launch: `inbox`, `inbox:<n>`, `pinned`, `drafts`, `scheduled`, `snoozed`, `sent`, `archive`, `trash`, `spam`, `thread:<subject start>`, `sidebar`, `search`, `search:<query>`, `settings`, `compose`, `onboarding`. `-FlintAppearance dark|light` forces Graphite or Paper.

## Commands

Use your own temporary simulator and derived data path (unique per track), and delete the simulator when done, even on failure.

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
cd apps/ios && xcodegen generate            # after adding or removing files
D=/private/tmp/claude-503/<track>           # derived data and screenshots
PHONE=$(xcrun simctl create flint-<track>-phone com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro com.apple.CoreSimulator.SimRuntime.iOS-26-5)
PAD=$(xcrun simctl create flint-<track>-pad com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M5-16GB com.apple.CoreSimulator.SimRuntime.iOS-26-5)

# build once per device family, run unit tests
xcodebuild -project Flint.xcodeproj -scheme Flint -destination "id=$PHONE" -derivedDataPath $D/dd build
xcodebuild test -project Flint.xcodeproj -scheme Flint -destination "id=$PHONE" -derivedDataPath $D/dd -only-testing:FlintTests/<Suite>

# screenshots: both themes, iPhone and iPad (then read the PNGs)
for theme in dark light; do
  scripts/seed-screenshot.sh $PHONE $theme "thread:Q4 roadmap" $D/phone-$theme-thread.png $D/dd
  scripts/seed-screenshot.sh $PAD   $theme inbox               $D/pad-$theme-inbox.png    $D/dd
done

xcrun simctl delete $PHONE $PAD             # always, even when something failed
swift test --package-path apps/ios/Packages/FlintCore   # core, on the Mac host
```

UI tests: `-only-testing:FlintUITests/<Name>Tests` on the same destination. Never run the seeded app with the owner's accounts, and never drive Mac GUI apps.

## Requesting shared changes

One line in `docs/ios/HANDOFF.md` under your track: `file | change | why`. The shell owner applies it. Do not edit `App/Shell`, `App/Shared`, `App/Seed`, `App/Theme`, `project.yml` or `Packages/FlintCore` from a feature track.
