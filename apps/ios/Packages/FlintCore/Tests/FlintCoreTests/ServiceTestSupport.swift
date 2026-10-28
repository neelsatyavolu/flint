import FlintMail
import FlintModel
import FlintReceipts
import FlintStore
import Foundation
import Synchronization
import Testing
@testable import FlintService

/// Collects the events a service emits.
final class ServiceEventLog: Sendable {
    private let items = Mutex<[FlintEvent]>([])
    func add(_ event: FlintEvent) { items.withLock { $0.append(event) } }
    var events: [FlintEvent] { items.withLock { $0 } }
    func count(where match: (FlintEvent) -> Bool) -> Int { events.filter(match).count }
    var toasts: [String] { events.compactMap { if case .toast(_, let message, _) = $0 { return message } else { return nil } } }
    var codes: [VerificationCode] { events.compactMap { if case .code(let c) = $0 { return c } else { return nil } } }
    var newMailSubjects: [String] { events.compactMap { if case .newMail(_, _, _, let subject, _, _, _) = $0 { return subject } else { return nil } } }
    var receipts: [ReceiptStatus] { events.compactMap { if case .receipt(_, _, let status, _) = $0 { return status } else { return nil } } }
}

/// Polls until `condition` holds or the timeout passes.
func serviceEventually(timeout: Duration = .seconds(5), _ condition: @Sendable () async -> Bool) async -> Bool {
    let deadline = ContinuousClock.now + timeout
    while ContinuousClock.now < deadline {
        if await condition() { return true }
        try? await Task.sleep(for: .milliseconds(10))
    }
    return await condition()
}

struct ServiceBrowserStub: OAuthBrowser {
    func authenticate(url: URL, callbackScheme: String) async throws -> URL { throw FlintError.googleSignInCancelled }
}

/// A whole service on an in-memory database and a fake mail server.
struct ServiceRig {
    let service: FlintService
    let store: GRDBStore
    let fake: FakeMailTransport
    let log: ServiceEventLog
    let clock: MailTestClock
    let secrets: InMemorySecretStore
    let directory: URL
    let subscription: EventBus.Subscription

    static let folders = [
        RemoteFolder(path: "INBOX", delimiter: "/"), RemoteFolder(path: "Sent", delimiter: "/", attributes: ["sent"]),
        RemoteFolder(path: "Drafts", delimiter: "/", attributes: ["drafts"]), RemoteFolder(path: "Trash", delimiter: "/", attributes: ["trash"]),
        RemoteFolder(path: "Archive", delimiter: "/", attributes: ["archive"]),
    ]

    static func make(
        autoSync: Bool = false, runsScheduler: Bool = false, receiptsTransport: any ReceiptsTransport = FakeReceiptsTransportStub(),
        http: HTTPClient = ServiceHTTPStub.client
    ) async throws -> ServiceRig {
        let clock = MailTestClock()
        let store = try GRDBStore.inMemory(classifier: ClassifierAdapter(), clock: { clock.now })
        let fake = FakeMailTransport(capabilities: TransportCapabilities(), folders: folders)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("flint-service-\(UUID().uuidString)")
        let secrets = InMemorySecretStore()
        var configuration = FlintServiceConfiguration(
            dataDirectory: directory.appendingPathComponent("data"), cacheDirectory: directory.appendingPathComponent("cache"), secrets: secrets,
            browser: ServiceBrowserStub(), transport: { fake }, http: http, autoconfig: ServiceHTTPStub.autoconfig, network: nil,
            receiptsTransport: receiptsTransport, session: SessionConfigurationOverrides(
                pollInterval: .milliseconds(80), idlePollInterval: .milliseconds(300), backoffMinimum: .milliseconds(20), backoffMaximum: .milliseconds(80)),
            clock: { clock.now }, runsScheduler: runsScheduler, autoSync: autoSync)
        configuration.autoSync = autoSync
        let service = FlintService(store: store, configuration: configuration)
        let log = ServiceEventLog()
        let subscription = service.subscribe { log.add($0) }
        return ServiceRig(service: service, store: store, fake: fake, log: log, clock: clock, secrets: secrets, directory: directory, subscription: subscription)
    }

    func cleanup() async {
        await service.stop()
        subscription()
        try? FileManager.default.removeItem(at: directory)
    }

    @discardableResult
    func addAccount() async throws -> Account {
        try await service.addAccount(AddAccountInput(email: "me@test.local", name: "Me", password: "pw", provider: .imap, server: mailTestServer))
    }

    /// Delivers a text mail (body fetched on demand) to INBOX.
    @discardableResult
    func deliver(
        _ subject: String, from: String = "ann@example.com", body: String = "Hello", ageDays: Double = 0, flags: Set<String> = [],
        headers: [String: String] = [:], messageId: String? = nil, inReplyTo: String? = nil, to path: String = "INBOX"
    ) async -> Int {
        var envelope = mailTestEnvelope(subject, from: from, flags: flags, messageId: messageId, ageDays: ageDays, headers: headers)
        envelope.inReplyTo = inReplyTo
        return await fake.deliver(envelope, parts: ["1": Data(body.utf8)], to: path)
    }

    func sentMime() async -> [String] {
        await fake.sentMessages.map { String(decoding: $0.raw, as: UTF8.self) }
    }
}

enum ServiceHTTPStub {
    static let client = HTTPClient(
        get: { _ in HTTPResponse(status: 404, body: Data()) },
        postForm: { _, _ in HTTPResponse(status: 200, body: Data()) })
    static let autoconfig = AutoconfigDeps(
        fetch: { _ in HTTPResponse(status: 404, body: Data()) }, resolveMX: { _ in [] }, probe: { _, _ in false })
}

struct FakeReceiptsTransportStub: ReceiptsTransport {
    func send(_ request: URLRequest) async throws -> (Data, Int) { (Data("{}".utf8), 404) }
}

/// The first value of a stream that satisfies `match`, or nil when none arrives in time.
func serviceAwait<T: Sendable>(
    _ stream: AsyncThrowingStream<T, Error>, timeout: Duration = .seconds(5), until match: @escaping @Sendable (T) -> Bool
) async -> T? {
    await withTaskGroup(of: T?.self) { group in
        group.addTask {
            do { for try await value in stream where match(value) { return value } } catch {}
            return nil
        }
        group.addTask {
            try? await Task.sleep(for: timeout)
            return nil
        }
        let first = await group.next() ?? nil
        group.cancelAll()
        return first
    }
}

final class ServicePostLog: Sendable {
    private let urls = Mutex<[URL]>([])
    func add(_ url: URL) { urls.withLock { $0.append(url) } }
    var all: [URL] { urls.withLock { $0 } }
}
