import FlintModel
import SwiftUI

/// The read status under a message you sent: one line per recipient (including your own addresses, shown as untracked), the
/// event timeline, Stop tracking, and a way to the full Read statuses list.
struct ReceiptPanel: View {
    let message: MessageView
    let selfAddresses: [String]
    @Environment(AppModel.self) private var model
    @State private var showsTimeline = false
    @State private var stopped = false
    @State private var showsList = false

    var body: some View {
        // Only mail you sent has a read status; a received message addressed to you is not "untracked".
        let rows = message.isFromMe || message.receipt != nil
            ? ReceiptRows.recipients(receipt: message.receipt, to: message.to, cc: message.cc, selfAddresses: selfAddresses) : []
        if !rows.isEmpty, !stopped {
            VStack(alignment: .leading, spacing: FlintMetrics.Space.s2) {
                HStack(spacing: FlintMetrics.Space.s2) {
                    FlintIconView(icon: .eye, size: 12, color: FlintColor.fg2)
                    Text("Read status", tableName: "Receipts").flintText(.label, color: FlintColor.fg2)
                }
                ForEach(rows, id: \.email) { recipient in
                    RecipientStatusRow(recipient: recipient, detail: message.receipt, identifier: "thread.receipt.recipient.\(message.id).\(recipient.email)")
                }
                footer
                if showsTimeline, let receipt = message.receipt {
                    ReceiptTimelineView(events: receipt.events, identifier: "thread.receipt.timeline.\(message.id)")
                }
            }
            .padding(.top, FlintMetrics.Space.s3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .top) { FlintHairline() }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("thread.receipt.\(message.id)")
            .task { await pollOnShow() }
            .sheet(isPresented: $showsList) { ReadStatusesSheet() }
        }
    }

    private var footer: some View {
        HStack(spacing: FlintMetrics.Space.s4) {
            if let receipt = message.receipt, !receipt.events.isEmpty {
                link("Timeline", id: "thread.receipt.timelineToggle.\(message.id)") { showsTimeline.toggle() }
                    .accessibilityValue(showsTimeline ? String(localized: "Expanded", table: "Receipts") : String(localized: "Collapsed", table: "Receipts"))
            }
            if let receipt = message.receipt, ReceiptStatusText.summary(of: receipt).total > 0 {
                link("Stop tracking", id: "thread.receipt.stop.\(message.id)") { Task { await stop(receipt) } }
            }
            link("All read statuses", id: "thread.receipt.all.\(message.id)") { showsList = true }
        }
    }

    private func link(_ key: LocalizedStringKey, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(key, tableName: "Receipts")
                .flintText(.data, color: FlintColor.fg)
                .frame(minHeight: FlintMetrics.Size.touch)
                .contentShape(Rectangle())
        }
        .buttonStyle(FlintPressStyle())
        .accessibilityIdentifier(id)
    }

    private func stop(_ receipt: ReceiptDetail) async {
        guard let service = try? model.requireService() else { return }
        do {
            try await ServiceReceiptsSource(service: service).stopTracking(trackedId: receipt.trackedId)
            stopped = true
            model.toasts.show(String(localized: "Stopped tracking this message", table: "Receipts"))
        } catch {
            model.toasts.show(String(localized: "Couldn't stop tracking. Try again.", table: "Receipts"), kind: .error)
        }
    }

    /// Opening a sent message is a foreground moment: ask for new events (throttled), the thread refreshes from the store.
    private func pollOnShow() async {
        guard message.receipt != nil, let service = try? model.requireService() else { return }
        await ReceiptsPoller.shared.pollIfDue(ServiceReceiptsSource(service: service))
    }
}

/// Read statuses as a sheet: builds its source from the running service.
struct ReadStatusesSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Group {
            if let service = try? model.requireService() {
                ReadStatusesView(source: ServiceReceiptsSource(service: service), onClose: { dismiss() }, onOpenThread: openThread)
            } else {
                FlintEmptyState(icon: .alert, title: String(localized: "Couldn't load read statuses.", table: "Receipts"), identifier: "receipts.unavailable")
            }
        }
        .presentationBackground(FlintColor.plane1)
    }

    private func openThread(_ id: ThreadID) {
        dismiss()
        model.navigate(to: .thread(id))
    }
}
