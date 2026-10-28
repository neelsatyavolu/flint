import FlintModel
import FlintReceipts
import FlintStore
import Foundation

/// Minimal in-memory slice of the store for the receipts client: tracked rows, recipients, events and the key-value
/// table. Status derivation uses the same ReceiptStatusRules the real store calls.
actor FakeReceiptsStore: ReceiptsRepository, KeyValueRepository {
    struct Recipient {
        var email: String
        var name: String
        var token: String
        var status: ReceiptStatus
        var repliedAt: EpochMs?
        var note: String?
        var openCount = 0
        var firstOpenAt: EpochMs?
        var lastOpenAt: EpochMs?
    }

    struct Row {
        var id: Int
        var input: NewTracked
        var state: NewTracked.State
        var recipients: [Recipient]
    }

    struct StoredEvent { var remoteId: String; var token: String; var at: Int; var kind: ReceiptEventKind; var client: String?; var fingerprint: String? }

    private(set) var rows: [Int: Row] = [:]
    private var events: [StoredEvent] = []
    private var kv: [String: String] = [:]
    private var nextId = 1

    // MARK: - Test inspection

    func state(of id: Int) -> NewTracked.State? { rows[id]?.state }
    func recipientStatus(trackedId: Int, email: String) -> ReceiptStatus? { rows[trackedId]?.recipients.first { $0.email == email }?.status }
    func recipient(trackedId: Int, email: String) -> Recipient? { rows[trackedId]?.recipients.first { $0.email == email } }
    func allRows() -> [Row] { rows.values.sorted { $0.id < $1.id } }
    func rawKV(_ key: String) -> String? { kv[key] }

    // MARK: - ReceiptsRepository

    func createTracked(_ input: NewTracked) async throws -> Int {
        let id = nextId
        nextId += 1
        let registered = input.state == .active
        let recipients = input.recipients.map { r -> Recipient in
            let status = ReceiptStatusRules.recipientStatus(.init(openCount: 0, repliedAt: nil, sawPrefetch: false, registered: registered))
            return Recipient(email: r.email, name: r.name, token: r.token, status: status, note: ReceiptStatusRules.recipientNote(status, registered: registered, untrackedReason: input.untrackedReason))
        }
        rows[id] = Row(id: id, input: input, state: input.state, recipients: recipients)
        return id
    }

    func linkSentMessage(accountId: AccountID, ref: String?, messageId: String, threadId: ThreadID) async throws {}

    func setTrackedState(_ trackedId: Int, _ state: NewTracked.State) async throws {
        rows[trackedId]?.state = state
        guard var row = rows[trackedId] else { return }
        row.recipients = row.recipients.indices.map { recompute(row, $0) }
        rows[trackedId] = row
    }

    func findTracked(ref: String) async throws -> Int? { rows.values.first { $0.input.ref == ref }?.id }
    func findTracked(accountId: AccountID, messageId: String) async throws -> Int? {
        rows.values.first { $0.input.accountId == accountId && $0.input.messageId == messageId }?.id
    }

    func listPollable(sinceMs: EpochMs) async throws -> [PollableTracked] {
        rows.values.filter { $0.state == .active && $0.input.sentAt >= sinceMs }.sorted { $0.id < $1.id }
            .map { PollableTracked(trackedId: $0.id, ref: $0.input.ref, sentAt: $0.input.sentAt) }
    }

    func tracked(id: Int) async throws -> TrackedMessage? { rows[id].map(model) }
    func listTracked(limit: Int?, unopenedOnly: Bool?) async throws -> [TrackedMessage] { rows.values.sorted { $0.id < $1.id }.map(model) }
    func receiptDetail(trackedId: Int) async throws -> ReceiptDetail { throw FlintError(.notFound, "not modeled") }
    func receiptDetail(accountId: AccountID, messageId: String) async throws -> ReceiptDetail? { nil }

    func ingestReceiptEvents(_ incoming: [ReceiptEventInput], now: EpochMs) async throws -> [ReceiptChange] {
        var touched: [(Int, Int)] = []
        for e in incoming where !events.contains(where: { $0.remoteId == e.remoteId }) {
            events.append(StoredEvent(remoteId: e.remoteId, token: e.token, at: e.at, kind: e.kind, client: e.client, fingerprint: e.fingerprint))
            for (id, row) in rows {
                if let index = row.recipients.firstIndex(where: { $0.token == e.token }), !touched.contains(where: { $0 == (id, index) }) { touched.append((id, index)) }
            }
        }
        var changes: [ReceiptChange] = []
        for (id, index) in touched {
            guard var row = rows[id] else { continue }
            let before = row.recipients[index]
            row.recipients[index] = recompute(row, index)
            rows[id] = row
            let after = row.recipients[index]
            if after.status != before.status || after.openCount != before.openCount {
                changes.append(ReceiptChange(trackedId: id, email: after.email, status: after.status.rawValue, at: after.lastOpenAt ?? now))
            }
        }
        return changes
    }

    func recomputeReceipts(threadId: ThreadID, now: EpochMs) async throws -> [ReceiptChange] { [] }

    // MARK: - KeyValueRepository

    func kvGet(_ key: String, now: EpochMs) async throws -> String? { kv[key] }
    func kvSet(_ key: String, _ value: String, ttlMs: Int?, now: EpochMs) async throws { kv[key] = value }
    func kvDelete(_ key: String) async throws { kv[key] = nil }
    func kvPurgeExpired(now: EpochMs) async throws -> Int { 0 }

    // MARK: - Derivation

    private func recompute(_ row: Row, _ index: Int) -> Recipient {
        var r = row.recipients[index]
        let mine = events.filter { $0.token == r.token }
        let counted = mine.filter { $0.kind == .open }.sorted { $0.at < $1.at }
        let registered = row.state == .active
        r.status = ReceiptStatusRules.recipientStatus(.init(openCount: counted.count, repliedAt: r.repliedAt, sawPrefetch: mine.contains { $0.kind == .prefetch }, registered: registered))
        r.openCount = counted.count
        r.firstOpenAt = counted.first?.at
        r.lastOpenAt = counted.last?.at
        r.note = ReceiptStatusRules.recipientNote(r.status, registered: registered, untrackedReason: row.input.untrackedReason)
        return r
    }

    private func model(_ row: Row) -> TrackedMessage {
        let recipients = row.recipients.map {
            ReceiptRecipient(email: $0.email, name: $0.name, status: $0.status, firstOpenAt: $0.firstOpenAt, lastOpenAt: $0.lastOpenAt, openCount: $0.openCount, repliedAt: $0.repliedAt, note: $0.note)
        }
        let summary = ReceiptStatusRules.summarize(recipients.map { .init(status: $0.status, lastOpenAt: $0.lastOpenAt) })
        return TrackedMessage(trackedId: row.id, accountId: row.input.accountId, threadId: row.input.threadId, subject: row.input.subject, sentAt: row.input.sentAt, summary: summary, recipients: recipients)
    }
}
