@testable import Flint
import FlintModel
import Foundation
import Testing

@Suite("Invite merge")
struct InviteMergeTests {
    typealias F = InviteFixtures
    private let la = "America/Los_Angeles"

    private func env(now: Int = F.now, zone: String = "America/Los_Angeles") -> InviteMergeEnvironment {
        InviteMergeEnvironment(now: now, ownAddresses: F.own, zone: zone)
    }

    private func version(_ id: Int, _ name: String) -> InviteVersion { InviteVersion(messageId: id, invite: F.parsed(name)) }

    @Test("a first invite for a future event is new and answerable")
    func new() {
        let inv = F.parsed("brand-review-v0.ics")
        let m = InviteMerge.merge(inv, messageId: 1, versions: [], answer: nil, env: env())
        #expect(m.state == .new)
        #expect(m.canAnswer)
        #expect(m.yourResponse == .needsAction)
        #expect(m.changes.isEmpty)
    }

    @Test("a higher SEQUENCE after an earlier invite is an update with what changed")
    func updated() {
        let v0 = version(1, "brand-review-v0.ics")
        let v1 = version(2, "brand-review-v1.ics")
        let m = InviteMerge.merge(v1.invite, messageId: 2, versions: [v0, v1], answer: nil, env: env())
        #expect(m.state == .updated)
        #expect(m.canAnswer)
        let fields = m.changes.map(\.field)
        #expect(fields.contains(.time))
        #expect(fields.contains(.location))
        #expect(fields.contains(.guests))
        let location = m.changes.first { $0.field == .location }
        #expect(location?.before == "Studio 2")
        #expect(location?.after == "Studio 5")
        let guests = m.changes.first { $0.field == .guests }
        #expect(guests?.after == "4 guests, added Ines Duarte")
    }

    @Test("the earlier version points to the newer message")
    func superseded() {
        let v0 = version(1, "brand-review-v0.ics")
        let v1 = version(2, "brand-review-v1.ics")
        let m = InviteMerge.merge(v0.invite, messageId: 1, versions: [v0, v1], answer: nil, env: env())
        #expect(m.state == .superseded)
        #expect(m.newerMessageId == 2)
        #expect(!m.canAnswer)
    }

    @Test("a later CANCEL makes the earlier invite cancelled, and the cancel itself is cancelled")
    func cancelled() {
        let v1 = version(2, "brand-review-v1.ics")
        let cancel = version(3, "brand-review-cancel.ics")
        let earlier = InviteMerge.merge(v1.invite, messageId: 2, versions: [v1, cancel], answer: nil, env: env())
        #expect(earlier.state == .cancelled)
        #expect(!earlier.canAnswer)
        let own = InviteMerge.merge(cancel.invite, messageId: 3, versions: [v1, cancel], answer: nil, env: env())
        #expect(own.state == .cancelled)
        #expect(!own.canAnswer)
    }

    @Test("a REPLY and a PUBLISH cannot be answered")
    func replyAndPublish() {
        let reply = InviteMerge.merge(F.parsed("google-reply.ics"), messageId: 1, versions: [], answer: nil, env: env())
        #expect(reply.state == .reply)
        #expect(!reply.canAnswer)
        let publish = InviteMerge.merge(F.parsed("publish-webinar.ics"), messageId: 1, versions: [], answer: nil, env: env())
        #expect(publish.state == .new)
        #expect(!publish.canAnswer)
    }

    @Test("an event that has ended is past")
    func past() {
        let inv = F.parsed("brand-review-v0.ics")
        let later = inv.end + 60_000
        #expect(InviteMerge.merge(inv, messageId: 1, versions: [], answer: nil, env: env(now: later)).state == .past)
        #expect(InviteMerge.merge(inv, messageId: 1, versions: [], answer: nil, env: env(now: inv.end - 1)).state == .new)
    }

    @Test("the person's own answer wins over the invite's PARTSTAT")
    func answer() {
        let inv = F.parsed("brand-review-v0.ics")
        let recorded = InviteAnswer(response: .tentative, note: nil, sequence: 0, respondedAt: F.now)
        let m = InviteMerge.merge(inv, messageId: 1, versions: [], answer: recorded, env: env())
        #expect(m.yourResponse == .tentative)
    }

    @Test("an invite that carries a newer PARTSTAT than the recorded answer wins")
    func carriedAnswer() {
        var inv = F.parsed("brand-review-v0.ics")
        inv.attendees = inv.attendees.map { var a = $0; if a.isYou { a.response = .declined }; return a }
        inv.dtstamp = F.now + 1000
        let recorded = InviteAnswer(response: .accepted, note: nil, sequence: 0, respondedAt: F.now)
        #expect(InviteMerge.merge(inv, messageId: 1, versions: [], answer: recorded, env: env()).yourResponse == .declined)
    }

    @Test("the organizer cannot answer their own invite")
    func organizer() {
        let m = InviteMerge.merge(F.parsed("brand-review-v0.ics"), messageId: 1, versions: [], answer: nil,
                                  env: InviteMergeEnvironment(now: F.now, ownAddresses: ["mina@northwind.example", "me@example.com"], zone: la))
        #expect(!m.canAnswer)
        #expect(m.yourResponse == .accepted)
    }

    @Test("version order: SEQUENCE, then DTSTAMP, then CANCEL")
    func order() {
        let v0 = F.parsed("brand-review-v0.ics")
        let v1 = F.parsed("brand-review-v1.ics")
        #expect(InviteMerge.compare(v1, v0) > 0)
        var sameSeq = v0
        sameSeq.dtstamp = (v0.dtstamp ?? 0) + 1
        #expect(InviteMerge.compare(sameSeq, v0) > 0)
        var cancel = v0
        cancel.method = .cancel
        #expect(InviteMerge.compare(cancel, v0) > 0)
    }

