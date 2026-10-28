import Foundation

/// Avatar tint and initials logic, ported from `apps/desktop/src/renderer/src/lib/avatar.ts` so a sender keeps
/// the same hue on desktop and iPhone. Pure Foundation: tested in `AvatarTintTests`.
enum AvatarTint {
    static let hues: [Double] = [25, 60, 95, 150, 195, 235, 280, 330]

    /// FNV-1a 32-bit over UTF-16 code units (JavaScript `charCodeAt`), stable across runs.
    static func hash(_ input: String) -> UInt32 {
        var h: UInt32 = 0x811c_9dc5
        for unit in input.utf16 {
            h ^= UInt32(unit)
            h = h &* 0x0100_0193
        }
        return h
    }

    static func hue(for address: String) -> Double {
        let key = address.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return hues[Int(hash(key)) % hues.count]
    }

    /// First letter of the first and last word. Only letters and digits count: "Neel (Nenu)" is NN.
    static func initials(name: String, address: String) -> String {
        func split(_ value: String) -> [Substring] {
            value.split(whereSeparator: { !$0.isLetter && !$0.isNumber })
        }
        let named = split(name)
        let words = named.isEmpty ? split(String(address.split(separator: "@", omittingEmptySubsequences: false).first ?? "")) : named
        let first = words.first?.first.map(String.init) ?? "?"
        let second = words.count > 1 ? words.last?.first.map(String.init) ?? "" : ""
        return (first + second).uppercased()
    }

    /// Lightness and chroma per theme: `oklch(0.58 0.09 h)` dark, `oklch(0.68 0.08 h)` light.
    static func lightnessChroma(dark: Bool) -> (l: Double, c: Double) {
        dark ? (0.58, 0.09) : (0.68, 0.08)
    }

    /// OKLCH to gamma-encoded sRGB in 0...1, clamped.
    static func srgb(l: Double, c: Double, hueDegrees: Double) -> (r: Double, g: Double, b: Double) {
        let h = hueDegrees * .pi / 180
        let a = c * cos(h)
        let b = c * sin(h)
        let l_ = pow(l + 0.3963377774 * a + 0.2158037573 * b, 3)
        let m_ = pow(l - 0.1055613458 * a - 0.0638541728 * b, 3)
        let s_ = pow(l - 0.0894841775 * a - 1.2914855480 * b, 3)
        let lin = (
            4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
            -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
            -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_
        )
        func encode(_ v: Double) -> Double {
            let x = min(1, max(0, v))
            return x <= 0.0031308 ? 12.92 * x : 1.055 * pow(x, 1 / 2.4) - 0.055
        }
        return (encode(lin.0), encode(lin.1), encode(lin.2))
    }

    static func color(for address: String, dark: Bool) -> (r: Double, g: Double, b: Double) {
        let lc = lightnessChroma(dark: dark)
        return srgb(l: lc.l, c: lc.c, hueDegrees: hue(for: address))
    }
}
