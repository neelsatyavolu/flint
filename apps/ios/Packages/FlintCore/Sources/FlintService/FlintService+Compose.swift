// Writing mail: drafts, sending with an undo window or at a chosen time, and the library of signatures, templates and rules.

import FlintMail
import FlintModel
import FlintStore
import Foundation

extension FlintService {
    // MARK: Drafts

    public func createDraft(_ initial: DraftInit) async throws -> Draft { try await core.createDraft(initial) }
    public func draft(id: Int) async throws -> Draft { try await core.draft(id) }
    public func listDrafts() async throws -> [Draft] { try await core.listDrafts() }
    public func updateDraft(id: Int, _ patch: DraftPatch) async throws -> Draft { try await core.updateDraft(id, patch) }
    public func deleteDraft(id: Int) async throws { try await core.deleteDraft(id) }

    /// Opens a draft that exists only on the server (started in Gmail on the web or another app) as a local draft.
    public func openServerDraft(messageId: MessageRowID) async throws -> Draft { try await core.openServerDraft(messageId) }

    /// Copies the file into the draft (at most 25 MB each). Pass a URL the app can read, for example one from a document picker.
    public func addAttachment(draftId: Int, file: URL) async throws -> Draft { try await core.addAttachment(draftId: draftId, file: file) }
    public func removeAttachment(draftId: Int, attachmentId: String) async throws -> Draft {
        try await core.removeAttachment(draftId: draftId, attachmentId: attachmentId)
    }

    /// Saves the server copy of the draft now (the composer calls this when it closes).
    public func flushDraft(id: Int) async { await core.serverDrafts.flush(id) }

    // MARK: Sending

    /// Queues the draft. It goes out after the undo window (Settings > Compose), or at `sendAt` for send-later.
    public func sendDraft(id: Int, sendAt: EpochMs? = nil) async throws -> SendResult { try await core.sendQueue.sendDraft(id, sendAt: sendAt) }

    /// Undo send, or cancel a scheduled send. Returns the draft so the composer can reopen it.
    public func cancelSend(scheduledId: Int) async throws -> Draft { try await core.sendQueue.cancelSend(scheduledId) }

    public func listScheduled() async throws -> [ScheduledSend] { try await core.sendQueue.listScheduled() }

    /// Moves a pending or failed send to a new time (also the way to retry a failed send).
    public func rescheduleSend(scheduledId: Int, to sendAt: EpochMs) async throws -> ScheduledSend {
        try await core.sendQueue.reschedule(scheduledId, to: sendAt)
    }

    // MARK: Signatures, templates, rules (an `id` of 0 creates, any other id replaces)

    public func listSignatures() async throws -> [Signature] { try await core.store.listSignatures() }
    public func saveSignature(_ signature: Signature) async throws -> Signature { try await core.saveSignature(signature) }
    public func deleteSignature(id: Int) async throws { try await core.store.deleteSignature(id) }

    public func listTemplates() async throws -> [Template] { try await core.store.listTemplates() }
    public func saveTemplate(_ template: Template) async throws -> Template { try await core.saveTemplate(template) }
    public func deleteTemplate(id: Int) async throws { try await core.store.deleteTemplate(id) }

    public func listRules() async throws -> [Rule] { try await core.store.listRules() }
    public func saveRule(_ rule: Rule) async throws -> Rule { try await core.saveRule(rule) }
    public func deleteRule(id: Int) async throws { try await core.store.deleteRule(id) }

    /// Runs the enabled rules (or one rule) over the inbox. Returns how many threads changed.
    public func applyRules(ruleId: Int? = nil) async throws -> Int { try await core.applyRules(ruleId: ruleId) }
}
