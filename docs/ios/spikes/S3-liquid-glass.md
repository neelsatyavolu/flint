# S3: Liquid Glass versus DESIGN.md

Run 2026-10-25. Same SwiftUI app (a `TabView` with a `NavigationStack`, toolbar and 30 rows) built three ways with the iOS 27.1 SDK (Xcode 27.1), deployment target 26.0, run on iOS 26.5 and iOS 27.0 simulators. Code: `apps/ios/Spikes/s3-glass`. Screenshots: `img/s3-ios<version>-<GlassDefault|GlassCompat>-<system|flint>.png`.

| Build | iOS 26.5 | iOS 27.0 |
|---|---|---|
| System bars, no key (`GlassDefault-system`) | Liquid Glass: floating tab bar, rounded glass "Edit" button | same |
| System bars, `UIDesignRequiresCompatibility = true` (`GlassCompat-system`) | Classic opaque bars (key works) | **Glass anyway. The key is ignored** (the built Info.plist does carry it) |
| Custom `FlintBar` and bottom bar, system bars hidden (`GlassDefault-flint`) | Flat opaque ink bars, 1 px hairline, no glass | same |

**Decision: custom opaque bars, no stopgap.** `UIDesignRequiresCompatibility` cannot be the fallback: it is dead on the iOS 27 runtime. Track 1A's `FlintBar` approach is confirmed. Rules that follow for Wave 3:
- Do not use `NavigationStack` navigation bars, `.toolbar`, or `TabView` chrome visibly. Hide the system navigation bar (`.toolbarVisibility(.hidden, for: .navigationBar)`) and draw `FlintBar`. Do not ship the compatibility key (it would only paper over 26.x and gives a split experience).
- Anything the system still draws with glass (sheets' grabbers, context menus, alerts, share sheet, keyboard accessory) is allowed; DESIGN.md's no-glass rule applies to app chrome.
- Re-run the flint screenshot on each new iOS beta; the custom bars do not depend on the system.

DESIGN-NOTES section 4: Liquid Glass conflict resolved (edited).
