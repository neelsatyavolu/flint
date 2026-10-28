import FlintMail
import FlintModel
import FlintStore
import Foundation
import Testing
@testable import FlintService

private func inbox() -> ThreadQuery { ThreadQuery(view: .inbox) }

private func setUndoSeconds(_ rig: ServiceRig, _ seconds: Int) async throws {
    try await rig.service.updateSettings(patch: .object(["compose": .object(["undoSendSeconds": .number(Double(seconds))])]))
}

@Suite("Service: drafts")
struct ServiceDraftTests {
    @Test func aNewDraftStartsWithTheDefaultSignatureAndTheReceiptsDefault() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        let account = try await rig.addAccount()
        let signature = try await rig.service.saveSignature(Signature(id: 0, name: "Plain", html: "<b>Me</b>", defaultNew: true))
        #expect(signature.id > 0)
        let draft = try await rig.service.createDraft(.new(accountId: account.id, to: [Address(address: "bo@example.org")], subject: "Hello", html: "<p>Hi</p>"))
        #expect(draft.from == "me@test.local")
        #expect(draft.signatureId == signature.id)
        #expect(Signatures.has(draft.html))
        #expect(draft.track)
        // No receipts address is configured, so the composer is told why a receipt cannot work.
        #expect(draft.trackingBlockedReason == "Receipts off: no receipts address set")

