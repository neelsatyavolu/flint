@testable import Flint
import Foundation
import Testing

@Suite("Deep links")
struct DeepLinkTests {
    @Test("pairing link carries the fragment")
    func pair() throws {
        let url = try #require(URL(string: "flint://pair#eyJ2IjoxfQ"))
        #expect(DeepLink.parse(url) == .pair(payload: "eyJ2IjoxfQ"))
    }

    @Test("pairing link without payload is unknown")
    func pairEmpty() throws {
        #expect(DeepLink.parse(try #require(URL(string: "flint://pair"))) == .unknown)
        #expect(DeepLink.parse(try #require(URL(string: "flint://other#abc"))) == .unknown)
    }

    @Test("Google redirect is recognised")
    func oauth() throws {
        let url = try #require(URL(string: "\(DeepLink.googleScheme):/oauth2redirect?code=abc"))
        #expect(DeepLink.parse(url) == .oauthCallback(url))
    }

    @Test("other schemes are ignored")
    func other() throws {
        #expect(DeepLink.parse(try #require(URL(string: "https://example.com"))) == .unknown)
    }

    @Test("the plist registers both schemes")
    func schemes() {
        let types = Bundle.main.infoDictionary?["CFBundleURLTypes"] as? [[String: Any]] ?? []
        let schemes = Set(types.flatMap { $0["CFBundleURLSchemes"] as? [String] ?? [] })
        #expect(schemes == [DeepLink.flintScheme, DeepLink.googleScheme])
    }

    @MainActor
    @Test("router keeps a link until it is taken")
    func router() throws {
        let router = AppRouter()
        router.handle(try #require(URL(string: "https://example.com")))
        #expect(router.pending == nil)
        router.handle(try #require(URL(string: "flint://pair#abc")))
        #expect(router.take() == .pair(payload: "abc"))
        #expect(router.take() == nil)
    }

    @Test("appearance override from launch arguments wins")
    func appearance() throws {
        let defaults = try #require(UserDefaults(suiteName: "flint.tests.appearance"))
        defer { defaults.removePersistentDomain(forName: "flint.tests.appearance") }
        #expect(FlintAppearance.resolved(stored: "dark", arguments: defaults) == .dark)
        defaults.set("light", forKey: "FlintAppearance")
        #expect(FlintAppearance.resolved(stored: "dark", arguments: defaults) == .light)
        #expect(FlintAppearance.resolved(stored: "nonsense", arguments: UserDefaults(suiteName: "flint.tests.empty")!) == .system)
    }
}
