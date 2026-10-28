import FlintModel
import Foundation

/// What Flint remembers about invitations on this device: the versions of each event it has read, the person's own answers and
/// whether the event went into their calendar. Re-derivable from mail except the answers, so a damaged file is simply dropped.
@MainActor
final class InviteLedger {
    struct Entry: Codable, Hashable, Sendable {
        var key: String
        var invite: ParsedInvite
    }

    struct Snapshot: Codable, Equatable, Sendable {
        var parserVersion = InviteLedger.parserVersion
        /// Message row id to the invite that message carried.
        var versions: [Int: Entry] = [:]
        var answers: [String: InviteAnswer] = [:]
        /// Event key to the SEQUENCE that was added to the calendar.
        var added: [String: Int] = [:]
        /// Event keys, oldest first, so the file stays bounded.
        var order: [String] = []
    }

    /// Bump when the parser's output changes, so stored versions are read again.
    nonisolated static let parserVersion = 1
    nonisolated static let maxEvents = 400

    private(set) var snapshot: Snapshot
    private let fileURL: URL?

    /// A ledger kept in memory only (the demo mailbox and tests), or read from and written to `fileURL`.
    init(fileURL: URL? = nil) {
        self.fileURL = fileURL
        let loaded = fileURL.flatMap { try? Data(contentsOf: $0) }.flatMap { try? JSONDecoder().decode(Snapshot.self, from: $0) }
        if let loaded, loaded.parserVersion == Self.parserVersion {
            snapshot = loaded
        } else {
            // A different parser version drops stored invites but keeps the answers: they cannot be rebuilt.
            snapshot = Snapshot(answers: loaded?.answers ?? [:], added: loaded?.added ?? [:])
        }
    }

    static let live = InviteLedger(fileURL: defaultURL())
    static let demo = InviteLedger()

    private static func defaultURL() -> URL? {
        let support = try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return support?.appendingPathComponent("Flint", isDirectory: true).appendingPathComponent("invites.json")
    }

    // MARK: Versions

    func version(messageId: Int) -> InviteVersion? {
        snapshot.versions[messageId].map { InviteVersion(messageId: messageId, invite: $0.invite) }
    }

    func versions(forKey key: String) -> [InviteVersion] {
        snapshot.versions.filter { $0.value.key == key }.map { InviteVersion(messageId: $0.key, invite: $0.value.invite) }
    }

    func record(_ invite: ParsedInvite, messageId: Int, account: AccountID) {
        let key = invite.eventKey(account: account)
        var next = snapshot
        next.versions[messageId] = Entry(key: key, invite: invite)
        if !next.order.contains(key) { next.order.append(key) }
        while next.order.count > Self.maxEvents {
            let dropped = next.order.removeFirst()
            next.versions = next.versions.filter { $0.value.key != dropped }
            next.answers[dropped] = nil
            next.added[dropped] = nil
        }
        commit(next)
    }

    // MARK: Answers and calendar

    func answer(forKey key: String) -> InviteAnswer? { snapshot.answers[key] }

    func setAnswer(_ answer: InviteAnswer, forKey key: String) {
        var next = snapshot
        next.answers[key] = answer
        commit(next)
    }

    /// The SEQUENCE of the version that was added to the calendar, if any.
    func addedSequence(forKey key: String) -> Int? { snapshot.added[key] }

    func markAdded(sequence: Int, forKey key: String) {
        var next = snapshot
        next.added[key] = sequence
        commit(next)
    }

    private func commit(_ next: Snapshot) {
        guard next != snapshot else { return }
        snapshot = next
        guard let fileURL else { return }
        do {
            try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(next).write(to: fileURL, options: [.atomic, .completeFileProtection])
        } catch {
            // The ledger is a convenience; a failed write must not break reading the invite.
        }
    }
}
