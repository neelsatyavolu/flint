import SwiftUI

/// Named colors from `Colors.xcassets`, which mirrors `apps/desktop/src/renderer/src/styles/tokens.css`
/// (DESIGN.md section 2). Dark is Graphite, light is Paper. Views never use raw hex or system colors.
/// `TokenParityTests` fails if the catalog drifts from tokens.css.
enum FlintColor {
    static let plane0 = Color("Plane0")
    static let plane1 = Color("Plane1")
    static let plane2 = Color("Plane2")
    static let plane3 = Color("Plane3")

    static let fg = Color("Fg")
    static let fg2 = Color("Fg2")
    static let fg3 = Color("Fg3")
    static let fg4 = Color("Fg4")

    static let hover = Color("Hover")
    static let active = Color("Active")
    static let line = Color("Line")
    static let lineStrong = Color("LineStrong")

    static let accent = Color("Accent")
    static let accentFg = Color("AccentFg")
    static let accentSoft = Color("AccentSoft")
    static let accentRing = Color("AccentRing")

    static let danger = Color("Danger")
    static let ok = Color("Ok")
    static let warn = Color("Warn")

    /// Text on avatar tints (`--avatar-fg`).
    static let avatarFg = Color(red: 0xF4 / 255, green: 0xF2 / 255, blue: 0xEC / 255)

    /// Every catalog name, for tests and the gallery.
    static let catalogNames = [
        "Plane0", "Plane1", "Plane2", "Plane3", "Fg", "Fg2", "Fg3", "Fg4", "Hover", "Active", "Line",
        "LineStrong", "Accent", "AccentFg", "AccentSoft", "AccentRing", "Danger", "Ok", "Warn",
    ]
}
