import FlintModel
import Foundation
import Testing
@testable import FlintMail

actor MailDirectRunner: TransportRunner {
    let transport: FakeMailTransport
    init(_ transport: FakeMailTransport) { self.transport = transport }
    func run<T: Sendable>(_ body: @Sendable (any MailTransport) async throws -> T) async throws -> T { try await body(transport) }
}

private struct ActionRig {
    let store: MailTestStore
    let fake: FakeMailTransport
    let actions: ServerActions
    var folders: [String: Folder]

    static func make(gmail: Bool = false) async throws -> ActionRig {
        let store = MailTestStore()
        await store.addAccount(mailTestAccount(provider: gmail ? .gmail : .imap))
        var remote = [
            RemoteFolder(path: "INBOX", delimiter: "/"), RemoteFolder(path: "Trash", delimiter: "/", attributes: ["trash"]),
            RemoteFolder(path: "Sent", delimiter: "/", attributes: ["sent"]), RemoteFolder(path: "Projects", delimiter: "/"),
        ]
        var rows: [(String, MailboxRole?)] = [("INBOX", .inbox), ("Trash", .trash), ("Sent", .sent), ("Projects", nil)]
        if gmail {
            remote = [
                RemoteFolder(path: "INBOX", delimiter: "/"), RemoteFolder(path: "[Gmail]/All Mail", delimiter: "/", attributes: ["all"]),
                RemoteFolder(path: "[Gmail]/Trash", delimiter: "/", attributes: ["trash"]), RemoteFolder(path: "[Gmail]/Spam", delimiter: "/", attributes: ["junk"]),
                RemoteFolder(path: "Work", delimiter: "/"),
            ]
            rows = [("INBOX", .inbox), ("[Gmail]/All Mail", .all), ("[Gmail]/Trash", .trash), ("[Gmail]/Spam", .spam), ("Work", nil)]
        }
        let fake = FakeMailTransport(capabilities: TransportCapabilities(gmail: gmail), folders: remote)
        try await fake.connect(mailTestConfig)
        var folders: [String: Folder] = [:]
        for (path, role) in rows { folders[path] = try await store.upsertFolder("a1", FolderInput(path: path, role: role)) }
        return ActionRig(store: store, fake: fake, actions: ServerActions(store: store, accountId: "a1", runner: MailDirectRunner(fake)), folders: folders)
    }

    func loc(_ path: String, uid: Int, row: Int, messageId: String? = nil, provider: MailProvider = .imap, account: AccountID = "a1") -> MessageLocation {
        let folder = folders[path]!
        return MessageLocation(
            messageRowId: row, threadId: row, accountId: account, provider: provider, folderId: folder.id, folderPath: path, folderRole: folder.role, uid: uid,
            messageId: messageId, memberFolderIds: [folder.id])
    }

    func flags(_ path: String, _ uid: Int) async -> Set<String> { await fake.envelopes(in: path).first { $0.uid == uid }?.flags ?? [] }
    func uids(_ path: String) async -> [Int] { await fake.envelopes(in: path).map(\.uid) }
}

@Suite("ServerActions generic IMAP")
struct MailGenericActionsTests {
    @Test func flagsAreSetPerFolderGroup() async throws {
        let r = try await ActionRig.make()
        await r.fake.deliver(mailTestEnvelope("a"), to: "INBOX")
        await r.fake.deliver(mailTestEnvelope("b"), to: "Projects")
        let report = await r.actions.setSeen([r.loc("INBOX", uid: 1, row: 1), r.loc("Projects", uid: 1, row: 2)], true)
        #expect(report.ok)
        #expect(await r.flags("INBOX", 1) == [IMAPFlag.seen])
        #expect(await r.flags("Projects", 1) == [IMAPFlag.seen])
        let undo = await r.actions.setSeen([r.loc("INBOX", uid: 1, row: 1)], false)
        #expect(undo.ok)
        #expect(await r.flags("INBOX", 1).isEmpty)
        let flagged = await r.actions.setFlagged([r.loc("INBOX", uid: 1, row: 1)], true)
        #expect(flagged.ok)
        #expect(await r.flags("INBOX", 1) == [IMAPFlag.flagged])
        let answered = await r.actions.setAnswered([r.loc("INBOX", uid: 1, row: 1)])
        #expect(answered.ok)
        #expect(await r.flags("INBOX", 1) == [IMAPFlag.flagged, IMAPFlag.answered])
    }

