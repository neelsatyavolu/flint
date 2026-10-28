import FlintModel
import FlintStore
import Foundation
import Testing
@testable import FlintMail

private struct DraftsRig {
    let store: MailTestStore
    let fake: FakeMailTransport
    let log: MailEventLog
    let drafts: ServerDrafts
    let folder: Folder

    static func make(delay: Duration = .milliseconds(40)) async throws -> DraftsRig {
        let store = MailTestStore()
        await store.addAccount(mailTestAccount())
        let fake = FakeMailTransport(folders: [RemoteFolder(path: "INBOX", delimiter: "/"), RemoteFolder(path: "Drafts", delimiter: "/", attributes: ["drafts"])])
        try await fake.connect(mailTestConfig)
        let folder = try await store.upsertFolder("a1", FolderInput(path: "Drafts", role: .drafts))
        let log = MailEventLog()
        let runner = MailDirectRunner(fake)
        let drafts = ServerDrafts(store: store, runner: { _ in runner }, emit: { log.add($0) }, delay: delay, now: { Date(timeIntervalSince1970: 1_800_000_000) })
        return DraftsRig(store: store, fake: fake, log: log, drafts: drafts, folder: folder)
    }

    func addDraft(subject: String = "Plan", html: String = "<p>body</p>") async {
        await store.addDraft(Draft(id: 1, accountId: "a1", from: "me@test.local", to: [Address(address: "ann@x.org")], subject: subject, html: html))
    }
}

@Suite("ServerDrafts")
struct MailServerDraftsTests {
    @Test func flushUploadsADraftCopyWithDraftAndSeenFlags() async throws {
        let r = try await DraftsRig.make()
        await r.addDraft()
        await r.drafts.flush(1)
        let stored = await r.fake.envelopes(in: "Drafts")
        #expect(stored.count == 1 && stored[0].flags == [IMAPFlag.draft, IMAPFlag.seen])
        let meta = try await r.store.draftMeta(1)
        #expect(meta.serverUid == stored[0].uid && meta.serverMessageId != nil)
        #expect(stored[0].messageId == "<\(meta.serverMessageId!)>")
    }

    @Test func aSecondUploadReplacesTheCopyAndDropsTheLocalMirrorOfTheOldOne() async throws {
        let r = try await DraftsRig.make()
        await r.addDraft()
        await r.drafts.flush(1)
        let first = try await r.store.draftMeta(1)
        // The old copy was synced into the store as a draft message.
        await r.store.addMessage(StoredMessage(id: 30, accountId: "a1", threadId: 3, folderId: r.folder.id, uid: first.serverUid!, messageId: "<\(first.serverMessageId!)>", date: mailTestNow, draft: true))
        _ = try await r.store.updateDraft(1, DraftPatch(subject: "Plan v2"), now: mailTestNow)
        await r.drafts.flush(1)
        let stored = await r.fake.envelopes(in: "Drafts")
        #expect(stored.count == 1) // exactly one copy remains
        #expect(stored[0].uid != first.serverUid)
        #expect(try await r.store.message(id: 30) == nil)
        #expect(r.log.changes == [[3]])
    }

    @Test func blankDraftsAreNotUploaded() async throws {
        let r = try await DraftsRig.make()
        await r.store.addDraft(Draft(id: 1, accountId: "a1", from: "me@test.local", html: "<p><br></p>"))
        await r.drafts.flush(1)
        #expect(await r.fake.envelopes(in: "Drafts").isEmpty)
    }

    @Test func removeDeletesTheServerCopy() async throws {
        let r = try await DraftsRig.make()
        await r.addDraft()
        await r.drafts.flush(1)
        await r.drafts.remove(1)
        #expect(await r.fake.envelopes(in: "Drafts").isEmpty)
    }

    @Test func editsAreBatchedIntoOneUploadAfterTheDelay() async throws {
        let r = try await DraftsRig.make(delay: .milliseconds(60))
        await r.addDraft()
        await r.drafts.touch(1)
        await r.drafts.touch(1)
        await r.drafts.touch(1)
        #expect(await r.fake.envelopes(in: "Drafts").isEmpty) // not yet
        #expect(await mailEventually { await r.fake.envelopes(in: "Drafts").count == 1 })
        try await Task.sleep(for: .milliseconds(150))
        #expect(await r.fake.calls.filter { $0 == "append" }.count == 1)
    }

    @Test func removeCancelsAPendingUpload() async throws {
        let r = try await DraftsRig.make(delay: .milliseconds(60))
        await r.addDraft()
        await r.drafts.touch(1)
        await r.drafts.remove(1)
        try await Task.sleep(for: .milliseconds(150))
        #expect(await r.fake.envelopes(in: "Drafts").isEmpty)
    }
}
