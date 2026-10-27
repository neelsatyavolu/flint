import FlintModel
import Foundation

/// The iMIP REPLY mail for an answer to an invitation (RFC 5546 3.2.3, RFC 6047). Pure: no I/O, no tracking.
struct ImipReply: Equatable, Sendable {
    var to: Address
    var subject: String
    var text: String
    var html: String
    var ics: String
    var uid: String
}

enum ImipError: Error, Equatable { case noOrganizer }

enum ImipBuilder {
    private static let crlf = "\r\n"
    private static let maxOctets = 75

    /// `attendee` is the address the person was invited at: it is the From of the reply and the ATTENDEE.
    static func reply(invite: ParsedInvite, attendee: Address, answer: RSVPAnswer, note: String?, now: EpochMs) throws -> ImipReply {
        guard let organizer = invite.organizer, !organizer.address.isEmpty else { throw ImipError.noOrganizer }
        let who = attendee.name.trimmingCharacters(in: .whitespaces).isEmpty ? attendee.address : attendee.name.trimmingCharacters(in: .whitespaces)
        let lead = "\(who) \(verb[answer]!) this invitation."
        let comment = note?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        let when = whenText(invite)
        var text = [lead, "", invite.title, "When: \(when)"]
        var html = ["<p>\(escapeHTML(lead))</p>", "<p><b>\(escapeHTML(invite.title))</b><br>When: \(escapeHTML(when))</p>"]
        if let comment {
            text += ["", comment]
            html.append("<p>\(escapeHTML(comment).replacingOccurrences(of: "\r\n", with: "<br>").replacingOccurrences(of: "\n", with: "<br>"))</p>")
        }
        let title = invite.title.isEmpty ? "(no title)" : invite.title
        return ImipReply(
            to: Address(name: organizer.name, address: organizer.address),
            subject: "\(subjectPrefix[answer]!): \(title)".replacingOccurrences(of: "\r", with: " ").replacingOccurrences(of: "\n", with: " "),
            text: text.joined(separator: "\n"), html: html.joined(),
            ics: calendarText(invite: invite, organizer: organizer, attendee: attendee, answer: answer, comment: comment, now: now), uid: invite.uid)
    }

    private static let subjectPrefix: [RSVPAnswer: String] = [.accepted: "Accepted", .tentative: "Tentative", .declined: "Declined"]
    private static let verb: [RSVPAnswer: String] = [.accepted: "accepted", .tentative: "replied maybe to", .declined: "declined"]

    // MARK: Calendar part

    /// The text/calendar body. CRLF line endings, folded at 75 octets, ending with a final CRLF.
    static func calendarText(invite: ParsedInvite, organizer: Address, attendee: Address, answer: RSVPAnswer, comment: String?, now: EpochMs) -> String {
        var lines = ["BEGIN:VCALENDAR", "PRODID:-//Flint//Flint Mail//EN", "VERSION:2.0", "CALSCALE:GREGORIAN", "METHOD:REPLY", "BEGIN:VEVENT", "UID:\(invite.uid)"]
        if let recurrenceId = invite.recurrenceId { lines.append(recurrenceIdLine(recurrenceId, zone: invite.timeZone)) }
        lines += ["SEQUENCE:\(invite.sequence)", "DTSTAMP:\(utc(now))"]
        if invite.allDay, let start = invite.startDate, let end = invite.endDate {
            lines += ["DTSTART;VALUE=DATE:\(start.replacingOccurrences(of: "-", with: ""))", "DTEND;VALUE=DATE:\(end.replacingOccurrences(of: "-", with: ""))"]
        } else {
            lines += ["DTSTART:\(utc(invite.start))", "DTEND:\(utc(invite.end))"]
        }
        lines.append("ORGANIZER\(cn(organizer.name)):mailto:\(organizer.address.trimmingCharacters(in: .whitespaces))")
        lines.append("ATTENDEE\(cn(attendee.name));PARTSTAT=\(answer.partstat):mailto:\(attendee.address.trimmingCharacters(in: .whitespaces))")
        if !invite.title.isEmpty { lines.append("SUMMARY:\(escapeText(invite.title))") }
        if let comment { lines.append("COMMENT:\(escapeText(comment))") }
        lines += ["END:VEVENT", "END:VCALENDAR"]
        return lines.map(fold).joined(separator: crlf) + crlf
    }