        let without = try await rig.service.updateDraft(id: draft.id, DraftPatch(signatureId: .some(nil)))
        #expect(without.signatureId == nil)
        #expect(!Signatures.has(without.html))
        #expect(without.html.contains("<p>Hi</p>"))
    }

    @Test func templatesFillTheSubjectAndBody() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        try await rig.addAccount()
        let template = try await rig.service.saveTemplate(Template(id: 0, name: "Intro", subject: "Nice to meet you", html: "<p>Thanks for your time.</p>"))
        let draft = try await rig.service.createDraft(.new(templateId: template.id))
        #expect(draft.subject == "Nice to meet you")
        #expect(draft.html.contains("Thanks for your time."))
        await #expect(throws: FlintError.self) { _ = try await rig.service.createDraft(.new(templateId: 4242)) }
    }

    @Test func recipientsAreValidatedAndTheSenderMustBeOneOfYourAddresses() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        try await rig.addAccount()
        let draft = try await rig.service.createDraft(.new())
        await #expect(throws: FlintError.self) { _ = try await rig.service.updateDraft(id: draft.id, DraftPatch(to: [Address(address: "nobody")])) }
        await #expect(throws: FlintError.self) { _ = try await rig.service.updateDraft(id: draft.id, DraftPatch(from: "stranger@elsewhere.example")) }
        let ok = try await rig.service.updateDraft(id: draft.id, DraftPatch(to: [Address(name: "Bo", address: " bo@example.org ")], subject: "Hi"))
        #expect(ok.to == [Address(name: "Bo", address: "bo@example.org")])
        #expect(ok.subject == "Hi")
    }

    @Test func aReplyAddressesTheSenderQuotesTheOriginalAndThreadsIt() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        try await rig.addAccount()
        await rig.deliver("Plan", body: "Shall we meet?", ageDays: 1, messageId: "<orig@example.com>")
        try await rig.service.syncNow()
        let thread = try #require(try await rig.service.listThreads(inbox()).items.first)
        let original = try #require(try await rig.service.thread(id: thread.id).messages.first)

        let draft = try await rig.service.createDraft(.reply(messageId: original.id, html: "<p>Yes.</p>"))
        #expect(draft.mode == .reply)
        #expect(draft.to == [Address(name: "Ann", address: "ann@example.com")])
        #expect(draft.subject == "Re: Plan")
        #expect(draft.threadId == thread.id)
        #expect(draft.sourceMessageId == original.id)
        #expect(draft.quotedHtml.contains("wrote:"))
        #expect(draft.quotedHtml.contains("Shall we meet?"))
        let meta = try await rig.store.draftMeta(draft.id)
        #expect(meta.inReplyTo == "<orig@example.com>" || meta.inReplyTo == "orig@example.com")
    }

    @Test func aForwardCarriesNoRecipientsAndSaysFwd() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        try await rig.addAccount()
        await rig.deliver("Plan", body: "Details", ageDays: 1)
        try await rig.service.syncNow()
        let id = try #require(try await rig.service.listThreads(inbox()).items.first?.id)
        let original = try #require(try await rig.service.thread(id: id).messages.first)
        let draft = try await rig.service.createDraft(.forward(messageId: original.id))
        #expect(draft.to.isEmpty)
        #expect(draft.subject == "Fwd: Plan")
        #expect(draft.quotedHtml.contains("Forwarded message"))
    }

    @Test func deletingADraftRemovesItsFilesAndAnnouncesTheChange() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        try await rig.addAccount()
        let draft = try await rig.service.createDraft(.new())
        let file = rig.directory.appendingPathComponent("note.txt")
        try FileManager.default.createDirectory(at: rig.directory, withIntermediateDirectories: true)
        try Data("attached".utf8).write(to: file)
        let withFile = try await rig.service.addAttachment(draftId: draft.id, file: file)
        let attachment = try #require(withFile.attachments.first)
        #expect(FileManager.default.fileExists(atPath: attachment.path))
        #expect(attachment.contentType == "text/plain")
        #expect(attachment.size == 8)

        let removed = try await rig.service.removeAttachment(draftId: draft.id, attachmentId: attachment.id)
        #expect(removed.attachments.isEmpty)
        #expect(!FileManager.default.fileExists(atPath: attachment.path))

        let again = try await rig.service.addAttachment(draftId: draft.id, file: file)
        let copy = try #require(again.attachments.first)
        try await rig.service.deleteDraft(id: draft.id)
        #expect(!FileManager.default.fileExists(atPath: copy.path))
        await #expect(throws: FlintError.self) { _ = try await rig.service.draft(id: draft.id) }
        try await rig.service.deleteDraft(id: draft.id)
    }

    @Test func aDraftOnlyOnTheServerOpensAsALocalDraftOnce() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        try await rig.addAccount()
        var envelope = mailTestEnvelope("Half written", from: "me@test.local", flags: ["\\Draft", "\\Seen"], ageDays: 1)
        envelope.to = [Address(address: "bo@example.org")]
        await rig.fake.deliver(envelope, parts: ["1": Data("Dear Bo".utf8)], to: "Drafts")
        try await rig.service.syncNow()
        let folder = try #require(try await rig.store.folder(accountId: try await rig.service.listAccounts()[0].id, role: .drafts))
        let message = try #require(try await rig.store.message(folderId: folder.id, uid: 1))

        let opened = try await rig.service.openServerDraft(messageId: message.id)
        #expect(opened.subject == "Half written")
        #expect(opened.to == [Address(address: "bo@example.org")])
        #expect(opened.html.contains("Dear Bo"))
        let meta = try await rig.store.draftMeta(opened.id)
        #expect(meta.serverUid == 1)
        let reopened = try await rig.service.openServerDraft(messageId: message.id)
        #expect(reopened.id == opened.id)
        #expect(try await rig.service.listDrafts().count == 1)

        let inbox = try #require(try await rig.store.folder(accountId: opened.accountId, role: .inbox))
        await rig.deliver("Not a draft", ageDays: 1)
        try await rig.service.syncNow()
        let other = try #require(try await rig.store.message(folderId: inbox.id, uid: 1))
        await #expect(throws: FlintError.self) { _ = try await rig.service.openServerDraft(messageId: other.id) }
    }
}

@Suite("Service: sending")
struct ServiceSendTests {
    private func draftReady(_ rig: ServiceRig, subject: String = "Hello") async throws -> Draft {
        let account = try await rig.addAccount()
        let draft = try await rig.service.createDraft(.new(accountId: account.id, to: [Address(address: "bo@example.org")], subject: subject, html: "<p>Hi Bo</p>"))
        return try await rig.service.updateDraft(id: draft.id, DraftPatch(track: false))
    }

    @Test func sendingWaitsOutTheUndoWindowThenDeliversAndFilesTheSentCopy() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        let draft = try await draftReady(rig)
        try await setUndoSeconds(rig, 10)
        let result = try await rig.service.sendDraft(id: draft.id)
        #expect(result.status == .pending)
        #expect(result.sendAt == rig.clock.now + 10_000)
        #expect(try await rig.service.listScheduled().count == 1)
        await #expect(throws: FlintError.self) { _ = try await rig.service.sendDraft(id: draft.id) }

        _ = await rig.service.runDueWork()
        #expect(await rig.fake.sentMessages.isEmpty)

