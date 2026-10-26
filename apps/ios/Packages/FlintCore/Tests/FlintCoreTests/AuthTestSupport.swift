// Shared helpers for the Auth* suites (track 2C): fixture loading, a scripted HTTP client, an in-memory accounts repository.

import FlintMail
import FlintModel
import FlintStore
import Foundation

struct AuthFixtureCase: Decodable {
    let name: String
    let input: JSONValue
    let expect: JSONValue
}

struct AuthFixtureFile: Decodable {
    struct Meta: Decodable { let version: Int }
    let meta: Meta
    let cases: [AuthFixtureCase]
}

enum AuthFixtures {
    static func load(_ name: String) throws -> AuthFixtureFile {
        guard let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures") else {
            throw FlintError(.notFound, "Fixture \(name).json is missing. Run apps/ios/scripts/sync-fixtures.sh.")
        }
        return try JSONDecoder().decode(AuthFixtureFile.self, from: Data(contentsOf: url))
    }
}

extension JSONValue {
    subscript(key: String) -> JSONValue? {
        if case .object(let object) = self { return object[key] }
        return nil
    }
    var stringValue: String? { if case .string(let s) = self { return s }; return nil }
    var intValue: Int? { if case .number(let n) = self { return Int(n) }; return nil }
    var boolValue: Bool? { if case .bool(let b) = self { return b }; return nil }
    var arrayValue: [JSONValue]? { if case .array(let a) = self { return a }; return nil }
}

/// Records every request and answers from a script keyed by URL host+path.
actor ScriptedHTTP {
    struct Request: Sendable { let url: URL; let form: [String: String] }
    private(set) var requests: [Request] = []
    private var responses: [String: [Result<HTTPResponse, FlintError>]] = [:]

    func enqueue(_ url: String, status: Int, json: String) {
        responses[url, default: []].append(.success(HTTPResponse(status: status, body: Data(json.utf8))))
    }

    func enqueueFailure(_ url: String) {
        responses[url, default: []].append(.failure(FlintError(.network, "down")))
    }

    func answer(_ url: URL, form: [String: String]) throws -> HTTPResponse {
        requests.append(Request(url: url, form: form))
        let key = url.absoluteString
        guard var queue = responses[key], !queue.isEmpty else { throw FlintError(.network, "unscripted \(key)") }
        let next = queue.removeFirst()
        responses[key] = queue
        return try next.get()
    }

    nonisolated var client: HTTPClient {
        HTTPClient(
            get: { url in try await self.answer(url, form: [:]) },
            postForm: { url, form in try await self.answer(url, form: form) })
    }
}

/// Minimal accounts repository for service tests.
actor MemoryAccounts: AccountsRepository {
    private(set) var rows: [Account] = []
    private(set) var deleted: [AccountID] = []
    private var counter = 0

    func accountHasMessages(_ id: AccountID) async throws -> Bool { false }

    func createAccount(_ input: NewAccount) async throws -> Account {
        counter += 1
        let account = Account(
            id: input.id ?? "gen\(counter)", email: input.email, name: input.name, provider: input.provider, authKind: input.authKind,
            server: input.server, color: input.color, sortOrder: input.sortOrder ?? rows.count, enabled: input.enabled ?? true,
            aliases: input.aliases ?? [], createdAt: input.createdAt ?? 0, showInUnified: input.showInUnified ?? true)
        rows.append(account)
        return account
    }

    func account(id: AccountID) async throws -> Account? { rows.first { $0.id == id } }
    func account(email: String) async throws -> Account? { rows.first { $0.email == email } }
    func listAccounts() async throws -> [Account] { rows }

    func updateAccount(_ id: AccountID, _ patch: AccountPatch) async throws -> Account {
        guard let index = rows.firstIndex(where: { $0.id == id }) else { throw FlintError(.notFound, "No such account.") }
        var row = rows[index]
        if let name = patch.name { row.name = name }
        if let server = patch.server { row.server = server }
        if let provider = patch.provider { row.provider = provider }
        if let authKind = patch.authKind { row.authKind = authKind }
        if let color = patch.color { row.color = color }
        if let enabled = patch.enabled { row.enabled = enabled }
        if let aliases = patch.aliases { row.aliases = aliases }
        if let showInUnified = patch.showInUnified { row.showInUnified = showInUnified }
        if let sortOrder = patch.sortOrder { row.sortOrder = sortOrder }
        rows[index] = row
        return row
    }

    func deleteAccount(_ id: AccountID) async throws {
        rows.removeAll { $0.id == id }
        deleted.append(id)
    }

    func ownAddresses() async throws -> Set<String> { Set(rows.map(\.email)) }

    /// Test hook: seeds an account that already exists.
    func seed(_ account: Account) { rows.append(account) }
}

actor RecordingLifecycle: AccountLifecycle {
    private(set) var events: [String] = []
    func restartSync(_ id: AccountID) async { events.append("restart:\(id)") }
    func forgetSync(_ id: AccountID) async { events.append("forget:\(id)") }
    func accountChanged(_ id: AccountID) async { events.append("changed:\(id)") }
}

actor RecordingAuthSink: AuthFailureSink {
    private(set) var failures: [(AccountID, String)] = []
    func authFailed(accountID: AccountID, message: String) async { failures.append((accountID, message)) }
    var count: Int { failures.count }
}
