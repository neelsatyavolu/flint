import FlintModel
import SwiftUI

/// Thread rows for a query (the inbox row look), the load-more trigger and the server search footer.
struct SearchResults: View {
    @Environment(AppModel.self) private var model
    let viewModel: SearchViewModel
    let onOpen: (ThreadListItem) -> Void

    var body: some View {
        LazyVStack(spacing: 0) {
            if viewModel.showsNoResults {
                Text(String(localized: "No matches", table: "Search"))
                    .flintText(.title)
                    .padding(.top, FlintMetrics.Space.s8)
                    .accessibilityIdentifier("search.empty")
                Text(String(localized: "Try fewer words, or look on the mail servers for older mail.", table: "Search"))
                    .flintText(.body, color: FlintColor.fg3)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, FlintMetrics.Space.s6)
                    .padding(.top, FlintMetrics.Space.s2)
            } else if !viewModel.results.isEmpty {
                SearchSectionHeader(title: countText)
                    .accessibilityIdentifier("search.count")
            }
            ForEach(viewModel.results) { item in
                InboxRow(item: item, settings: model.settings ?? .default, onOpen: { onOpen(item) }, identifier: "search.result.\(item.id)")
                    .onAppear { loadMoreIfLast(item) }
            }
            if viewModel.isLoadingMore { ProgressView().padding(FlintMetrics.Space.s4) }
            if viewModel.phase == .results { SearchServerFooter(state: viewModel.serverState) { await viewModel.searchServer() } }
        }
    }

    private var countText: String {
        let count = viewModel.results.count
        return viewModel.nextCursor == nil
            ? FlintFormat.plural(count, String(localized: "result", table: "Search"), String(localized: "results", table: "Search"))
            : String(format: String(localized: "%lld results and more", table: "Search"), count)
    }

    private func loadMoreIfLast(_ item: ThreadListItem) {
        guard item.id == viewModel.results.last?.id else { return }
        Task { await viewModel.loadMore() }
    }
}

/// "Search mail servers" for mail older than what is on the device, shown once the local results end.
struct SearchServerFooter: View {
    let state: ServerSearchState
    let run: () async -> Void

    var body: some View {
        VStack(spacing: FlintMetrics.Space.s2) {
            switch state {
            case .idle, .failed:
                Button(String(localized: "Search mail servers", table: "Search")) { Task { await run() } }
                    .buttonStyle(FlintButtonStyle(kind: .ghost))
                    .accessibilityIdentifier("search.server")
                Text(String(localized: "Looks for older mail that is not on this device yet.", table: "Search"))
                    .flintText(.body, color: FlintColor.fg3)
                    .multilineTextAlignment(.center)
            case .running:
                ProgressView()
                Text(String(localized: "Searching the mail servers", table: "Search")).flintText(.body, color: FlintColor.fg3)
                    .accessibilityIdentifier("search.server.running")
            case .done(let found, let added):
                Text(summary(found: found, added: added))
                    .flintText(.body, color: FlintColor.fg3)
                    .multilineTextAlignment(.center)
                    .accessibilityIdentifier("search.server.done")
            }
        }
        .padding(FlintMetrics.Space.s6)
        .frame(maxWidth: .infinity)
    }

    private func summary(found: Int, added: Int) -> String {
        if found == 0 { return String(localized: "Nothing on the mail servers matches.", table: "Search") }
        if added == 0 { return String(localized: "The mail servers had nothing new for this search.", table: "Search") }
        return String(format: String(localized: "Added %lld older conversations from the mail servers.", table: "Search"), added)
    }
}
