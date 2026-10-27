import FlintModel
import Foundation

/// Keeps the local notifications that back scheduling in step with the queue: a "Ready to send" reminder for send later (the
/// fallback when iOS never gave Flint time to run), a follow-up reminder per message, and snooze wake-ups. The service does the
/// real work while the app runs; these cover the time when it does not.
@MainActor
final class SchedulingCoordinator {
    private let notifier: any LocalNotificationScheduling

    init(notifier: any LocalNotificationScheduling = NoNotifications()) {
        self.notifier = notifier
    }

    // MARK: Sending

    /// The draft was queued. `userScheduledAt` is the time the person chose, nil for a normal send after the undo window.
    func sendQueued(_ result: SendResult, draft: Draft, userScheduledAt: EpochMs?) async {
        if userScheduledAt != nil {
            await notifier.schedule(SchedulingNotices.sendLater(scheduledId: result.scheduledId, to: draft.to, sendAt: result.sendAt), askPermission: true)
        }
        if let remindAt = draft.remindAt {
            let notice = SchedulingNotices.followUp(
                scheduledId: result.scheduledId, to: draft.to, threadId: draft.threadId, remindAt: remindAt, sentAt: userScheduledAt ?? result.undoUntil)
            await notifier.schedule(notice, askPermission: true)
        }
    }

    /// Undo send or cancel: neither notice is wanted any more.
    func sendCancelled(scheduledId: Int) async {
        await notifier.cancel(ids: [LocalNotice.id(.sendLater, String(scheduledId)), LocalNotice.id(.followUp, String(scheduledId))])
    }

    func sendRescheduled(_ send: ScheduledSend) async {
        await notifier.schedule(SchedulingNotices.sendLater(scheduledId: send.id, to: send.to, sendAt: send.sendAt), askPermission: true)
    }

    /// The queue changed. A "Ready to send" notice for a send that is no longer waiting (sent, or cancelled) is withdrawn, so it
    /// never tells the person to send what already went out.
    func reconcile(waiting: [ScheduledSend]) async {
        let stillWaiting = Set(waiting.map(\.id))
        let stale = await notifier.pending().filter { $0.kind == .sendLater && !stillWaiting.contains($0.scheduledId ?? -1) }
        if !stale.isEmpty { await notifier.cancel(ids: stale.map(\.id)) }
    }

    // MARK: Replies

    /// Mail arrived in `threadId` from `sender`. When someone else wrote after the followed-up message went out, the follow-up
    /// is answered and its reminder goes.
    func replyArrived(threadId: ThreadID, from sender: String, ownAddresses: Set<String>, at: EpochMs) async {
        guard !ownAddresses.contains(sender.lowercased()) else { return }
        let answered = await notifier.pending().filter { $0.kind == .followUp && $0.threadId == threadId && ($0.sentAt ?? 0) <= at }
        if !answered.isEmpty { await notifier.cancel(ids: answered.map(\.id)) }
    }

    /// Service events that matter here. Call for every event.
    func observe(_ event: FlintEvent, ownAddresses: Set<String>, now: EpochMs = Int(Date().timeIntervalSince1970 * 1000)) {
        guard case .newMail(_, let threadId, let from, _, _, _, _) = event else { return }
        Task { await replyArrived(threadId: threadId, from: from.address, ownAddresses: ownAddresses, at: now) }
    }

    // MARK: Snooze

    func snoozed(_ ids: [ThreadID], until: EpochMs) async {
        for id in ids { await notifier.schedule(SchedulingNotices.snooze(threadId: id, until: until), askPermission: false) }
    }

    func unsnoozed(_ ids: [ThreadID]) async {
        await notifier.cancel(ids: ids.map { LocalNotice.id(.snooze, String($0)) })
    }
}
