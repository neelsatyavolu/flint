import Foundation
import Testing

/// Port of `apps/desktop/src/renderer/src/styles/tokens.test.ts`, run against the iOS color catalog.
@Suite("Design tokens: contrast")
struct TokenContrastTests {
    static let planes = ["Plane0", "Plane1", "Plane2", "Plane3"]

    private func color(_ name: String, _ theme: TokenCatalog.Theme, high: Bool = false) throws -> TokenCatalog.RGBA {
        try #require(try TokenCatalog.catalogColor(name, theme: theme, highContrast: high), "\(name) \(theme) missing")
    }

    @Test("tertiary text meets WCAG AA (4.5:1) on every plane", arguments: TokenCatalog.Theme.allCases)
    func tertiaryText(theme: TokenCatalog.Theme) throws {
        for plane in Self.planes {
            for token in ["Fg", "Fg2", "Fg3"] {
                let ratio = Contrast.ratio(try color(token, theme), over: try color(plane, theme))
                #expect(ratio >= 4.5, "\(token) on \(plane) \(theme) is \(ratio)")
            }
        }
    }

    @Test("accent and focus ring reach 3:1 on every plane", arguments: TokenCatalog.Theme.allCases)
    func focusRing(theme: TokenCatalog.Theme) throws {
        for plane in Self.planes {
            for token in ["Accent", "AccentRing"] {
                let ratio = Contrast.ratio(try color(token, theme), over: try color(plane, theme))
                #expect(ratio >= 3, "\(token) on \(plane) \(theme) is \(ratio)")
            }
        }
    }

    @Test("Increase Contrast raises borders to 3:1", arguments: TokenCatalog.Theme.allCases)
    func increaseContrast(theme: TokenCatalog.Theme) throws {
        for plane in Self.planes {
            let ratio = Contrast.ratio(try color("LineStrong", theme, high: true), over: try color(plane, theme))
            #expect(ratio >= 3, "LineStrong on \(plane) \(theme) is \(ratio)")
        }
    }

    @Test("Increase Contrast keeps secondary text at least as strong", arguments: TokenCatalog.Theme.allCases)
    func secondaryTextStronger(theme: TokenCatalog.Theme) throws {
        let plane = try color("Plane2", theme)
        let normal = Contrast.ratio(try color("Fg2", theme), over: plane)
        let high = Contrast.ratio(try color("Fg2", theme, high: true), over: plane)
        #expect(high >= normal)
    }

    @Test("accent text on accent fill is readable", arguments: TokenCatalog.Theme.allCases)
    func accentFill(theme: TokenCatalog.Theme) throws {
        let ratio = Contrast.ratio(try color("AccentFg", theme), over: try color("Accent", theme))
        #expect(ratio >= 4.5, "AccentFg on Accent \(theme) is \(ratio)")
    }
}