    private static func cn(_ name: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? "" : ";CN=\(paramValue(trimmed))"
    }

    /// RFC 5545 3.3.11 TEXT escaping.
    static func escapeText(_ s: String) -> String {
        s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: ";", with: "\\;").replacingOccurrences(of: ",", with: "\\,")
            .replacingOccurrences(of: "\r\n", with: "\\n").replacingOccurrences(of: "\r", with: "\\n").replacingOccurrences(of: "\n", with: "\\n")
    }

    /// A parameter value: quoted when it holds , ; or :, never holding a double quote or a control character.
    private static func paramValue(_ s: String) -> String {
        let clean = String(s.replacingOccurrences(of: "\"", with: "'").unicodeScalars.map { $0.value < 0x20 || $0.value == 0x7F ? " " : Character($0) })
            .trimmingCharacters(in: .whitespaces)
        return clean.contains(where: { ",;:".contains($0) }) ? "\"\(clean)\"" : clean
    }

    /// Folds a content line at 75 octets without splitting a UTF-8 character (RFC 5545 3.1).
    static func fold(_ line: String) -> String {
        guard line.utf8.count > maxOctets else { return line }
        var parts: [String] = []
        var current = ""
        var size = 0
        for ch in line {
            let n = String(ch).utf8.count
            if size + n > maxOctets {
                parts.append(current)
                current = ""
                size = 1
            }
            current.append(ch)
            size += n
        }
        parts.append(current)
        return parts.enumerated().map { $0.offset == 0 ? $0.element : " \($0.element)" }.joined(separator: crlf)
    }

    /// 20261027T150000Z
    static func utc(_ ms: Int) -> String {
        let w = InviteZones.wall(ms, in: "UTC")
        return String(format: "%04d%02d%02dT%02d%02d%02dZ", w.year, w.month, w.day, w.hour, w.minute, w.second)
    }

    /// RECURRENCE-ID from the key the parser kept. A zoned local time gets the organizer's TZID back.
    private static func recurrenceIdLine(_ raw: String, zone: String?) -> String {
        let value = raw.trimmingCharacters(in: .whitespaces)
        if value.count == 8, value.allSatisfy(\.isNumber) { return "RECURRENCE-ID;VALUE=DATE:\(value)" }
        if value.count == 15, !value.hasSuffix("Z"), let zone, zone != "UTC" { return "RECURRENCE-ID;TZID=\(zone):\(value)" }
        return "RECURRENCE-ID:\(value)"
    }

    // MARK: Text

    private static func whenText(_ invite: ParsedInvite) -> String {
        if invite.allDay, let start = invite.startDate {
            let last = lastAllDay(start: start, end: invite.endDate)
            return last == start ? start : "\(start) to \(last)"
        }
        let zone = invite.timeZone ?? "UTC"
        let s = InviteZones.wall(invite.start, in: zone)
        let e = InviteZones.wall(invite.end, in: zone)
        let dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekday(s)]
        let month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][s.month - 1]
        return "\(dow), \(month) \(s.day), \(s.year), \(InviteFormat.clock(s)) to \(InviteFormat.clock(e)) (\(zone))"
    }

    private static func weekday(_ w: Wall) -> Int {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let date = calendar.date(from: DateComponents(year: w.year, month: w.month, day: w.day)) ?? Date(timeIntervalSince1970: 0)
        return calendar.component(.weekday, from: date) - 1
    }

    /// `end` is exclusive, so the last day is the day before it.
    private static func lastAllDay(start: String, end: String?) -> String {
        guard let end, let w = InviteParser.wall(end) else { return start }
        let last = InviteZones.wall(InviteZones.utcEpoch(w) - 86_400_000, in: "UTC").isoDate
        return last < start ? start : last
    }

    private static func escapeHTML(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
