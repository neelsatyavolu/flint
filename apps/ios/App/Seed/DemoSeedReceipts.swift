import FlintModel
import FlintStore
import Foundation

/// Read-receipt rows for the two tracked sends in the demo mailbox. They are created before the first sync so the sync links
/// each one to its sent message.
enum DemoSeedReceipts {
    static let tomasToken = "demo-token-tomas"
    static let samToken = "demo-token-sam"
    static let priyaToken = "demo-token-priya"

    static func register(in store: GRDBStore, now: Date) async throws {
        let sentAt = Int(now.timeIntervalSince1970 * 1000) - 2 * 86_400_000
        _ = try await store.createTracked(NewTracked(
            accountId: DemoAccount.google.id, ref: DemoMailboxGoogle.trackedRef, messageId: "g-flat@seed.example", subject: "Flat viewing on Saturday",
            sentAt: sentAt, recipients: [
                .init(email: DemoPeople.tomas.address, name: DemoPeople.tomas.name, token: tomasToken),
                .init(email: DemoPeople.sam.address, name: DemoPeople.sam.name, token: samToken),
            ]))
        _ = try await store.createTracked(NewTracked(
            accountId: DemoAccount.work.id, ref: DemoMailboxWork.trackedRef, messageId: "w-proposal@seed.example", subject: "Draft proposal for review",
            sentAt: Int(now.timeIntervalSince1970 * 1000) - 86_400_000 - 300 * 60_000,
            recipients: [.init(email: DemoPeople.priya.address, name: DemoPeople.priya.name, token: priyaToken)]))
    }

    /// Tomas opened the flat mail; Sam replied (the reply is in the mailbox).
    static func recordActivity(in store: GRDBStore, now: Date) async throws {
        let opened = Int(now.timeIntervalSince1970 * 1000) - 2 * 86_400_000 + 20 * 60_000
        _ = try await store.ingestReceiptEvents(
            [ReceiptEventInput(remoteId: "demo-open-1", token: tomasToken, at: opened, kind: .open, client: "Apple Mail", device: "iPhone", location: "Gothenburg, SE")],
            now: Int(now.timeIntervalSince1970 * 1000))
        for tracked in try await store.listTracked(limit: nil, unopenedOnly: nil) {
            guard let threadId = tracked.threadId else { continue }
            _ = try await store.recomputeReceipts(threadId: threadId, now: Int(now.timeIntervalSince1970 * 1000))
        }
    }
}
