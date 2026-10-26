@testable import Flint
import Foundation
import Testing

/// Cases follow `resolvePresets` and `formatPresetTime` in the desktop `lib/time.ts`.
@Suite("Snooze presets")
struct SnoozePresetsTests {
    private static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()
    private let presets = SnoozePresets(calendar: calendar, locale: Locale(identifier: "en_US"))

    private func date(_ iso: String) -> Date { ISO8601DateFormatter().date(from: iso)! }
    private func ids(_ now: String) -> [TimePreset.ID] { presets.resolve(now: date(now)).map(\.id) }

    @Test("a Wednesday morning offers all four")
    func wednesday() {
        let result = presets.resolve(now: date("2026-10-21T09:10:00Z"))
        #expect(result.map(\.id) == [.later, .tomorrow, .weekend, .nextWeek])
        #expect(result[0].at == date("2026-10-21T12:30:00Z"))
        #expect(result[1].at == date("2026-10-22T08:00:00Z"))
        #expect(result[2].at == date("2026-10-24T09:00:00Z"))
        #expect(result[3].at == date("2026-10-26T08:00:00Z"))
    }

    @Test("later today rounds up to the half hour and is dropped after 22:00 or past midnight")
    func later() {
        #expect(presets.resolve(now: date("2026-10-21T09:00:00Z")).first?.at == date("2026-10-21T12:00:00Z"))
        #expect(presets.resolve(now: date("2026-10-21T09:45:00Z")).first?.at == date("2026-10-21T13:00:00Z"))
        #expect(!ids("2026-10-21T19:30:00Z").contains(.later))
        #expect(!ids("2026-10-21T21:30:00Z").contains(.later))
    }

    @Test("the weekend preset is dropped on Saturday and Sunday")
    func weekend() {
        #expect(!ids("2026-10-24T09:00:00Z").contains(.weekend))
        #expect(!ids("2026-10-25T09:00:00Z").contains(.weekend))
        #expect(ids("2026-10-23T09:00:00Z").contains(.weekend)) // Friday
    }

    @Test("next week is the coming Monday, even on a Monday")
    func nextWeek() {
        #expect(presets.resolve(now: date("2026-10-26T09:00:00Z")).last?.at == date("2026-11-02T08:00:00Z"))
        #expect(presets.resolve(now: date("2026-10-25T09:00:00Z")).last?.at == date("2026-10-26T08:00:00Z"))
    }

    @Test("resolved time text")
    func format() {
        let now = date("2026-10-21T09:00:00Z")
        #expect(presets.formatTime(date("2026-10-21T18:00:00Z"), now: now) == "6:00 PM")
        #expect(presets.formatTime(date("2026-10-22T08:00:00Z"), now: now) == "Thu 8:00 AM")
        #expect(presets.formatTime(date("2026-11-03T08:00:00Z"), now: now) == "Nov 3, 8:00 AM")
    }
}
