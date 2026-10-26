import FlintModel
import FlintStore
import Foundation
import Testing
@testable import FlintMail

/// Polls until `condition` holds or the timeout passes.
func mailEventually(timeout: Duration = .seconds(5), _ condition: @Sendable () async -> Bool) async -> Bool {
    let deadline = ContinuousClock.now + timeout
    while ContinuousClock.now < deadline {
        if await condition() { return true }
        try? await Task.sleep(for: .milliseconds(10))
    }
    return await condition()
}

final class MailFakePathMonitor: NetworkMonitoring, @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: AsyncStream<NetworkPathState>.Continuation?
    func updates() -> AsyncStream<NetworkPathState> {
        AsyncStream { c in
            lock.lock(); continuation = c; lock.unlock()
        }
    }
    func send(_ state: NetworkPathState) { lock.lock(); let c = continuation; lock.unlock(); c?.yield(state) }
}

struct MailSessionRig {
    let store: MailTestStore
    let fake: FakeMailTransport
    let log: MailEventLog
    let session: AccountSession
    let cache: URL

    static let standardFolders = [
        RemoteFolder(path: "INBOX", delimiter: "/"), RemoteFolder(path: "Sent", delimiter: "/", attributes: ["sent"]),
        RemoteFolder(path: "Drafts", delimiter: "/", attributes: ["drafts"]), RemoteFolder(path: "Trash", delimiter: "/", attributes: ["trash"]),
        RemoteFolder(path: "Archive", delimiter: "/", attributes: ["archive"]),
    ]

    static func make(
        capabilities: TransportCapabilities = TransportCapabilities(), folders: [RemoteFolder] = standardFolders, provider: MailProvider = .imap,
        network: (any NetworkMonitoring)? = nil, fast: Bool = false, credentials: @escaping AccountSession.CredentialProvider = { .password(user: "me@test.local", password: "pw") }
    ) async -> MailSessionRig {
        let store = MailTestStore()
        await store.addAccount(mailTestAccount(provider: provider))
        await store.setOwnAddresses(["me@test.local"])
        let fake = FakeMailTransport(capabilities: capabilities, folders: folders)
        let log = MailEventLog()
        let cache = FileManager.default.temporaryDirectory.appendingPathComponent("flint-session-\(UUID().uuidString)")
        var config = SessionConfiguration(cacheRoot: cache)
        if fast {
            config.pollInterval = .milliseconds(60)
            config.idlePollInterval = .seconds(30)
            config.backoffMinimum = .milliseconds(20)
            config.backoffMaximum = .milliseconds(80)
            config.idleMinimumLifetime = .milliseconds(0)
        }
        let session = AccountSession(
            accountId: "a1", store: store, transportFactory: { fake }, credentials: credentials, emit: { log.add($0) }, configuration: config,
            network: network, now: { mailTestNow })
        return MailSessionRig(store: store, fake: fake, log: log, session: session, cache: cache)
    }

    var syncStates: [SyncState] {
        log.events.compactMap { if case .sync(let status) = $0 { return status.state } else { return nil } }
    }
    var newMail: [String] {
        log.events.compactMap { if case .newMail(_, _, _, let subject, _, _, _) = $0 { return subject } else { return nil } }
    }

    /// True once a sync cycle has finished (the status event after the first `idle`).
    func firstSyncDone() async -> Bool { await mailEventually { syncStates.contains(.idle) } }

    func folder(_ path: String) async -> Folder? { try? await store.folder(accountId: "a1", path: path) }
    func rows(_ path: String) async -> [StoredMessage] {
        guard let folder = await folder(path) else { return [] }
        return await store.allMessages(in: folder.id)
    }
}

