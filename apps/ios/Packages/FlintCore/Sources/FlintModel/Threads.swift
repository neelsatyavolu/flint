// FROZEN CONTRACT (Wave 1, track 1B). Mirrors packages/core/src/types.ts.
// Changing this file needs the wave lead's sign-off and a note in docs/ios/HANDOFF.md.

import Foundation

/// The list views a ThreadQuery can ask for (TypeScript `View` minus home, receipts, agent_activity, scheduled).
public enum ThreadListView: String, Codable, Hashable, Sendable {
    case inbox, pinned, drafts, sent, trash, spam, archive, snoozed, folder, blocked, search
}

public enum SortOrder: String, Codable, Hashable, Sendable {
    case newest, oldest
}

public struct ThreadQuery: Hashable, Sendable {
    public var view: ThreadListView
    /// Nil means unified across accounts.
    public var accountId: AccountID?
    public var folderId: FolderID?
    /// View `.search`: supports from: to: cc: subject: has:attachment is:unread is:read is:pinned is:snoozed in: before: after: account:
    public var search: String?
    /// Inbox only: people threads listed, others folded into bundles.
    public var focused: Bool
    /// Inbox only: open one bundle.
    public var category: MailCategory?
    public var unreadOnly: Bool
    public var hasAttachments: Bool
    public var sort: SortOrder
    /// Opaque, from `ThreadPage.nextCursor`.
    public var cursor: String?
    /// Default 50, max 200.
    public var limit: Int

    public init(
        view: ThreadListView, accountId: AccountID? = nil, folderId: FolderID? = nil, search: String? = nil, focused: Bool = false,
        category: MailCategory? = nil, unreadOnly: Bool = false, hasAttachments: Bool = false, sort: SortOrder = .newest,
        cursor: String? = nil, limit: Int = 50
    ) {
        self.view = view
        self.accountId = accountId
        self.folderId = folderId
        self.search = search
        self.focused = focused
        self.category = category
        self.unreadOnly = unreadOnly
        self.hasAttachments = hasAttachments
        self.sort = sort
        self.cursor = cursor
        self.limit = limit
    }
}

public struct DraftRef: Hashable, Sendable {
    /// Set: a local draft. A draft without a thread has a negative list-item id; do not pass that id to thread actions.
    public var draftId: Int?
    /// Set: a server Drafts copy with no local draft.
    public var messageId: MessageRowID?

    public init(draftId: Int? = nil, messageId: MessageRowID? = nil) {
        self.draftId = draftId
        self.messageId = messageId
    }
}

public struct ThreadListItem: Hashable, Sendable, Identifiable {
    public var id: ThreadID
    public var accountId: AccountID
    public var subject: String
    public var snippet: String
    /// Senders in display order, most recent last.
    public var participants: [Address]
    /// `resurfacedAt` when later.
    public var lastDate: EpochMs
    public var messageCount: Int
    public var unreadCount: Int
    public var hasAttachments: Bool
    public var pinned: Bool
    public var muted: Bool
    public var snoozedUntil: EpochMs?
    public var category: MailCategory
    public var hasDraft: Bool
    public var receipt: ReceiptSummary?
    public var verificationCode: CodeBadge?
    /// Drafts view only.
    public var draft: DraftRef?

    public init(
        id: ThreadID, accountId: AccountID, subject: String, snippet: String, participants: [Address], lastDate: EpochMs,
        messageCount: Int, unreadCount: Int, hasAttachments: Bool = false, pinned: Bool = false, muted: Bool = false,
        snoozedUntil: EpochMs? = nil, category: MailCategory = .people, hasDraft: Bool = false, receipt: ReceiptSummary? = nil,
        verificationCode: CodeBadge? = nil, draft: DraftRef? = nil
    ) {
        self.id = id
        self.accountId = accountId
        self.subject = subject
        self.snippet = snippet
        self.participants = participants
        self.lastDate = lastDate
        self.messageCount = messageCount
        self.unreadCount = unreadCount
        self.hasAttachments = hasAttachments
        self.pinned = pinned
        self.muted = muted
        self.snoozedUntil = snoozedUntil
        self.category = category
        self.hasDraft = hasDraft
        self.receipt = receipt
        self.verificationCode = verificationCode
        self.draft = draft
    }
}

