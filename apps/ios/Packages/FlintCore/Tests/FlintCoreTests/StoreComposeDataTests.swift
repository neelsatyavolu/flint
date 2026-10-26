import FlintModel
import Foundation
import Testing
@testable import FlintStore

@Suite("Store drafts, scheduled sends, reminders")
struct StoreComposeDataTests {
    @Test func roundTripsDraftsAndTheirMeta() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        let d = try await store.createDraft(NewDraft(
            accountId: s.account.id, from: "me@example.com", to: [StoreTestKit.person("Bo")], subject: "Hi", html: "<p>x</p>", track: true,
            inReplyTo: "p@x", references: ["a@x", "p@x"]), now: 1000)
        #expect(d.mode == .new && d.track && d.createdBy == "user" && d.updatedAt == 1000 && d.attachments == [] && d.to == [StoreTestKit.person("Bo")])
        #expect(try await store.draftMeta(d.id) == DraftMeta(inReplyTo: "p@x", references: ["a@x", "p@x"], serverUid: nil, serverMessageId: nil))
        var meta = try await store.draftMeta(d.id)
        meta.serverUid = 12
        try await store.setDraftMeta(d.id, meta)
        #expect(try await store.draftMeta(d.id).serverUid == 12)
        let attachment = DraftAttachment(id: "a", filename: "f", contentType: "text/plain", size: 1, path: "/f")
        let u = try await store.updateDraft(d.id, DraftPatch(cc: [StoreTestKit.person("Cy")], subject: "Hello", attachments: [attachment], track: false, remindAt: .some(99)), now: 2000)
        #expect(u.subject == "Hello" && !u.track && u.remindAt == 99 && u.updatedAt == 2000 && u.cc == [StoreTestKit.person("Cy")] && u.attachments == [attachment])
        let cleared = try await store.updateDraft(d.id, DraftPatch(signatureId: .some(nil), remindAt: .some(nil)), now: 3000)
        #expect(cleared.remindAt == nil && cleared.signatureId == nil)
        #expect(try await store.listDrafts().map(\.id) == [d.id])
        try await store.deleteDraft(d.id)
        #expect(try await store.draft(id: d.id) == nil)
        await expectStoreError(.notFound) { _ = try await store.updateDraft(d.id, DraftPatch(), now: 1) }
        await expectStoreError(.notFound) { _ = try await store.draftMeta(d.id) }
    }

    @Test func queuesScheduledSendsAndListsDueAndOpenOnes() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        let d = try await store.createDraft(NewDraft(accountId: s.account.id, from: "me@example.com", to: [StoreTestKit.person("Bo")], subject: "Later"), now: 1)
        let a = try await store.createScheduledSend(NewScheduledSend(draftId: d.id, sendAt: 1000), now: 1)
        let b = try await store.createScheduledSend(NewScheduledSend(draftId: d.id, sendAt: 5000, status: .awaitingApproval, requestedBy: "agent:claude"), now: 1)
        #expect(a.subject == "Later" && a.to == [StoreTestKit.person("Bo")] && a.status == .pending && a.requestedBy == "user" && a.attempts == 0)
        #expect(try await store.listDueScheduled(now: 999) == [])
        #expect(try await store.listDueScheduled(now: 1000).map(\.id) == [a.id])
        #expect(try await store.nextScheduledAt() == 1000)
        #expect(try await store.listScheduled().map(\.id) == [a.id, b.id])
        #expect(try await store.openScheduledSend(draftId: d.id)?.id == b.id)
        let failed = try await store.updateScheduled(a.id, ScheduledSendPatch(status: .failed, error: .some("SMTP down"), attempts: 3))
        #expect(failed.status == .failed && failed.error == "SMTP down" && failed.attempts == 3)
        let sent = try await store.updateScheduled(a.id, ScheduledSendPatch(status: .sent, error: .some(nil), messageId: .some("m@x")))
        #expect(sent.messageId == "m@x" && sent.error == nil)
        #expect(try await store.listScheduled().map(\.id) == [b.id])
        #expect(try await store.nextScheduledAt() == nil) // the remaining send awaits approval, so it is not armed
        _ = try await store.updateScheduled(b.id, ScheduledSendPatch(status: .cancelled))
        #expect(try await store.nextScheduledAt() == nil)
        await expectStoreError(.notFound) { _ = try await store.updateScheduled(999, ScheduledSendPatch()) }
        try await store.deleteDraft(d.id)
        #expect(try await store.listScheduled() == [])
    }

    @Test func remindersFireWhenNoOneElseReplied() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        let sent = try await store.ingestMessages(s.account.id, s.sent.id, [StoreTestKit.msg(1) {
            $0.messageId = "s@x"; $0.from = [StoreTestKit.me()]; $0.to = [StoreTestKit.person("Carla")]; $0.date = StoreTestKit.t0; $0.flags = StoreTestKit.seen
        }], context: IngestContext())[0]
        let r = try await store.createReminder(accountId: s.account.id, threadId: sent.threadId, messageId: "<s@x>", remindAt: StoreTestKit.t0 + StoreTestKit.day)
        #expect(r.messageId == "s@x" && r.status == .pending)
        #expect(try await store.listDueReminders(now: StoreTestKit.t0) == [])
        #expect(try await store.listDueReminders(now: StoreTestKit.t0 + StoreTestKit.day).map(\.id) == [r.id])
        #expect(try await store.nextReminderAt() == StoreTestKit.t0 + StoreTestKit.day)
        #expect(try await !store.threadHasReply(sent.threadId, since: StoreTestKit.t0))
        _ = try await store.ingestMessages(s.account.id, s.inbox.id, [StoreTestKit.msg(2) { $0.messageId = "r@x"; $0.references = ["s@x"]; $0.from = [StoreTestKit.person("Carla")]; $0.date = StoreTestKit.t0 + 1000 }], context: IngestContext())
        #expect(try await store.threadHasReply(sent.threadId, since: StoreTestKit.t0))
        try await store.setReminderStatus(r.id, .fired)
        #expect(try await store.listPendingReminders(limit: 50) == [])
        let r2 = try await store.createReminder(accountId: s.account.id, threadId: nil, messageId: "z@x", remindAt: 5)
        try await store.cancelReminders(accountId: s.account.id, messageId: "<z@x>")
        #expect(try await store.reminder(id: r2.id)?.status == .cancelled)
    }
}

