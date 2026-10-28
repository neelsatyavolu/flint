import FlintModel
import Foundation
import Testing
@testable import FlintMail

private let me = Address(name: "Me", address: "me@test.local")
private func pixel(_ html: String, _ token: String) -> String { html.replacingOccurrences(of: "<body>", with: "<body><img src=\"https://r.example/i/\(token).gif\">") }

private struct MailerRig {
    let fake: FakeMailTransport
    let mailer: Mailer
    let sentCopy: SentCopy
    let slept: MailSleepLog

    static func make(gmail: Bool = false, folders: [RemoteFolder] = [RemoteFolder(path: "INBOX", delimiter: "/"), RemoteFolder(path: "Sent", delimiter: "/", attributes: ["sent"])],
                     onSleep: @escaping @Sendable (Int) async -> Void = { _ in }) async throws -> MailerRig {
        let fake = FakeMailTransport(capabilities: TransportCapabilities(gmail: gmail), folders: folders)
        try await fake.connect(mailTestConfig)
        let log = MailSleepLog()
        let sentCopy = SentCopy(runner: MailDirectRunner(fake), sleep: { ms in log.add(ms); await onSleep(ms) })
        let mailer = Mailer(smtp: { try await fake.send($0) }, sentCopy: sentCopy)
        return MailerRig(fake: fake, mailer: mailer, sentCopy: sentCopy, slept: log)
    }

    func input(to: [String] = ["ann@example.org"], cc: [String] = [], bcc: [String] = [], html: String = "<body><p>hi</p></body>") -> MimeInput {
        MimeInput(from: me, to: to.map { Address(address: $0) }, cc: cc.map { Address(address: $0) }, bcc: bcc.map { Address(address: $0) }, subject: "Hello", html: html)
    }

    func sentUids() async -> [Int] { await fake.envelopes(in: "Sent").map(\.uid) }
}

final class MailSleepLog: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [Int] = []
    func add(_ ms: Int) { lock.lock(); storage.append(ms); lock.unlock() }
    var values: [Int] { lock.lock(); defer { lock.unlock() }; return storage }
}

@Suite("Mailer untracked")
struct MailUntrackedSendTests {
    @Test func oneEnvelopeForEveryoneWithoutABccHeaderThenACleanSentCopy() async throws {
        let r = try await MailerRig.make()
        let folders = SentFolders(provider: .imap, sentPath: "Sent", delaysMs: [0])
        let out = try await r.mailer.sendUntracked(r.input(to: ["a@x.org"], cc: ["c@x.org"], bcc: ["secret@x.org", "a@x.org"]), folders: folders)
        let sent = await r.fake.sentMessages
        #expect(sent.count == 1 && out.copies == 1 && out.failed.isEmpty)
        #expect(sent[0].envelopeFrom == "me@test.local")
        #expect(sent[0].recipients == ["a@x.org", "c@x.org", "secret@x.org"])
        #expect(MailParsedMime.parse(sent[0].raw).header("bcc") == nil)
        #expect(MailParsedMime.parse(sent[0].raw).header("message-id") == "<\(out.messageId)>")

        // The Sent copy is ours: it keeps Bcc, carries \Seen, and has the same Message-ID.
        let stored = await r.fake.envelopes(in: "Sent")
        #expect(stored.count == 1 && stored[0].flags == [IMAPFlag.seen] && out.sent == SentLocation(path: "Sent", uid: stored[0].uid))
        let raw = try await selectedRaw(r.fake, "Sent", stored[0].uid)
        #expect(MailParsedMime.parse(raw).header("bcc") == "secret@x.org, a@x.org")
        #expect(MailParsedMime.parse(raw).header("message-id") == "<\(out.messageId)>")
    }

    @Test func aServerSavedCopyOfAnUntrackedMessageIsKept() async throws {
        let r = try await MailerRig.make(onSleep: { _ in })
        let folders = SentFolders(provider: .imap, sentPath: "Sent", delaysMs: [0])
        var message = r.input()
        message.messageId = "fixed@test.local"
        await r.fake.deliver(mailTestEnvelope("Hello", messageId: "<fixed@test.local>"), to: "Sent") // the server filed its own copy
        let out = try await r.mailer.sendUntracked(message, folders: folders)
        #expect(await r.sentUids() == [1] && out.sent == SentLocation(path: "Sent", uid: 1))
        #expect(!(await r.fake.calls.contains("append")))
    }

