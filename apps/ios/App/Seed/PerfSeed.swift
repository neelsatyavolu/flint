import FlintMail
import FlintModel
import FlintService
import FlintStore
import Foundation

/// `-FlintSeed perf50k`: a 50,000-message mailbox for launch-time and memory measurements. Every sender, subject and snippet is
/// synthetic. The database is built once into Caches/flint-perf50k (about a minute) and reused by later launches, so a launch
/// measures opening a populated cache and not building one. Nothing syncs and nothing touches the network or the user's data.
enum PerfSeed {
    static let value = "perf50k"
    static let accountId: AccountID = "perf-account"
    static let messageCount = 50_000
    private static let perThread = 4
    private static let batchSize = 1_000
    private static let marker = "built-\(messageCount)"

    static func isRequested(defaults: UserDefaults = .standard) -> Bool {
        defaults.string(forKey: DemoSeed.argumentKey) == value
    }

    static func make(now: Date = Date()) async throws -> DemoSeedResult {
        PerfProbe.mark("seedStart")
        let root = try rootDirectory()
        let dataDirectory = root.appendingPathComponent("data", isDirectory: true)
        let clock: @Sendable () -> EpochMs = { Int((Date().timeIntervalSince1970 * 1000).rounded()) }
        let databasePath = dataDirectory.appendingPathComponent("flint.sqlite").path
        let built = FileManager.default.fileExists(atPath: root.appendingPathComponent(marker).path)
        if !built { try? FileManager.default.removeItem(at: dataDirectory) }
        let store = try GRDBStore.open(path: databasePath, classifier: ClassifierAdapter(), clock: clock)
        PerfProbe.mark("storeOpen")
        let secrets = InMemorySecretStore()
        let account: Account
        if built {
            guard let existing = try await store.listAccounts().first else { throw FlintError(.internal, "The perf mailbox has no account.") }
            account = existing
        } else {
            account = try await build(store: store, now: now)
            FileManager.default.createFile(atPath: root.appendingPathComponent(marker).path, contents: Data())
        }
        try await secrets.writeAccountSecret(account.id, .password("perf-password"))
        let service = FlintService(store: store, configuration: FlintServiceConfiguration(
            dataDirectory: dataDirectory, cacheDirectory: root.appendingPathComponent("cache", isDirectory: true), secrets: secrets,
            browser: DemoOAuthBrowser(), transport: { SeedRouterTransport(servers: [:]) }, http: OfflineHTTP.client, autoconfig: OfflineHTTP.autoconfig,
            network: nil, receiptsTransport: OfflineReceiptsTransport(), clock: clock, runsScheduler: false, autoSync: false))
        await service.start()
        PerfProbe.mark("serviceStarted")
        // `directory` is deleted when the app shuts down, so it must not be the persistent database.
        let scratch = FileManager.default.temporaryDirectory.appendingPathComponent("flint-perf-\(UUID().uuidString)", isDirectory: true)
        return DemoSeedResult(service: service, directory: scratch, accounts: try await service.listAccounts(), deliverNewMail: {}, deliverCodeMail: {})
    }

    private static func rootDirectory() throws -> URL {
        let caches = try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let root = caches.appendingPathComponent("flint-perf50k", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    private static func build(store: GRDBStore, now: Date) async throws -> Account {
        let nowMs = Int(now.timeIntervalSince1970 * 1000)
        let server = ServerConfig(
            imapHost: "imap.perf.example", imapPort: 993, imapSecure: true, smtpHost: "smtp.perf.example", smtpPort: 465, smtpSecure: true,
            username: "perf@perf.example")
        let account = try await store.createAccount(NewAccount(
            id: accountId, email: "perf@perf.example", name: "Perf", provider: .imap, authKind: .password, server: server, sortOrder: 0,
            createdAt: nowMs - 365 * 86_400_000))
        let inbox = try await store.upsertFolder(account.id, FolderInput(path: "INBOX", role: .inbox))
        for (path, role) in [("Sent", MailboxRole.sent), ("Drafts", .drafts), ("Archive", .archive), ("Trash", .trash), ("Junk", .spam)] {
            _ = try await store.upsertFolder(account.id, FolderInput(path: path, role: role))
        }
        let threads = messageCount / perThread
        let me = Address(name: "Perf", address: "perf@perf.example")
        for start in stride(from: 0, to: messageCount, by: batchSize) {
            let batch = (start..<min(start + batchSize, messageCount)).map { message($0, threads: threads, me: me, nowMs: nowMs) }
            _ = try await store.ingestMessages(account.id, inbox.id, batch, context: IngestContext(evaluate: false))
        }
        return account
    }

    /// Message `index` (also its UID, from 1) of a thread of four. Newest threads have the highest numbers.
    private static func message(_ index: Int, threads: Int, me: Address, nowMs: Int) -> IngestMessage {
        let thread = index / perThread, step = index % perThread
        let root = "root\(thread)@perf.example"
        let sender = thread % 300
        let uid = index + 1
        let newestFirstAge = (threads - thread) * 60_000
        return IngestMessage(
            uid: uid, messageId: step == 0 ? root : "m\(uid)@perf.example", inReplyTo: step == 0 ? nil : root, references: step == 0 ? [] : [root],
            subject: "Perf thread \(thread)", from: [Address(name: "Sender \(sender)", address: "s\(sender)@perf.example")], to: [me],
            date: nowMs - newestFirstAge + step * 1_000, flags: MessageFlags(seen: uid % 3 == 0), size: 2_000, hasAttachments: thread % 17 == 0,
            headers: thread % 10 == 0 ? ["list-id": "<news\(sender).perf.example>"] : [:],
            snippet: "Synthetic message \(uid) for the launch and memory measurement.",
            textBody: thread >= threads - 500 ? "Synthetic body \(uid). Nothing here is real mail." : nil)
    }
}
