import FlintModel
import Foundation
import Testing
@testable import FlintMail

private let config = MailTransportConfiguration(
    server: ServerConfig(imapHost: "127.0.0.1", imapPort: 3143, imapSecure: false, smtpHost: "127.0.0.1", smtpPort: 3025, smtpSecure: false, username: "me@test.local"),
    credential: .password(user: "me@test.local", password: "pw"))

private func envelope(_ subject: String, flags: Set<String> = [], messageId: String? = nil, date: Date = Date(timeIntervalSince1970: 1_000)) -> RemoteEnvelope {
    RemoteEnvelope(uid: 0, flags: flags, internalDate: date, messageId: messageId, subject: subject, from: [Address(name: "A", address: "a@example.com")])
}

private func connected(_ caps: TransportCapabilities = TransportCapabilities(condstore: true), folders: [RemoteFolder] = [RemoteFolder(path: "INBOX", delimiter: "/"), RemoteFolder(path: "Archive", delimiter: "/", attributes: ["archive"])]) async throws -> FakeMailTransport {
    let fake = FakeMailTransport(capabilities: caps, folders: folders)
    try await fake.connect(config)
    return fake
}

@Suite("ServerEndpoint")
struct ServerEndpointTests {
    @Test func secureMeansImplicitTLS() {
        let e = ServerEndpoint.from(host: "imap.gmail.com", port: 993, secure: true)
        #expect(e.tls == .implicit && !e.trustSelfSigned)
    }

    @Test func remotePlainMustUpgrade() {
        #expect(ServerEndpoint.from(host: "mail.example.com", port: 143, secure: false).tls == .startTLS)
    }

    @Test func loopbackRules() {
        let bridge = ServerEndpoint.from(host: "127.0.0.1", port: 1143, secure: false)
        #expect(bridge.tls == .startTLS && bridge.trustSelfSigned)
        let local = ServerEndpoint.from(host: "localhost", port: 3143, secure: false)
        #expect(local.tls == .startTLSIfAvailable && local.trustSelfSigned)
    }

    @Test func configurationFromServerConfigUsesUsernameCredential() {
        #expect(config.credential.user == "me@test.local")
        #expect(config.imap.port == 3143 && config.smtp.port == 3025)
    }
}