    @Test func rejectsAMessageWithNoRecipients() async throws {
        let r = try await MailerRig.make()
        await #expect(throws: FlintError.self) { try await r.mailer.sendUntracked(r.input(to: []), folders: SentFolders(provider: .imap, sentPath: "Sent", delaysMs: [0])) }
        #expect(await r.fake.sentMessages.isEmpty)
    }

    @Test func aSmtpFailureThrowsAndFilesNothing() async throws {
        let r = try await MailerRig.make()
        await r.fake.rejectLogins()
        await #expect(throws: FlintError.self) { try await r.mailer.sendUntracked(r.input(), folders: SentFolders(provider: .imap, sentPath: "Sent", delaysMs: [0])) }
        #expect(await r.sentUids().isEmpty)
    }

    @Test func aMissingSentFolderIsCreatedByTheAppend() async throws {
        let r = try await MailerRig.make(folders: [RemoteFolder(path: "INBOX", delimiter: "/")])
        let out = try await r.mailer.sendUntracked(r.input(), folders: SentFolders(provider: .imap, sentPath: "Sent", delaysMs: [0]))
        #expect(await r.fake.folderPaths().contains("Sent") && out.sent?.uid == 1)
    }

    @Test func noSentFolderAnywhereIsReportedButTheMailStillWentOut() async throws {
        let r = try await MailerRig.make(folders: [RemoteFolder(path: "INBOX", delimiter: "/")])
        let out = try await r.mailer.sendUntracked(r.input(), folders: SentFolders(provider: .imap, sentPath: nil, delaysMs: [0]))
        #expect(out.sent == nil && out.copies == 1)
        #expect(await r.fake.sentMessages.count == 1)
    }

    @Test func specialUseSentIsFoundWhenNoPathIsGiven() async throws {
        let r = try await MailerRig.make(folders: [RemoteFolder(path: "INBOX", delimiter: "/"), RemoteFolder(path: "Envoyés", delimiter: "/", attributes: ["sent"])])
        let out = try await r.mailer.sendUntracked(r.input(), folders: SentFolders(provider: .imap, sentPath: nil, delaysMs: [0]))
        #expect(out.sent?.path == "Envoyés")
    }

    @Test func aMissingAttachmentStopsBeforeSmtp() async throws {
        let r = try await MailerRig.make()
        var message = r.input()
        message.attachments = [DraftAttachment(id: "1", filename: "gone.pdf", contentType: "application/pdf", size: 1, path: "/nonexistent/gone.pdf")]
        await #expect(throws: FlintError.self) { try await r.mailer.sendUntracked(message, folders: SentFolders(provider: .imap, sentPath: "Sent", delaysMs: [0])) }
        #expect(await r.fake.sentMessages.isEmpty)
    }
}

private func selectedRaw(_ fake: FakeMailTransport, _ path: String, _ uid: Int) async throws -> Data {
    _ = try await fake.select(path, readOnly: true, qresync: nil)
    return try await fake.fetchRawMessage(uid: uid)
}

@Suite("Mailer tracked")
struct MailTrackedSendTests {
    @Test func everyTrackedRecipientGetsItsOwnCopyDifferingOnlyInThePixel() async throws {
        let r = try await MailerRig.make()
        let folders = SentFolders(provider: .imap, sentPath: "Sent", delaysMs: [0])
        let out = try await r.mailer.sendTracked(
            r.input(to: ["a@x.org", "b@x.org"], cc: ["me@test.local"], bcc: ["hidden@x.org"]), folders: folders,
            tracked: [TrackedRecipient(address: "a@x.org", token: "TOKENAAAAAAAAAAAAAAAAA"), TrackedRecipient(address: "b@x.org", token: "TOKENBBBBBBBBBBBBBBBBB")],
            untracked: ["me@test.local"], injectPixel: pixel)
        let sent = await r.fake.sentMessages
        #expect(sent.map(\.recipients) == [["a@x.org"], ["b@x.org"], ["me@test.local"]])
        #expect(out.copies == 3 && out.failed.isEmpty)
        let parsed = sent.map { MailParsedMime.parse($0.raw) }
        #expect(Set(parsed.compactMap { $0.header("message-id") }).count == 1) // one Message-ID for all copies
        #expect(parsed.allSatisfy { $0.header("bcc") == nil })
        #expect(parsed[0].parts[1].text.contains("TOKENAAAAAAAAAAAAAAAAA.gif") && !parsed[0].parts[1].text.contains("TOKENBBB"))
        #expect(parsed[1].parts[1].text.contains("TOKENBBBBBBBBBBBBBBBBB.gif"))
        #expect(!parsed[2].parts[1].text.contains("/i/")) // the clean copy
        #expect(parsed[0].parts[0].text == parsed[1].parts[0].text) // same text alternative
    }

