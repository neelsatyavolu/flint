// FROZEN CONTRACT (Wave 1, track 1B). Input and result shapes for the `Store` protocol.

import FlintModel
import Foundation

public struct FolderSyncPatch: Hashable, Sendable {
    public var uidValidity: Int??
    public var uidNext: Int??
    public var highestModseq: String??
    public var syncedMinUid: Int??
    public var lastSyncAt: EpochMs??

    public init(uidValidity: Int?? = nil, uidNext: Int?? = nil, highestModseq: String?? = nil, syncedMinUid: Int?? = nil, lastSyncAt: EpochMs?? = nil) {
        self.uidValidity = uidValidity
        self.uidNext = uidNext
        self.highestModseq = highestModseq
        self.syncedMinUid = syncedMinUid
        self.lastSyncAt = lastSyncAt
    }
}

public struct StoredAttachment: Hashable, Sendable {
    public var info: AttachmentInfo
    public var messageRowId: MessageRowID
    /// IMAP body part number to download.
    public var part: String
    public var cachedPath: String?

    public init(info: AttachmentInfo, messageRowId: MessageRowID, part: String, cachedPath: String? = nil) {
        self.info = info
        self.messageRowId = messageRowId
        self.part = part
        self.cachedPath = cachedPath
    }
}

public struct NewDraft: Hashable, Sendable {
    public var accountId: AccountID
    public var from: String
    public var mode: ComposeMode
    public var sourceMessageId: MessageRowID?
    public var threadId: ThreadID?
    public var to: [Address]
    public var cc: [Address]
    public var bcc: [Address]
    public var subject: String
    public var html: String
    public var quotedHtml: String
    public var attachments: [DraftAttachment]
    public var signatureId: Int?
    public var track: Bool
    public var remindAt: EpochMs?
    public var createdBy: String
    public var inReplyTo: String?
    public var references: [String]

    public init(
        accountId: AccountID, from: String, mode: ComposeMode = .new, sourceMessageId: MessageRowID? = nil, threadId: ThreadID? = nil,
        to: [Address] = [], cc: [Address] = [], bcc: [Address] = [], subject: String = "", html: String = "", quotedHtml: String = "",
        attachments: [DraftAttachment] = [], signatureId: Int? = nil, track: Bool = false, remindAt: EpochMs? = nil,
        createdBy: String = "user", inReplyTo: String? = nil, references: [String] = []
    ) {
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
        self.inReplyTo = inReplyTo
        self.references = references
    }
}

public struct NewScheduledSend: Hashable, Sendable {
    public var draftId: Int
    public var sendAt: EpochMs
    public var status: ScheduledSendStatus
    public var requestedBy: String

    public init(draftId: Int, sendAt: EpochMs, status: ScheduledSendStatus = .pending, requestedBy: String = "user") {
        self.draftId = draftId
        self.sendAt = sendAt
        self.status = status
        self.requestedBy = requestedBy
    }
}

public struct ScheduledSendPatch: Hashable, Sendable {
    public var status: ScheduledSendStatus?
    public var error: String??
    public var attempts: Int?
    public var messageId: String??
    public var sendAt: EpochMs?

    public init(status: ScheduledSendStatus? = nil, error: String?? = nil, attempts: Int? = nil, messageId: String?? = nil, sendAt: EpochMs? = nil) {
        self.status = status
        self.error = error
        self.attempts = attempts
        self.messageId = messageId
        self.sendAt = sendAt
    }
}

public struct NewTracked: Hashable, Sendable {
    public enum State: String, Hashable, Sendable { case active, unregistered, stopped }
    public struct Recipient: Hashable, Sendable {
        public var email: String
        public var name: String
        public var token: String

        public init(email: String, name: String = "", token: String) {
            self.email = email
            self.name = name
            self.token = token
        }
    }

    public var accountId: AccountID
    public var ref: String
    public var messageId: String
    public var threadId: ThreadID?
    public var subject: String
    public var sentAt: EpochMs
    public var state: State
    /// Why the mail went out without tracking; shown as the recipients' note.
    public var untrackedReason: String?
    public var recipients: [Recipient]

    public init(
        accountId: AccountID, ref: String, messageId: String, threadId: ThreadID? = nil, subject: String, sentAt: EpochMs,
        state: State = .active, untrackedReason: String? = nil, recipients: [Recipient]
    ) {
        self.accountId = accountId
        self.ref = ref
        self.messageId = messageId
        self.threadId = threadId
        self.subject = subject
        self.sentAt = sentAt
        self.state = state
        self.untrackedReason = untrackedReason
        self.recipients = recipients
    }
}

public struct ReceiptEventInput: Hashable, Sendable {
    public var remoteId: String
    public var token: String
    public var at: EpochMs
    public var kind: ReceiptEventKind
    public var client: String?
    public var device: String?
    public var location: String?
    public var fingerprint: String?

    public init(remoteId: String, token: String, at: EpochMs, kind: ReceiptEventKind, client: String? = nil, device: String? = nil, location: String? = nil, fingerprint: String? = nil) {
        self.remoteId = remoteId
        self.token = token
        self.at = at
        self.kind = kind
        self.client = client
        self.device = device
        self.location = location
        self.fingerprint = fingerprint
    }
}

public struct PollableTracked: Hashable, Sendable {
    public var trackedId: Int
    public var ref: String
    public var sentAt: EpochMs

    public init(trackedId: Int, ref: String, sentAt: EpochMs) {
        self.trackedId = trackedId
        self.ref = ref
        self.sentAt = sentAt
    }
}

/// Who set a thread's category: a rule or the user. Either blocks automatic recategorization.
public enum CategorySource: String, Hashable, Sendable {
    case rule, manual
}

public struct HeaderRefreshTarget: Hashable, Sendable {
    public var folderId: FolderID
    public var folderPath: String
    public var uids: [Int]

    public init(folderId: FolderID, folderPath: String, uids: [Int]) {
        self.folderId = folderId
        self.folderPath = folderPath
        self.uids = uids
    }
}