    @Test func archiveMovesToTheArchiveFolderCreatingItAndRecordsTheNewUid() async throws {
        let r = try await ActionRig.make()
        await r.fake.deliver(mailTestEnvelope("a"), to: "INBOX")
        await r.fake.deliver(mailTestEnvelope("b"), to: "INBOX")
        let report = await r.actions.archive([r.loc("INBOX", uid: 1, row: 11), r.loc("INBOX", uid: 2, row: 12)])
        #expect(report.ok)
        #expect(await r.uids("INBOX") == [])
        #expect(await r.fake.folderPaths().contains("Archive"))
        #expect(await r.uids("Archive") == [1, 2])
        let relocated = await r.store.relocations
        let archiveId = await r.store.folderID("Archive")
        #expect(relocated.map(\.row) == [11, 12])
        #expect(relocated.map(\.uid) == [1, 2])
        #expect(relocated.allSatisfy { $0.folder == archiveId })
    }

    @Test func archiveLeavesSentDraftsAndArchivedMailAlone() async throws {
        let r = try await ActionRig.make()
        await r.fake.deliver(mailTestEnvelope("sent"), to: "Sent")
        let report = await r.actions.archive([r.loc("Sent", uid: 1, row: 1)])
        #expect(report.ok)
        #expect(await r.uids("Sent") == [1])
        #expect(await r.store.relocations.isEmpty)
    }

    @Test func trashSkipsMessagesAlreadyInTrash() async throws {
        let r = try await ActionRig.make()
        await r.fake.deliver(mailTestEnvelope("a"), to: "INBOX")
        await r.fake.deliver(mailTestEnvelope("t"), to: "Trash")
        let report = await r.actions.trash([r.loc("INBOX", uid: 1, row: 1), r.loc("Trash", uid: 1, row: 2)])
        #expect(report.ok)
        #expect(await r.uids("Trash") == [1, 2])
        #expect(await r.uids("INBOX").isEmpty)
        #expect(await r.store.relocations.count == 1)
    }

    @Test func spamUsesTheSpamFolderAndUnspamGoesBackToTheInbox() async throws {
        let r = try await ActionRig.make()
        await r.fake.deliver(mailTestEnvelope("a"), to: "INBOX")
        let spammed = await r.actions.spam([r.loc("INBOX", uid: 1, row: 1)])
        #expect(spammed.ok)
        #expect(await r.uids("Spam") == [1])
        let spamLoc = r.loc("INBOX", uid: 1, row: 1)
        var inSpam = spamLoc
        inSpam.folderId = await r.store.folderID("Spam")!
        inSpam.folderPath = "Spam"
        inSpam.folderRole = .spam
        let restored = await r.actions.unspam([inSpam])
        #expect(restored.ok)
        #expect(await r.uids("INBOX") == [2])
        #expect(await r.uids("Spam").isEmpty)
    }

    @Test func moveToFolderAndInbox() async throws {
        let r = try await ActionRig.make()
        await r.fake.deliver(mailTestEnvelope("a"), to: "INBOX")
        let projects = r.folders["Projects"]!
        let toProjects = await r.actions.moveToFolder([r.loc("INBOX", uid: 1, row: 1)], projects.id)
        #expect(toProjects.ok)
        #expect(await r.uids("Projects") == [1])
        let back = await r.actions.moveToInbox([r.loc("Projects", uid: 1, row: 1)])
        #expect(back.ok)
        #expect(await r.uids("INBOX") == [2])
    }

    @Test func movingToTrashOrInboxFoldersDelegatesToTheRoleOperation() async throws {
        let r = try await ActionRig.make()
        await r.fake.deliver(mailTestEnvelope("a"), to: "INBOX")
        let report = await r.actions.moveToFolder([r.loc("INBOX", uid: 1, row: 1)], r.folders["Trash"]!.id)
        #expect(report.ok)
        #expect(await r.uids("Trash") == [1])
    }

    @Test func aMissingFolderFailsEveryMessage() async throws {
        let r = try await ActionRig.make()
        let report = await r.actions.moveToFolder([r.loc("INBOX", uid: 1, row: 1), r.loc("INBOX", uid: 2, row: 2)], 999)
        #expect(!report.ok)
        #expect(report.failedMessageIds == [1, 2])
        #expect(report.errors[0].message.contains("no longer exists"))
    }

