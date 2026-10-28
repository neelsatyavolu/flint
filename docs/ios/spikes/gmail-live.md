# Gmail live smoke (owner, gate O5)

**Status: not run.** Everything below is unverified against real Gmail until you do it. FakeMailTransport covers the label logic, GreenMail covers plain IMAP; neither speaks X-GM-EXT-1, QRESYNC or XOAUTH2.

Use a throwaway or your own Gmail account you can afford to move mail in. Do not use a work account. Never paste tokens into this file.

## Prerequisites

1. S5 passed (see `S5-google-oauth.md`): Google sign-in works with client `617596563618-84523hu1pellgad03t263u2mqig2i45i`, and the OAuth consent screen is "In production" (a "Testing" screen kills refresh tokens after 7 days).
2. The account has a few dozen threads in the last 90 days, at least one in Inbox that you can archive.
3. Run from the app once Wave 3 onboarding (3A) is in: `apps/ios`, `xcodegen generate`, build `Flint` for a simulator or your device. Until then the same calls are `FlintService.addGoogleAccount(loginHint:)` and `FlintService.start()` (HANDOFF "From 2F"); there is no command-line way to run the browser step.

## Steps and what to record

1. **Add account.** Sign in with Google. Expect: account row with `provider = gmail`, `authKind = oauthGoogle`, no password prompt. Record: pass/fail, and the capabilities line from `testConnection` (expect X-GM-EXT-1, MOVE, IDLE; QRESYNC/CONDSTORE may be absent).
2. **Initial sync, 90 days.** Wait for sync status to go idle. Record: seconds to first rows visible, seconds to idle, message count, whether All Mail, Sent, Drafts, Trash and Spam folders and Gmail labels appear. Check a message that has two labels shows in both label views.
3. **Archive via MOVE.** Archive one Inbox thread in the app. In Gmail web, confirm the thread is gone from Inbox and still in All Mail, and the Inbox label is dropped. Undo within 30 s and confirm it returns to Inbox. Record: pass/fail for each.
4. **Trash.** Trash a thread, confirm it is in Gmail Trash. Restore it, confirm it returns.
5. **Mark read.** Mark a thread read in the app; confirm in Gmail web. Mark one unread in Gmail web; confirm the app updates (watch for the flag-window refetch if QRESYNC is absent).
6. **IDLE push.** With the app foreground, send yourself a mail from another account. Record seconds until it appears (target: under 30 s, no pull to refresh).
7. **Send and Sent copy.** Send a message to another address of yours with tracking on. Confirm exactly one copy in Gmail Sent (Gmail files SMTP sends itself; Flint must not APPEND a duplicate) and that the tracked recipient receives the clean copy.
8. **Token refresh.** Leave the app 70 minutes, reopen, trigger sync. Expect no `auth_error` and no sign-in prompt.

## Known gaps to watch (from the 2B report)

- `X-GM-RAW` server search and CHANGEDSINCE are not available through SwiftMail; Gmail server search uses plain IMAP SEARCH in All Mail. Note how search results compare to Gmail web.
- Label flows (archive = move Inbox copy to All Mail, restore = COPY) have only been tested on the fake.

## Results

| Step | Result | Notes |
|---|---|---|
| 1 Add account | | |
| 2 Initial sync | | |
| 3 Archive via MOVE | | |
| 4 Trash | | |
| 5 Mark read | | |
| 6 IDLE push | | |
| 7 Send and Sent copy | | |
| 8 Token refresh | | |
