@testable import Flint
import Testing
import UIKit

/// The app bundle must carry what the theme needs: fonts, colors, icons.
@Suite("Theme resources")
struct ThemeResourceTests {
    @Test("every bundled font face loads", arguments: FlintFontRole.Face.allCases)
    func fonts(face: FlintFontRole.Face) {
        #expect(UIFont(name: face.rawValue, size: 14) != nil, "\(face.rawValue) not registered")
    }

    @Test("every type role resolves to a loadable face and a positive line height", arguments: FlintFontRole.allCases)
    func roles(role: FlintFontRole) {
        #expect(UIFont(name: role.face.rawValue, size: role.size) != nil)
        #expect(role.lineHeight > role.size)
    }

    @Test("every named color exists", arguments: FlintColor.catalogNames)
    func colors(name: String) {
        #expect(UIColor(named: name) != nil, "\(name) missing from Colors.xcassets")
    }

    @Test("every icon exists", arguments: FlintIcon.allCases)
    func icons(icon: FlintIcon) {
        #expect(UIImage(named: icon.rawValue) != nil, "\(icon.rawValue) missing from Icons.xcassets")
    }

    @Test("dark and light variants differ")
    func variants() throws {
        let color = try #require(UIColor(named: "Plane1"))
        var dark = CGFloat.zero, light = CGFloat.zero
        color.resolvedColor(with: UITraitCollection(userInterfaceStyle: .dark)).getWhite(&dark, alpha: nil)
        color.resolvedColor(with: UITraitCollection(userInterfaceStyle: .light)).getWhite(&light, alpha: nil)
        #expect(dark < 0.2 && light > 0.8)
    }

    @Test("Info.plist declares what the plan requires")
    func infoPlist() {
        let info = Bundle.main.infoDictionary ?? [:]
        #expect(info["ITSAppUsesNonExemptEncryption"] as? Bool == false)
        #expect(info["NSLocalNetworkUsageDescription"] is String)
        #expect(info["NSCameraUsageDescription"] is String)
        #expect(Set(info["UIBackgroundModes"] as? [String] ?? []) == ["fetch", "processing"])
        #expect((info["UIAppFonts"] as? [String])?.count == FlintFontRole.Face.allCases.count)
        #expect(Bundle.main.bundleIdentifier == "co.xanom.flint")
    }
}
