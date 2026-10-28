# S6: loopback listener while a web auth session is up

Run 2026-10-25 on iOS 27.0 and iOS 26.5 simulators. Code: `apps/ios/Spikes/s6-loopback`. The app starts an `NWListener` (plain TCP, in-process) on a fixed port, then after 1 s starts an `ASWebAuthenticationSession` (ephemeral, so no consent prompt) on a page that 302-redirects to `http://<host>:<port>/auth/callback?code=...`, the way Codex (`http://localhost:1455/auth/callback`) and Grok (`http://127.0.0.1:56121/callback`) redirect.

| Runtime | Redirect | Result |
|---|---|---|
| iOS 27.0 | `http://localhost:1455/auth/callback?code=...` | listener got the request in about 3 s, path and `code` intact; the connection arrived from `::1` (IPv6), so a port-only listener (dual-stack) is required, not an IPv4-only bind |
| iOS 26.5 | `http://127.0.0.1:56121/auth/callback?code=...` | listener got the request, from `127.0.0.1` |

The session's own completion handler never fires (its callback scheme never matches an http redirect). The app must read the code from the listener, answer with a small "Signed in, return to Flint" page, and call `session.cancel()`.

**Go for option (1) in DESIGN-NOTES section 10, with two caveats that stay open:** (a) this is the simulator, which shares the Mac's network stack. On a real iPhone the sheet's Safari process and the app both use the device's loopback, which should behave the same, but only a device run (gate O5) proves it. (b) Using another vendor's CLI client id in an App Store app remains a terms and App Review risk; fine for personal TestFlight. Owner decision O6 already puts AI out of v1, so nothing ships from this; the spike only unblocks Wave 6 / track 4F.
