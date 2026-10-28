// kv_cache with TTLs. Ported from store/kv.ts. The stored value is an envelope: {"v": value, "exp": expiry or null}.

import FlintModel
import Foundation
import GRDB

private struct KVEnvelope: Codable {
    var v: String
    var exp: Int?
}

extension GRDBStore: KeyValueRepository {
    /// Value stored under key, or nil when missing or past its TTL.
    public func kvGet(_ key: String, now: EpochMs) async throws -> String? {
        try await write { db in
            guard let row = try db.first("SELECT value FROM kv_cache WHERE key = ?", key),
                  let env: KVEnvelope = JSONColumn.decode(row["value"], fallback: nil)
            else { return nil }
            if let exp = env.exp, exp <= now {
                try db.run("DELETE FROM kv_cache WHERE key = ?", key)
                return nil
            }
            return env.v
        }
    }

    public func kvSet(_ key: String, _ value: String, ttlMs: Int?, now: EpochMs) async throws {
        let env = JSONColumn.encode(KVEnvelope(v: value, exp: ttlMs.map { now + $0 }))
        try await write { db in
            try db.run(
                "INSERT INTO kv_cache (key, value, created_at) VALUES (?,?,?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, created_at = excluded.created_at",
                key, env, now)
        }
    }

    public func kvDelete(_ key: String) async throws {
        try await write { db in try db.run("DELETE FROM kv_cache WHERE key = ?", key) }
    }

    /// Deletes entries whose TTL has passed. Returns how many.
    public func kvPurgeExpired(now: EpochMs) async throws -> Int {
        try await write { db in
            try db.run("DELETE FROM kv_cache WHERE json_extract(value, '$.exp') IS NOT NULL AND json_extract(value, '$.exp') <= ?", now)
        }
    }
}
