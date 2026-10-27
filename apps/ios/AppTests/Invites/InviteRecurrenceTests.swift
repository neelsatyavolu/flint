@testable import Flint
import Foundation
import Testing

@Suite("Invite recurrence")
struct InviteRecurrenceTests {
    typealias F = InviteFixtures
    private let tue = Wall(year: 2026, month: 10, day: 27, hour: 15)
    private let la = "America/Los_Angeles"

    @Test("summaries", arguments: [
        ("FREQ=DAILY", "Daily"),
        ("FREQ=DAILY;INTERVAL=3", "Every 3 days"),
        ("FREQ=WEEKLY", "Weekly on Tuesday"),
        ("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "Every weekday"),
        ("FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH,FR,SA", "Daily"),
        ("FREQ=WEEKLY;BYDAY=TU,TH", "Weekly on Tuesday and Thursday"),
        ("FREQ=WEEKLY;BYDAY=MO,WE,FR", "Weekly on Monday, Wednesday and Friday"),
        ("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE", "Every 2 weeks on Monday and Wednesday"),
        ("FREQ=WEEKLY;BYDAY=SU,SA", "Weekly on Saturday and Sunday"),
        ("FREQ=MONTHLY;BYMONTHDAY=3", "Monthly on the 3rd"),
        ("FREQ=MONTHLY;BYMONTHDAY=22", "Monthly on the 22nd"),
        ("FREQ=MONTHLY;BYMONTHDAY=11", "Monthly on the 11th"),
        ("FREQ=MONTHLY;BYMONTHDAY=-1", "Monthly on the last day"),
        ("FREQ=MONTHLY;BYDAY=3FR", "Monthly on the third Friday"),
        ("FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1", "Monthly on the last Friday"),
        ("FREQ=MONTHLY", "Monthly on the 27th"),
        ("FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=1", "Every 3 months on the 1st"),
        ("FREQ=YEARLY", "Yearly on Oct 27"),
        ("FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=9", "Yearly on Mar 9"),
        ("FREQ=YEARLY;BYMONTH=11;BYDAY=4TH", "Yearly on the fourth Thursday of November"),
        ("FREQ=WEEKLY;COUNT=10", "Weekly on Tuesday, 10 times"),
        ("FREQ=DAILY;COUNT=1", "Daily, once"),
        ("FREQ=WEEKLY;BYDAY=TU;UNTIL=20261212", "Weekly on Tuesday until Dec 12"),
        ("FREQ=WEEKLY;BYDAY=TU;UNTIL=20270105T235959Z", "Weekly on Tuesday until Jan 5, 2027"),
        ("RRULE:FREQ=DAILY", "Daily"),
        ("nonsense", "Repeats"),
    ])
    func summaries(rule: String, expected: String) {
        #expect(InviteRecurrenceMath.summary(rule, start: tue, zone: la) == expected)
    }

    @Test("a UTC UNTIL moves into the event's zone")
    func untilZone() {
        #expect(InviteRecurrenceMath.summary("FREQ=WEEKLY;UNTIL=20261213T075959Z", start: tue, zone: la) == "Weekly on Tuesday until Dec 12")
        #expect(InviteRecurrenceMath.summary("FREQ=WEEKLY;UNTIL=20261213T075959Z", start: tue, zone: "UTC") == "Weekly on Tuesday until Dec 13")
    }

    @Test("next occurrence: still ahead, and the next week across a DST change")
    func next() {
        #expect(InviteRecurrenceMath.nextOccurrence("FREQ=WEEKLY;BYDAY=TU", start: tue, zone: la, after: F.utc(2026, 10, 1)) == F.utc(2026, 10, 27, 22))
        #expect(InviteRecurrenceMath.nextOccurrence("FREQ=WEEKLY;BYDAY=TU", start: tue, zone: la, after: F.utc(2026, 11, 2)) == F.utc(2026, 11, 3, 23))
    }

    @Test("a COUNT series ends")
    func countEnds() {
        #expect(InviteRecurrenceMath.nextOccurrence("FREQ=WEEKLY;COUNT=2", start: tue, zone: la, after: F.utc(2027, 1, 1)) == nil)
    }

    @Test("excluded and added instants")
    func excludedAdded() {
        let wall = Wall(year: 2026, month: 10, day: 6, hour: 9)
        let after = F.utc(2026, 10, 7)
        let second = InviteRecurrenceMath.nextOccurrence("FREQ=WEEKLY;BYDAY=TU", start: wall, zone: "UTC", after: after)!
        #expect(InviteRecurrenceMath.nextOccurrence("FREQ=WEEKLY;BYDAY=TU", start: wall, zone: "UTC", after: after, excluded: [second]) == second + 7 * 86_400_000)
        #expect(InviteRecurrenceMath.nextOccurrence("FREQ=WEEKLY;BYDAY=TU", start: wall, zone: "UTC", after: after, added: [after + 86_400_000]) == after + 86_400_000)
    }

    @Test("monthly by weekday and daily rules expand")
    func monthlyDaily() {
        let wall = Wall(year: 2026, month: 10, day: 16, hour: 10)
        // Third Friday of November 2026 is the 20th.
        #expect(InviteRecurrenceMath.nextOccurrence("FREQ=MONTHLY;BYDAY=3FR", start: wall, zone: "UTC", after: F.utc(2026, 10, 17)) == F.utc(2026, 11, 20, 10))
        #expect(InviteRecurrenceMath.nextOccurrence("FREQ=DAILY;INTERVAL=2", start: wall, zone: "UTC", after: F.utc(2026, 10, 17)) == F.utc(2026, 10, 18, 10))
    }

    @Test("series end from UNTIL and from COUNT")
    func seriesEnd() {
        #expect(InviteRecurrenceMath.seriesEnd("FREQ=WEEKLY", start: tue, zone: la, duration: 3_600_000) == nil)
        #expect(InviteRecurrenceMath.seriesEnd("FREQ=WEEKLY;UNTIL=20261213T075959Z", start: tue, zone: la, duration: 0) == F.utc(2026, 12, 13, 7, 59) + 59_000)
        #expect(InviteRecurrenceMath.seriesEnd("FREQ=WEEKLY;COUNT=3", start: tue, zone: la, duration: 3_600_000) == F.utc(2026, 11, 10, 23) + 3_600_000)
    }
}
