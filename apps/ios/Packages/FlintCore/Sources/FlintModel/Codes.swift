// FROZEN CONTRACT (Wave 1, track 1B). Mirrors packages/core/src/types.ts.
// Changing this file needs the wave lead's sign-off and a note in docs/ios/HANDOFF.md.

import Foundation

/// A one-time code found in new mail. Held in memory only for `codeTTLMs`, never written to the database.
/// Codes are credentials: only the UI sees them.
public struct VerificationCode: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    /// The value to type. Digit codes have spaces and dashes removed; alphanumeric codes keep their dash.
    public var code: String
    public var service: String
    public var senderAddress: String
    public var senderDomain: String
    public var threadId: ThreadID
    public var messageId: MessageRowID
    public var accountId: AccountID
    public var receivedAt: EpochMs
    public var expiresAt: EpochMs
    public var used: Bool

    public init(
        id: String, code: String, service: String, senderAddress: String, senderDomain: String, threadId: ThreadID,
        messageId: MessageRowID, accountId: AccountID, receivedAt: EpochMs, expiresAt: EpochMs, used: Bool = false
    ) {
        self.id = id
        self.code = code
        self.service = service
        self.senderAddress = senderAddress
        self.senderDomain = senderDomain
        self.threadId = threadId
        self.messageId = messageId
        self.accountId = accountId
        self.receivedAt = receivedAt
        self.expiresAt = expiresAt
        self.used = used
    }

    /// 10 minutes, as on desktop.
    public static let ttlMs = 10 * 60 * 1000
}

/// What the thread row and message banner need.
public struct CodeBadge: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var code: String
    public var service: String
    public var expiresAt: EpochMs
    public var used: Bool

    public init(id: String, code: String, service: String, expiresAt: EpochMs, used: Bool) {
        self.id = id
        self.code = code
        self.service = service
        self.expiresAt = expiresAt
        self.used = used
    }

    public init(_ v: VerificationCode) {
        self.init(id: v.id, code: v.code, service: v.service, expiresAt: v.expiresAt, used: v.used)
    }
}
