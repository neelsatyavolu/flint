import FlintModel
import Foundation
import Testing
@testable import FlintStore

@Suite("Store tracked messages")
struct StoreReceiptsTests {
    private func setup() async throws -> (store: GRDBStore, s: StoreImapSeed, sent: IngestOutcome, trackedId: Int) {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        let sent = try await store.ingestMessages(s.account.id, s.sent.id, [StoreTestKit.msg(1) {
            $0.messageId = "s@x"; $0.from = [StoreTestKit.me()]; $0.to = [StoreTestKit.person("Carla"), StoreTestKit.person("Dan")]; $0.date = StoreTestKit.t0
            $0.headers = ["x-flint-ref": "ref1"]; $0.flags = StoreTestKit.seen
        }], context: IngestContext())[0]
        let trackedId = try await store.createTracked(NewTracked(
            accountId: s.account.id, ref: "ref1", messageId: "s@x", subject: "Proposal", sentAt: StoreTestKit.t0,
            recipients: [.init(email: "Carla@example.org", name: "Carla", token: "tc"), .init(email: "dan@example.org", name: "Dan", token: "td")]))
        return (store, s, sent, trackedId)
    }

    @Test func linksASyncedSentMessageByRefOrMessageID() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        let trackedId = try await store.createTracked(NewTracked(accountId: s.account.id, ref: "ref9", messageId: "q@x", subject: "S", sentAt: StoreTestKit.t0, recipients: [.init(email: "a@x.com", token: "t9")]))
        #expect(try await store.findTracked(ref: "ref9") == trackedId)
        #expect(try await store.findTracked(accountId: s.account.id, messageId: "q@x") == trackedId)
        let o = try await store.ingestMessages(s.account.id, s.sent.id, [StoreTestKit.msg(1) { $0.messageId = "q@x"; $0.from = [StoreTestKit.me()]; $0.to = [StoreTestKit.person("A", "a@x.com")] }], context: IngestContext())[0]
        #expect(try await store.tracked(id: trackedId)?.threadId == o.threadId)
    }

    @Test func derivesStatusFromEventsOpenedPrefetchOnlyScannersIgnored() async throws {
        let (store, _, _, trackedId) = try await setup()
        let changes = try await store.ingestReceiptEvents([
            ReceiptEventInput(remoteId: "1", token: "tc", at: StoreTestKit.t0 + 1000, kind: .scanner),
            ReceiptEventInput(remoteId: "2", token: "tc", at: StoreTestKit.t0 + 2000, kind: .open, client: "Gmail", device: "web", location: "Oslo, NO", fingerprint: "f1"),
            ReceiptEventInput(remoteId: "3", token: "td", at: StoreTestKit.t0 + 3000, kind: .prefetch, client: "Apple Mail"),
            ReceiptEventInput(remoteId: "x", token: "unknown", at: StoreTestKit.t0, kind: .open),
        ], now: StoreTestKit.t0)
        #expect(changes.map { "\($0.email):\($0.status)" }.sorted() == ["carla@example.org:opened", "dan@example.org:unknowable"])
        let detail = try await store.receiptDetail(trackedId: trackedId)
        let carla = try #require(detail.recipients.first { $0.email == "carla@example.org" })
        let dan = try #require(detail.recipients.first { $0.email == "dan@example.org" })
        #expect(carla.status == .opened && carla.openCount == 1 && carla.firstOpenAt == StoreTestKit.t0 + 2000 && carla.lastOpenAt == StoreTestKit.t0 + 2000 && carla.name == "Carla" && !carla.possiblyForwarded)
        #expect(dan.status == .unknowable && dan.openCount == 0)
        #expect(dan.note?.contains("Apple Mail Privacy Protection") == true)
        #expect(detail.events.map { "\($0.kind.rawValue):\($0.counted)" } == ["prefetch:false", "open:true", "scanner:false"])
        // Duplicates are ignored and report nothing.
        #expect(try await store.ingestReceiptEvents([ReceiptEventInput(remoteId: "2", token: "tc", at: StoreTestKit.t0 + 2000, kind: .open)], now: StoreTestKit.t0) == [])
        // A later real open upgrades the prefetch-only recipient.
        let up = try await store.ingestReceiptEvents([ReceiptEventInput(remoteId: "4", token: "td", at: StoreTestKit.t0 + 5000, kind: .open, client: "Outlook", fingerprint: "f9")], now: StoreTestKit.t0)
        #expect(up == [ReceiptChange(trackedId: trackedId, email: "dan@example.org", status: "opened", at: StoreTestKit.t0 + 5000)])
        #expect(try await store.receiptDetail(trackedId: trackedId).recipients.first { $0.email == "dan@example.org" }?.note == nil)
    }

    @Test func flagsAPossibleForwardInTheRecipientView() async throws {
        let (store, _, _, trackedId) = try await setup()
        _ = try await store.ingestReceiptEvents([
            ReceiptEventInput(remoteId: "1", token: "tc", at: StoreTestKit.t0 + 1000, kind: .open, client: "Gmail", fingerprint: "f1"),
            ReceiptEventInput(remoteId: "2", token: "tc", at: StoreTestKit.t0 + 3 * StoreTestKit.hour, kind: .open, client: "Outlook", fingerprint: "f2"),
        ], now: StoreTestKit.t0)
        let carla = try #require(try await store.tracked(id: trackedId)?.recipients.first { $0.email == "carla@example.org" })
        #expect(carla.status == .opened && carla.openCount == 2 && carla.possiblyForwarded)
    }

    @Test func marksARecipientRepliedWhenTheirMessageArrivesAndReportsItFromIngest() async throws {
        let (store, s, sent, trackedId) = try await setup()
        try await store.linkSentMessage(accountId: s.account.id, ref: "ref1", messageId: "s@x", threadId: sent.threadId)
        let reply = try await store.ingestMessages(s.account.id, s.inbox.id, [StoreTestKit.msg(5) {
            $0.messageId = "re@x"; $0.references = ["s@x"]; $0.from = [StoreTestKit.person("Carla")]; $0.date = StoreTestKit.t0 + StoreTestKit.day
        }], context: IngestContext())[0]
        #expect(reply.receiptChanges == [ReceiptChange(trackedId: trackedId, email: "carla@example.org", status: "replied", at: StoreTestKit.t0 + StoreTestKit.day)])
        let detail = try await store.receiptDetail(trackedId: trackedId)
        let carla = try #require(detail.recipients.first { $0.email == "carla@example.org" })
        #expect(carla.status == .replied && carla.repliedAt == StoreTestKit.t0 + StoreTestKit.day)
        #expect(detail.recipients.first { $0.email == "dan@example.org" }?.status == .sent)
        // A reply from the sender's own address never counts.
        #expect(try await store.recomputeReceipts(threadId: sent.threadId, now: StoreTestKit.t0) == [])
    }

    @Test func listsTrackedMessagesWithFiltersUnregisteredHandlingAndStop() async throws {
        let (store, s, _, trackedId) = try await setup()
        let other = try await store.createTracked(NewTracked(
            accountId: s.account.id, ref: "ref2", messageId: "o@x", subject: "Second", sentAt: StoreTestKit.t0 + StoreTestKit.day, state: .unregistered,
            recipients: [.init(email: "eve@x.com", token: "te")]))
        #expect(try await store.listTracked(limit: nil, unopenedOnly: nil).map(\.trackedId) == [other, trackedId])
        #expect(try await store.tracked(id: other)?.recipients[0].status == .untracked)
        _ = try await store.ingestReceiptEvents([ReceiptEventInput(remoteId: "1", token: "tc", at: StoreTestKit.t0 + 10, kind: .open)], now: StoreTestKit.t0)
        #expect(try await store.listTracked(limit: nil, unopenedOnly: false).map(\.trackedId) == [trackedId])
        #expect(try await store.listTracked(limit: nil, unopenedOnly: true).map(\.trackedId) == [other])
        #expect(try await store.listPollable(sinceMs: StoreTestKit.t0).map(\.trackedId) == [trackedId])
        try await store.setTrackedState(trackedId, .stopped)
        #expect(try await store.listPollable(sinceMs: StoreTestKit.t0) == [])
        #expect(try await store.receiptDetail(accountId: s.account.id, messageId: "o@x")?.trackedId == other)
        #expect(try await store.receiptDetail(accountId: s.account.id, messageId: "none") == nil)
        await expectStoreError(.notFound) { _ = try await store.receiptDetail(trackedId: 9999) }
        #expect(try await store.listTracked(limit: 1, unopenedOnly: nil).count == 1)
    }

    @Test func registeringFailureMarksSentRecipientsUntracked() async throws {
        let (store, _, _, trackedId) = try await setup()
        try await store.setTrackedState(trackedId, .unregistered)
        let t = try #require(try await store.tracked(id: trackedId))
        #expect(t.recipients.allSatisfy { $0.status == .untracked } && t.summary.status == .untracked)
    }

    @Test func stoppingTrackingRecomputesNotesAndKeepsRealOpensAndReplies() async throws {
        let (store, _, _, trackedId) = try await setup()
        _ = try await store.ingestReceiptEvents([ReceiptEventInput(remoteId: "1", token: "tc", at: StoreTestKit.t0 + 10, kind: .open)], now: StoreTestKit.t0)
        try await store.setTrackedState(trackedId, .stopped)
        let t = try #require(try await store.tracked(id: trackedId))
        let carla = try #require(t.recipients.first { $0.email == "carla@example.org" })
        let dan = try #require(t.recipients.first { $0.email == "dan@example.org" })
        #expect(carla.status == .opened && carla.note == nil)
        #expect(dan.status == .untracked && dan.note == ReceiptStatusLogic.unregisteredNote)
    }
}
