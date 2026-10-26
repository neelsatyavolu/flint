import FlintModel
import Foundation

/// The things a person can do to conversations, with the words the toast uses. Ported from `state/actions.ts` so both apps
/// say the same thing. Pin and read changes are quiet: no toast.
enum ThreadAction: Sendable {
    case archive
    case trash
    case spam(Bool)
    case mute(Bool)
    case snooze(until: EpochMs)
    case unsnooze
    case move(folderName: String)
    case inbox
    case category(MailCategory, rememberSender: Bool)
    case pin(Bool)
    case read(Bool)

    func message(count: Int, now: Date = Date(), presets: SnoozePresets = SnoozePresets()) -> String? {
        let many = count == 1 ? "" : " \(count) conversations"
        switch self {
        case .archive: return String(localized: "Archived\(many)", table: "Shell")
        case .trash: return count == 1 ? String(localized: "Moved to Trash", table: "Shell") : String(localized: "Moved\(many) to Trash", table: "Shell")
        case .spam(let spam):
            if !spam { return String(localized: "Not spam", table: "Shell") }
            return count == 1 ? String(localized: "Marked as spam", table: "Shell") : String(localized: "Marked\(many) as spam", table: "Shell")
        case .mute(let muted): return muted ? String(localized: "Muted", table: "Shell") : String(localized: "Unmuted", table: "Shell")
        case .snooze(let until):
            let time = presets.formatTime(Date(timeIntervalSince1970: Double(until) / 1000), now: now)
            return String(localized: "Snoozed until \(time)", table: "Shell")
        case .unsnooze: return String(localized: "Snooze removed", table: "Shell")
        case .move(let name): return String(localized: "Moved to \(name)", table: "Shell")
        case .inbox: return String(localized: "Moved to Inbox", table: "Shell")
        case .category(let category, let sender):
            let title = Self.title(of: category)
            if sender {
                let who = count == 1 ? String(localized: "this sender", table: "Shell") : String(localized: "these senders", table: "Shell")
                return String(localized: "Mail from \(who) will go to \(title)", table: "Shell")
            }
            return String(localized: "Moved\(many) to \(title)", table: "Shell")
        case .pin, .read: return nil
        }
    }

    var failure: String {
        switch self {
        case .archive: String(localized: "Couldn't archive. Try again.", table: "Shell")
        case .trash: String(localized: "Couldn't move to Trash. Try again.", table: "Shell")
        case .spam: String(localized: "Couldn't update spam. Try again.", table: "Shell")
        case .pin: String(localized: "Couldn't change the pin. Try again.", table: "Shell")
        case .read: String(localized: "Couldn't change read state. Try again.", table: "Shell")
        case .mute: String(localized: "Couldn't change mute. Try again.", table: "Shell")
        case .snooze: String(localized: "Couldn't snooze. Try again.", table: "Shell")
        case .unsnooze: String(localized: "Couldn't remove the snooze. Try again.", table: "Shell")
        case .move: String(localized: "Couldn't move. Try again.", table: "Shell")
        case .inbox: String(localized: "Couldn't move to Inbox. Try again.", table: "Shell")
        case .category: String(localized: "Couldn't change the category. Try again.", table: "Shell")
        }
    }

    static func title(of category: MailCategory) -> String {
        switch category {
        case .people: String(localized: "People", table: "Shell")
        case .notifications: String(localized: "Notifications", table: "Shell")
        case .newsletters: String(localized: "Newsletters", table: "Shell")
        }
    }
}
