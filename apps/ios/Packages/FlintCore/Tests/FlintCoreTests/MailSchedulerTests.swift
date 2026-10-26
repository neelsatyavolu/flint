import FlintModel
import FlintStore
import Foundation
import Testing
@testable import FlintMail

private struct SchedRig {
    let store: MailTestStore
    let fake: FakeMailTransport
    let log: MailEventLog
    let clock: MailTestClock
    let queue: SendQueue
    let pokes: MailTally
    let sends: MailSendCalls
    let sentRows: MailSentRows
    let reminders: MailReminderLog
    let snoozes: MailSnoozeLog
    let scheduler: MailScheduler
    let inbox: Folder

    static func make(sendDraft: (@Sendable (Int, Int) async throws -> String?)? = nil) async throws -> SchedRig {
        let store = MailTestStore()
        await store.addAccount(mailTestAccount())
        let fake = FakeMailTransport(folders: [RemoteFolder(path: "INBOX", delimiter: "/")])
        try await fake.connect(mailTestConfig)
        let inbox = try await store.upsertFolder("a1", FolderInput(path: "INBOX", role: .inbox))
        let log = MailEventLog(), clock = MailTestClock(), pokes = MailTally(), sends = MailSendCalls(), rows = MailSentRows(), reminders = MailReminderLog(), snoozes = MailSnoozeLog()
        let queue = SendQueue(store: store, emit: { log.add($0) }, poke: { pokes.bump() }, now: { clock.now })
        let actions = ServerActions(store: store, accountId: "a1", runner: MailDirectRunner(fake))
        let hooks = MailScheduler.Hooks(
            sendDraft: sendDraft ?? { draft, scheduled in sends.add(draft, scheduled); return "sent-\(scheduled)@test.local" },
            didSend: { rows.add($0) }, didReminder: { reminders.add($0) }, didWakeSnooze: { snoozes.add($0) })
        let scheduler = MailScheduler(store: store, actions: { _ in actions }, hooks: hooks, emit: { log.add($0) }, now: { clock.now })
        return SchedRig(store: store, fake: fake, log: log, clock: clock, queue: queue, pokes: pokes, sends: sends, sentRows: rows, reminders: reminders, snoozes: snoozes, scheduler: scheduler, inbox: inbox)
    }

    @discardableResult
    func draft(id: Int = 1, to: [String] = ["ann@example.org"]) async -> Draft {
        let draft = Draft(id: id, accountId: "a1", from: "me@test.local", threadId: id == 1 ? 5 : nil, to: to.map { Address(address: $0) }, subject: "Hi \(id)")
        await store.addDraft(draft)
        return draft
    }

    var statuses: [ScheduledSendStatus] { log.events.compactMap { if case .send(let s) = $0 { return s.status } else { return nil } } }
}

final class MailSendCalls: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [(Int, Int)] = []
    func add(_ d: Int, _ s: Int) { lock.lock(); storage.append((d, s)); lock.unlock() }
    var values: [(Int, Int)] { lock.lock(); defer { lock.unlock() }; return storage }
}
final class MailSentRows: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [ScheduledSend] = []
    func add(_ r: ScheduledSend) { lock.lock(); storage.append(r); lock.unlock() }
    var values: [ScheduledSend] { lock.lock(); defer { lock.unlock() }; return storage }
}
final class MailReminderLog: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [ReminderOutcome] = []
    func add(_ r: ReminderOutcome) { lock.lock(); storage.append(r); lock.unlock() }
    var values: [ReminderOutcome] { lock.lock(); defer { lock.unlock() }; return storage }
}
final class MailSnoozeLog: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [SnoozeWake] = []
    func add(_ r: SnoozeWake) { lock.lock(); storage.append(r); lock.unlock() }
    var values: [SnoozeWake] { lock.lock(); defer { lock.unlock() }; return storage }
}

