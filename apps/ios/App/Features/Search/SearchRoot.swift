import FlintModel
import SwiftUI

/// The search sheet: a field, operator chips, suggestions for the word being typed, then results (or recents and the operator
/// list while the field is empty). `model.presented == .search(query)` can arrive with a query already typed.
struct SearchRoot: View {
    @Environment(AppModel.self) private var model
    @State private var viewModel: SearchViewModel?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(title: String(localized: "Search", table: "Search"), identifier: "search") { model.navigate(to: .dismiss) }
            if let viewModel {
                content(viewModel)
            } else {
                Spacer()
            }
        }
        .background(FlintColor.plane1)
        .task {
            guard viewModel == nil else { return }
            viewModel = SearchViewModel(backend: SearchBackend(model: model), text: initialQuery)
            focused = true
        }
        .accessibilityIdentifier("search.root")
    }

    private var initialQuery: String {
        if case .search(let query) = model.presented { return query ?? "" }
        return ""
    }

    private func content(_ vm: SearchViewModel) -> some View {
        @Bindable var vm = vm
        return VStack(spacing: 0) {
            SearchField(text: $vm.text, focused: $focused) { model.recordSearch(vm.text) }
                .padding(.horizontal, FlintMetrics.Space.s4)
                .padding(.top, FlintMetrics.Space.s3)
            SearchChips(text: vm.text) { vm.text = SearchText.toggling($0, in: vm.text) }
                .padding(.vertical, FlintMetrics.Space.s1)
            if let error = vm.error { ErrorBanner(error: error, identifier: "search.error") }
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(vm.suggestions) { suggestion in
                        SearchLine(
                            icon: suggestion.kind == .person ? .user : .search, title: suggestion.title, detail: suggestion.detail,
                            monoTitle: suggestion.kind != .person, identifier: "search.suggestion.\(suggestion.title)"
                        ) { vm.text = suggestion.replacement }
                    }
                    if vm.isEmptyQuery {
                        SearchStart(
                            recents: model.recentSearches, onPick: { vm.text = $0 }, onClear: { model.clearRecentSearches() },
                            onOperator: { vm.text = SearchText.appending($0, to: vm.text) })
                    } else {
                        SearchResults(viewModel: vm) { item in
                            model.recordSearch(vm.text)
                            model.navigate(to: .thread(item.id))
                        }
                    }
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .task(id: vm.text) { await vm.refresh() }
        }
    }
}