@Suite("AccountSession cycle")
struct MailSessionCycleTests {
    @Test func firstSyncDiscoversFoldersSyncsThemInOrderAndReportsStatus() async throws {
        let r = await MailSessionRig.make()
        await r.fake.deliver(mailTestEnvelope("in 1", ageDays: 1), to: "INBOX")
        await r.fake.deliver(mailTestEnvelope("sent 1", from: "me@test.local", ageDays: 1), to: "Sent")
        await r.fake.deliver(mailTestEnvelope("trashed", ageDays: 1), to: "Trash")
        try await r.session.syncNow()

        let folders = try await r.store.listFolders(accountId: "a1")
        #expect(Dictionary(uniqueKeysWithValues: folders.map { ($0.path, $0.role) })["Sent"] == .sent)
        #expect(await r.rows("INBOX").map(\.subject) == ["in 1"])
        #expect(await r.rows("Sent").count == 1)
        #expect(await r.rows("Trash").count == 1)
        let states = r.syncStates
        #expect(states.first == .syncing && states.last == .idle)
        #expect(!states.contains(.error) && !states.contains(.offline))
        let status = await r.session.status
        #expect(status.state == .idle && status.lastSyncAt == mailTestNow && status.error == nil)
        #expect(!r.log.changes.isEmpty)
        #expect(r.newMail.isEmpty) // the initial window never announces mail
    }

    @Test func recentInboxBodiesArePrefetchedAndDecoded() async throws {
        let r = await MailSessionRig.make()
        await r.fake.deliver(mailTestEnvelope("recent", ageDays: 1, structure: BodyPart(number: "1", type: "text", subtype: "plain", parameters: ["charset": "iso-8859-1"], encoding: "7bit")), parts: ["1": Data([0x63, 0x61, 0x66, 0xE9])], to: "INBOX")
        await r.fake.deliver(mailTestEnvelope("old", ageDays: 30), parts: ["1": Data("old body".utf8)], to: "INBOX")
        await r.fake.deliver(mailTestEnvelope("sent", from: "me@test.local", ageDays: 1), parts: ["1": Data("sent body".utf8)], to: "Sent")
        try await r.session.syncNow()
        let bodies = await r.store.bodiesSet
        #expect(bodies.count == 1)
        #expect(bodies.values.first?.text == "café")
    }

    @Test func newMailAfterTheFirstSyncIsAnnouncedOnce() async throws {
        let r = await MailSessionRig.make()
        await r.fake.deliver(mailTestEnvelope("first", ageDays: 1), to: "INBOX")
        try await r.session.syncNow()
        await r.fake.deliver(mailTestEnvelope("fresh", from: "bob@example.com", messageId: "<fresh@x>"), to: "INBOX")
        await r.fake.deliver(mailTestEnvelope("seen already", flags: [IMAPFlag.seen]), to: "INBOX")
        await r.fake.deliver(mailTestEnvelope("mine", from: "me@test.local"), to: "INBOX")
        try await r.session.syncNow()
        #expect(r.newMail == ["fresh"])
        try await r.session.syncNow()
        #expect(r.newMail == ["fresh"])
    }

    @Test func oldMailFoundLateIsNotNew() async throws {
        let r = await MailSessionRig.make()
        try await r.session.syncNow()
        await r.fake.deliver(mailTestEnvelope("ancient", ageDays: 10), to: "INBOX")
        try await r.session.syncNow()
        #expect(r.newMail.isEmpty)
    }

    @Test func mailMovedByARuleOrFromABlockedSenderIsNotAnnounced() async throws {
        let r = await MailSessionRig.make()
        try await r.session.syncNow()
        await r.store.setBlocked(["spammer@example.com"])
        await r.store.setRuleActions([.mute], for: "<muted@x>")
        await r.store.setRuleActions([.notify(enabled: false)], for: "<quiet@x>")
        await r.store.setRuleActions([.notify(enabled: true), .category(.notifications)], for: "<loud@x>")
        await r.fake.deliver(mailTestEnvelope("blocked", from: "spammer@example.com", messageId: "<b@x>"), to: "INBOX")
        await r.fake.deliver(mailTestEnvelope("muted", messageId: "<muted@x>"), to: "INBOX")
        await r.fake.deliver(mailTestEnvelope("quiet", messageId: "<quiet@x>"), to: "INBOX")
        await r.fake.deliver(mailTestEnvelope("loud", messageId: "<loud@x>"), to: "INBOX")
        try await r.session.syncNow()
        #expect(r.newMail == ["loud"])
        let forced = r.log.events.contains { if case .newMail(_, _, _, "loud", _, _, true) = $0 { return true } else { return false } }
        #expect(forced)
        // The blocked message was trashed on the server.
        #expect(await r.fake.envelopes(in: "Trash").count == 1)
        #expect(await r.fake.envelopes(in: "INBOX").map(\.subject).contains("blocked") == false)
    }

