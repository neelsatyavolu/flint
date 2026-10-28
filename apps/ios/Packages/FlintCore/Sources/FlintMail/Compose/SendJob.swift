// Turns a queued draft into a delivered message: builds it, sends it (tracked or not), files the Sent copy, then does the
// bookkeeping that follows a send. Port of packages/core/src/service/send.ts.
//
// Read receipts are decided here but implemented by the receipts module through `TrackingProvider`; the service facade binds
// the two. A send that fails before SMTP throws and is retried by the scheduler; after the mail left nothing here may throw.

import FlintModel
import FlintStore
import Foundation

public struct SendTrackingRecipient: Hashable, Sendable {
    public var address: Address
    public var token: String
    public var pixelURL: String

    public init(address: Address, token: String, pixelURL: String) {
        self.address = address
        self.token = token
        self.pixelURL = pixelURL
    }
}

public struct SendTracking: Hashable, Sendable {
    public var ref: String
    public var perRecipient: [SendTrackingRecipient]
    public var untracked: [Address]

    public init(ref: String, perRecipient: [SendTrackingRecipient], untracked: [Address]) {
        self.ref = ref
        self.perRecipient = perRecipient
        self.untracked = untracked
    }
}

/// What the send job needs from the receipts module (`FlintReceipts`).
public protocol TrackingProvider: Sendable {
    /// Receipts are switched on and an endpoint is configured.
    var isConfigured: Bool { get async }
    /// Registers a token per recipient. Never throws for service problems: on any failure every recipient comes back untracked.
    func prepareTracked(accountId: AccountID, subject: String, messageId: String, recipients: [Address], selfAddresses: [String]) async -> SendTracking
    /// Records a message the user asked to track that went out without tracking, with the reason shown in the list.
    func recordUntracked(accountId: AccountID, subject: String, messageId: String, recipients: [Address], selfAddresses: [String], reason: String) async
    /// Tells the service to forget a tracked message that never went out.
    func stopTracking(trackedId: Int) async
    /// Puts the pixel as the first element inside `<body>`.
    func injectPixel(html: String, pixelURL: String) -> String
}

public typealias SendJobStore = MailEngineStore & DraftsRepository & ScheduledSendRepository & RemindersRepository & ReceiptsRepository

public struct SendJob: Sendable {
    public struct Dependencies: Sendable {
        public var store: any SendJobStore
        public var tracking: any TrackingProvider
        /// The mailer for an account: its SMTP route and Sent fix-up.
        public var mailer: @Sendable (Account) -> Mailer
        public var actions: @Sendable (AccountID) -> ServerActions?
        /// Pull the Sent copy into the local store soon.
        public var syncSoon: @Sendable (AccountID) -> Void
        public var emit: @Sendable (FlintEvent) -> Void
        public var now: @Sendable () -> EpochMs

        public init(
            store: any SendJobStore, tracking: any TrackingProvider, mailer: @escaping @Sendable (Account) -> Mailer,
            actions: @escaping @Sendable (AccountID) -> ServerActions?, syncSoon: @escaping @Sendable (AccountID) -> Void = { _ in },
            emit: @escaping @Sendable (FlintEvent) -> Void, now: @escaping @Sendable () -> EpochMs = { Int(Date().timeIntervalSince1970 * 1000) }
        ) {
            self.store = store
            self.tracking = tracking
            self.mailer = mailer
            self.actions = actions
            self.syncSoon = syncSoon
            self.emit = emit
            self.now = now
        }
    }

    private let d: Dependencies

    public init(_ dependencies: Dependencies) { d = dependencies }

    private struct Delivery {
        var outcome: SendOutcome
        var ref: String?
        /// Set when the draft asked for read receipts but the mail went out without them.
        var untrackedReason: String?
    }

    private struct TrackingBlock {
        var note: String
        var toast: String
    }

