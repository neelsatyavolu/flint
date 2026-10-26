import FlintModel
import SwiftUI

/// PLACEHOLDER (track 3F replaces this file). A search field that queries the local index through `AppModel.search` and lists
/// matching conversations; recents show while the field is empty.
struct SearchRoot: View {
    @Environment(AppModel.self) private var model
    @State private var text = ""
    @State private var results: [ThreadListItem] = []
    @State private var error: (any Error)?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(title: String(localized: "Search", table: "Search"), identifier: "search") { model.navigate(to: .dismiss) }
            TextField(String(localized: "Search mail", table: "Search"), text: $text)
                .flintText(.body)
                .focused($focused)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(.horizontal, FlintMetrics.Space.s3)
                .frame(minHeight: FlintMetrics.Size.touch)
                .overlay(RoundedRectangle(cornerRadius: FlintMetrics.Radius.control).stroke(FlintColor.lineStrong, lineWidth: 1))
                .padding(FlintMetrics.Space.s4)
                .accessibilityIdentifier("search.field")
            if let error { ErrorBanner(error: error, identifier: "search.error") }
            ScrollView {
                LazyVStack(spacing: 0) {
                    if text.isEmpty {
                        ForEach(model.recentSearches, id: \.self) { recent in
                            Button(recent) { text = recent }
                                .buttonStyle(.plain)
                                .flintText(.body)
                                .frame(maxWidth: .infinity, minHeight: FlintMetrics.Size.touch, alignment: .leading)
                                .padding(.horizontal, FlintMetrics.Space.s4)
                        }
                    }
                    ForEach(results) { item in
                        Button {
                            model.recordSearch(text)
                            model.navigate(to: .thread(item.id))
                        } label: {
                            FlintRow(
                                senderName: FlintFormat.participants(item.participants), senderAddress: item.participants.first?.address ?? "",
                                subject: item.subject, preview: item.snippet, time: FlintTime.current.listTime(item.lastDate))
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("search.result.\(item.id)")
                    }
                }
            }
        }
        .background(FlintColor.plane1)
        .task { focused = true }
        .task(id: text) { await run() }
        .accessibilityIdentifier("search.root")
    }

    private func run() async {
        let query = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { results = []; return }
        try? await Task.sleep(for: .milliseconds(200))
        guard !Task.isCancelled else { return }
        do { results = try await model.search(query).items; error = nil } catch { self.error = error }
    }
}
