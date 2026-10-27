import FlintModel
import Foundation

/// The words and tones for read receipts, ported from the desktop `state/receiptText.ts`. Only states the service can back up are
/// stated: an open that passed every filter, a reply, "can't confirm" for Apple Mail Privacy Protection, and "No open detected"
/// for the rest.
enum ReceiptStatusText {
    enum Tone: Sendable { case ok, warn, muted }

    /// The check on list rows and message cards.
    struct Marker: Equatable, Sendable {
        /// "2/3" when there are several recipients, empty for one (the check says it all).
        var text: String
        var tone: Tone
        /// At least one recipient opened or replied: a double check.
        var read: Bool
        /// Spoken label, for example "Opened by 2 of 3".
        var label: String
    }

    static func tone(_ status: ReceiptStatus) -> Tone {
        switch status {
        case .opened, .replied: .ok
        case .unknowable: .warn
        case .sent, .untracked: .muted
        }
    }

    // MARK: Status lines

    /// One line per recipient: "Opened 3:52 PM · Gmail · Austin, US", "Replied 3:52 PM", "No open detected",
    /// "Can't confirm opens: Apple Mail Privacy Protection", "Receipts unavailable for this message".
    static func statusLine(
        _ recipient: ReceiptRecipient, detail: ReceiptDetail? = nil, now: Date = Date(),
        timeZone: TimeZone = .current, locale: Locale = .current
    ) -> String {
        func time(_ at: EpochMs) -> String { Self.time(at, now: now, timeZone: timeZone, locale: locale) }
        switch recipient.status {
        case .opened:
            let event = firstCountedOpen(detail, email: recipient.email)
            var parts = [recipient.firstOpenAt.map { String(localized: "Opened \(time($0))", table: "Receipts") } ?? String(localized: "Opened", table: "Receipts")]
            if let client = event?.client, !client.isEmpty { parts.append(client) }
            if let place = event?.location, !place.isEmpty { parts.append(place) }
            if recipient.possiblyForwarded { parts.append(String(localized: "may have been forwarded", table: "Receipts")) }
            return parts.joined(separator: " · ")
        case .replied:
            return recipient.repliedAt.map { String(localized: "Replied \(time($0))", table: "Receipts") } ?? String(localized: "Replied", table: "Receipts")
        case .unknowable:
            return String(localized: "Can't confirm opens: Apple Mail Privacy Protection", table: "Receipts")
        case .sent:
            return String(localized: "No open detected", table: "Receipts")
        case .untracked:
            return String(localized: "Receipts unavailable for this message", table: "Receipts")
        }
    }

    /// The first counted open for one recipient, used for the mail app and place in the status line.
    static func firstCountedOpen(_ detail: ReceiptDetail?, email: String) -> ReceiptEvent? {
        let target = email.lowercased()
        return detail?.events
            .filter { $0.counted && $0.kind == .open && $0.email.lowercased() == target }
            .min { $0.at < $1.at }
    }

    /// "3:52 PM" today, "Oct 21, 3:52 PM" otherwise.
    static func time(_ at: EpochMs, now: Date = Date(), timeZone: TimeZone = .current, locale: Locale = .current) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let date = Date(timeIntervalSince1970: Double(at) / 1000)
        let clock = formatted(date, template: "jmm", timeZone: timeZone, locale: locale)
        if calendar.isDate(date, inSameDayAs: now) { return clock }
        return "\(formatted(date, template: "MMMd", timeZone: timeZone, locale: locale)), \(clock)"
    }

    private static func formatted(_ date: Date, template: String, timeZone: TimeZone, locale: Locale) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate(template)
        return formatter.string(from: date)
    }

    // MARK: Whole message

    /// replied > opened > unknowable > sent. Untracked recipients (yourself, your aliases, mail sent with tracking off) do not count.
    static func summary(of detail: ReceiptDetail) -> ReceiptSummary {
        let tracked = detail.recipients.filter { $0.status != .untracked }
        let opened = tracked.filter { $0.status == .opened || $0.status == .replied }.count
        let status: ReceiptStatus =
            tracked.contains { $0.status == .replied } ? .replied
            : opened > 0 ? .opened
            : tracked.contains { $0.status == .unknowable } ? .unknowable
            : tracked.isEmpty ? .untracked : .sent
        return ReceiptSummary(opened: opened, total: tracked.count, status: status, lastOpenAt: tracked.compactMap(\.lastOpenAt).max())
    }

    static func marker(_ summary: ReceiptSummary) -> Marker {
        let read = summary.opened > 0 || summary.status == .replied
        let several = summary.total > 1
        let text = several ? "\(summary.opened)/\(summary.total)" : ""
        if read {
            let label = several
                ? String(localized: "Opened by \(summary.opened) of \(summary.total)", table: "Receipts")
                : summary.status == .replied ? String(localized: "Replied", table: "Receipts") : String(localized: "Opened", table: "Receipts")
            return Marker(text: text, tone: .ok, read: true, label: label)
        }
        if summary.status == .unknowable {
            return Marker(text: text, tone: .warn, read: false, label: String(localized: "Can't confirm opens: Apple Mail Privacy Protection", table: "Receipts"))
        }
        let label = several
            ? String(localized: "Not opened yet by any of \(summary.total)", table: "Receipts") : String(localized: "Not opened yet", table: "Receipts")
        return Marker(text: text, tone: .muted, read: false, label: label)
    }

    // MARK: Timeline

    static func eventLabel(_ kind: ReceiptEventKind) -> String {
        switch kind {
        case .open: String(localized: "Opened", table: "Receipts")
        case .prefetch: String(localized: "Image prefetch", table: "Receipts")
        case .scanner: String(localized: "Security scan", table: "Receipts")
        case .`self`: String(localized: "You", table: "Receipts")
        case .bot: String(localized: "Automated fetch", table: "Receipts")
        case .duplicate: String(localized: "Repeat view", table: "Receipts")
        }
    }

    /// "Opened · Gmail · iPhone · Austin, US", with a "not counted" tail for events the filters threw out.
    static func eventLine(_ event: ReceiptEvent) -> String {
        var parts = [eventLabel(event.kind)] + [event.client, event.device, event.location].compactMap { $0 }.filter { !$0.isEmpty }
        if !event.counted { parts.append(String(localized: "not counted", table: "Receipts")) }
        return parts.joined(separator: " · ")
    }
}