    /// Why read receipts can't work right now, or nil when they can. `note` goes on the message, `toast` into the sent notice.
    private func trackingBlock(plain: Bool, settings: Settings) async -> TrackingBlock? {
        if plain { return TrackingBlock(note: "Receipts off: plain-text mode", toast: "plain text only is on, and a read receipt needs a tiny image") }
        if !settings.receipts.enabled { return TrackingBlock(note: "Receipts off in Settings", toast: "read receipts are switched off in Settings") }
        if await !d.tracking.isConfigured { return TrackingBlock(note: "Receipts off: no receipts address set", toast: "no receipts address is set in Settings") }
        return nil
    }

    /// Short reason read receipts can't work for new mail right now (composer hint), or nil when they can.
    public func trackingBlockedReason() async -> String? {
        guard let settings = try? await d.store.settings() else { return nil }
        return await trackingBlock(plain: settings.compose.plainTextOnly, settings: settings)?.note
    }

    private func sentFolders(_ account: Account) async throws -> SentFolders {
        let gmail = account.provider == .gmail
        var sent = try await d.store.folder(accountId: account.id, role: .sent)
        if sent == nil && !gmail { sent = try await d.store.ensureFolder(accountId: account.id, role: .sent) }
        let trash = try await d.store.folder(accountId: account.id, role: .trash)
        return SentFolders(provider: account.provider, sentPath: sent?.path, trashPath: trash?.path)
    }

    /// The scheduler's send port. Throws before SMTP on problems a retry may fix; never after the mail left.
    public func run(draftId: Int, scheduledId: Int) async throws -> String {
        let store = d.store
        guard let draft = try await store.draft(id: draftId) else { throw FlintError(.notFound, "The draft was deleted before it could be sent.") }
        guard draft.to.count + draft.cc.count + draft.bcc.count > 0 else { throw FlintError(.invalid, "Add at least one recipient.") }
        guard let account = try await store.account(id: draft.accountId) else { throw FlintError(.notFound, "That account no longer exists.") }
        try DraftMime.assertAttachmentsExist(draft)
        guard let row = try await store.scheduledSend(id: scheduledId) else { throw FlintError(.notFound, "That send no longer exists.") }
        let messageId = row.messageId ?? MimeBuilder.newMessageId(fromAddress: draft.from)
        if row.messageId == nil { _ = try await store.updateScheduled(scheduledId, ScheduledSendPatch(messageId: .some(messageId))) }
        let delivery = try await deliver(account: account, draft: draft, messageId: messageId)
        await afterSend(account: account, draft: draft, delivery: delivery)
        return delivery.outcome.messageId
    }

    private func deliver(account: Account, draft: Draft, messageId: String) async throws -> Delivery {
        let store = d.store
        let settings = try await store.settings()
        let plain = settings.compose.plainTextOnly
        var base = DraftMime.input(draft: draft, meta: try await store.draftMeta(draft.id), account: account, plainTextOnly: plain)
        base.messageId = messageId
        let folders = try await sentFolders(account)
        let mailer = d.mailer(account)
        let recipients = draft.to + draft.cc + draft.bcc
        let own = Array(try await store.ownAddresses())
        var ref: String?
        do {
            let configured = await d.tracking.isConfigured
            if !draft.track || plain || !configured {
                let block = draft.track ? (await trackingBlock(plain: plain, settings: settings) ?? TrackingBlock(note: "Receipts unavailable for this message", toast: "read receipts aren't available right now")) : nil
                let outcome = try await mailer.sendUntracked(base, folders: folders)
                // Only after the mail left, so a failed send leaves no phantom row.
                if let block {
                    await d.tracking.recordUntracked(accountId: account.id, subject: draft.subject, messageId: messageId, recipients: recipients, selfAddresses: own, reason: block.note)
                }
                return Delivery(outcome: outcome, ref: nil, untrackedReason: block?.toast)
            }
            let prepared = await d.tracking.prepareTracked(accountId: account.id, subject: draft.subject, messageId: messageId, recipients: recipients, selfAddresses: own)
            ref = prepared.ref
            var message = base
            message.headers["X-Flint-Ref"] = prepared.ref
            if prepared.perRecipient.isEmpty {
                let ownSet = Set(own.map { $0.lowercased() })
                let toSelfOnly = recipients.allSatisfy { ownSet.contains($0.address.lowercased()) }
                let outcome = try await mailer.sendUntracked(message, folders: folders)
                return Delivery(outcome: outcome, ref: prepared.ref, untrackedReason: toSelfOnly ? nil : "the receipts service couldn't be reached")
            }
            let pixels = Dictionary(prepared.perRecipient.map { ($0.token, $0.pixelURL) }, uniquingKeysWith: { first, _ in first })
            let tracking = d.tracking
            let outcome = try await mailer.sendTracked(
                message, folders: folders, tracked: prepared.perRecipient.map { TrackedRecipient(address: $0.address.address, token: $0.token) },
                untracked: prepared.untracked.map(\.address), injectPixel: { html, token in tracking.injectPixel(html: html, pixelURL: pixels[token] ?? "") })
            return Delivery(outcome: outcome, ref: prepared.ref, untrackedReason: nil)
        } catch {
            if let ref { await discardTracking(ref) }
            throw error
        }
    }

