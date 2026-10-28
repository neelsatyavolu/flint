import FlintModel
import Foundation
import GRDB
import Testing
import Synchronization
@testable import FlintStore

/// A small stand-in for FlintClassify so the store tests do not depend on that track: list headers mean newsletters,
/// automated local parts mean notifications, known contacts are people, and rules match `from`/`subject` contains.
struct StoreTestClassifier: MailClassifier {
    func category(from: Address?, headers: [String: String], isKnownContact: Bool, subject: String) -> MailCategory {
        if isKnownContact { return .people }
        let address = (from?.address ?? "").lowercased()
        let local = address.split(separator: "@").first.map(String.init) ?? ""
        if headers["feedback-id"] != nil || ["noreply", "alerts", "automated", "notifications"].contains(local) { return .notifications }
        if headers["list-id"] != nil || headers["list-unsubscribe"] != nil { return .newsletters }
        return .people
    }

    func ruleActions(
        rules: [Rule], accountId: AccountID, from: [Address], to: [Address], cc: [Address], bcc: [Address],
        subject: String, body: String, headers: [String: String], hasAttachments: Bool
    ) -> [RuleAction] {
        func hit(_ c: RuleCondition) -> Bool {
            let v = c.value.lowercased()
            switch c.field {
            case .from: return from.contains { "\($0.name) <\($0.address)>".lowercased().contains(v) }
            case .subject: return subject.lowercased().contains(v)
            default: return false
            }
        }
        return rules.sorted { ($0.sortOrder, $0.id) < ($1.sortOrder, $1.id) }.filter { rule in
            !rule.conditions.isEmpty && (rule.match == .all ? rule.conditions.allSatisfy(hit) : rule.conditions.contains(where: hit))
        }.flatMap(\.actions)
    }
}

struct StoreImapSeed {
    var account: Account
    var inbox: Folder, sent: Folder, trash: Folder, spam: Folder, drafts: Folder, archive: Folder
}

struct StoreGmailSeed {
    var account: Account
    var all: Folder, inbox: Folder, sent: Folder, trash: Folder, spam: Folder, drafts: Folder
}

/// Test helpers: in-memory store, seeded accounts, message builder.
enum StoreTestKit {
    static let day = 24 * 60 * 60 * 1000
    static let hour = 3_600_000
    /// 2026-10-01 12:00 UTC.
    static let t0 = 1_790_856_000_000
    private static let counter = Atomic<Int>(0)

    static func me() -> Address { Address(name: "Me", address: "me@example.com") }
    static func person(_ name: String, _ address: String? = nil) -> Address {
        Address(name: name, address: address ?? "\(name.lowercased())@example.org")
    }

    static func makeStore() throws -> GRDBStore { try GRDBStore.inMemory(classifier: StoreTestClassifier()) }

    static let server = ServerConfig(imapHost: "imap.example.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.example.com", smtpPort: 465, smtpSecure: true, username: "")

    static func newAccount(_ email: String, provider: MailProvider = .imap, authKind: AuthKind = .password, aliases: [String]? = nil) -> NewAccount {
        var s = server
        s.username = email
        return NewAccount(email: email, name: "Me", provider: provider, authKind: authKind, server: s, aliases: aliases)
    }

    static func seedImap(_ store: GRDBStore, _ email: String = "me@example.com") async throws -> StoreImapSeed {
        let account = try await store.createAccount(newAccount(email))
        func f(_ path: String, _ role: MailboxRole) async throws -> Folder { try await store.upsertFolder(account.id, FolderInput(path: path, role: role)) }
        return StoreImapSeed(
            account: account, inbox: try await f("INBOX", .inbox), sent: try await f("Sent", .sent), trash: try await f("Trash", .trash),
            spam: try await f("Junk", .spam), drafts: try await f("Drafts", .drafts), archive: try await f("Archive", .archive))
    }

    static func seedGmail(_ store: GRDBStore, _ email: String = "me@gmail.com") async throws -> StoreGmailSeed {
        let account = try await store.createAccount(newAccount(email, provider: .gmail))
        func f(_ path: String, _ role: MailboxRole) async throws -> Folder { try await store.upsertFolder(account.id, FolderInput(path: path, role: role)) }
        return StoreGmailSeed(
            account: account, all: try await f("[Gmail]/All Mail", .all), inbox: try await f("INBOX", .inbox), sent: try await f("[Gmail]/Sent Mail", .sent),
            trash: try await f("[Gmail]/Trash", .trash), spam: try await f("[Gmail]/Spam", .spam), drafts: try await f("[Gmail]/Drafts", .drafts))
    }

    static func rule(
        _ name: String, enabled: Bool = true, accountId: AccountID? = nil, match: RuleMatch = .all, sortOrder: Int = 0,
        conditions: [RuleCondition], actions: [RuleAction]
    ) -> Rule {
        Rule(id: 0, name: name, enabled: enabled, accountId: accountId, match: match, conditions: conditions, actions: actions, sortOrder: sortOrder)
    }

    static let seen = MessageFlags(seen: true)
    static let unseen = MessageFlags()
    static let draftFlags = MessageFlags(seen: true, draft: true)
    static let flaggedSeen = MessageFlags(seen: true, flagged: true)

    /// Builds an IngestMessage with sensible defaults; `configure` overrides fields.
    static func msg(_ uid: Int, _ configure: (inout IngestMessage) -> Void = { _ in }) -> IngestMessage {
        let n = counter.add(1, ordering: .relaxed).newValue
        var m = IngestMessage(
            uid: uid, messageId: "m\(n)-\(uid)@example.org", subject: "Hello", from: [person("Carla")], to: [me()],
            date: t0 + n * 1000, size: 1000)
        configure(&m)
        return m
    }

    static func ingest(_ store: GRDBStore, _ s: StoreImapSeed, _ folder: Folder, _ items: IngestMessage..., evaluate: Bool = true) async throws -> [IngestOutcome] {
        try await store.ingestMessages(s.account.id, folder.id, items, context: IngestContext(evaluate: evaluate))
    }

    // MARK: Raw access for assertions

    static func count(_ store: GRDBStore, _ sql: String, _ args: [any DatabaseValueConvertible & Sendable] = []) async throws -> Int {
        try await store.writer.read { db in try Int.fetchOne(db, sql: sql, arguments: StatementArguments(args)) ?? 0 }
    }

    static func exec(_ store: GRDBStore, _ sql: String, _ args: [any DatabaseValueConvertible & Sendable] = []) async throws {
        try await store.writer.write { db in try db.execute(sql: sql, arguments: StatementArguments(args)) }
    }

    static func strings(_ store: GRDBStore, _ sql: String, _ args: [any DatabaseValueConvertible & Sendable] = []) async throws -> [String] {
        try await store.writer.read { db in try String.fetchAll(db, sql: sql, arguments: StatementArguments(args)) }
    }
}

/// Expects `body` to throw a FlintError, optionally with this code and a fragment of its message.
func expectStoreError(
    _ code: FlintErrorCode? = nil, _ fragment: String? = nil, sourceLocation: SourceLocation = #_sourceLocation,
    _ body: () async throws -> Void
) async {
    do {
        try await body()
        Issue.record("expected a FlintError", sourceLocation: sourceLocation)
    } catch let e as FlintError {
        if let code { #expect(e.code == code, sourceLocation: sourceLocation) }
        if let fragment { #expect(e.message.contains(fragment), sourceLocation: sourceLocation) }
    } catch {
        Issue.record("unexpected error \(error)", sourceLocation: sourceLocation)
    }
}