    @Test func ruleActionsRunOnTheServerAfterTheLocalChange() async throws {
        let r = await MailSessionRig.make()
        try await r.session.syncNow()
        await r.store.setRuleActions([.archive], for: "<arch@x>")
        await r.fake.deliver(mailTestEnvelope("to archive", messageId: "<arch@x>"), to: "INBOX")
        // The store's archive result: one location, the message in INBOX uid 1.
        let inbox = try #require(await r.folder("INBOX"))
        let loc = MessageLocation(messageRowId: 1, threadId: 1, accountId: "a1", provider: .imap, folderId: inbox.id, folderPath: "INBOX", folderRole: .inbox, uid: 1)
        await r.store.script([ActionResult(snapshot: ThreadSnapshot(threads: [ThreadSnapshot.Thread(id: 1, pinned: false, muted: false, snoozedUntil: nil, resurfacedAt: nil, messages: [])]), locations: [loc])])
        try await r.session.syncNow()
        #expect(await r.fake.envelopes(in: "INBOX").isEmpty)
        #expect(await r.fake.envelopes(in: "Archive").count == 1)
        #expect(r.newMail.isEmpty)
        #expect(await r.store.movedTargets == [.archive])
    }

    @Test func aRuleActionRefusedByTheServerRestoresTheLocalChange() async throws {
        let r = await MailSessionRig.make()
        try await r.session.syncNow()
        await r.store.setRuleActions([.markRead], for: "<mr@x>")
        await r.fake.deliver(mailTestEnvelope("to read", messageId: "<mr@x>"), to: "INBOX")
        let inbox = try #require(await r.folder("INBOX"))
        let loc = MessageLocation(messageRowId: 1, threadId: 1, accountId: "a1", provider: .imap, folderId: inbox.id, folderPath: "INBOX", folderRole: .inbox, uid: 1)
        await r.store.script([ActionResult(snapshot: ThreadSnapshot(threads: []), locations: [loc])])
        await r.fake.failNext("storeFlags", with: FlintError(.network, "dropped"))
        try await r.session.syncNow()
        #expect(await r.store.restoredSnapshots.count == 1)
    }

    @Test func syncFailureLeavesTheCollectedBatchesFollowedUp() async throws {
        let r = await MailSessionRig.make()
        await r.fake.deliver(mailTestEnvelope("a", ageDays: 1), parts: ["1": Data("body".utf8)], to: "INBOX")
        // INBOX syncs first; the next folder (Drafts) fails to select. The inbox batch still gets its body prefetched.
        await r.fake.failNextAfter("select", skip: 1, with: FlintError(.network, "dropped"))
        await #expect(throws: FlintError.self) { try await r.session.syncNow() }
        #expect(await r.store.bodiesSet.count == 1)
    }

    @Test func foldersTheServerCannotSelectAreSkipped() async throws {
        let r = await MailSessionRig.make(folders: MailSessionRig.standardFolders + [RemoteFolder(path: "Shared", delimiter: "/", attributes: ["noselect"])])
        try await r.session.syncNow()
        #expect(await r.folder("Shared") == nil)
    }

    @Test func userFoldersJoinTheCycleAfterTheirFirstSync() async throws {
        let r = await MailSessionRig.make(folders: MailSessionRig.standardFolders + [RemoteFolder(path: "Projects", delimiter: "/")])
        await r.fake.deliver(mailTestEnvelope("p1", ageDays: 1), to: "Projects")
        try await r.session.syncNow()
        #expect(await r.rows("Projects").isEmpty) // not part of the default set
        let projects = try #require(await r.folder("Projects"))
        try await r.session.syncFolderNow(projects.id)
        #expect(await r.rows("Projects").count == 1)
        await r.fake.deliver(mailTestEnvelope("p2", ageDays: 1), to: "Projects")
        try await r.session.syncNow()
        #expect(await r.rows("Projects").count == 2)
    }

    @Test func expungedMailIsReconciledWhenTheCountChanges() async throws {
        let r = await MailSessionRig.make()
        for i in 0..<3 { await r.fake.deliver(mailTestEnvelope("m\(i)", ageDays: 1), to: "INBOX") }
        try await r.session.syncNow()
        await r.fake.removeExternally(uids: [2], in: "INBOX")
        try await r.session.syncNow()
        #expect(await r.rows("INBOX").map(\.uid) == [1, 3])
    }