public struct BundleSample: Hashable, Sendable {
    public var from: Address
    public var subject: String

    public init(from: Address, subject: String) {
        self.from = from
        self.subject = subject
    }
}

/// A Notifications or Newsletters row in the smart inbox (TypeScript `Bundle`).
public struct InboxBundle: Hashable, Sendable {
    public var category: MailCategory
    public var unreadCount: Int
    public var totalCount: Int
    public var lastDate: EpochMs
    /// Up to 3.
    public var latest: [BundleSample]

    public init(category: MailCategory, unreadCount: Int, totalCount: Int, lastDate: EpochMs, latest: [BundleSample]) {
        self.category = category
        self.unreadCount = unreadCount
        self.totalCount = totalCount
        self.lastDate = lastDate
        self.latest = latest
    }
}

public struct ThreadPage: Hashable, Sendable {
    public var items: [ThreadListItem]
    /// Only when the query was focused.
    public var bundles: [InboxBundle]
    public var nextCursor: String?
    /// Last page only: the server holds older mail for this list that is not on this device yet.
    public var olderOnServer: Bool

    public init(items: [ThreadListItem], bundles: [InboxBundle] = [], nextCursor: String? = nil, olderOnServer: Bool = false) {
        self.items = items
        self.bundles = bundles
        self.nextCursor = nextCursor
        self.olderOnServer = olderOnServer
    }
}

public struct LoadOlderResult: Hashable, Sendable {
    public var loaded: Int
    public var hasMore: Bool

    public init(loaded: Int, hasMore: Bool) {
        self.loaded = loaded
        self.hasMore = hasMore
    }
}

// MARK: Reading

public struct AttachmentInfo: Codable, Hashable, Sendable, Identifiable {
    public var id: Int
    public var filename: String
    public var contentType: String
    public var size: Int
    public var inline: Bool
    public var contentId: String?

    public init(id: Int, filename: String, contentType: String, size: Int, inline: Bool = false, contentId: String? = nil) {
        self.id = id
        self.filename = filename
        self.contentType = contentType
        self.size = size
        self.inline = inline
        self.contentId = contentId
    }
}

public struct UnsubscribeInfo: Codable, Hashable, Sendable {
    public var url: String?
    public var mailto: String?
    public var oneClick: Bool

    public init(url: String? = nil, mailto: String? = nil, oneClick: Bool = false) {
        self.url = url
        self.mailto = mailto
        self.oneClick = oneClick
    }
}

public enum RemoteImagePolicy: String, Codable, Hashable, Sendable {
    case allowed, blocked
}

/// Where a conversation lives now, which decides whether the reader offers Archive or Move to Inbox.
public enum ThreadPlace: String, Codable, Hashable, Sendable {
    /// Archive applies: a message is in the Inbox, or the conversation only has sent mail and drafts.
    case inbox
    case archive, trash, spam
    /// A folder or label of the account's own.
    case folder

    /// The place for a conversation whose messages are members of these folders (one entry per message, nil for a folder without a
    /// role). Sent mail and drafts stay where they are on every move, so they only count when nothing else is there.
    public static func resolve(memberRoles: [[MailboxRole?]]) -> ThreadPlace {
        let moved = memberRoles.filter { roles in !roles.contains(.sent) && !roles.contains(.drafts) }.flatMap { $0 }
        if moved.isEmpty || moved.contains(.inbox) { return .inbox }
        if moved.contains(.spam) { return .spam }
        if moved.contains(.trash) { return .trash }
        if moved.contains(.archive) || moved.contains(.all) { return .archive }
        return .folder
    }
}

public struct MessageView: Hashable, Sendable, Identifiable {
    public var id: MessageRowID
    public var accountId: AccountID
    public var threadId: ThreadID
    public var messageId: String?
    public var from: [Address]
    public var to: [Address]
    public var cc: [Address]
    public var bcc: [Address]
    public var replyTo: [Address]
    public var subject: String
    public var date: EpochMs
    public var seen: Bool
    public var pinned: Bool
    public var isFromMe: Bool
    public var snippet: String
    /// Sanitized HTML safe for a locked-down web view (scripts, forms, event handlers removed).
    public var html: String?
    public var text: String?
    public var bodyLoaded: Bool
    public var remoteImages: RemoteImagePolicy
    /// The sanitizer found remote images (or remote CSS images) in the HTML, whether or not they are loaded.
    public var hasRemoteImages: Bool
    /// Known third-party tracking pixels were removed.
    public var hasTrackers: Bool
    public var attachments: [AttachmentInfo]
    public var unsubscribe: UnsubscribeInfo?
    public var receipt: ReceiptDetail?
    public var verificationCode: CodeBadge?

