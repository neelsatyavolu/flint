// Drafts: create (new, reply, reply all, forward), edit, attachments, open a server draft, delete. Port of
// packages/core/src/service/compose-drafts.ts. Sending and the undo window are `SendQueue`; the server copy of a draft is
// `ServerDrafts` (touched after every edit, replaced at most every ten seconds).

import FlintHTML
import FlintMail
import FlintModel
import FlintStore
import Foundation

extension ServiceCore {
    static let inlineImageMaxBytes = 2_000_000
    static let inlineImageMaxCount = 12
    /// Attachments of a server draft are copied only while the total stays small, so opening one stays quick.
    static let serverDraftAttachmentBytes = 10_000_000
    static let maxRecipients = 500

    // MARK: Validation

    static func validated(_ list: [Address]) throws -> [Address] {
        guard list.count <= maxRecipients else { throw FlintError(.invalid, "Use no more than 500 recipients.") }
        return try list.map { a in
            let address = a.address.trimmingCharacters(in: .whitespacesAndNewlines)
            guard address.count >= 3, address.count <= 320, address.contains("@"), !address.contains(where: \.isWhitespace), a.name.count <= 300 else {
                throw FlintError(.invalid, "Enter a full email address.")
            }
            return Address(name: a.name, address: address)
        }
    }

    private func addresses(of account: Account) -> [String] { ([account.email] + account.aliases).map { $0.lowercased() } }

    /// The send-as address of the account that the original was sent to, so a reply goes out from the same alias.
    private func replyFrom(_ account: Account, to: [Address], cc: [Address]) -> String {
        let addressed = Set((to + cc).map { $0.address.lowercased() })
        let alias = account.aliases.first { addressed.contains($0.lowercased()) }
        return addressed.contains(account.email.lowercased()) || alias == nil ? account.email : alias!
    }

    private func trackDefault(_ settings: Settings) -> Bool { settings.receipts.enabled && settings.receipts.defaultOn }

    private func firstAccount() async throws -> Account {
        let all = try await store.listAccounts()
        guard let account = all.first(where: \.enabled) ?? all.first else { throw FlintError(.invalid, "Add an account before writing mail.") }
        return account
    }

    private func announce(_ draft: Draft) {
        emit(.mailChanged(accountId: draft.accountId, threadIds: draft.threadId.map { [$0] } ?? []))
    }

    /// Each returned draft says why read receipts can't be used right now (see `Draft.trackingBlockedReason`).
    private func marked(_ draft: Draft) async -> Draft {
        var copy = draft
        copy.trackingBlockedReason = await sendJob.trackingBlockedReason()
        return copy
    }

    // MARK: Create

    func createDraft(_ initial: DraftInit) async throws -> Draft {
        let draft: Draft
        switch initial {
        case .new(let accountId, let to, let subject, let html, let templateId):
            draft = try await createNew(accountId: accountId, to: to, subject: subject, html: html, templateId: templateId)
        case .reply(let id, let html): draft = try await createFromMessage(id, mode: .reply, html: html)
        case .replyAll(let id, let html): draft = try await createFromMessage(id, mode: .replyAll, html: html)
        case .forward(let id, let html): draft = try await createFromMessage(id, mode: .forward, html: html)
        }
        announce(draft)
        return await marked(draft)
    }

    private func createNew(accountId: AccountID?, to: [Address], subject: String?, html: String?, templateId: Int?) async throws -> Draft {
        let settings = try await store.settings()
        let account: Account
        if let accountId {
            guard let found = try await store.account(id: accountId) else { throw FlintError(.notFound, "That account no longer exists.") }
            account = found
        } else {
            account = try await firstAccount()
        }
        var template: Template?
        if let templateId {
            guard let found = try await store.template(id: templateId) else { throw FlintError(.notFound, "That template no longer exists.") }
            template = found
        }
        let signature = Signatures.defaultSignature(all: try await store.listSignatures(), settings: settings, accountId: account.id, mode: .new)
        let body = (template?.html ?? "") + (html ?? "")
        return try await store.createDraft(NewDraft(
            accountId: account.id, from: account.email, mode: .new, to: try Self.validated(to), subject: subject ?? template?.subject ?? "",
            html: signature.map { Signatures.replace(body, with: $0) } ?? body, signatureId: signature?.id, track: trackDefault(settings)), now: now())
    }

