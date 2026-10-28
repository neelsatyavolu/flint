// GRDB implementation of `Store` (track 2A). One SQLite database in WAL mode (an in-memory queue for tests), the desktop
// schema ported as migrations 1 to 8, FTS5 search, and one write transaction per protocol method. The repositories live in
// Repositories/ as extensions of this class; Support/ holds the SQL helpers.

import FlintModel
import Foundation
import GRDB

public final class GRDBStore: Sendable {
    let writer: any DatabaseWriter
    let classifier: any MailClassifier
    /// Source of "now" for methods whose protocol signature carries no clock (rule and block timestamps, account creation).
    let clock: @Sendable () -> EpochMs

    /// The wall clock in epoch milliseconds.
    public static let systemClock: @Sendable () -> EpochMs = { Int((Date().timeIntervalSince1970 * 1000).rounded()) }

    /// Wraps an open database and applies pending migrations.
    public init(writer: any DatabaseWriter, classifier: any MailClassifier = PeopleClassifier(), clock: @escaping @Sendable () -> EpochMs = GRDBStore.systemClock) throws {
        self.writer = writer
        self.classifier = classifier
        self.clock = clock
        try Migrations.migrator().migrate(writer)
    }

    /// A private in-memory database, for tests and previews.
    public static func inMemory(classifier: any MailClassifier = PeopleClassifier(), clock: @escaping @Sendable () -> EpochMs = GRDBStore.systemClock) throws -> GRDBStore {
        try GRDBStore(writer: DatabaseQueue(configuration: configuration()), classifier: classifier, clock: clock)
    }

    /// Opens (or creates) the database file. The folder and file are for this user only.
    public static func open(path: String, classifier: any MailClassifier = PeopleClassifier(), clock: @escaping @Sendable () -> EpochMs = GRDBStore.systemClock) throws -> GRDBStore {
        let url = URL(fileURLWithPath: path)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        if !FileManager.default.fileExists(atPath: path) {
            FileManager.default.createFile(atPath: path, contents: nil, attributes: [.posixPermissions: 0o600])
        }
        return try GRDBStore(writer: DatabasePool(path: path, configuration: configuration()), classifier: classifier, clock: clock)
    }

    private static func configuration() -> Configuration {
        var config = Configuration()
        config.foreignKeysEnabled = true
        config.busyMode = .timeout(5)
        config.prepareDatabase { db in
            try db.execute(sql: "PRAGMA synchronous = NORMAL")
        }
        return config
    }

    // MARK: Running work

    /// One write transaction. Errors other than `FlintError` are reported without SQL text or bound values (mail content).
    @discardableResult
    func write<T: Sendable>(_ body: @escaping @Sendable (Database) throws -> T) async throws -> T {
        do { return try await writer.write(body) } catch { throw Self.flint(error) }
    }

    func read<T: Sendable>(_ body: @escaping @Sendable (Database) throws -> T) async throws -> T {
        do { return try await writer.read(body) } catch { throw Self.flint(error) }
    }

    static func flint(_ error: Error) -> FlintError {
        if let e = error as? FlintError { return e }
        if let e = error as? DatabaseError {
            if e.extendedResultCode == .SQLITE_CONSTRAINT_UNIQUE || e.extendedResultCode == .SQLITE_CONSTRAINT_PRIMARYKEY {
                return FlintError(.conflict, "That item already exists.")
            }
            return FlintError(.internal, "Database error (code \(e.resultCode.rawValue)): \(e.message ?? "unknown")")
        }
        return FlintError(.internal, "Database error: \(type(of: error))")
    }
}

