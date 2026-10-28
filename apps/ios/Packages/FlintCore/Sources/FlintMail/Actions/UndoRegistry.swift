// Undo tokens for thread actions. Entries live 30 seconds and can be used once. Port of packages/core/src/service/undo.ts.

import FlintModel
import Foundation

public typealias ServerOp = @Sendable (ServerActions, [MessageLocation]) async -> ActionReport
/// Brings the server back to the pre-change state. `locs` are the affected messages as the store holds them after the
/// local restore.
public typealias InverseOp = @Sendable (ServerActions, [MessageLocation], ThreadSnapshot) async -> ActionReport

public struct UndoEntry: Sendable {
    public var label: String
    public var snapshot: ThreadSnapshot
    /// Messages whose server state the action changed (`ActionResult.locations`).
    public var affected: [MessageRowID]
    public var inverse: InverseOp?

    public init(label: String, snapshot: ThreadSnapshot, affected: [MessageRowID], inverse: InverseOp? = nil) {
        self.label = label
        self.snapshot = snapshot
        self.affected = affected
        self.inverse = inverse
    }
}

public actor UndoRegistry {
    public static let defaultTTLMs = 30_000

    private struct Stored { var entry: UndoEntry; var expiresAt: EpochMs }
    private var entries: [String: Stored] = [:]
    private let ttlMs: Int
    private let now: @Sendable () -> EpochMs

    public init(ttlMs: Int = UndoRegistry.defaultTTLMs, now: @escaping @Sendable () -> EpochMs = { Int(Date().timeIntervalSince1970 * 1000) }) {
        self.ttlMs = ttlMs
        self.now = now
    }

    public func register(_ entry: UndoEntry) -> String {
        prune()
        let token = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        entries[token] = Stored(entry: entry, expiresAt: now() + ttlMs)
        return token
    }

    /// Removes and returns the entry. Throws when the token is unknown, used or expired.
    public func take(_ token: String) throws -> UndoEntry {
        prune()
        guard let found = entries.removeValue(forKey: token) else { throw FlintError(.notFound, "That can't be undone any more.") }
        return found.entry
    }

    public func discard(_ token: String) { entries[token] = nil }

    public var count: Int {
        prune()
        return entries.count
    }

    private func prune() {
        let current = now()
        entries = entries.filter { $0.value.expiresAt > current }
    }
}
