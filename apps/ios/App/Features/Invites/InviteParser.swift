import FlintModel
import Foundation

/// Who the person is and when "now" is, for the parts of an invite that depend on them.
struct InviteParseContext: Sendable {
    var ownAddresses: [String]
    var now: EpochMs
}

/// iCalendar (RFC 5545) and iTIP (RFC 5546) invitation parser. Port of calendar/parse.ts. Never throws: bad input gives nil.
enum InviteParser {
    private struct Moment {
        var epoch: Int
        var zone: String?
        var wall: Wall
        var dateOnly: Bool
        var date: String
    }

    static func parse(_ ics: String, context: InviteParseContext) -> ParsedInvite? {
        parse(Data(ics.utf8), context: context)
    }

    static func parse(_ data: Data, context: InviteParseContext) -> ParsedInvite? {
        guard let calendar = ICalReader.parse(data) else { return nil }
        let events = calendar.components("VEVENT")
        guard !events.isEmpty else { return nil }
        let event = events.first { !$0.has("RECURRENCE-ID") } ?? events[0]
        let zones = declaredZones(calendar)
        guard let start = moment(event.first("DTSTART"), zones: zones) else { return nil }
        let (end, endDate) = endOf(event, start: start, zones: zones)
        let own = Set(context.ownAddresses.map { $0.trimmingCharacters(in: .whitespaces).lowercased() })

        let rawMethod = calendar.first("METHOD")?.value.trimmingCharacters(in: .whitespaces).uppercased() ?? ""
        var method = InviteMethod(rawValue: rawMethod) ?? .publish
        let status = event.first("STATUS")?.value.trimmingCharacters(in: .whitespaces).uppercased()
        if (method == .request || method == .publish), status == "CANCELLED" { method = .cancel }

        let attendees = event.all("ATTENDEE").compactMap { attendee($0, own: own) }
        let organizer = event.first("ORGANIZER").flatMap { property -> Address? in
            let address = mailbox(property.value)
            return address.isEmpty ? nil : Address(name: (property.params["CN"] ?? "").trimmingCharacters(in: .whitespaces), address: address)
        }
        let you = attendees.first(where: \.isYou)
        let description = text(event, "DESCRIPTION")
        let location = text(event, "LOCATION")
        let urlText = text(event, "URL")
        let conference = InviteConferenceFinder.find(.init(
            googleConference: text(event, "X-GOOGLE-CONFERENCE"),
            vendorUrls: [text(event, "X-MICROSOFT-SKYPETEAMSMEETINGURL"), text(event, "X-MICROSOFT-ONLINEMEETINGEXTERNALLINK")],
            location: location, url: urlText, description: description))
        let title = text(event, "SUMMARY")
        let uid = text(event, "UID").isEmpty ? "no-uid:\(title):\(start.epoch)" : text(event, "UID")
        let sequence = Int(text(event, "SEQUENCE")) ?? 0

        return ParsedInvite(
            uid: uid, method: method, sequence: sequence, recurrenceId: recurrenceKey(event.first("RECURRENCE-ID"), zones: zones),
            title: title.isEmpty ? "Untitled event" : title,
            description: InviteConferenceFinder.cleanDescription(description, conferenceUrl: conference?.url),
            start: start.epoch, end: end, allDay: start.dateOnly, startDate: start.dateOnly ? start.date : nil, endDate: endDate,
            timeZone: start.dateOnly ? nil : start.zone,
            recurrence: recurrence(event, events: events, start: start, zones: zones),
            location: readLocation(location, conferenceUrl: conference?.url), url: urlText.isEmpty || urlText == conference?.url ? nil : urlText,
            conference: conference, organizer: organizer, attendees: attendees,
            invitedAs: you.map { .init(address: $0.address, role: $0.role, rsvp: $0.rsvp) },
            dtstamp: (event.first("DTSTAMP") ?? event.first("LAST-MODIFIED") ?? event.first("CREATED")).flatMap { moment($0, zones: zones)?.epoch },
            source: source(calendar.first("PRODID")?.value ?? ""), reply: replyInfo(method: method, attendees: attendees, event: event))
    }

    // MARK: Times

    /// Parses "20261027T150000Z", "2026-10-27" and friends. Nil when it is not a date.
    static func wall(_ value: String) -> Wall? {
        let digits = Array(value.filter { $0.isNumber || $0 == "T" })
        guard digits.count >= 8, digits[..<8].allSatisfy(\.isNumber) else { return nil }
        func int(_ range: Range<Int>) -> Int { Int(String(digits[range])) ?? 0 }
        var result = Wall(year: int(0..<4), month: int(4..<6), day: int(6..<8))
        if digits.count >= 13, digits[8] == "T" {
            result.hour = int(9..<11)
            result.minute = int(11..<13)
            if digits.count >= 15 { result.second = int(13..<15) }
        }
        return result
    }

