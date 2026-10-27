import Foundation

/// A wall-clock time without a zone.
struct Wall: Hashable, Sendable {
    var year: Int, month: Int, day: Int, hour: Int = 0, minute: Int = 0, second: Int = 0
}

/// Time zone work for invitations: Windows names that Exchange and Outlook send, IANA names, wall time to instant and back.
enum InviteZones {
    private static let windows: [String: String] = [
        "Pacific Standard Time": "America/Los_Angeles", "Mountain Standard Time": "America/Denver",
        "US Mountain Standard Time": "America/Phoenix", "Central Standard Time": "America/Chicago",
        "Eastern Standard Time": "America/New_York", "Alaskan Standard Time": "America/Anchorage",
        "Hawaiian Standard Time": "Pacific/Honolulu", "Atlantic Standard Time": "America/Halifax",
        "Newfoundland Standard Time": "America/St_Johns", "Canada Central Standard Time": "America/Regina",
        "Mexico Standard Time": "America/Mexico_City", "SA Pacific Standard Time": "America/Bogota",
        "E. South America Standard Time": "America/Sao_Paulo", "Argentina Standard Time": "America/Argentina/Buenos_Aires",
        "UTC": "UTC", "GMT Standard Time": "Europe/London", "Greenwich Standard Time": "Atlantic/Reykjavik",
        "W. Europe Standard Time": "Europe/Berlin", "Central Europe Standard Time": "Europe/Budapest",
        "Central European Standard Time": "Europe/Warsaw", "Romance Standard Time": "Europe/Paris",
        "E. Europe Standard Time": "Europe/Chisinau", "GTB Standard Time": "Europe/Bucharest",
        "FLE Standard Time": "Europe/Kiev", "Russian Standard Time": "Europe/Moscow", "Turkey Standard Time": "Europe/Istanbul",
        "Israel Standard Time": "Asia/Jerusalem", "Egypt Standard Time": "Africa/Cairo", "South Africa Standard Time": "Africa/Johannesburg",
        "Arab Standard Time": "Asia/Riyadh", "Arabian Standard Time": "Asia/Dubai", "Pakistan Standard Time": "Asia/Karachi",
        "India Standard Time": "Asia/Kolkata", "Sri Lanka Standard Time": "Asia/Colombo", "SE Asia Standard Time": "Asia/Bangkok",
        "China Standard Time": "Asia/Shanghai", "Singapore Standard Time": "Asia/Singapore", "Taipei Standard Time": "Asia/Taipei",
        "W. Australia Standard Time": "Australia/Perth", "Tokyo Standard Time": "Asia/Tokyo", "Korea Standard Time": "Asia/Seoul",
        "AUS Eastern Standard Time": "Australia/Sydney", "E. Australia Standard Time": "Australia/Brisbane",
        "New Zealand Standard Time": "Pacific/Auckland",
    ]

    /// The IANA identifier for a TZID, or nil when it is neither IANA nor a known Windows name.
    static func resolve(_ tzid: String) -> String? {
        let trimmed = tzid.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { return nil }
        if let mapped = windows[trimmed] { return mapped }
        if trimmed == "UTC" || trimmed == "GMT" || TimeZone(identifier: trimmed) != nil { return trimmed }
        // Some producers prefix an Olson path: "/mozilla.org/20050126_1/America/New_York".
        let parts = trimmed.split(separator: "/")
        if parts.count > 2 {
            let tail = parts.suffix(2).joined(separator: "/")
            if TimeZone(identifier: tail) != nil { return tail }
        }
        return nil
    }

    private static func calendar(_ zone: String) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: zone) ?? TimeZone(identifier: "UTC")!
        calendar.locale = Locale(identifier: "en_US_POSIX")
        return calendar
    }

    /// The instant (epoch ms) a wall time names in a zone. A time that does not exist (spring forward) moves ahead.
    static func epoch(_ wall: Wall, in zone: String) -> Int {
        let parts = DateComponents(year: wall.year, month: wall.month, day: wall.day, hour: wall.hour, minute: wall.minute, second: wall.second)
        let date = calendar(zone).date(from: parts) ?? Date(timeIntervalSince1970: 0)
        return Int((date.timeIntervalSince1970 * 1000).rounded())
    }

    /// The wall clock of an instant in a zone.
    static func wall(_ epoch: Int, in zone: String) -> Wall {
        let date = Date(timeIntervalSince1970: Double(epoch) / 1000)
        let c = calendar(zone).dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
        return Wall(year: c.year ?? 1970, month: c.month ?? 1, day: c.day ?? 1, hour: c.hour ?? 0, minute: c.minute ?? 0, second: c.second ?? 0)
    }

    /// Epoch ms for a wall time read as UTC (all-day values and Z times).
    static func utcEpoch(_ wall: Wall) -> Int { epoch(wall, in: "UTC") }

    /// The zone for a VTIMEZONE the file declares itself ("Customized Time Zone"): X-LIC-LOCATION when it names a zone, else
    /// the fixed offset of its STANDARD block. Nil when neither is usable.
    static func declared(_ timezone: ICalComponent) -> DeclaredZone? {
        if let location = timezone.first("X-LIC-LOCATION")?.value, let zone = resolve(location) { return .named(zone) }
        let blocks = timezone.components("STANDARD") + timezone.components("DAYLIGHT")
        guard let offset = blocks.first?.first("TZOFFSETTO")?.value, let seconds = offsetSeconds(offset) else { return nil }
        return .fixed(seconds)
    }

    enum DeclaredZone: Sendable {
        case named(String)
        case fixed(Int)
    }

    /// "+0530", "-0800" or "+053000" as seconds.
    static func offsetSeconds(_ text: String) -> Int? {
        let t = text.trimmingCharacters(in: .whitespaces)
        guard let sign = t.first, sign == "+" || sign == "-" else { return nil }
        let digits = t.dropFirst()
        guard digits.count == 4 || digits.count == 6, digits.allSatisfy(\.isNumber) else { return nil }
        let h = Int(digits.prefix(2)) ?? 0
        let m = Int(digits.dropFirst(2).prefix(2)) ?? 0
        let s = digits.count == 6 ? Int(digits.suffix(2)) ?? 0 : 0
        let total = h * 3600 + m * 60 + s
        return sign == "-" ? -total : total
    }
}
