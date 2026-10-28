@testable import Flint
import FlintMail
import FlintModel
import FlintReceipts
import FlintService
import FlintStore
import Foundation
import Testing

/// The Read statuses model over the real service, store and receipts client, talking to `FakeReceiptsServer` (the Swift twin of
/// `receipts/fakeService.ts`). No network, no Keychain, no mailbox sync.
@MainActor
@Suite("Read statuses over a fake receipts service")
struct ReceiptsServiceTests {
    private struct Harness {
        let service: FlintService
        let store: GRDBStore
        let server: FakeReceiptsServer
        let directory: URL
        let source: ServiceReceiptsSource
    }

    private static let endpoint = "https://receipts.test"

    private func harness() async throws -> Harness {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("flint-receipts-\(UUID().uuidString)", isDirectory: true)
        let clock: @Sendable () -> EpochMs = { Int((Date().timeIntervalSince1970 * 1000).rounded()) }
        let store = try GRDBStore.open(path: directory.appendingPathComponent("flint.sqlite").path, classifier: ClassifierAdapter(), clock: clock)
        let spec = DemoAccount.work
        _ = try await store.createAccount(NewAccount(
            id: spec.id, email: spec.address.address, name: spec.address.name, provider: spec.provider, authKind: spec.authKind,
            server: spec.server, sortOrder: 0, createdAt: clock()))
        let server = FakeReceiptsServer()
        server.servesAllEvents = true
        let service = FlintService(store: store, configuration: FlintServiceConfiguration(
            dataDirectory: directory, cacheDirectory: directory, secrets: InMemorySecretStore(), browser: DemoOAuthBrowser(),
            transport: { SeedRouterTransport(servers: [:]) }, http: OfflineHTTP.client, autoconfig: OfflineHTTP.autoconfig, network: nil,
            receiptsTransport: server, clock: clock, runsScheduler: false, autoSync: false))
        _ = try await service.updateSettings(patch: .object(["receipts": .object(["endpoint": .string(Self.endpoint)])]))
        return Harness(service: service, store: store, server: server, directory: directory, source: ServiceReceiptsSource(service: service))
    }

    private func track(_ h: Harness, subject: String, people: [(email: String, token: String)]) async throws -> Int {
        try await h.store.createTracked(NewTracked(
            accountId: DemoAccount.work.id, ref: ReceiptPixel.newToken(), messageId: "\(UUID().uuidString)@test", subject: subject,
            sentAt: Int(Date().timeIntervalSince1970 * 1000) - 60_000,
            recipients: people.map { .init(email: $0.email, name: "", token: $0.token) }))
    }

