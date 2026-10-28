// Sends a finished message over SMTP, untracked (one envelope for everyone) or tracked (one copy per tracked recipient), then
// files the clean copy in Sent. Port of sendUntracked / sendTracked in packages/core/src/mail/send.ts, plus server drafts.

import FlintModel
import Foundation

/// Hands one message to SMTP. `AccountSession.send` is the production implementation.
public typealias SMTPSender = @Sendable (OutgoingMessage) async throws -> Void

public struct TrackedRecipient: Hashable, Sendable {
    public var address: String
    public var token: String

    public init(address: String, token: String) {
        self.address = address
        self.token = token
    }
}

public struct SendOutcome: Hashable, Sendable {
    public var messageId: String
    /// SMTP transactions that succeeded.
    public var copies: Int
    public var failed: [Failure]
    public var sent: SentLocation?

    public struct Failure: Hashable, Sendable {
        public var address: String
        public var error: String
    }
}

public struct Mailer: Sendable {
    private let smtp: SMTPSender
    private let sentCopy: SentCopy?
    private let loader: MimeBuilder.AttachmentLoader
    private let now: @Sendable () -> Date

    /// - Parameter sentCopy: Runs the Sent fix-up. Without it the message is sent and nothing is filed.
    public init(smtp: @escaping SMTPSender, sentCopy: SentCopy?, loader: @escaping MimeBuilder.AttachmentLoader = MimeBuilder.fileLoader, now: @escaping @Sendable () -> Date = { Date() }) {
        self.smtp = smtp
        self.sentCopy = sentCopy
        self.loader = loader
        self.now = now
    }

    public static func allRecipients(_ message: MimeInput) -> [String] {
        var seen = Set<String>()
        return (message.to + message.cc + message.bcc).map { $0.address.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty && seen.insert($0).inserted }
    }

    /// Sends a finished message to exactly the envelope recipients.
    func submit(_ mime: Data, from: String, to: [String]) async throws {
        guard !to.isEmpty else { throw FlintError(.invalid, "Add at least one recipient.") }
        try await smtp(OutgoingMessage(envelopeFrom: from, recipients: to, raw: mime))
    }

    private func build(_ message: MimeInput, messageId: String, keepBcc: Bool) throws -> Data {
        var copy = message
        copy.messageId = messageId
        copy.keepBcc = keepBcc
        return try MimeBuilder.build(copy, loader: loader, now: now())
    }

    private func fileCopy(_ message: MimeInput, folders: SentFolders, messageId: String, serverCopyIsClean: Bool) async -> SentLocation? {
        guard let sentCopy else { return nil }
        do {
            let clean = try build(message, messageId: messageId, keepBcc: true)
            return try await sentCopy.file(folders: folders, messageId: messageId, cleanMime: clean, serverCopyIsClean: serverCopyIsClean)
        } catch {
            return nil // the mail left; a missing Sent copy is not a failed send
        }
    }

    /// One message to everyone in a single envelope, then the Sent fix-up.
    public func sendUntracked(_ message: MimeInput, folders: SentFolders) async throws -> SendOutcome {
        let messageId = message.messageId.map(MailHeaders.unbracketed) ?? MimeBuilder.newMessageId(fromAddress: message.from.address)
        let mime = try build(message, messageId: messageId, keepBcc: false)
        try await submit(mime, from: message.from.address, to: Self.allRecipients(message))
        return SendOutcome(messageId: messageId, copies: 1, failed: [], sent: await fileCopy(message, folders: folders, messageId: messageId, serverCopyIsClean: true))
    }

    /// Per-recipient copies for read receipts. Every copy has the same headers and Message-ID and no Bcc header; only the
    /// envelope recipient and the pixel differ. The user's own and untracked recipients share one clean copy.
    public func sendTracked(
        _ message: MimeInput, folders: SentFolders, tracked: [TrackedRecipient], untracked: [String], injectPixel: @Sendable (String, String) -> String
    ) async throws -> SendOutcome {
        guard !(tracked.isEmpty && untracked.isEmpty) else { throw FlintError(.invalid, "Add at least one recipient.") }
        let messageId = message.messageId.map(MailHeaders.unbracketed) ?? MimeBuilder.newMessageId(fromAddress: message.from.address)
        let from = message.from.address
        var failed: [SendOutcome.Failure] = []
        var copies = 0

        for recipient in tracked {
            do {
                var copy = message
                copy.html = injectPixel(message.html, recipient.token)
                try await submit(try build(copy, messageId: messageId, keepBcc: false), from: from, to: [recipient.address])
                copies += 1
            } catch {
                failed.append(SendOutcome.Failure(address: recipient.address, error: (error as? FlintError)?.message ?? "The message could not be sent."))
            }
        }
        if !untracked.isEmpty {
            do {
                try await submit(try build(message, messageId: messageId, keepBcc: false), from: from, to: untracked)
                copies += 1
            } catch {
                let reason = (error as? FlintError)?.message ?? "The message could not be sent."
                failed += untracked.map { SendOutcome.Failure(address: $0, error: reason) }
            }
        }
        if copies == 0 { throw FlintError(.network, failed.first?.error ?? "The message could not be sent.") }
        return SendOutcome(
            messageId: messageId, copies: copies, failed: failed,
            sent: await fileCopy(message, folders: folders, messageId: messageId, serverCopyIsClean: tracked.isEmpty))
    }

    // MARK: Server drafts

    /// Saves a draft to the server Drafts folder. Returns the new UID when the server reports it.
    public static func appendDraft(runner: any TransportRunner, draftsPath: String, mime: Data) async throws -> Int? {
        try await runner.run { t in try await SentCopy.appendCreating(t, path: draftsPath, mime: mime, flags: [IMAPFlag.draft, IMAPFlag.seen]) }
    }

    public static func deleteDraft(runner: any TransportRunner, draftsPath: String, uid: Int) async throws {
        try await runner.run { t in try await t.withMailbox(draftsPath) { try await t.expunge(.uids([uid])) } }
    }

    /// Appends the new copy first, then removes the previous one, so a failure never leaves the server with no draft.
    public static func replaceDraft(runner: any TransportRunner, draftsPath: String, previousUid: Int?, mime: Data) async throws -> Int? {
        let uid = try await appendDraft(runner: runner, draftsPath: draftsPath, mime: mime)
        if let previousUid { try? await deleteDraft(runner: runner, draftsPath: draftsPath, uid: previousUid) }
        return uid
    }
}
