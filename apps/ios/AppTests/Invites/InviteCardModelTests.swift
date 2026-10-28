@testable import Flint
import FlintModel
import Foundation
import Testing

/// Records what the card asked of the rest of the app.
actor InviteSpy {
    private(set) var fetched: [Int] = []
    private(set) var replies: [(reply: ImipReply, account: AccountID, from: String)] = []
    private(set) var events: [CalendarEventDraft] = []

    func fetch(_ id: Int) { fetched.append(id) }
    func send(_ reply: ImipReply, _ account: AccountID, _ from: String) { replies.append((reply, account, from)) }
    func add(_ event: CalendarEventDraft) { events.append(event) }
}

struct SpyCalendar: CalendarWriting {
    let spy: InviteSpy
    var failure: CalendarWriteError?
    func add(_ event: CalendarEventDraft) async throws {
        if let failure { throw failure }
        await spy.add(event)
    }
}

@MainActor
enum InviteModelFixtures {
    typealias F = InviteFixtures

    static func message(_ id: Int, ics: String?, account: AccountID = "a1") -> MessageView {
        MessageView(
            id: id, accountId: account, threadId: 1, from: [Address(name: "Mina Okafor", address: "mina@northwind.example")],
            to: [Address(address: "me@example.com")], subject: "Invitation", date: 0, seen: true,
            attachments: ics == nil ? [] : [AttachmentInfo(id: id * 10, filename: "invite.ics", contentType: "text/calendar", size: ics?.utf8.count ?? 0)])
    }

    /// Services that serve `files` by attachment id (message id times ten), with the clock fixed at the desktop's test date.
    static func services(
        files: [Int: String], spy: InviteSpy, ledger: InviteLedger = InviteLedger(), sendOK: Bool = true,
        calendar: CalendarWriteError? = nil, now: Int = F.now
    ) -> InviteServices {
        InviteServices(
            fetchAttachment: { id in
                await spy.fetch(id)
                guard let text = files[id] else { throw CalendarWriteError.failed }
                return Data(text.utf8)
            },
            sendReply: { reply, account, from in
                if sendOK { await spy.send(reply, account, from) }
                return sendOK
            },
            calendar: SpyCalendar(spy: spy, failure: calendar), ledger: ledger, now: { now }, zone: { "America/Los_Angeles" })
    }
}

@MainActor
@Suite("Invite card model")
struct InviteCardModelTests {
    typealias F = InviteFixtures
    typealias M = InviteModelFixtures

    private let v0 = F.fixture("brand-review-v0.ics")
    private let v1 = F.fixture("brand-review-v1.ics")
    private let cancel = F.fixture("brand-review-cancel.ics")

    private func load(
        _ model: InviteCardModel, message: MessageView, thread: [MessageView], files: [Int: String], spy: InviteSpy,
        ledger: InviteLedger = InviteLedger(), sendOK: Bool = true, calendar: CalendarWriteError? = nil
    ) async -> InviteServices {
        let services = M.services(files: files, spy: spy, ledger: ledger, sendOK: sendOK, calendar: calendar)
        await model.load(message: message, thread: thread, accountName: "Neel Rao", ownAddresses: F.own, services: services)
        return services
    }

    @Test("a message without a calendar part shows no card and fetches nothing")
    func noCalendar() async {
        let spy = InviteSpy()
        let model = InviteCardModel()
        let plain = M.message(1, ics: nil)
        _ = await load(model, message: plain, thread: [plain], files: [:], spy: spy)
        #expect(model.merged == nil)
        #expect(await spy.fetched.isEmpty)
    }

    @Test("a new invite loads with its time and an open answer")
    func newInvite() async {
        let spy = InviteSpy()
        let model = InviteCardModel()
        let m = M.message(1, ics: v0)
        _ = await load(model, message: m, thread: [m], files: [10: v0], spy: spy)
        #expect(model.merged?.state == .new)
        #expect(model.merged?.canAnswer == true)
        #expect(model.merged?.yourResponse == .needsAction)
        #expect(model.times?.when == "Thu, Oct 29, 10 AM to 11 AM")
        #expect(model.times?.duration == "1 hr")
    }

    @Test("an update beside the original in the thread says what changed")
    func updateInThread() async {
        let spy = InviteSpy()
        let model = InviteCardModel()
        let first = M.message(1, ics: v0)
        let second = M.message(2, ics: v1)
        _ = await load(model, message: second, thread: [first, second], files: [10: v0, 20: v1], spy: spy)
        #expect(model.merged?.state == .updated)
        #expect(model.merged?.changes.contains { $0.field == .location && $0.after == "Studio 5" } == true)
        let earlier = InviteCardModel()
        _ = await load(earlier, message: first, thread: [first, second], files: [10: v0, 20: v1], spy: spy, ledger: InviteLedger())
        #expect(earlier.merged?.state == .superseded)
    }

