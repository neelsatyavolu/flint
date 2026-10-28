import Foundation

/// A time offered by the snooze, send later and reminder pickers.
struct TimePreset: Hashable, Sendable, Identifiable {
    enum ID: String, Sendable { case later, tomorrow, weekend, nextWeek }
    let id: ID
    let label: String
    let at: Date
}

/// Port of `resolvePresets` and `formatPresetTime` in the desktop `lib/time.ts`. Pure: pass `now`.
struct SnoozePresets: Sendable {
    var calendar: Calendar
    var locale: Locale

    init(calendar: Calendar = .autoupdatingCurrent, locale: Locale = .autoupdatingCurrent) {
        self.calendar = calendar
        self.locale = locale
    }

    private func at(_ date: Date, hour: Int, minute: Int = 0) -> Date {
        calendar.date(bySettingHour: hour, minute: minute, second: 0, of: date) ?? date
    }

    /// - Later today: three hours out, rounded up to the half hour; dropped when it would pass 22:00 or leave the day.
    /// - Tomorrow morning: tomorrow 8:00.
    /// - This weekend: the coming Saturday 9:00; dropped on Saturday and Sunday.
    /// - Next week: the coming Monday 8:00.
    func resolve(now: Date) -> [TimePreset] {
        var presets: [TimePreset] = []
        let plus3 = now.addingTimeInterval(3 * 3600)
        let parts = calendar.dateComponents([.hour, .minute], from: plus3)
        let minute = parts.minute ?? 0
        let rounded = calendar.date(bySettingHour: parts.hour ?? 0, minute: 0, second: 0, of: plus3).map {
            $0.addingTimeInterval(minute == 0 ? 0 : (minute <= 30 ? 30 : 60) * 60)
        } ?? plus3
        if calendar.isDate(rounded, inSameDayAs: now), calendar.component(.hour, from: rounded) < 22 {
            presets.append(TimePreset(id: .later, label: String(localized: "Later today", table: "Shared"), at: rounded))
        }
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: now) ?? now
        presets.append(TimePreset(id: .tomorrow, label: String(localized: "Tomorrow morning", table: "Shared"), at: at(tomorrow, hour: 8)))

        let weekday = calendar.component(.weekday, from: now) - 1 // 0 Sunday ... 6 Saturday
        if (1...5).contains(weekday), let saturday = calendar.date(byAdding: .day, value: 6 - weekday, to: now) {
            presets.append(TimePreset(id: .weekend, label: String(localized: "This weekend", table: "Shared"), at: at(saturday, hour: 9)))
        }
        let toMonday = ((8 - weekday) % 7) == 0 ? 7 : (8 - weekday) % 7
        if let monday = calendar.date(byAdding: .day, value: toMonday, to: now) {
            presets.append(TimePreset(id: .nextWeek, label: String(localized: "Next week", table: "Shared"), at: at(monday, hour: 8)))
        }
        return presets
    }

    /// The resolved time shown at the right of a preset: "6:00 PM" today, "Tue 8:00 AM" within a week, else "Nov 3, 8:00 AM".
    func formatTime(_ date: Date, now: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        let english = locale.language.languageCode?.identifier == "en"
        if calendar.isDate(date, inSameDayAs: now) {
            if english { formatter.dateFormat = "h:mm a" } else { formatter.setLocalizedDateFormatFromTemplate("jmm") }
            return formatter.string(from: date)
        }
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: date)).day ?? 0
        if days > 0 && days < 7 {
            if english { formatter.dateFormat = "EEE h:mm a" } else { formatter.setLocalizedDateFormatFromTemplate("EEEjmm") }
        } else {
            if english { formatter.dateFormat = "MMM d, h:mm a" } else { formatter.setLocalizedDateFormatFromTemplate("MMMdjmm") }
        }
        return formatter.string(from: date)
    }
}
