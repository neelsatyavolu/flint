import FlintModel
import Foundation

/// Plain empty-list copy per list, ported from `emptyCopy` in the desktop `viewMeta.ts`.
enum InboxEmptyCopy {
    struct Copy: Equatable {
        let icon: FlintIcon
        let title: String
        var message: String?
    }

    static func copy(for mailbox: MailboxSelection, category: MailCategory?, filter: InboxFilter) -> Copy {
        if filter != .all { return Copy(icon: .inbox, title: filter.emptyTitle) }
        if let category {
            let name = ThreadAction.title(of: category).lowercased()
            return Copy(icon: category == .notifications ? .bell : .newspaper, title: String(localized: "No \(name).", table: "Inbox"))
        }
        switch mailbox {
        case .inbox:
            return Copy(icon: .inbox, title: String(localized: "Inbox zero.", table: "Inbox"), message: String(localized: "Nothing waiting for you.", table: "Inbox"))
        case .pinned:
            return Copy(icon: .pin, title: String(localized: "Nothing pinned.", table: "Inbox"), message: String(localized: "Swipe a conversation to keep it here.", table: "Inbox"))
        case .drafts: return Copy(icon: .fileText, title: String(localized: "No drafts.", table: "Inbox"))
        case .scheduled: return Copy(icon: .send, title: String(localized: "Nothing scheduled", table: "Inbox"))
        case .snoozed:
            return Copy(icon: .clock, title: String(localized: "Nothing snoozed.", table: "Inbox"), message: String(localized: "Swipe a conversation to bring it back later.", table: "Inbox"))
        case .sent: return Copy(icon: .send, title: String(localized: "Nothing sent yet.", table: "Inbox"))
        case .archive: return Copy(icon: .archive, title: String(localized: "Nothing archived.", table: "Inbox"))
        case .trash: return Copy(icon: .trash, title: String(localized: "Trash is empty.", table: "Inbox"))
        case .spam: return Copy(icon: .shield, title: String(localized: "No spam.", table: "Inbox"))
        case .folder: return Copy(icon: .folder, title: String(localized: "This folder is empty.", table: "Inbox"))
        }
    }
}
