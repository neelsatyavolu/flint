# S4: bundle id check

**Status: go. Use `co.xanom.flint`.**

Run on 2026-10-25 with `apps/ios/Spikes/s4-bundleid/check.sh` (App Store Connect API, team VTQW687WBQ, read-only):

```
co.xanom.flint HTTP 200 not registered
co.xanom.flint.ios HTTP 200 not registered
```

Neither id is registered as an App ID on the team. The Mac app ships with Developer ID signing, which needs no registered App ID, so nothing claims `co.xanom.flint` yet. Wave 5 registers it (platform universal, so a future Mac App Store build could share it) when it creates the App Store Connect app record. The Google iOS client from gate O2 is already bound to `co.xanom.flint`.

The first run sent an empty `filter[platform]=` parameter and got HTTP 400; the script now filters by identifier only.
