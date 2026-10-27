import Foundation

/// A parsed RRULE.
struct RecurrenceRule: Equatable, Sendable {
    struct Day: Equatable, Sendable { var ordinal: Int?; var code: String }
    var freq: String
    var interval = 1
    var byDay: [Day] = []
    var byMonthDay: [Int] = []
    var byMonth: [Int] = []
    var bySetPos: [Int] = []
    var count: Int?
    var until: String?

    static let dayCodes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"]

    /// Nil when the text has no FREQ.
    init?(_ text: String) {
        var map: [String: String] = [:]
        let body = text.uppercased().hasPrefix("RRULE:") ? String(text.dropFirst(6)) : text
        for piece in body.split(separator: ";") {
            let pair = piece.split(separator: "=", maxSplits: 1)
            if pair.count == 2 { map[pair[0].trimmingCharacters(in: .whitespaces).uppercased()] = pair[1].trimmingCharacters(in: .whitespaces) }
        }
        guard let freq = map["FREQ"]?.uppercased() else { return nil }
        self.freq = freq
        interval = max(1, Int(map["INTERVAL"] ?? "") ?? 1)
        byDay = (map["BYDAY"] ?? "").split(separator: ",").compactMap { token in
            let t = token.trimmingCharacters(in: .whitespaces).uppercased()
            guard t.count >= 2, Self.dayCodes.contains(String(t.suffix(2))) else { return nil }
            let prefix = String(t.dropLast(2))
            return Day(ordinal: prefix.isEmpty ? nil : Int(prefix), code: String(t.suffix(2)))
        }
        byMonthDay = (map["BYMONTHDAY"] ?? "").split(separator: ",").compactMap { Int($0) }
        byMonth = (map["BYMONTH"] ?? "").split(separator: ",").compactMap { Int($0) }
        bySetPos = (map["BYSETPOS"] ?? "").split(separator: ",").compactMap { Int($0) }
        count = map["COUNT"].flatMap { Int($0) }
        until = map["UNTIL"]
    }
}

/// Recurrence text and the next occurrence of a series. Covers DAILY, WEEKLY, MONTHLY and YEARLY rules, which is what calendars send.
enum InviteRecurrenceMath {
    private static let dayNames = ["SU": "Sunday", "MO": "Monday", "TU": "Tuesday", "WE": "Wednesday", "TH": "Thursday", "FR": "Friday", "SA": "Saturday"]
    private static let months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    private static let ordinals = ["", "first", "second", "third", "fourth", "fifth"]

    static func ordinalDay(_ n: Int) -> String {
        let mod100 = n % 100
        if (11...13).contains(mod100) { return "\(n)th" }
        switch n % 10 {
        case 1: return "\(n)st"
        case 2: return "\(n)nd"
        case 3: return "\(n)rd"
        default: return "\(n)th"
        }
    }

    private static func ordinalWord(_ n: Int) -> String {
        if n == -1 { return "last" }
        if n < -1 { return "\(ordinalDay(-n)) to last" }
        return n < ordinals.count ? ordinals[n] : ordinalDay(n)
    }

    private static func list(_ items: [String]) -> String {
        items.count <= 1 ? items.joined() : items.dropLast().joined(separator: ", ") + " and " + items[items.count - 1]
    }

    private static func weekday(_ wall: Wall) -> String {
        let days = Calendar(identifier: .gregorian)
        var utc = days
        utc.timeZone = TimeZone(identifier: "UTC")!
        let date = utc.date(from: DateComponents(year: wall.year, month: wall.month, day: wall.day)) ?? Date(timeIntervalSince1970: 0)
        return RecurrenceRule.dayCodes[utc.component(.weekday, from: date) - 1]
    }

    /// UNTIL as a calendar date in the event's zone (a UTC UNTIL can fall on the next day there).
    private static func untilWall(_ until: String, zone: String?) -> Wall? {
        guard let parsed = InviteParser.wall(until) else { return nil }
        guard until.hasSuffix("Z"), let zone else { return parsed }
        return InviteZones.wall(InviteZones.utcEpoch(parsed), in: zone)
    }

    /// "Weekly on Tuesday until Dec 12", "Every weekday", "Every 2 weeks on Monday and Wednesday", "Monthly on the third Friday".
    static func summary(_ rrule: String, start: Wall, zone: String?) -> String {
        guard let r = RecurrenceRule(rrule) else { return "Repeats" }
        func every(_ unit: String) -> String { r.interval == 1 ? "" : "Every \(r.interval) \(unit)s" }
        var base: String
        switch r.freq {
        case "DAILY": base = r.interval == 1 ? "Daily" : every("day")
        case "WEEKLY": base = weekly(r, start: start, every: every("week"))
        case "MONTHLY": base = monthly(r, start: start, lead: r.interval == 1 ? "Monthly" : every("month"))
        case "YEARLY": base = yearly(r, start: start, lead: r.interval == 1 ? "Yearly" : every("year"))
        case "HOURLY": base = r.interval == 1 ? "Hourly" : every("hour")
        case "MINUTELY": base = every("minute").isEmpty ? "Every minute" : every("minute")
        default: base = "Repeats"
        }
        if let count = r.count { return "\(base), \(count == 1 ? "once" : "\(count) times")" }
        if let until = r.until, let wall = untilWall(until, zone: zone) {
            let date = "\(months[wall.month - 1].prefix(3)) \(wall.day)" + (wall.year == start.year ? "" : ", \(wall.year)")
            return "\(base) until \(date)"
        }
        return base
    }

