import FlintModel
import Foundation
import Testing
@testable import FlintMail

/// SwiftMailTransport against a real IMAP/SMTP server (GreenMail). Runs only with FLINT_GREENMAIL=1.
@Suite("GreenMail transport", .enabled(if: mailGreenMailEnabled), .serialized)
struct MailGreenMailTransportTests {
    private func setup() async throws -> (MailGreenMailServer, String, SwiftMailTransport) {
        let (server, user) = try await MailSharedGreenMail.shared.freshUser()
        return (server, user, try await server.connect(user))
    }

    @Test func connectsAuthenticatesAndReportsCapabilities() async throws {
        let (_, _, t) = try await setup()
        #expect(await t.isConnected)
        let caps = await t.capabilities
        #expect(caps.idle && caps.move && caps.uidPlus && !caps.condstore && !caps.qresync && !caps.gmail)
        let folders = try await t.listFolders()
        #expect(folders.contains { $0.path == "INBOX" })
        await t.disconnect()
        #expect(await !t.isConnected)
    }

    @Test func aWrongPasswordIsAnAuthError() async throws {
        let (server, user) = try await MailSharedGreenMail.shared.freshUser()
        let t = SwiftMailTransport()
        do {
            try await t.connect(MailTransportConfiguration(server: server.server(for: user), credential: .password(user: user, password: "wrong")))
            Issue.record("should throw")
        } catch let error as FlintError {
            #expect(error.code == .auth && !error.message.contains("wrong"))
        }
    }