    private func createFromMessage(_ id: MessageRowID, mode: ComposeMode, html: String?) async throws -> Draft {
        guard let first = try await store.message(id: id) else { throw FlintError(.notFound, "That message no longer exists.") }
        await ensureBodies([first], wait: nil)
        let message = try await store.message(id: id) ?? first
        guard let account = try await store.account(id: message.accountId) else { throw FlintError(.notFound, "That account no longer exists.") }
        let settings = try await store.settings()
        let threadMessage = try await store.threadRows(message.threadId)?.messages.first { $0.id == message.id }
        let quoted = await quotedBody(message, source: threadMessage, accountId: account.id)
        let reply = ReplyDraftBuilder.build(
            ReplySource(
                from: message.from, to: message.to, cc: message.cc, replyTo: message.replyTo, subject: message.subject, date: message.date,
                messageId: message.messageId, references: message.references),
            mode: mode, userAddresses: try await store.ownAddresses(), quotedBodyHTML: quoted)
        let signature = Signatures.defaultSignature(all: try await store.listSignatures(), settings: settings, accountId: account.id, mode: mode)
        let body = html ?? ""
        let draft = try await store.createDraft(NewDraft(
            accountId: account.id, from: replyFrom(account, to: message.to, cc: message.cc), mode: mode, sourceMessageId: message.id,
            threadId: message.threadId, to: reply.to, cc: reply.cc, subject: reply.subject,
            html: signature.map { Signatures.replace(body, with: $0) } ?? body, quotedHtml: reply.quotedHtml, signatureId: signature?.id,
            track: trackDefault(settings), inReplyTo: reply.inReplyTo, references: reply.references), now: now())
        guard mode == .forward else { return draft }
        do {
            let attachments = try await carryAttachments(into: draft, from: threadMessage, accountId: account.id, budget: nil)
            return attachments.isEmpty ? draft : try await store.updateDraft(draft.id, DraftPatch(attachments: attachments), now: now())
        } catch {
            try? await store.deleteDraft(draft.id)
            DraftFiles.removeDirectory(DraftFiles.directory(config.draftsDirectory, draftId: draft.id))
            throw (error as? FlintError) ?? FlintError(.network, "Couldn't load the attachments to forward. Try again.")
        }
    }

    /// The original as quoted HTML: remote images allowed, receipts pixels removed, cid images inlined as data.
    private func quotedBody(_ message: StoredMessage, source: StoredMessage?, accountId: AccountID) async -> String {
        guard let raw = message.rawHtml else { return ReplyDraftBuilder.plainTextBody(message.text) }
        let settings = try? await store.settings()
        var inline: [String: String] = [:]
        if raw.range(of: "cid:", options: .caseInsensitive) != nil {
            let images = (source?.attachments ?? []).filter { $0.inline && $0.contentId != nil && $0.contentType.lowercased().hasPrefix("image/") && $0.size <= Self.inlineImageMaxBytes }
            let session = sync.session(for: accountId)
            for image in images.prefix(Self.inlineImageMaxCount) {
                guard let data = try? await session.fetchAttachment(image.id), let cid = image.contentId else { continue }
                inline[cid.trimmingCharacters(in: CharacterSet(charactersIn: "<>")).lowercased()] = "data:\(image.contentType);base64,\(data.base64EncodedString())"
            }
        }
        let resolved = inline
        let options = SanitizeOptions(
            allowRemoteImages: true, receiptsHost: Self.receiptsHost(settings?.receipts.endpoint ?? ""),
            cidResolver: { resolved[$0.trimmingCharacters(in: CharacterSet(charactersIn: "<>")).lowercased()] }, blockTrackers: false)
        return HTMLSanitizer.sanitize(raw, options).html
    }

    /// Non-inline attachments of a message copied into the draft's folder. `budget` limits the total bytes (server drafts).
    private func carryAttachments(into draft: Draft, from message: StoredMessage?, accountId: AccountID, budget: Int?) async throws -> [DraftAttachment] {
        let dir = DraftFiles.directory(config.draftsDirectory, draftId: draft.id)
        let session = sync.session(for: accountId)
        var out: [DraftAttachment] = []
        var total = 0
        for attachment in (message?.attachments ?? []).filter({ !$0.inline }) {
            if let budget, total + attachment.size > budget { continue }
            do {
                let data = try await session.fetchAttachment(attachment.id)
                out.append(try DraftFiles.write(data, filename: attachment.filename, contentType: attachment.contentType, to: dir, existing: out))
                total += attachment.size
            } catch {
                if budget == nil { throw error }
            }
        }
        return out
    }