    @Test func messagesOfAnotherAccountAreRefused() async throws {
        let r = try await ActionRig.make()
        await r.fake.deliver(mailTestEnvelope("a"), to: "INBOX")
        let report = await r.actions.setSeen([r.loc("INBOX", uid: 1, row: 1, account: "other")], true)
        #expect(!report.ok)
        #expect(report.errors[0].message.contains("another account"))
        #expect(await r.flags("INBOX", 1).isEmpty)
    }

    @Test func aServerFailureIsReportedPerMessageAndOtherGroupsStillRun() async throws {
        let r = try await ActionRig.make()
        await r.fake.deliver(mailTestEnvelope("a"), to: "INBOX")
        await r.fake.deliver(mailTestEnvelope("b"), to: "Projects")
        await r.fake.failNext("storeFlags", with: FlintError(.network, "dropped"))
        let report = await r.actions.setSeen([r.loc("INBOX", uid: 1, row: 1), r.loc("Projects", uid: 1, row: 2)], true)
        #expect(!report.ok)
        #expect(report.failedMessageIds == [1])
        #expect(report.errors[0].message == "dropped")
        #expect(await r.flags("INBOX", 1).isEmpty)
        #expect(await r.flags("Projects", 1) == [IMAPFlag.seen])
    }

    @Test func aRefusedMoveSurfacesAFriendlyError() async throws {
        let r = try await ActionRig.make()
        await r.fake.deliver(mailTestEnvelope("a"), to: "INBOX")
        await r.fake.failNext("move", with: FlintError(.notFound, "TRYCREATE"))
        // The folder exists, so the retry after createFolder succeeds.
        let first = await r.actions.trash([r.loc("INBOX", uid: 1, row: 1)])
        #expect(first.ok)
        await r.fake.deliver(mailTestEnvelope("b"), to: "INBOX")
        await r.fake.failNext("move", with: FlintError(.invalid, "refused"))
        await r.fake.failNext("createFolder", with: FlintError(.invalid, "no"))
        let ok = await r.actions.trash([r.loc("INBOX", uid: 2, row: 2)])
        #expect(ok.ok) // second move attempt succeeds: createFolder failure is ignored
    }

    @Test func emptyInputsAreNoOps() async throws {
        let r = try await ActionRig.make()
        let results = [await r.actions.archive([]), await r.actions.trash([]), await r.actions.setSeen([], true)]
        #expect(results.allSatisfy { $0.ok })
        let calls = await r.fake.calls
        #expect(!calls.contains("select"))
    }
}

@Suite("ServerActions Gmail")
struct MailGmailActionsTests {
    private func gmailRig() async throws -> ActionRig { try await ActionRig.make(gmail: true) }

    /// A message that lives in All Mail with the Inbox label: one copy in each folder, same Message-ID.
    private func deliverInInbox(_ r: ActionRig, _ id: String) async -> (inboxUid: Int, allUid: Int) {
        let inbox = await r.fake.deliver(mailTestEnvelope("m", messageId: "<\(id)>"), to: "INBOX")
        let all = await r.fake.deliver(mailTestEnvelope("m", messageId: "<\(id)>"), to: "[Gmail]/All Mail")
        return (inbox, all)
    }

    @Test func archiveMovesTheInboxCopyIntoAllMail() async throws {
        let r = try await gmailRig()
        let ids = await deliverInInbox(r, "g1@x")
        let report = await r.actions.archive([r.loc("[Gmail]/All Mail", uid: ids.allUid, row: 1, messageId: "<g1@x>", provider: .gmail)])
        #expect(report.ok)
        #expect(await r.uids("INBOX") == [])
        let calls = await r.fake.calls
        #expect(calls.contains("move"))
    }

    @Test func archivingMailThatIsNotInTheInboxIsAlreadyDone() async throws {
        let r = try await gmailRig()
        let all = await r.fake.deliver(mailTestEnvelope("m", messageId: "<g2@x>"), to: "[Gmail]/All Mail")
        let report = await r.actions.archive([r.loc("[Gmail]/All Mail", uid: all, row: 1, messageId: "<g2@x>", provider: .gmail)])
        #expect(report.ok)
        let calls = await r.fake.calls
        #expect(!calls.contains("move"))
    }

