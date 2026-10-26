import FlintModel
import SwiftUI
import UIKit

/// The conversation list: bundles, then rows grouped under date labels, with swipe actions, a context menu, pull to refresh and
/// paging. A `List` because swipe actions only exist there; every default look is switched off.
struct InboxList: View {
    let viewModel: InboxViewModel
    var onTriage: (BundleTriage.Kind, InboxBundle) -> Void = { _, _ in }
    @Environment(AppModel.self) private var model

    private var compact: Bool { viewModel.settings.appearance.density == .compact }

    var body: some View {
        List {
            ForEach(viewModel.visibleBundles, id: \.category) { bundle in
                InboxBundleRow(bundle: bundle, compact: compact) { viewModel.open(bundle) }
                    .plainRow()
                    .swipeActions(edge: .leading, allowsFullSwipe: true) {
                        if bundle.unreadCount > 0 { bundleButton(.read, bundle) }
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: true) { bundleButton(.archive, bundle) }
            }
            ForEach(viewModel.sections) { section in
                Section {
                    ForEach(section.items) { item in row(item) }
                } header: {
                    InboxSectionHeader(label: section.label).plainRow()
                }
                .listSectionSeparator(.hidden)
            }
            InboxFooter(
                hasMore: viewModel.hasMore, olderOnServer: viewModel.olderOnServer, loadingOlder: viewModel.loadingOlder,
                failed: viewModel.loadFailed, loadMore: { Task { await viewModel.loadMore() } },
                loadOlder: { Task { await viewModel.loadOlder() } })
                .plainRow()
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .environment(\.defaultMinListRowHeight, 1)
        .environment(\.defaultMinListHeaderHeight, 1)
        .background(FlintColor.plane1)
        .refreshable { await viewModel.refresh() }
        .accessibilityIdentifier("inbox.list")
    }

    // MARK: Rows

    private func row(_ item: ThreadListItem) -> some View {
        InboxRow(
            item: item, settings: viewModel.settings, accountColor: viewModel.accountColor(for: item),
            isSelecting: viewModel.isSelecting, isSelected: viewModel.selection.contains(item.id), isOpen: model.openThread == item.id,
            onOpen: { Task { await viewModel.open(item) } }, onToggle: { viewModel.toggleSelection(item.id) },
            onCopyCode: copy
        )
        .plainRow()
        .swipeActions(edge: .leading, allowsFullSwipe: true) { swipes(viewModel.swipe.leading, item) }
        .swipeActions(edge: .trailing, allowsFullSwipe: true) { swipes(viewModel.swipe.trailing, item) }
        .contextMenu { menu(item) }
    }

    @ViewBuilder private func swipes(_ actions: [SwipeAction], _ item: ThreadListItem) -> some View {
        if !viewModel.isSelecting {
            ForEach(viewModel.ops(actions, for: item), id: \.self) { op in
                Button(role: op.isDestructive ? .destructive : nil) {
                    Task { await viewModel.perform(op, on: [item]) }
                } label: {
                    Label { Text(op.title) } icon: { Image(op.icon.rawValue).renderingMode(.template) }
                }
                .tint(op.tint)
                .accessibilityIdentifier("inbox.swipe.\(op.identifier)")
            }
        }
    }

    @ViewBuilder private func menu(_ item: ThreadListItem) -> some View {
        Button { viewModel.toggleSelection(item.id) } label: { Label(String(localized: "Select", table: "Inbox"), systemImage: "checkmark.circle") }
        ForEach(viewModel.ops(SwipeAction.allCases, for: item), id: \.self) { op in
            Button(role: op.isDestructive ? .destructive : nil) { Task { await viewModel.perform(op, on: [item]) } } label: { Text(op.title) }
        }
    }

    private func bundleButton(_ kind: BundleTriage.Kind, _ bundle: InboxBundle) -> some View {
        let isRead = kind == .read
        return Button { onTriage(kind, bundle) } label: {
            Label {
                Text(isRead ? String(localized: "Read all", table: "Inbox") : String(localized: "Archive all", table: "Inbox"))
            } icon: {
                Image((isRead ? FlintIcon.mailOpen : FlintIcon.archive).rawValue).renderingMode(.template)
            }
        }
        .tint(FlintColor.accent)
        .accessibilityIdentifier("inbox.bundle.\(isRead ? "read" : "archive").\(bundle.category.rawValue)")
    }

    /// Copies a verification code for a minute, to this device only.
    private func copy(_ code: String) {
        UIPasteboard.general.setItems(
            [[UIPasteboard.typeAutomatic: code]], options: [.expirationDate: Date().addingTimeInterval(60), .localOnly: true])
        model.toasts.show(String(localized: "Code copied", table: "Inbox"))
    }
}

private extension InboxOp {
    var tint: Color {
        switch self {
        case .trash, .deleteDraft: FlintColor.danger
        case .snooze, .unsnooze: FlintColor.warn
        case .pin, .move: FlintColor.fg4
        case .archive, .moveToInbox, .read: FlintColor.accent
        }
    }
}

extension View {
    /// A list row with no insets, separator or system background, so the row draws itself.
    func plainRow() -> some View {
        listRowInsets(EdgeInsets())
            .listRowSeparator(.hidden)
            .listRowBackground(FlintColor.plane1)
    }
}
