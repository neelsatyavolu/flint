// Small helpers over GRDB so the repositories read like the SQL they run. Internal to FlintStore.

import FlintModel
import Foundation
import GRDB

typealias SQLArg = (any DatabaseValueConvertible)?

extension Database {
    /// Runs a statement and returns how many rows it changed.
    @discardableResult
    func run(_ sql: String, _ args: SQLArg...) throws -> Int {
        try execute(sql: sql, arguments: StatementArguments(args))
        return changesCount
    }

    /// Runs an INSERT and returns the new rowid.
    func insert(_ sql: String, _ args: SQLArg...) throws -> Int {
        try execute(sql: sql, arguments: StatementArguments(args))
        return Int(lastInsertedRowID)
    }

    func all(_ sql: String, _ args: SQLArg...) throws -> [Row] {
        try Row.fetchAll(self, sql: sql, arguments: StatementArguments(args))
    }

    func all(_ sql: String, args: [SQLArg]) throws -> [Row] {
        try Row.fetchAll(self, sql: sql, arguments: StatementArguments(args))
    }

    func first(_ sql: String, _ args: SQLArg...) throws -> Row? {
        try Row.fetchOne(self, sql: sql, arguments: StatementArguments(args))
    }

    func first(_ sql: String, args: [SQLArg]) throws -> Row? {
        try Row.fetchOne(self, sql: sql, arguments: StatementArguments(args))
    }

    func exists(_ sql: String, _ args: SQLArg...) throws -> Bool {
        try Row.fetchOne(self, sql: sql, arguments: StatementArguments(args)) != nil
    }

    func count(_ sql: String, _ args: SQLArg...) throws -> Int {
        try Int.fetchOne(self, sql: sql, arguments: StatementArguments(args)) ?? 0
    }
}

extension Row {
    func bool(_ column: String) -> Bool { (self[column] as Int?) == 1 }
}

enum SQL {
    /// "?,?,?" for an IN list.
    static func marks(_ n: Int) -> String { Array(repeating: "?", count: n).joined(separator: ",") }

    /// Escapes % _ and \ for use in LIKE ... ESCAPE '\'.
    static func escapeLike(_ value: String) -> String {
        var out = ""
        for ch in value {
            if ch == "\\" || ch == "%" || ch == "_" { out.append("\\") }
            out.append(ch)
        }
        return out
    }

    /// Lower bound of IN-list sizes SQLite accepts comfortably.
    static let chunkSize = 500
}

extension Array {
    /// Splits a long list so IN (...) stays under SQLite's variable limit.
    func chunked(_ size: Int = SQL.chunkSize) -> [[Element]] {
        guard !isEmpty else { return [] }
        return stride(from: 0, to: count, by: size).map { Array(self[$0..<Swift.min($0 + size, count)]) }
    }
}

/// JSON columns. Slashes stay unescaped and keys are sorted so stored text is stable and LIKE filters see what the user typed.
enum JSONColumn {
    static func encode<T: Encodable>(_ value: T) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(value), let text = String(data: data, encoding: .utf8) else { return "null" }
        return text
    }

    static func decode<T: Decodable>(_ text: String?, fallback: T) -> T {
        guard let text, !text.isEmpty, let data = text.data(using: .utf8) else { return fallback }
        return (try? JSONDecoder().decode(T.self, from: data)) ?? fallback
    }

    static func addresses(_ text: String?) -> [Address] { decode(text, fallback: []) }
}

/// Message-ID without angle brackets, or nil.
func cleanID(_ value: String?) -> String? {
    guard var s = value?.trimmingCharacters(in: .whitespacesAndNewlines) else { return nil }
    while s.hasPrefix("<") { s.removeFirst() }
    while s.hasSuffix(">") { s.removeLast() }
    s = s.trimmingCharacters(in: .whitespacesAndNewlines)
    return s.isEmpty ? nil : s
}

func lowerAddress(_ a: Address?) -> String {
    (a?.address ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
}

/// Whole-word searchable text for an address list: names and addresses.
func addressText(_ list: [Address]) -> String {
    list.map { "\($0.name) \($0.address)".trimmingCharacters(in: .whitespaces) }.joined(separator: " ")
}

func asCategory(_ value: String?) -> MailCategory? { value.flatMap(MailCategory.init(rawValue:)) }

/// Predicate for all-accounts views: leaves out accounts the user turned off for the unified inbox.
func inUnified(_ column: String) -> String { "\(column) NOT IN (SELECT id FROM accounts WHERE show_in_unified = 0)" }

/// A random URL-safe id of 12 characters, like nanoid(12).
func makeAccountID() -> String {
    let alphabet = Array("_-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")
    var rng = SystemRandomNumberGenerator()
    return String((0..<12).map { _ in alphabet[Int.random(in: 0..<alphabet.count, using: &rng)] })
}

func nowMs() -> EpochMs { Int((Date().timeIntervalSince1970 * 1000).rounded()) }
