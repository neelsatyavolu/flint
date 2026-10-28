// Settings: one `settings` row (key "app") holding only the user's overrides as JSON. Reads merge them over the defaults;
// writes validate the patch (known keys, enum values, ranges) before anything is stored. Ported from store/settings.ts.

import FlintModel
import Foundation
import GRDB

enum SettingsSQL {
    static let key = "app"

    static func overrides(_ db: Database) throws -> JSONValue {
        guard let text = try String.fetchOne(db, sql: "SELECT value FROM settings WHERE key = ?", arguments: [key]),
              let data = text.data(using: .utf8),
              let value = try? JSONDecoder().decode(JSONValue.self, from: data),
              case .object = value
        else { return .object([:]) }
        return value
    }

    /// Stored overrides merged over defaults. Invalid stored data falls back to defaults.
    static func current(_ db: Database) throws -> Settings {
        guard let merged = try? Settings.default.merging(overrides(db)), validate(merged) else { return .default }
        return merged
    }

    static func update(_ db: Database, _ patch: JSONValue) throws -> Settings {
        guard case .object = patch, let defaults = try? JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(Settings.default)) else {
            throw FlintError(.invalid, "That setting is not valid.")
        }
        if let path = unknownKey(patch, in: defaults, path: []) { throw FlintError(.invalid, "That setting is not valid: \(path).") }
        let stored = try overrides(db)
        let next = stored.merging(patch)
        guard let full = try? Settings.default.merging(next), validate(full) else {
            throw FlintError(.invalid, "That combination of settings is not valid.")
        }
        let text = String(data: try JSONEncoder().encode(next), encoding: .utf8) ?? "{}"
        try db.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", key, text)
        return full
    }

    /// Optional settings have no key in the encoded defaults, but a patch may set them.
    private static let optionalKeys: Set<String> = ["ai.provider", "ai.model", "google.builtIn"]

    /// First dotted path in `patch` that the settings model does not have. Empty default objects (per-account maps) accept any key.
    private static func unknownKey(_ patch: JSONValue, in defaults: JSONValue, path: [String]) -> String? {
        guard case .object(let p) = patch, case .object(let d) = defaults, !d.isEmpty else { return nil }
        for (k, v) in p.sorted(by: { $0.key < $1.key }) {
            let dotted = (path + [k]).joined(separator: ".")
            if d[k] == nil && optionalKeys.contains(dotted) { continue }
            guard let known = d[k] else { return dotted }
            if let bad = unknownKey(v, in: known, path: path + [k]) { return bad }
        }
        return nil
    }

    /// The ranges the desktop schema enforces beyond what Codable checks.
    static func validate(_ s: Settings) -> Bool {
        (0...2).contains(s.appearance.previewLines)
            && [0, 5, 10, 20, 30].contains(s.compose.undoSendSeconds)
            && s.receipts.endpoint.count <= 500
            && (1...3650).contains(s.sync.initialDays)
            && (0...3650).contains(s.sync.bodiesForRecentDays)
            && s.notifications.disabledAccounts.count <= 200 && s.notifications.disabledAccounts.allSatisfy { $0.count <= 100 }
            && s.ai.writingStyle.count <= 4000 && s.ai.replyLanguage.count <= 100 && (s.ai.model?.count ?? 0) <= 200
            && s.google.clientId.count <= 500 && s.google.clientSecret.count <= 500
            && ["codex", "grok", nil].contains(s.ai.provider)
            && ["allow", "deny"].contains(s.agents.modify) && ["allow", "ask", "deny"].contains(s.agents.send)
            && ["auto", "ask", "manual"].contains(s.updates.mode)
            && Self.sounds.contains(s.notifications.soundName)
    }

    /// NOTIFICATION_SOUNDS in packages/core/src/types.ts.
    static let sounds: Set<String> = [
        "default", "Glass", "Ping", "Pop", "Hero", "Submarine", "Tink", "Basso", "Blow", "Bottle", "Frog", "Funk", "Morse", "Purr", "Sosumi",
    ]
}

extension GRDBStore: SettingsRepository {
    public func settings() async throws -> Settings {
        try await read { db in try SettingsSQL.current(db) }
    }

    /// Deep-merges a partial JSON patch (see `Settings.merging`), validates, stores and returns the result.
    public func updateSettings(_ patch: JSONValue) async throws -> Settings {
        try await write { db in try SettingsSQL.update(db, patch) }
    }
}
