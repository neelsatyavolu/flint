import FlintModel
import FlintReceipts
import FlintStore
import Foundation
import Testing

private let endpoint = "https://r.example"
private let carla = Address(name: "Carla", address: "carla@example.org")
private let dan = Address(name: "Dan", address: "dan@example.org")
private let me = Address(name: "Me", address: "me@example.com")

private final class EventLog: @unchecked Sendable {
    private let lock = NSLock()
    private var items: [FlintEvent] = []
    func add(_ e: FlintEvent) { lock.lock(); items.append(e); lock.unlock() }
    var all: [FlintEvent] { lock.lock(); defer { lock.unlock() }; return items }
}

private struct Harness {
    let store = FakeReceiptsStore()
    let service = FakeReceiptsService()
    let secrets = InMemorySecretStore()
    let log = EventLog()
    let client: ReceiptsClient

    init(enabled: Bool = true, endpoint: String = endpoint, notifyOnOpen: Bool = true) {
        var settings = Settings.Receipts()
        settings.enabled = enabled
        settings.endpoint = endpoint
        settings.notifyOnOpen = notifyOnOpen
        let captured = settings
        let store = self.store, service = self.service, secrets = self.secrets, log = self.log
        client = ReceiptsClient(store: store, secrets: secrets, receiptsSettings: { captured }, transport: service, now: { 5_000_000 }, emit: { log.add($0) })
    }

    func input(_ recipients: [Address] = [carla, dan], selfAddresses: [String] = ["me@example.com"]) -> PrepareTrackedInput {
        PrepareTrackedInput(accountId: "a1", subject: "Plan", messageId: "<out1@example.com>", recipients: recipients, selfAddresses: selfAddresses)
    }

    func trackedId() async -> Int? { try? await store.findTracked(accountId: "a1", messageId: "out1@example.com") }
}

@Suite("ReceiptsClient install")
struct ReceiptsInstallTests {
    @Test func installsOnceAndStoresCredentials() async throws {
        let h = Harness()
        let a = try await h.client.ensureInstall()
        let b = try await h.client.ensureInstall()
        #expect(a == b)
        #expect(h.service.calls.filter { $0.path == "/v1/install" }.count == 1)
        let raw = try await h.secrets.get(ReceiptsClient.credentialsKey)
        let stored = try #require(raw)
        let decoded = try JSONDecoder().decode(ReceiptsCredentials.self, from: Data(stored.utf8))
        #expect(decoded.installId == a.installId && decoded.endpoint == endpoint)
    }

    @Test func concurrentCallersShareOneRequest() async throws {
        let h = Harness()
        async let one = h.client.ensureInstall()
        async let two = h.client.ensureInstall()
        _ = try await (one, two)
        #expect(h.service.installs.count == 1)
    }

    @Test func installsAgainWhenEndpointChangedOrDataCorrupt() async throws {
        let h = Harness()
        try await h.secrets.set(ReceiptsClient.credentialsKey, value: "{not json")
        _ = try await h.client.ensureInstall()
        try await h.secrets.set(ReceiptsClient.credentialsKey, value: #"{"installId":"x","secret":"y","endpoint":"https://other.example"}"#)
        let creds = try await h.client.ensureInstall()
        #expect(creds.installId != "x")
    }

    @Test func rejectsWithoutAnEndpoint() async throws {
        let h = Harness(endpoint: "")
        await #expect(throws: FlintError.self) { try await h.client.ensureInstall() }
        #expect(await h.client.isConfigured() == false)
    }
}

@Suite("ReceiptsClient prepareTracked")
struct ReceiptsPrepareTests {
    @Test func registersPerRecipientTokensAndBuildsPixelURLs() async throws {
        let h = Harness()
        let out = try await h.client.prepareTracked(h.input())
        #expect(out.untracked.isEmpty)
        #expect(out.perRecipient.map(\.address.address) == ["carla@example.org", "dan@example.org"])
        #expect(Set(out.perRecipient.map(\.token)).count == 2)
        #expect(out.perRecipient[0].pixelURL == "\(endpoint)/i/\(out.perRecipient[0].token).gif")
        #expect(h.service.tokens(for: out.ref) == out.perRecipient.map(\.token))
        let id = try #require(await h.trackedId())
        #expect(await h.store.state(of: id) == .active)
    }