    @Test func theSentCopyIsCleanAndAnyServerSavedPixelCopyIsRemoved() async throws {
        let r = try await MailerRig.make()
        let folders = SentFolders(provider: .imap, sentPath: "Sent", delaysMs: [0])
        var message = r.input(to: ["a@x.org"])
        message.messageId = "trk@test.local"
        // The server filed the first (pixel) copy in Sent; the fix-up must replace it with the clean one.
        await r.fake.deliver(mailTestEnvelope("Hello", messageId: "<trk@test.local>"), to: "Sent")
        _ = try await r.mailer.sendTracked(message, folders: folders, tracked: [TrackedRecipient(address: "a@x.org", token: "T")], untracked: [], injectPixel: pixel)
        let stored = await r.fake.envelopes(in: "Sent")
        #expect(stored.count == 1 && stored[0].uid == 2)
        let raw = MailParsedMime.parse(try await selectedRaw(r.fake, "Sent", 2))
        #expect(!raw.parts[1].text.contains("/i/"))
    }

    @Test func oneFailedRecipientDoesNotStopTheOthers() async throws {
        let r = try await MailerRig.make()
        await r.fake.failNext("send", with: FlintError(.invalid, "The server refused the message."))
        let out = try await r.mailer.sendTracked(
            r.input(to: ["a@x.org", "b@x.org"]), folders: SentFolders(provider: .imap, sentPath: "Sent", delaysMs: [0]),
            tracked: [TrackedRecipient(address: "a@x.org", token: "A"), TrackedRecipient(address: "b@x.org", token: "B")], untracked: [], injectPixel: pixel)
        #expect(out.copies == 1)
        #expect(out.failed == [SendOutcome.Failure(address: "a@x.org", error: "The server refused the message.")])
        #expect(await r.fake.sentMessages.map(\.recipients) == [["b@x.org"]])
    }

    @Test func failingForEveryoneThrows() async throws {
        let r = try await MailerRig.make()
        await r.fake.rejectLogins()
        await #expect(throws: FlintError.self) {
            try await r.mailer.sendTracked(r.input(), folders: SentFolders(provider: .imap, sentPath: "Sent", delaysMs: [0]), tracked: [TrackedRecipient(address: "ann@example.org", token: "A")], untracked: [], injectPixel: pixel)
        }
        #expect(await r.sentUids().isEmpty)
    }

    @Test func noRecipientsAtAllIsInvalid() async throws {
        let r = try await MailerRig.make()
        await #expect(throws: FlintError.self) { try await r.mailer.sendTracked(r.input(), folders: SentFolders(provider: .imap, sentPath: "Sent"), tracked: [], untracked: [], injectPixel: pixel) }
    }
}

@Suite("Sent copy")
struct MailSentCopyTests {
    @Test func aCopyTheServerFilesLateIsFoundOnTheNextLookAndReplaced() async throws {
        let box = MailFakeBox()
        let r = try await MailerRig.make(onSleep: { ms in if ms == 5 { await box.deliverLate() } })
        await box.set(r.fake)
        let folders = SentFolders(provider: .imap, sentPath: "Sent", delaysMs: [0, 5])
        let location = try await r.sentCopy.file(folders: folders, messageId: "late@test.local", cleanMime: Data("From: me@test.local\r\nMessage-ID: <late@test.local>\r\nSubject: x\r\n\r\nclean\r\n".utf8))
        #expect(r.slept.values == [5])
        let stored = await r.fake.envelopes(in: "Sent")
        #expect(stored.count == 1 && location.uid == stored[0].uid) // the late copy was found first, deleted, and ours appended
        #expect(stored[0].flags == [IMAPFlag.seen])
    }

    @Test func aCopyFiledAfterOurAppendIsRemovedByTheBackgroundRecheck() async throws {
        let box = MailFakeBox()
        let r = try await MailerRig.make(onSleep: { ms in if ms == 2500 { await box.deliverLate(id: "re@test.local") } })
        await box.set(r.fake)
        // Default schedule: the re-check runs in the background after a pause, and by then the server has filed its own copy.
        let folders = SentFolders(provider: .imap, sentPath: "Sent")
        let location = try await r.sentCopy.file(folders: folders, messageId: "re@test.local", cleanMime: Data("Message-ID: <re@test.local>\r\nSubject: x\r\n\r\nclean\r\n".utf8))
        #expect(location.uid == 1)
        #expect(await mailEventually { await r.fake.envelopes(in: "Sent").map(\.uid) == [1] && r.slept.values.contains(2500) })
    }