    @Test func aClosedPortIsANetworkError() async throws {
        let t = SwiftMailTransport()
        let server = ServerConfig(imapHost: "127.0.0.1", imapPort: 1, imapSecure: false, smtpHost: "127.0.0.1", smtpPort: 1, smtpSecure: false, username: "x")
        do {
            try await t.connect(MailTransportConfiguration(server: server, credential: .password(user: "x", password: "y")))
            Issue.record("should throw")
        } catch let error as FlintError { #expect(error.code == .network) }
    }

    @Test func selectEnvelopesStructureAndPartsRoundTrip() async throws {
        let (server, user, t) = try await setup()
        let attachment = FileManager.default.temporaryDirectory.appendingPathComponent("gm-\(UUID().uuidString).txt")
        try Data("attached bytes".utf8).write(to: attachment)
        defer { try? FileManager.default.removeItem(at: attachment) }
        let id = try await server.deliver(
            to: user, subject: "Café ünï — 日本", from: "Zoë <zoe@remote.example>", html: "<p>Héllo <b>wörld</b></p>", text: "Héllo wörld",
            headers: ["List-Id": "<news.remote.example>", "X-Flint-Ref": "ref-1"],
            attachments: [DraftAttachment(id: "1", filename: "notes.txt", contentType: "text/plain", size: 14, path: attachment.path)],
            inReplyTo: "<parent@remote.example>", references: ["root@remote.example", "parent@remote.example"])
        try await Task.sleep(for: .milliseconds(300))

        let selected = try await t.select("INBOX", readOnly: true, qresync: nil)
        #expect(selected.mailbox.exists == 1 && selected.mailbox.uidNext == 2 && selected.mailbox.uidValidity > 0 && !selected.resynced)
        let uids = try await t.search(.all)
        #expect(uids == [1])
        let env = try #require(try await t.fetchEnvelopes(.uids(uids), options: EnvelopeFetchOptions(bodyStructure: true, headers: MailHeaders.fetchHeaders)).first)
        #expect(env.uid == 1 && env.size > 100 && env.messageId == "<\(id)>")
        #expect(env.subject == "Café ünï — 日本")
        #expect(env.from.first?.address == "zoe@remote.example")
        #expect(env.to.first?.address == server.email(user))
        #expect(env.headers["list-id"] == "<news.remote.example>" && env.headers["x-flint-ref"] == "ref-1")
        #expect(env.headers["content-type"] == nil) // only the requested headers come back
        #expect(MailHeaders.parseReferences(env.headers["references"]) == ["root@remote.example", "parent@remote.example"])
        #expect(env.inReplyTo == "<parent@remote.example>")
        #expect(env.internalDate != nil && !env.flags.contains(IMAPFlag.seen))

        #expect(env.bodyStructure != nil)
        let info = BodyStructureWalker.walk(env.bodyStructure)
        #expect(info.text.map(\.type) == ["text/plain", "text/html"])
        #expect(info.attachments.map(\.filename) == ["notes.txt"] && info.hasRealAttachments)

        // Parts come back with the transfer encoding removed; the charset is ours to convert.
        let body = try await BodyLoader.load(t, uid: 1, structure: env.bodyStructure)
        #expect(body?.text == "Héllo wörld")
        #expect(body?.html?.contains("<b>wörld</b>") == true)
        let file = try await t.fetchPart(uid: 1, part: info.attachments[0].part)
        #expect(file == Data("attached bytes".utf8))
        let raw = try await t.fetchRawMessage(uid: 1)
        #expect(String(decoding: raw, as: UTF8.self).contains("Message-ID: <\(id)>"))
        #expect(try await t.fetchBodyStructure(uid: 1)?.children.isEmpty == false)
    }

    @Test func flagsMoveCopyAppendSearchAndExpunge() async throws {
        let (server, user, t) = try await setup()
        for i in 1...3 { _ = try await server.deliver(to: user, subject: "m\(i)", messageId: "m\(i)@x.test") }
        try await Task.sleep(for: .milliseconds(300))
        _ = try await t.select("INBOX", readOnly: false, qresync: nil)

        try await t.storeFlags(.uids([1, 2]), flags: [IMAPFlag.seen, IMAPFlag.flagged], mode: .add)
        try await t.storeFlags(.uids([2]), flags: [IMAPFlag.flagged], mode: .remove)
        let flags = Dictionary(uniqueKeysWithValues: try await t.fetchFlags(.range(from: 1, to: nil), includeLabels: false, changedSince: nil).map { ($0.uid, $0.flags) })
        #expect(flags[1]?.isSuperset(of: [IMAPFlag.seen, IMAPFlag.flagged]) == true)
        #expect(flags[2]?.contains(IMAPFlag.seen) == true && flags[2]?.contains(IMAPFlag.flagged) == false)
        #expect(flags[3]?.contains(IMAPFlag.seen) == false)
        #expect(try await t.search(.unseen) == [3])
        #expect(try await t.search(.flagged) == [1])
        #expect(try await t.search(.header(name: "message-id", value: "m2@x.test")) == [2])
        #expect(try await t.search(.and([.seen, .not(.flagged)])) == [2])
        #expect(try await t.search(.uid(.range(from: 2, to: nil))) == [2, 3])
        #expect(try await t.search(.since(Date().addingTimeInterval(-86_400))) == [1, 2, 3])
        #expect(try await t.search(.before(Date().addingTimeInterval(-86_400))).isEmpty)

        try await t.createFolder("Archive")
        let moved = try await t.move(.uids([1]), to: "Archive")
        #expect(moved.count == 1)
        let copied = try await t.copy(.uids([2]), to: "Archive")
        #expect(copied.count == 1)
        #expect(try await t.search(.all) == [2, 3])

        let sent = Data("From: x@y.test\r\nTo: z@y.test\r\nSubject: filed\r\nMessage-ID: <filed@y.test>\r\n\r\nbody\r\n".utf8)
        let appended = try await t.append(sent, to: "Archive", flags: [IMAPFlag.seen], date: nil)
        #expect(appended != nil)
        _ = try await t.select("Archive", readOnly: false, qresync: nil)
        let archived = try await t.search(.all)
        #expect(archived.count == 3)
        try await t.expunge(.uids([appended!]))
        #expect(try await t.search(.all).count == 2)

        // A missing mailbox is notFound.
        do { _ = try await t.select("Nope", readOnly: true, qresync: nil); Issue.record("should throw") } catch let error as FlintError { #expect(error.code == .notFound) }
        // Moving to a mailbox that does not exist is a refusal the engine can retry after creating it.
        _ = try await t.select("INBOX", readOnly: false, qresync: nil)
        do { _ = try await t.move(.uids([3]), to: "Missing/Folder"); Issue.record("should throw") } catch let error as FlintError { #expect(error.code == .invalid || error.code == .notFound) }
    }

    @Test func idleWakesWhenMailArrives() async throws {
        let (server, user, t) = try await setup()
        let stream = await t.idle(mailbox: "INBOX")
        let wake = Task { () -> Bool in
            for await event in stream { if case .newMessages = event { return true } }
            return false
        }
        try await Task.sleep(for: .milliseconds(800))
        _ = try await server.deliver(to: user, subject: "ping")
        let hit = await withTaskGroup(of: Bool.self) { group -> Bool in
            group.addTask { await wake.value }
            group.addTask { try? await Task.sleep(for: .seconds(10)); return false }
            let first = await group.next() ?? false
            group.cancelAll()
            return first
        }
        #expect(hit)
        wake.cancel()
        await t.disconnect()
    }

    @Test func smtpVerifySendsAndFailures() async throws {
        let (server, user, t) = try await setup()
        try await t.verifySend()
        let message = OutgoingMessage(envelopeFrom: server.email(user), recipients: [server.email(user)], raw: Data("From: \(server.email(user))\r\nTo: \(server.email(user))\r\nSubject: self\r\n\r\nhi\r\n".utf8))
        try await t.send(message)
        try await Task.sleep(for: .milliseconds(300))
        _ = try await t.select("INBOX", readOnly: true, qresync: nil)
        #expect(try await t.search(.all).count == 1)
        await #expect(throws: FlintError.self) { try await t.send(OutgoingMessage(envelopeFrom: "a@b.test", recipients: [], raw: Data())) }
    }
}
