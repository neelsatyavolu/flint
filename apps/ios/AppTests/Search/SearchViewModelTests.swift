@testable import Flint
import FlintModel
import FlintService
import Testing

@MainActor
@Suite("Search view model")
struct SearchViewModelTests {
    private func item(_ id: Int, subject: String = "S") -> ThreadListItem {
        ThreadListItem(
            id: id, accountId: "a", subject: subject, snippet: "", participants: [], lastDate: 0,
            messageCount: 1, unreadCount: 0)
    }

    private func viewModel(
        pages: [String?: ThreadPage], server: ServerSearchResult = ServerSearchResult(found: 0, added: 0), text: String = ""
    ) -> SearchViewModel {
        let backend = SearchBackend(
            search: { _, cursor in pages[cursor] ?? ThreadPage(items: []) },
            searchServer: { _ in server },
            contacts: { _ in [Contact(email: "daniel@x.example", name: "Daniel", score: 1)] })
        return SearchViewModel(backend: backend, text: text, debounce: .milliseconds(1))
    }

    @Test("an empty query stays idle with nothing loaded")
    func emptyQuery() async {
        let vm = viewModel(pages: [nil: ThreadPage(items: [item(1)])], text: "  ")
        await vm.refresh()
        #expect(vm.phase == .idle)
        #expect(vm.results.isEmpty)
        #expect(vm.isEmptyQuery)
    }

    @Test("a query fills the results and reports no matches when empty")
    func results() async {
        let vm = viewModel(pages: [nil: ThreadPage(items: [item(1), item(2)])], text: "budget")
        await vm.refresh()
        #expect(vm.phase == .results)
        #expect(vm.results.count == 2)
        #expect(!vm.showsNoResults)

        let none = viewModel(pages: [:], text: "zzz")
        await none.refresh()
        #expect(none.showsNoResults)
    }

    @Test("load more appends the next page without duplicates")
    func loadMore() async {
        let vm = viewModel(
            pages: [nil: ThreadPage(items: [item(1), item(2)], nextCursor: "c1"), "c1": ThreadPage(items: [item(2), item(3)])],
            text: "x")
        await vm.refresh()
        await vm.loadMore()
        #expect(vm.results.map(\.id) == [1, 2, 3])
        #expect(vm.nextCursor == nil)
    }

    @Test("contacts load for a name or from: word")
    func contacts() async {
        let vm = viewModel(pages: [:], text: "from:dan")
        await vm.refresh()
        #expect(vm.suggestions.contains { $0.kind == .person && $0.replacement == "from:daniel@x.example " })
    }

    @Test("server search reports what it added and repeats the local search")
    func serverSearch() async {
        let vm = viewModel(pages: [nil: ThreadPage(items: [item(1)])], server: ServerSearchResult(found: 3, added: 2), text: "old")
        await vm.refresh()
        await vm.searchServer()
        #expect(vm.serverState == .done(found: 3, added: 2))
        #expect(vm.results.count == 1)
    }

    @Test("server search failure is kept for the banner")
    func serverFailure() async {
        let backend = SearchBackend(
            search: { _, _ in ThreadPage(items: []) },
            searchServer: { _ in throw FlintError(.internal, "offline") },
            contacts: { _ in [] })
        let vm = SearchViewModel(backend: backend, text: "old", debounce: .milliseconds(1))
        await vm.refresh()
        await vm.searchServer()
        #expect(vm.serverState == .failed)
        #expect(vm.error != nil)
    }

    @Test("clearing the text resets everything")
    func reset() async {
        let vm = viewModel(pages: [nil: ThreadPage(items: [item(1)])], text: "a")
        await vm.refresh()
        vm.text = ""
        await vm.refresh()
        #expect(vm.phase == .idle)
        #expect(vm.results.isEmpty)
    }
}

@MainActor
@Suite("Search against the demo mailbox")
struct SearchDemoTests {
    @Test("operators and plain words find seeded conversations")
    func demoSearch() async throws {
        let app = try await SeededApp.make()
        let vm = SearchViewModel(backend: SearchBackend(model: app.model), text: "roadmap", debounce: .milliseconds(1))
        await vm.refresh()
        #expect(vm.results.contains { $0.subject == "Q4 roadmap notes" })

        vm.text = "is:unread from:daniel"
        await vm.refresh()
        #expect(!vm.results.isEmpty)
        #expect(vm.results.allSatisfy { $0.unreadCount > 0 })

        vm.text = "has:attachment"
        await vm.refresh()
        #expect(!vm.results.isEmpty)
        #expect(vm.results.allSatisfy { $0.hasAttachments })

        vm.text = "da"
        await vm.refresh()
        #expect(vm.suggestions.contains { $0.kind == .person })

        app.model.recordSearch("roadmap")
        #expect(app.model.recentSearches.first == "roadmap")
        await app.tearDown()
    }
}