    @Test("a weekly series whose first occurrence has passed shows the next one")
    func seriesNext() {
        var inv = F.parsed("google-weekly-meet.ics")
        inv.recurrence = InviteRecurrence(summary: "Weekly", rrule: "FREQ=WEEKLY;BYDAY=TU", hasExceptions: false)
        // Tue Oct 27 3 PM PDT is the first occurrence; ask on Wed Oct 28.
        let m = InviteMerge.merge(inv, messageId: 1, versions: [], answer: nil, env: env(now: F.utc(2026, 10, 28, 12)))
        #expect(m.state == .new)
        #expect(m.start == F.utc(2026, 11, 3, 23))
    }

    @Test("a series that has run out is past")
    func seriesEnded() {
        let inv = F.parsed("google-weekly-meet.ics")
        let m = InviteMerge.merge(inv, messageId: 1, versions: [], answer: nil, env: env(now: F.utc(2027, 1, 5)))
        #expect(m.state == .past)
    }

    @Test("an all-day event is not past at 5 PM on its last day west of UTC, and is the next morning")
    func allDayPast() {
        var inv = F.parsed("apple-allday.ics")
        inv.recurrence = nil
        inv.startDate = "2026-10-06"; inv.endDate = "2026-10-07"
        inv.start = F.utc(2026, 10, 6); inv.end = F.utc(2026, 10, 7)
        #expect(InviteMerge.merge(inv, messageId: 1, versions: [], answer: nil, env: env(now: F.utc(2026, 10, 7, 0, 30))).state != .past)
        #expect(InviteMerge.merge(inv, messageId: 1, versions: [], answer: nil, env: env(now: F.utc(2026, 10, 7, 7, 30))).state == .past)
    }

    @Test("an all-day series shows its next occurrence on its own date east of UTC")
    func allDaySeries() {
        var inv = F.parsed("google-weekly-meet.ics")
        inv.allDay = true; inv.timeZone = nil
        inv.start = F.utc(2026, 10, 6); inv.end = F.utc(2026, 10, 7)
        inv.startDate = "2026-10-06"; inv.endDate = "2026-10-07"
        inv.recurrence = InviteRecurrence(summary: "x", rrule: "FREQ=WEEKLY;BYDAY=TU", hasExceptions: false)
        let m = InviteMerge.merge(inv, messageId: 1, versions: [], answer: nil, env: env(now: F.utc(2026, 10, 26, 11), zone: "Europe/Berlin"))
        #expect(m.startDate == "2026-10-27")
        #expect(m.endDate == "2026-10-28")
        #expect(m.start == F.utc(2026, 10, 27))
    }
}

@Suite("Invite format")
struct InviteFormatTests {
    typealias F = InviteFixtures

    @Test("timed events read in the viewer's zone")
    func timed() {
        let text = InviteFormat.when(start: F.utc(2026, 10, 27, 22), end: F.utc(2026, 10, 27, 22, 45), allDay: false, zone: "America/Los_Angeles", now: F.now)
        #expect(text == "Tue, Oct 27, 3 PM to 3:45 PM")
    }

    @Test("a year shows when it is not the current one, and all-day ranges use dates")
    func yearAndAllDay() {
        let later = InviteFormat.when(start: F.utc(2027, 1, 5, 18), end: F.utc(2027, 1, 5, 19), allDay: false, zone: "UTC", now: F.now)
        #expect(later == "Tue, Jan 5, 2027, 6 PM to 7 PM")
        let range = InviteFormat.when(start: F.utc(2026, 11, 12), end: F.utc(2026, 11, 15), allDay: true, zone: "America/Los_Angeles", now: F.now)
        #expect(range == "Thu, Nov 12 to Sat, Nov 14")
        let single = InviteFormat.when(start: F.utc(2026, 11, 12), end: F.utc(2026, 11, 13), allDay: true, zone: "Asia/Tokyo", now: F.now)
        #expect(single == "Thu, Nov 12")
    }

    @Test("durations")
    func durations() {
        #expect(InviteFormat.duration(start: 0, end: 45 * 60_000, allDay: false) == "45 min")
        #expect(InviteFormat.duration(start: 0, end: 90 * 60_000, allDay: false) == "1 hr 30 min")
        #expect(InviteFormat.duration(start: 0, end: 120 * 60_000, allDay: false) == "2 hrs")
        #expect(InviteFormat.duration(start: 0, end: 0, allDay: false) == nil)
        #expect(InviteFormat.duration(start: F.utc(2026, 11, 12), end: F.utc(2026, 11, 15), allDay: true) == "3 days")
    }

    @Test("the organizer's time shows only when their offset differs")
    func organizerTime() {
        let start = F.utc(2026, 11, 2, 23)
        let text = InviteFormat.organizerTime(start: start, end: start + 45 * 60_000, allDay: false, organizerZone: "America/New_York", viewerZone: "America/Los_Angeles")
        #expect(text == "6 to 6:45 PM EST")
        #expect(InviteFormat.organizerTime(start: start, end: start + 3_600_000, allDay: false, organizerZone: "America/Los_Angeles", viewerZone: "America/Los_Angeles") == nil)
        #expect(InviteFormat.organizerTime(start: start, end: start + 3_600_000, allDay: false, organizerZone: "UTC", viewerZone: "America/Los_Angeles") == nil)
    }
}
