@testable import Flint
import Foundation
import Testing

/// The asset catalog must equal `tokens.css` (the source of truth), including the Increase Contrast overrides.
@Suite("Design tokens: parity with tokens.css")
struct TokenParityTests {
    private func assertClose(_ got: TokenCatalog.RGBA, _ want: TokenCatalog.RGBA, _ label: String) {
        #expect(abs(got.r - want.r) < 0.6 && abs(got.g - want.g) < 0.6 && abs(got.b - want.b) < 0.6 && abs(got.a - want.a) < 0.002,
                "\(label): catalog \(got) vs css \(want)")
    }

    @Test("every color and theme matches")
    func catalogMatchesCSS() throws {
        let css = try String(contentsOf: TokenCatalog.cssURL, encoding: .utf8)
        let dark = try TokenCatalog.cssBlock(#"[data-theme="dark"]"#, in: css)
        let light = try TokenCatalog.cssBlock(#"[data-theme="light"]"#, in: css)
        for (name, prop) in TokenCatalog.cssNames {
            let d = try TokenCatalog.catalogColor(name, theme: .dark, highContrast: false)
            let l = try TokenCatalog.catalogColor(name, theme: .light, highContrast: false)
            assertClose(try #require(d), try TokenCatalog.parseCSS(try #require(dark[prop])), "\(name) dark")
            assertClose(try #require(l), try TokenCatalog.parseCSS(try #require(light[prop])), "\(name) light")
        }
    }

    @Test("Increase Contrast overrides match")
    func highContrastMatchesCSS() throws {
        let css = try String(contentsOf: TokenCatalog.cssURL, encoding: .utf8)
        let more = try #require(css.range(of: "@media (prefers-contrast: more)")).lowerBound
        let darkMore = try TokenCatalog.cssBlock(#"[data-theme="dark"]"#, from: more, in: css)
        let lightMore = try TokenCatalog.cssBlock(#"[data-theme="light"]"#, from: more, in: css)
        for (name, prop) in TokenCatalog.cssNames {
            if let want = darkMore[prop] {
                let got = try #require(try TokenCatalog.catalogColor(name, theme: .dark, highContrast: true), "\(name) dark high missing")
                assertClose(got, try TokenCatalog.parseCSS(want), "\(name) dark high")
            }
            if let want = lightMore[prop] {
                let got = try #require(try TokenCatalog.catalogColor(name, theme: .light, highContrast: true), "\(name) light high missing")
                assertClose(got, try TokenCatalog.parseCSS(want), "\(name) light high")
            }
        }
    }

    @Test("catalog name list is complete")
    func namesComplete() {
        #expect(Set(TokenCatalog.cssNames.keys) == Set(FlintColor.catalogNames))
    }
}
