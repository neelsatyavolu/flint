import FlintModel
import FlintService
import Foundation
import Observation

/// What the search screen needs from the app, as closures so tests can stand in for the mail service.
struct SearchBackend: Sendable {
    var search: @Sendable (_ text: String, _ cursor: String?) async throws -> ThreadPage
    var searchServer: @Sendable (_ text: String) async throws -> ServerSearchResult
    var contacts: @Sendable (_ prefix: String) async throws -> [Contact]
}

extension SearchBackend {
    @MainActor
    init(model: AppModel) {
        self.init(
            search: { text, cursor in try await model.search(text, cursor: cursor) },
            searchServer: { text in try await model.searchServer(text) },
            contacts: { prefix in try await model.suggestContacts(prefix: prefix, limit: 5) })
    }
}

enum ServerSearchState: Equatable, Sendable {
    case idle
    case running
    case done(found: Int, added: Int)
    case failed
}

@MainActor @Observable
final class SearchViewModel {
    enum Phase: Equatable { case idle, searching, results }

    var text: String
    private(set) var phase: Phase = .idle
    private(set) var results: [ThreadListItem] = []
    private(set) var nextCursor: String?
    private(set) var contacts: [Contact] = []
    private(set) var serverState: ServerSearchState = .idle
    private(set) var error: (any Error)?
    private(set) var isLoadingMore = false

    private let backend: SearchBackend
    private let debounce: Duration

    init(backend: SearchBackend, text: String = "", debounce: Duration = .milliseconds(200)) {
        self.backend = backend
        self.text = text
        self.debounce = debounce
    }

    var suggestions: [SearchSuggestion] { SearchSuggestions.make(for: text, contacts: contacts) }
    var isEmptyQuery: Bool { !SearchText.isSearchable(text) }
    var showsNoResults: Bool { phase == .results && results.isEmpty && error == nil }

    /// Runs after each edit. The wait makes a burst of typing one search; a newer edit cancels this task.
    func refresh() async {
        guard SearchText.isSearchable(text) else { reset(); return }
        try? await Task.sleep(for: debounce)
        guard !Task.isCancelled else { return }
        let query = trimmed
        phase = .searching
        serverState = .idle
        async let found = loadContacts()
        await runSearch(query)
        let people = await found
        guard !Task.isCancelled, query == trimmed else { return }
        contacts = people
    }

    /// The next page of the same query, asked for when the last row appears.
    func loadMore() async {
        guard let cursor = nextCursor, !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        let query = trimmed
        do {
            let page = try await backend.search(query, cursor)
            guard query == trimmed else { return }
            results = results + page.items.filter { item in !results.contains { $0.id == item.id } }
            nextCursor = page.nextCursor
        } catch { self.error = error }
    }

    /// Asks the mail servers for older mail, then repeats the local search so new matches show up.
    func searchServer() async {
        guard SearchText.isSearchable(text), serverState != .running else { return }
        serverState = .running
        let query = trimmed
        do {
            let result = try await backend.searchServer(query)
            serverState = .done(found: result.found, added: result.added)
            if result.added > 0, query == trimmed { await runSearch(query) }
        } catch {
            serverState = .failed
            self.error = error
        }
    }

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    private func reset() {
        phase = .idle
        results = []
        nextCursor = nil
        contacts = []
        error = nil
        serverState = .idle
    }

    private func runSearch(_ query: String) async {
        do {
            let page = try await backend.search(query, nil)
            guard !Task.isCancelled, query == trimmed else { return }
            results = page.items
            nextCursor = page.nextCursor
            error = nil
            phase = .results
        } catch {
            guard !Task.isCancelled else { return }
            self.error = error
            phase = .results
        }
    }

    private func loadContacts() async -> [Contact] {
        guard let lookup = SearchSuggestions.contactLookup(for: text) else { return [] }
        return (try? await backend.contacts(lookup.prefix)) ?? []
    }
}
