import FlintMail
import FlintModel
import Foundation

/// One transport for every demo account: after `connect` it forwards to the in-memory server that owns the IMAP host. The
/// service builds a fresh transport per connection, so each instance routes on its own.
actor SeedRouterTransport: MailTransport {
    private let servers: [String: FakeMailTransport]
    private var target: FakeMailTransport?

    init(servers: [String: FakeMailTransport]) { self.servers = servers }

    private func current() throws -> FakeMailTransport {
        guard let target else { throw FlintError(.network, "Not connected.") }
        return target
    }

    func connect(_ configuration: MailTransportConfiguration) async throws {
        guard let server = servers[configuration.imap.host] else { throw FlintError(.network, "Couldn't reach that server.") }
        target = server
        try await server.connect(configuration)
    }

    func updateCredential(_ credential: MailCredential) async { await target?.updateCredential(credential) }
    func disconnect() async { await target?.disconnect() }
    var isConnected: Bool { get async { await target?.isConnected ?? false } }
    var capabilities: TransportCapabilities { get async { await target?.capabilities ?? TransportCapabilities() } }
    func verifySend() async throws { try await current().verifySend() }

    func listFolders() async throws -> [RemoteFolder] { try await current().listFolders() }
    func createFolder(_ path: String) async throws { try await current().createFolder(path) }
    func select(_ path: String, readOnly: Bool, qresync: QResyncState?) async throws -> SelectResult {
        try await current().select(path, readOnly: readOnly, qresync: qresync)
    }

    func search(_ criteria: SearchCriteria) async throws -> [Int] { try await current().search(criteria) }
    func fetchEnvelopes(_ uids: UIDSet, options: EnvelopeFetchOptions) async throws -> [RemoteEnvelope] {
        try await current().fetchEnvelopes(uids, options: options)
    }
    func fetchFlags(_ uids: UIDSet, includeLabels: Bool, changedSince: UInt64?) async throws -> [FlagState] {
        try await current().fetchFlags(uids, includeLabels: includeLabels, changedSince: changedSince)
    }
    func fetchBodyStructure(uid: Int) async throws -> BodyPart? { try await current().fetchBodyStructure(uid: uid) }
    func fetchPart(uid: Int, part: String) async throws -> Data { try await current().fetchPart(uid: uid, part: part) }
    func fetchRawMessage(uid: Int) async throws -> Data { try await current().fetchRawMessage(uid: uid) }

    func storeFlags(_ uids: UIDSet, flags: [String], mode: FlagMode) async throws {
        try await current().storeFlags(uids, flags: flags, mode: mode)
    }
    func move(_ uids: UIDSet, to path: String) async throws -> [Int: Int] { try await current().move(uids, to: path) }
    func copy(_ uids: UIDSet, to path: String) async throws -> [Int: Int] { try await current().copy(uids, to: path) }
    func expunge(_ uids: UIDSet) async throws { try await current().expunge(uids) }
    func append(_ raw: Data, to path: String, flags: [String], date: Date?) async throws -> Int? {
        try await current().append(raw, to: path, flags: flags, date: date)
    }

    func idle(mailbox: String) async -> AsyncStream<IdleEvent> {
        guard let target else { return AsyncStream { $0.finish() } }
        return await target.idle(mailbox: mailbox)
    }

    func send(_ message: OutgoingMessage) async throws { try await current().send(message) }
}
