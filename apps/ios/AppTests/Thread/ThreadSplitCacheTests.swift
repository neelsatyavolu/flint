@testable import Flint
import FlintModel
import Foundation
import Testing

@MainActor
@Suite("Thread quoted-text cache")
struct ThreadSplitCacheTests {
    private func message(html: String?) -> MessageView {
        MessageView(id: 5, accountId: "acc", threadId: 1, from: [Address(address: "a@x.com")], subject: "Re: plans", date: 1000, seen: true, html: html)
    }

    @Test("the split is computed once, kept per message, and dropped when the html changes")
    func cache() async {
        let vm = ThreadModel()
        let html = "<p>Hi</p><div class=\"gmail_quote\">old</div>"
        let shown = message(html: html)
        #expect(vm.cachedSplit(for: shown) == nil)

        await vm.prepareSplit(for: shown)
        let parts = vm.cachedSplit(for: shown)
        #expect(parts?.body == "<p>Hi</p>")
        #expect(parts?.quoted?.contains("old") == true)

        // Loading images changes the html: the old split must not be shown for it.
        let loaded = message(html: html + "<p>more</p>")
        #expect(vm.cachedSplit(for: loaded) == nil)
        await vm.prepareSplit(for: loaded)
        #expect(vm.cachedSplit(for: loaded) != nil)

        vm.reset()
        #expect(vm.cachedSplit(for: shown) == nil)
    }

    @Test("a plain-text message has nothing to cache")
    func plainText() async {
        let vm = ThreadModel()
        let shown = message(html: nil)
        await vm.prepareSplit(for: shown)
        #expect(vm.cachedSplit(for: shown) == nil)
        #expect(vm.splits.isEmpty)
    }
}
