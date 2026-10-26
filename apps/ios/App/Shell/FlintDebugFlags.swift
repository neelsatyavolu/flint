import Foundation

/// Debug switches read from launch arguments (`-FlintThemeGallery YES`) or defaults.
enum FlintDebugFlags {
    /// The theme gallery is the app's root in Debug builds, and in any build launched with `-FlintThemeGallery YES`.
    static func themeGallery(defaults: UserDefaults = .standard) -> Bool {
        if defaults.object(forKey: "FlintThemeGallery") != nil { return defaults.bool(forKey: "FlintThemeGallery") }
        #if DEBUG
        return true
        #else
        return false
        #endif
    }
}
