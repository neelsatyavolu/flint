// FROZEN CONTRACT (Wave 1, track 1B). Value types that cross the Store / mail engine boundary.
// They live in FlintModel so FlintMail and FlintStore share them without depending on each other's internals.
// Mirrors packages/core/src/store/types.ts.

import Foundation

public struct IngestAttachment: Hashable, Sendable {
    public var part: String
    public var filename: String
    public var contentType: String
    public var size: Int
    public var contentId: String?
    public var inline: Bool

    public init(part: String, filename: String, contentType: String, size: Int, contentId: String? = nil, inline: Bool = false) {
        self.part = part
        self.filename = filename
        self.contentType = contentType
        self.size = size
        self.contentId = contentId
        self.inline = inline
    }
}

public struct MessageFlags: Hashable, Sendable {
    public var seen: Bool
    public var flagged: Bool
    public var answered: Bool
    public var draft: Bool

    public init(seen: Bool = false, flagged: Bool = false, answered: Bool = false, draft: Bool = false) {
        self.seen = seen
        self.flagged = flagged
        self.answered = answered
        self.draft = draft
    }
}

/// One message as the mail engine saw it on the server. Message-IDs may carry angle brackets.
public struct IngestMessage: Hashable, Sendable {
    public var uid: Int
    public var gmMsgid: String?
    public var gmThrid: String?
    /// Gmail only: labels as folder paths (INBOX, [Gmail]/Sent Mail, user labels). Nil leaves membership alone.
    public var gmLabels: [String]?
    public var messageId: String?
    public var inReplyTo: String?
    public var references: [String]
    public var subject: String
    public var from: [Address]
    public var to: [Address]
    public var cc: [Address]
    public var bcc: [Address]
    public var replyTo: [Address]
    public var date: EpochMs
    public var flags: MessageFlags
    public var size: Int
    public var hasAttachments: Bool
    /// Selected headers, lowercase names: list-unsubscribe, list-unsubscribe-post, list-id, precedence, auto-submitted, x-flint-ref.
    public var headers: [String: String]
    public var snippet: String?
    public var textBody: String?
    public var htmlBody: String?
    public var attachments: [IngestAttachment]

    public init(
        uid: Int, gmMsgid: String? = nil, gmThrid: String? = nil, gmLabels: [String]? = nil, messageId: String? = nil,
        inReplyTo: String? = nil, references: [String] = [], subject: String = "", from: [Address] = [], to: [Address] = [],
        cc: [Address] = [], bcc: [Address] = [], replyTo: [Address] = [], date: EpochMs, flags: MessageFlags = MessageFlags(),
        size: Int = 0, hasAttachments: Bool = false, headers: [String: String] = [:], snippet: String? = nil,
        textBody: String? = nil, htmlBody: String? = nil, attachments: [IngestAttachment] = []
    ) {
        self.uid = uid
        self.gmMsgid = gmMsgid
        self.gmThrid = gmThrid
        self.gmLabels = gmLabels
        self.messageId = messageId
        self.inReplyTo = inReplyTo
        self.references = references
        self.subject = subject
        self.from = from
        self.to = to
        self.cc = cc
        self.bcc = bcc
        self.replyTo = replyTo
        self.date = date
        self.flags = flags
        self.size = size
        self.hasAttachments = hasAttachments
        self.headers = headers
        self.snippet = snippet
        self.textBody = textBody
        self.htmlBody = htmlBody
        self.attachments = attachments
    }
}

public struct IngestContext: Hashable, Sendable {
    /// Override the clock (tests).
    public var now: EpochMs?
    /// False for history backfill: skip blocked-sender and rule evaluation.
    public var evaluate: Bool

    public init(now: EpochMs? = nil, evaluate: Bool = true) {
        self.now = now
        self.evaluate = evaluate
    }
}

public struct IngestOutcome: Hashable, Sendable {
    public var uid: Int
    public var messageRowId: MessageRowID
    public var threadId: ThreadID
    public var isNew: Bool
    public var category: MailCategory
    public var fromMe: Bool
    public var blocked: Bool
    /// Every action of every matching rule. `category` and `mute` were already applied locally; the engine performs the rest.
    public var ruleActions: [RuleAction]
    /// Threads merged into `threadId` by this message (their ids no longer exist).
    public var mergedThreadIds: [ThreadID]
    /// Tracked recipients whose status changed because this message was a reply.
    public var receiptChanges: [ReceiptChange]

