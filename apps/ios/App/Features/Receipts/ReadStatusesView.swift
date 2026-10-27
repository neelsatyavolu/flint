import FlintModel
import SwiftUI

/// Read statuses: every tracked message you sent, with who opened or replied. Presented as a sheet over the thread; pull to
/// refresh polls the receipts service.
struct ReadStatusesView: View {
    @State private var vm: ReadStatusesModel
    @State private var showsHelp = false
    let onClose: () -> Void
    let onOpenThread: (ThreadID) -> Void

    init(source: any ReceiptsSource, onClose: @escaping () -> Void, onOpenThread: @escaping (ThreadID) -> Void) {
        _vm = State(initialValue: ReadStatusesModel(source: source))
        self.onClose = onClose
        self.onOpenThread = onOpenThread
    }

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(title: String(localized: "Read statuses", table: "Receipts"), identifier: "receipts", onClose: onClose) {
                FlintIconButton(icon: .refresh, label: String(localized: "Refresh", table: "Receipts"), identifier: "receipts.refresh") {
                    Task { await vm.refresh() }
                }
            }
            ReceiptFilterBar(selection: vm.filter) { next in Task { await vm.select(next) } }
            FlintHairline()
            if let notice = vm.notice { ErrorBanner(message: notice, identifier: "receipts.notice") }
            content
        }
        .background(FlintColor.plane1)
        .task { await vm.onAppear() }
        .task { await vm.watch() }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("receipts.root")
    }

    @ViewBuilder private var content: some View {
        switch vm.phase {
        case .loading:
            SkeletonRows(count: 4).frame(maxHeight: .infinity, alignment: .top)
        case .failed(let message):
            FlintEmptyState(
                icon: .alert, title: String(localized: "Couldn't load read statuses.", table: "Receipts"), message: message,
                actionTitle: String(localized: "Try again", table: "Receipts"), identifier: "receipts.failed") { Task { await vm.load() } }
        case .loaded:
            list
        }
    }

    private var list: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                if vm.items.isEmpty {
                    emptyState
                } else {
                    ForEach(vm.items, id: \.trackedId) { item in
                        TrackedRow(item: item, vm: vm, onOpenThread: onOpenThread)
                        FlintHairline()
                    }
                }
                help
            }
        }
        .refreshable { await vm.refresh() }
        .accessibilityIdentifier("receipts.list")
    }

    @ViewBuilder private var emptyState: some View {
        switch vm.filter {
        case .all:
            FlintEmptyState(
                icon: .eye, title: String(localized: "No tracked mail yet.", table: "Receipts"),
                message: String(localized: "Turn on the eye in the composer to see who opens your mail.", table: "Receipts"), identifier: "receipts.empty")
                .frame(minHeight: 240)
        case .opened:
            FlintEmptyState(icon: .eye, title: String(localized: "Nothing opened yet.", table: "Receipts"), identifier: "receipts.empty").frame(minHeight: 240)
        case .unopened:
            FlintEmptyState(icon: .check, title: String(localized: "Everything has been opened.", table: "Receipts"), identifier: "receipts.empty").frame(minHeight: 240)
        }
    }

    private var help: some View {
        VStack(alignment: .leading, spacing: FlintMetrics.Space.s3) {
            Button { showsHelp.toggle() } label: {
                HStack(spacing: FlintMetrics.Space.s2) {
                    FlintIconView(icon: showsHelp ? .chevronDown : .chevronRight, size: 12, color: FlintColor.fg2)
                    Text("How read receipts work", tableName: "Receipts").flintText(.bodyMedium)
                    Spacer(minLength: 0)
                }
                .frame(minHeight: FlintMetrics.Size.touch)
                .contentShape(Rectangle())
            }
            .buttonStyle(FlintPressStyle())
            .accessibilityValue(showsHelp ? String(localized: "Expanded", table: "Receipts") : String(localized: "Collapsed", table: "Receipts"))
            .accessibilityIdentifier("receipts.howItWorks")
            if showsHelp { ReceiptsHowItWorks() }
        }
        .padding(FlintMetrics.Space.s4)
    }
}

