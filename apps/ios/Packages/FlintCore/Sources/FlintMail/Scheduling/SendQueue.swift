// The queue behind "Send": a send is a scheduled-send row due after the undo window (or later, for send-later). Cancelling
// inside the window is the undo. Port of packages/core/src/service/compose-queue.ts without agent approval.

import FlintModel
import FlintStore
import Foundation

public typealias SendQueueStore = SettingsRepository & DraftsRepository & ScheduledSendRepository

public struct SendQueue: Sendable {
    private let store: any SendQueueStore
    private let emit: @Sendable (FlintEvent) -> Void
    private let now: @Sendable () -> EpochMs
    /// Called after the queue changed, so the scheduler re-arms its timer.
    private let poke: @Sendable () -> Void

    public init(
        store: any SendQueueStore, emit: @escaping @Sendable (FlintEvent) -> Void, poke: @escaping @Sendable () -> Void = {},
        now: @escaping @Sendable () -> EpochMs = { Int(Date().timeIntervalSince1970 * 1000) }
    ) {
        self.store = store
        self.emit = emit
        self.poke = poke
        self.now = now
    }

    private func announce(_ row: ScheduledSend, draft: Draft?) {
        emit(.send(row))
        if let draft { emit(.mailChanged(accountId: draft.accountId, threadIds: draft.threadId.map { [$0] } ?? [])) }
        poke()
    }

    /// Queues the draft. It is sent after the undo window (Settings, Compose) or at `sendAt`, whichever is later than now.
    public func sendDraft(_ draftId: Int, sendAt: EpochMs? = nil) async throws -> SendResult {
        guard draftId > 0, let draft = try await store.draft(id: draftId) else { throw FlintError(.notFound, "That draft no longer exists.") }
        guard draft.to.count + draft.cc.count + draft.bcc.count > 0 else { throw FlintError(.invalid, "Add at least one recipient before sending.") }
        if try await store.openScheduledSend(draftId: draftId) != nil { throw FlintError(.conflict, "This message is already queued to send.") }
        let settings = try await store.settings()
        let current = now()
        let due = max(sendAt ?? current + settings.compose.undoSendSeconds * 1000, current)
        let row = try await store.createScheduledSend(NewScheduledSend(draftId: draftId, sendAt: due, status: .pending, requestedBy: "user"), now: current)
        announce(row, draft: draft)
        return SendResult(scheduledId: row.id, sendAt: due, undoUntil: due, status: .pending)
    }

    /// Undo send, or cancel a scheduled send. Returns the draft so the composer can reopen it.
    public func cancelSend(_ scheduledId: Int) async throws -> Draft {
        guard let row = try await store.scheduledSend(id: scheduledId) else { throw FlintError(.notFound, "That send no longer exists.") }
        if row.status == .sending { throw FlintError(.conflict, "It's already on its way and can't be cancelled.") }
        if row.status == .sent { throw FlintError(.conflict, "That message was already sent.") }
        guard let draft = try await store.draft(id: row.draftId) else { throw FlintError(.notFound, "That draft no longer exists.") }
        // A failed send is cleared too, so "Edit and resend" or "Retry" doesn't leave the old failure listed.
        if row.status == .pending || row.status == .awaitingApproval || row.status == .failed {
            let cancelled = try await store.updateScheduled(row.id, ScheduledSendPatch(status: .cancelled, error: .some(nil)))
            announce(cancelled, draft: draft)
        }
        return draft
    }

    /// Open sends and their state, for the Scheduled view.
    public func listScheduled() async throws -> [ScheduledSend] { try await store.listScheduled() }

    /// Moves a pending send to a new time (the "change time" action on a scheduled send).
    public func reschedule(_ scheduledId: Int, to sendAt: EpochMs) async throws -> ScheduledSend {
        guard let row = try await store.scheduledSend(id: scheduledId) else { throw FlintError(.notFound, "That send no longer exists.") }
        guard row.status == .pending || row.status == .failed else { throw FlintError(.conflict, "That message can't be moved now.") }
        let updated = try await store.updateScheduled(scheduledId, ScheduledSendPatch(status: .pending, error: .some(nil), attempts: 0, sendAt: max(sendAt, now())))
        announce(updated, draft: try? await store.draft(id: row.draftId))
        return updated
    }
}
