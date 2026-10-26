import FlintModel
import Foundation

/// What a row says, as plain values. Ported from `rowText.ts` of the desktop app.
enum InboxRowText {
    private static func isMe(_ address: Address) -> Bool {
        address.name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "me"
    }

    /// Sender line: "Carla, Rodney", "me", or the other people with a Draft tag.
    static func sender(_ item: ThreadListItem) -> (isDraft: Bool, text: String) {
        let others = item.participants.filter { !isMe($0) }
        if item.hasDraft || item.draft != nil { return (true, FlintFormat.participants(others)) }
        return (false, FlintFormat.participants(item.participants))
    }

    /// The person whose avatar leads the row: the first participant who is not the user.
    static func lead(_ item: ThreadListItem) -> Address {
        item.participants.first { !isMe($0) } ?? item.participants.first ?? Address(name: "me", address: "")
    }

    /// Right-hand time: the wake time for snoozed mail, else the usual list time.
    static func time(_ item: ThreadListItem, now: Date = Date(), time: FlintTime = .current) -> (text: String, snoozed: Bool) {
        let nowMs = Int(now.timeIntervalSince1970 * 1000)
        if let until = item.snoozedUntil, until > nowMs {
            let date = Date(timeIntervalSince1970: Double(until) / 1000)
            return (SnoozePresets().formatTime(date, now: now), true)
        }
        return (time.listTime(item.lastDate, now: now), false)
    }

    /// The code to offer on the row: not used and not expired.
    static func liveCode(_ item: ThreadListItem, now: Date = Date()) -> CodeBadge? {
        guard let badge = item.verificationCode, !badge.used else { return nil }
        let nowMs = Int(now.timeIntervalSince1970 * 1000)
        return badge.expiresAt > nowMs ? badge : nil
    }

    /// Calendar invitations carry an .ics attachment and a subject such as "Invitation: Design review". The list data has no
    /// invite flag, so this is a heuristic on those two facts.
    static func isInvite(_ item: ThreadListItem) -> Bool {
        guard item.hasAttachments else { return false }
        let subject = item.subject.lowercased()
        return ["invitation:", "updated invitation:", "invitation from", "accepted:", "declined:"].contains { subject.hasPrefix($0) }
    }

    static func subject(_ item: ThreadListItem) -> String {
        item.subject.isEmpty ? String(localized: "(no subject)", table: "Inbox") : item.subject
    }

    /// The spoken description of a row.
    static func accessibility(_ item: ThreadListItem, time: String) -> String {
        let who = sender(item)
        var parts: [String] = []
        if item.unreadCount > 0 { parts.append(String(localized: "Unread", table: "Inbox")) }
        if item.pinned { parts.append(String(localized: "Pinned", table: "Inbox")) }
        if who.isDraft { parts.append(String(localized: "Draft", table: "Inbox")) }
        parts.append(String(localized: "From \(who.text)", table: "Inbox"))
        parts.append(subject(item))
        if !item.snippet.isEmpty { parts.append(item.snippet) }
        if item.messageCount > 1 { parts.append(String(localized: "\(item.messageCount) messages", table: "Inbox")) }
        if item.hasAttachments { parts.append(String(localized: "Has attachments", table: "Inbox")) }
        if isInvite(item) { parts.append(String(localized: "Calendar invitation", table: "Inbox")) }
        parts.append(time)
        return parts.joined(separator: ", ")
    }
}
