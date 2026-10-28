// Follow-up work for an ingested batch: blocked senders go to Trash, rule actions run on the server, and "new mail"
// events are produced. Port of packages/core/src/mail/sync/outcomes.ts.

import FlintModel
import FlintStore
import Foundation

public struct OutcomeRunner: Sendable {
    public var store: any MailEngineStore
    public var accountId: AccountID
    public var actions: ServerActions

    public init(store: any MailEngineStore, accountId: AccountID, actions: ServerActions) {
        self.store = store
        self.accountId = accountId
        self.actions = actions
    }

    /// Applies a local change, runs the server part, and puts the local state back when the server refuses.
    private func perform(
        local: () async throws -> ActionResult, server: (ActionResult) async -> ActionReport
    ) async -> [ThreadID] {
        guard let result = try? await local() else { return [] }
        let report = await server(result)
        if !report.ok { _ = try? await store.restoreSnapshot(result.snapshot) }
        return result.snapshot.threads.map(\.id)
    }

    private func run(_ threadId: ThreadID, _ action: RuleAction) async -> [ThreadID] {
        switch action {
        case .archive:
            return await perform(local: { try await store.moveThreads([threadId], to: .archive) }, server: { await actions.archive($0.locations) })
        case .trash:
            return await perform(local: { try await store.moveThreads([threadId], to: .trash) }, server: { await actions.trash($0.locations) })
        case .move(let folderPath):
            guard let folder = try? await store.folder(accountId: accountId, path: folderPath) else { return [] }
            return await perform(
                local: { try await store.moveThreads([threadId], to: .folder(folder.id)) }, server: { await actions.moveToFolder($0.locations, folder.id) })
        case .markRead:
            return await perform(local: { try await store.markRead([threadId], read: true) }, server: { await actions.setSeen($0.locations, true) })
        case .pin:
            return await perform(local: { try await store.setPinned([threadId], pinned: true) }, server: { await actions.setFlagged($0.locations, true) })
        case .category, .mute, .notify:
            return [] // applied locally at ingest
        }
    }

    /// Returns the threads whose state changed so the caller can announce them.
    public func apply(_ outcomes: [IngestOutcome]) async -> [ThreadID] {
        var touched: [ThreadID] = []
        var done = Set<String>()
        for outcome in outcomes {
            if outcome.blocked {
                if let locs = try? await store.messageLocations([outcome.messageRowId]) { _ = await actions.trash(locs) }
                touched.append(outcome.threadId)
                continue
            }
            for action in outcome.ruleActions {
                let key = "\(outcome.threadId):\(action)"
                guard done.insert(key).inserted else { continue }
                touched += await run(outcome.threadId, action)
            }
        }
        var seen = Set<ThreadID>()
        return touched.filter { seen.insert($0).inserted }
    }
}

public enum NewMail {
    /// Mail older than this when it first shows up is not "new": it was found late (a long gap, a server move).
    public static let maxAgeMs = 3 * 24 * 3600 * 1000

    /// new-mail events: unread inbox mail from someone else, of any category, in a thread that is not muted and that no rule
    /// moved out of the inbox. Never for the initial window or history (those batches are not evaluated), mail you sent,
    /// blocked senders, spam, drafts, or mail older than three days. `category` and `forced` (a rule asked for an alert)
    /// let the notification policy decide which of these alert.
    public static func events(
        store: any ThreadsRepository, accountId: AccountID, batch: SyncBatch, inboxPath: String?, now: EpochMs
    ) async -> [FlintEvent] {
        guard batch.evaluated else { return [] }
        if let role = batch.folder.role, [.spam, .trash, .sent, .drafts].contains(role) { return [] }
        let byUid = Dictionary(batch.items.map { ($0.uid, $0) }, uniquingKeysWith: { first, _ in first })
        var events: [FlintEvent] = []
        for outcome in batch.outcomes {
            guard let item = byUid[outcome.uid], outcome.isNew, !outcome.fromMe, !outcome.blocked, !item.flags.seen, !item.flags.draft else { continue }
            if item.date < now - maxAgeMs { continue }
            let inInbox: Bool
            if let labels = item.gmLabels { inInbox = inboxPath.map { labels.contains($0) } ?? false } else { inInbox = batch.folder.role == .inbox }
            guard inInbox else { continue }
            let notify = outcome.ruleActions.compactMap { action -> Bool? in if case .notify(let enabled) = action { return enabled } else { return nil } }.first
            if notify == false { continue }
            let moved = outcome.ruleActions.contains {
                switch $0 {
                case .mute, .archive, .trash, .move: return true
                default: return false
                }
            }
            if moved { continue }
            let thread = try? await store.threadItems([outcome.threadId]).first
            if thread?.muted == true { continue }
            let from = item.from.first ?? Address(address: "")
            let snippet = (thread?.snippet ?? item.snippet ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            events.append(.newMail(
                accountId: accountId, threadId: outcome.threadId, from: from, subject: item.subject, category: outcome.category,
                snippet: snippet.isEmpty ? nil : snippet, forced: notify == true))
        }
        return events
    }
}
