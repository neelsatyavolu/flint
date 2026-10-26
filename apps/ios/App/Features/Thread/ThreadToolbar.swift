import FlintModel
import SwiftUI

/// Thread-level actions in the bar: archive (or move to Inbox), trash, pin, and a menu with the rest.
struct ThreadToolbar: View {
    let detail: ThreadDetail
    let leavesInbox: Bool
    let inSpam: Bool
    let sender: Address?
    @Environment(AppModel.self) private var app
    @State private var picker: Picker?

    /// The sheets the bar raises for the open conversation.
    private enum Picker: String, Identifiable {
        case snooze, move
        var id: String { rawValue }
    }

    var body: some View {
        HStack(spacing: 0) {
            if inSpam {
                button(.shield, String(localized: "Not spam", table: "Thread"), "thread.notSpam") { await app.markSpam([detail.id], spam: false) }
            } else if leavesInbox {
                button(.inbox, String(localized: "Move to Inbox", table: "Thread"), "thread.moveToInbox") { await app.moveToInbox([detail.id]) }
            } else {
                button(.archive, String(localized: "Archive", table: "Thread"), "thread.archive") { await app.archive([detail.id]) }
            }
            button(.trash, String(localized: "Trash", table: "Thread"), "thread.trash") { await app.trash([detail.id]) }
            button(.pin, detail.pinned ? String(localized: "Unpin", table: "Thread") : String(localized: "Pin", table: "Thread"), "thread.pin",
                   color: detail.pinned ? FlintColor.accent : FlintColor.fg2) { await app.setPinned([detail.id], pinned: !detail.pinned) }
            button(.clock, String(localized: "Snooze", table: "Thread"), "thread.snooze") { picker = .snooze; return true }
            more
        }
        .sheet(item: $picker) { picker in
            switch picker {
            case .snooze: ThreadSnoozeSheet(threadId: detail.id)
            case .move: ThreadMoveSheet(threadId: detail.id, accountId: detail.accountId)
            }
        }
    }

    private func button(_ icon: FlintIcon, _ label: String, _ id: String, color: Color = FlintColor.fg2, run: @escaping () async -> Bool) -> some View {
        FlintIconButton(icon: icon, label: label, color: color, identifier: id) { Task { _ = await run() } }
    }

    private var more: some View {
        Menu {
            Button(String(localized: "Mark as unread", table: "Thread")) { Task { _ = await app.markRead([detail.id], read: false) } }
            Button(detail.muted ? String(localized: "Unmute", table: "Thread") : String(localized: "Mute", table: "Thread")) {
                Task { _ = await app.setMuted([detail.id], muted: !detail.muted) }
            }
            Button(String(localized: "Move to folder", table: "Thread")) { picker = .move }
            if !inSpam {
                Button(String(localized: "Mark as spam", table: "Thread")) { Task { _ = await app.markSpam([detail.id], spam: true) } }
            }
            if !leavesInbox { categoryMenu }
            if let sender, !sender.address.isEmpty {
                Divider()
                Button(String(localized: "Block sender", table: "Thread"), role: .destructive) { Task { await app.blockSender(sender.address) } }
            }
        } label: {
            FlintIconView(icon: .more, size: 18, color: FlintColor.fg2)
                .frame(width: FlintMetrics.Size.touch, height: FlintMetrics.Size.touch)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(String(localized: "More", table: "Thread"))
        .accessibilityIdentifier("thread.more")
    }

    private var categoryMenu: some View {
        Menu(String(localized: "Move to category", table: "Thread")) {
            ForEach(MailCategory.allCases.filter { $0 != detail.category }, id: \.self) { category in
                Button(ThreadAction.title(of: category)) { Task { _ = await app.setCategory([detail.id], category) } }
            }
        }
    }
}