    @Test func loadOlderAndServerSearchPullInMoreMail() async throws {
        let r = await MailSessionRig.make()
        for i in 0..<4 { await r.fake.deliver(mailTestEnvelope("old\(i)", ageDays: 400), to: "INBOX") }
        await r.fake.deliver(mailTestEnvelope("recent", ageDays: 1), to: "INBOX")
        try await r.session.syncNow()
        let inbox = try #require(await r.folder("INBOX"))
        #expect(await r.rows("INBOX").count == 1)
        let first = try await r.session.loadOlder([inbox.id], batch: 2)
        #expect(first == FolderSync.BackfillResult(loaded: 2, hasMore: true))
        let found = try await r.session.searchServer([ServerSearch(folderId: inbox.id, criteria: .text("old"))])
        #expect(found.found == 4 && found.added == 2)
        #expect(await r.rows("INBOX").count == 5)
    }

    @Test func headersCanBeRefreshedForStoredMessages() async throws {
        let r = await MailSessionRig.make()
        await r.fake.deliver(mailTestEnvelope("h", ageDays: 1, headers: ["list-id": "<l.x>"]), to: "INBOX")
        try await r.session.syncNow()
        let inbox = try #require(await r.folder("INBOX"))
        let updated = try await r.session.refreshHeaders([HeaderRefreshTarget(folderId: inbox.id, folderPath: "INBOX", uids: [1])])
        #expect(updated == 1)
        #expect(await r.store.mergedHeaders.first?.uids == [1])
    }
}

@Suite("AccountSession on demand")
struct MailSessionOnDemandTests {
    @Test func fetchBodyDownloadsOnceAndAnnouncesTheThread() async throws {
        let r = await MailSessionRig.make()
        await r.fake.deliver(mailTestEnvelope("old", ageDays: 30), parts: ["1": Data("later".utf8)], to: "INBOX")
        try await r.session.syncNow()
        let row = try #require(await r.rows("INBOX").first)
        #expect(!row.bodyLoaded)
        try await r.session.fetchBody(row.id)
        #expect(await r.store.bodiesSet[row.id]?.text == "later")
        let before = await r.fake.calls.filter { $0 == "fetchPart" }.count
        try await r.session.fetchBody(row.id)
        #expect(await r.fake.calls.filter { $0 == "fetchPart" }.count == before)
        await #expect(throws: FlintError.self) { try await r.session.fetchBody(9999) }
    }

    @Test func attachmentsAreDownloadedOnceThenServedFromTheCache() async throws {
        let r = await MailSessionRig.make()
        defer { try? FileManager.default.removeItem(at: r.cache) }
        let tree = BodyPart(number: "", type: "multipart", subtype: "mixed", children: [
            BodyPart(number: "1", type: "text", subtype: "plain"),
            BodyPart(number: "2", type: "application", subtype: "pdf", disposition: "attachment", filename: "invoice.pdf", size: 4),
        ])
        await r.fake.deliver(mailTestEnvelope("with file", ageDays: 1, structure: tree), parts: ["1": Data("b".utf8), "2": Data("%PDF".utf8)], to: "INBOX")
        try await r.session.syncNow()
        let row = try #require(await r.rows("INBOX").first)
        await r.store.addAttachment(5, StoredAttachment(info: AttachmentInfo(id: 5, filename: "invoice.pdf", contentType: "application/pdf", size: 4), messageRowId: row.id, part: "2"))
        let first = try await r.session.fetchAttachment(5)
        #expect(first == Data("%PDF".utf8))
        let parts = await r.fake.calls.filter { $0 == "fetchPart" }.count
        let second = try await r.session.fetchAttachment(5)
        #expect(second == first)
        #expect(await r.fake.calls.filter { $0 == "fetchPart" }.count == parts)
        let stored = try #require(try await r.store.attachment(id: 5)?.cachedPath)
        #expect(stored.contains("/attachments/a1/") && stored.hasSuffix("5-invoice.pdf"))
        await #expect(throws: FlintError.self) { try await r.session.fetchAttachment(77) }
    }