    @Test("an open from the service turns a sent recipient into opened, with the mail app and place")
    func opened() async throws {
        let h = try await harness()
        let token = ReceiptPixel.newToken()
        let id = try await track(h, subject: "Hello", people: [("tomas@x.example", token)])
        let vm = ReadStatusesModel(source: h.source, poller: ReceiptsPoller(minInterval: 0))
        await vm.load()
        #expect(vm.items.first?.recipients.first?.status == .sent)

        h.server.addEvent(token: token, kind: "open", client: "Gmail")
        await vm.refresh()
        let tracked = try #require(vm.items.first { $0.trackedId == id })
        #expect(tracked.recipients.first?.status == .opened)
        #expect(tracked.summary.opened == 1)
        let detail = try await h.source.receipt(trackedId: id)
        let line = ReceiptStatusText.statusLine(try #require(detail.recipients.first), detail: detail)
        #expect(line.hasPrefix("Opened") && line.contains("Gmail") && line.contains("Austin, US"))
        #expect(h.server.calls.contains { $0.path.hasPrefix("/v1/events") })
    }

    @Test("a prefetch alone is unknowable, and a later real open wins")
    func prefetchThenOpen() async throws {
        let h = try await harness()
        let token = ReceiptPixel.newToken()
        _ = try await track(h, subject: "Prefetch", people: [("p@icloud.example", token)])
        let vm = ReadStatusesModel(source: h.source, poller: ReceiptsPoller(minInterval: 0))
        h.server.addEvent(token: token, kind: "prefetch", client: "Apple Mail")
        await vm.refresh()
        #expect(vm.items.first?.recipients.first?.status == .unknowable)
        #expect(ReceiptStatusText.marker(try #require(vm.items.first).summary).tone == .warn)
        h.server.addEvent(token: token, kind: "open", client: "Apple Mail")
        await vm.refresh()
        #expect(vm.items.first?.recipients.first?.status == .opened)
    }

    @Test("a send recorded without tracking lists its recipients as untracked with the honest line")
    func untracked() async throws {
        let h = try await harness()
        _ = try await h.store.createTracked(NewTracked(
            accountId: DemoAccount.work.id, ref: ReceiptPixel.newToken(), messageId: "u@test", subject: "Plain", sentAt: 1_000, state: .unregistered,
            untrackedReason: "Receipts off: plain-text mode", recipients: [.init(email: "ann@x.example", name: "Ann", token: ReceiptPixel.newToken())]))
        let vm = ReadStatusesModel(source: h.source, poller: ReceiptsPoller(minInterval: 0))
        await vm.load()
        let recipient = try #require(vm.items.first?.recipients.first)
        #expect(recipient.status == .untracked)
        #expect(ReceiptStatusText.statusLine(recipient) == "Receipts unavailable for this message")
        #expect(vm.items.first?.summary.status == .untracked)
    }

    @Test("stop tracking leaves the mail but ends polling for it")
    func stopTracking() async throws {
        let h = try await harness()
        let id = try await track(h, subject: "Stop me", people: [("a@x.example", ReceiptPixel.newToken())])
        let vm = ReadStatusesModel(source: h.source, poller: ReceiptsPoller(minInterval: 0))
        await vm.load()
        #expect(await vm.stopTracking(id))
        #expect(vm.items.isEmpty)
    }

    @Test("when the service is down the list stays and a notice explains")
    func offline() async throws {
        let h = try await harness()
        _ = try await track(h, subject: "Offline", people: [("a@x.example", ReceiptPixel.newToken())])
        let vm = ReadStatusesModel(source: h.source, poller: ReceiptsPoller(minInterval: 0))
        await vm.load()
        h.server.offline = true
        await vm.refresh()
        #expect(vm.items.count == 1)
        #expect(vm.notice == "Couldn't reach the receipts service. Try again.")
        h.server.offline = false
        await vm.refresh()
        #expect(vm.notice == nil)
    }

    @Test("an open arriving while the screen watches reloads it through the service event")
    func watchesEvents() async throws {
        let h = try await harness()
        let token = ReceiptPixel.newToken()
        _ = try await track(h, subject: "Watch", people: [("a@x.example", token)])
        let vm = ReadStatusesModel(source: h.source, poller: ReceiptsPoller(minInterval: 0))
        await vm.load()
        let watcher = Task { await vm.watch() }
        try await Task.sleep(for: .milliseconds(100))
        h.server.addEvent(token: token, kind: "open")
        try await h.service.refreshReceipts()
        for _ in 0..<60 where vm.items.first?.recipients.first?.status != .opened { try await Task.sleep(for: .milliseconds(50)) }
        watcher.cancel()
        #expect(vm.items.first?.recipients.first?.status == .opened)
    }

    @Test("polling is refused with a clear message while no service address is set")
    func unconfigured() async throws {
        let h = try await harness()
        _ = try await h.service.updateSettings(patch: .object(["receipts": .object(["endpoint": .string("")])]))
        let vm = ReadStatusesModel(source: h.source, poller: ReceiptsPoller(minInterval: 0))
        await vm.refresh()
        #expect(vm.notice == "Read receipts need a service address. Add one in Settings.")
        #expect(h.server.calls.isEmpty)
    }
}