    @Test("a cancellation in the thread cancels the earlier card")
    func cancelInThread() async {
        let spy = InviteSpy()
        let model = InviteCardModel()
        let first = M.message(2, ics: v1)
        let gone = M.message(3, ics: cancel)
        _ = await load(model, message: first, thread: [first, gone], files: [20: v1, 30: cancel], spy: spy)
        #expect(model.merged?.state == .cancelled)
        #expect(model.merged?.canAnswer == false)
    }

    @Test("versions seen before are reused instead of fetched again")
    func reuse() async {
        let spy = InviteSpy()
        let ledger = InviteLedger()
        let m = M.message(1, ics: v0)
        _ = await load(InviteCardModel(), message: m, thread: [m], files: [10: v0], spy: spy, ledger: ledger)
        _ = await load(InviteCardModel(), message: m, thread: [m], files: [10: v0], spy: spy, ledger: ledger)
        #expect(await spy.fetched == [10])
    }

    @Test("a calendar part that cannot be read leaves no card")
    func unreadable() async {
        let spy = InviteSpy()
        let model = InviteCardModel()
        let m = M.message(1, ics: "x")
        _ = await load(model, message: m, thread: [m], files: [10: "not a calendar"], spy: spy)
        #expect(model.merged == nil)
    }

    @Test("answering sends an iMIP reply from the invited address and shows the new answer")
    func answer() async {
        let spy = InviteSpy()
        let model = InviteCardModel()
        let m = M.message(1, ics: v0)
        let services = await load(model, message: m, thread: [m], files: [10: v0], spy: spy)
        model.note = "  See you there  "
        await model.answer(.tentative, services: services)
        let sent = await spy.replies
        #expect(sent.count == 1)
        #expect(sent.first?.account == "a1")
        #expect(sent.first?.from == "me@example.com")
        #expect(sent.first?.reply.to.address == "mina@northwind.example")
        #expect(sent.first?.reply.subject == "Tentative: Brand review")
        #expect(sent.first?.reply.ics.contains("PARTSTAT=TENTATIVE") == true)
        #expect(sent.first?.reply.ics.contains("COMMENT:See you there") == true)
        #expect(model.merged?.yourResponse == .tentative)
        #expect(model.note.isEmpty)
        #expect(model.sending == nil)
    }

    @Test("an answer that could not be queued changes nothing")
    func answerFails() async {
        let spy = InviteSpy()
        let model = InviteCardModel()
        let m = M.message(1, ics: v0)
        let services = await load(model, message: m, thread: [m], files: [10: v0], spy: spy, sendOK: false)
        model.note = "keep me"
        await model.answer(.accepted, services: services)
        #expect(model.merged?.yourResponse == .needsAction)
        #expect(model.note == "keep me")
        #expect(services.ledger.snapshot.answers.isEmpty)
    }

    @Test("a cancelled invite takes no answer")
    func noAnswerWhenCancelled() async {
        let spy = InviteSpy()
        let model = InviteCardModel()
        let m = M.message(3, ics: cancel)
        let services = await load(model, message: m, thread: [m], files: [30: cancel], spy: spy)
        await model.answer(.accepted, services: services)
        #expect(await spy.replies.isEmpty)
    }

    @Test("Add to Calendar writes the event once and remembers it")
    func addToCalendar() async {
        let spy = InviteSpy()
        let ledger = InviteLedger()
        let model = InviteCardModel()
        let m = M.message(1, ics: v0)
        let services = await load(model, message: m, thread: [m], files: [10: v0], spy: spy, ledger: ledger)
        await model.addToCalendar(services: services)
        #expect(model.calendar == .added)
        let events = await spy.events
        #expect(events.count == 1)
        #expect(events.first?.title == "Brand review")
        #expect(events.first?.location == "Studio 2")
        #expect(events.first?.start == Date(timeIntervalSince1970: Double(F.utc(2026, 10, 29, 17)) / 1000))
        let reopened = InviteCardModel()
        _ = await load(reopened, message: m, thread: [m], files: [10: v0], spy: spy, ledger: ledger)
        #expect(reopened.calendar == .added)
    }

    @Test("a denied calendar says so and can be tried again")
    func calendarDenied() async {
        let spy = InviteSpy()
        let model = InviteCardModel()
        let m = M.message(1, ics: v0)
        let services = await load(model, message: m, thread: [m], files: [10: v0], spy: spy, calendar: .denied)
        await model.addToCalendar(services: services)
        #expect(model.calendar == .failed(.denied))
        #expect(await spy.events.isEmpty)
    }
}

@MainActor
@Suite("Invite ledger")
struct InviteLedgerTests {
    typealias F = InviteFixtures

