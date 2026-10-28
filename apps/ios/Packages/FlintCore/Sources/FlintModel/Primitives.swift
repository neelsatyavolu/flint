// FROZEN CONTRACT (Wave 1, track 1B). Mirrors packages/core/src/types.ts.
// Changing a type here needs the wave lead's sign-off and a note in docs/ios/HANDOFF.md.
//
// Conventions: every type is a Sendable value type. Codable shapes use the same camelCase keys as the TypeScript
// types so JSON fixtures, settings export and Mac pairing round-trip. Timestamps are epoch milliseconds (Int).
// Renames against TypeScript, to avoid clashes with Foundation and SwiftUI: Bundle -> InboxBundle,
// View -> ThreadListView, Provider -> MailProvider, Thread* ids are `ThreadID` (capital D), MessageRowId -> MessageRowID.

import Foundation

public typealias AccountID = String
public typealias ThreadID = Int
public typealias MessageRowID = Int
public typealias FolderID = Int
/// Milliseconds since the Unix epoch.
public typealias EpochMs = Int

public struct Address: Codable, Hashable, Sendable {
    public var name: String
    public var address: String

    public init(name: String = "", address: String) {
        self.name = name
        self.address = address
    }
}

public enum MailCategory: String, Codable, CaseIterable, Hashable, Sendable {
    case people, notifications, newsletters
}

/// A JSON value, for open-ended payloads (agent activity detail) and settings patches.
public enum JSONValue: Codable, Hashable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        }
    }

    /// Deep merge: objects merge key by key, everything else in `patch` replaces. Returns a new value.
    public func merging(_ patch: JSONValue) -> JSONValue {
        guard case .object(let base) = self, case .object(let over) = patch else { return patch }
        var out = base
        for (key, value) in over {
            if let existing = out[key] { out[key] = existing.merging(value) } else { out[key] = value }
        }
        return .object(out)
    }
}

/// Mirrors the TypeScript FlintError codes.
public enum FlintErrorCode: String, Codable, Hashable, Sendable {
    case notFound = "not_found"
    case invalid
    case auth
    case network
    case permission
    case conflict
    case aiNotConnected = "ai_not_connected"
    case `internal`
}

public struct FlintError: Error, Codable, Hashable, Sendable, CustomStringConvertible {
    public var code: FlintErrorCode
    public var message: String

    public init(_ code: FlintErrorCode, _ message: String) {
        self.code = code
        self.message = message
    }

    public var description: String { "\(code.rawValue): \(message)" }
}