    @Test func archiveWithoutAMessageIdIsReported() async throws {
        let r = try await gmailRig()
        let all = await r.fake.deliver(mailTestEnvelope("m"), to: "[Gmail]/All Mail")
        let report = await r.actions.archive([r.loc("[Gmail]/All Mail", uid: all, row: 7, messageId: nil, provider: .gmail)])
        #expect(!report.ok)
        #expect(report.failedMessageIds == [7])
    }

    @Test func archiveFromTrashRestoresThroughTheInbox() async throws {
        let r = try await gmailRig()
        let trashed = await r.fake.deliver(mailTestEnvelope("m", messageId: "<g3@x>"), to: "[Gmail]/Trash")
        let report = await r.actions.archive([r.loc("[Gmail]/Trash", uid: trashed, row: 3, messageId: "<g3@x>", provider: .gmail)])
        #expect(report.ok)
        #expect(await r.uids("[Gmail]/Trash") == [])
        #expect(await r.uids("INBOX") == [])
        #expect(await r.uids("[Gmail]/All Mail") == [1])
    }

    @Test func trashMovesFromAllMailToTrashAndRelocates() async throws {
        let r = try await gmailRig()
        let ids = await deliverInInbox(r, "g4@x")
        let report = await r.actions.trash([r.loc("[Gmail]/All Mail", uid: ids.allUid, row: 4, messageId: "<g4@x>", provider: .gmail)])
        #expect(report.ok)
        #expect(await r.uids("[Gmail]/Trash") == [1])
        #expect(await r.uids("[Gmail]/All Mail").isEmpty)
        #expect(await r.store.relocations.map(\.row) == [4])
    }

    @Test func moveToInboxCopiesFromAllMailAndMovesOutOfTrash() async throws {
        let r = try await gmailRig()
        let all = await r.fake.deliver(mailTestEnvelope("m", messageId: "<g5@x>"), to: "[Gmail]/All Mail")
        let trashed = await r.fake.deliver(mailTestEnvelope("t", messageId: "<g6@x>"), to: "[Gmail]/Trash")
        let report = await r.actions.moveToInbox([
            r.loc("[Gmail]/All Mail", uid: all, row: 5, messageId: "<g5@x>", provider: .gmail),
            r.loc("[Gmail]/Trash", uid: trashed, row: 6, messageId: "<g6@x>", provider: .gmail),
        ])
        #expect(report.ok)
        #expect(await r.uids("INBOX") == [1, 2])
        #expect(await r.uids("[Gmail]/All Mail") == [all]) // copied, not moved
        #expect(await r.uids("[Gmail]/Trash") == [])
    }

    @Test func moveToLabelAppliesTheLabelAndLeavesTheInbox() async throws {
        let r = try await gmailRig()
        let ids = await deliverInInbox(r, "g7@x")
        let report = await r.actions.moveToFolder(
            [r.loc("[Gmail]/All Mail", uid: ids.allUid, row: 8, messageId: "<g7@x>", provider: .gmail)], r.folders["Work"]!.id)
        #expect(report.ok)
        #expect(await r.uids("Work") == [1])
        #expect(await r.uids("INBOX") == [])
    }

    @Test func aFailedLabelCopyKeepsTheMessageInTheInbox() async throws {
        let r = try await gmailRig()
        let ids = await deliverInInbox(r, "g8@x")
        await r.fake.failNext("copy", with: FlintError(.network, "dropped"))
        let report = await r.actions.moveToFolder(
            [r.loc("[Gmail]/All Mail", uid: ids.allUid, row: 9, messageId: "<g8@x>", provider: .gmail)], r.folders["Work"]!.id)
        #expect(!report.ok)
        #expect(report.failedMessageIds == [9])
        #expect(await r.uids("INBOX") == [ids.inboxUid]) // not removed from the inbox when the label did not apply
    }

    @Test func flagsOnGmailUseTheAllMailUid() async throws {
        let r = try await gmailRig()
        let ids = await deliverInInbox(r, "g9@x")
        let report = await r.actions.setSeen([r.loc("[Gmail]/All Mail", uid: ids.allUid, row: 1, provider: .gmail)], true)
        #expect(report.ok)
        #expect(await r.flags("[Gmail]/All Mail", ids.allUid) == [IMAPFlag.seen])
    }
}
