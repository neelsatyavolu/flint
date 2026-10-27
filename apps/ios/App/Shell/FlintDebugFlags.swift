import Foundation

/// Debug switches read from launch arguments (`-FlintThemeGallery YES`) or defaults.
enum FlintDebugFlags {
    /// The theme gallery replaces the app only when launched with `-FlintThemeGallery YES`.
    static func themeGallery(defaults: UserDefaults = .standard) -> Bool {
        defaults.bool(forKey: "FlintThemeGallery")
    }

    /// True inside the unit-test host process: the app must not open the real database or start sync for those runs.
    static var isHostingUnitTests: Bool {
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
    }

    /// `-FlintFakeAuth pass|fail|unavailable` answers the Face ID lock without the system prompt, for UI tests and screenshots.
    static func fakeAuthentication(defaults: UserDefaults = .standard) -> AuthOutcome? {
        switch defaults.string(forKey: "FlintFakeAuth") {
        case "pass": .success
        case "fail": .failed
        case "unavailable": .unavailable
        default: nil
        }
    }
}

extension FlintDebugFlags {
    /// `-FlintFakeNotifications granted|denied|undetermined` swaps the system notification centre for an in-memory one, so UI
    /// tests and screenshots see each permission state without a system prompt and nothing real is ever posted.
    static func fakeNotifications(defaults: UserDefaults = .standard) -> Bool {
        defaults.string(forKey: "FlintFakeNotifications") != nil
    }

    static func fakeNotificationStatus(defaults: UserDefaults = .standard) -> NotificationAuthorization {
        switch defaults.string(forKey: "FlintFakeNotifications") {
        case "denied": .denied
        case "undetermined": .notDetermined
        default: .allowed
        }
    }
}