    public init(
        uid: Int, messageRowId: MessageRowID, threadId: ThreadID, isNew: Bool, category: MailCategory, fromMe: Bool = false,
        blocked: Bool = false, ruleActions: [RuleAction] = [], mergedThreadIds: [ThreadID] = [], receiptChanges: [ReceiptChange] = []
    ) {
        self.uid = uid
        self.messageRowId = messageRowId
        self.threadId = threadId
        self.isNew = isNew
        self.category = category
        self.fromMe = fromMe
        self.blocked = blocked
        self.ruleActions = ruleActions
        self.mergedThreadIds = mergedThreadIds
        self.receiptChanges = receiptChanges
    }
}

public struct MessageBody: Hashable, Sendable {
    public var text: String?
    public var html: String?
    public var attachments: [IngestAttachment]?

    public init(text: String? = nil, html: String? = nil, attachments: [IngestAttachment]? = nil) {
        self.text = text
        self.html = html
        self.attachments = attachments
    }
}

public struct FlagUpdate: Hashable, Sendable {
    public var uid: Int
    public var seen: Bool?
    public var flagged: Bool?
    public var answered: Bool?
    public var draft: Bool?

    public init(uid: Int, seen: Bool? = nil, flagged: Bool? = nil, answered: Bool? = nil, draft: Bool? = nil) {
        self.uid = uid
        self.seen = seen
        self.flagged = flagged
        self.answered = answered
        self.draft = draft
    }
}

/// A message row with parsed JSON. Bodies are included; use listings for light queries.
public struct StoredMessage: Hashable, Sendable, Identifiable {
    public var id: MessageRowID
    public var accountId: AccountID
    public var threadId: ThreadID
    public var folderId: FolderID
    public var uid: Int
    public var gmMsgid: String?
    public var gmThrid: String?
    public var messageId: String?
    public var inReplyTo: String?
    public var references: [String]
    public var subject: String
    public var from: [Address]
    public var to: [Address]
    public var cc: [Address]
    public var bcc: [Address]
    public var replyTo: [Address]
    public var date: EpochMs
    public var snippet: String
    public var seen: Bool
    public var flagged: Bool
    public var answered: Bool
    public var draft: Bool
    public var hasAttachments: Bool
    public var size: Int
    public var headers: [String: String]
    public var bodyLoaded: Bool
    public var text: String?
    public var rawHtml: String?
    public var category: MailCategory?
    public var isFromMe: Bool
    /// The message sits in a Sent folder (or carries the Sent label), so a "from me" header on it is believable.
    public var inSent: Bool
    public var attachments: [AttachmentInfo]
    public var unsubscribe: UnsubscribeInfo?

    public init(
        id: MessageRowID, accountId: AccountID, threadId: ThreadID, folderId: FolderID, uid: Int, gmMsgid: String? = nil,
        gmThrid: String? = nil, messageId: String? = nil, inReplyTo: String? = nil, references: [String] = [], subject: String = "",
        from: [Address] = [], to: [Address] = [], cc: [Address] = [], bcc: [Address] = [], replyTo: [Address] = [], date: EpochMs,
        snippet: String = "", seen: Bool = false, flagged: Bool = false, answered: Bool = false, draft: Bool = false,
        hasAttachments: Bool = false, size: Int = 0, headers: [String: String] = [:], bodyLoaded: Bool = false, text: String? = nil,
        rawHtml: String? = nil, category: MailCategory? = nil, isFromMe: Bool = false, inSent: Bool = false,
        attachments: [AttachmentInfo] = [], unsubscribe: UnsubscribeInfo? = nil
    ) {
        self.id = id
        self.accountId = accountId
        self.threadId = threadId
        self.folderId = folderId
        self.uid = uid
        self.gmMsgid = gmMsgid
        self.gmThrid = gmThrid
        self.messageId = messageId
        self.inReplyTo = inReplyTo
        self.references = references
        self.subject = subject
        self.from = from
        self.to = to
        self.cc = cc
        self.bcc = bcc
        self.replyTo = replyTo
        self.date = date
        self.snippet = snippet
        self.seen = seen
        self.flagged = flagged
        self.answered = answered
        self.draft = draft
        self.hasAttachments = hasAttachments
        self.size = size
        self.headers = headers
        self.bodyLoaded = bodyLoaded
        self.text = text
        self.rawHtml = rawHtml
        self.category = category
        self.isFromMe = isFromMe
        self.inSent = inSent
        self.attachments = attachments
        self.unsubscribe = unsubscribe
    }
}

