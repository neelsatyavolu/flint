import FlintModel
import FlintStore
import Foundation
import Testing
@testable import FlintMail

private struct EngineRig {
    let server: MailGreenMailServer
    let user: String
    let store: MailTestStore
    let session: AccountSession
    let log: MailEventLog
    let cache: URL

    static func make(server override: MailGreenMailServer? = nil, user overrideUser: String? = nil) async throws -> EngineRig {
        let server: MailGreenMailServer, user: String
        if let override, let overrideUser { (server, user) = (override, overrideUser) } else { (server, user) = try await MailSharedGreenMail.shared.freshUser() }
        let store = MailTestStore()
        await store.addAccount(server.account(for: user))
        await store.setOwnAddresses([server.email(user)])
        let log = MailEventLog()
        let cache = FileManager.default.temporaryDirectory.appendingPathComponent("flint-gm-\(UUID().uuidString)")
        var config = SessionConfiguration(cacheRoot: cache)
        config.pollInterval = .seconds(2)
        config.idlePollInterval = .seconds(20)
        config.backoffMinimum = .milliseconds(200)
        config.backoffMaximum = .seconds(1)
        let credential = server.credential(user)
        let session = AccountSession(
            accountId: "a1", store: store, transportFactory: SwiftMailTransport.factory, credentials: { credential }, emit: { log.add($0) }, configuration: config)
        return EngineRig(server: server, user: user, store: store, session: session, log: log, cache: cache)
    }

    func rows(_ path: String = "INBOX") async -> [StoredMessage] {
        guard let folder = try? await store.folder(accountId: "a1", path: path) else { return [] }
        return await store.allMessages(in: folder.id)
    }

    var newMail: [String] { log.events.compactMap { if case .newMail(_, _, _, let subject, _, _, _) = $0 { return subject } else { return nil } } }

    /// A second, independent connection for looking at what the server really holds.
    func peek<T: Sendable>(_ body: @Sendable (SwiftMailTransport) async throws -> T) async throws -> T {
        let t = try await server.connect(user)
        defer { Task { await t.disconnect() } }
        return try await body(t)
    }

    func serverUids(_ path: String) async throws -> [Int] {
        try await peek { t in
            guard (try await t.listFolders()).contains(where: { $0.path == path }) else { return [] }
            _ = try await t.select(path, readOnly: true, qresync: nil)
            return try await t.search(.all)
        }
    }
}

@Suite("GreenMail engine", .enabled(if: mailGreenMailEnabled), .serialized)
struct MailGreenMailEngineTests {
    @Test func initialSyncStoresMessagesBodiesAndAttachmentFlags() async throws {
        let r = try await EngineRig.make()
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("gm-\(UUID().uuidString).pdf")
        try Data("%PDF-1.4 fake".utf8).write(to: file)
        defer { try? FileManager.default.removeItem(at: file); try? FileManager.default.removeItem(at: r.cache) }
        for i in 1...3 { _ = try await r.server.deliver(to: r.user, subject: "plain \(i)", text: "body \(i) café") }
        _ = try await r.server.deliver(
            to: r.user, subject: "with file", text: "see attached",
            attachments: [DraftAttachment(id: "1", filename: "report é.pdf", contentType: "application/pdf", size: 13, path: file.path)])
        try await Task.sleep(for: .milliseconds(500))

        try await r.session.syncNow()
        let rows = await r.rows()
        #expect(rows.count == 4)
        #expect(rows.first { $0.subject == "with file" }?.hasAttachments == true)
        #expect(rows.first { $0.subject == "plain 1" }?.hasAttachments == false)
        let bodies = await r.store.bodiesSet
        #expect(bodies.count == 4)
        #expect(bodies.values.contains { $0.text == "body 2 café" })
        #expect(r.newMail.isEmpty)
        let status = await r.session.status
        #expect(status.state == .idle && status.error == nil)
        let folders = try await r.store.listFolders(accountId: "a1")
        #expect(folders.first { $0.path == "INBOX" }?.role == .inbox)

        // The attachment downloads with its filename and bytes intact.
        let withFile = try #require(rows.first { $0.subject == "with file" })
        let info = BodyStructureWalker.walk(try await r.peek { t in
            _ = try await t.select("INBOX", readOnly: true, qresync: nil)
            return try await t.fetchBodyStructure(uid: withFile.uid)
        })
        #expect(info.attachments.map(\.filename) == ["report é.pdf"])
        await r.store.addAttachment(1, StoredAttachment(info: AttachmentInfo(id: 1, filename: "report é.pdf", contentType: "application/pdf", size: 13), messageRowId: withFile.id, part: info.attachments[0].part))
        #expect(try await r.session.fetchAttachment(1) == Data("%PDF-1.4 fake".utf8))
    }