    @Test func gmailKeepsTheCopyThatIsAlsoInTheInboxAndNeverAppendsASecond() async throws {
        let r = try await MailerRig.make(gmail: true, folders: [
            RemoteFolder(path: "INBOX", delimiter: "/"), RemoteFolder(path: "[Gmail]/Sent Mail", delimiter: "/", attributes: ["sent"]), RemoteFolder(path: "[Gmail]/Trash", delimiter: "/", attributes: ["trash"]),
        ])
        let uid = await r.fake.deliver(mailTestEnvelope("self", messageId: "<g1@test.local>", gmail: GmailAttributes(msgid: "1", thrid: "1", labels: ["\\Inbox", "\\Sent"])), to: "[Gmail]/Sent Mail")
        let folders = SentFolders(provider: .gmail, sentPath: "[Gmail]/Sent Mail", trashPath: "[Gmail]/Trash", delaysMs: [0])
        let location = try await r.sentCopy.file(folders: folders, messageId: "g1@test.local", cleanMime: Data("Message-ID: <g1@test.local>\r\n\r\nx".utf8))
        #expect(location == SentLocation(path: "[Gmail]/Sent Mail", uid: uid))
        #expect(!(await r.fake.calls.contains("append")))
    }

    @Test func gmailDeletesAServerCopyThroughTrashAndAppendsTheCleanOne() async throws {
        let r = try await MailerRig.make(gmail: true, folders: [
            RemoteFolder(path: "INBOX", delimiter: "/"), RemoteFolder(path: "[Gmail]/Sent Mail", delimiter: "/", attributes: ["sent"]), RemoteFolder(path: "[Gmail]/Trash", delimiter: "/", attributes: ["trash"]),
        ])
        await r.fake.deliver(mailTestEnvelope("out", messageId: "<g2@test.local>", gmail: GmailAttributes(msgid: "2", thrid: "2", labels: ["\\Sent"])), to: "[Gmail]/Sent Mail")
        let folders = SentFolders(provider: .gmail, sentPath: "[Gmail]/Sent Mail", trashPath: "[Gmail]/Trash", delaysMs: [0])
        let location = try await r.sentCopy.file(folders: folders, messageId: "g2@test.local", cleanMime: Data("Message-ID: <g2@test.local>\r\n\r\nclean".utf8))
        #expect(await r.fake.envelopes(in: "[Gmail]/Trash").isEmpty) // moved there, then deleted for good
        #expect(await r.fake.envelopes(in: "[Gmail]/Sent Mail").count == 1 && location.uid == 2)
    }

    @Test func draftsAreAppendedBeforeThePreviousCopyIsRemoved() async throws {
        let r = try await MailerRig.make(folders: [RemoteFolder(path: "INBOX", delimiter: "/"), RemoteFolder(path: "Drafts", delimiter: "/", attributes: ["drafts"])])
        let runner = MailDirectRunner(r.fake)
        let first = try await Mailer.replaceDraft(runner: runner, draftsPath: "Drafts", previousUid: nil, mime: Data("Message-ID: <d1@x>\r\n\r\none".utf8))
        let second = try await Mailer.replaceDraft(runner: runner, draftsPath: "Drafts", previousUid: first, mime: Data("Message-ID: <d1@x>\r\n\r\ntwo".utf8))
        let stored = await r.fake.envelopes(in: "Drafts")
        #expect(first == 1 && second == 2 && stored.map(\.uid) == [2])
        #expect(stored[0].flags == [IMAPFlag.draft, IMAPFlag.seen])
        let calls = await r.fake.calls
        #expect(calls.firstIndex(of: "expunge")! > calls.lastIndex(of: "append")!) // append first, delete after
        try await Mailer.deleteDraft(runner: runner, draftsPath: "Drafts", uid: 2)
        #expect(await r.fake.envelopes(in: "Drafts").isEmpty)
    }
}

actor MailFakeBox {
    private var fake: FakeMailTransport?
    func set(_ fake: FakeMailTransport) { self.fake = fake }
    func deliverLate(id: String = "late@test.local") async {
        await fake?.deliver(mailTestEnvelope("late", messageId: "<\(id)>"), to: "Sent")
    }
}
