import Foundation

/// Reads `Colors.xcassets` and `tokens.css` straight from the source tree so tests can compare them.
/// The simulator shares the Mac's file system, and `#filePath` points into the checkout.
enum TokenCatalog {
    struct RGBA: Equatable {
        var r: Double, g: Double, b: Double, a: Double
    }

    enum Theme: String, CaseIterable { case dark, light }

    static let repoRoot: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // AppTests
        .deletingLastPathComponent() // ios
        .deletingLastPathComponent() // apps
        .deletingLastPathComponent() // repo

    static let catalogRoot = repoRoot.appending(path: "apps/ios/App/Resources/Colors.xcassets")
    static let cssURL = repoRoot.appending(path: "apps/desktop/src/renderer/src/styles/tokens.css")

    /// catalog name -> css custom property
    static let cssNames: [String: String] = [
        "Plane0": "--plane-0", "Plane1": "--plane-1", "Plane2": "--plane-2", "Plane3": "--plane-3",
        "Fg": "--fg", "Fg2": "--fg-2", "Fg3": "--fg-3", "Fg4": "--fg-4",
        "Hover": "--hover", "Active": "--active", "Line": "--line", "LineStrong": "--line-strong",
        "Accent": "--accent", "AccentFg": "--accent-fg", "AccentSoft": "--accent-soft", "AccentRing": "--accent-ring",
        "Danger": "--danger", "Ok": "--ok", "Warn": "--warn",
    ]

    /// Variant of a color: theme plus whether it is the Increase Contrast entry.
    static func catalogColor(_ name: String, theme: Theme, highContrast: Bool) throws -> RGBA? {
        let data = try Data(contentsOf: catalogRoot.appending(path: "\(name).colorset/Contents.json"))
        let root = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let colors = root?["colors"] as? [[String: Any]] ?? []
        for entry in colors {
            let appearances = (entry["appearances"] as? [[String: String]]) ?? []
            let isDark = appearances.contains { $0["appearance"] == "luminosity" && $0["value"] == "dark" }
            let isHigh = appearances.contains { $0["appearance"] == "contrast" && $0["value"] == "high" }
            guard isDark == (theme == .dark), isHigh == highContrast else { continue }
            let comps = (entry["color"] as? [String: Any])?["components"] as? [String: String] ?? [:]
            guard let r = comps["red"].flatMap(Double.init), let g = comps["green"].flatMap(Double.init),
                  let b = comps["blue"].flatMap(Double.init), let a = comps["alpha"].flatMap(Double.init) else { continue }
            return RGBA(r: r * 255, g: g * 255, b: b * 255, a: a)
        }
        return nil
    }

    /// Custom properties of the first `{...}` block after `selector`, searching from `from`.
    static func cssBlock(_ selector: String, from: String.Index? = nil, in css: String) throws -> [String: String] {
        let start = from ?? css.startIndex
        guard let at = css.range(of: selector, range: start..<css.endIndex),
              let open = css.range(of: "{", range: at.upperBound..<css.endIndex),
              let close = css.range(of: "}", range: open.upperBound..<css.endIndex) else {
            throw TokenError.missingBlock(selector)
        }
        let body = String(css[open.upperBound..<close.lowerBound])
        let regex = try NSRegularExpression(pattern: #"(--[\w-]+):\s*([^;]+);"#)
        var result: [String: String] = [:]
        for m in regex.matches(in: body, range: NSRange(body.startIndex..., in: body)) {
            result[String(body[Range(m.range(at: 1), in: body)!])] = String(body[Range(m.range(at: 2), in: body)!]).trimmingCharacters(in: .whitespaces)
        }
        return result
    }

    static func parseCSS(_ value: String) throws -> RGBA {
        if value.hasPrefix("#"), value.count == 7, let n = Int(value.dropFirst(), radix: 16) {
            return RGBA(r: Double((n >> 16) & 255), g: Double((n >> 8) & 255), b: Double(n & 255), a: 1)
        }
        let regex = try NSRegularExpression(pattern: #"^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$"#)
        guard let m = regex.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) else { throw TokenError.unparsable(value) }
        func g(_ i: Int) -> Double { Double(value[Range(m.range(at: i), in: value)!])! }
        return RGBA(r: g(1), g: g(2), b: g(3), a: g(4))
    }

    enum TokenError: Error { case missingBlock(String), unparsable(String) }
}

enum Contrast {
    private static func channel(_ v: Double) -> Double {
        let s = v / 255
        return s <= 0.03928 ? s / 12.92 : pow((s + 0.055) / 1.055, 2.4)
    }

    private static func luminance(_ c: (Double, Double, Double)) -> Double {
        0.2126 * channel(c.0) + 0.7152 * channel(c.1) + 0.0722 * channel(c.2)
    }

    /// WCAG 2 contrast ratio of a possibly translucent color over an opaque plane.
    static func ratio(_ color: TokenCatalog.RGBA, over plane: TokenCatalog.RGBA) -> Double {
        let blended = (
            color.r * color.a + plane.r * (1 - color.a),
            color.g * color.a + plane.g * (1 - color.a),
            color.b * color.a + plane.b * (1 - color.a)
        )
        let a = luminance(blended), b = luminance((plane.r, plane.g, plane.b))
        return (max(a, b) + 0.05) / (min(a, b) + 0.05)
    }
}