    @Test func incrementalSyncSeesFlagChangesMadeElsewhereAndExpunges() async throws {
        let r = try await EngineRig.make()
        defer { try? FileManager.default.removeItem(at: r.cache) }
        for i in 1...3 { _ = try await r.server.deliver(to: r.user, subject: "m\(i)") }
        try await Task.sleep(for: .milliseconds(400))
        try await r.session.syncNow()
        try await r.peek { t in
            _ = try await t.select("INBOX", readOnly: false, qresync: nil)
            try await t.storeFlags(.uids([2]), flags: [IMAPFlag.seen], mode: .add)
            try await t.expunge(.uids([3]))
        }
        try await r.session.syncNow()
        let rows = await r.rows()
        #expect(rows.map(\.uid) == [1, 2])
        #expect(rows.first { $0.uid == 2 }?.seen == true && rows.first { $0.uid == 1 }?.seen == false)
    }

    @Test func newMailArrivesThroughIdle() async throws {
        let r = try await EngineRig.make()
        defer { try? FileManager.default.removeItem(at: r.cache) }
        await r.session.start()
        let firstSync = await mailEventually(timeout: .seconds(20)) { r.log.events.contains { if case .sync(let s) = $0 { return s.state == .idle } else { return false } } }
        #expect(firstSync)
        try await Task.sleep(for: .seconds(1)) // let IDLE start
        _ = try await r.server.deliver(to: r.user, subject: "pushed", from: "Bob <bob@remote.example>", text: "hello")
        #expect(await mailEventually(timeout: .seconds(15)) { r.newMail == ["pushed"] })
        await r.session.stop()
    }

