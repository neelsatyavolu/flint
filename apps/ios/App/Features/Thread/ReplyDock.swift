import FlintModel
import SwiftUI

/// The bar under the thread: Reply, Reply all and Forward for the message a reply should answer. One primary button.
struct ReplyDock: View {
    let target: MessageView
    let selfAddresses: [String]
    let onCompose: (ComposeMode, MessageView) -> Void

    var body: some View {
        // Large text: the titles no longer fit side by side, so the buttons keep only their icons (and their labels for VoiceOver).
        ViewThatFits(in: .horizontal) {
            buttons(titles: true)
            buttons(titles: false)
        }
        .padding(.horizontal, FlintMetrics.Space.s4)
        .padding(.vertical, FlintMetrics.Space.s3)
        .background(FlintColor.plane1.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { FlintHairline() }
    }

    private func buttons(titles: Bool) -> some View {
        let single = ThreadLogic.hasSingleRecipient(target, selfAddresses: selfAddresses)
        return HStack(spacing: FlintMetrics.Space.s2) {
            if single {
                dockButton(.reply, String(localized: "Reply", table: "Thread"), icon: .reply, primary: true, titled: titles, id: "thread.reply")
            }
            dockButton(.replyAll, String(localized: "Reply all", table: "Thread"), icon: .replyAll, primary: !single, titled: titles, id: "thread.replyAll")
            dockButton(.forward, String(localized: "Forward", table: "Thread"), icon: .forward, primary: false, titled: titles, id: "thread.forward")
        }
    }

    private func dockButton(_ mode: ComposeMode, _ title: String, icon: FlintIcon, primary: Bool, titled: Bool, id: String) -> some View {
        Button { onCompose(mode, target) } label: {
            HStack(spacing: FlintMetrics.Space.s2) {
                FlintIconView(icon: icon, size: 16, color: primary ? FlintColor.accentFg : FlintColor.fg2)
                if titled { Text(title).lineLimit(1).fixedSize() }
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(FlintButtonStyle(kind: primary ? .primary : .ghost))
        .accessibilityLabel(title)
        .accessibilityIdentifier(id)
    }
}

/// A reply that was sent and is still inside its undo window, or waits for a chosen time. Undo reopens the draft.
struct QueuedReplyCard: View {
    let reply: QueuedReply
    let onUndo: () -> Void

    var body: some View {
        HStack(spacing: FlintMetrics.Space.s3) {
            VStack(alignment: .leading, spacing: FlintMetrics.Space.s1) {
                Text(reply.isScheduled ? String(localized: "Scheduled", table: "Thread") : String(localized: "Sending", table: "Thread")).flintText(.label)
                Text(FlintFormat.participants(reply.to)).flintText(.bodyStrong).lineLimit(1)
                status
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button(reply.isScheduled ? String(localized: "Cancel send", table: "Thread") : String(localized: "Undo", table: "Thread"), action: onUndo)
                .buttonStyle(FlintButtonStyle(kind: .ghost))
                .accessibilityIdentifier("thread.queued.undo")
        }
        .padding(FlintMetrics.Space.s4)
        .background(FlintColor.plane1, in: RoundedRectangle(cornerRadius: FlintMetrics.Radius.card))
        .overlay(RoundedRectangle(cornerRadius: FlintMetrics.Radius.card).stroke(FlintColor.accent.opacity(0.6), lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("thread.queued.\(reply.id)")
    }

    @ViewBuilder private var status: some View {
        let sendAt = Date(timeIntervalSince1970: Double(reply.sendAt) / 1000)
        if reply.isScheduled {
            Text(String(localized: "For \(SnoozePresets().formatTime(sendAt, now: Date()))", table: "Thread")).flintText(.body, color: FlintColor.fg3)
        } else {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let left = max(0, Int(sendAt.timeIntervalSince(context.date).rounded(.up)))
                Text(left > 0 ? String(localized: "Sending in \(left)s", table: "Thread") : String(localized: "Sending now", table: "Thread"))
                    .flintText(.body, color: FlintColor.fg3)
            }
        }
    }
}
