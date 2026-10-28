// Everything that fires at a time and needs no UI: sends whose undo window passed, snoozed threads that come back, and
// follow-up reminders. Port of packages/core/src/scheduler (send, snooze and reminder jobs; the receipts cadence belongs to
// the receipts module).
//
// iOS has no resident timer. The scheduler is a plain `tick(now:)` that runs everything due and reports `nextDueAt`, so the
// app arms an in-process task while foreground and a BGTask / local notification for the same instant when it leaves.

import FlintModel
import FlintStore
import Foundation

public typealias MailSchedulerStore = MailEngineStore & ScheduledSendRepository & RemindersRepository

public struct ReminderOutcome: Hashable, Sendable {
    public enum Result: Hashable, Sendable { case fired, replied }
    public var reminder: Reminder
    public var threadId: ThreadID
    public var result: Result
    /// "No reply from Ann yet" or "Reply received".
    public var message: String
}

public struct SnoozeWake: Hashable, Sendable {
    public var threadId: ThreadID
    public var subject: String
}

public actor MailScheduler {
    /// Waits before each retry of a failed send; after the last one the send is marked failed.
    public static let sendRetryBackoffMs = [5_000, 30_000, 120_000]

    public struct Hooks: Sendable {
        /// Sends the draft. Throw to retry later; throw `.conflict` when the message may already have gone out (no retry).
        public var sendDraft: (@Sendable (_ draftId: Int, _ scheduledId: Int) async throws -> String?)?
        /// Called after a send succeeded (delete the draft, its files and its server copy).
        public var didSend: (@Sendable (ScheduledSend) async -> Void)?
        public var didReminder: (@Sendable (ReminderOutcome) async -> Void)?
        public var didWakeSnooze: (@Sendable (SnoozeWake) async -> Void)?

        public init(
            sendDraft: (@Sendable (Int, Int) async throws -> String?)? = nil, didSend: (@Sendable (ScheduledSend) async -> Void)? = nil,
            didReminder: (@Sendable (ReminderOutcome) async -> Void)? = nil, didWakeSnooze: (@Sendable (SnoozeWake) async -> Void)? = nil
        ) {
            self.sendDraft = sendDraft
            self.didSend = didSend
            self.didReminder = didReminder
            self.didWakeSnooze = didWakeSnooze
        }
    }

    private let store: any MailSchedulerStore
    private let actions: @Sendable (AccountID) -> ServerActions?
    private let hooks: Hooks
    private let emit: @Sendable (FlintEvent) -> Void
    private let now: @Sendable () -> EpochMs
    private var ticking: Task<Void, Never>?

    public init(
        store: any MailSchedulerStore, actions: @escaping @Sendable (AccountID) -> ServerActions?, hooks: Hooks, emit: @escaping @Sendable (FlintEvent) -> Void,
        now: @escaping @Sendable () -> EpochMs = { Int(Date().timeIntervalSince1970 * 1000) }
    ) {
        self.store = store
        self.actions = actions
        self.hooks = hooks
        self.emit = emit
        self.now = now
    }

    // MARK: Entry points

    /// Marks sends left in `sending` by a crash as failed. They are not retried: the server may already have the mail.
    public func recoverInterruptedSends() async {
        guard let rows = try? await store.listScheduled() else { return }
        for row in rows where row.status == .sending {
            if let failed = try? await store.updateScheduled(row.id, ScheduledSendPatch(
                status: .failed, error: .some("Flint closed while this was sending. Check Sent before sending again."))) { emit(.send(failed)) }
        }
    }

    /// Runs everything that is due. Overlapping calls share the run in progress. Returns when the next item is due, if any.
    @discardableResult
    public func tick() async -> EpochMs? {
        if let running = ticking {
            await running.value
        } else {
            let job = Task { await self.runAll() }
            ticking = job
            await job.value
            ticking = nil
        }
        return await nextDueAt()
    }

    /// The earliest time a send, snooze or reminder is due.
    public func nextDueAt() async -> EpochMs? {
        var times: [EpochMs] = []
        if hooks.sendDraft != nil, let next = try? await store.nextScheduledAt() { times.append(next) }
        if let next = try? await store.nextReminderAt() { times.append(next) }
        if let next = await nextSnoozeAt() { times.append(next) }
        return times.min()
    }

    private func nextSnoozeAt() async -> EpochMs? {
        // The store exposes due snoozes, not the next one: list everything snoozed and take the soonest wake time.
        guard let all = try? await store.listDueSnoozes(now: Int.max / 2), !all.isEmpty, let items = try? await store.threadItems(all) else { return nil }
        return items.compactMap(\.snoozedUntil).min()
    }

    private func runAll() async {
        await runSends()
        await runSnoozes()
        await runReminders()
    }

    // MARK: Sends

    func runSends() async {
        guard let send = hooks.sendDraft, let due = try? await store.listDueScheduled(now: now()) else { return }
        for item in due {
            guard let sending = try? await store.updateScheduled(item.id, ScheduledSendPatch(status: .sending, error: .some(nil))) else { continue }
            emit(.send(sending))
            do {
                let messageId = try await send(item.draftId, item.id)
                let done = try await store.updateScheduled(item.id, ScheduledSendPatch(status: .sent, error: .some(nil), messageId: .some(messageId ?? sending.messageId)))
                emit(.send(done))
                await hooks.didSend?(done)
            } catch {
                await sendFailed(sending, error: error)
            }
        }
    }

    private func sendFailed(_ row: ScheduledSend, error: Error) async {
        let flint = error as? FlintError
        let message = flint?.message ?? error.localizedDescription
        let attempts = row.attempts + 1
        // Retrying a message that may already have been accepted would deliver it twice, and a draft that is gone or has no
        // recipients will not fix itself.
        let retryable = ![.conflict, .invalid, .notFound].contains(flint?.code)
        if retryable && attempts <= Self.sendRetryBackoffMs.count {
            let retry = try? await store.updateScheduled(row.id, ScheduledSendPatch(
                status: .pending, error: .some(message), attempts: attempts, sendAt: now() + Self.sendRetryBackoffMs[attempts - 1]))
            if let retry { emit(.send(retry)) }
        } else if let failed = try? await store.updateScheduled(row.id, ScheduledSendPatch(status: .failed, error: .some(message), attempts: attempts)) {
            emit(.send(failed))
            emit(.toast(.error, message: "Couldn't send \"\(failed.subject.isEmpty ? "(no subject)" : failed.subject)\". \(message)", undoToken: nil))
        }
    }

    // MARK: Snoozes

    func runSnoozes() async {
        let current = now()
        guard let due = try? await store.listDueSnoozes(now: current) else { return }
        for threadId in due {
            let rows = try? await store.threadRows(threadId)
            guard let result = try? await store.wakeSnoozed(threadId, now: current) else { continue }
            if let rows { emit(.mailChanged(accountId: rows.accountId, threadIds: [threadId])) }
            // The latest message is unread again locally: clear \Seen on the server too.
            for (accountId, locs) in Dictionary(grouping: result.locations, by: \.accountId) { _ = await actions(accountId)?.setSeen(locs, false) }
            await hooks.didWakeSnooze?(SnoozeWake(threadId: threadId, subject: rows?.subject ?? ""))
        }
    }

    // MARK: Reminders

    private static func label(_ address: Address) -> String {
        let name = address.name.trimmingCharacters(in: .whitespaces)
        return name.isEmpty ? address.address : String(name.split(whereSeparator: \.isWhitespace).first ?? "")
    }

    /// Fires reminders whose thread has no reply since the tracked message; marks the rest replied.
    func runReminders() async {
        let current = now()
        guard let due = try? await store.listDueReminders(now: current) else { return }
        for reminder in due {
            do {
                let sent = try await store.messages(accountId: reminder.accountId, messageId: reminder.messageId).first
                guard let threadId = reminder.threadId ?? sent?.threadId else {
                    try await store.setReminderStatus(reminder.id, .cancelled)
                    continue
                }
                let sentAt = sent?.date ?? reminder.remindAt
                let replied = try await store.threadHasReply(threadId, since: sentAt)
                try await store.setReminderStatus(reminder.id, replied ? .replied : .fired)
                if !replied {
                    try await store.resurface(threadId, now: current)
                    if let rows = try await store.threadRows(threadId) { emit(.mailChanged(accountId: rows.accountId, threadIds: [threadId])) }
                }
                let to = sent?.to.first.map(Self.label) ?? "the recipient"
                await hooks.didReminder?(ReminderOutcome(
                    reminder: reminder, threadId: threadId, result: replied ? .replied : .fired, message: replied ? "Reply received" : "No reply from \(to) yet"))
            } catch {
                continue // a failing reminder stays pending and is tried again on the next tick
            }
        }
    }
}