@Suite("FakeMailTransport")
struct FakeMailTransportTests {
    @Test func rejectedLoginIsAuthError() async {
        let fake = FakeMailTransport()
        await fake.rejectLogins()
        do { try await fake.connect(config); Issue.record("should throw") }
        catch let error as FlintError { #expect(error.code == .auth) }
        catch { Issue.record("wrong error") }
        #expect(await !fake.isConnected)
    }

    @Test func commandsNeedAConnection() async {
        let fake = FakeMailTransport()
        do { _ = try await fake.listFolders(); Issue.record("should throw") }
        catch let error as FlintError { #expect(error.code == .network) }
        catch { Issue.record("wrong error") }
    }

    @Test func listsFoldersWithAttributes() async throws {
        let fake = try await connected()
        let folders = try await fake.listFolders()
        #expect(folders.map(\.path) == ["INBOX", "Archive"])
        #expect(folders[1].attributes == ["archive"])
        #expect(folders[0].isSelectable)
    }

    @Test func deliverAssignsAscendingUIDsAndSelectReportsThem() async throws {
        let fake = try await connected()
        let first = await fake.deliver(envelope("one"), to: "INBOX")
        let second = await fake.deliver(envelope("two"), to: "INBOX")
        #expect(first == 1 && second == 2)
        let result = try await fake.select("INBOX", readOnly: true, qresync: nil)
        #expect(result.mailbox.uidNext == 3 && result.mailbox.exists == 2 && result.mailbox.uidValidity == 1000)
        #expect(result.mailbox.highestModseq != nil)
        #expect(!result.resynced)
    }

    @Test func selectMissingMailboxIsNotFound() async throws {
        let fake = try await connected()
        do { _ = try await fake.select("Nope", readOnly: true, qresync: nil); Issue.record("should throw") }
        catch let error as FlintError { #expect(error.code == .notFound) }
    }

    @Test func starRangeAlwaysIncludesHighestUID() async throws {
        let fake = try await connected()
        for i in 1...3 { await fake.deliver(envelope("m\(i)"), to: "INBOX") }
        _ = try await fake.select("INBOX", readOnly: true, qresync: nil)
        let found = try await fake.search(.uid(.range(from: 10, to: nil)))
        #expect(found == [])
        let fetched = try await fake.fetchEnvelopes(.range(from: 10, to: nil), options: EnvelopeFetchOptions())
        #expect(fetched.map(\.uid) == [3])
        let tail = try await fake.fetchEnvelopes(.range(from: 2, to: nil), options: EnvelopeFetchOptions())
        #expect(tail.map(\.uid) == [2, 3])
    }

    @Test func searchSinceAndHeader() async throws {
        let fake = try await connected()
        await fake.deliver(envelope("old", messageId: "<old@x>", date: Date(timeIntervalSince1970: 100)), to: "INBOX")
        await fake.deliver(envelope("new", messageId: "<new@x>", date: Date(timeIntervalSince1970: 5_000)), to: "INBOX")
        _ = try await fake.select("INBOX", readOnly: true, qresync: nil)
        #expect(try await fake.search(.since(Date(timeIntervalSince1970: 1_000))) == [2])
        #expect(try await fake.search(.header(name: "Message-ID", value: "old@x")) == [1])
        #expect(try await fake.search(.and([.all, .not(.header(name: "message-id", value: "old@x"))])) == [2])
    }

    @Test func fetchEnvelopesHonorsOptions() async throws {
        let fake = try await connected(TransportCapabilities(condstore: true, gmail: false))
        var env = envelope("hi")
        env.headers = ["list-id": "<l.x>", "x-secret": "no"]
        env.gmail = GmailAttributes(msgid: "1", thrid: "2", labels: ["\\Inbox"])
        env.bodyStructure = BodyPart(number: "1", type: "text", subtype: "plain")
        await fake.deliver(env, to: "INBOX")
        _ = try await fake.select("INBOX", readOnly: true, qresync: nil)
        let out = try await fake.fetchEnvelopes(.uids([1]), options: EnvelopeFetchOptions(bodyStructure: false, headers: ["List-Id"], gmail: true))
        #expect(out[0].headers == ["list-id": "<l.x>"])
        #expect(out[0].bodyStructure == nil)
        #expect(out[0].gmail == nil)
    }

    @Test func gmailAttributesWhenServerHasThem() async throws {
        let fake = try await connected(TransportCapabilities(condstore: true, gmail: true))
        var env = envelope("hi")
        env.gmail = GmailAttributes(msgid: "1", thrid: "2", labels: ["\\Inbox", "Work"])
        await fake.deliver(env, to: "INBOX")
        _ = try await fake.select("INBOX", readOnly: true, qresync: nil)
        let out = try await fake.fetchEnvelopes(.uids([1]), options: EnvelopeFetchOptions(gmail: true))
        #expect(out[0].gmail?.thrid == "2")
        let flags = try await fake.fetchFlags(.uids([1]), includeLabels: true, changedSince: nil)
        #expect(flags[0].labels == ["\\Inbox", "Work"])
    }

    @Test func storeFlagsAddRemoveReplace() async throws {
        let fake = try await connected()
        await fake.deliver(envelope("a"), to: "INBOX")
        _ = try await fake.select("INBOX", readOnly: false, qresync: nil)
        try await fake.storeFlags(.uids([1]), flags: [IMAPFlag.seen, IMAPFlag.flagged], mode: .add)
        #expect(try await fake.fetchFlags(.uids([1]), includeLabels: false, changedSince: nil)[0].flags == [IMAPFlag.seen, IMAPFlag.flagged])
        try await fake.storeFlags(.uids([1]), flags: [IMAPFlag.seen], mode: .remove)
        #expect(try await fake.fetchFlags(.uids([1]), includeLabels: false, changedSince: nil)[0].flags == [IMAPFlag.flagged])
        try await fake.storeFlags(.uids([1]), flags: [IMAPFlag.answered], mode: .replace)
        #expect(try await fake.fetchFlags(.uids([1]), includeLabels: false, changedSince: nil)[0].flags == [IMAPFlag.answered])
    }

    @Test func changedSinceReturnsOnlyNewerChanges() async throws {
        let fake = try await connected()
        await fake.deliver(envelope("a"), to: "INBOX")
        await fake.deliver(envelope("b"), to: "INBOX")
        let mark = try await fake.select("INBOX", readOnly: false, qresync: nil).mailbox.highestModseq!
        try await fake.storeFlags(.uids([2]), flags: [IMAPFlag.seen], mode: .add)
        let changed = try await fake.fetchFlags(.range(from: 1, to: nil), includeLabels: false, changedSince: mark)
        #expect(changed.map(\.uid) == [2])
    }

    @Test func changedSinceNeedsCondstore() async throws {
        let fake = try await connected(TransportCapabilities(condstore: false))
        await fake.deliver(envelope("a"), to: "INBOX")
        _ = try await fake.select("INBOX", readOnly: true, qresync: nil)
        do { _ = try await fake.fetchFlags(.uids([1]), includeLabels: false, changedSince: 1); Issue.record("should throw") }
        catch let error as FlintError { #expect(error.code == .invalid) }
    }

    @Test func moveMapsUIDsAndExpungesSource() async throws {
        let fake = try await connected()
        await fake.deliver(envelope("a"), to: "INBOX")
        await fake.deliver(envelope("b"), to: "INBOX")
        _ = try await fake.select("INBOX", readOnly: false, qresync: nil)
        let mapping = try await fake.move(.uids([2]), to: "Archive")
        #expect(mapping == [2: 1])
        #expect(await fake.envelopes(in: "INBOX").map(\.uid) == [1])
        #expect(await fake.envelopes(in: "Archive").map(\.subject) == ["b"])
    }

    @Test func moveWithoutUIDPlusReturnsNoMapping() async throws {
        let fake = try await connected(TransportCapabilities(uidPlus: false))
        await fake.deliver(envelope("a"), to: "INBOX")
        _ = try await fake.select("INBOX", readOnly: false, qresync: nil)
        #expect(try await fake.move(.uids([1]), to: "Archive").isEmpty)
        #expect(await fake.envelopes(in: "Archive").count == 1)
    }

    @Test func copyKeepsSource() async throws {
        let fake = try await connected()
        await fake.deliver(envelope("a"), to: "INBOX")
        _ = try await fake.select("INBOX", readOnly: false, qresync: nil)
        _ = try await fake.copy(.uids([1]), to: "Archive")
        #expect(await fake.envelopes(in: "INBOX").count == 1)
        #expect(await fake.envelopes(in: "Archive").count == 1)
    }

    @Test func expungeRemoves() async throws {
        let fake = try await connected()
        await fake.deliver(envelope("a"), to: "INBOX")
        _ = try await fake.select("INBOX", readOnly: false, qresync: nil)
        try await fake.expunge(.uids([1]))
        #expect(await fake.envelopes(in: "INBOX").isEmpty)
    }

    @Test func appendStoresParsedHeadersAndReturnsUID() async throws {
        let fake = try await connected()
        let raw = Data("Message-ID: <sent@x>\r\nSubject: Hello\r\n there\r\nTo: b@example.com\r\n\r\nbody".utf8)
        let uid = try await fake.append(raw, to: "INBOX", flags: [IMAPFlag.seen], date: nil)
        #expect(uid == 1)
        let stored = await fake.envelopes(in: "INBOX")[0]
        #expect(stored.messageId == "<sent@x>" && stored.subject == "Hello there" && stored.flags == [IMAPFlag.seen])
        _ = try await fake.select("INBOX", readOnly: true, qresync: nil)
        #expect(try await fake.fetchRawMessage(uid: 1) == raw)
    }

    @Test func qresyncReportsVanishedAndChanged() async throws {
        let fake = try await connected(TransportCapabilities(condstore: true, qresync: true))
        for s in ["a", "b", "c"] { await fake.deliver(envelope(s), to: "INBOX") }
        let first = try await fake.select("INBOX", readOnly: true, qresync: nil).mailbox
        let state = QResyncState(uidValidity: first.uidValidity, highestModseq: first.highestModseq!)
        await fake.removeExternally(uids: [1], in: "INBOX")
        await fake.setFlagsExternally(uids: [3], flags: [IMAPFlag.seen], in: "INBOX")
        let second = try await fake.select("INBOX", readOnly: true, qresync: state)
        #expect(second.resynced)
        #expect(second.vanishedUIDs == [1])
        #expect(second.changedFlags.map(\.uid) == [3])
    }

    @Test func qresyncIgnoredWhenUIDValidityChanged() async throws {
        let fake = try await connected(TransportCapabilities(condstore: true, qresync: true))
        await fake.deliver(envelope("a"), to: "INBOX")
        let first = try await fake.select("INBOX", readOnly: true, qresync: nil).mailbox
        await fake.setUIDValidity(first.uidValidity + 1, in: "INBOX")
        let second = try await fake.select("INBOX", readOnly: true, qresync: QResyncState(uidValidity: first.uidValidity, highestModseq: 1))
        #expect(!second.resynced && second.mailbox.exists == 0)
    }

    @Test func idleWakesOnDelivery() async throws {
        let fake = try await connected()
        let stream = await fake.idle(mailbox: "INBOX")
        var iterator = stream.makeAsyncIterator()
        await fake.deliver(envelope("push"), to: "INBOX")
        #expect(await iterator.next() == .newMessages(exists: 1))
        await fake.setFlagsExternally(uids: [1], flags: [IMAPFlag.seen], in: "INBOX")
        #expect(await iterator.next() == .flagsChanged)
    }

    @Test func idleEndsWithDisconnectedWhenConnectionDrops() async throws {
        let fake = try await connected()
        let stream = await fake.idle(mailbox: "INBOX")
        var iterator = stream.makeAsyncIterator()
        await fake.dropConnection(reason: "network")
        #expect(await iterator.next() == .disconnected(reason: "network"))
        #expect(await iterator.next() == nil)
        #expect(await !fake.isConnected)
    }

    @Test func idleOnMissingMailboxEndsImmediately() async throws {
        let fake = try await connected()
        var iterator = await fake.idle(mailbox: "Nope").makeAsyncIterator()
        if case .disconnected? = await iterator.next() {} else { Issue.record("expected disconnected") }
    }

    @Test func sendCapturesMessagesAndRejectsEmptyRecipients() async throws {
        let fake = try await connected()
        try await fake.send(OutgoingMessage(envelopeFrom: "me@test.local", recipients: ["b@example.com"], raw: Data("x".utf8)))
        #expect(await fake.sentMessages.count == 1)
        do { try await fake.send(OutgoingMessage(envelopeFrom: "me@test.local", recipients: [], raw: Data())); Issue.record("should throw") }
        catch let error as FlintError { #expect(error.code == .invalid) }
    }

    @Test func failNextIsOneShotAndLogsCalls() async throws {
        let fake = try await connected()
        await fake.failNext("listFolders", with: FlintError(.network, "boom"))
        do { _ = try await fake.listFolders(); Issue.record("should throw") } catch let error as FlintError { #expect(error.message == "boom") }
        _ = try await fake.listFolders()
        #expect(await fake.calls == ["connect", "listFolders", "listFolders"])
    }

    @Test func updateCredentialReplacesStoredCredential() async throws {
        let fake = try await connected()
        await fake.updateCredential(.xoauth2(user: "me@test.local", accessToken: "new"))
        if case .xoauth2(_, let token)? = await fake.configuration?.credential { #expect(token == "new") } else { Issue.record("credential not updated") }
    }

    @Test func disconnectEndsIdleAndSelectionState() async throws {
        let fake = try await connected()
        var iterator = await fake.idle(mailbox: "INBOX").makeAsyncIterator()
        await fake.disconnect()
        #expect(await iterator.next() == nil)
        do { _ = try await fake.search(.all); Issue.record("should throw") } catch is FlintError {}
    }

    @Test func verifySendHonorsRejectedLogins() async throws {
        let fake = FakeMailTransport()
        try await fake.verifySend()
        await fake.rejectLogins()
        do { try await fake.verifySend(); Issue.record("should throw") } catch let error as FlintError { #expect(error.code == .auth) }
    }

    @Test func fetchPartReturnsStoredPartOrNotFound() async throws {
        let fake = try await connected()
        await fake.deliver(envelope("a"), parts: ["1": Data("hello".utf8)], to: "INBOX")
        _ = try await fake.select("INBOX", readOnly: true, qresync: nil)
        #expect(try await fake.fetchPart(uid: 1, part: "1") == Data("hello".utf8))
        do { _ = try await fake.fetchPart(uid: 1, part: "2"); Issue.record("should throw") } catch let error as FlintError { #expect(error.code == .notFound) }
    }

    @Test func createFolderAddsMailbox() async throws {
        let fake = try await connected()
        try await fake.createFolder("Archive/2026")
        #expect(await fake.folderPaths().contains("Archive/2026"))
        #expect(try await fake.select("Archive/2026", readOnly: true, qresync: nil).mailbox.exists == 0)
    }
}