/// All, Opened, Not opened: three flat buttons with a 4 px radius, the chosen one filled.
struct ReceiptFilterBar: View {
    let selection: ReadStatusFilter
    let onSelect: (ReadStatusFilter) -> Void

    var body: some View {
        HStack(spacing: FlintMetrics.Space.s2) {
            ForEach(ReadStatusFilter.allCases, id: \.self) { filter in
                Button { onSelect(filter) } label: {
                    Text(title(filter))
                        .flintText(.bodyMedium, color: filter == selection ? FlintColor.accentFg : FlintColor.fg)
                        .padding(.horizontal, FlintMetrics.Space.s3)
                        .frame(minHeight: FlintMetrics.Size.touch - 8)
                        .background(filter == selection ? FlintColor.accent : .clear, in: RoundedRectangle(cornerRadius: FlintMetrics.Radius.control))
                        .overlay(RoundedRectangle(cornerRadius: FlintMetrics.Radius.control).stroke(filter == selection ? .clear : FlintColor.lineStrong, lineWidth: 1))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(filter == selection ? .isSelected : [])
                .accessibilityIdentifier("receipts.filter.\(filter.rawValue)")
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, FlintMetrics.Space.s4)
        .padding(.vertical, FlintMetrics.Space.s2)
    }

    private func title(_ filter: ReadStatusFilter) -> String {
        switch filter {
        case .all: String(localized: "All", table: "Receipts")
        case .opened: String(localized: "Opened", table: "Receipts")
        case .unopened: String(localized: "Not opened", table: "Receipts")
        }
    }
}

/// One tracked message: subject, the check, the time, each recipient, and a timeline behind a disclosure.
private struct TrackedRow: View {
    let item: TrackedMessage
    let vm: ReadStatusesModel
    let onOpenThread: (ThreadID) -> Void

    var body: some View {
        let open = vm.expanded.contains(item.trackedId)
        let detail = vm.details[item.trackedId]
        VStack(alignment: .leading, spacing: FlintMetrics.Space.s2) {
            head
            ForEach(item.recipients, id: \.email) { recipient in
                RecipientStatusRow(recipient: recipient, detail: detail, identifier: "receipts.recipient.\(item.trackedId).\(recipient.email)")
            }
            Button { Task { await vm.toggle(item.trackedId) } } label: {
                HStack(spacing: FlintMetrics.Space.s1) {
                    FlintIconView(icon: open ? .chevronDown : .chevronRight, size: 12, color: FlintColor.fg2)
                    Text("Timeline", tableName: "Receipts").flintText(.data)
                }
                .frame(minHeight: FlintMetrics.Size.touch, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(FlintPressStyle())
            .accessibilityValue(open ? String(localized: "Expanded", table: "Receipts") : String(localized: "Collapsed", table: "Receipts"))
            .accessibilityIdentifier("receipts.timelineToggle.\(item.trackedId)")
            if open {
                ReceiptTimelineView(events: detail?.events ?? [], identifier: "receipts.timeline.\(item.trackedId)")
            }
        }
        .padding(.horizontal, FlintMetrics.Space.s4)
        .padding(.vertical, FlintMetrics.Space.s3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("receipts.row.\(item.trackedId)")
    }

    private var head: some View {
        HStack(alignment: .firstTextBaseline, spacing: FlintMetrics.Space.s3) {
            Button {
                if let id = item.threadId { onOpenThread(id) }
            } label: {
                Text(item.subject.isEmpty ? String(localized: "(no subject)", table: "Receipts") : item.subject)
                    .flintText(.bodyStrong).lineLimit(2).multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, minHeight: FlintMetrics.Size.touch - 8, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(FlintPressStyle())
            .disabled(item.threadId == nil)
            .accessibilityHint(String(localized: "Opens the conversation", table: "Receipts"))
            .accessibilityIdentifier("receipts.open.\(item.trackedId)")
            ReceiptMarkerView(marker: ReceiptStatusText.marker(item.summary), identifier: "receipts.marker.\(item.trackedId)")
            Text(FlintTime.current.listTime(item.sentAt)).flintText(.data, color: FlintColor.fg2)
        }
    }
}
