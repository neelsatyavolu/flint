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
}
