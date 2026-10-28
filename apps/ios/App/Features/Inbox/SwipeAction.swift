import FlintModel
import Foundation

/// What a row can do from a swipe, as the person chose it in the swipe editor.
enum SwipeAction: String, Codable, CaseIterable, Sendable, Identifiable {
    case archive, trash, pin, snooze, read, move

    var id: String { rawValue }

    var title: String {
        switch self {
        case .archive: String(localized: "Archive", table: "Inbox")
        case .trash: String(localized: "Trash", table: "Inbox")
        case .pin: String(localized: "Pin", table: "Inbox")
        case .snooze: String(localized: "Snooze", table: "Inbox")
        case .read: String(localized: "Read or unread", table: "Inbox")
        case .move: String(localized: "Move to folder", table: "Inbox")
        }
    }
}

/// Which actions a swipe shows on each side. At most three per side, no repeats.
struct SwipeConfiguration: Codable, Equatable, Sendable {
    static let maxPerSide = 3
    static let storageKey = "flint.inbox.swipe"
    static let standard = SwipeConfiguration(leading: [.read, .pin], trailing: [.archive, .trash, .snooze])

    var leading: [SwipeAction]
    var trailing: [SwipeAction]

    init(leading: [SwipeAction], trailing: [SwipeAction]) {
        self.leading = Self.clean(leading)
        self.trailing = Self.clean(trailing)
    }

    private static func clean(_ actions: [SwipeAction]) -> [SwipeAction] {
        var seen = Set<SwipeAction>()
        return Array(actions.filter { seen.insert($0).inserted }.prefix(maxPerSide))
    }

    /// The saved configuration, or the standard one when nothing is saved or the data cannot be read.
    static func load(from defaults: UserDefaults) -> SwipeConfiguration {
        guard let data = defaults.data(forKey: storageKey), let saved = try? JSONDecoder().decode(SwipeConfiguration.self, from: data)
        else { return .standard }
        return SwipeConfiguration(leading: saved.leading, trailing: saved.trailing)
    }

    func save(to defaults: UserDefaults) {
        if let data = try? JSONEncoder().encode(self) { defaults.set(data, forKey: Self.storageKey) }
    }
}

/// What a swipe or a menu item does to a row in a given list. The same chosen action means different things in different lists:
/// Archive in the Archive list moves back to the inbox, Snooze in Snoozed removes the snooze.
enum InboxOp: Hashable, Sendable {
    case archive, moveToInbox, trash, deleteDraft
    case pin(Bool), read(Bool)
    case snooze, unsnooze, move

    /// Nil when the action makes no sense for this row in this list (nothing to archive in Trash, no pin on a draft).
    static func resolve(_ action: SwipeAction, for item: ThreadListItem, in mailbox: MailboxSelection) -> InboxOp? {
        if mailbox == .drafts { return action == .trash ? .deleteDraft : nil }
        switch action {
        case .archive:
            switch mailbox {
            case .archive, .trash, .spam: return .moveToInbox
            default: return .archive
            }
        case .trash: return mailbox == .trash ? nil : .trash
        case .pin: return .pin(!item.pinned)
        case .snooze: return mailbox == .snoozed ? .unsnooze : .snooze
        case .read: return .read(item.unreadCount > 0)
        case .move: return .move
        }
    }

    var title: String {
        switch self {
        case .archive: String(localized: "Archive", table: "Inbox")
        case .moveToInbox: String(localized: "Move to Inbox", table: "Inbox")
        case .trash: String(localized: "Trash", table: "Inbox")
        case .deleteDraft: String(localized: "Delete draft", table: "Inbox")
        case .pin(let pin): pin ? String(localized: "Pin", table: "Inbox") : String(localized: "Unpin", table: "Inbox")
        case .read(let read): read ? String(localized: "Read", table: "Inbox") : String(localized: "Unread", table: "Inbox")
        case .snooze: String(localized: "Snooze", table: "Inbox")
        case .unsnooze: String(localized: "Unsnooze", table: "Inbox")
        case .move: String(localized: "Move", table: "Inbox")
        }
    }

    var icon: FlintIcon {
        switch self {
        case .archive: .archive
        case .moveToInbox: .inbox
        case .trash, .deleteDraft: .trash
        case .pin: .pin
        case .read(let read): read ? .mailOpen : .mail
        case .snooze, .unsnooze: .clock
        case .move: .folder
        }
    }

    var isDestructive: Bool { self == .trash || self == .deleteDraft }
    var identifier: String {
        switch self {
        case .archive: "archive"
        case .moveToInbox: "inbox"
        case .trash: "trash"
        case .deleteDraft: "deleteDraft"
        case .pin: "pin"
        case .read: "read"
        case .snooze: "snooze"
        case .unsnooze: "unsnooze"
        case .move: "move"
        }
    }
}