    /// The tracked row of a send that never went out is stopped, so the receipts list has no phantom message.
    private func discardTracking(_ ref: String) async {
        guard let id = try? await d.store.findTracked(ref: ref) else { return }
        await d.tracking.stopTracking(trackedId: id)
        try? await d.store.setTrackedState(id, .stopped)
    }

    /// Everything after the SMTP hand-off. The mail is gone by now, so nothing here may throw.
    private func afterSend(account: Account, draft: Draft, delivery: Delivery) async {
        let store = d.store
        let subject = draft.subject.isEmpty ? "(no subject)" : draft.subject
        if let threadId = draft.threadId, let ref = delivery.ref { try? await store.linkSentMessage(accountId: account.id, ref: ref, messageId: delivery.outcome.messageId, threadId: threadId) }
        if let remindAt = draft.remindAt {
            _ = try? await store.createReminder(accountId: account.id, threadId: draft.threadId, messageId: delivery.outcome.messageId, remindAt: remindAt)
        }
        if let source = draft.sourceMessageId, draft.mode == .reply || draft.mode == .replyAll,
           let locs = try? await store.messageLocations([source]) {
            for loc in locs { _ = try? await store.applyFlags(loc.folderId, [FlagUpdate(uid: loc.uid, answered: true)]) }
            _ = await d.actions(account.id)?.setAnswered(locs)
        }
        if !delivery.outcome.failed.isEmpty {
            let names = delivery.outcome.failed.map(\.address).joined(separator: ", ")
            d.emit(.toast(.error, message: "Couldn't deliver \"\(subject)\" to \(names). The other recipients got it.", undoToken: nil))
        }
        if let reason = delivery.untrackedReason {
            d.emit(.toast(.error, message: "Sent \"\(subject)\" without read receipts: \(reason).", undoToken: nil))
        }
        d.emit(.mailChanged(accountId: account.id, threadIds: draft.threadId.map { [$0] } ?? []))
        // Pull the Sent copy in so the thread, and the tracked row's thread link, show up now.
        d.syncSoon(account.id)
    }

    /// A plain-text message from an account with no draft behind it (unsubscribe by mailto).
    public func sendRaw(accountId: AccountID, to: [Address], subject: String, text: String) async throws {
        guard let account = try await d.store.account(id: accountId) else { throw FlintError(.notFound, "That account no longer exists.") }
        let html = "<div style=\"white-space:pre-wrap\">\(ReplyDraftBuilder.escapeHTML(text))</div>"
        let message = MimeInput(from: Address(name: account.name, address: account.email), to: to, subject: subject, html: html, text: text)
        _ = try await d.mailer(account).sendUntracked(message, folders: try await sentFolders(account))
    }
}
