@testable import Flint
import FlintModel
import Foundation
import Testing

@Suite("iMIP reply")
struct ImipReplyTests {
    typealias F = InviteFixtures
    private let now = F.utc(2026, 10, 25, 18, 30) + 5000
    private let start = F.utc(2026, 10, 27, 22)
    private let me = Address(name: "Neel Rao", address: "me@example.com")

    private func invite(_ change: (inout ParsedInvite) -> Void = { _ in }) -> ParsedInvite {
        var inv = ParsedInvite(
            uid: "7f3k2a9d8c@google.com", method: .request, sequence: 2, recurrenceId: nil, title: "Design sync", description: nil,
            start: start, end: start + 3_600_000, allDay: false, startDate: nil, endDate: nil, timeZone: "America/Los_Angeles",
            recurrence: nil, location: nil, url: nil, conference: nil, organizer: Address(name: "Dana Whitfield", address: "dana@northwind.example"),
            attendees: [], invitedAs: .init(address: "me@example.com", role: .required, rsvp: true), dtstamp: nil, source: .google, reply: nil)
        change(&inv)
        return inv
    }

    private func build(_ change: (inout ParsedInvite) -> Void = { _ in }, answer: RSVPAnswer = .accepted, note: String? = nil) throws -> ImipReply {
        try ImipBuilder.reply(invite: invite(change), attendee: me, answer: answer, note: note, now: now)
    }

    @Test("a byte-exact METHOD:REPLY calendar part")
    func exact() throws {
        let r = try build()
        let expected = [
            "BEGIN:VCALENDAR", "PRODID:-//Flint//Flint Mail//EN", "VERSION:2.0", "CALSCALE:GREGORIAN", "METHOD:REPLY", "BEGIN:VEVENT",
            "UID:7f3k2a9d8c@google.com", "SEQUENCE:2", "DTSTAMP:20261025T183005Z", "DTSTART:20261027T220000Z", "DTEND:20261027T230000Z",
            "ORGANIZER;CN=Dana Whitfield:mailto:dana@northwind.example",
            "ATTENDEE;CN=Neel Rao;PARTSTAT=ACCEPTED:mailto:me@example.com",
            "SUMMARY:Design sync", "END:VEVENT", "END:VCALENDAR", "",
        ].joined(separator: "\r\n")
        #expect(r.ics == expected)
        #expect(r.to == Address(name: "Dana Whitfield", address: "dana@northwind.example"))
        #expect(r.subject == "Accepted: Design sync")
        #expect(r.uid == "7f3k2a9d8c@google.com")
    }

    @Test("answers map to PARTSTAT and subject prefixes")
    func partstat() throws {
        let maybe = try build(answer: .tentative)
        #expect(maybe.ics.contains("PARTSTAT=TENTATIVE"))
        #expect(maybe.subject == "Tentative: Design sync")
        let no = try build(answer: .declined)
        #expect(no.ics.contains("PARTSTAT=DECLINED"))
        #expect(no.subject == "Declined: Design sync")
    }

    @Test("RECURRENCE-ID is copied: UTC, zoned local, date only")
    func recurrenceId() throws {
        #expect(try build({ $0.recurrenceId = "20261027T220000Z" }).ics.contains("\r\nRECURRENCE-ID:20261027T220000Z\r\n"))
        #expect(try build({ $0.recurrenceId = "20261027T150000" }).ics.contains("\r\nRECURRENCE-ID;TZID=America/Los_Angeles:20261027T150000\r\n"))
        #expect(try build({ $0.recurrenceId = "20261027" }).ics.contains("\r\nRECURRENCE-ID;VALUE=DATE:20261027\r\n"))
        #expect(try !build().ics.contains("RECURRENCE-ID"))
    }

    @Test("all-day events use DATE values")
    func allDay() throws {
        let r = try build {
            $0.allDay = true; $0.startDate = "2026-10-27"; $0.endDate = "2026-10-29"
            $0.start = F.utc(2026, 10, 27); $0.end = F.utc(2026, 10, 29)
        }
        #expect(r.ics.contains("DTSTART;VALUE=DATE:20261027\r\nDTEND;VALUE=DATE:20261029\r\n"))
        #expect(r.text.contains("2026-10-27 to 2026-10-28"))
    }

    @Test("title and note are escaped and folded at 75 octets without splitting UTF-8")
    func escapeAndFold() throws {
        let note = "Can't wait, really; see you\nthere \\o/ " + String(repeating: "é", count: 60)
        let r = try build({ $0.title = "Q4 plan, v2; draft" }, note: note)
        #expect(r.ics.contains("SUMMARY:Q4 plan\\, v2\\; draft\r\n"))
        for line in r.ics.components(separatedBy: "\r\n") { #expect(line.utf8.count <= 75) }
        let unfolded = r.ics.replacingOccurrences(of: "\r\n ", with: "")
        #expect(unfolded.contains("COMMENT:Can't wait\\, really\\; see you\\nthere \\\\o/ " + String(repeating: "é", count: 60) + "\r\n"))
    }

    @Test("a CN with special characters is quoted and loses double quotes")
    func quotedCN() throws {
        let r = try ImipBuilder.reply(
            invite: invite(), attendee: Address(name: "Rao, Neel \"N\"", address: "me@example.com"), answer: .accepted, note: nil, now: now)
        #expect(r.ics.contains("ATTENDEE;CN=\"Rao, Neel 'N'\";PARTSTAT=ACCEPTED:mailto:me@example.com"))
    }

    @Test("an invitation without an organizer cannot be answered")
    func noOrganizer() {
        #expect(throws: ImipError.noOrganizer) { try build { $0.organizer = nil } }
    }

    @Test("the plain and HTML bodies carry the lead, the time and the note, with no images or links")
    func bodies() throws {
        let r = try build(note: "Running 5 min late <b>")
        #expect(r.text.contains("Neel Rao accepted this invitation."))
        #expect(r.text.contains("Running 5 min late <b>"))
        #expect(r.text.contains("When: Tue, Oct 27, 2026, 3 PM to 4 PM (America/Los_Angeles)"))
        #expect(r.html.contains("Running 5 min late &lt;b&gt;"))
        #expect(!r.html.contains("<img"))
        #expect(!r.html.contains("http"))
    }

    @Test("the card's reply parses back as an accepted REPLY")
    func roundTrip() throws {
        let r = try build()
        let parsed = F.parse(r.ics, own: [])
        #expect(parsed?.method == .reply)
        #expect(parsed?.reply?.response == .accepted)
        #expect(parsed?.uid == "7f3k2a9d8c@google.com")
    }
}
