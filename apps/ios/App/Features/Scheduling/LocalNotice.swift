import FlintModel
import Foundation

/// A local notification Scheduling asks for. Plain data so it can be tested and handed to whatever delivers it.
struct LocalNotice: Hashable, Sendable {
    enum Kind: String, Sendable { case sendLater = "send-later", followUp = "follow-up", snooze }

    let kind: Kind
    let id: String
    let title: String
    let body: String
    let fireAt: Date
    /// Set for notices about one conversation, so a tap can open it and a reply can cancel it.
    var threadId: ThreadID?
    var scheduledId: Int?
    /// The followed-up message went out at this time: a reply before it is not an answer to it.
    var sentAt: EpochMs?

    static func id(_ kind: Kind, _ key: String) -> String { "\(kind.rawValue).\(key)" }

    /// Keys a tap handler reads: `flint.kind`, `flint.thread`, `flint.scheduled`, `flint.sentAt`.
    var userInfo: [String: String] {
        var info = ["flint.kind": kind.rawValue]
        if let threadId { info["flint.thread"] = String(threadId) }
        if let scheduledId { info["flint.scheduled"] = String(scheduledId) }
        if let sentAt { info["flint.sentAt"] = String(sentAt) }
        return info
    }

    init?(id: String, title: String, body: String, fireAt: Date, userInfo: [String: String]) {
        guard let raw = userInfo["flint.kind"], let kind = Kind(rawValue: raw) else { return nil }
        self.init(kind: kind, id: id, title: title, body: body, fireAt: fireAt)
        threadId = userInfo["flint.thread"].flatMap(Int.init)
        scheduledId = userInfo["flint.scheduled"].flatMap(Int.init)
        sentAt = userInfo["flint.sentAt"].flatMap(Int.init)
    }

    init(kind: Kind, id: String, title: String, body: String, fireAt: Date) {
        self.kind = kind
        self.id = id
        self.title = title
        self.body = body
        self.fireAt = fireAt
    }
}

/// The notices for send later, follow-up reminders and snooze wake-ups. Titles carry the person's name unless previews are
/// hidden (`showNames` false); subjects and bodies stay out of them because they show on the lock screen.
enum SchedulingNotices {
    static func sendLater(scheduledId: Int, to: [Address], sendAt: EpochMs, showNames: Bool = true) -> LocalNotice {
        let who = showNames ? FlintFormat.participants(to) : ""
        let title = who.isEmpty ? String(localized: "Ready to send", table: "Scheduling") : String(localized: "Ready to send to \(who)", table: "Scheduling")
        var notice = LocalNotice(
            kind: .sendLater, id: LocalNotice.id(.sendLater, String(scheduledId)), title: title,
            body: String(localized: "Tap to open Flint and send it.", table: "Scheduling"), fireAt: date(sendAt))
        notice.scheduledId = scheduledId
        return notice
    }

    static func followUp(scheduledId: Int, to: [Address], threadId: ThreadID?, remindAt: EpochMs, sentAt: EpochMs, showNames: Bool = true) -> LocalNotice {
        let who = showNames ? FlintFormat.participants(to) : ""
        let title = who.isEmpty ? String(localized: "Any reply?", table: "Scheduling") : String(localized: "Any reply from \(who)?", table: "Scheduling")
        var notice = LocalNotice(
            kind: .followUp, id: LocalNotice.id(.followUp, String(scheduledId)), title: title,
            body: String(localized: "You asked to be reminded if nobody replied. Tap to check.", table: "Scheduling"), fireAt: date(remindAt))
        notice.threadId = threadId
        notice.scheduledId = scheduledId
        notice.sentAt = sentAt
        return notice
    }

    static func snooze(threadId: ThreadID, until: EpochMs) -> LocalNotice {
        var notice = LocalNotice(
            kind: .snooze, id: LocalNotice.id(.snooze, String(threadId)), title: String(localized: "Back in your inbox", table: "Scheduling"),
            body: String(localized: "A conversation you snoozed is due. Tap to open it.", table: "Scheduling"), fireAt: date(until))
        notice.threadId = threadId
        return notice
    }

    /// The same notice with the recipient taken out of the title, for when previews are switched to hidden after it was set.
    static func withoutNames(_ notice: LocalNotice) -> LocalNotice {
        var plain = notice
        switch notice.kind {
        case .sendLater: plain = LocalNotice(kind: .sendLater, id: notice.id, title: String(localized: "Ready to send", table: "Scheduling"), body: notice.body, fireAt: notice.fireAt)
        case .followUp: plain = LocalNotice(kind: .followUp, id: notice.id, title: String(localized: "Any reply?", table: "Scheduling"), body: notice.body, fireAt: notice.fireAt)
        case .snooze: return notice
        }
        plain.threadId = notice.threadId
        plain.scheduledId = notice.scheduledId
        plain.sentAt = notice.sentAt
        return plain
    }

    private static func date(_ ms: EpochMs) -> Date { Date(timeIntervalSince1970: Double(ms) / 1000) }
}
