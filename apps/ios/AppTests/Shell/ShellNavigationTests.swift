@testable import Flint
import FlintModel
import Testing

/// Navigation rules that keep the iPad composer open and bring search back.
@Suite("Shell navigation", .serialized)
@MainActor
struct ShellNavigationTests {
    private let compose = ComposeRequest.start(.new())

    @Test("iPad: opening a thread, search or settings keeps the composer panel")
    func padKeepsComposer() {
        let model = AppModel(mode: .live)
        model.setWide(true)
        model.navigate(to: .compose(compose))
        #expect(model.composerPanelRequest == compose)

        model.navigate(to: .thread(7))
        #expect(model.openThread == 7 && model.presented == nil)
        #expect(model.composerPanelRequest == compose)

        model.navigate(to: .search("invoice"))
        #expect(model.presented == .search("invoice"))
        #expect(model.composerPanelRequest == compose)
        model.navigate(to: .dismiss)
        #expect(model.presented == nil && model.composerPanelRequest == compose)

        model.navigate(to: .settings(.root))
        #expect(model.composerPanelRequest == compose)
        model.navigate(to: .dismiss)

        model.closeComposer()
        #expect(model.composerPanelRequest == nil)
    }

    @Test("iPad: Dismiss from a sheet closes the sheet, not the composer; closing the composer leaves the sheet")
    func closeTargets() {
        let model = AppModel(mode: .live)
        model.setWide(true)
        model.navigate(to: .compose(compose))
        model.navigate(to: .search(nil))
        model.closeComposer()
        #expect(model.presented == .search(nil) && model.composerPanelRequest == nil)
    }

    @Test("iPhone: a thread closes the composer sheet as before, and there is no panel")
    func phoneUnchanged() {
        let model = AppModel(mode: .live)
        model.navigate(to: .compose(compose))
        #expect(model.composerPanelRequest == nil)
        model.navigate(to: .thread(3))
        #expect(model.presented == nil && model.openThread == 3)
        model.navigate(to: .compose(compose))
        model.closeComposer()
        #expect(model.presented == nil)
    }

    @Test("a parked composer comes back as a sheet when the window turns compact")
    func becomesCompact() {
        let model = AppModel(mode: .live)
        model.setWide(true)
        model.navigate(to: .compose(compose))
        model.navigate(to: .thread(1))
        model.setWide(false)
        #expect(model.presented == .compose(compose) && model.composerPanelRequest == nil)
    }

    @Test("opening a search result and going back returns to the results")
    func searchReturn() {
        let model = AppModel(mode: .live)
        model.navigate(to: .search(nil))
        model.openFromSearch(42, query: "invoice")
        #expect(model.openThread == 42 && model.presented == nil)
        model.navigate(to: .dismiss)
        #expect(model.openThread == nil)
        #expect(model.presented == .search("invoice"))
        // Closing the results does not bring them back again.
        model.navigate(to: .dismiss)
        model.navigate(to: .thread(5))
        model.navigate(to: .dismiss)
        #expect(model.presented == nil)
    }

    @Test("a thread opened from the list, or a new mailbox, forgets the search")
    func searchForgotten() {
        let model = AppModel(mode: .live)
        model.openFromSearch(42, query: "invoice")
        model.navigate(to: .thread(43))
        model.navigate(to: .dismiss)
        #expect(model.presented == nil)

        model.openFromSearch(42, query: "invoice")
        model.navigate(to: .mailbox(.sent))
        #expect(model.presented == nil && model.openThread == nil)
    }

    @Test("on iPad the thread stays open and Search reopens with the same query")
    func padSearchAgain() {
        let model = AppModel(mode: .live)
        model.setWide(true)
        model.openFromSearch(42, query: "invoice")
        model.navigate(to: .search(nil))
        #expect(model.presented == .search("invoice"))
    }

    @Test("single-key shortcuts are off while a sheet or the composer panel is up")
    func singleKeys() {
        let model = AppModel(mode: .live)
        #expect(model.singleKeyShortcutsActive)
        model.navigate(to: .search(nil))
        #expect(!model.singleKeyShortcutsActive)
        model.navigate(to: .dismiss)
        model.setWide(true)
        model.navigate(to: .compose(compose))
        model.navigate(to: .thread(1))
        #expect(!model.singleKeyShortcutsActive)
        model.closeComposer()
        #expect(model.singleKeyShortcutsActive)
    }
}
