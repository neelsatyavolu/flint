# S5: Google OAuth with the iOS client

**Status: implemented and unit-tested; the live run needs the owner at a browser (gate O2 is done, the run itself is a human step).**

Client id `617596563618-84523hu1pellgad03t263u2mqig2i45i.apps.googleusercontent.com` (public, no secret), bundle id `co.xanom.flint`, redirect `com.googleusercontent.apps.617596563618-84523hu1pellgad03t263u2mqig2i45i:/oauth2redirect`.

## What exists

- `apps/ios/Spikes/s5-google/Sources/GoogleOAuthSpike`: PKCE S256, auth URL (scope `https://mail.google.com/ openid email profile`, `access_type=offline`, `prompt=consent`, optional `login_hint`), redirect validation (state, `access_denied` as cancelled), code exchange with no `client_secret`, refresh with rotation handling, ID-token parse, 5 minute refresh margin, injectable HTTP. A port of `packages/core/src/mail/google-oauth.ts`; track 2C starts from it.
- `swift test --package-path apps/ios/Spikes/s5-google`: 8 tests pass (RFC 7636 appendix B vector, URL parameters, callback validation, no secret sent, missing refresh token, `invalid_grant` to expired, 5xx and transport errors to network, margin).
- `apps/ios/Spikes/s5-google/Harness`: a throwaway iOS app (builds for the simulator) with bundle id `co.xanom.flint` that runs the real flow: `ASWebAuthenticationSession` (callback scheme = reversed client id), token exchange, then IMAP XOAUTH2 login to `imap.gmail.com:993` through SwiftMail, reporting capabilities (X-GM-EXT-1, CONDSTORE, QRESYNC) and the INBOX count. The refresh token is kept in the Keychain; "Refresh token now" reports success, rotation and age in days. Output is non-secret facts only, also written to `Documents/s5-result.txt`.

## Owner steps (about 5 minutes, then three taps over a week)

1. `cd apps/ios/Spikes/s5-google/Harness && xcodegen generate`, open `GoogleSpike.xcodeproj`, run on a simulator or a device (Cmd-R; set a signing team for a device).
2. Tap Sign in with Google, pick the owner account, click through the "Google hasn't verified this app" warning, allow. Expect lines S5.1 to S5.3.
3. Tap "Refresh token now" on day 1, day 3, day 7 and day 8. If the refresh token dies at day 7 the OAuth consent screen is still in Testing, not "In production".
4. Paste the lines into this file.

## Open questions this run answers

| Question | How it is recorded |
|---|---|
| Does a custom-scheme redirect still work for the iOS client type? | S5.1 and S5.2 |
| Is a token exchange without a secret accepted? | S5.2 |
| Is the refresh token returned, and does it rotate? | S5.2, S5.4 |
| Do imap.gmail.com XOAUTH2 login and the `mail.google.com` scope work? | S5.3 |
| Refresh-token lifetime in unverified "In production" | S5.4 over 8 days |

Go/no-go: pending the live run. The code path is the one DESIGN-NOTES section 6 specifies; fallback is AppAuth-iOS if Google starts demanding App Check or DPoP.