/// A thread with its messages, oldest first, as the reader and the service need it.
public struct ThreadRows: Hashable, Sendable, Identifiable {
    public var id: ThreadID
    public var accountId: AccountID
    public var subject: String
    public var category: MailCategory
    public var pinned: Bool
    public var muted: Bool
    public var snoozedUntil: EpochMs?
    public var resurfacedAt: EpochMs?
    public var messages: [StoredMessage]
    public var draftIds: [Int]

    public init(
        id: ThreadID, accountId: AccountID, subject: String, category: MailCategory, pinned: Bool = false, muted: Bool = false,
        snoozedUntil: EpochMs? = nil, resurfacedAt: EpochMs? = nil, messages: [StoredMessage], draftIds: [Int] = []
    ) {
        self.id = id
        self.accountId = accountId
        self.subject = subject
        self.category = category
        self.pinned = pinned
        self.muted = muted
        self.snoozedUntil = snoozedUntil
        self.resurfacedAt = resurfacedAt
        self.messages = messages
        self.draftIds = draftIds
    }
}

/// Where a message lives, for IMAP operations.
public struct MessageLocation: Hashable, Sendable {
    public var messageRowId: MessageRowID
    public var threadId: ThreadID
    public var accountId: AccountID
    public var provider: MailProvider
    public var folderId: FolderID
    public var folderPath: String
    public var folderRole: MailboxRole?
    public var uid: Int
    public var gmMsgid: String?
    public var messageId: String?
    public var seen: Bool
    public var flagged: Bool
    public var answered: Bool
    /// All folders and labels the message is in now.
    public var memberFolderIds: [FolderID]

    public init(
        messageRowId: MessageRowID, threadId: ThreadID, accountId: AccountID, provider: MailProvider, folderId: FolderID,
        folderPath: String, folderRole: MailboxRole? = nil, uid: Int, gmMsgid: String? = nil, messageId: String? = nil,
        seen: Bool = false, flagged: Bool = false, answered: Bool = false, memberFolderIds: [FolderID] = []
    ) {
        self.messageRowId = messageRowId
        self.threadId = threadId
        self.accountId = accountId
        self.provider = provider
        self.folderId = folderId
        self.folderPath = folderPath
        self.folderRole = folderRole
        self.uid = uid
        self.gmMsgid = gmMsgid
        self.messageId = messageId
        self.seen = seen
        self.flagged = flagged
        self.answered = answered
        self.memberFolderIds = memberFolderIds
    }
}

/// Enough state to undo an action: restoring it puts thread flags and message placement back.
public struct ThreadSnapshot: Codable, Hashable, Sendable {
    public struct Message: Codable, Hashable, Sendable {
        public var id: MessageRowID
        public var folderId: FolderID
        public var uid: Int
        public var seen: Bool
        public var flagged: Bool
        public var answered: Bool
        public var memberFolderIds: [FolderID]
        public var category: String?
        public var categorySource: String?

        public init(id: MessageRowID, folderId: FolderID, uid: Int, seen: Bool, flagged: Bool, answered: Bool, memberFolderIds: [FolderID], category: String? = nil, categorySource: String? = nil) {
            self.id = id
            self.folderId = folderId
            self.uid = uid
            self.seen = seen
            self.flagged = flagged
            self.answered = answered
            self.memberFolderIds = memberFolderIds
            self.category = category
            self.categorySource = categorySource
        }
    }

    public struct Thread: Codable, Hashable, Sendable {
        public var id: ThreadID
        public var pinned: Bool
        public var muted: Bool
        public var snoozedUntil: EpochMs?
        public var resurfacedAt: EpochMs?
        public var messages: [Message]

        public init(id: ThreadID, pinned: Bool, muted: Bool, snoozedUntil: EpochMs?, resurfacedAt: EpochMs?, messages: [Message]) {
            self.id = id
            self.pinned = pinned
            self.muted = muted
            self.snoozedUntil = snoozedUntil
            self.resurfacedAt = resurfacedAt
            self.messages = messages
        }
    }

    public var version: Int
    public var threads: [Thread]

    public init(version: Int = 1, threads: [Thread]) {
        self.version = version
        self.threads = threads
    }
}

public struct ActionResult: Hashable, Sendable {
    public var snapshot: ThreadSnapshot
    public var locations: [MessageLocation]

    public init(snapshot: ThreadSnapshot, locations: [MessageLocation]) {
        self.snapshot = snapshot
        self.locations = locations
    }
}