        rig.clock.advance(10_500)
        let next = await rig.service.runDueWork()
        #expect(next == nil)
        let sent = try #require(await rig.fake.sentMessages.first)
        #expect(sent.recipients == ["bo@example.org"])
        let mime = String(decoding: sent.raw, as: UTF8.self)
        #expect(mime.contains("Subject: Hello"))
        #expect(mime.contains("Hi Bo"))
        #expect(await rig.fake.envelopes(in: "Sent").count == 1)

        #expect(try await rig.service.listDrafts().isEmpty)
        #expect(try await rig.service.listScheduled().isEmpty)
        #expect(rig.log.count { if case .send(let s) = $0 { return s.status == .sent } else { return false } } == 1)
    }

    @Test func undoSendCancelsTheQueueAndReturnsTheDraftForEditing() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        let draft = try await draftReady(rig)
        let result = try await rig.service.sendDraft(id: draft.id)
        let back = try await rig.service.cancelSend(scheduledId: result.scheduledId)
        #expect(back.id == draft.id)
        rig.clock.advance(60_000)
        _ = await rig.service.runDueWork()
        #expect(await rig.fake.sentMessages.isEmpty)
        #expect(try await rig.service.draft(id: draft.id).subject == "Hello")
        // It can be queued again, this time for later.
        let later = try await rig.service.sendDraft(id: draft.id, sendAt: rig.clock.now + 3_600_000)
        #expect(later.sendAt == rig.clock.now + 3_600_000)
        let moved = try await rig.service.rescheduleSend(scheduledId: later.scheduledId, to: rig.clock.now + 7_200_000)
        #expect(moved.sendAt == rig.clock.now + 7_200_000)
    }

    @Test func aSendWithoutRecipientsIsRefusedBeforeItIsQueued() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        try await rig.addAccount()
        let draft = try await rig.service.createDraft(.new())
        await #expect(throws: FlintError.self) { _ = try await rig.service.sendDraft(id: draft.id) }
        await #expect(throws: FlintError.self) { _ = try await rig.service.sendDraft(id: 0) }
    }

    @Test func aTemporaryServerFailureIsRetriedAndThenSucceeds() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        let draft = try await draftReady(rig)
        try await setUndoSeconds(rig, 0)
        await rig.fake.failNext("send", with: FlintError(.network, "connection lost"))
        _ = try await rig.service.sendDraft(id: draft.id)
        _ = await rig.service.runDueWork()
        let retry = try #require(try await rig.service.listScheduled().first)
        #expect(retry.status == .pending)
        #expect(retry.attempts == 1)
        #expect(retry.error == "connection lost")
        rig.clock.advance(6_000)
        _ = await rig.service.runDueWork()
        #expect(await rig.fake.sentMessages.count == 1)
        #expect(try await rig.service.listDrafts().isEmpty)
    }

    @Test func repliesMarkTheOriginalAnsweredAndRemindersFire() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        try await rig.addAccount()
        await rig.deliver("Plan", ageDays: 1, messageId: "<orig@example.com>")
        try await rig.service.syncNow()
        let id = try #require(try await rig.service.listThreads(inbox()).items.first?.id)
        let original = try #require(try await rig.service.thread(id: id).messages.first)
        let reply = try await rig.service.createDraft(.reply(messageId: original.id, html: "<p>Yes.</p>"))
        _ = try await rig.service.updateDraft(id: reply.id, DraftPatch(track: false, remindAt: .some(rig.clock.now + 3_600_000)))
        try await setUndoSeconds(rig, 0)
        _ = try await rig.service.sendDraft(id: reply.id)
        _ = await rig.service.runDueWork()

        #expect(await rig.fake.sentMessages.count == 1)
        let answered = try #require(try await rig.store.message(id: original.id))
        #expect(answered.answered)
        #expect(await serviceEventually { await rig.fake.envelopes(in: "INBOX").first?.flags.contains("\\Answered") == true })

        rig.clock.advance(3_700_000)
        _ = await rig.service.runDueWork()
        #expect(rig.log.toasts.contains { $0.contains("No reply from") })
    }

    @Test func aSendThatWasInterruptedIsMarkedFailedAtNextStart() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        let draft = try await draftReady(rig)
        let row = try await rig.store.createScheduledSend(NewScheduledSend(draftId: draft.id, sendAt: rig.clock.now, status: .sending), now: rig.clock.now)
        await rig.service.start()
        await rig.service.waitForMaintenance()
        let after = try #require(try await rig.store.scheduledSend(id: row.id))
        #expect(after.status == .failed)
        #expect(after.error?.contains("Check Sent") == true)
    }
}