    private static func weekly(_ r: RecurrenceRule, start: Wall, every: String) -> String {
        let days = Set(r.byDay.isEmpty ? [weekday(start)] : r.byDay.map(\.code))
        if r.interval == 1, days == ["MO", "TU", "WE", "TH", "FR"] { return "Every weekday" }
        if r.interval == 1, days.count == 7 { return "Daily" }
        let ordered = (Array(RecurrenceRule.dayCodes.dropFirst()) + ["SU"]).filter(days.contains).compactMap { dayNames[$0] }
        return "\(r.interval == 1 ? "Weekly" : every) on \(list(ordered))"
    }

    private static func monthly(_ r: RecurrenceRule, start: Wall, lead: String) -> String {
        let ordinal = r.byDay.first?.ordinal ?? r.bySetPos.first
        if let day = r.byDay.first, let ordinal { return "\(lead) on the \(ordinalWord(ordinal)) \(dayNames[day.code] ?? day.code)" }
        if !r.byMonthDay.isEmpty {
            return "\(lead) on \(list(r.byMonthDay.map { $0 == -1 ? "the last day" : "the \(ordinalDay($0))" }))"
        }
        return "\(lead) on the \(ordinalDay(start.day))"
    }

    private static func yearly(_ r: RecurrenceRule, start: Wall, lead: String) -> String {
        let month = r.byMonth.first ?? start.month
        if let day = r.byDay.first, let ordinal = day.ordinal ?? r.bySetPos.first {
            return "\(lead) on the \(ordinalWord(ordinal)) \(dayNames[day.code] ?? day.code) of \(months[month - 1])"
        }
        return "\(lead) on \(months[month - 1].prefix(3)) \(r.byMonthDay.first ?? start.day)"
    }

    // MARK: Next occurrence

    /// The first occurrence at or after `after` (epoch ms), or nil when the series is over or the rule is not one we expand.
    /// `excluded` instants are skipped; `added` instants count as occurrences.
    static func nextOccurrence(
        _ rrule: String, start: Wall, zone: String, after: Int, excluded: [Int] = [], added: [Int] = []
    ) -> Int? {
        let skip = Set(excluded)
        let extra = added.filter { $0 >= after && !skip.contains($0) }.min()
        func pick(_ found: Int?) -> Int? { [found, extra].compactMap { $0 }.min() }
        let first = InviteZones.epoch(start, in: zone)
        if first >= after, !skip.contains(first) { return pick(first) }
        guard let rule = RecurrenceRule(rrule) else { return extra }
        var produced = 0
        for wall in occurrences(rule, start: start) {
            if let count = rule.count, produced >= count { return extra }
            produced += 1
            let epoch = InviteZones.epoch(wall, in: zone)
            if let until = rule.until, let limit = untilEpoch(until, zone: zone), epoch > limit { return extra }
            if epoch >= after, !skip.contains(epoch) { return pick(epoch) }
            if produced > 6000 { break }
        }
        return extra
    }

    /// The last instant a series covers, or nil when it never ends or the rule is not one we read.
    static func seriesEnd(_ rrule: String, start: Wall, zone: String, duration: Int) -> Int? {
        guard let rule = RecurrenceRule(rrule) else { return nil }
        if let until = rule.until, let limit = untilEpoch(until, zone: zone) { return limit + duration }
        guard let count = rule.count else { return nil }
        var last: Wall?
        var produced = 0
        for wall in occurrences(rule, start: start) {
            last = wall
            produced += 1
            if produced >= min(count, 5000) { break }
        }
        return last.map { InviteZones.epoch($0, in: zone) + duration }
    }

    private static func untilEpoch(_ until: String, zone: String) -> Int? {
        guard var wall = InviteParser.wall(until) else { return nil }
        if !until.contains("T") { (wall.hour, wall.minute, wall.second) = (23, 59, 59) }
        return until.hasSuffix("Z") ? InviteZones.utcEpoch(wall) : InviteZones.epoch(wall, in: zone)
    }

