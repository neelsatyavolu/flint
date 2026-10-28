import FlintModel
import FlintStore
import Foundation
import Testing
@testable import FlintMail

actor MailFakeTracking: TrackingProvider {
    var configured = true
    var failPrepare = false
    private(set) var prepared: [(subject: String, recipients: [String])] = []
    private(set) var untrackedRecords: [(reason: String, recipients: [String])] = []
    private(set) var stopped: [Int] = []
    let refId = 77

    func setConfigured(_ value: Bool) { configured = value }
    func setFailPrepare(_ value: Bool) { failPrepare = value }
    var isConfigured: Bool { configured }

    func prepareTracked(accountId: AccountID, subject: String, messageId: String, recipients: [Address], selfAddresses: [String]) async -> SendTracking {
        prepared.append((subject, recipients.map(\.address)))
        let own = Set(selfAddresses.map { $0.lowercased() })
        let candidates = recipients.filter { !own.contains($0.address.lowercased()) }
        let untracked = recipients.filter { own.contains($0.address.lowercased()) }
        if failPrepare || candidates.isEmpty { return SendTracking(ref: "REF123", perRecipient: [], untracked: candidates + untracked) }
        return SendTracking(
            ref: "REF123", perRecipient: candidates.enumerated().map { SendTrackingRecipient(address: $1, token: "TOK\($0)", pixelURL: "https://r.example/i/TOK\($0).gif") }, untracked: untracked)
    }

    func recordUntracked(accountId: AccountID, subject: String, messageId: String, recipients: [Address], selfAddresses: [String], reason: String) async {
        untrackedRecords.append((reason, recipients.map(\.address)))
    }

    func stopTracking(trackedId: Int) async { stopped.append(trackedId) }

    nonisolated func injectPixel(html: String, pixelURL: String) -> String { html.replacingOccurrences(of: "<body>", with: "<body><img src=\"\(pixelURL)\">") }
}

final class MailTally: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0
    func bump() { lock.lock(); value += 1; lock.unlock() }
    var count: Int { lock.lock(); defer { lock.unlock() }; return value }
}

struct MailSendRig {
    let store: MailTestStore
    let fake: FakeMailTransport
    let tracking: MailFakeTracking
    let log: MailEventLog
    let job: SendJob
    let syncs: MailTally
    let inbox: Folder

    static func make(provider: MailProvider = .imap) async throws -> MailSendRig {
        let store = MailTestStore()
        await store.addAccount(mailTestAccount(provider: provider))
        await store.setOwnAddresses(["me@test.local"])
        let fake = FakeMailTransport(folders: [RemoteFolder(path: "INBOX", delimiter: "/"), RemoteFolder(path: "Sent", delimiter: "/", attributes: ["sent"])])
        try await fake.connect(mailTestConfig)
        let inbox = try await store.upsertFolder("a1", FolderInput(path: "INBOX", role: .inbox))
        _ = try await store.upsertFolder("a1", FolderInput(path: "Sent", role: .sent))
        let tracking = MailFakeTracking()
        let log = MailEventLog()
        let syncs = MailTally()
        let runner = MailDirectRunner(fake)
        let actions = ServerActions(store: store, accountId: "a1", runner: runner)
        let job = SendJob(SendJob.Dependencies(
            store: store, tracking: tracking,
            mailer: { _ in Mailer(smtp: { try await fake.send($0) }, sentCopy: SentCopy(runner: runner, sleep: { _ in })) },
            actions: { _ in actions }, syncSoon: { _ in syncs.bump() }, emit: { log.add($0) }, now: { mailTestNow }))
        return MailSendRig(store: store, fake: fake, tracking: tracking, log: log, job: job, syncs: syncs, inbox: inbox)
    }

    @discardableResult
    func draft(
        to: [String] = ["ann@example.org"], track: Bool = false, mode: ComposeMode = .new, source: MessageRowID? = nil, thread: ThreadID? = nil, remindAt: EpochMs? = nil,
        attachments: [DraftAttachment] = []
    ) async -> (draft: Draft, scheduled: ScheduledSend) {
        let draft = Draft(
            id: 1, accountId: "a1", from: "me@test.local", mode: mode, sourceMessageId: source, threadId: thread, to: to.map { Address(address: $0) }, subject: "Hello",
            html: "<body><p>hi</p></body>", attachments: attachments, track: track, remindAt: remindAt)
        await store.addDraft(draft)
        let row = try! await store.createScheduledSend(NewScheduledSend(draftId: 1, sendAt: mailTestNow), now: mailTestNow)
        return (draft, row)
    }