    @Test func commandsNeverInterleaveOnTheSharedConnection() async throws {
        let r = await MailSessionRig.make(folders: MailSessionRig.standardFolders + [RemoteFolder(path: "A", delimiter: "/"), RemoteFolder(path: "B", delimiter: "/")])
        for i in 0..<3 { await r.fake.deliver(mailTestEnvelope("a\(i)"), to: "A") }
        for i in 0..<5 { await r.fake.deliver(mailTestEnvelope("b\(i)"), to: "B") }
        let counts = try await withThrowingTaskGroup(of: (String, Int).self) { group -> [String: Int] in
            for i in 0..<40 {
                let path = i % 2 == 0 ? "A" : "B"
                group.addTask {
                    try await r.session.run { t in
                        _ = try await t.select(path, readOnly: true, qresync: nil)
                        await Task.yield()
                        return (path, try await t.search(.all).count)
                    }
                }
            }
            var out: [String: Int] = [:]
            for try await (path, count) in group { out[path] = count }
            return out
        }
        #expect(counts == ["A": 3, "B": 5])
    }

    @Test func aNetworkErrorDropsTheConnectionSoTheNextCommandReconnects() async throws {
        let r = await MailSessionRig.make()
        try await r.session.syncNow()
        let connects = await r.fake.connectCount
        await #expect(throws: FlintError.self) {
            try await r.session.run { t -> Int in throw FlintError(.network, "reset") }
        }
        _ = try await r.session.run { t in try await t.listFolders() }
        #expect(await r.fake.connectCount == connects + 1)
    }
}

@Suite("AccountSession loop")
struct MailSessionLoopTests {
    @Test func idlePushWakesTheLoopWhichSyncsNewMail() async throws {
        let r = await MailSessionRig.make(fast: true)
        await r.session.start()
        #expect(await mailEventually { await r.fake.calls.contains("idle") })
        await r.fake.deliver(mailTestEnvelope("pushed", from: "bob@example.com", messageId: "<pushed@x>"), to: "INBOX")
        #expect(await mailEventually { r.newMail == ["pushed"] })
        await r.session.stop()
        let calls = await r.fake.calls
        #expect(calls.last == "disconnect")
    }

    @Test func aDroppedConnectionIsReestablishedWithBackoff() async throws {
        let r = await MailSessionRig.make(fast: true)
        await r.session.start()
        #expect(await mailEventually { await r.fake.calls.contains("idle") })
        let connects = await r.fake.connectCount
        await r.fake.dropConnection()
        await r.fake.deliver(mailTestEnvelope("after drop", from: "bob@example.com"), to: "INBOX")
        #expect(await mailEventually { await r.fake.connectCount > connects && r.newMail == ["after drop"] })
        await r.session.stop()
    }

    @Test func networkErrorsShowOfflineThenRecover() async throws {
        let r = await MailSessionRig.make(fast: true)
        await r.fake.failNext("listFolders", with: FlintError(.network, "Could not connect to the IMAP server."))
        await r.session.start()
        #expect(await mailEventually { r.syncStates.contains(.offline) })
        #expect(await mailEventually { await r.session.status.state == .idle })
        let offline = r.log.events.compactMap { e -> SyncStatus? in if case .sync(let s) = e, s.state == .offline { return s } else { return nil } }
        #expect(offline.first?.error == "Could not connect to the IMAP server.")
        await r.session.stop()
    }

    @Test func otherErrorsShowErrorAndKeepRetrying() async throws {
        let r = await MailSessionRig.make(fast: true)
        await r.fake.failNext("listFolders", with: FlintError(.internal, "boom"))
        await r.session.start()
        #expect(await mailEventually { r.syncStates.contains(.error) })
        #expect(await mailEventually { await r.session.status.state == .idle })
        await r.session.stop()
    }

    @Test func rejectedSignInIsRetriedThenBecomesAnAuthError() async throws {
        let r = await MailSessionRig.make(fast: true)
        await r.fake.rejectLogins()
        await r.session.start()
        #expect(await mailEventually { await r.session.status.state == .authError })
        let status = await r.session.status
        #expect(status.error == "Sign in again.")
        let errors = r.syncStates.filter { $0 == .error }.count
        #expect(errors == 2) // two retries with a transient error status, then the auth error
        #expect(await r.fake.connectCount == 0)
        // Signing in again restarts the loop.
        await r.fake.rejectLogins(false)
        await r.session.start()
        #expect(await mailEventually { await r.session.status.state == .idle })
        await r.session.stop()
    }

