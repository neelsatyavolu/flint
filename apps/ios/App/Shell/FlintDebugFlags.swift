import Foundation

/// Debug switches read from launch arguments (`-FlintThemeGallery YES`) or defaults. Every reader is compiled out of Release
/// builds (`#if DEBUG`), so an App Store build ignores them whatever its preferences hold. The perf script's Release build is
/// the one exception: it adds the compile flag `FLINT_PERF` (never set in the archive) for the seed, the probe and the Face ID answer.
enum FlintDebugFlags {
    /// The theme gallery replaces the app only when launched with `-FlintThemeGallery YES`.
    static func themeGallery(defaults: UserDefaults = .standard) -> Bool {
        #if DEBUG
        defaults.bool(forKey: "FlintThemeGallery")
        #else
        false
        #endif
    }

    /// True inside the unit-test host process: the app must not open the real database or start sync for those runs.
    static var isHostingUnitTests: Bool {
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
    }

    /// `-FlintFakeAuth pass|fail|unavailable` answers the Face ID lock without the system prompt, for UI tests and screenshots.
    static func fakeAuthentication(defaults: UserDefaults = .standard) -> AuthOutcome? {
        #if DEBUG || FLINT_PERF
        switch defaults.string(forKey: "FlintFakeAuth") {
        case "pass": .success
        case "fail": .failed
        case "unavailable": .unavailable
        default: nil
        }
        #else
        nil
        #endif
    }
}

extension FlintDebugFlags {
    /// `-FlintFakeNotifications granted|denied|undetermined` swaps the system notification centre for an in-memory one, so UI
    /// tests and screenshots see each permission state without a system prompt and nothing real is ever posted.
    static func fakeNotifications(defaults: UserDefaults = .standard) -> Bool {
        #if DEBUG
        defaults.string(forKey: "FlintFakeNotifications") != nil
        #else
        false
        #endif
    }

    static func fakeNotificationStatus(defaults: UserDefaults = .standard) -> NotificationAuthorization {
        #if DEBUG
        switch defaults.string(forKey: "FlintFakeNotifications") {
        case "denied": .denied
        case "undetermined": .notDetermined
        default: .allowed
        }
        #else
        .allowed
        #endif
    }
}
