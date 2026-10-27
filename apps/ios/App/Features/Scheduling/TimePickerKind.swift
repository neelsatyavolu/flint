import Foundation

/// One row of the time picker: a resolved time with its label.
struct PickerOption: Hashable, Identifiable, Sendable {
    let id: String
    let label: String
    let at: Date
}

/// What the one time picker is asked for. Snooze, send later and "remind me if no reply" share the sheet, the rows and the
/// custom date and time; only the presets, the words and the earliest time differ.
enum TimePickerKind: Hashable, Sendable {
    case snooze, sendLater, reminder

    var title: String {
        switch self {
        case .snooze: String(localized: "Snooze until", table: "Scheduling")
        case .sendLater: String(localized: "Send later", table: "Scheduling")
        case .reminder: String(localized: "Remind me if no reply in", table: "Scheduling")
        }
    }

    var confirmTitle: String {
        switch self {
        case .snooze: String(localized: "Snooze", table: "Scheduling")
        case .sendLater: String(localized: "Schedule", table: "Scheduling")
        case .reminder: String(localized: "Set reminder", table: "Scheduling")
        }
    }

    var customTitle: String {
        switch self {
        case .reminder: String(localized: "Pick a time", table: "Scheduling")
        case .snooze, .sendLater: String(localized: "Pick a date and time", table: "Scheduling")
        }
    }

    /// The honest limit of send later on iOS, shown above the presets.
    var footnote: String? {
        switch self {
        case .sendLater:
            String(localized: "Sends when Flint can run. If iOS doesn't let Flint run then, you get a reminder and it sends when you open Flint.", table: "Scheduling")
        case .reminder:
            String(localized: "Flint reminds you if nothing came back by then.", table: "Scheduling")
        case .snooze: nil
        }
    }

    /// The earliest time the custom picker allows.
    func earliest(now: Date) -> Date {
        switch self {
        case .snooze: now
        case .sendLater, .reminder: now.addingTimeInterval(60)
        }
    }

    /// Where the custom picker starts.
    func initialCustom(now: Date, calendar: Calendar = .autoupdatingCurrent) -> Date {
        let component: Calendar.Component = self == .sendLater ? .hour : .day
        let value = self == .reminder ? 3 : 1
        return calendar.date(byAdding: component, value: value, to: now) ?? now
    }

    func options(now: Date, calendar: Calendar = .autoupdatingCurrent, locale: Locale = .autoupdatingCurrent) -> [PickerOption] {
        switch self {
        case .snooze, .sendLater:
            SnoozePresets(calendar: calendar, locale: locale).resolve(now: now).map { PickerOption(id: $0.id.rawValue, label: $0.label, at: $0.at) }
        case .reminder:
            FollowUpPresets.resolve(now: now)
        }
    }
}

/// "Remind me if no reply in" presets, measured from now. Port of `reminderPresets` in the desktop `compose/reminders.ts`.
enum FollowUpPresets {
    private static let day: TimeInterval = 86_400

    static func resolve(now: Date) -> [PickerOption] {
        [
            PickerOption(id: "day", label: String(localized: "1 day", table: "Scheduling"), at: now.addingTimeInterval(day)),
            PickerOption(id: "days3", label: String(localized: "3 days", table: "Scheduling"), at: now.addingTimeInterval(3 * day)),
            PickerOption(id: "week", label: String(localized: "1 week", table: "Scheduling"), at: now.addingTimeInterval(7 * day)),
        ]
    }
}
