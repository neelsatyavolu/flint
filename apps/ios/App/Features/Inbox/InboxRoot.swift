import FlintModel
import SwiftUI

/// The conversation list: second column on iPad, first screen on iPhone. It draws its own bar, a quick filter, the list and,
/// while rows are selected, the batch bar. State lives in `InboxViewModel`.
struct InboxRoot: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        InboxScreen(model: model)
    }
}

private struct InboxScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var viewModel: InboxViewModel
    @State private var attempt = 0
    @State private var pendingTriage: BundleTriage?

    init(model: AppModel) {
        _viewModel = State(initialValue: InboxViewModel(model: model))
    }

    var body: some View {
        VStack(spacing: 0) {
            InboxTopBar(viewModel: viewModel, columns: sizeClass == .regular)
            if showsFilter { InboxFilterBar(filter: $viewModel.filter) }
            if case .failed(let error) = viewModel.phase { ErrorBanner(error: error, identifier: "inbox.error") { attempt += 1 } }
            content
            if viewModel.isSelecting {
                InboxBatchBar(ops: InboxOp.batch(viewModel.selectedItems, in: model.mailbox), count: viewModel.selection.count) { op in
                    Task { await viewModel.perform(op, on: viewModel.selectedItems) }
                }
            }
        }
        .background(FlintColor.plane1)
        .task(id: "\(viewModel.watchKey(for: model.mailbox))|\(attempt)") { await viewModel.watch(model.mailbox) }
        .onChange(of: model.mailbox) { _, _ in resetForMailbox() }
        .onReceive(NotificationCenter.default.publisher(for: UserDefaults.didChangeNotification, object: model.defaults)) { _ in
            viewModel.refreshSwipe()
        }
        .sheet(item: $viewModel.picker) { picker in sheet(for: picker) }
        .alert(triageTitle, isPresented: triageShown, presenting: pendingTriage) { triage in
            Button(role: triage.kind == .archive ? .destructive : nil) { Task { await viewModel.run(triage) } } label: {
                Text(triage.kind == .read ? "Mark as read" : "Archive", tableName: "Inbox")
            }
            Button(role: .cancel) {} label: { Text("Cancel", tableName: "Inbox") }
        } message: { triage in
            Text(triage.kind == .read ? "\(triage.ids.count) unread conversations will be marked as read." : "\(triage.ids.count) conversations will leave your inbox.", tableName: "Inbox")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("inbox.root")
    }

    private var showsFilter: Bool {
        InboxFilter.isAvailable(for: model.mailbox) && !viewModel.isSelecting
    }

    @ViewBuilder private var content: some View {
        switch viewModel.phase {
        case .loading:
            ScrollView { SkeletonRows(density: viewModel.settings.appearance.density == .compact ? .compact : .comfortable) }
        case .failed where viewModel.items.isEmpty:
            Spacer()
        default:
            if model.mailbox == .scheduled {
                InboxScheduledList(sends: viewModel.scheduled)
            } else if viewModel.items.isEmpty && viewModel.visibleBundles.isEmpty {
                empty
            } else {
                InboxList(viewModel: viewModel) { kind, bundle in
                    Task { pendingTriage = await viewModel.triage(bundle.category, kind: kind) }
                }
            }
        }
    }

    private var empty: some View {
        let copy = InboxEmptyCopy.copy(for: model.mailbox, category: viewModel.category, filter: viewModel.filter)
        return FlintEmptyState(
            icon: copy.icon, title: copy.title, message: copy.message,
            actionTitle: viewModel.filter == .all ? nil : String(localized: "Show all", table: "Inbox"), identifier: "inbox.empty"
        ) { viewModel.filter = .all }
    }

    private func resetForMailbox() {
        viewModel.category = nil
        viewModel.filter = .all
        viewModel.endSelecting()
    }

    @ViewBuilder private func sheet(for picker: InboxPicker) -> some View {
        switch picker {
        case .snooze(let ids): InboxSnoozeSheet(ids: ids, viewModel: viewModel)
        case .move(let rows): InboxMoveSheet(rows: rows, viewModel: viewModel)
        case .swipeSettings: InboxSwipeSettingsSheet(viewModel: viewModel)
        }
    }

    private var triageShown: Binding<Bool> {
        Binding(get: { pendingTriage != nil }, set: { if !$0 { pendingTriage = nil } })
    }

    private var triageTitle: String {
        guard let pendingTriage else { return "" }
        let name = ThreadAction.title(of: pendingTriage.category)
        return pendingTriage.kind == .read
            ? String(localized: "Mark all as read in \(name)?", table: "Inbox") : String(localized: "Archive all in \(name)?", table: "Inbox")
    }
}
