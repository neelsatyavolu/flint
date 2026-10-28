// FROZEN CONTRACT (Wave 1, track 1B). Mirrors packages/core/src/types.ts.
// Changing this file needs the wave lead's sign-off and a note in docs/ios/HANDOFF.md.

import Foundation

public enum ComposeMode: String, Codable, Hashable, Sendable {
    case new, reply
    case replyAll = "replyAll"
    case forward
}

public struct DraftAttachment: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var filename: String
    public var contentType: String
    public var size: Int
    /// File path under the app container, relative to the attachments root the service decides.
    public var path: String
    public var inline: Bool?
    public var contentId: String?

    public init(id: String, filename: String, contentType: String, size: Int, path: String, inline: Bool? = nil, contentId: String? = nil) {
        self.id = id
        self.filename = filename
        self.contentType = contentType
        self.size = size
        self.path = path
        self.inline = inline
        self.contentId = contentId
    }
}

public struct Draft: Codable, Hashable, Sendable, Identifiable {
    public var id: Int
    public var accountId: AccountID
    public var from: String
    public var mode: ComposeMode
    public var sourceMessageId: MessageRowID?
    public var threadId: ThreadID?
    public var to: [Address]
    public var cc: [Address]
    public var bcc: [Address]
    public var subject: String
    /// The body the user wrote (signature included as a marked block).
    public var html: String
    /// Quoted original, shown collapsed.
    public var quotedHtml: String
    public var attachments: [DraftAttachment]
    public var signatureId: Int?
    public var track: Bool
    public var remindAt: EpochMs?
    public var createdBy: String
    public var updatedAt: EpochMs
    /// Set by the service when read receipts cannot work for a send right now (for example "Receipts off: plain-text mode").
    public var trackingBlockedReason: String?

    public init(
        id: Int, accountId: AccountID, from: String, mode: ComposeMode = .new, sourceMessageId: MessageRowID? = nil,
        threadId: ThreadID? = nil, to: [Address] = [], cc: [Address] = [], bcc: [Address] = [], subject: String = "",
        html: String = "", quotedHtml: String = "", attachments: [DraftAttachment] = [], signatureId: Int? = nil,
        track: Bool = false, remindAt: EpochMs? = nil, createdBy: String = "user", updatedAt: EpochMs = 0,
        trackingBlockedReason: String? = nil
    ) {
        self.id = id
        self.accountId = accountId
        self.from = from
        self.mode = mode
        self.sourceMessageId = sourceMessageId
        self.threadId = threadId
        self.to = to
        self.cc = cc
        self.bcc = bcc
        self.subject = subject
        self.html = html
        self.quotedHtml = quotedHtml
        self.attachments = attachments
        self.signatureId = signatureId
        self.track = track
        self.remindAt = remindAt
        self.createdBy = createdBy
        self.updatedAt = updatedAt
        self.trackingBlockedReason = trackingBlockedReason
    }
}

public enum DraftInit: Hashable, Sendable {
    case new(accountId: AccountID? = nil, to: [Address] = [], subject: String? = nil, html: String? = nil, templateId: Int? = nil)
    case reply(messageId: MessageRowID, html: String? = nil)
    case replyAll(messageId: MessageRowID, html: String? = nil)
    case forward(messageId: MessageRowID, html: String? = nil)
}

/// Fields a draft update may set. Nil leaves the field alone.
public struct DraftPatch: Hashable, Sendable {
    public var from: String?
    public var accountId: AccountID?
    public var to: [Address]?
    public var cc: [Address]?
    public var bcc: [Address]?
    public var subject: String?
    public var html: String?
    public var quotedHtml: String?
    public var attachments: [DraftAttachment]?
    public var signatureId: Int??
    public var track: Bool?
    public var remindAt: EpochMs??
    public var threadId: ThreadID??
    public var sourceMessageId: MessageRowID??
    public var mode: ComposeMode?