public enum MoveTarget: Hashable, Sendable {
    case archive, trash, spam, inbox
    case folder(FolderID)
}

public enum PendingKind: String, Codable, Hashable, Sendable {
    case seen, flagged, archive, trash, spam, unspam
    case moveInbox = "move_inbox"
    case moveFolder = "move_folder"
}

/// The durable outbox: a server operation in a form that survives a restart. `arg` is the boolean or folder id it needs.
public struct PendingOpSpec: Hashable, Sendable {
    public enum Arg: Hashable, Sendable {
        case flag(Bool)
        case folder(FolderID)
    }
    public var kind: PendingKind
    public var arg: Arg?

    public init(kind: PendingKind, arg: Arg? = nil) {
        self.kind = kind
        self.arg = arg
    }
}

public struct PendingOp: Hashable, Sendable, Identifiable {
    public var id: Int
    public var accountId: AccountID
    public var spec: PendingOpSpec
    public var messageIds: [MessageRowID]
    public var createdAt: EpochMs
    public var attempts: Int

    public init(id: Int, accountId: AccountID, spec: PendingOpSpec, messageIds: [MessageRowID], createdAt: EpochMs, attempts: Int = 0) {
        self.id = id
        self.accountId = accountId
        self.spec = spec
        self.messageIds = messageIds
        self.createdAt = createdAt
        self.attempts = attempts
    }
}

public enum ReminderStatus: String, Codable, Hashable, Sendable {
    case pending, fired, replied, cancelled
}

public struct Reminder: Hashable, Sendable, Identifiable {
    public var id: Int
    public var accountId: AccountID
    public var threadId: ThreadID?
    public var messageId: String
    public var remindAt: EpochMs
    public var status: ReminderStatus

    public init(id: Int, accountId: AccountID, threadId: ThreadID? = nil, messageId: String, remindAt: EpochMs, status: ReminderStatus = .pending) {
        self.id = id
        self.accountId = accountId
        self.threadId = threadId
        self.messageId = messageId
        self.remindAt = remindAt
        self.status = status
    }
}

public struct NewAccount: Hashable, Sendable {
    public var id: AccountID?
    public var email: String
    public var name: String
    public var provider: MailProvider
    public var authKind: AuthKind
    public var server: ServerConfig
    public var color: String?
    public var sortOrder: Int?
    public var enabled: Bool?
    public var aliases: [String]?
    public var createdAt: EpochMs?
    public var showInUnified: Bool?

    public init(
        id: AccountID? = nil, email: String, name: String = "", provider: MailProvider, authKind: AuthKind, server: ServerConfig,
        color: String? = nil, sortOrder: Int? = nil, enabled: Bool? = nil, aliases: [String]? = nil, createdAt: EpochMs? = nil,
        showInUnified: Bool? = nil
    ) {
        self.id = id
        self.email = email
        self.name = name
        self.provider = provider
        self.authKind = authKind
        self.server = server
        self.color = color
        self.sortOrder = sortOrder
        self.enabled = enabled
        self.aliases = aliases
        self.createdAt = createdAt
        self.showInUnified = showInUnified
    }
}

/// Fields an account update may set. Nil leaves the field alone.
public struct AccountPatch: Hashable, Sendable {
    public var email: String?
    public var name: String?
    public var server: ServerConfig?
    /// Set by sign-in (a different method for the same address) and by Gmail detection. Not user-editable.
    public var provider: MailProvider?
    public var authKind: AuthKind?
    public var color: String??
    public var sortOrder: Int?
    public var enabled: Bool?
    public var aliases: [String]?
    public var showInUnified: Bool?
    public var avatarSource: AvatarSource??
    public var avatarUpdatedAt: EpochMs??

    public init(
        email: String? = nil, name: String? = nil, server: ServerConfig? = nil, provider: MailProvider? = nil, authKind: AuthKind? = nil,
        color: String?? = nil, sortOrder: Int? = nil, enabled: Bool? = nil, aliases: [String]? = nil, showInUnified: Bool? = nil,
        avatarSource: AvatarSource?? = nil, avatarUpdatedAt: EpochMs?? = nil
    ) {
        self.email = email
        self.name = name
        self.server = server
        self.provider = provider
        self.authKind = authKind
        self.color = color
        self.sortOrder = sortOrder
        self.enabled = enabled
        self.aliases = aliases
        self.showInUnified = showInUnified
        self.avatarSource = avatarSource
        self.avatarUpdatedAt = avatarUpdatedAt
    }
}
