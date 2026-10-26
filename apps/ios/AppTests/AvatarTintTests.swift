@testable import Flint
import Testing

/// Expected values come from running `lib/avatar.ts` (`hashString`, `avatarHue`) in Node.
@Suite("Avatar tint")
struct AvatarTintTests {
    @Test("hash matches the desktop FNV-1a", arguments: [
        ("carla@example.com", UInt32(1_669_142_891)),
        ("kayak@mail.kayak.com", 185_663_497),
        ("jo@example.org", 3_381_829_060),
        ("josé@exämple.com", 692_000_228),
        ("a@b.co", 4_212_642_350),
    ])
    func hash(input: String, expected: UInt32) {
        #expect(AvatarTint.hash(input) == expected)
    }

    @Test("hue is stable and ignores case and padding", arguments: [
        ("carla@example.com", 150.0), ("  Carla@Example.COM ", 150.0), ("kayak@mail.kayak.com", 60.0),
        ("jo@example.org", 195.0), ("ana@example.com", 25.0), ("a@b.co", 280.0),
    ])
    func hue(address: String, expected: Double) {
        #expect(AvatarTint.hue(for: address) == expected)
    }

    @Test("initials", arguments: [
        ("Neel (Nenu)", "x@y.z", "NN"), ("Carla Ruiz", "c@x.z", "CR"), ("", "jo.park@x.z", "JP"),
        ("Kayak", "k@x.z", "K"), ("", "@x.z", "?"), ("Ana María Silva", "a@x.z", "AS"),
    ])
    func initials(name: String, address: String, expected: String) {
        #expect(AvatarTint.initials(name: name, address: address) == expected)
    }

    @Test("oklch conversion lands inside sRGB for all eight hues in both themes")
    func inGamut() {
        for dark in [true, false] {
            let lc = AvatarTint.lightnessChroma(dark: dark)
            for hue in AvatarTint.hues {
                let rgb = AvatarTint.srgb(l: lc.l, c: lc.c, hueDegrees: hue)
                #expect((0.0...1.0).contains(rgb.r) && (0.0...1.0).contains(rgb.g) && (0.0...1.0).contains(rgb.b))
            }
        }
    }

    @Test("oklch reference points")
    func reference() {
        let white = AvatarTint.srgb(l: 1, c: 0, hueDegrees: 0)
        #expect(abs(white.r - 1) < 0.001 && abs(white.g - 1) < 0.001 && abs(white.b - 1) < 0.001)
        let black = AvatarTint.srgb(l: 0, c: 0, hueDegrees: 0)
        #expect(black.r < 0.001 && black.g < 0.001 && black.b < 0.001)
        // oklch(0.628 0.2577 29.23) is sRGB red.
        let red = AvatarTint.srgb(l: 0.62796, c: 0.25768, hueDegrees: 29.23)
        #expect(abs(red.r - 1) < 0.01 && red.g < 0.02 && red.b < 0.02)
    }
}
