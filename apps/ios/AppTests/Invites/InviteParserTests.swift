@testable import Flint
import FlintModel
import Foundation
import Testing

@Suite("Invite parser")
struct InviteParserTests {
    typealias F = InviteFixtures

    @Test("Google weekly invite with Meet: event, zone and dtstamp")
    func googleWeekly() {
        let inv = F.parsed("google-weekly-meet.ics")
        #expect(inv.uid == "6mk3qd8c1p2v9rj4tb0h5s7xyz@google.com")
        #expect(inv.method == .request)
        #expect(inv.sequence == 0)
        #expect(inv.recurrenceId == nil)
        #expect(inv.title == "Design sync")
        #expect(!inv.allDay)
        #expect(inv.timeZone == "America/Los_Angeles")
        #expect(inv.source == .google)
        #expect(inv.start == F.utc(2026, 10, 27, 22))
        #expect(inv.end == F.utc(2026, 10, 27, 23))
        #expect(inv.dtstamp == F.utc(2026, 10, 20, 18, 15) + 30_000)
    }

    @Test("the recurrence is summarised in the event's zone")
    func googleRecurrence() {
        let rule = F.parsed("google-weekly-meet.ics").recurrence
        #expect(rule?.summary == "Weekly on Tuesday until Dec 12")
        #expect(rule?.rrule == "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261213T075959Z" || rule?.rrule == "FREQ=WEEKLY;UNTIL=20261213T075959Z;BYDAY=TU")
        #expect(rule?.hasExceptions == false)
    }

    @Test("location is unescaped and the Meet call is found")
    func googleLocationAndMeet() {
        let inv = F.parsed("google-weekly-meet.ics")
        #expect(inv.location == "Room 4B, Northwind HQ, 500 Howard St, San Francisco, CA 94105")
        #expect(inv.conference == InviteConference(kind: .meet, url: "https://meet.google.com/abc-defg-hij", label: "Google Meet", code: "abc-defg-hij", phone: "+1 650-555-0142"))
    }

    @Test("Google's generated join block is dropped from the description")
    func googleDescription() {
        #expect(F.parsed("google-weekly-meet.ics").description == "Weekly design review: roadmap, open questions, and demos.\n\nBring one thing you are stuck on.")
    }

    @Test("guests are read and the person is marked")
    func googleGuests() {
        let inv = F.parsed("google-weekly-meet.ics")
        #expect(inv.organizer == Address(name: "Carla Ortiz", address: "carla@northwind.example"))
        #expect(inv.attendees.count == 6)
        #expect(inv.attendees.map(\.response) == [.accepted, .needsAction, .accepted, .tentative, .declined, .needsAction])
        let sam = inv.attendees.first { $0.address == "sam@northwind.example" }
        #expect(sam?.role == .optional)
        #expect(sam?.response == .declined)
        #expect(inv.attendees.filter(\.isYou).map(\.address) == ["me@example.com"])
        #expect(inv.invitedAs == ParsedInvite.InvitedAs(address: "me@example.com", role: .required, rsvp: true))
    }

    @Test("an update keeps SEQUENCE and the new time")
    func update() {
        let v0 = F.parsed("brand-review-v0.ics")
        let v1 = F.parsed("brand-review-v1.ics")
        #expect(v0.sequence == 0)
        #expect(v1.sequence == 2)
        #expect(v1.uid == v0.uid)
        #expect(v1.start == F.utc(2026, 10, 30, 19))
        #expect(v1.location == "Studio 5")
        #expect(v1.timeZone == "UTC")
    }

    @Test("METHOD:CANCEL is a cancellation")
    func cancel() {
        let inv = F.parsed("brand-review-cancel.ics")
        #expect(inv.method == .cancel)
        #expect(inv.sequence == 3)
    }

    @Test("STATUS:CANCELLED without a METHOD:CANCEL is a cancellation")
    func statusCancelled() {
        let ics = F.fixture("publish-webinar.ics").replacingOccurrences(of: "DTSTAMP:", with: "STATUS:CANCELLED\r\nDTSTAMP:")
        #expect(F.parse(ics)?.method == .cancel)
    }