    @Test func leavesOwnAddressesAndDuplicatesOut() async throws {
        let h = Harness()
        let out = try await h.client.prepareTracked(h.input([carla, Address(address: "CARLA@example.org"), me]))
        #expect(out.perRecipient.count == 1)
        #expect(out.untracked.map(\.address) == ["me@example.com"])
    }

    @Test func treatsGmailVariantsOfTheUsersOwnAddressAsOwn() async throws {
        let h = Harness()
        let out = try await h.client.prepareTracked(h.input(
            [carla, Address(address: "first.last+x@googlemail.com"), Address(address: "me+news@example.com")],
            selfAddresses: ["firstlast@gmail.com", "me@example.com"]
        ))
        #expect(out.perRecipient.count == 2)
        #expect(out.untracked.map(\.address) == ["first.last+x@googlemail.com"])
    }

    @Test func offlineServiceMakesEveryoneUntrackedAndRowUnregistered() async throws {
        let h = Harness()
        h.service.offline = true
        let out = try await h.client.prepareTracked(h.input())
        #expect(out.perRecipient.isEmpty && out.untracked.count == 2)
        let id = try #require(await h.trackedId())
        #expect(await h.store.state(of: id) == .unregistered)
        #expect(await h.store.recipientStatus(trackedId: id, email: "carla@example.org") == .untracked)
    }

    @Test func serverErrorFallsBackToUntracked() async throws {
        let h = Harness()
        try await h.client.ensureInstall()
        h.service.forceStatus = 500
        let out = try await h.client.prepareTracked(h.input())
        #expect(out.perRecipient.isEmpty)
    }

    @Test func doesNothingWhenReceiptsAreOff() async throws {
        let h = Harness(enabled: false)
        let out = try await h.client.prepareTracked(h.input())
        #expect(out.perRecipient.isEmpty && out.untracked.count == 2)
        #expect(h.service.calls.isEmpty)
        #expect(await h.trackedId() == nil)
    }

    @Test func noEndpointMarksUnregisteredWithoutCalls() async throws {
        let h = Harness(endpoint: "")
        let out = try await h.client.prepareTracked(h.input())
        #expect(out.perRecipient.isEmpty)
        #expect(h.service.calls.isEmpty)
        #expect(await h.trackedId() != nil)
    }

    @Test func capsTrackedRecipientsAtOneHundred() async throws {
        let h = Harness()
        let many = (0..<103).map { Address(address: "p\($0)@example.org") }
        let out = try await h.client.prepareTracked(h.input(many))
        #expect(out.perRecipient.count == 100 && out.untracked.count == 3)
    }

    @Test func angleBracketsAreStrippedFromTheStoredMessageId() async throws {
        let h = Harness()
        _ = try await h.client.prepareTracked(h.input())
        #expect(await h.trackedId() != nil)
    }
}

@Suite("ReceiptsClient polling")
struct ReceiptsPollTests {
    private func prepared() async throws -> (Harness, PreparedTracking, Int) {
        let h = Harness()
        let p = try await h.client.prepareTracked(h.input())
        let id = try #require(await h.trackedId())
        return (h, p, id)
    }

    @Test func storesOpensUpdatesStatusAndEmits() async throws {
        let (h, p, id) = try await prepared()
        h.service.addEvent(token: p.perRecipient[0].token)
        #expect(try await h.client.pollEvents() == 1)
        #expect(await h.store.recipientStatus(trackedId: id, email: "carla@example.org") == .opened)
        #expect(await h.store.recipientStatus(trackedId: id, email: "dan@example.org") == .sent)
        #expect(h.log.all == [.receipt(trackedId: id, email: "carla@example.org", status: .opened, at: 1_000_001)])
    }

