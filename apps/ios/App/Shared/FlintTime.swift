import FlintModel
import Foundation

/// Date and time text, ported from `lib/format.ts` of the desktop app so a thread reads the same on both. Construct it with
/// a calendar and locale to test; the app uses `FlintTime.current`.
struct FlintTime: Sendable {
    var calendar: Calendar
    var locale: Locale

    init(calendar: Calendar = .autoupdatingCurrent, locale: Locale = .autoupdatingCurrent) {
        self.calendar = calendar
        self.locale = locale
    }

    static var current: FlintTime { FlintTime() }

    private var usesEnglishPatterns: Bool { locale.language.languageCode?.identifier == "en" }

    private func format(_ pattern: String, template: String, _ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        if usesEnglishPatterns { formatter.dateFormat = pattern } else { formatter.setLocalizedDateFormatFromTemplate(template) }
        return formatter.string(from: date)
    }

    private func date(_ ms: EpochMs) -> Date { Date(timeIntervalSince1970: Double(ms) / 1000) }

    private func days(from earlier: Date, to later: Date) -> Int {
        let a = calendar.startOfDay(for: earlier)
        let b = calendar.startOfDay(for: later)
        return calendar.dateComponents([.day], from: a, to: b).day ?? 0
    }

    /// List time: "3:49 PM" today, "Tue" within the week, "Oct 23" this year, else "Oct 23, 2024".
    func listTime(_ ms: EpochMs, now: Date = Date()) -> String {
        let d = date(ms)
        if calendar.isDate(d, inSameDayAs: now) { return format("h:mm a", template: "jmm", d) }
        let diff = days(from: d, to: now)
        if diff > 0 && diff < 7 { return format("EEE", template: "EEE", d) }
        if calendar.component(.year, from: d) == calendar.component(.year, from: now) { return format("MMM d", template: "MMMd", d) }
        return format("MMM d, yyyy", template: "yMMMd", d)
    }

    /// "just now", "12 min ago", "2h ago", "yesterday", "3 days ago", then the date. A future time reads as "just now".
    func ago(_ ms: EpochMs, now: Date = Date()) -> String {
        let nowMs = Int((now.timeIntervalSince1970 * 1000).rounded())
        let minutes = Int((Double(nowMs - ms) / 60_000).rounded(.down))
        if minutes < 1 { return String(localized: "just now", table: "Shared") }
        if minutes < 60 { return String(localized: "\(minutes) min ago", table: "Shared") }
        let d = date(ms)
        let diff = days(from: d, to: now)
        if diff == 0 || minutes < 6 * 60 {
            let hours = minutes / 60
            return String(localized: "\(hours)h ago", table: "Shared")
        }
        if diff == 1 { return String(localized: "yesterday", table: "Shared") }
        if diff < 7 { return String(localized: "\(diff) days ago", table: "Shared") }
        let sameYear = calendar.component(.year, from: d) == calendar.component(.year, from: now)
        return sameYear ? format("MMM d", template: "MMMd", d) : format("MMM d, yyyy", template: "yMMMd", d)
    }

    /// Message header time: "Oct 23, 2026, 3:49 PM".
    func fullDate(_ ms: EpochMs) -> String {
        format("MMM d, yyyy, h:mm a", template: "yMMMdjmm", date(ms))
    }

    /// Group label for list sections, upper case: TODAY, YESTERDAY, THIS WEEK, LAST WEEK, a month, or a year.
    func dateGroupLabel(_ ms: EpochMs, now: Date = Date()) -> String {
        let d = date(ms)
        if calendar.isDate(d, inSameDayAs: now) { return String(localized: "Today", table: "Shared").uppercased(with: locale) }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now), calendar.isDate(d, inSameDayAs: yesterday) {
            return String(localized: "Yesterday", table: "Shared").uppercased(with: locale)
        }
        var monday = Calendar(identifier: calendar.identifier)
        monday.timeZone = calendar.timeZone
        monday.firstWeekday = 2
        let weekStart = monday.dateInterval(of: .weekOfYear, for: now)?.start ?? calendar.startOfDay(for: now)
        if d >= weekStart { return String(localized: "This week", table: "Shared").uppercased(with: locale) }
        if let lastStart = calendar.date(byAdding: .day, value: -7, to: weekStart), d >= lastStart {
            return String(localized: "Last week", table: "Shared").uppercased(with: locale)
        }
        if calendar.component(.year, from: d) == calendar.component(.year, from: now) {
            return format("MMMM", template: "MMMM", d).uppercased(with: locale)
        }
        return format("yyyy", template: "y", d)
    }
}