    public init(
        id: MessageRowID, accountId: AccountID, threadId: ThreadID, messageId: String? = nil, from: [Address], to: [Address] = [],
        cc: [Address] = [], bcc: [Address] = [], replyTo: [Address] = [], subject: String, date: EpochMs, seen: Bool, pinned: Bool = false,
        isFromMe: Bool = false, snippet: String = "", html: String? = nil, text: String? = nil, bodyLoaded: Bool = false,
        remoteImages: RemoteImagePolicy = .blocked, hasRemoteImages: Bool = false, hasTrackers: Bool = false,
        attachments: [AttachmentInfo] = [], unsubscribe: UnsubscribeInfo? = nil, receipt: ReceiptDetail? = nil,
        verificationCode: CodeBadge? = nil
    ) {
        self.id = id
        self.accountId = accountId
        self.threadId = threadId
        self.messageId = messageId
        self.from = from
        self.to = to
        self.cc = cc
        self.bcc = bcc
        self.replyTo = replyTo
        self.subject = subject
        self.date = date
        self.seen = seen
        self.pinned = pinned
        self.isFromMe = isFromMe
        self.snippet = snippet
        self.html = html
        self.text = text
        self.bodyLoaded = bodyLoaded
        self.remoteImages = remoteImages
        self.hasRemoteImages = hasRemoteImages
        self.hasTrackers = hasTrackers
        self.attachments = attachments
        self.unsubscribe = unsubscribe
        self.receipt = receipt
        self.verificationCode = verificationCode
    }
}

public struct ThreadDetail: Hashable, Sendable, Identifiable {
    public var id: ThreadID
    public var accountId: AccountID
    public var subject: String
    public var category: MailCategory
    public var pinned: Bool
    public var muted: Bool
    public var snoozedUntil: EpochMs?
    /// Oldest first.
    public var messages: [MessageView]
    public var draftIds: [Int]
    /// Where the conversation is now; nil when the store could not say.
    public var place: ThreadPlace?

    public init(
        id: ThreadID, accountId: AccountID, subject: String, category: MailCategory, pinned: Bool = false, muted: Bool = false,
        snoozedUntil: EpochMs? = nil, messages: [MessageView], draftIds: [Int] = [], place: ThreadPlace? = nil
    ) {
        self.id = id
        self.accountId = accountId
        self.subject = subject
        self.category = category
        self.pinned = pinned
        self.muted = muted
        self.snoozedUntil = snoozedUntil
        self.messages = messages
        self.draftIds = draftIds
        self.place = place
    }
}

public struct SidebarAccount: Hashable, Sendable, Identifiable {
    public var account: Account
    public var inboxUnread: Int
    public var folders: [Folder]
    public var sync: SyncStatus
    public var id: AccountID { account.id }

    public init(account: Account, inboxUnread: Int, folders: [Folder], sync: SyncStatus) {
        self.account = account
        self.inboxUnread = inboxUnread
        self.folders = folders
        self.sync = sync
    }
}

public struct SidebarCounts: Hashable, Sendable {
    public var inbox: Int
    public var pinned: Int
    public var drafts: Int
    public var snoozed: Int
    public var scheduled: Int
    public var spam: Int

    public init(inbox: Int = 0, pinned: Int = 0, drafts: Int = 0, snoozed: Int = 0, scheduled: Int = 0, spam: Int = 0) {
        self.inbox = inbox
        self.pinned = pinned
        self.drafts = drafts
        self.snoozed = snoozed
        self.scheduled = scheduled
        self.spam = spam
    }
}

public struct SidebarData: Hashable, Sendable {
    public var accounts: [SidebarAccount]
    public var counts: SidebarCounts

    public init(accounts: [SidebarAccount], counts: SidebarCounts) {
        self.accounts = accounts
        self.counts = counts
    }
}