    // MARK: Server drafts

    func openServerDraft(_ messageId: MessageRowID) async throws -> Draft {
        guard let first = try await store.message(id: messageId) else { throw FlintError(.notFound, "That draft is no longer on this device.") }
        if let linked = try await store.findDraft(accountId: first.accountId, serverMessageId: first.messageId, folderId: first.folderId, uid: first.uid) {
            return await marked(linked)
        }
        let draftsFolder = try await store.folder(accountId: first.accountId, role: .drafts)
        guard first.draft || draftsFolder?.id == first.folderId else { throw FlintError(.invalid, "That message isn't a draft.") }
        await ensureBodies([first], wait: nil)
        let message = try await store.message(id: messageId) ?? first
        guard let account = try await store.account(id: message.accountId) else { throw FlintError(.notFound, "That account no longer exists.") }
        let mine = addresses(of: account)
        let sender = message.from.first { mine.contains($0.address.lowercased()) }?.address ?? account.email
        let original = try await originalOf(message, account: account)
        let rawHtml = message.rawHtml ?? message.text.map(Self.textToHTML) ?? ""
        let html = rawHtml.isEmpty ? "" : HTMLSanitizer.sanitize(rawHtml, SanitizeOptions(allowRemoteImages: true, blockTrackers: false)).html
        let settings = try await store.settings()
        let draft = try await store.createDraft(NewDraft(
            accountId: account.id, from: sender, mode: original == nil ? .new : .reply, sourceMessageId: original?.id, threadId: original?.threadId,
            to: message.to, cc: message.cc, bcc: message.bcc, subject: message.subject, html: html, track: trackDefault(settings),
            inReplyTo: message.inReplyTo, references: message.references), now: now())
        try await store.setDraftMeta(draft.id, DraftMeta(
            inReplyTo: message.inReplyTo, references: message.references, serverUid: await serverUid(of: message, draftsFolder: draftsFolder),
            serverMessageId: message.messageId))
        let rows = try await store.threadRows(message.threadId)?.messages.first { $0.id == message.id }
        let attachments = (try? await carryAttachments(into: draft, from: rows, accountId: account.id, budget: Self.serverDraftAttachmentBytes)) ?? []
        let result = attachments.isEmpty ? draft : try await store.updateDraft(draft.id, DraftPatch(attachments: attachments), now: now())
        announce(result)
        emit(.mailChanged(accountId: account.id, threadIds: [message.threadId]))
        return await marked(result)
    }

    private func originalOf(_ draft: StoredMessage, account: Account) async throws -> StoredMessage? {
        guard let parent = draft.inReplyTo else { return nil }
        return try await store.messages(accountId: account.id, messageId: parent).first { !$0.draft }
    }

    /// UID of the draft's copy in the Drafts folder. A message synced from Gmail's All Mail is looked up there by Message-ID.
    private func serverUid(of message: StoredMessage, draftsFolder: Folder?) async -> Int? {
        guard let folder = draftsFolder else { return nil }
        if folder.id == message.folderId { return message.uid }
        guard let id = message.messageId else { return nil }
        let wanted = MailHeaders.unbracketed(id)
        let path = folder.path
        return try? await sync.session(for: message.accountId).run { t in
            _ = try await t.select(path, readOnly: true, qresync: nil)
            return try await t.search(.header(name: "message-id", value: wanted)).first
        }
    }

    static func textToHTML(_ text: String) -> String {
        text.components(separatedBy: "\n\n").map { "<p>\(ReplyDraftBuilder.escapeHTML($0).replacingOccurrences(of: "\n", with: "<br>"))</p>" }.joined()
    }

    // MARK: Edit

    func draft(_ id: Int) async throws -> Draft {
        guard id > 0, let draft = try await store.draft(id: id) else { throw FlintError(.notFound, "That draft no longer exists.") }
        return await marked(draft)
    }

    func listDrafts() async throws -> [Draft] {
        var out: [Draft] = []
        for draft in try await store.listDrafts() { out.append(await marked(draft)) }
        return out
    }

