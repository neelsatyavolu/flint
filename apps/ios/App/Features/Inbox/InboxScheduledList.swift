import FlintModel
import SwiftUI

/// The Scheduled list: sends waiting for their undo window or a chosen time. These are not threads, so no swipes or selection.
struct InboxScheduledList: View {
    let sends: [ScheduledSend]
    @State private var selected: ScheduledSend?

    var body: some View {
        if sends.isEmpty {
            FlintEmptyState(
                icon: .send, title: String(localized: "Nothing scheduled", table: "Inbox"),
                message: String(localized: "Messages you send later wait here until their time.", table: "Inbox"), identifier: "inbox.empty")
        } else {
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(sends) { send in
                        Button { selected = send } label: { row(send) }
                            .buttonStyle(FlintPressStyle(radius: 0))
                            .accessibilityIdentifier("inbox.scheduled.\(send.id)")
                    }
                }
            }
            .sheet(item: $selected) { ScheduledSendSheet(send: $0) }
            .accessibilityIdentifier("inbox.list")
        }
    }

    private func row(_ send: ScheduledSend) -> some View {
        let who = FlintFormat.participants(send.to)
        let time = SnoozePresets().formatTime(Date(timeIntervalSince1970: Double(send.sendAt) / 1000), now: Date())
        return HStack(alignment: .top, spacing: FlintMetrics.Space.s3) {
            FlintAvatar(address: send.to.first?.address ?? "", name: send.to.first?.name ?? "", size: .s32)
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: FlintMetrics.Space.s2) {
                    Text(who.isEmpty ? String(localized: "(no recipient)", table: "Inbox") : who).flintText(.bodyMedium).lineLimit(1)
                    Spacer(minLength: FlintMetrics.Space.s2)
                    FlintIconView(icon: .clock, size: 12, color: FlintColor.fg3)
                    Text(time).flintText(.data, color: FlintColor.fg3).lineLimit(1)
                }
                Text(send.subject.isEmpty ? String(localized: "(no subject)", table: "Inbox") : send.subject)
                    .flintText(.body, color: FlintColor.fg2).lineLimit(1)
                if let error = send.error, !error.isEmpty {
                    Text("Couldn't send. It will try again.", tableName: "Inbox").flintText(.body, color: FlintColor.danger).lineLimit(1)
                }
            }
        }
        .padding(.vertical, FlintMetrics.Space.s3)
        .padding(.horizontal, FlintMetrics.Space.s4)
        .frame(maxWidth: .infinity, minHeight: FlintMetrics.Size.rowComfortable, alignment: .topLeading)
        .overlay(alignment: .bottom) { FlintHairline() }
        .accessibilityElement(children: .combine)
    }
}
