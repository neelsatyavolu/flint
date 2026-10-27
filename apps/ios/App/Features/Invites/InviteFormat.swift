import Foundation

/// Display text for invitation times, in the viewer's zone. All-day events are shown by date and never shift with the zone.
enum InviteFormat {
    private static let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    private static let weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    private static let day = 86_400_000

    private static func dayText(_ w: Wall, nowYear: Int) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let date = calendar.date(from: DateComponents(year: w.year, month: w.month, day: w.day)) ?? Date(timeIntervalSince1970: 0)
        let dow = weekdays[calendar.component(.weekday, from: date) - 1]
        return "\(dow), \(months[w.month - 1]) \(w.day)\(w.year == nowYear ? "" : ", \(w.year)")"
    }

    /// "3 PM", "3:45 PM".
    static func clock(_ w: Wall) -> String {
        "\(w.hour % 12 == 0 ? 12 : w.hour % 12)\(w.minute == 0 ? "" : String(format: ":%02d", w.minute)) \(w.hour < 12 ? "AM" : "PM")"
    }

    /// "Tue, Oct 27, 3 PM to 4 PM", "Tue, Oct 27 to Thu, Oct 29" for all-day. The year shows when it is not the current one.
    static func when(start: Int, end: Int, allDay: Bool, zone: String, now: Int) -> String {
        let nowYear = InviteZones.wall(now, in: zone).year
        if allDay {
            let first = InviteZones.wall(start, in: "UTC")
            let last = InviteZones.wall(max(start, end - day), in: "UTC")
            let a = dayText(first, nowYear: nowYear)
            return (first.year, first.month, first.day) == (last.year, last.month, last.day) ? a : "\(a) to \(dayText(last, nowYear: nowYear))"
        }
        let s = InviteZones.wall(start, in: zone)
        let e = InviteZones.wall(end, in: zone)
        let head = "\(dayText(s, nowYear: nowYear)), \(clock(s))"
        if end == start { return head }
        if (s.year, s.month, s.day) == (e.year, e.month, e.day) { return "\(head) to \(clock(e))" }
        return "\(head) to \(dayText(e, nowYear: nowYear)), \(clock(e))"
    }

    /// "45 min", "1 hr 30 min", "3 days". Nil for zero-length events and single all-day events.
    static func duration(start: Int, end: Int, allDay: Bool) -> String? {
        if allDay {
            let days = (end - start) / day
            return days > 1 ? "\(days) days" : nil
        }
        let minutes = Int((Double(end - start) / 60_000).rounded())
        if minutes <= 0 { return nil }
        if minutes < 60 { return "\(minutes) min" }
        if minutes % 1440 == 0 { return minutes == 1440 ? "1 day" : "\(minutes / 1440) days" }
        let h = minutes / 60
        let m = minutes % 60
        return m == 0 ? "\(h) \(h == 1 ? "hr" : "hrs")" : "\(h) hr \(m) min"
    }

    /// The zone's short name ("PDT") at an instant.
    static func zoneAbbreviation(_ zone: String, at epoch: Int) -> String {
        guard let tz = TimeZone(identifier: zone) else { return zone }
        return tz.abbreviation(for: Date(timeIntervalSince1970: Double(epoch) / 1000)) ?? zone
    }

    /// The organizer's wall-clock time, only when their offset differs from the viewer's at the start: "6 to 6:45 PM EDT".
    static func organizerTime(start: Int, end: Int, allDay: Bool, organizerZone: String?, viewerZone: String) -> String? {
        guard !allDay, let organizerZone, organizerZone != "UTC", let a = TimeZone(identifier: organizerZone), let b = TimeZone(identifier: viewerZone) else { return nil }
        let date = Date(timeIntervalSince1970: Double(start) / 1000)
        guard a.secondsFromGMT(for: date) != b.secondsFromGMT(for: date) else { return nil }
        let s = InviteZones.wall(start, in: organizerZone)
        let e = InviteZones.wall(max(end, start), in: organizerZone)
        let abbreviation = zoneAbbreviation(organizerZone, at: start)
        if end <= start { return "\(clock(s)) \(abbreviation)" }
        let first = clock(s)
        let last = clock(e)
        let shared = first.split(separator: " ").last == last.split(separator: " ").last
        let lead = shared ? String(first.dropLast(3)) : first
        return "\(lead) to \(last) \(abbreviation)"
    }
}