    @Test("answers, versions and calendar marks survive a restart")
    func persists() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("invites-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: url) }
        let invite = F.parsed("brand-review-v0.ics")
        let key = invite.eventKey(account: "a1")
        let first = InviteLedger(fileURL: url)
        first.record(invite, messageId: 7, account: "a1")
        first.setAnswer(InviteAnswer(response: .accepted, note: "ok", sequence: 0, respondedAt: 5), forKey: key)
        first.markAdded(sequence: 0, forKey: key)
        let second = InviteLedger(fileURL: url)
        #expect(second.version(messageId: 7)?.invite == invite)
        #expect(second.answer(forKey: key)?.response == .accepted)
        #expect(second.addedSequence(forKey: key) == 0)
    }

    @Test("a damaged file is dropped, not fatal")
    func damaged() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("invites-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: url) }
        try Data("{ nope".utf8).write(to: url)
        let ledger = InviteLedger(fileURL: url)
        #expect(ledger.snapshot.versions.isEmpty)
    }

    @Test("the ledger stays bounded and forgets the oldest event with its answer")
    func bounded() {
        let ledger = InviteLedger()
        var first = F.parsed("brand-review-v0.ics")
        first.uid = "first"
        ledger.record(first, messageId: 1, account: "a")
        ledger.setAnswer(InviteAnswer(response: .accepted, note: nil, sequence: 0, respondedAt: 1), forKey: first.eventKey(account: "a"))
        for n in 0..<InviteLedger.maxEvents {
            var other = first
            other.uid = "event-\(n)"
            ledger.record(other, messageId: 100 + n, account: "a")
        }
        #expect(ledger.snapshot.order.count == InviteLedger.maxEvents)
        #expect(ledger.version(messageId: 1) == nil)
        #expect(ledger.answer(forKey: first.eventKey(account: "a")) == nil)
    }
}

@Suite("Calendar event draft")
struct CalendarEventDraftTests {
    typealias F = InviteFixtures

    @Test("a timed event keeps its instants, location, notes and call link")
    func timed() {
        let draft = CalendarEventDrafts.draft(from: F.parsed("google-weekly-meet.ics"))
        #expect(draft.title == "Design sync")
        #expect(draft.start == Date(timeIntervalSince1970: Double(F.utc(2026, 10, 27, 22)) / 1000))
        #expect(draft.end.timeIntervalSince(draft.start) == 3600)
        #expect(draft.location == "Room 4B, Northwind HQ, 500 Howard St, San Francisco, CA 94105")
        #expect(draft.url?.absoluteString == "https://meet.google.com/abc-defg-hij")
        #expect(draft.rule?.freq == "WEEKLY")
        #expect(draft.timeZone == "America/Los_Angeles")
    }

    @Test("an all-day event ends on its last day, as EventKit wants")
    func allDay() {
        let draft = CalendarEventDrafts.draft(from: F.parsed("apple-allday.ics"))
        #expect(draft.allDay)
        let days = Calendar.current.dateComponents([.day], from: draft.start, to: draft.end).day
        #expect(days == 2)
        #expect(Calendar.current.component(.day, from: draft.start) == 12)
    }

    @Test("calendar parts are found by type or file name and size")
    func attachments() {
        let ics = AttachmentInfo(id: 1, filename: "invite.ics", contentType: "text/calendar; method=REQUEST", size: 900)
        let named = AttachmentInfo(id: 2, filename: "Meeting.ICS", contentType: "application/octet-stream", size: 900)
        let big = AttachmentInfo(id: 3, filename: "invite.ics", contentType: "text/calendar", size: 5_000_000)
        let pdf = AttachmentInfo(id: 4, filename: "a.pdf", contentType: "application/pdf", size: 900)
        #expect(InviteAttachments.isCalendar(ics))
        #expect(InviteAttachments.isCalendar(named))
        #expect(!InviteAttachments.isCalendar(big))
        #expect(!InviteAttachments.isCalendar(pdf))
    }
}

@Suite("Seeded invite")
struct SeededInviteTests {
    @Test("the demo mailbox's invite parses and can be answered")
    func demoInvite() {
        let data = SeedFiles.calendarInvite(
            uid: "logo-review-1@ellisdesign.example", title: "Logo review", location: "Studio B", organizer: "jordan@ellisdesign.example",
            attendee: "maya.okafor@example.com", start: Date().addingTimeInterval(3 * 86_400), minutes: 45)
        let invite = InviteParser.parse(data, context: InviteParseContext(ownAddresses: ["maya.okafor@example.com"], now: InviteFixtures.now))
        #expect(invite?.title == "Logo review")
        #expect(invite?.organizer?.address == "jordan@ellisdesign.example")
        #expect(invite?.invitedAs != nil)
    }
}
