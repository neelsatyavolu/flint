@testable import Flint
import Foundation
import Testing

@MainActor
@Suite("Safari view entry")
struct SafariEntryTests {
    @Test("only http and https addresses reach the Safari view", arguments: [
        ("https://list.example.com/u", true), ("HTTP://list.example.com/u", true),
        ("mailto:u@list.example.com", false), ("mailto:?subject=x", false), ("ftp://x.example/a", false),
        ("javascript:alert(1)", false), ("flint://pair#abc", false), ("tel:123", false),
    ])
    func schemeGate(raw: String, allowed: Bool) throws {
        let vm = ThreadModel()
        vm.showInBrowser(try #require(URL(string: raw)))
        #expect((vm.safariURL != nil) == allowed)
    }

    @Test("a prompted link that is not a web address is dropped")
    func promptedLink() throws {
        let vm = ThreadModel()
        vm.linkPrompt = LinkPrompt(url: try #require(URL(string: "mailto:a@b.example")), shown: "b.example")
        vm.confirmLink()
        #expect(vm.safariURL == nil)
        #expect(vm.linkPrompt == nil)
    }
}
