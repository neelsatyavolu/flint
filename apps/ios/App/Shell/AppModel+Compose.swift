import FlintModel
import FlintService
import Foundation

/// Drafts and sending. `sendDraft` shows "Sent · Undo" (or "Scheduled for ...") and Undo reopens the draft.
extension AppModel {
    /// Opens the composer sheet. The composer creates the draft (`createDraft`) when it appears.
    func startCompose(_ initial: DraftInit = .new()) { navigate(to: .compose(.start(initial))) }

    func createDraft(_ initial: DraftInit) async throws -> Draft { try await requireService().createDraft(initial) }
    func draft(id: Int) async throws -> Draft { try await requireService().draft(id: id) }
    func updateDraft(id: Int, _ patch: DraftPatch) async throws -> Draft { try await requireService().updateDraft(id: id, patch) }
    func openServerDraft(messageId: MessageRowID) async throws -> Draft { try await requireService().openServerDraft(messageId: messageId) }
    func addAttachment(draftId: Int, file: URL) async throws -> Draft { try await requireService().addAttachment(draftId: draftId, file: file) }

    func removeAttachment(draftId: Int, attachmentId: String) async throws -> Draft {
        try await requireService().removeAttachment(draftId: draftId, attachmentId: attachmentId)
    }

    func deleteDraft(id: Int) async {
        do { try await requireService().deleteDraft(id: id) } catch { report(error) }
    }

    /// Saves the server copy of the draft. Call it when the composer closes.
    func flushDraft(id: Int) async { await service?.flushDraft(id: id) }

    /// Queues the draft: it goes out after the undo window, or at `sendAt`. Returns nil (and shows the error) when it can't.
    @discardableResult
    func sendDraft(id: Int, sendAt: EpochMs? = nil, presets: SnoozePresets = SnoozePresets(), now: Date = Date()) async -> SendResult? {
        do {
            let queued = try? await requireService().draft(id: id)
            let result = try await requireService().sendDraft(id: id, sendAt: sendAt)
            if let queued { await scheduling.sendQueued(result, draft: queued, userScheduledAt: sendAt) }
            let undo: @MainActor () async -> Void = { [weak self] in await self?.undoSend(scheduledId: result.scheduledId) }
            if let sendAt {
                let time = presets.formatTime(Date(timeIntervalSince1970: Double(sendAt) / 1000), now: now)
                toasts.show(String(localized: "Scheduled for \(time)", table: "Shell"), undo: undo)
            } else {
                // Like the desktop: "Sending in 10s" with Undo over the undo window, plain "Sent" when undo send is off.
                let countdown = SendCountdown(startedAt: now, undoUntil: result.undoUntil)
                if countdown.remaining(at: now) > 0 {
                    toasts.show(countdown.message(at: now), undo: undo, countdown: countdown, now: now)
                } else {
                    toasts.show(String(localized: "Sent", table: "Shell"))
                }
            }
            return result
        } catch {
            report(error)
            return nil
        }
    }

    /// Undo send, or cancel a scheduled send, and reopen the draft in the composer.
    func undoSend(scheduledId: Int) async {
        do {
            let draft = try await requireService().cancelSend(scheduledId: scheduledId)
            await scheduling.sendCancelled(scheduledId: scheduledId)
            navigate(to: .compose(.resume(draftId: draft.id)))
        } catch {
            toasts.show(String(localized: "Too late to undo that.", table: "Shell"), kind: .error)
        }
    }

    @discardableResult
    func rescheduleSend(scheduledId: Int, to sendAt: EpochMs, presets: SnoozePresets = SnoozePresets(), now: Date = Date()) async -> ScheduledSend? {
        do {
            let send = try await requireService().rescheduleSend(scheduledId: scheduledId, to: sendAt)
            await scheduling.sendRescheduled(send)
            let time = presets.formatTime(Date(timeIntervalSince1970: Double(sendAt) / 1000), now: now)
            toasts.show(String(localized: "Scheduled for \(time)", table: "Shell"))
            return send
        } catch {
            report(error)
            return nil
        }
    }
}