    public init(
        from: String? = nil, accountId: AccountID? = nil, to: [Address]? = nil, cc: [Address]? = nil, bcc: [Address]? = nil,
        subject: String? = nil, html: String? = nil, quotedHtml: String? = nil, attachments: [DraftAttachment]? = nil,
        signatureId: Int?? = nil, track: Bool? = nil, remindAt: EpochMs?? = nil, threadId: ThreadID?? = nil,
        sourceMessageId: MessageRowID?? = nil, mode: ComposeMode? = nil
    ) {
        self.from = from
        self.accountId = accountId
        self.to = to
        self.cc = cc
        self.bcc = bcc
        self.subject = subject
        self.html = html
        self.quotedHtml = quotedHtml
        self.attachments = attachments
        self.signatureId = signatureId
        self.track = track
        self.remindAt = remindAt
        self.threadId = threadId
        self.sourceMessageId = sourceMessageId
        self.mode = mode
    }
}

/// Threading headers and the server copy of a draft, kept beside the draft row.
public struct DraftMeta: Hashable, Sendable {
    public var inReplyTo: String?
    public var references: [String]
    public var serverUid: Int?
    public var serverMessageId: String?

    public init(inReplyTo: String? = nil, references: [String] = [], serverUid: Int? = nil, serverMessageId: String? = nil) {
        self.inReplyTo = inReplyTo
        self.references = references
        self.serverUid = serverUid
        self.serverMessageId = serverMessageId
    }
}

public enum ScheduledSendStatus: String, Codable, Hashable, Sendable {
    case pending
    case awaitingApproval = "awaiting_approval"
    case sending, sent, failed, cancelled
}

public struct ScheduledSend: Codable, Hashable, Sendable, Identifiable {
    public var id: Int
    public var draftId: Int
    public var subject: String
    public var to: [Address]
    public var sendAt: EpochMs
    public var status: ScheduledSendStatus
    public var error: String?
    public var requestedBy: String
    public var attempts: Int
    public var messageId: String?
    public var createdAt: EpochMs

    public init(
        id: Int, draftId: Int, subject: String = "", to: [Address] = [], sendAt: EpochMs, status: ScheduledSendStatus = .pending,
        error: String? = nil, requestedBy: String = "user", attempts: Int = 0, messageId: String? = nil, createdAt: EpochMs = 0
    ) {
        self.id = id
        self.draftId = draftId
        self.subject = subject
        self.to = to
        self.sendAt = sendAt
        self.status = status
        self.error = error
        self.requestedBy = requestedBy
        self.attempts = attempts
        self.messageId = messageId
        self.createdAt = createdAt
    }
}

public struct SendResult: Hashable, Sendable {
    public var scheduledId: Int
    public var sendAt: EpochMs
    public var undoUntil: EpochMs
    public var status: ScheduledSendStatus

    public init(scheduledId: Int, sendAt: EpochMs, undoUntil: EpochMs, status: ScheduledSendStatus) {
        self.scheduledId = scheduledId
        self.sendAt = sendAt
        self.undoUntil = undoUntil
        self.status = status
    }
}

public struct Signature: Codable, Hashable, Sendable, Identifiable {
    public var id: Int
    public var name: String
    public var html: String
    /// Accounts that can use it; empty means every account.
    public var accountIds: [AccountID]
    public var defaultNew: Bool
    public var defaultReply: Bool

    public init(id: Int, name: String, html: String, accountIds: [AccountID] = [], defaultNew: Bool = false, defaultReply: Bool = false) {
        self.id = id
        self.name = name
        self.html = html
        self.accountIds = accountIds
        self.defaultNew = defaultNew
        self.defaultReply = defaultReply
    }
}

public struct Template: Codable, Hashable, Sendable, Identifiable {
    public var id: Int
    public var name: String
    public var subject: String
    public var html: String

    public init(id: Int, name: String, subject: String = "", html: String) {
        self.id = id
        self.name = name
        self.subject = subject
        self.html = html
    }
}