    private static func isoDate(_ w: Wall) -> String { String(format: "%04d-%02d-%02d", w.year, w.month, w.day) }

    private static func declaredZones(_ calendar: ICalComponent) -> [String: InviteZones.DeclaredZone] {
        var out: [String: InviteZones.DeclaredZone] = [:]
        for tz in calendar.components("VTIMEZONE") {
            if let id = tz.first("TZID")?.value, let zone = InviteZones.declared(tz) { out[id] = zone }
        }
        return out
    }

    private static func moment(_ p: ICalProperty?, zones: [String: InviteZones.DeclaredZone], only: String? = nil) -> Moment? {
        guard let p else { return nil }
        let value = (only ?? p.value).trimmingCharacters(in: .whitespaces)
        guard let wall = wall(value) else { return nil }
        let date = isoDate(wall)
        if p.params["VALUE"]?.uppercased() == "DATE" || !value.contains("T") {
            return Moment(epoch: InviteZones.utcEpoch(wall), zone: nil, wall: wall, dateOnly: true, date: date)
        }
        if value.hasSuffix("Z") { return Moment(epoch: InviteZones.utcEpoch(wall), zone: "UTC", wall: wall, dateOnly: false, date: date) }
        let tzid = p.params["TZID"] ?? ""
        if let iana = InviteZones.resolve(tzid) { return Moment(epoch: InviteZones.epoch(wall, in: iana), zone: iana, wall: wall, dateOnly: false, date: date) }
        switch zones[tzid] {
        case .named(let zone): return Moment(epoch: InviteZones.epoch(wall, in: zone), zone: zone, wall: wall, dateOnly: false, date: date)
        case .fixed(let seconds): return Moment(epoch: InviteZones.utcEpoch(wall) - seconds * 1000, zone: nil, wall: wall, dateOnly: false, date: date)
        case nil: return Moment(epoch: InviteZones.epoch(wall, in: TimeZone.current.identifier), zone: nil, wall: wall, dateOnly: false, date: date)
        }
    }

    private static func endOf(_ event: ICalComponent, start: Moment, zones: [String: InviteZones.DeclaredZone]) -> (Int, String?) {
        let end = moment(event.first("DTEND"), zones: zones)
        let duration = event.first("DURATION").flatMap { durationMs($0.value) }
        if start.dateOnly {
            let day = 86_400_000
            let ms = end?.dateOnly == true ? end!.epoch : duration.map { start.epoch + $0 } ?? start.epoch + day
            let resolved = ms <= start.epoch ? start.epoch + day : ms
            return (resolved, isoDate(InviteZones.wall(resolved, in: "UTC")))
        }
        let resolved = end?.epoch ?? duration.map { start.epoch + $0 } ?? start.epoch
        return (max(resolved, start.epoch), nil)
    }

    /// ISO 8601 durations as iCalendar writes them: P1DT2H30M, PT45M, P1W.
    static func durationMs(_ text: String) -> Int? {
        let t = text.trimmingCharacters(in: .whitespaces).uppercased()
        guard t.hasPrefix("P") || t.hasPrefix("-P") || t.hasPrefix("+P") else { return nil }
        let negative = t.hasPrefix("-")
        var total = 0
        var number = ""
        var inTime = false
        for ch in t.drop(while: { $0 != "P" }).dropFirst() {
            if ch.isNumber { number.append(ch); continue }
            if ch == "T" { inTime = true; continue }
            guard let n = Int(number) else { return nil }
            number = ""
            switch (ch, inTime) {
            case ("W", _): total += n * 7 * 86_400
            case ("D", _): total += n * 86_400
            case ("H", true): total += n * 3600
            case ("M", true): total += n * 60
            case ("S", true): total += n
            default: return nil
            }
        }
        return (negative ? -total : total) * 1000
    }

    private static func recurrenceKey(_ p: ICalProperty?, zones: [String: InviteZones.DeclaredZone]) -> String? {
        guard let m = moment(p, zones: zones) else { return nil }
        if m.dateOnly { return m.date.replacingOccurrences(of: "-", with: "") }
        let w = InviteZones.wall(m.epoch, in: "UTC")
        return String(format: "%04d%02d%02dT%02d%02d%02dZ", w.year, w.month, w.day, w.hour, w.minute, w.second)
    }

