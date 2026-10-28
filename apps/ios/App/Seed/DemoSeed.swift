import FlintMail
import FlintModel
import FlintReceipts
import FlintService
import FlintStore
import Foundation

/// What a seeded launch produces: a running service on a fresh temporary database whose mail came through the real sync
/// path from in-memory servers. Nothing here touches the network, the Keychain or the user's own data.
struct DemoSeedResult: Sendable {
    let service: FlintService
    let directory: URL
    let accounts: [Account]
    /// Delivers one more message to the Google account's server; a background run calls it before it syncs.
    let deliverNewMail: @Sendable () async -> Void
    /// Delivers one more mail that carries a verification code (tests of the background code path).
    let deliverCodeMail: @Sendable () async -> Void
}

enum DemoSeed {
    /// The launch argument that selects the seed: `-FlintSeed demo`.
    static let argumentKey = "FlintSeed"
    static let demoValue = "demo"

    /// `-FlintSeed demo`, or `-FlintSeed perf50k` (the 50,000-message measurement mailbox, see `PerfSeed`).
    static func isRequested(defaults: UserDefaults = .standard) -> Bool {
        #if DEBUG || FLINT_PERF
        defaults.string(forKey: argumentKey) == demoValue || PerfSeed.isRequested(defaults: defaults)
        #else
        false
        #endif
    }

    /// Builds the whole demo mailbox. Throws if the temporary database cannot be created or the first sync fails.
    static func make(now: Date = Date(), directory: URL? = nil) async throws -> DemoSeedResult {
        if PerfSeed.isRequested() { return try await PerfSeed.make(now: now) }
        let root = directory ?? FileManager.default.temporaryDirectory.appendingPathComponent("flint-demo-\(UUID().uuidString)", isDirectory: true)
        let dataDirectory = root.appendingPathComponent("data", isDirectory: true)
        let cacheDirectory = root.appendingPathComponent("cache", isDirectory: true)
        let clock: @Sendable () -> EpochMs = { Int((Date().timeIntervalSince1970 * 1000).rounded()) }
        let store = try GRDBStore.open(path: dataDirectory.appendingPathComponent("flint.sqlite").path, classifier: ClassifierAdapter(), clock: clock)
        let secrets = InMemorySecretStore()

        var servers: [String: FakeMailTransport] = [:]
        var created: [Account] = []
        for (index, spec) in DemoAccount.all.enumerated() {
            let account = try await store.createAccount(NewAccount(
                id: spec.id, email: spec.address.address, name: spec.address.name, provider: spec.provider, authKind: spec.authKind,
                server: spec.server, sortOrder: index, createdAt: Int(now.timeIntervalSince1970 * 1000) - 90 * 86_400_000))
            try await secrets.writeAccountSecret(account.id, secret(for: spec, now: now))
            created.append(account)
            servers[spec.server.imapHost] = FakeMailTransport(capabilities: spec.capabilities, folders: spec.folders)
        }
        let google = try require(servers[DemoAccount.google.server.imapHost])
        let work = try require(servers[DemoAccount.work.server.imapHost])
        let personal = try require(servers[DemoAccount.personal.server.imapHost])
        await DemoDelivery.deliver(DemoMailboxGoogle.messages(now: now), to: .google, server: google, now: now)
        await DemoDelivery.deliver(DemoMailboxWork.messages(now: now), to: .work, server: work, now: now)
        await DemoDelivery.deliver(DemoMailboxPersonal.messages(now: now), to: .personal, server: personal, now: now)

        try await DemoSeedReceipts.register(in: store, now: now)
        let service = FlintService(store: store, configuration: configuration(
            data: dataDirectory, cache: cacheDirectory, secrets: secrets, servers: servers, clock: clock))
        await service.start()
        try await service.syncNow()
        await DemoDelivery.deliver(DemoMailboxGoogle.lateMessages(), to: .google, server: google, now: now, batch: 1)
        try await service.syncNow(accountId: DemoAccount.google.id)
        try await DemoSeedFinish.apply(service: service, store: store, now: now)
        let background = DemoBackgroundMail(server: google)
        return DemoSeedResult(
            service: service, directory: root, accounts: try await service.listAccounts(), deliverNewMail: { await background.deliver() },
            deliverCodeMail: { await background.deliverCode() })
    }

    private static func require<T>(_ value: T?) throws -> T {
        guard let value else { throw FlintError(.internal, "The demo mailbox could not be built.") }
        return value
    }

    private static func secret(for spec: DemoAccount, now: Date) -> AccountSecret {
        switch spec.authKind {
        case .password: .password("demo-password")
        case .oauthGoogle: .oauth(accessToken: "demo-access", refreshToken: "demo-refresh", expiresAt: Int(now.timeIntervalSince1970 * 1000) + 3_600_000)
        }
    }

    private static func configuration(
        data: URL, cache: URL, secrets: any SecretStore, servers: [String: FakeMailTransport], clock: @escaping @Sendable () -> EpochMs
    ) -> FlintServiceConfiguration {
        FlintServiceConfiguration(
            dataDirectory: data, cacheDirectory: cache, secrets: secrets, browser: DemoOAuthBrowser(),
            transport: { SeedRouterTransport(servers: servers) }, http: OfflineHTTP.client, autoconfig: OfflineHTTP.autoconfig, network: nil,
            receiptsTransport: OfflineReceiptsTransport(), clock: clock, runsScheduler: false, autoSync: true)
    }
}

/// The demo never reaches the network: every HTTP seam answers "not found".
enum OfflineHTTP {
    static let client = HTTPClient(
        get: { _ in HTTPResponse(status: 404, body: Data()) },
        postForm: { _, _ in HTTPResponse(status: 404, body: Data()) })
    static let autoconfig = AutoconfigDeps(
        fetch: { _ in HTTPResponse(status: 404, body: Data()) }, resolveMX: { _ in [] }, probe: { _, _ in false })
}

struct OfflineReceiptsTransport: ReceiptsTransport {
    func send(_ request: URLRequest) async throws -> (Data, Int) { (Data("{}".utf8), 404) }
}

/// Sign-in is not part of the demo: the sheet "closes" at once.
struct DemoOAuthBrowser: OAuthBrowser {
    func authenticate(url: URL, callbackScheme: String) async throws -> URL { throw FlintError.googleSignInCancelled }
}