    @Test("RECURRENCE-ID is normalised to UTC for a single occurrence")
    func instance() {
        let inv = F.parsed("google-instance-update.ics")
        #expect(inv.recurrenceId == "20261103T230000Z")
        #expect(inv.start == F.utc(2026, 11, 4, 0, 30))
        #expect(inv.recurrence == nil)
    }

    @Test("a REPLY names who answered")
    func reply() {
        let inv = F.parsed("google-reply.ics")
        #expect(inv.method == .reply)
        #expect(inv.reply == InviteReplyInfo(from: Address(name: "Carla Ortiz", address: "carla@northwind.example"), response: .accepted, comment: "Happy to join. I will bring the draft."))
        #expect(inv.invitedAs == nil)
    }

    @Test("Outlook: Windows zone name, Zoom call in LOCATION, no description left")
    func outlookZoom() {
        let inv = F.parsed("outlook-zoom.ics")
        #expect(inv.timeZone == "America/Los_Angeles")
        #expect(inv.start == F.utc(2026, 10, 28, 17, 30))
        #expect(inv.source == .outlook)
        #expect(inv.conference == InviteConference(
            kind: .zoom, url: "https://contoso.zoom.us/j/81234567890?pwd=AbCdEf123", label: "Zoom", code: "812 3456 7890", phone: "+1 669 900 6833"))
        #expect(inv.location == nil)
        #expect(inv.description == nil)
        #expect(inv.organizer == Address(name: "Priya Raman", address: "priya.raman@contoso.example"))
    }

    @Test("Teams: Eastern Standard Time after DST ends, quoted CN with a comma, join block removed")
    func outlookTeams() {
        let inv = F.parsed("outlook-teams.ics")
        #expect(inv.timeZone == "America/New_York")
        #expect(inv.start == F.utc(2026, 11, 2, 19))
        #expect(inv.end == F.utc(2026, 11, 2, 20, 30))
        #expect(inv.organizer?.name == "Ellis, Jordan")
        #expect(inv.conference?.kind == .teams)
        #expect(inv.conference?.label == "Microsoft Teams")
        #expect(inv.conference?.code == "245 987 133 410")
        #expect(inv.location == nil)
        #expect(inv.description == "Quarterly planning. Agenda is in the shared doc.")
        #expect(inv.attendees.first { $0.address == "rosa@fabrikam.example" }?.role == .optional)
    }

    @Test("the master of a series with exceptions is the invite")
    func recurringExceptions() {
        let inv = F.parsed("outlook-recurring-exceptions.ics")
        #expect(inv.title == "Standup")
        #expect(inv.sequence == 4)
        #expect(inv.recurrence?.summary == "Every weekday")
        #expect(inv.recurrence?.hasExceptions == true)
        #expect(inv.start == F.utc(2026, 10, 12, 16, 30))
        #expect(inv.location == "Huddle room 2")
    }

    @Test("a VTIMEZONE the file declares itself is used")
    func customTimezone() {
        let inv = F.parsed("custom-vtimezone.ics")
        #expect(inv.start == F.utc(2026, 11, 9, 9))
        #expect(inv.timeZone == nil)
        #expect(inv.invitedAs?.address == "me@example.com")
    }

    @Test("an iCloud all-day, multi-day event with exclusive DTEND")
    func allDay() {
        let inv = F.parsed("apple-allday.ics")
        #expect(inv.allDay)
        #expect(inv.startDate == "2026-11-12")
        #expect(inv.endDate == "2026-11-15")
        #expect(inv.timeZone == nil)
        #expect(inv.source == .apple)
        #expect(inv.start == F.utc(2026, 11, 12))
        #expect(inv.end == F.utc(2026, 11, 15))
        #expect(inv.location == "Lakeview Lodge, Big Bear Lake, CA")
        #expect(inv.attendees.first { $0.address == "hana@icloud.example" }?.role == .chair)
    }

    @Test("a Zoom-generated invite")
    func zoom() {
        let inv = F.parsed("zoom-scheduled.ics")
        #expect(inv.source == .zoom)
        #expect(inv.conference?.kind == .zoom)
        #expect(inv.conference?.code == "987 6543 2101")
        #expect(inv.location == nil)
        #expect(inv.description == nil)
    }

    @Test("a PUBLISH event keeps its URL")
    func publish() {
        let inv = F.parsed("publish-webinar.ics")
        #expect(inv.method == .publish)
        #expect(inv.url == "https://events.example/e/5521337")
        #expect(inv.invitedAs == nil)
        #expect(inv.conference == nil)
        #expect(inv.location == nil)
        #expect(inv.start == F.utc(2026, 11, 18, 18))
    }

    @Test("folded lines and escapes are handled")
    func folded() {
        let inv = F.parsed("folded-crlf.ics")
        #expect(inv.title == "Planning, budget; and a very long title that the sender folded across two lines for good measure")
        #expect(inv.description == "Line one\nLine two with a backslash \\ and a comma, plus unicode café split mid-word")
        #expect(inv.location == "Café Roma, 12 Via Appia")
        #expect(inv.invitedAs?.rsvp == true)
    }

    @Test("a fold inside a UTF-8 sequence is rejoined")
    func foldInsideUTF8() {
        var bytes = Array("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:u\r\nDTSTART:20261201T100000Z\r\nSUMMARY:Caf".utf8)
        let e = Array("é".utf8)
        bytes += [e[0]] + Array("\r\n ".utf8) + [e[1]] + Array("\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n".utf8)
        let inv = InviteParser.parse(Data(bytes), context: InviteParseContext(ownAddresses: [], now: F.now))
        #expect(inv?.title == "Café")
    }

    @Test("junk and calendars without an event give nil")
    func junk() {
        #expect(F.parse("") == nil)
        #expect(F.parse("hello world") == nil)
        #expect(F.parse("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR") == nil)
        #expect(F.parse("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:x\r\nEND:VEVENT\r\nEND:VCALENDAR") == nil)
    }

    @Test("LF-only text, a BOM and a missing DTEND")
    func lenient() {
        let ics = "\u{FEFF}BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:x1\nDTSTART:20261201T100000Z\nSUMMARY:Quick\nEND:VEVENT\nEND:VCALENDAR\n"
        let inv = F.parse(ics)
        #expect(inv?.uid == "x1")
        #expect(inv?.title == "Quick")
        #expect(inv?.start == F.utc(2026, 12, 1, 10))
        #expect(inv?.end == F.utc(2026, 12, 1, 10))
        #expect(inv?.method == .request)
    }

    @Test("DURATION sets the end; a bare all-day event lasts one day")
    func duration() {
        let timed = F.parse("BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:d\nDTSTART:20261201T100000Z\nDURATION:PT45M\nSUMMARY:D\nEND:VEVENT\nEND:VCALENDAR")
        #expect(timed?.end == F.utc(2026, 12, 1, 10, 45))
        let day = F.parse("BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:e\nDTSTART;VALUE=DATE:20261201\nSUMMARY:E\nEND:VEVENT\nEND:VCALENDAR")
        #expect(day?.allDay == true)
        #expect(day?.startDate == "2026-12-01")
        #expect(day?.endDate == "2026-12-02")
    }

    @Test("the person's alias matches case-insensitively; a non-guest has no invitedAs")
    func ownAddress() {
        #expect(F.parsed("google-weekly-meet.ics", own: ["ME@Example.com"]).invitedAs?.address == "me@example.com")
        #expect(F.parsed("google-weekly-meet.ics", own: ["other@example.com"]).invitedAs == nil)
    }

    @Test("EXDATE and RDATE lines list several dates")
    func exdates() {
        let ics = [
            "BEGIN:VCALENDAR", "METHOD:REQUEST", "BEGIN:VEVENT", "UID:ex@example.com", "DTSTAMP:20261001T000000Z",
            "DTSTART:20261006T160000Z", "DTEND:20261006T170000Z", "RRULE:FREQ=WEEKLY;BYDAY=TU", "EXDATE:20261013T160000Z,20261020T160000Z",
            "RDATE:20261015T160000Z", "SUMMARY:Sync", "END:VEVENT", "END:VCALENDAR", "",
        ].joined(separator: "\r\n")
        let rule = F.parse(ics, own: [])?.recurrence
        #expect(rule?.hasExceptions == true)
        #expect(rule?.excluded == [F.utc(2026, 10, 13, 16), F.utc(2026, 10, 20, 16)])
        #expect(rule?.added == [F.utc(2026, 10, 15, 16)])
    }
}
