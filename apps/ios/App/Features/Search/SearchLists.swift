import SwiftUI

/// Small mono caption above a group of rows.
struct SearchSectionHeader<Trailing: View>: View {
    let title: String
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack {
            Text(title.uppercased()).flintText(.label, color: FlintColor.fg3)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            trailing
        }
        .padding(.horizontal, FlintMetrics.Space.s4)
        .padding(.top, FlintMetrics.Space.s4)
        .frame(minHeight: FlintMetrics.Size.touch, alignment: .bottomLeading)
    }
}

extension SearchSectionHeader where Trailing == EmptyView {
    init(title: String) { self.init(title: title, trailing: { EmptyView() }) }
}

/// One line the user can tap: an icon, a title (mono for operators) and a detail.
struct SearchLine: View {
    let icon: FlintIcon
    let title: String
    var detail = ""
    var monoTitle = false
    let identifier: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: FlintMetrics.Space.s3) {
                FlintIconView(icon: icon, size: 16, color: FlintColor.fg3)
                Text(title)
                    .flintText(monoTitle ? .data : .body)
                    .lineLimit(1)
                if !detail.isEmpty {
                    Text(detail).flintText(.body, color: FlintColor.fg3).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, FlintMetrics.Space.s4)
            .frame(maxWidth: .infinity, minHeight: FlintMetrics.Size.touch, alignment: .leading)
            .overlay(alignment: .bottom) { FlintHairline() }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(identifier)
    }
}

/// Recent searches and the operator list, shown while the field is empty.
struct SearchStart: View {
    let recents: [String]
    let onPick: (String) -> Void
    let onClear: () -> Void
    let onOperator: (SearchOperator) -> Void

    var body: some View {
        LazyVStack(spacing: 0) {
            if !recents.isEmpty {
                SearchSectionHeader(title: String(localized: "Recent", table: "Search")) {
                    Button(String(localized: "Clear", table: "Search"), action: onClear)
                        .flintText(.bodyMedium, color: FlintColor.accent)
                        .frame(minHeight: FlintMetrics.Size.touch)
                        .accessibilityIdentifier("search.recents.clear")
                }
                ForEach(recents, id: \.self) { recent in
                    SearchLine(icon: .clock, title: recent, identifier: "search.recent.\(recent)") { onPick(recent) }
                }
            }
            SearchSectionHeader(title: String(localized: "Narrow with", table: "Search"))
            ForEach(SearchOperator.all) { op in
                SearchLine(icon: .search, title: op.token, detail: op.hint, monoTitle: true, identifier: "search.operator.\(op.token)") {
                    onOperator(op)
                }
            }
        }
    }
}