    var sentRecipients: [[String]] { get async { await fake.sentMessages.map(\.recipients) } }
}

@Suite("SendJob")
struct MailSendJobTests {
    @Test func anUntrackedDraftIsSentFiledAndAnnounced() async throws {
        let r = try await MailSendRig.make()
        let (_, row) = await r.draft(thread: 5, remindAt: mailTestNow + 86_400_000)
        let messageId = try await r.job.run(draftId: 1, scheduledId: row.id)
        #expect(await r.sentRecipients == [["ann@example.org"]])
        #expect(MailParsedMime.parse(await r.fake.sentMessages[0].raw).header("message-id") == "<\(messageId)>")
        #expect(await r.fake.envelopes(in: "Sent").count == 1)
        #expect(try await r.store.scheduledSend(id: row.id)?.messageId == messageId) // stable across retries
        #expect(r.log.changes == [[5]] && r.syncs.count == 1 && r.log.toasts.isEmpty)
        let reminders = try await r.store.listPendingReminders(limit: 10)
        #expect(reminders.count == 1 && reminders[0].messageId == messageId && reminders[0].threadId == 5)
    }

    @Test func aRetryReusesThePersistedMessageId() async throws {
        let r = try await MailSendRig.make()
        let (_, row) = await r.draft()
        _ = try await r.store.updateScheduled(row.id, ScheduledSendPatch(messageId: .some("kept@test.local")))
        #expect(try await r.job.run(draftId: 1, scheduledId: row.id) == "kept@test.local")
    }

    @Test func repliesMarkTheOriginalAnsweredLocallyAndOnTheServer() async throws {
        let r = try await MailSendRig.make()
        let uid = await r.fake.deliver(mailTestEnvelope("Original", messageId: "<orig@x>"), to: "INBOX")
        await r.store.addMessage(StoredMessage(id: 9, accountId: "a1", threadId: 5, folderId: r.inbox.id, uid: uid, messageId: "<orig@x>", date: mailTestNow))
        let (_, row) = await r.draft(mode: .reply, source: 9, thread: 5)
        _ = try await r.job.run(draftId: 1, scheduledId: row.id)
        #expect(try await r.store.message(id: 9)?.answered == true)
        #expect(await r.fake.envelopes(in: "INBOX").first?.flags == [IMAPFlag.answered])
    }

    @Test func aTrackedDraftGoesOutAsOneCopyPerRecipientAndLinksTheThread() async throws {
        let r = try await MailSendRig.make()
        let (_, row) = await r.draft(to: ["a@x.org", "b@x.org", "me@test.local"], track: true, thread: 8)
        _ = try await r.job.run(draftId: 1, scheduledId: row.id)
        #expect(await r.sentRecipients == [["a@x.org"], ["b@x.org"], ["me@test.local"]])
        let parsed = await r.fake.sentMessages.map { MailParsedMime.parse($0.raw) }
        #expect(parsed.allSatisfy { $0.header("x-flint-ref") == "REF123" })
        #expect(parsed[0].parts[1].text.contains("TOK0.gif") && parsed[1].parts[1].text.contains("TOK1.gif") && !parsed[2].parts[1].text.contains("/i/"))
        let linked = await r.store.linkedSent
        #expect(linked.count == 1 && linked[0].ref == "REF123" && linked[0].threadId == 8)
        #expect(r.log.toasts.isEmpty)
    }

    @Test func plainTextModeSendsUntrackedAndRecordsWhy() async throws {
        let r = try await MailSendRig.make()
        var settings = Settings()
        settings.compose.plainTextOnly = true
        await r.store.setSettings(settings)
        let (_, row) = await r.draft(track: true)
        _ = try await r.job.run(draftId: 1, scheduledId: row.id)
        let sent = MailParsedMime.parse(await r.fake.sentMessages[0].raw)
        #expect(sent.contentType == "text/plain") // no html part, so no pixel is possible
        let records = await r.tracking.untrackedRecords
        #expect(records.count == 1 && records[0].reason == "Receipts off: plain-text mode")
        #expect(r.log.toasts == ["Sent \"Hello\" without read receipts: plain text only is on, and a read receipt needs a tiny image."])
    }