    @Test func markReadArchiveAndTrashReachTheServer() async throws {
        let r = try await EngineRig.make()
        defer { try? FileManager.default.removeItem(at: r.cache) }
        for i in 1...3 { _ = try await r.server.deliver(to: r.user, subject: "act \(i)") }
        try await Task.sleep(for: .milliseconds(400))
        try await r.session.syncNow()
        let rows = await r.rows()
        #expect(rows.count == 3)
        let actions = r.session.serverActions
        func locs(_ uid: Int) async throws -> [MessageLocation] { try await r.store.messageLocations([try #require(rows.first { $0.uid == uid }).id]) }

        let seen = await actions.setSeen(try await locs(1), true)
        #expect(seen.ok)
        let flagged = try await r.peek { t -> Set<String> in
            _ = try await t.select("INBOX", readOnly: true, qresync: nil)
            return try await t.fetchFlags(.uids([1]), includeLabels: false, changedSince: nil).first?.flags ?? []
        }
        #expect(flagged.contains(IMAPFlag.seen))

        let archived = await actions.archive(try await locs(2))
        #expect(archived.ok)
        #expect(try await r.serverUids("Archive").count == 1)
        let trashed = await actions.trash(try await locs(3))
        #expect(trashed.ok)
        #expect(try await r.serverUids("Trash").count == 1)
        #expect(try await r.serverUids("INBOX") == [1])
        let relocations = await r.store.relocations
        #expect(relocations.count == 2)

        // The next sync sees the moves: the moved messages are gone from INBOX and ingested into their new folders.
        try await r.session.syncNow()
        #expect(await r.rows().map(\.uid) == [1])
        #expect(await r.rows("Archive").count == 1)
        #expect(await r.rows("Trash").count == 1)
    }

    @Test func aTrackedSendReachesEachRecipientAndLeavesOneCleanSentCopy() async throws {
        let r = try await EngineRig.make()
        let (_, recipient) = try await MailSharedGreenMail.shared.freshUser()
        defer { try? FileManager.default.removeItem(at: r.cache) }
        let tracking = MailFakeTracking()
        let job = SendJob(SendJob.Dependencies(
            store: r.store, tracking: tracking,
            mailer: { [session = r.session] _ in Mailer(smtp: { try await session.send($0) }, sentCopy: SentCopy(runner: session)) },
            actions: { [session = r.session] _ in session.serverActions }, emit: { r.log.add($0) }))
        try await r.session.syncNow() // discovers the folders
        await r.store.addDraft(Draft(
            id: 1, accountId: "a1", from: r.server.email(r.user), to: [Address(address: r.server.email(recipient)), Address(address: r.server.email(r.user))],
            subject: "Tracked hello", html: "<body><p>hi there</p></body>", track: true))
        let row = try await r.store.createScheduledSend(NewScheduledSend(draftId: 1, sendAt: 0), now: 0)
        let messageId = try await job.run(draftId: 1, scheduledId: row.id)
        try await Task.sleep(for: .milliseconds(600))

        let peer = try await r.server.connect(recipient)
        _ = try await peer.select("INBOX", readOnly: true, qresync: nil)
        let uids = try await peer.search(.all)
        #expect(uids.count == 1)
        let raw = MailParsedMime.parse(try await peer.fetchRawMessage(uid: uids[0]))
        #expect(raw.header("x-flint-ref") == "REF123" && raw.header("message-id") == "<\(messageId)>")
        #expect(raw.parts[1].text.contains("TOK0.gif")) // the tracked recipient's copy carries its own pixel
        await peer.disconnect()

        // The sender's own address got the clean copy, and Sent holds exactly one clean copy.
        let mine = try await r.serverUids("INBOX")
        #expect(mine.count == 1)
        let sentUids = try await r.serverUids("Sent")
        #expect(sentUids.count == 1)
        let sentRaw = MailParsedMime.parse(try await r.peek { t in
            _ = try await t.select("Sent", readOnly: true, qresync: nil)
            return try await t.fetchRawMessage(uid: sentUids[0])
        })
        #expect(!sentRaw.parts[1].text.contains("/i/TOK") && sentRaw.header("message-id") == "<\(messageId)>")
        #expect(try await r.peek { t in
            _ = try await t.select("Sent", readOnly: true, qresync: nil)
            return try await t.fetchFlags(.uids(sentUids), includeLabels: false, changedSince: nil).first?.flags ?? []
        }.contains(IMAPFlag.seen))
    }

    @Test func aMessageToYourselfIsDeliveredOnceAndFiledInSentOnce() async throws {
        let r = try await EngineRig.make()
        defer { try? FileManager.default.removeItem(at: r.cache) }
        let tracking = MailFakeTracking()
        let job = SendJob(SendJob.Dependencies(
            store: r.store, tracking: tracking,
            mailer: { [session = r.session] _ in Mailer(smtp: { try await session.send($0) }, sentCopy: SentCopy(runner: session)) },
            actions: { [session = r.session] _ in session.serverActions }, emit: { r.log.add($0) }))
        try await r.session.syncNow()
        await r.store.addDraft(Draft(id: 1, accountId: "a1", from: r.server.email(r.user), to: [Address(address: r.server.email(r.user))], subject: "Note to self", html: "<p>remember</p>"))
        let row = try await r.store.createScheduledSend(NewScheduledSend(draftId: 1, sendAt: 0), now: 0)
        _ = try await job.run(draftId: 1, scheduledId: row.id)
        try await Task.sleep(for: .milliseconds(600))
        #expect(try await r.serverUids("INBOX").count == 1)
        #expect(try await r.serverUids("Sent").count == 1)
        try await r.session.syncNow()
        #expect(await r.rows("Sent").count == 1)
    }

    @Test func theSessionReconnectsAndResyncsAfterTheServerRestarts() async throws {
        let server = MailGreenMailServer(users: ["restart1", "sender"])
        try await server.start()
        defer { server.stop() }
        let r = try await EngineRig.make(server: server, user: "restart1")
        defer { try? FileManager.default.removeItem(at: r.cache) }
        _ = try await server.deliver(to: "restart1", subject: "before restart")
        try await Task.sleep(for: .milliseconds(400))
        await r.session.start()
        #expect(await mailEventually(timeout: .seconds(20)) { await r.rows().count == 1 })

        try await server.restart() // mailboxes are empty again and UIDVALIDITY changed
        _ = try await server.deliver(to: "restart1", subject: "after restart")
        try await Task.sleep(for: .milliseconds(300))
        await r.session.nudge()
        #expect(await mailEventually(timeout: .seconds(30)) { await r.rows().map(\.subject) == ["after restart"] })
        #expect(await r.session.status.state != .authError)
        await r.session.stop()
    }

    @Test func aWrongPasswordBecomesAnAuthErrorNotARetryStorm() async throws {
        let (server, user) = try await MailSharedGreenMail.shared.freshUser()
        let store = MailTestStore()
        await store.addAccount(server.account(for: user))
        let log = MailEventLog()
        var config = SessionConfiguration(cacheRoot: FileManager.default.temporaryDirectory)
        config.backoffMinimum = .milliseconds(50)
        config.backoffMaximum = .milliseconds(100)
        let session = AccountSession(
            accountId: "a1", store: store, transportFactory: SwiftMailTransport.factory, credentials: { .password(user: user, password: "nope") }, emit: { log.add($0) }, configuration: config)
        await session.start()
        #expect(await mailEventually(timeout: .seconds(10)) { await session.status.state == .authError })
        #expect(await session.status.error == "Sign in again.")
        await session.stop()
    }
}
