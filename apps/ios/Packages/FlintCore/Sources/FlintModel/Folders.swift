// FROZEN CONTRACT (Wave 1, track 1B). Mirrors packages/core/src/types.ts.
// Changing this file needs the wave lead's sign-off and a note in docs/ios/HANDOFF.md.

import Foundation

public enum MailboxRole: String, Codable, CaseIterable, Hashable, Sendable {
    case inbox, sent, drafts, trash, spam, archive, all, flagged, important
}

public struct Folder: Codable, Hashable, Sendable, Identifiable {
    public var id: FolderID
    public var accountId: AccountID
    public var path: String
    public var name: String
    public var role: MailboxRole?
    public var unread: Int
    public var total: Int

    public init(id: FolderID, accountId: AccountID, path: String, name: String, role: MailboxRole? = nil, unread: Int = 0, total: Int = 0) {
        self.id = id
        self.accountId = accountId
        self.path = path
        self.name = name
        self.role = role
        self.unread = unread
        self.total = total
    }
}

/// What the mail engine knows about a folder when it upserts it.
public struct FolderInput: Hashable, Sendable {
    public var path: String
    public var name: String?
    public var delimiter: String?
    public var role: MailboxRole?
    public var specialUse: String?

    public init(path: String, name: String? = nil, delimiter: String? = nil, role: MailboxRole? = nil, specialUse: String? = nil) {
        self.path = path
        self.name = name
        self.delimiter = delimiter
        self.role = role
        self.specialUse = specialUse
    }
}

public struct FolderSyncState: Hashable, Sendable {
    public var uidValidity: Int?
    public var uidNext: Int?
    public var highestModseq: String?
    public var syncedMinUid: Int?
    public var lastSyncAt: EpochMs?

    public init(uidValidity: Int? = nil, uidNext: Int? = nil, highestModseq: String? = nil, syncedMinUid: Int? = nil, lastSyncAt: EpochMs? = nil) {
        self.uidValidity = uidValidity
        self.uidNext = uidNext
        self.highestModseq = highestModseq
        self.syncedMinUid = syncedMinUid
        self.lastSyncAt = lastSyncAt
    }
}
