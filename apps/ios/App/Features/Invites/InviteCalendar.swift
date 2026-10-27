import EventKit
import Foundation

/// An event ready to be written to the device calendar.
struct CalendarEventDraft: Equatable, Sendable {
    var title: String
    var start: Date
    var end: Date
    var allDay: Bool
    var location: String?
    var notes: String?
    var url: URL?
    var rule: RecurrenceRule?
    var timeZone: String?
}

enum CalendarWriteError: Error, Equatable {
    case denied
    case failed
}

/// Writes one event to the person's calendar. Write-only: Flint never reads the calendar, so it cannot check for duplicates or conflicts.
protocol CalendarWriting: Sendable {
    func add(_ event: CalendarEventDraft) async throws
}

enum CalendarEventDrafts {
    /// The event as the invitation described it. All-day events keep their dates; the end is the last day, as EventKit wants.
    static func draft(from invite: ParsedInvite) -> CalendarEventDraft {
        var start = Date(timeIntervalSince1970: Double(invite.start) / 1000)
        var end = Date(timeIntervalSince1970: Double(invite.end) / 1000)
        if invite.allDay, let first = invite.startDate.flatMap(InviteParser.wall), let after = invite.endDate.flatMap(InviteParser.wall) {
            let calendar = Calendar.current
            start = calendar.date(from: DateComponents(year: first.year, month: first.month, day: first.day)) ?? start
            let exclusive = calendar.date(from: DateComponents(year: after.year, month: after.month, day: after.day)) ?? end
            end = max(start, calendar.date(byAdding: .day, value: -1, to: exclusive) ?? exclusive)
        }
        return CalendarEventDraft(
            title: invite.title, start: start, end: end, allDay: invite.allDay, location: invite.location,
            notes: invite.description, url: (invite.conference?.url ?? invite.url).flatMap(URL.init(string:)),
            rule: invite.recurrence.flatMap { RecurrenceRule($0.rrule) }, timeZone: invite.timeZone)
    }
}

/// EventKit with write-only access: the system asks once, and Flint can add events but not read any.
struct EventKitCalendarWriter: CalendarWriting {
    func add(_ draft: CalendarEventDraft) async throws {
        let store = EKEventStore()
        let granted: Bool
        do { granted = try await store.requestWriteOnlyAccessToEvents() } catch { throw CalendarWriteError.failed }
        guard granted else { throw CalendarWriteError.denied }
        guard let calendar = store.defaultCalendarForNewEvents else { throw CalendarWriteError.failed }
        let event = EKEvent(eventStore: store)
        event.calendar = calendar
        event.title = draft.title
        event.startDate = draft.start
        event.endDate = draft.end
        event.isAllDay = draft.allDay
        event.location = draft.location
        event.notes = draft.notes
        event.url = draft.url
        if let zone = draft.timeZone, !draft.allDay { event.timeZone = TimeZone(identifier: zone) }
        if let rule = draft.rule.flatMap(Self.recurrence) { event.addRecurrenceRule(rule) }
        do { try store.save(event, span: .futureEvents, commit: true) } catch { throw CalendarWriteError.failed }
    }

    /// DAILY, WEEKLY, MONTHLY and YEARLY rules with interval, weekdays, count or end date. Other rules add a single event.
    static func recurrence(_ rule: RecurrenceRule) -> EKRecurrenceRule? {
        let frequencies: [String: EKRecurrenceFrequency] = ["DAILY": .daily, "WEEKLY": .weekly, "MONTHLY": .monthly, "YEARLY": .yearly]
        guard let frequency = frequencies[rule.freq] else { return nil }
        let days = rule.byDay.compactMap { day -> EKRecurrenceDayOfWeek? in
            guard let index = RecurrenceRule.dayCodes.firstIndex(of: day.code), let weekday = EKWeekday(rawValue: index + 1) else { return nil }
            return day.ordinal.map { EKRecurrenceDayOfWeek(weekday, weekNumber: $0) } ?? EKRecurrenceDayOfWeek(weekday)
        }
        var end: EKRecurrenceEnd?
        if let count = rule.count {
            end = EKRecurrenceEnd(occurrenceCount: count)
        } else if let until = rule.until, let wall = InviteParser.wall(until) {
            end = EKRecurrenceEnd(end: Date(timeIntervalSince1970: Double(InviteZones.utcEpoch(wall)) / 1000))
        }
        return EKRecurrenceRule(
            recurrenceWith: frequency, interval: rule.interval, daysOfTheWeek: days.isEmpty ? nil : days,
            daysOfTheMonth: rule.byMonthDay.isEmpty ? nil : rule.byMonthDay.map(NSNumber.init(value:)), monthsOfTheYear: rule.byMonth.isEmpty ? nil : rule.byMonth.map(NSNumber.init(value:)),
            weeksOfTheYear: nil, daysOfTheYear: nil, setPositions: rule.bySetPos.isEmpty ? nil : rule.bySetPos.map(NSNumber.init(value:)), end: end)
    }
}

/// The calendar in the demo mailbox and in UI tests: succeeds without touching the system calendar or asking for permission.
struct DemoCalendarWriter: CalendarWriting {
    func add(_ event: CalendarEventDraft) async throws {}
}
