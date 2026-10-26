// FROZEN CONTRACT (Wave 1, track 1B). Mirrors packages/core/src/types.ts.
// Changing this file needs the wave lead's sign-off and a note in docs/ios/HANDOFF.md.

import Foundation

/// sent: delivered, no signal yet. opened: an open that passed every false-positive filter. replied: strongest signal.
/// unknowable: the recipient's app prefetches images. untracked: tracking off, service unreachable, or recipient is the user.
public enum ReceiptStatus: String, Codable, Hashable, Sendable {
    case sent, opened, replied, unknowable, untracked
}

/// Events as classified by the receipts service; only `.open` counts.
public enum ReceiptEventKind: String, Codable, Hashable, Sendable {
    case open, prefetch, scanner, `self`, bot, duplicate
}

public struct ReceiptRecipient: Codable, Hashable, Sendable {
    public var email: String
    public var name: String
    public var status: ReceiptStatus
    public var firstOpenAt: EpochMs?
    public var lastOpenAt: EpochMs?
    public var openCount: Int
    public var repliedAt: EpochMs?
    public var note: String?
    public var possiblyForwarded: Bool

    public init(
        email: String, name: String = "", status: ReceiptStatus, firstOpenAt: EpochMs? = nil, lastOpenAt: EpochMs? = nil,
        openCount: Int = 0, repliedAt: EpochMs? = nil, note: String? = nil, possiblyForwarded: Bool = false
    ) {
        self.email = email
        self.name = name
        self.status = status
        self.firstOpenAt = firstOpenAt
        self.lastOpenAt = lastOpenAt
        self.openCount = openCount
        self.repliedAt = repliedAt
        self.note = note
        self.possiblyForwarded = possiblyForwarded
    }
}

public struct ReceiptSummary: Codable, Hashable, Sendable {
    public var opened: Int
    public var total: Int
    public var status: ReceiptStatus
    public var lastOpenAt: EpochMs?

    public init(opened: Int, total: Int, status: ReceiptStatus, lastOpenAt: EpochMs? = nil) {
        self.opened = opened
        self.total = total
        self.status = status
        self.lastOpenAt = lastOpenAt
    }
}

public struct ReceiptEvent: Codable, Hashable, Sendable {
    public var at: EpochMs
    public var email: String
    public var kind: ReceiptEventKind
    public var client: String?
    public var device: String?
    public var location: String?
    public var counted: Bool

    public init(at: EpochMs, email: String, kind: ReceiptEventKind, client: String? = nil, device: String? = nil, location: String? = nil, counted: Bool) {
        self.at = at
        self.email = email
        self.kind = kind
        self.client = client
        self.device = device
        self.location = location
        self.counted = counted
    }
}

public struct ReceiptDetail: Codable, Hashable, Sendable {
    public var trackedId: Int
    public var sentAt: EpochMs
    public var recipients: [ReceiptRecipient]
    public var events: [ReceiptEvent]

    public init(trackedId: Int, sentAt: EpochMs, recipients: [ReceiptRecipient], events: [ReceiptEvent]) {
        self.trackedId = trackedId
        self.sentAt = sentAt
        self.recipients = recipients
        self.events = events
    }
}

public struct TrackedMessage: Codable, Hashable, Sendable {
    public var trackedId: Int
    public var accountId: AccountID
    public var threadId: ThreadID?
    public var subject: String
    public var sentAt: EpochMs
    public var summary: ReceiptSummary
    public var recipients: [ReceiptRecipient]

    public init(trackedId: Int, accountId: AccountID, threadId: ThreadID? = nil, subject: String, sentAt: EpochMs, summary: ReceiptSummary, recipients: [ReceiptRecipient]) {
        self.trackedId = trackedId
        self.accountId = accountId
        self.threadId = threadId
        self.subject = subject
        self.sentAt = sentAt
        self.summary = summary
        self.recipients = recipients
    }
}

public struct ReceiptChange: Hashable, Sendable {
    public var trackedId: Int
    public var email: String
    public var status: String
    public var at: EpochMs

    public init(trackedId: Int, email: String, status: String, at: EpochMs) {
        self.trackedId = trackedId
        self.email = email
        self.status = status
        self.at = at
    }
}