    @Test func emitsOnlyOnStatusChange() async throws {
        let (h, p, _) = try await prepared()
        let token = p.perRecipient[0].token
        h.service.addEvent(token: token)
        _ = try await h.client.pollEvents()
        h.service.addEvent(token: token)
        #expect(try await h.client.pollEvents() == 1)
        #expect(h.log.all.count == 1)
        #expect(try await h.client.pollEvents() == 0)
    }

    @Test func prefetchDoesNotCountAndMarksUnknowable() async throws {
        let (h, p, id) = try await prepared()
        h.service.addEvent(token: p.perRecipient[1].token, kind: "prefetch", client: "Apple Mail")
        #expect(try await h.client.pollEvents() == 0)
        #expect(await h.store.recipientStatus(trackedId: id, email: "dan@example.org") == .unknowable)
    }

    @Test func staysQuietWhenNotifyOnOpenIsOffButRecordsTheOpen() async throws {
        let h = Harness(notifyOnOpen: false)
        let p = try await h.client.prepareTracked(h.input())
        let id = try #require(await h.trackedId())
        h.service.addEvent(token: p.perRecipient[0].token)
        #expect(try await h.client.pollEvents() == 1)
        #expect(h.log.all.isEmpty)
        #expect(await h.store.recipientStatus(trackedId: id, email: "carla@example.org") == .opened)
    }

    @Test func pagesThroughEventsAndPersistsTheCursor() async throws {
        let (h, p, _) = try await prepared()
        h.service.pageLimit = 1
        for i in 0..<3 { h.service.addEvent(token: p.perRecipient[i % 2].token) }
        var total = 0
        for _ in 0..<4 { total += try await h.client.pollEvents() }
        #expect(total == 3)
        let afters = h.service.calls.filter { $0.path.hasPrefix("/v1/events") }.compactMap { call -> String? in
            URLComponents(string: "http://x\(call.path)")?.queryItems?.first { $0.name == "after" }?.value
        }
        #expect(afters.first == "0")
        #expect(afters.last != "0")
    }

    @Test func returnsZeroWhenNotConfigured() async throws {
        let h = Harness(enabled: false)
        #expect(try await h.client.pollEvents() == 0)
        #expect(h.service.calls.isEmpty)
    }

    @Test func installsAgainOnceOn401ThenRetries() async throws {
        let (h, _, _) = try await prepared()
        h.service.clearInstalls()
        #expect(try await h.client.pollEvents() == 0)
        #expect(h.service.installs.count == 1)
    }

    @Test func networkFailureSurfacesAsFlintError() async throws {
        let (h, _, _) = try await prepared()
        h.service.offline = true
        do {
            _ = try await h.client.pollEvents()
            Issue.record("expected a throw")
        } catch let error as FlintError {
            #expect(error.code == .network)
        }
    }

    @Test func cursorBelongsToTheInstall() async throws {
        let (h, p, _) = try await prepared()
        h.service.addEvent(token: p.perRecipient[0].token)
        _ = try await h.client.pollEvents()
        let raw = try #require(await h.store.rawKV("receipts:cursor"))
        #expect(raw.contains("inst1"))
    }

    @Test func notifyEmitsStoreReportedChanges() async throws {
        let h = Harness()
        h.client.notify([ReceiptChange(trackedId: 4, email: "a@b.c", status: "replied", at: 9), ReceiptChange(trackedId: 4, email: "a@b.c", status: "bogus", at: 9)])
        #expect(h.log.all == [.receipt(trackedId: 4, email: "a@b.c", status: .replied, at: 9)])
    }
}

@Suite("ReceiptsClient maintenance")
struct ReceiptsMaintenanceTests {
    @Test func seenPingReportsFailureWithoutThrowing() async throws {
        let h = Harness()
        #expect(await h.client.seenPing())
        #expect(h.service.seenPings == 1)
        h.service.offline = true
        #expect(await h.client.seenPing() == false)
        #expect(await Harness(enabled: false).client.seenPing() == false)
    }

