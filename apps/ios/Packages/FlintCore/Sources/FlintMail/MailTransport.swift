// FROZEN CONTRACT (Wave 1, track 1B). The seam between Flint and the IMAP/SMTP library.
//
// One `MailTransport` is one IMAP connection plus the SMTP settings for sending. The account session owns two per
// account (commands, and IDLE) and tears both down when the app backgrounds. Implementations:
//   - SwiftMailTransport (track 2B, the only file that imports SwiftMail)
//   - FakeMailTransport (this track, in-memory, for sync-engine tests)
//
// Rules for implementations:
//   - Errors are `FlintError`: `.auth` for rejected credentials, `.network` for connection loss or timeout,
//     `.notFound` for a missing mailbox, `.invalid` for a bad request. Never put a credential or message body in a message.
//   - UIDs are scoped to the selected mailbox; commands that take a UID set act on the mailbox from the last `select`.
//   - Methods are not required to be re-entrant: callers serialize commands per transport (the account session actor does).
//   - `idle` is the exception: it runs on its own transport and returns immediately with a stream.

import FlintModel
import Foundation

public protocol MailTransport: Sendable {
    // Connection
    func connect(_ configuration: MailTransportConfiguration) async throws
    /// Replaces the credential used for new SMTP sessions and reconnects (OAuth refresh).
    func updateCredential(_ credential: MailCredential) async
    func disconnect() async
    var isConnected: Bool { get async }
    var capabilities: TransportCapabilities { get async }
    /// Logs in to SMTP without sending, for "test connection".
    func verifySend() async throws

    // Folders
    func listFolders() async throws -> [RemoteFolder]
    func createFolder(_ path: String) async throws
    /// Selects a mailbox. With `qresync` and a server that supports it, the result carries vanished UIDs and flag changes.
    func select(_ path: String, readOnly: Bool, qresync: QResyncState?) async throws -> SelectResult

    // Reading (act on the selected mailbox)
    func search(_ criteria: SearchCriteria) async throws -> [Int]
    func fetchEnvelopes(_ uids: UIDSet, options: EnvelopeFetchOptions) async throws -> [RemoteEnvelope]
    /// UID, FLAGS (and labels when `includeLabels` on Gmail). With `changedSince`, only messages changed after that modseq.
    func fetchFlags(_ uids: UIDSet, includeLabels: Bool, changedSince: UInt64?) async throws -> [FlagState]
    func fetchBodyStructure(uid: Int) async throws -> BodyPart?
    /// One body part with its transfer encoding removed. Charset conversion is the caller's job.
    func fetchPart(uid: Int, part: String) async throws -> Data
    /// The complete RFC 5322 message.
    func fetchRawMessage(uid: Int) async throws -> Data

    // Writing (act on the selected mailbox)
    func storeFlags(_ uids: UIDSet, flags: [String], mode: FlagMode) async throws
    /// Moves messages (MOVE, or COPY + delete + expunge). Returns old UID to new UID where the server reports it (UIDPLUS).
    func move(_ uids: UIDSet, to path: String) async throws -> [Int: Int]
    func copy(_ uids: UIDSet, to path: String) async throws -> [Int: Int]
    /// Marks `\Deleted` and expunges exactly these UIDs.
    func expunge(_ uids: UIDSet) async throws
    /// Appends a message to a mailbox without selecting it. Returns the new UID when the server reports it (APPENDUID).
    func append(_ raw: Data, to path: String, flags: [String], date: Date?) async throws -> Int?

    // Push
    /// Selects `mailbox` read-only on this (dedicated) transport and waits for server events. The stream ends after
    /// `.disconnected` or when the consumer stops iterating.
    func idle(mailbox: String) async -> AsyncStream<IdleEvent>

    // Sending
    func send(_ message: OutgoingMessage) async throws
}
