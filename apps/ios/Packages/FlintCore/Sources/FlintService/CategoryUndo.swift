// Extra undo work for "always file this sender here": the rule that was created or changed is put back when the move is
// undone. Entries expire with the undo token itself (30 seconds).

import FlintMail
import FlintModel
import Foundation

actor CategoryUndo {
    private var entries: [String: (restore: @Sendable () async -> Void, expiresAt: Date)] = [:]

    func register(token: String, restore: @escaping @Sendable () async -> Void) {
        prune()
        entries[token] = (restore, Date().addingTimeInterval(Double(UndoRegistry.defaultTTLMs) / 1000))
    }

    /// Runs (once) the extra undo work registered for this token.
    func run(_ token: String) async {
        let entry = entries.removeValue(forKey: token)
        await entry?.restore()
    }

    func forget(_ token: String) { entries[token] = nil }

    private func prune() {
        let now = Date()
        entries = entries.filter { $0.value.expiresAt > now }
    }
}
