import FlintModel
import Foundation
import Observation
import SwiftUI

/// One address the message can go out from: an account's own address or one of its aliases.
struct ComposerFromOption: Identifiable, Hashable, Sendable {
    let accountId: AccountID
    let address: String
    let accountName: String

    var id: String { address }
}

/// The fields of the draft the person edits besides the body.
struct ComposerFields: Equatable, Sendable {
    var from = ""
    var accountId: AccountID = ""
    var to: [Address] = []
    var cc: [Address] = []
    var bcc: [Address] = []
    var subject = ""
    var track = false
    var signatureId: Int?
    var attachments: [DraftAttachment] = []

    /// What changed since `old`, as a patch. Attachments are owned by the service and never sent back.
    func patch(since old: ComposerFields) -> DraftPatch? {
        var patch = DraftPatch()
        var changed = false
        if from != old.from { patch.from = from; changed = true }
        if accountId != old.accountId { patch.accountId = accountId; changed = true }
        if to != old.to { patch.to = to; changed = true }
        if cc != old.cc { patch.cc = cc; changed = true }
        if bcc != old.bcc { patch.bcc = bcc; changed = true }
        if subject != old.subject { patch.subject = subject; changed = true }
        if track != old.track { patch.track = track; changed = true }
        if signatureId != old.signatureId { patch.signatureId = .some(signatureId); changed = true }
        return changed ? patch : nil
    }
}

/// State and actions of the composer screen. The draft lives in the service; this keeps the editable copy, saves it as it
/// changes (`DraftAutosaver`), and sends, schedules or discards it.
@MainActor @Observable
final class ComposerViewModel {
    enum Phase: Equatable { case loading, ready, failed(String) }

    private(set) var phase: Phase = .loading
    private(set) var draft: Draft?
    private(set) var fields = ComposerFields()
    /// What the person writes. Bound to the editor.
    var body = AttributedString()
    var selection = AttributedTextSelection()
    private(set) var signature: Signature?
    private(set) var signatures: [Signature] = []
    private(set) var saveState: DraftAutosaver.State = .idle
    private(set) var problem: String?
    private(set) var isSending = false
    /// A soft stop waiting for "Send anyway" or "Go back".
    var confirm: SoftStop?
    var confirmDiscard = false

    @ObservationIgnored let model: AppModel
    @ObservationIgnored private let dismiss: @MainActor () -> Void
    @ObservationIgnored private var autosaver: DraftAutosaver?
    @ObservationIgnored private var lastHTML = ""
    @ObservationIgnored private var started = false
    @ObservationIgnored private var finished = false
    @ObservationIgnored private var pendingSend: (sendAt: EpochMs?, skip: Set<SoftStop>)?

    init(model: AppModel, dismiss: @escaping @MainActor () -> Void) {
        self.model = model
        self.dismiss = dismiss
    }

    // MARK: Derived

    var mode: ComposeMode { draft?.mode ?? .new }
    var quotedHTML: String { draft?.quotedHtml ?? "" }

    var title: String {
        switch mode {
        case .new: String(localized: "New message", table: "Composer")
        case .reply: String(localized: "Reply", table: "Composer")
        case .replyAll: String(localized: "Reply all", table: "Composer")
        case .forward: String(localized: "Forward", table: "Composer")
        }
    }

    var fromOptions: [ComposerFromOption] {
        model.accounts.filter(\.enabled).flatMap { account in
            ([account.email] + account.aliases).map { ComposerFromOption(accountId: account.id, address: $0, accountName: account.name) }
        }
    }

    var availableSignatures: [Signature] { SignatureRules.available(signatures, for: fields.accountId) }
    var selfAddresses: [String] { model.accounts.flatMap { [$0.email] + $0.aliases } }
    var allRecipients: [Address] { fields.to + fields.cc + fields.bcc }
    var plainBody: String { RichTextHTML.plainText(from: body) }

    var receiptBlocker: String? {
        SendChecks.receiptBlocker(settings: model.settings, recipients: allRecipients, selfAddresses: selfAddresses)
            ?? (model.settings == nil ? draft?.trackingBlockedReason : nil)
    }

    var isBlank: Bool {
        allRecipients.isEmpty && fields.subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && RichTextHTML.isEmpty(body) && fields.attachments.isEmpty
    }

    private var composedHTML: String { SignatureRules.compose(body: RichTextHTML.html(from: body), signature: signature) }

    // MARK: Loading

    /// Creates or opens the draft. Runs once per composer.
    func load(_ request: ComposeRequest) async {
        guard !started else { return }
        started = true
        do {
            let opened: Draft
            switch request {
            case .start(let initial): opened = try await model.createDraft(initial)
            case .resume(let id): opened = try await model.draft(id: id)
            }
            signatures = (try? await model.requireService().listSignatures()) ?? []
            apply(opened)
            phase = .ready
        } catch {
            phase = .failed(FlintErrorText.message(for: error))
        }
    }

    private func apply(_ opened: Draft) {
        let parts = SignatureRules.split(opened.html)
        draft = opened
        fields = ComposerFields(
            from: opened.from, accountId: opened.accountId, to: opened.to, cc: opened.cc, bcc: opened.bcc, subject: opened.subject,
            track: opened.track, signatureId: opened.signatureId, attachments: opened.attachments)
        body = RichTextHTML.attributed(fromHTML: parts.body)
        if let html = parts.signatureHTML {
            let id = parts.signatureId ?? opened.signatureId
            signature = signatures.first { $0.id == id } ?? Signature(id: id ?? 0, name: "", html: html)
        }
        lastHTML = composedHTML
        let id = opened.id
        autosaver = DraftAutosaver(
            onState: { [weak self] state in self?.saveState = state },
            save: { [model] patch in _ = try await model.updateDraft(id: id, patch) })
    }