    @Test func aCredentialFailureIsAnAuthFailureToo() async throws {
        let r = await MailSessionRig.make(fast: true, credentials: { throw FlintError(.auth, "Sign in again.") })
        await r.session.start()
        #expect(await mailEventually { await r.session.status.state == .authError })
        await r.session.stop()
    }

    @Test func aNetworkPathChangeReconnectsAndSyncs() async throws {
        let monitor = MailFakePathMonitor()
        let r = await MailSessionRig.make(network: monitor, fast: true)
        await r.session.start()
        #expect(await mailEventually { await r.fake.calls.contains("idle") })
        monitor.send(NetworkPathState(satisfied: true, signature: "wifi")) // initial state: ignored
        let connects = await r.fake.connectCount
        await r.fake.deliver(mailTestEnvelope("after handoff", from: "bob@example.com"), to: "INBOX")
        monitor.send(NetworkPathState(satisfied: true, signature: "cellular"))
        #expect(await mailEventually { await r.fake.connectCount > connects && r.newMail == ["after handoff"] })
        monitor.send(NetworkPathState(satisfied: false))
        #expect(await mailEventually { await r.session.status.state == .offline })
        await r.session.stop()
    }

    @Test func stopDisconnectsAndTheLoopCanBeStartedAgain() async throws {
        let r = await MailSessionRig.make(fast: true)
        await r.session.start()
        #expect(await r.firstSyncDone())
        await r.session.stop()
        #expect(await !r.fake.isConnected)
        await r.session.start()
        #expect(await mailEventually { await r.fake.isConnected })
        await r.session.stop()
    }

    @Test func withoutIdleTheLoopPollsOnItsOwn() async throws {
        let r = await MailSessionRig.make(capabilities: TransportCapabilities(idle: false), fast: true)
        await r.session.start()
        #expect(await r.firstSyncDone())
        await r.fake.deliver(mailTestEnvelope("polled", from: "bob@example.com"), to: "INBOX")
        #expect(await mailEventually { r.newMail == ["polled"] }) // found by the 60 ms poll without IDLE
        await r.session.stop()
    }
}

@Suite("AccountSession Gmail")
struct MailSessionGmailTests {
    @Test func gmailModeSyncsTrashSpamAndAllMailAndIdlesOnTheInbox() async throws {
        let folders = [
            RemoteFolder(path: "INBOX", delimiter: "/"), RemoteFolder(path: "[Gmail]/All Mail", delimiter: "/", attributes: ["all"]),
            RemoteFolder(path: "[Gmail]/Trash", delimiter: "/", attributes: ["trash"]), RemoteFolder(path: "[Gmail]/Spam", delimiter: "/", attributes: ["junk"]),
            RemoteFolder(path: "[Gmail]/Sent Mail", delimiter: "/", attributes: ["sent"]),
        ]
        let r = await MailSessionRig.make(capabilities: TransportCapabilities(gmail: true), folders: folders, provider: .gmail)
        await r.fake.deliver(mailTestEnvelope("g", ageDays: 1, gmail: GmailAttributes(msgid: "m1", thrid: "t1", labels: ["\\Inbox"])), to: "[Gmail]/All Mail")
        await r.fake.deliver(mailTestEnvelope("inbox copy", ageDays: 1), to: "INBOX")
        try await r.session.syncNow()
        #expect(await r.rows("[Gmail]/All Mail").count == 1)
        #expect(await r.rows("INBOX").isEmpty) // Gmail mail is read from All Mail only
        let row = try #require(await r.rows("[Gmail]/All Mail").first)
        #expect(row.gmMsgid == "m1")
        let inbox = try #require(await r.folder("INBOX"))
        #expect(await r.store.membership(of: row.id).contains(inbox.id))
    }

    @Test func gmailThatHidesAllMailFallsBackToTheGenericFolderSet() async throws {
        let r = await MailSessionRig.make(capabilities: TransportCapabilities(gmail: true), provider: .gmail)
        await r.fake.deliver(mailTestEnvelope("inbox", ageDays: 1), to: "INBOX")
        try await r.session.syncNow()
        #expect(await r.rows("INBOX").count == 1)
    }
}