    /// Wall-clock occurrences in order, starting with the first. A lazy sequence that stops after a few thousand periods.
    private static func occurrences(_ rule: RecurrenceRule, start: Wall) -> AnyIterator<Wall> {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let origin = calendar.date(from: DateComponents(year: start.year, month: start.month, day: start.day)) ?? Date(timeIntervalSince1970: 0)
        var period = 0
        var queue: [Wall] = []
        func wall(_ date: Date) -> Wall {
            let c = calendar.dateComponents([.year, .month, .day], from: date)
            return Wall(year: c.year ?? 1970, month: c.month ?? 1, day: c.day ?? 1, hour: start.hour, minute: start.minute, second: start.second)
        }
        return AnyIterator {
            while queue.isEmpty, period < 6000 {
                queue = candidates(rule, start: start, origin: origin, period: period, calendar: calendar).map(wall)
                period += 1
            }
            return queue.isEmpty ? nil : queue.removeFirst()
        }
    }

    /// Dates of one period (a day, week, month or year counted from the start), sorted, never before the start.
    private static func candidates(_ rule: RecurrenceRule, start: Wall, origin: Date, period: Int, calendar: Calendar) -> [Date] {
        let step = period * rule.interval
        func add(_ unit: Calendar.Component, _ n: Int) -> Date { calendar.date(byAdding: unit, value: n, to: origin) ?? origin }
        let dates: [Date]
        switch rule.freq {
        case "DAILY": dates = [add(.day, step)]
        case "WEEKLY": dates = weeklyDates(rule, start: start, origin: origin, weeks: step, calendar: calendar)
        case "MONTHLY": dates = monthlyDates(rule, start: start, month: add(.month, step), calendar: calendar)
        case "YEARLY": dates = yearlyDates(rule, start: start, year: add(.year, step), calendar: calendar)
        default: dates = []
        }
        return dates.filter { $0 >= origin }.sorted()
    }

    private static func weeklyDates(_ rule: RecurrenceRule, start: Wall, origin: Date, weeks: Int, calendar: Calendar) -> [Date] {
        guard weeks >= 0, let base = calendar.date(byAdding: .day, value: weeks * 7, to: origin) else { return [] }
        let weekdayIndex = calendar.component(.weekday, from: base) - 1
        let wanted = rule.byDay.isEmpty ? [calendar.component(.weekday, from: origin) - 1] : rule.byDay.compactMap { RecurrenceRule.dayCodes.firstIndex(of: $0.code) }
        // Weeks start on Monday, the iCalendar default.
        let mondayOffset = (weekdayIndex + 6) % 7
        return wanted.compactMap { day in
            calendar.date(byAdding: .day, value: -mondayOffset + (day + 6) % 7, to: base)
        }
    }

    private static func monthlyDates(_ rule: RecurrenceRule, start: Wall, month: Date, calendar: Calendar) -> [Date] {
        let c = calendar.dateComponents([.year, .month], from: month)
        guard let year = c.year, let monthNumber = c.month else { return [] }
        if let day = rule.byDay.first, let ordinal = day.ordinal ?? rule.bySetPos.first {
            return nthWeekday(year: year, month: monthNumber, code: day.code, ordinal: ordinal, calendar: calendar).map { [$0] } ?? []
        }
        let days = rule.byMonthDay.isEmpty ? [start.day] : rule.byMonthDay
        let length = calendar.range(of: .day, in: .month, for: month)?.count ?? 28
        return days.compactMap { d in
            let day = d < 0 ? length + d + 1 : d
            return (1...length).contains(day) ? calendar.date(from: DateComponents(year: year, month: monthNumber, day: day)) : nil
        }
    }

    private static func yearlyDates(_ rule: RecurrenceRule, start: Wall, year: Date, calendar: Calendar) -> [Date] {
        let y = calendar.component(.year, from: year)
        let month = rule.byMonth.first ?? start.month
        if let day = rule.byDay.first, let ordinal = day.ordinal ?? rule.bySetPos.first {
            return nthWeekday(year: y, month: month, code: day.code, ordinal: ordinal, calendar: calendar).map { [$0] } ?? []
        }
        return calendar.date(from: DateComponents(year: y, month: month, day: rule.byMonthDay.first ?? start.day)).map { [$0] } ?? []
    }

    private static func nthWeekday(year: Int, month: Int, code: String, ordinal: Int, calendar: Calendar) -> Date? {
        guard let target = RecurrenceRule.dayCodes.firstIndex(of: code), let first = calendar.date(from: DateComponents(year: year, month: month, day: 1)) else { return nil }
        let length = calendar.range(of: .day, in: .month, for: first)?.count ?? 28
        let days = (1...length).filter { day in
            let date = calendar.date(from: DateComponents(year: year, month: month, day: day))!
            return calendar.component(.weekday, from: date) - 1 == target
        }
        let index = ordinal > 0 ? ordinal - 1 : days.count + ordinal
        guard days.indices.contains(index) else { return nil }
        return calendar.date(from: DateComponents(year: year, month: month, day: days[index]))
    }
}