    // MARK: Pieces

    private static func text(_ c: ICalComponent, _ name: String) -> String {
        (c.first(name)?.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func mailbox(_ value: String) -> String {
        var v = value.trimmingCharacters(in: .whitespaces)
        if v.lowercased().hasPrefix("mailto:") { v = String(v.dropFirst(7)) }
        v = v.trimmingCharacters(in: .whitespaces).lowercased()
        return v.contains("@") ? v : ""
    }

    private static func attendee(_ p: ICalProperty, own: Set<String>) -> InviteAttendee? {
        let address = mailbox(p.value)
        guard !address.isEmpty else { return nil }
        let cutype = (p.params["CUTYPE"] ?? "").uppercased()
        if cutype == "RESOURCE" || cutype == "ROOM" { return nil }
        let responses: [String: InviteResponse] = ["ACCEPTED": .accepted, "TENTATIVE": .tentative, "DECLINED": .declined]
        let roles: [String: InviteRole] = ["CHAIR": .chair, "OPT-PARTICIPANT": .optional, "NON-PARTICIPANT": .nonParticipant]
        return InviteAttendee(
            name: (p.params["CN"] ?? "").trimmingCharacters(in: .whitespaces), address: address,
            response: responses[(p.params["PARTSTAT"] ?? "NEEDS-ACTION").uppercased()] ?? .needsAction,
            role: roles[(p.params["ROLE"] ?? "").uppercased()] ?? .required,
            rsvp: (p.params["RSVP"] ?? "").uppercased() == "TRUE", isYou: own.contains(address))
    }

    private static func source(_ prodid: String) -> InviteSource {
        let p = prodid.lowercased()
        if p.contains("google") { return .google }
        if p.contains("zoom") { return .zoom }
        if p.contains("microsoft") || p.contains("outlook") || p.contains("exchange") { return .outlook }
        if p.contains("apple") || p.contains("icloud") || p.contains("ical") { return .apple }
        return .other
    }

    private static let nonLocations = try! NSRegularExpression(
        pattern: "^(microsoft teams( meeting)?|zoom( meeting)?|google meet|online( meeting)?|video ?call|webex( meeting)?|skype( meeting)?)$", options: [.caseInsensitive])

    private static func readLocation(_ raw: String, conferenceUrl: String?) -> String? {
        var location = raw.split(whereSeparator: \.isNewline)
            .map { $0.split(whereSeparator: \.isWhitespace).joined(separator: " ") }.filter { !$0.isEmpty }.joined(separator: ", ")
        if location.isEmpty { return nil }
        if let conferenceUrl, location.contains(conferenceUrl) {
            location = location.replacingOccurrences(of: conferenceUrl, with: "").trimmingCharacters(in: CharacterSet(charactersIn: " ,;-"))
        }
        let whole = NSRange(location.startIndex..., in: location)
        return location.isEmpty || nonLocations.firstMatch(in: location, range: whole) != nil ? nil : location
    }

    private static func recurrence(_ event: ICalComponent, events: [ICalComponent], start: Moment, zones: [String: InviteZones.DeclaredZone]) -> InviteRecurrence? {
        guard let rule = event.first("RRULE")?.value, !rule.isEmpty else { return nil }
        let exceptions = event.has("EXDATE") || event.has("RDATE") || events.contains { $0.has("RECURRENCE-ID") }
        return InviteRecurrence(
            summary: InviteRecurrenceMath.summary(rule, start: start.wall, zone: start.zone), rrule: rule, hasExceptions: exceptions,
            excluded: dates(event, "EXDATE", zones: zones), added: dates(event, "RDATE", zones: zones))
    }

    /// Every date on the EXDATE or RDATE lines; each line may list several.
    private static func dates(_ event: ICalComponent, _ name: String, zones: [String: InviteZones.DeclaredZone]) -> [Int] {
        event.all(name).flatMap { p in p.value.split(separator: ",").compactMap { moment(p, zones: zones, only: String($0))?.epoch } }
    }

    private static func replyInfo(method: InviteMethod, attendees: [InviteAttendee], event: ICalComponent) -> InviteReplyInfo? {
        guard method == .reply, let from = attendees.first else { return nil }
        let comment = text(event, "COMMENT")
        return InviteReplyInfo(from: Address(name: from.name, address: from.address), response: from.response, comment: comment.isEmpty ? nil : comment)
    }
}
