import SwiftUI

/// Theme choice: follow the system, or force Graphite (dark) or Paper (light). The Settings screen (track 3G)
/// writes `flint.appearance`; the `-FlintAppearance dark|light` launch argument overrides it for screenshots and UI tests.
enum FlintAppearance: String, CaseIterable, Sendable {
    case system, dark, light

    static let defaultsKey = "flint.appearance"

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .dark: .dark
        case .light: .light
        }
    }

    /// Graphite and Paper are the user-facing names.
    var title: String {
        switch self {
        case .system: "System"
        case .dark: "Graphite"
        case .light: "Paper"
        }
    }

    static func resolved(stored: String, arguments: UserDefaults = .standard) -> FlintAppearance {
        #if DEBUG
        if let forced = arguments.string(forKey: "FlintAppearance"), let value = FlintAppearance(rawValue: forced) {
            return value
        }
        #endif
        return FlintAppearance(rawValue: stored) ?? .system
    }
}