    func updateDraft(_ id: Int, _ patch: DraftPatch) async throws -> Draft {
        guard id > 0, let draft = try await store.draft(id: id) else { throw FlintError(.notFound, "That draft no longer exists.") }
        guard (patch.subject?.count ?? 0) <= 998, (patch.html?.count ?? 0) <= 5_000_000 else { throw FlintError(.invalid, "That draft is too long.") }
        var resolved = patch
        resolved.to = try patch.to.map(Self.validated)
        resolved.cc = try patch.cc.map(Self.validated)
        resolved.bcc = try patch.bcc.map(Self.validated)
        let sender = try await resolveSender(draft, patch)
        var html = patch.html ?? draft.html
        var signatureId = draft.signatureId
        if patch.signatureId != nil || sender.account.id != draft.accountId {
            let all = try await store.listSignatures()
            let signature: Signature?
            switch patch.signatureId {
            case .none: signature = Signatures.defaultSignature(all: all, settings: try await store.settings(), accountId: sender.account.id, mode: draft.mode)
            case .some(.none): signature = nil
            case .some(.some(let wanted)):
                guard let found = all.first(where: { $0.id == wanted }) else { throw FlintError(.notFound, "That signature no longer exists.") }
                signature = found
            }
            html = Signatures.replace(html, with: signature)
            signatureId = signature?.id
        }
        resolved.accountId = sender.account.id
        resolved.from = sender.from
        resolved.html = html
        resolved.signatureId = .some(signatureId)
        let updated = try await store.updateDraft(id, resolved, now: now())
        await serverDrafts.touch(id)
        return await marked(updated)
    }

    /// The account a patch moves the draft to, and the address it sends from.
    private func resolveSender(_ draft: Draft, _ patch: DraftPatch) async throws -> (account: Account, from: String) {
        let accounts = try await store.listAccounts()
        let wanted = patch.from?.lowercased()
        let owner = wanted.flatMap { w in accounts.first { addresses(of: $0).contains(w) } }
        if patch.from != nil, owner == nil { throw FlintError(.invalid, "That address doesn't belong to any of your accounts.") }
        let account: Account
        if let id = patch.accountId {
            guard let found = accounts.first(where: { $0.id == id }) else { throw FlintError(.notFound, "That account no longer exists.") }
            account = found
        } else if let owner {
            account = owner
        } else {
            guard let current = accounts.first(where: { $0.id == draft.accountId }) else { throw FlintError(.notFound, "That account no longer exists.") }
            account = current
        }
        if patch.accountId != nil, let owner, owner.id != account.id { throw FlintError(.invalid, "That address belongs to a different account.") }
        let from = patch.from ?? (account.id == draft.accountId ? draft.from : account.email)
        guard addresses(of: account).contains(from.lowercased()) else { throw FlintError(.invalid, "That address doesn't belong to this account.") }
        return (account, from)
    }

    func deleteDraft(_ id: Int) async throws {
        guard let draft = try await store.draft(id: id) else { return }
        if try await store.openScheduledSend(draftId: id)?.status == .sending { throw FlintError(.conflict, "This message is being sent right now.") }
        await serverDrafts.remove(id)
        try await store.deleteDraft(id)
        DraftFiles.removeDirectory(DraftFiles.directory(config.draftsDirectory, draftId: id))
        pump.poke()
        announce(draft)
    }

    // MARK: Attachments

    func addAttachment(draftId: Int, file: URL) async throws -> Draft {
        guard let draft = try await store.draft(id: draftId) else { throw FlintError(.notFound, "That draft no longer exists.") }
        let attachment = try DraftFiles.copyIn(file, to: DraftFiles.directory(config.draftsDirectory, draftId: draftId), existing: draft.attachments)
        let updated = try await store.updateDraft(draftId, DraftPatch(attachments: draft.attachments + [attachment]), now: now())
        await serverDrafts.touch(draftId)
        return await marked(updated)
    }

    func removeAttachment(draftId: Int, attachmentId: String) async throws -> Draft {
        guard let draft = try await store.draft(id: draftId) else { throw FlintError(.notFound, "That draft no longer exists.") }
        guard let target = draft.attachments.first(where: { $0.id == attachmentId }) else { return await marked(draft) }
        let updated = try await store.updateDraft(draftId, DraftPatch(attachments: draft.attachments.filter { $0.id != attachmentId }), now: now())
        DraftFiles.remove(target.path, inside: DraftFiles.directory(config.draftsDirectory, draftId: draftId))
        await serverDrafts.touch(draftId)
        return await marked(updated)
    }
}
