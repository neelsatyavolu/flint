import FlintModel
import Foundation

/// The quick filter above the list: everything, unread only, or conversations with attachments.
enum InboxFilter: String, CaseIterable, Sendable, Identifiable {
    case all, unread, attachments

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: String(localized: "All", table: "Inbox")
        case .unread: String(localized: "Unread", table: "Inbox")
        case .attachments: String(localized: "Attachments", table: "Inbox")
        }
    }

    /// Empty-list copy while the filter is on.
    var emptyTitle: String {
        switch self {
        case .all: String(localized: "Nothing here", table: "Inbox")
        case .unread: String(localized: "No unread mail here.", table: "Inbox")
        case .attachments: String(localized: "No attachments here.", table: "Inbox")
        }
    }

    /// Returns the query with this filter applied. A filter lists every matching conversation, so bundles unfold.
    func apply(to query: ThreadQuery) -> ThreadQuery {
        guard self != .all else { return query }
        var filtered = query
        filtered.focused = false
        filtered.unreadOnly = self == .unread
        filtered.hasAttachments = self == .attachments
        return filtered
    }

    /// Lists the filter makes sense on: the inbox-like views, not the trash or spam.
    static func isAvailable(for mailbox: MailboxSelection) -> Bool {
        switch mailbox {
        case .inbox, .pinned, .snoozed, .sent, .archive, .folder: true
        case .drafts, .scheduled, .trash, .spam: false
        }
    }
}