    @Test func receiptsNotConfiguredOrSwitchedOffAreExplained() async throws {
        let r = try await MailSendRig.make()
        await r.tracking.setConfigured(false)
        let (_, row) = await r.draft(track: true)
        _ = try await r.job.run(draftId: 1, scheduledId: row.id)
        #expect(await r.tracking.untrackedRecords.first?.reason == "Receipts off: no receipts address set")
        #expect(await r.job.trackingBlockedReason() == "Receipts off: no receipts address set")

        var settings = Settings()
        settings.receipts.enabled = false
        await r.store.setSettings(settings)
        #expect(await r.job.trackingBlockedReason() == "Receipts off in Settings")
        await r.tracking.setConfigured(true)
        settings.receipts.enabled = true
        await r.store.setSettings(settings)
        #expect(await r.job.trackingBlockedReason() == nil)
    }

    @Test func anUnreachableReceiptsServiceStillSendsThenTellsYou() async throws {
        let r = try await MailSendRig.make()
        await r.tracking.setFailPrepare(true)
        let (_, row) = await r.draft(to: ["a@x.org"], track: true)
        _ = try await r.job.run(draftId: 1, scheduledId: row.id)
        #expect(await r.sentRecipients == [["a@x.org", ]])
        #expect(r.log.toasts == ["Sent \"Hello\" without read receipts: the receipts service couldn't be reached."])
    }

    @Test func aSelfOnlyTrackedSendIsSilentlyUntracked() async throws {
        let r = try await MailSendRig.make()
        let (_, row) = await r.draft(to: ["me@test.local"], track: true)
        _ = try await r.job.run(draftId: 1, scheduledId: row.id)
        #expect(await r.sentRecipients == [["me@test.local"]] && r.log.toasts.isEmpty)
    }

    @Test func aFailedSendDiscardsTheTrackingItPrepared() async throws {
        let r = try await MailSendRig.make()
        await r.store.registerTracked(ref: "REF123", id: 55)
        await r.fake.rejectLogins()
        let (_, row) = await r.draft(to: ["a@x.org"], track: true)
        await #expect(throws: FlintError.self) { try await r.job.run(draftId: 1, scheduledId: row.id) }
        #expect(await r.tracking.stopped == [55])
        #expect(await r.store.trackedStates[55] == .stopped)
        #expect(await r.store.linkedSent.isEmpty && r.syncs.count == 0)
    }

    @Test func recipientsThatFailAreNamedWhileTheRestGetTheMail() async throws {
        let r = try await MailSendRig.make()
        await r.fake.failNext("send", with: FlintError(.invalid, "no"))
        let (_, row) = await r.draft(to: ["a@x.org", "b@x.org"], track: true)
        _ = try await r.job.run(draftId: 1, scheduledId: row.id)
        #expect(r.log.toasts == ["Couldn't deliver \"Hello\" to a@x.org. The other recipients got it."])
    }

    @Test func problemsThatAFixMustResolveFailBeforeSmtp() async throws {
        let r = try await MailSendRig.make()
        await #expect(throws: FlintError.self) { try await r.job.run(draftId: 99, scheduledId: 1) } // deleted draft
        let (_, row) = await r.draft(to: [])
        await #expect(throws: FlintError.self) { try await r.job.run(draftId: 1, scheduledId: row.id) } // no recipients
        await r.store.addDraft(Draft(id: 2, accountId: "a1", from: "me@test.local", to: [Address(address: "a@x.org")], attachments: [
            DraftAttachment(id: "1", filename: "gone.pdf", contentType: "application/pdf", size: 1, path: "/nonexistent/gone.pdf")]))
        let second = try await r.store.createScheduledSend(NewScheduledSend(draftId: 2, sendAt: mailTestNow), now: mailTestNow)
        do { _ = try await r.job.run(draftId: 2, scheduledId: second.id); Issue.record("should throw") } catch let error as FlintError {
            #expect(error.code == .notFound && error.message.contains("gone.pdf"))
        }
        #expect(await r.fake.sentMessages.isEmpty)
    }

    @Test func rawPlainTextMessagesGoOutWithoutADraft() async throws {
        let r = try await MailSendRig.make()
        try await r.job.sendRaw(accountId: "a1", to: [Address(address: "unsub@list.example")], subject: "unsubscribe", text: "please <remove> me")
        let sent = MailParsedMime.parse(await r.fake.sentMessages[0].raw)
        #expect(sent.parts[0].text == "please <remove> me" && sent.parts[1].text.contains("&lt;remove&gt;"))
        #expect(await r.fake.envelopes(in: "Sent").count == 1)
    }
}