    // MARK: Editing

    /// Applies a change to the fields and queues the difference for saving.
    func edit(_ change: (inout ComposerFields) -> Void) {
        var next = fields
        change(&next)
        guard let patch = next.patch(since: fields) else { return }
        fields = next
        autosaver?.push(patch)
        if !allRecipients.isEmpty, problem == FlintNoRecipients.text { problem = nil }
    }

    /// Call when `body` changes.
    func bodyChanged() {
        guard draft != nil else { return }
        let html = composedHTML
        guard html != lastHTML else { return }
        lastHTML = html
        autosaver?.push(DraftPatch(html: html))
    }

    func chooseFrom(_ option: ComposerFromOption) {
        guard option.address != fields.from else { return }
        let next = SignatureRules.defaultSignature(all: signatures, settings: model.settings, accountId: option.accountId, mode: mode)
        edit {
            $0.from = option.address
            $0.accountId = option.accountId
            $0.signatureId = next?.id
        }
        signature = next
        bodyChanged()
    }

    /// Swaps the signature block; nil removes it.
    func chooseSignature(_ next: Signature?) {
        edit { $0.signatureId = next?.id }
        signature = next
        bodyChanged()
    }

    func toggleTrack() { edit { $0.track.toggle() } }

    // MARK: Attachments

    func attach(files: [URL]) async {
        for url in files {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            await attach(file: url)
        }
    }

    /// Stages picked data (a photo) as a file with `filename` and attaches it.
    func attach(data: Data, filename: String) async {
        do {
            let url = try ComposerStaging.write(data, filename: filename)
            defer { ComposerStaging.remove(url) }
            await attach(file: url)
        } catch {
            problem = String(localized: "Couldn't add that file.", table: "Composer")
        }
    }

    private func attach(file: URL) async {
        guard let id = draft?.id else { return }
        do {
            let updated = try await model.addAttachment(draftId: id, file: file)
            fields.attachments = updated.attachments
        } catch {
            problem = FlintErrorText.message(for: error)
        }
    }

    func removeAttachment(_ attachment: DraftAttachment) async {
        guard let id = draft?.id else { return }
        fields.attachments.removeAll { $0.id == attachment.id }
        do {
            fields.attachments = try await model.removeAttachment(draftId: id, attachmentId: attachment.id).attachments
        } catch {
            problem = FlintErrorText.message(for: error)
        }
    }

    // MARK: Sending

    /// Checks the draft, then sends it or asks first. `sendAt` schedules it.
    func requestSend(sendAt: EpochMs? = nil, skip: Set<SoftStop> = []) async {
        guard draft != nil, !isSending else { return }
        let check = SendChecks.check(
            to: fields.to, cc: fields.cc, bcc: fields.bcc, subject: fields.subject, body: plainBody,
            attachmentCount: fields.attachments.count, skip: skip)
        switch check {
        case .noRecipients: problem = FlintNoRecipients.text
        case .confirm(let stop):
            pendingSend = (sendAt, skip)
            confirm = stop
        case .ok: await deliver(sendAt: sendAt)
        }
    }

    /// "Send anyway" on the soft stop that is showing.
    func confirmSend() async {
        guard let stop = confirm, let pending = pendingSend else { return }
        confirm = nil
        await requestSend(sendAt: pending.sendAt, skip: pending.skip.union([stop]))
    }

    func dismissConfirm() {
        confirm = nil
        pendingSend = nil
    }

    private func deliver(sendAt: EpochMs?) async {
        guard let id = draft?.id else { return }
        problem = nil
        isSending = true
        defer { isSending = false }
        do {
            try await autosaver?.flush()
        } catch {
            problem = String(localized: "Couldn't save the draft. Try again.", table: "Composer")
            return
        }
        guard await model.sendDraft(id: id, sendAt: sendAt) != nil else { return }
        finished = true
        dismiss()
    }

    // MARK: Closing

    /// Saves the draft and closes. A blank draft is deleted instead of kept. Stays open when saving fails.
    func close() async {
        if await finish() { dismiss() }
    }

    /// Saves (or deletes, when blank) once. Also runs when the sheet is swiped away. False when saving failed.
    @discardableResult
    func finish() async -> Bool {
        guard !finished, let id = draft?.id else { return true }
        if isBlank {
            finished = true
            autosaver?.cancel()
            await model.deleteDraft(id: id)
            return true
        }
        do {
            try await autosaver?.flush()
        } catch {
            problem = String(localized: "Couldn't save the draft. Try again.", table: "Composer")
            return false
        }
        finished = true
        await model.flushDraft(id: id)
        return true
    }

    /// Closes a composer whose draft never opened.
    func discardUnopened() { dismiss() }

    func discard() async {
        confirmDiscard = false
        if let id = draft?.id, !finished {
            finished = true
            autosaver?.cancel()
            await model.deleteDraft(id: id)
        }
        dismiss()
    }
}

enum FlintNoRecipients {
    static let text = String(localized: "Add at least one recipient.", table: "Composer")
}