    @Test func stopTrackingDeletesRemotelyAndMarksStopped() async throws {
        let h = Harness()
        let p = try await h.client.prepareTracked(h.input())
        let id = try #require(await h.trackedId())
        try await h.client.stopTracking(id)
        #expect(!h.service.messageRefs.contains(p.ref))
        #expect(await h.store.state(of: id) == .stopped)
        await #expect(throws: FlintError.self) { try await h.client.stopTracking(999) }
    }

    @Test func stopTrackingToleratesA404AndSkipsUnregisteredRows() async throws {
        let h = Harness()
        let p = try await h.client.prepareTracked(h.input())
        let id = try #require(await h.trackedId())
        h.service.forget(ref: p.ref)
        try await h.client.stopTracking(id)
        #expect(await h.store.state(of: id) == .stopped)

        let u = Harness()
        u.service.offline = true
        _ = try await u.client.prepareTracked(u.input())
        let uid = try #require(await u.trackedId())
        let before = u.service.calls.count
        u.service.offline = false
        try await u.client.stopTracking(uid)
        #expect(u.service.calls.count == before)
    }

    @Test func stopTrackingTreatsAnUndoneDeleteAsNotDone() async throws {
        let h = Harness()
        let p = try await h.client.prepareTracked(h.input())
        let id = try #require(await h.trackedId())
        h.service.deleteFails = true
        do {
            try await h.client.stopTracking(id)
            Issue.record("expected a throw")
        } catch let error as FlintError {
            #expect(error.code == .network && error.message.contains("Try again later"))
        }
        #expect(await h.store.state(of: id) == .active)
        #expect(h.service.messageRefs.contains(p.ref))
        h.service.deleteFails = false
        try await h.client.stopTracking(id)
        #expect(await h.store.state(of: id) == .stopped)
    }

    @Test func stopTrackingReportsANetworkFailureAndKeepsTheRowActive() async throws {
        let h = Harness()
        _ = try await h.client.prepareTracked(h.input())
        let id = try #require(await h.trackedId())
        h.service.offline = true
        await #expect(throws: FlintError.self) { try await h.client.stopTracking(id) }
        #expect(await h.store.state(of: id) == .active)
    }
}

@Suite("ReceiptsClient recordUntracked")
struct ReceiptsUntrackedTests {
    @Test func recordsAnUntrackedRowWithTheReasonAsNote() async throws {
        let h = Harness()
        let ref = try await h.client.recordUntracked(h.input([carla, dan, me]), reason: "Receipts off: plain-text mode")
        let trackedRef = try #require(ref)
        let found = try await h.store.findTracked(ref: trackedRef)
        let id = try #require(found)
        let loaded = try await h.store.tracked(id: id)
        let tracked = try #require(loaded)
        #expect(tracked.recipients.map(\.email).sorted() == ["carla@example.org", "dan@example.org"])
        #expect(tracked.recipients.allSatisfy { $0.status == .untracked && $0.note == "Receipts off: plain-text mode" })
        #expect(tracked.summary.status == .untracked)
        #expect(await h.store.state(of: id) == .unregistered)
        #expect(h.service.calls.isEmpty)
    }

    @Test func recordsNothingWhenTheMailOnlyWentToTheUser() async throws {
        let h = Harness()
        let ref = try await h.client.recordUntracked(h.input([me]), reason: "Receipts off in Settings")
        #expect(ref == nil)
        #expect(try await h.store.listTracked(limit: nil, unopenedOnly: nil).isEmpty)
    }
}