@Suite("Store signatures and templates")
struct StoreLibraryTests {
    @Test func aSharedSignatureRoundTripsItsAccountsAndDefaultsClearOnlyWhereScopesOverlap() async throws {
        let store = try StoreTestKit.makeStore()
        var ids: [String] = []
        for n in ["a", "b", "c"] { ids.append(try await store.createAccount(StoreTestKit.newAccount("\(n)@x.co")).id) }
        let (a, b, c) = (ids[0], ids[1], ids[2])
        func sig(_ name: String, _ accounts: [String], id: Int = 0, defaultNew: Bool = true) -> Signature {
            Signature(id: id, name: name, html: "", accountIds: accounts, defaultNew: defaultNew, defaultReply: false)
        }
        let ab = try await store.saveSignature(sig("AB", [a, b, a]), now: 1)
        #expect(ab.accountIds == [a, b])
        let bOnly = try await store.saveSignature(sig("B", [b]), now: 1)
        let cOnly = try await store.saveSignature(sig("C", [c]), now: 1)
        func defaults() async throws -> [String] { try await store.listSignatures().filter(\.defaultNew).map(\.name) }
        #expect(try await defaults() == ["B", "C"])
        _ = try await store.saveSignature(sig("All", []), now: 1)
        #expect(try await defaults() == ["All"])
        var again = cOnly
        again.defaultNew = true
        _ = try await store.saveSignature(again, now: 1)
        #expect(try await defaults() == ["C"])
        #expect(try await store.signature(id: bOnly.id)?.accountIds == [b])
        await expectStoreError(.invalid) { _ = try await store.saveSignature(sig("x", [""]), now: 1) }
        try await store.deleteAccount(a)
        #expect(try await store.signature(id: ab.id)?.accountIds == [b])
        try await store.deleteAccount(b)
        #expect(try await store.signature(id: ab.id) == nil)
        #expect(try await store.signature(id: bOnly.id) == nil)
    }

    @Test func signaturesKeepOneDefaultPerScopeAndTemplatesRoundTrip() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        let a = try await store.saveSignature(Signature(id: 0, name: "Work", html: "<p>W</p>", accountIds: [s.account.id], defaultNew: true, defaultReply: false), now: 1)
        let b = try await store.saveSignature(Signature(id: 0, name: "Work 2", html: "<p>W2</p>", accountIds: [s.account.id], defaultNew: true, defaultReply: true), now: 1)
        #expect(try await store.listSignatures().map { [$0.name, String($0.defaultNew)] } == [["Work", "false"], ["Work 2", "true"]])
        var renamed = a
        renamed.name = "Renamed"
        #expect(try await store.saveSignature(renamed, now: 2).name == "Renamed")
        await expectStoreError(.invalid) { _ = try await store.saveSignature(Signature(id: 0, name: "", html: ""), now: 1) }
        var ghost = a
        ghost.id = 999
        await expectStoreError(.notFound, "no longer exists") { _ = try await store.saveSignature(ghost, now: 1) }
        try await store.deleteSignature(b.id)
        #expect(try await store.listSignatures().count == 1)

        let t = try await store.saveTemplate(Template(id: 0, name: "Intro", subject: "Hello", html: "<p>hi</p>"), now: 1)
        var edited = t
        edited.subject = "Hey"
        #expect(try await store.saveTemplate(edited, now: 2).subject == "Hey")
        #expect(try await store.listTemplates().count == 1)
        #expect(try await store.template(id: t.id)?.name == "Intro")
        await expectStoreError(.invalid) { _ = try await store.saveTemplate(Template(id: 0, name: "", html: ""), now: 1) }
        var ghostT = t
        ghostT.id = 999
        await expectStoreError(.notFound) { _ = try await store.saveTemplate(ghostT, now: 1) }
        try await store.deleteTemplate(t.id)
        #expect(try await store.listTemplates() == [])
    }
}
