@testable import Flint
import FlintModel
import Foundation
import Testing

/// Expected strings follow `lib/format.ts` of the desktop app, in en_US and UTC. "Now" is Wednesday 2026-10-21 15:49 UTC.
@Suite("Relative dates")
struct FlintTimeTests {
    private static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        calendar.locale = Locale(identifier: "en_US")
        return calendar
    }()
    private let time = FlintTime(calendar: calendar, locale: Locale(identifier: "en_US"))
    private let now = Date(timeIntervalSince1970: 1_792_597_740) // 2026-10-21T15:49:00Z

    private func ms(_ iso: String) -> EpochMs {
        let formatter = ISO8601DateFormatter()
        return Int(formatter.date(from: iso)!.timeIntervalSince1970 * 1000)
    }

    @Test("list time: today, this week, this year, older")
    func listTime() {
        #expect(time.listTime(ms("2026-10-21T08:05:00Z"), now: now) == "8:05 AM")
        #expect(time.listTime(ms("2026-10-20T23:00:00Z"), now: now) == "Tue")
        #expect(time.listTime(ms("2026-10-15T10:00:00Z"), now: now) == "Thu")
        #expect(time.listTime(ms("2026-10-14T10:00:00Z"), now: now) == "Oct 14")
        #expect(time.listTime(ms("2025-03-02T10:00:00Z"), now: now) == "Mar 2, 2025")
    }

    @Test("ago: just now, minutes, hours, yesterday, days, dates")
    func ago() {
        #expect(time.ago(ms("2026-10-21T15:49:30Z"), now: now) == "just now")
        #expect(time.ago(ms("2026-10-21T15:37:00Z"), now: now) == "12 min ago")
        #expect(time.ago(ms("2026-10-21T13:40:00Z"), now: now) == "2h ago")
        #expect(time.ago(ms("2026-10-20T20:00:00Z"), now: now) == "yesterday")
        #expect(time.ago(ms("2026-10-18T09:00:00Z"), now: now) == "3 days ago")
        #expect(time.ago(ms("2026-09-02T09:00:00Z"), now: now) == "Sep 2")
        #expect(time.ago(ms("2024-09-02T09:00:00Z"), now: now) == "Sep 2, 2024")
    }

    @Test("full date")
    func fullDate() {
        #expect(time.fullDate(ms("2026-10-23T15:49:00Z")) == "Oct 23, 2026, 3:49 PM")
    }

    @Test("group labels: today, yesterday, this week, last week, month, year")
    func groups() {
        #expect(time.dateGroupLabel(ms("2026-10-21T01:00:00Z"), now: now) == "TODAY")
        #expect(time.dateGroupLabel(ms("2026-10-20T01:00:00Z"), now: now) == "YESTERDAY")
        #expect(time.dateGroupLabel(ms("2026-10-19T01:00:00Z"), now: now) == "THIS WEEK") // Monday
        #expect(time.dateGroupLabel(ms("2026-10-13T01:00:00Z"), now: now) == "LAST WEEK")
        #expect(time.dateGroupLabel(ms("2026-09-30T01:00:00Z"), now: now) == "SEPTEMBER")
        #expect(time.dateGroupLabel(ms("2025-09-30T01:00:00Z"), now: now) == "2025")
    }

    @Test("non-English locales use localized patterns")
    func german() {
        let german = FlintTime(calendar: Self.calendar, locale: Locale(identifier: "de_DE"))
        #expect(german.listTime(ms("2026-10-21T08:05:00Z"), now: now) == "08:05")
    }
}