@Suite("SendQueue")
struct MailSendQueueTests {
    @Test func sendingQueuesAfterTheUndoWindow() async throws {
        let r = try await SchedRig.make()
        await r.draft()
        let result = try await r.queue.sendDraft(1)
        #expect(result.sendAt == mailTestNow + 10_000 && result.undoUntil == result.sendAt && result.status == .pending)
        #expect(r.statuses == [.pending] && r.log.changes == [[5]] && r.pokes.count == 1)
        var settings = Settings()
        settings.compose.undoSendSeconds = 0
        await r.store.setSettings(settings)
        await r.draft(id: 2)
        #expect(try await r.queue.sendDraft(2).sendAt == mailTestNow)
    }

    @Test func sendLaterUsesTheGivenTimeButNeverThePast() async throws {
        let r = try await SchedRig.make()
        await r.draft()
        await r.draft(id: 2)
        #expect(try await r.queue.sendDraft(1, sendAt: mailTestNow + 3_600_000).sendAt == mailTestNow + 3_600_000)
        #expect(try await r.queue.sendDraft(2, sendAt: mailTestNow - 5_000).sendAt == mailTestNow)
    }

    @Test func refusesEmptyRecipientsMissingDraftsAndDoubleQueueing() async throws {
        let r = try await SchedRig.make()
        await r.draft(id: 3, to: [])
        await #expect(throws: FlintError.self) { try await r.queue.sendDraft(3) }
        await #expect(throws: FlintError.self) { try await r.queue.sendDraft(99) }
        await r.draft()
        _ = try await r.queue.sendDraft(1)
        do { _ = try await r.queue.sendDraft(1); Issue.record("should throw") } catch let error as FlintError { #expect(error.code == .conflict) }
    }

    @Test func cancellingInsideTheWindowIsUndoSend() async throws {
        let r = try await SchedRig.make()
        await r.draft()
        let queued = try await r.queue.sendDraft(1)
        let draft = try await r.queue.cancelSend(queued.scheduledId)
        #expect(draft.id == 1)
        #expect(try await r.store.scheduledSend(id: queued.scheduledId)?.status == .cancelled)
        #expect(r.statuses == [.pending, .cancelled])
        // The draft can be queued again after a cancel.
        _ = try await r.queue.sendDraft(1)
    }

    @Test func aSendThatIsOnItsWayOrDoneCannotBeCancelled() async throws {
        let r = try await SchedRig.make()
        await r.draft()
        let queued = try await r.queue.sendDraft(1)
        _ = try await r.store.updateScheduled(queued.scheduledId, ScheduledSendPatch(status: .sending))
        do { _ = try await r.queue.cancelSend(queued.scheduledId); Issue.record("should throw") } catch let error as FlintError { #expect(error.code == .conflict) }
        _ = try await r.store.updateScheduled(queued.scheduledId, ScheduledSendPatch(status: .sent))
        do { _ = try await r.queue.cancelSend(queued.scheduledId); Issue.record("should throw") } catch let error as FlintError { #expect(error.message.contains("already sent")) }
        await #expect(throws: FlintError.self) { try await r.queue.cancelSend(404) }
    }

    @Test func aFailedSendCanBeClearedOrMoved() async throws {
        let r = try await SchedRig.make()
        await r.draft()
        let queued = try await r.queue.sendDraft(1)
        _ = try await r.store.updateScheduled(queued.scheduledId, ScheduledSendPatch(status: .failed, error: .some("smtp down"), attempts: 4))
        let moved = try await r.queue.reschedule(queued.scheduledId, to: mailTestNow + 60_000)
        #expect(moved.status == .pending && moved.error == nil && moved.attempts == 0 && moved.sendAt == mailTestNow + 60_000)
        #expect(try await r.queue.listScheduled().count == 1)
        _ = try await r.store.updateScheduled(queued.scheduledId, ScheduledSendPatch(status: .sent))
        await #expect(throws: FlintError.self) { try await r.queue.reschedule(queued.scheduledId, to: mailTestNow) }
    }
}

@Suite("MailScheduler sends")
struct MailSchedulerSendTests {
    @Test func aDueSendIsSentAndReported() async throws {
        let r = try await SchedRig.make()
        await r.draft()
        let queued = try await r.queue.sendDraft(1, sendAt: mailTestNow + 5_000)
        #expect(await r.scheduler.tick() == mailTestNow + 5_000)
        #expect(r.sends.values.isEmpty)
        r.clock.advance(5_000)
        #expect(await r.scheduler.tick() == nil)
        #expect(r.sends.values.map(\.1) == [queued.scheduledId])
        let row = try #require(try await r.store.scheduledSend(id: queued.scheduledId))
        #expect(row.status == .sent && row.messageId == "sent-1@test.local")
        #expect(r.statuses == [.pending, .sending, .sent] && r.sentRows.values.map(\.id) == [queued.scheduledId])
    }

    @Test func aFailingSendIsRetriedWithBackoffThenFailsWithAToast() async throws {
        let r = try await SchedRig.make(sendDraft: { _, _ in throw FlintError(.network, "smtp down") })
        await r.draft()
        let queued = try await r.queue.sendDraft(1, sendAt: mailTestNow)
        var due: [EpochMs?] = []
        for _ in 0..<4 {
            due.append(await r.scheduler.tick())
            if let next = await r.scheduler.nextDueAt() { r.clock.advance(max(0, next - r.clock.now)) }
        }
        #expect(due == [mailTestNow + 5_000, mailTestNow + 5_000 + 30_000, mailTestNow + 5_000 + 30_000 + 120_000, nil])
        let row = try #require(try await r.store.scheduledSend(id: queued.scheduledId))
        #expect(row.status == .failed && row.attempts == 4 && row.error == "smtp down")
        #expect(r.log.toasts == ["Couldn't send \"Hi 1\". smtp down"])
    }

    @Test func aSendThatMayAlreadyHaveGoneOutIsNeverRetried() async throws {
        let r = try await SchedRig.make(sendDraft: { _, _ in throw FlintError(.conflict, "The server may have accepted this message. Check Sent before sending it again.") })
        await r.draft()
        let queued = try await r.queue.sendDraft(1, sendAt: mailTestNow)
        #expect(await r.scheduler.tick() == nil)
        let row = try #require(try await r.store.scheduledSend(id: queued.scheduledId))
        #expect(row.status == .failed && row.attempts == 1)
    }

    @Test func aDeletedDraftIsNotRetried() async throws {
        let r = try await SchedRig.make(sendDraft: { _, _ in throw FlintError(.notFound, "The draft was deleted before it could be sent.") })
        await r.draft()
        let queued = try await r.queue.sendDraft(1, sendAt: mailTestNow)
        _ = await r.scheduler.tick()
        #expect(try await r.store.scheduledSend(id: queued.scheduledId)?.status == .failed)
    }

    @Test func approvalWaitingSendsAreLeftAlone() async throws {
        let r = try await SchedRig.make()
        await r.draft()
        _ = try await r.store.createScheduledSend(NewScheduledSend(draftId: 1, sendAt: mailTestNow - 1, status: .awaitingApproval), now: mailTestNow)
        #expect(await r.scheduler.tick() == nil && r.sends.values.isEmpty)
    }

    @Test func aSendLeftSendingByACrashIsFailedNotResent() async throws {
        let r = try await SchedRig.make()
        await r.draft()
        let row = try await r.store.createScheduledSend(NewScheduledSend(draftId: 1, sendAt: mailTestNow - 1, status: .sending), now: mailTestNow)
        await r.scheduler.recoverInterruptedSends()
        let after = try #require(try await r.store.scheduledSend(id: row.id))
        #expect(after.status == .failed && after.error?.contains("Check Sent") == true)
        _ = await r.scheduler.tick()
        #expect(r.sends.values.isEmpty)
    }

    @Test func overlappingTicksShareOneRun() async throws {
        let gate = MailTally()
        let r = try await SchedRig.make(sendDraft: { _, _ in gate.bump(); try? await Task.sleep(for: .milliseconds(30)); return "m@x" })
        await r.draft()
        _ = try await r.queue.sendDraft(1, sendAt: mailTestNow)
        async let a = r.scheduler.tick()
        async let b = r.scheduler.tick()
        _ = await (a, b)
        #expect(gate.count == 1)
    }
}

@Suite("MailScheduler wake-ups")
struct MailSchedulerWakeTests {
    @Test func aSnoozeComesBackUnreadOnTheServerToo() async throws {
        let r = try await SchedRig.make()
        let uid = await r.fake.deliver(mailTestEnvelope("Later", flags: [IMAPFlag.seen]), to: "INBOX")
        await r.store.addMessage(StoredMessage(id: 4, accountId: "a1", threadId: 12, folderId: r.inbox.id, uid: uid, subject: "Later", date: mailTestNow, seen: true))
        await r.store.snoozeThread(12, until: mailTestNow + 1_000)
        await r.store.script([ActionResult(snapshot: ThreadSnapshot(threads: []), locations: [try #require(try await r.store.messageLocations([4]).first)])])
        #expect(await r.scheduler.nextDueAt() == mailTestNow + 1_000)
        r.clock.advance(1_000)
        _ = await r.scheduler.tick()
        #expect(await r.fake.envelopes(in: "INBOX").first?.flags.isEmpty == true)
        #expect(r.log.changes == [[12]] && r.snoozes.values == [SnoozeWake(threadId: 12, subject: "Later")])
        #expect(await r.scheduler.nextDueAt() == nil)
    }

    @Test func aReminderFiresWhenNobodyRepliedAndResurfacesTheThread() async throws {
        let r = try await SchedRig.make()
        await r.store.addMessage(StoredMessage(id: 6, accountId: "a1", threadId: 20, folderId: r.inbox.id, uid: 1, messageId: "sent6@test.local", to: [Address(name: "Ann Lee", address: "ann@x.org")], date: mailTestNow - 1000))
        let reminder = try await r.store.createReminder(accountId: "a1", threadId: nil, messageId: "sent6@test.local", remindAt: mailTestNow + 500)
        #expect(await r.scheduler.nextDueAt() == mailTestNow + 500)
        r.clock.advance(500)
        _ = await r.scheduler.tick()
        #expect(try await r.store.reminder(id: reminder.id)?.status == .fired)
        #expect(await r.store.resurfaced == [20])
        #expect(r.reminders.values.map(\.message) == ["No reply from Ann yet"])
        #expect(r.reminders.values.first?.result == .fired)
        #expect(r.log.changes == [[20]])
    }

    @Test func aReminderForAThreadThatGotAReplyIsDroppedQuietly() async throws {
        let r = try await SchedRig.make()
        await r.store.addMessage(StoredMessage(id: 7, accountId: "a1", threadId: 21, folderId: r.inbox.id, uid: 1, messageId: "sent7@test.local", date: mailTestNow))
        await r.store.setReplied(21)
        let reminder = try await r.store.createReminder(accountId: "a1", threadId: 21, messageId: "sent7@test.local", remindAt: mailTestNow)
        _ = await r.scheduler.tick()
        #expect(try await r.store.reminder(id: reminder.id)?.status == .replied)
        #expect(await r.store.resurfaced.isEmpty && r.reminders.values.map(\.message) == ["Reply received"])
    }

    @Test func aReminderForAnUnknownMessageIsCancelled() async throws {
        let r = try await SchedRig.make()
        let reminder = try await r.store.createReminder(accountId: "a1", threadId: nil, messageId: "ghost@x", remindAt: mailTestNow)
        _ = await r.scheduler.tick()
        #expect(try await r.store.reminder(id: reminder.id)?.status == .cancelled && r.reminders.values.isEmpty)
    }

    @Test func nextDueIsTheEarliestOfSendsSnoozesAndReminders() async throws {
        let r = try await SchedRig.make()
        await r.draft()
        _ = try await r.queue.sendDraft(1, sendAt: mailTestNow + 9_000)
        _ = try await r.store.createReminder(accountId: "a1", threadId: 1, messageId: "m", remindAt: mailTestNow + 4_000)
        await r.store.snoozeThread(3, until: mailTestNow + 6_000)
        #expect(await r.scheduler.nextDueAt() == mailTestNow + 4_000)
    }
}
