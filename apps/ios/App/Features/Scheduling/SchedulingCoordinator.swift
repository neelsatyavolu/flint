import FlintModel
import Foundation

/// Keeps the local notifications that back scheduling in step with the queue: a "Ready to send" reminder for send later (the
/// fallback when iOS never gave Flint time to run), a follow-up reminder per message, and snooze wake-ups. The service does the
/// real work while the app runs; these cover the time when it does not.
@MainActor
final class SchedulingCoordinator {
    /// What the person's notification settings allow Scheduling's notices to say.
    struct Privacy: Equatable, Sendable {
        /// Alerts are on and the scope is not "none": without it no notice is scheduled.
        var alertsOn = true
        /// Previews are not hidden: recipients may appear in titles.
        var showNames = true

        init(_ settings: Settings.Notifications = Settings.Notifications()) {
            alertsOn = NotificationPolicy.alertsAllowed(settings, account: nil)
            showNames = settings.preview != .none
        }
    }

    private let notifier: any LocalNotificationScheduling
    private(set) var privacy = Privacy()
    /// Notices cancelled when alerts went off, so they can come back when alerts do.
    private var withheld: [LocalNotice] = []
    /// The sends waiting in the queue as of the last `reconcile`. They rebuild "Ready to send" notices that were not kept in
    /// `withheld`, for example after a relaunch while alerts were off.
    private var waitingSends: [ScheduledSend] = []

    init(notifier: any LocalNotificationScheduling = NoNotifications()) {
        self.notifier = notifier
    }

    // MARK: Settings

    /// The notification settings changed. Turning alerts off withdraws what is waiting; hiding previews rewrites the titles that
    /// name someone.
    func update(notifications settings: Settings.Notifications) async {
        let next = Privacy(settings)
        defer { privacy = next }
        guard next != privacy else { return }
        let waiting = await notifier.pending()
        if !next.alertsOn {
            withheld = waiting + withheld.filter { kept in !waiting.contains { $0.id == kept.id } }
            if !waiting.isEmpty { await notifier.cancel(ids: waiting.map(\.id)) }
        } else if !privacy.alertsOn {
            await restore(showNames: next.showNames)
        } else if !next.showNames {
            for notice in waiting { await notifier.schedule(SchedulingNotices.withoutNames(notice), askPermission: false) }
        }
    }

    /// Alerts came back on: the "Ready to send" and follow-up notices that were cancelled when they went off are scheduled again,
    /// as long as they are still ahead. Send-later notices missing from that list are rebuilt from the waiting queue.
    private func restore(showNames: Bool, now: Date = Date()) async {
        var notices = withheld.filter { $0.fireAt > now && $0.kind != .snooze }
        let have = Set(notices.map(\.id))
        let nowMs = EpochMs(now.timeIntervalSince1970 * 1000)
        for send in waitingSends where send.sendAt > nowMs {
            let notice = SchedulingNotices.sendLater(scheduledId: send.id, to: send.to, sendAt: send.sendAt, showNames: showNames)
            if !have.contains(notice.id) { notices.append(notice) }
        }
        withheld = []
        for notice in notices { await notifier.schedule(showNames ? notice : SchedulingNotices.withoutNames(notice), askPermission: false) }
    }

    // MARK: Sending

    /// The draft was queued. `userScheduledAt` is the time the person chose, nil for a normal send after the undo window.
    func sendQueued(_ result: SendResult, draft: Draft, userScheduledAt: EpochMs?) async {
        guard privacy.alertsOn else { return }
        if userScheduledAt != nil {
            await notifier.schedule(
                SchedulingNotices.sendLater(scheduledId: result.scheduledId, to: draft.to, sendAt: result.sendAt, showNames: privacy.showNames), askPermission: true)
        }
        if let remindAt = draft.remindAt {
            let notice = SchedulingNotices.followUp(
                scheduledId: result.scheduledId, to: draft.to, threadId: draft.threadId, remindAt: remindAt,
                sentAt: userScheduledAt ?? result.undoUntil, showNames: privacy.showNames)
            await notifier.schedule(notice, askPermission: true)
        }
    }

    /// Undo send or cancel: neither notice is wanted any more.
    func sendCancelled(scheduledId: Int) async {
        let ids = [LocalNotice.id(.sendLater, String(scheduledId)), LocalNotice.id(.followUp, String(scheduledId))]
        withheld.removeAll { ids.contains($0.id) }
        await notifier.cancel(ids: ids)
    }

    func sendRescheduled(_ send: ScheduledSend) async {
        guard privacy.alertsOn else { return }
        await notifier.schedule(
            SchedulingNotices.sendLater(scheduledId: send.id, to: send.to, sendAt: send.sendAt, showNames: privacy.showNames), askPermission: true)
    }

    /// The queue changed. A "Ready to send" notice for a send that is no longer waiting (sent, or cancelled) is withdrawn, so it
    /// never tells the person to send what already went out.
    func reconcile(waiting: [ScheduledSend]) async {
        let stillWaiting = Set(waiting.map(\.id))
        waitingSends = waiting
        withheld.removeAll { $0.kind == .sendLater && !stillWaiting.contains($0.scheduledId ?? -1) }
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
        guard privacy.alertsOn else { return }
        for id in ids { await notifier.schedule(SchedulingNotices.snooze(threadId: id, until: until), askPermission: false) }
    }

    func unsnoozed(_ ids: [ThreadID]) async {
        await notifier.cancel(ids: ids.map { LocalNotice.id(.snooze, String($0)) })
    }
}
